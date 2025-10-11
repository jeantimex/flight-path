import * as THREE from 'three'

/**
 * MergedGPUPanes - Ultra-high performance pane renderer
 * Uses a single InstancedMesh with per-instance attributes for maximum performance.
 * Supports per-instance size and color through vertex attributes and shaders.
 */
export class MergedGPUPanes {
    constructor(scene, options = {}) {
        this.scene = scene
        this.maxPanes = options.maxPanes || 1000
        this.baseSize = options.baseSize || 100

        // Instanced mesh
        this.instancedMesh = null
        this.geometry = null
        this.material = null

        // Per-instance data stored in Float32Arrays
        this.instanceColors = new Float32Array(this.maxPanes * 3) // RGB per instance
        this.instanceScales = new Float32Array(this.maxPanes) // Scale multiplier per instance

        // Tracking
        this.activePanes = 0

        // Store pane data for each instance
        this.paneData = []

        this.initialize()
    }

    /**
     * Initialize the instanced mesh with shader material
     */
    initialize() {
        // Create plane geometry (centered at origin)
        this.geometry = new THREE.PlaneGeometry(this.baseSize, this.baseSize)

        // Add per-instance attributes
        this.geometry.setAttribute(
            'instanceColor',
            new THREE.InstancedBufferAttribute(this.instanceColors, 3)
        )
        this.geometry.setAttribute(
            'instanceScale',
            new THREE.InstancedBufferAttribute(this.instanceScales, 1)
        )

        // Create shader material with per-instance coloring and scaling
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                baseSize: { value: this.baseSize }
            },
            vertexShader: `
                attribute vec3 instanceColor;
                attribute float instanceScale;

                varying vec3 vColor;

                void main() {
                    vColor = instanceColor;

                    // Apply per-instance scale to the vertex position
                    vec3 scaledPosition = position * instanceScale;

                    // Transform to world space using instance matrix
                    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(scaledPosition, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    gl_FragColor = vec4(vColor, 1.0);
                }
            `,
            side: THREE.DoubleSide
        })

        // Create instanced mesh
        this.instancedMesh = new THREE.InstancedMesh(
            this.geometry,
            this.material,
            this.maxPanes
        )

        // Initialize pane data array
        for (let i = 0; i < this.maxPanes; i++) {
            this.paneData.push({
                position: new THREE.Vector3(),
                previousPosition: new THREE.Vector3(),
                quaternion: new THREE.Quaternion(),
                scale: 1.0,
                color: new THREE.Color(0xff6666),
                visible: false
            })

            // Initialize default color (red)
            this.instanceColors[i * 3] = 1.0     // R
            this.instanceColors[i * 3 + 1] = 0.4 // G
            this.instanceColors[i * 3 + 2] = 0.4 // B

            // Initialize default scale
            this.instanceScales[i] = 1.0

            // Initialize matrix to identity (hidden at origin)
            const matrix = new THREE.Matrix4()
            matrix.identity()
            this.instancedMesh.setMatrixAt(i, matrix)
        }

        this.instancedMesh.instanceMatrix.needsUpdate = true

        // Add to scene
        this.scene.add(this.instancedMesh)
    }

    /**
     * Update a specific pane instance with position and orientation
     * @param {number} index - The index of the pane to update
     * @param {THREE.Vector3} position - The new position
     * @param {THREE.Vector3} nextPosition - The next position (optional, for forward direction calculation)
     * @param {THREE.Vector3} up - Optional up vector (defaults to world up)
     * @param {string} tiltMode - 'Perpendicular' or 'Tangent' (default 'Perpendicular')
     */
    updatePane(index, position, nextPosition = null, up = new THREE.Vector3(0, 1, 0), tiltMode = 'Perpendicular') {
        if (index < 0 || index >= this.maxPanes || !this.instancedMesh) return

        const pane = this.paneData[index]
        pane.visible = true

        // Calculate forward direction from position movement
        let forward = new THREE.Vector3()

        if (nextPosition) {
            // Use next position to calculate forward direction
            forward.subVectors(nextPosition, position).normalize()
        } else if (pane.previousPosition.lengthSq() > 0) {
            // Use previous position to calculate forward direction
            forward.subVectors(position, pane.previousPosition).normalize()
        } else {
            // Default forward direction if no previous position
            forward.set(0, 0, 1)
        }

        // Store previous position for next frame
        pane.previousPosition.copy(pane.position)

        // Store new position
        pane.position.copy(position)

        // Calculate orientation based on tilt mode
        let rotationMatrix = new THREE.Matrix4()

        if (tiltMode === 'Perpendicular') {
            // Perpendicular mode: pane's normal (Z-axis) aligns with forward direction
            const right = new THREE.Vector3().crossVectors(up, forward).normalize()
            const newUp = new THREE.Vector3().crossVectors(forward, right).normalize()
            rotationMatrix.makeBasis(right, newUp, forward)
        } else if (tiltMode === 'Tangent') {
            // Tangent mode: rotate the pane 90 degrees forward from perpendicular
            const right = new THREE.Vector3().crossVectors(up, forward).normalize()
            const newUp = new THREE.Vector3().crossVectors(forward, right).normalize()
            rotationMatrix.makeBasis(right, newUp, forward)
            const tiltRotation = new THREE.Matrix4().makeRotationX(Math.PI / 2)
            rotationMatrix.multiply(tiltRotation)
        }

        // Extract quaternion from rotation matrix
        pane.quaternion.setFromRotationMatrix(rotationMatrix)

        // Compose final matrix (scale is handled by instanceScale attribute in shader)
        const matrix = new THREE.Matrix4()
        const scaleVec = new THREE.Vector3(1, 1, 1) // Identity scale in matrix
        matrix.compose(pane.position, pane.quaternion, scaleVec)

        // Update instance matrix
        this.instancedMesh.setMatrixAt(index, matrix)
        this.instancedMesh.instanceMatrix.needsUpdate = true
    }

    /**
     * Update a pane with curve position parameter
     * @param {number} index - Index of the pane
     * @param {Object} curve - A curve object with getPointAt method
     * @param {number} t - Parameter along curve (0 to 1)
     * @param {number} lookAheadDelta - How far ahead to look for forward direction
     * @param {string} tiltMode - 'Perpendicular' or 'Tangent'
     */
    updatePaneOnCurve(index, curve, t, lookAheadDelta = 0.001, tiltMode = 'Perpendicular') {
        if (!curve) return
        if (curve.exists && typeof curve.exists === 'function' && !curve.exists()) return

        // Get current position
        const position = curve.getPointAt(t)

        // Get next position (look slightly ahead on the curve)
        const nextT = Math.min(1.0, t + lookAheadDelta)
        const nextPosition = curve.getPointAt(nextT)

        // Update pane with actual movement direction and tilt mode
        this.updatePane(index, position, nextPosition, new THREE.Vector3(0, 1, 0), tiltMode)
    }

    /**
     * Set the color of a specific pane
     * @param {number} index - Index of the pane
     * @param {number|THREE.Color} color - Color to set
     */
    setPaneColor(index, color) {
        if (index < 0 || index >= this.maxPanes) return

        const pane = this.paneData[index]
        pane.color = color instanceof THREE.Color ? color : new THREE.Color(color)

        // Update instance color attribute
        this.instanceColors[index * 3] = pane.color.r
        this.instanceColors[index * 3 + 1] = pane.color.g
        this.instanceColors[index * 3 + 2] = pane.color.b

        // Mark attribute for update
        if (this.geometry.attributes.instanceColor) {
            this.geometry.attributes.instanceColor.needsUpdate = true
        }
    }

    /**
     * Set the size (scale) of a specific pane
     * @param {number} index - Index of the pane
     * @param {number} size - Size value (multiplier of baseSize)
     */
    setPaneSize(index, size) {
        if (index < 0 || index >= this.maxPanes) return

        const pane = this.paneData[index]
        const normalizedScale = size / this.baseSize
        pane.scale = normalizedScale

        // Update instance scale attribute
        this.instanceScales[index] = normalizedScale

        // Mark attribute for update
        if (this.geometry.attributes.instanceScale) {
            this.geometry.attributes.instanceScale.needsUpdate = true
        }
    }

    /**
     * Set scale for a specific pane (alias for setPaneSize for API compatibility)
     * @param {number} index - Index of the pane
     * @param {number|THREE.Vector3} scale - Scale value
     */
    setScale(index, scale) {
        if (index < 0 || index >= this.maxPanes) return

        const scaleValue = typeof scale === 'number' ? scale : scale.x
        const pane = this.paneData[index]
        pane.scale = scaleValue

        // Update instance scale attribute
        this.instanceScales[index] = scaleValue

        // Mark attribute for update
        if (this.geometry.attributes.instanceScale) {
            this.geometry.attributes.instanceScale.needsUpdate = true
        }
    }

    /**
     * Hide a specific pane
     * @param {number} index - Index of the pane to hide
     */
    hidePane(index) {
        if (index < 0 || index >= this.maxPanes) return

        const pane = this.paneData[index]
        pane.visible = false

        // Move to origin with zero scale (effectively hiding it)
        const matrix = new THREE.Matrix4()
        matrix.makeScale(0, 0, 0)
        this.instancedMesh.setMatrixAt(index, matrix)
        this.instancedMesh.instanceMatrix.needsUpdate = true
    }

    /**
     * Set the number of active panes (for draw range optimization)
     * @param {number} count - Number of active panes
     */
    setActivePaneCount(count) {
        this.activePanes = Math.min(count, this.maxPanes)
        // Note: Three.js InstancedMesh doesn't support draw range like regular geometry
        // All instances are always drawn, but we can hide unused ones
    }

    /**
     * Get the number of pane instances
     */
    getCount() {
        return this.maxPanes
    }

    /**
     * Check if a pane is visible
     * @param {number} index - Index of the pane
     */
    isPaneVisible(index) {
        if (index < 0 || index >= this.maxPanes) return false
        return this.paneData[index].visible
    }

    /**
     * Remove from scene and cleanup
     */
    remove() {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh)
            this.geometry.dispose()
            this.material.dispose()
            this.instancedMesh = null
        }
        this.paneData = []
    }

    /**
     * Check if the merged panes exist
     */
    exists() {
        return this.instancedMesh !== null
    }

    /**
     * Get the maximum number of panes
     */
    getMaxPanes() {
        return this.maxPanes
    }
}

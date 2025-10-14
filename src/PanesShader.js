import * as THREE from 'three'
import vertexShader from './shaders/panes.vert?raw'
import fragmentShader from './shaders/panes.frag?raw'

/**
 * PanesShader - Ultimate performance pane renderer with GPU-side animation
 * All curve calculations, transformations, and animations happen in the vertex shader.
 * CPU only updates time uniform per frame - no per-flight work on CPU!
 */
export class PanesShader {
    constructor(scene, options = {}) {
        this.scene = scene
        this.maxPanes = options.maxPanes || 1000
        this.baseSize = options.baseSize || 100
        this.returnModeEnabled = !!options.returnMode

        // Instanced mesh
        this.instancedMesh = null
        this.geometry = null
        this.material = null

        // Per-instance data: curve control points (4 points for CatmullRom)
        // Each flight needs 4 control points (12 floats = 3 vec4 attributes)
        this.controlPointsPack1 = new Float32Array(this.maxPanes * 4) // (p0.x, p0.y, p0.z, p1.x)
        this.controlPointsPack2 = new Float32Array(this.maxPanes * 4) // (p1.y, p1.z, p2.x, p2.y)
        this.controlPointsPack3 = new Float32Array(this.maxPanes * 4) // (p2.z, p3.x, p3.y, p3.z)

        // Per-instance colors and metadata
        this.instanceColors = new Float32Array(this.maxPanes * 3) // RGB per instance
        this.instanceScales = new Float32Array(this.maxPanes) // Scale multiplier per instance
        this.instanceElevations = new Float32Array(this.maxPanes) // Elevation offset per instance
        this.instanceUvTransforms = new Float32Array(this.maxPanes * 4) // (offsetX, offsetY, scaleX, scaleY)
        this.animationParams = new Float32Array(this.maxPanes * 4) // (phase, speed, tiltMode, visible)

        this.defaultElevation = options.baseElevation !== undefined ? options.baseElevation : 0

        // Tracking
        this.activePanes = 0
        this.atlasInfo = null

        this.initialize()
    }

    /**
     * Initialize the instanced mesh with GPU animation shader
     */
    initialize() {
        // Create plane geometry (centered at origin)
        this.geometry = new THREE.PlaneGeometry(this.baseSize, this.baseSize)

        // Add per-instance attributes for curve control points
        this.geometry.setAttribute(
            'controlPointsPack1',
            new THREE.InstancedBufferAttribute(this.controlPointsPack1, 4)
        )
        this.geometry.setAttribute(
            'controlPointsPack2',
            new THREE.InstancedBufferAttribute(this.controlPointsPack2, 4)
        )
        this.geometry.setAttribute(
            'controlPointsPack3',
            new THREE.InstancedBufferAttribute(this.controlPointsPack3, 4)
        )

        // Add per-instance attributes for rendering
        this.geometry.setAttribute(
            'instanceColor',
            new THREE.InstancedBufferAttribute(this.instanceColors, 3)
        )
        this.geometry.setAttribute(
            'instanceScale',
            new THREE.InstancedBufferAttribute(this.instanceScales, 1)
        )
        this.geometry.setAttribute(
            'instanceElevation',
            new THREE.InstancedBufferAttribute(this.instanceElevations, 1)
        )
        this.geometry.setAttribute(
            'instanceUVTransform',
            new THREE.InstancedBufferAttribute(this.instanceUvTransforms, 4)
        )
        this.geometry.setAttribute(
            'animationParams',
            new THREE.InstancedBufferAttribute(this.animationParams, 4)
        )

        // Create shader material with GPU-side animation
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0.0 },
                baseSize: { value: this.baseSize },
                paneMap: { value: null },
                useTexture: { value: 0.0 },
                returnMode: { value: this.returnModeEnabled ? 1.0 : 0.0 }
            },
            vertexShader,
            fragmentShader,
            side: THREE.DoubleSide,
            transparent: true
        })

        // Create instanced mesh
        this.instancedMesh = new THREE.InstancedMesh(
            this.geometry,
            this.material,
            this.maxPanes
        )

        // Initialize all instances as hidden
        for (let i = 0; i < this.maxPanes; i++) {
            // Initialize colors to white so textures tint correctly
            this.instanceColors[i * 3] = 1.0
            this.instanceColors[i * 3 + 1] = 1.0
            this.instanceColors[i * 3 + 2] = 1.0

            // Initialize scale to 0 (hidden)
            this.instanceScales[i] = 0.0
            this.instanceElevations[i] = this.defaultElevation

            // Initialize animation params (phase, speed, tiltMode, visible)
            this.animationParams[i * 4] = Math.random() // phase
            this.animationParams[i * 4 + 1] = 0.1 // speed
            this.animationParams[i * 4 + 2] = 0.0 // tiltMode (0=perpendicular)
            this.animationParams[i * 4 + 3] = 0.0 // visible (0=hidden)

            // Default UV transform covers entire texture
            const uvIndex = i * 4
            this.instanceUvTransforms[uvIndex] = 0.0
            this.instanceUvTransforms[uvIndex + 1] = 0.0
            this.instanceUvTransforms[uvIndex + 2] = 1.0
            this.instanceUvTransforms[uvIndex + 3] = 1.0

            // Initialize control points to zero
            this.controlPointsPack1[i * 4] = 0
            this.controlPointsPack1[i * 4 + 1] = 0
            this.controlPointsPack1[i * 4 + 2] = 0
            this.controlPointsPack1[i * 4 + 3] = 0

            this.controlPointsPack2[i * 4] = 0
            this.controlPointsPack2[i * 4 + 1] = 0
            this.controlPointsPack2[i * 4 + 2] = 0
            this.controlPointsPack2[i * 4 + 3] = 0

            this.controlPointsPack3[i * 4] = 0
            this.controlPointsPack3[i * 4 + 1] = 0
            this.controlPointsPack3[i * 4 + 2] = 0
            this.controlPointsPack3[i * 4 + 3] = 0
        }

        // Mark all attributes for initial upload
        this.markAllAttributesNeedUpdate()

        // Add to scene
        this.scene.add(this.instancedMesh)
    }

    /**
     * Set curve control points for a pane instance
     * This is called ONCE when creating a flight, not every frame!
     * @param {number} index - Index of the pane
     * @param {Array<THREE.Vector3>} controlPoints - Array of 4 control points
     */
    setCurveControlPoints(index, controlPoints) {
        if (index < 0 || index >= this.maxPanes) return
        if (controlPoints.length < 4) {
            console.warn('PanesShader requires 4 control points')
            return
        }

        // Pack control points into attributes
        // Pack 1: (p0.x, p0.y, p0.z, p1.x)
        this.controlPointsPack1[index * 4] = controlPoints[0].x
        this.controlPointsPack1[index * 4 + 1] = controlPoints[0].y
        this.controlPointsPack1[index * 4 + 2] = controlPoints[0].z
        this.controlPointsPack1[index * 4 + 3] = controlPoints[1].x

        // Pack 2: (p1.y, p1.z, p2.x, p2.y)
        this.controlPointsPack2[index * 4] = controlPoints[1].y
        this.controlPointsPack2[index * 4 + 1] = controlPoints[1].z
        this.controlPointsPack2[index * 4 + 2] = controlPoints[2].x
        this.controlPointsPack2[index * 4 + 3] = controlPoints[2].y

        // Pack 3: (p2.z, p3.x, p3.y, p3.z)
        this.controlPointsPack3[index * 4] = controlPoints[2].z
        this.controlPointsPack3[index * 4 + 1] = controlPoints[3].x
        this.controlPointsPack3[index * 4 + 2] = controlPoints[3].y
        this.controlPointsPack3[index * 4 + 3] = controlPoints[3].z

        // Mark pane as visible
        this.animationParams[index * 4 + 3] = 1.0

        // Mark control point attributes for upload
        this.geometry.attributes.controlPointsPack1.needsUpdate = true
        this.geometry.attributes.controlPointsPack2.needsUpdate = true
        this.geometry.attributes.controlPointsPack3.needsUpdate = true
        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Enable or disable return flight mode for all panes
     */
    setReturnMode(enabled) {
        this.returnModeEnabled = !!enabled
        if (this.material && this.material.uniforms && this.material.uniforms.returnMode) {
            this.material.uniforms.returnMode.value = this.returnModeEnabled ? 1.0 : 0.0
        }
    }

    /**
     * Set the color of a specific pane
     */
    setPaneColor(index, color) {
        if (index < 0 || index >= this.maxPanes) return

        const c = color instanceof THREE.Color ? color : new THREE.Color(color)
        this.instanceColors[index * 3] = c.r
        this.instanceColors[index * 3 + 1] = c.g
        this.instanceColors[index * 3 + 2] = c.b

        this.geometry.attributes.instanceColor.needsUpdate = true
    }

    /**
     * Set the size of a specific pane
     */
    setPaneSize(index, size) {
        if (index < 0 || index >= this.maxPanes) return

        const normalizedScale = size / this.baseSize
        this.instanceScales[index] = normalizedScale

        this.geometry.attributes.instanceScale.needsUpdate = true
    }

    /**
     * Set elevation offset (distance above curve) for a pane
     */
    setElevationOffset(index, offset) {
        if (index < 0 || index >= this.maxPanes) return

        this.instanceElevations[index] = offset
        if (this.geometry && this.geometry.attributes.instanceElevation) {
            this.geometry.attributes.instanceElevation.needsUpdate = true
        }
    }

    /**
     * Set animation speed for a specific pane
     */
    setAnimationSpeed(index, speed) {
        if (index < 0 || index >= this.maxPanes) return

        const baseIndex = index * 4
        const oldSpeed = this.animationParams[baseIndex + 1]
        const oldPhase = this.animationParams[baseIndex]

        const timeUniform = this.material && this.material.uniforms && this.material.uniforms.time
            ? this.material.uniforms.time.value
            : 0

        let currentProgress = timeUniform * oldSpeed + oldPhase
        currentProgress = currentProgress - Math.floor(currentProgress)

        this.animationParams[baseIndex + 1] = speed

        let newPhase = currentProgress - timeUniform * speed
        newPhase = newPhase - Math.floor(newPhase)
        this.animationParams[baseIndex] = newPhase

        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Set tilt mode for a specific pane
     * @param {number} index - Index of the pane
     * @param {string} mode - 'Perpendicular' or 'Tangent'
     */
    setTiltMode(index, mode) {
        if (index < 0 || index >= this.maxPanes) return

        const tiltModeValue = mode === 'Tangent' ? 1.0 : 0.0
        this.animationParams[index * 4 + 2] = tiltModeValue

        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Hide a specific pane
     */
    hidePane(index) {
        if (index < 0 || index >= this.maxPanes) return

        this.animationParams[index * 4 + 3] = 0.0 // visible = false

        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Update time uniform - called once per frame
     * This is the ONLY method that needs to be called every frame!
     */
    update(deltaTime) {
        if (!this.material || !this.material.uniforms) return

        this.material.uniforms.time.value += deltaTime
    }

    /**
     * Set the number of active panes
     */
    setActivePaneCount(count) {
        this.activePanes = Math.min(count, this.maxPanes)
    }

    /**
     * Get the number of pane instances
     */
    getCount() {
        return this.maxPanes
    }

    /**
     * Enable or disable textured rendering for panes
     * @param {THREE.Texture|null} texture - Texture to apply or null to disable
     */
    setTexture(texture, atlasInfo = null) {
        if (!this.material || !this.material.uniforms) return

        this.material.uniforms.paneMap.value = texture
        this.material.uniforms.useTexture.value = texture ? 1.0 : 0.0

        if (texture) {
            texture.needsUpdate = true
        }
        this.material.needsUpdate = true

        if (texture && atlasInfo) {
            this.atlasInfo = {
                columns: atlasInfo.columns,
                rows: atlasInfo.rows,
                count: atlasInfo.count,
                scaleX: atlasInfo.scale?.x ?? 1,
                scaleY: atlasInfo.scale?.y ?? 1
            }
        } else {
            this.atlasInfo = null
        }
    }

    setTextureIndex(index, textureIndex = 0) {
        if (index < 0 || index >= this.maxPanes) return

        const uvIndex = index * 4
        if (this.atlasInfo) {
            const columns = Math.max(1, this.atlasInfo.columns || 1)
            const rows = Math.max(1, this.atlasInfo.rows || 1)
            const totalSlots = columns * rows
            const count = Math.max(1, this.atlasInfo.count || totalSlots)
            const slot = ((textureIndex % count) + count) % count
            const safeSlot = slot % totalSlots
            const col = safeSlot % columns
            const row = Math.floor(safeSlot / columns)
            const scaleX = this.atlasInfo.scaleX || (1 / columns)
            const scaleY = this.atlasInfo.scaleY || (1 / rows)
            const offsetX = col * scaleX
            const offsetY = row * scaleY
            this.instanceUvTransforms[uvIndex] = offsetX
            this.instanceUvTransforms[uvIndex + 1] = offsetY
            this.instanceUvTransforms[uvIndex + 2] = scaleX
            this.instanceUvTransforms[uvIndex + 3] = scaleY
        } else {
            this.instanceUvTransforms[uvIndex] = 0.0
            this.instanceUvTransforms[uvIndex + 1] = 0.0
            this.instanceUvTransforms[uvIndex + 2] = 1.0
            this.instanceUvTransforms[uvIndex + 3] = 1.0
        }

        if (this.geometry && this.geometry.attributes.instanceUVTransform) {
            this.geometry.attributes.instanceUVTransform.needsUpdate = true
        }
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
    }

    /**
     * Check if merged panes exist
     */
    exists() {
        return this.instancedMesh !== null
    }

    /**
     * Get max panes
     */
    getMaxPanes() {
        return this.maxPanes
    }

    /**
     * Mark all attributes for GPU upload
     */
    markAllAttributesNeedUpdate() {
        if (!this.geometry) return

        if (this.geometry.attributes.controlPointsPack1) {
            this.geometry.attributes.controlPointsPack1.needsUpdate = true
        }
        if (this.geometry.attributes.controlPointsPack2) {
            this.geometry.attributes.controlPointsPack2.needsUpdate = true
        }
        if (this.geometry.attributes.controlPointsPack3) {
            this.geometry.attributes.controlPointsPack3.needsUpdate = true
        }
        if (this.geometry.attributes.instanceColor) {
            this.geometry.attributes.instanceColor.needsUpdate = true
        }
        if (this.geometry.attributes.instanceScale) {
            this.geometry.attributes.instanceScale.needsUpdate = true
        }
        if (this.geometry.attributes.instanceElevation) {
            this.geometry.attributes.instanceElevation.needsUpdate = true
        }
        if (this.geometry.attributes.instanceUVTransform) {
            this.geometry.attributes.instanceUVTransform.needsUpdate = true
        }
        if (this.geometry.attributes.animationParams) {
            this.geometry.attributes.animationParams.needsUpdate = true
        }
    }
}

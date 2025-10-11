import * as THREE from 'three'

/**
 * GPUPane uses instanced rendering for high-performance visualization of multiple panes.
 * Each pane can be positioned independently and efficiently rendered in a single draw call.
 */
export class GPUPane {
    constructor(scene, options = {}) {
        this.scene = scene
        this.instancedMesh = null
        this.count = options.count || 1
        this.paneSize = options.paneSize || 100
        this.color = options.color || 0xff6666

        // Store individual pane data
        this.paneData = []
    }

    /**
     * Creates the instanced mesh for rendering multiple panes
     */
    create() {
        // Create plane geometry (centered at origin)
        const geometry = new THREE.PlaneGeometry(this.paneSize, this.paneSize)

        // Create material
        const material = new THREE.MeshLambertMaterial({
            color: this.color,
            side: THREE.DoubleSide
        })

        // Create instanced mesh
        this.instancedMesh = new THREE.InstancedMesh(
            geometry,
            material,
            this.count
        )

        // Initialize pane data array
        for (let i = 0; i < this.count; i++) {
            this.paneData.push({
                position: new THREE.Vector3(),
                previousPosition: new THREE.Vector3(),
                quaternion: new THREE.Quaternion(),
                scale: new THREE.Vector3(1, 1, 1)
            })
        }

        // Initialize all instances to identity transform
        const matrix = new THREE.Matrix4()
        for (let i = 0; i < this.count; i++) {
            matrix.identity()
            this.instancedMesh.setMatrixAt(i, matrix)
        }
        this.instancedMesh.instanceMatrix.needsUpdate = true

        // Add to scene
        this.scene.add(this.instancedMesh)

        return this.instancedMesh
    }

    /**
     * Update a specific pane instance with position and orientation
     * @param {number} index - The index of the pane to update
     * @param {THREE.Vector3} position - The new position
     * @param {THREE.Vector3} nextPosition - The next position (optional, for forward direction calculation)
     * @param {THREE.Vector3} up - Optional up vector (defaults to world up)
     */
    updatePane(index, position, nextPosition = null, up = new THREE.Vector3(0, 1, 0)) {
        if (index < 0 || index >= this.count || !this.instancedMesh) return

        const pane = this.paneData[index]

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

        // Calculate orientation: pane's normal (Z-axis) should align with forward direction
        // For a PlaneGeometry, the normal points along the Z-axis by default

        // Compute right vector (X-axis) - perpendicular to both forward and up
        const right = new THREE.Vector3().crossVectors(up, forward).normalize()

        // Recompute up vector (Y-axis) - perpendicular to both forward and right
        // This ensures a proper orthonormal basis
        const newUp = new THREE.Vector3().crossVectors(forward, right).normalize()

        // Create rotation matrix: [right, newUp, forward] maps to [X, Y, Z] axes
        // This makes the pane's Z-axis (normal) point in the forward direction
        const rotationMatrix = new THREE.Matrix4()
        rotationMatrix.makeBasis(right, newUp, forward)

        // Extract quaternion from rotation matrix
        pane.quaternion.setFromRotationMatrix(rotationMatrix)

        // Compose final matrix
        const matrix = new THREE.Matrix4()
        matrix.compose(pane.position, pane.quaternion, pane.scale)

        // Update instance
        this.instancedMesh.setMatrixAt(index, matrix)
        this.instancedMesh.instanceMatrix.needsUpdate = true
    }

    /**
     * Update a pane with curve position parameter
     * @param {number} index - The index of the pane to update
     * @param {Object} curve - A curve object with getPointAt and getTangentAt methods
     * @param {number} t - Parameter along curve (0 to 1)
     * @param {number} lookAheadDelta - How far ahead to look for forward direction (default 0.001)
     */
    updatePaneOnCurve(index, curve, t, lookAheadDelta = 0.001) {
        if (!curve || !curve.exists || !curve.exists()) return

        // Get current position
        const position = curve.getPointAt(t)

        // Get next position (look slightly ahead on the curve)
        const nextT = Math.min(1.0, t + lookAheadDelta)
        const nextPosition = curve.getPointAt(nextT)

        // Update pane with actual movement direction
        this.updatePane(index, position, nextPosition)
    }

    /**
     * Set the color of all panes
     */
    setColor(color) {
        this.color = color
        if (this.instancedMesh) {
            this.instancedMesh.material.color.set(color)
        }
    }

    /**
     * Update the size of all panes (requires recreating geometry)
     */
    setSize(size) {
        if (this.paneSize === size || !this.instancedMesh) return

        this.paneSize = size

        // Dispose old geometry
        this.instancedMesh.geometry.dispose()

        // Create new geometry with updated size
        const geometry = new THREE.PlaneGeometry(size, size)
        this.instancedMesh.geometry = geometry
    }

    /**
     * Set scale for a specific pane instance
     */
    setScale(index, scale) {
        if (index < 0 || index >= this.count) return

        const pane = this.paneData[index]
        if (typeof scale === 'number') {
            pane.scale.setScalar(scale)
        } else {
            pane.scale.copy(scale)
        }

        // Update matrix
        const matrix = new THREE.Matrix4()
        matrix.compose(pane.position, pane.quaternion, pane.scale)
        this.instancedMesh.setMatrixAt(index, matrix)
        this.instancedMesh.instanceMatrix.needsUpdate = true
    }

    /**
     * Get the number of pane instances
     */
    getCount() {
        return this.count
    }

    /**
     * Remove from scene and cleanup
     */
    remove() {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh)
            this.instancedMesh.geometry.dispose()
            this.instancedMesh.material.dispose()
            this.instancedMesh = null
        }
        this.paneData = []
    }

    /**
     * Check if the pane exists
     */
    exists() {
        return this.instancedMesh !== null
    }
}

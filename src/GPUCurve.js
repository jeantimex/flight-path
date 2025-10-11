import * as THREE from 'three'

/**
 * GPUCurve uses instanced rendering for high-performance curve visualization.
 * This approach is optimized for rendering many curves efficiently by batching
 * all curve segments into a single draw call using InstancedMesh.
 */
export class GPUCurve {
    constructor(scene, options = {}) {
        this.scene = scene
        this.curve = null
        this.instancedMesh = null
        this.controlPoints = options.controlPoints || []
        this.segmentCount = options.segmentCount || 100
        this.lineWidth = options.lineWidth || 2.0
        this.color = options.color || 0x4488ff
    }

    /**
     * Creates the curve and its GPU-instanced visualization
     */
    create() {
        // Create 3D spline curve using CatmullRomCurve3
        this.curve = new THREE.CatmullRomCurve3(this.controlPoints)

        // Get points along the curve
        const points = this.curve.getPoints(this.segmentCount)

        // Create instanced mesh for all segments
        this._createInstancedMesh(points)

        return this.curve
    }

    /**
     * Creates an instanced mesh to render all curve segments efficiently
     * @private
     */
    _createInstancedMesh(points) {
        if (points.length < 2) return

        // Create a cylinder geometry for each segment (oriented along Y-axis by default)
        const segmentGeometry = new THREE.CylinderGeometry(
            this.lineWidth,  // radiusTop
            this.lineWidth,  // radiusBottom
            1.0,             // height (will be scaled per instance)
            8,               // radialSegments (keep low for performance)
            1,               // heightSegments
            false            // openEnded
        )

        // Create material (MeshBasicMaterial doesn't need lighting)
        const material = new THREE.MeshBasicMaterial({
            color: this.color
        })

        // Create instanced mesh for all segments
        const instanceCount = points.length - 1
        this.instancedMesh = new THREE.InstancedMesh(
            segmentGeometry,
            material,
            instanceCount
        )

        // Position and orient each instance
        const matrix = new THREE.Matrix4()
        const position = new THREE.Vector3()
        const quaternion = new THREE.Quaternion()
        const scale = new THREE.Vector3()
        const direction = new THREE.Vector3()
        const up = new THREE.Vector3(0, 1, 0)

        for (let i = 0; i < instanceCount; i++) {
            const start = points[i]
            const end = points[i + 1]

            // Calculate segment center
            position.lerpVectors(start, end, 0.5)

            // Calculate segment direction and length
            direction.subVectors(end, start)
            const length = direction.length()
            direction.normalize()

            // Create quaternion to rotate from Y-axis to direction
            quaternion.setFromUnitVectors(up, direction)

            // Set scale (only scale Y-axis for length)
            scale.set(1, length, 1)

            // Compose matrix
            matrix.compose(position, quaternion, scale)

            // Set instance matrix
            this.instancedMesh.setMatrixAt(i, matrix)
        }

        // Important: update the instance matrix
        this.instancedMesh.instanceMatrix.needsUpdate = true

        // Add to scene
        this.scene.add(this.instancedMesh)
    }

    /**
     * Updates the curve with new control points and recreates the visualization
     */
    update(controlPoints) {
        // Remove old mesh
        this.remove()

        // Update control points
        this.controlPoints = controlPoints

        // Recreate
        this.create()
    }

    /**
     * Get position at parameter t (0 to 1)
     */
    getPointAt(t) {
        return this.curve ? this.curve.getPointAt(t) : new THREE.Vector3()
    }

    /**
     * Get tangent vector at parameter t (0 to 1)
     */
    getTangentAt(t) {
        return this.curve ? this.curve.getTangentAt(t) : new THREE.Vector3(0, 0, 1)
    }

    /**
     * Get the actual curve object
     */
    getCurve() {
        return this.curve
    }

    /**
     * Remove curve visualization from scene
     */
    remove() {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh)
            this.instancedMesh.geometry.dispose()
            this.instancedMesh.material.dispose()
            this.instancedMesh = null
        }
        this.curve = null
    }

    /**
     * Check if curve exists
     */
    exists() {
        return this.curve !== null
    }

    /**
     * Update color of the curve
     */
    setColor(color) {
        this.color = color
        if (this.instancedMesh) {
            this.instancedMesh.material.color.set(color)
        }
    }

    /**
     * Update line width (requires recreating the mesh)
     */
    setLineWidth(width) {
        if (this.lineWidth === width) return

        this.lineWidth = width

        // Recreate with new width if curve exists
        if (this.curve) {
            const points = this.curve.getPoints(this.segmentCount)
            this.remove()
            this.curve = new THREE.CatmullRomCurve3(this.controlPoints)
            this._createInstancedMesh(points)
        }
    }
}

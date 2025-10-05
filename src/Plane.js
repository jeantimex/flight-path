import * as THREE from 'three'

export class Plane {
    constructor(scene) {
        this.scene = scene
        this.mesh = null
        this.baseScale = 1
    }

    // Abstract method to be implemented by subclasses
    async load() {
        throw new Error('load() method must be implemented by subclass')
    }

    // Common method to create fallback cube
    createFallbackCube(color = 0xff6666) {
        const geometry = new THREE.BoxGeometry(100, 100, 100)
        const material = new THREE.MeshBasicMaterial({ color: color })
        this.mesh = new THREE.Mesh(geometry, material)
        this.scene.add(this.mesh)
    }

    // Common method to remove mesh from scene
    remove() {
        if (this.mesh) {
            this.scene.remove(this.mesh)
            this.mesh = null
        }
    }

    // Common method to get mesh
    getMesh() {
        return this.mesh
    }

    // Common method to set scale
    setScale(scale) {
        if (this.mesh) {
            this.mesh.scale.setScalar(this.baseScale * scale)
        }
    }

    // Helper method to set base scale (to be called by subclasses)
    setBaseScale(baseScale) {
        this.baseScale = baseScale
        if (this.mesh) {
            this.mesh.scale.setScalar(baseScale)
        }
    }

    // Method to update plane position and orientation along curve
    // To be overridden by subclasses for specific behavior
    updatePositionAndOrientation(curve, planeSize, t) {
        if (!this.mesh || !curve || !curve.exists()) return

        this.setScale(planeSize)

        // Get current position on curve
        const position = curve.getPointAt(t)

        // Get tangent vector at current position (direction of movement)
        const tangent = curve.getTangentAt(t).normalize()

        // Create a proper orientation matrix
        // We want the plane's forward direction to align with the tangent
        const up = new THREE.Vector3(0, 1, 0) // World up vector
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize()
        const newUp = new THREE.Vector3().crossVectors(right, tangent).normalize()

        // Set position
        this.mesh.position.copy(position)

        // Create and apply rotation matrix
        const rotationMatrix = new THREE.Matrix4()
        rotationMatrix.makeBasis(right, newUp, tangent.clone().negate())
        this.mesh.setRotationFromMatrix(rotationMatrix)

        // Subclasses should override to add specific rotations/offsets
        // They can access position, tangent, up, right, newUp, planeSize as needed
    }
}
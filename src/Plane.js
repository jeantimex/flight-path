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
}
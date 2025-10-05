import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export class GLBPlane {
    constructor(scene) {
        this.scene = scene
        this.loader = new GLTFLoader()
        this.mesh = null
    }

    async load() {
        return new Promise((resolve, reject) => {
            this.loader.load('/src/plane.glb', (gltf) => {
                this.mesh = gltf.scene
                this.mesh.scale.set(50, 50, 50)
                this.scene.add(this.mesh)
                console.log('GLB plane loaded successfully')
                resolve(this.mesh)
            }, (progress) => {
                console.log('Loading GLB progress:', (progress.loaded / progress.total * 100) + '%')
            }, (error) => {
                console.error('Error loading GLB plane:', error)
                // Create fallback cube
                this.createFallbackCube()
                resolve(this.mesh)
            })
        })
    }

    createFallbackCube() {
        const geometry = new THREE.BoxGeometry(100, 100, 100)
        const material = new THREE.MeshBasicMaterial({ color: 0xff6666 })
        this.mesh = new THREE.Mesh(geometry, material)
        this.scene.add(this.mesh)
        console.log('Using fallback cube for GLB plane')
    }

    remove() {
        if (this.mesh) {
            this.scene.remove(this.mesh)
            this.mesh = null
        }
    }

    getMesh() {
        return this.mesh
    }

    setScale(scale) {
        if (this.mesh) {
            // GLB plane base scale is 50, so multiply by the scale factor
            const baseScale = 50
            this.mesh.scale.setScalar(baseScale * scale)
        }
    }
}
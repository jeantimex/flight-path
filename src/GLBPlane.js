import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Plane } from './Plane.js'

export class GLBPlane extends Plane {
    constructor(scene) {
        super(scene)
        this.loader = new GLTFLoader()
        // this.setBaseScale(100) // GLB plane base scale
    }

    async load() {
        return new Promise((resolve, reject) => {
            this.loader.load('/src/plane.glb', (gltf) => {
                this.mesh = gltf.scene
                this.setBaseScale(50) // Apply base scale
                this.scene.add(this.mesh)
                resolve(this.mesh)
            }, (progress) => {
            }, (error) => {
                console.error('Error loading GLB plane:', error)
                // Create fallback cube with red color
                this.createFallbackCube(0xff6666)
                resolve(this.mesh)
            })
        })
    }

    // Override to add GLB-specific rotation
    updatePositionAndOrientation(curve, planeSize, t) {
        // Call parent method first
        super.updatePositionAndOrientation(curve, planeSize, t)

        // Apply GLB-specific rotation
        if (this.mesh) {
            this.mesh.rotateY(Math.PI)
        }
    }

}
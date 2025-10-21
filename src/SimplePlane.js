import * as THREE from 'three'
import { Plane } from './Plane.js'

export class SimplePlane extends Plane {
    constructor(scene) {
        super(scene)
        this.baseScale = 80
    }

    async load() {
        try {
            const geometry = this.createGeometry()
            geometry.computeVertexNormals()

            const material = new THREE.MeshBasicMaterial({
                color: 0x4488ff,
                side: THREE.DoubleSide
            })

            const mesh = new THREE.Mesh(geometry, material)
            mesh.frustumCulled = false

            this.scene.add(mesh)
            this.setMesh(mesh)

            return mesh
        } catch (error) {
            console.error('Error creating simple plane mesh:', error)
            this.createFallbackCube()
            return this.mesh
        }
    }

    createGeometry() {
        // Define a simple plane silhouette using triangles pointing along -Z
        const vertices = new Float32Array([
            // Nose
            0, 0, -1.5,
            -0.6, 0, 1.0,
            0.6, 0, 1.0,
            // Left wing
            0, 0, -0.4,
            -1.3, 0, 0.2,
            -0.2, 0, 0.2,
            // Right wing
            0, 0, -0.4,
            0.2, 0, 0.2,
            1.3, 0, 0.2,
            // Tail
            0, 0, 0.7,
            -0.3, 0.3, 1.5,
            0.3, 0.3, 1.5
        ])

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        return geometry
    }
}

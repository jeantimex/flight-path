import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { Plane } from './Plane.js'

export class SVGPlane extends Plane {
    constructor(scene) {
        super(scene)
        this.loader = new SVGLoader()
        this.setBaseScale(5) // SVG plane base scale
    }

    async load() {
        return new Promise((resolve, reject) => {
            this.loader.load('/src/plane8.svg', (data) => {
                const paths = data.paths
                const group = new THREE.Group()

                for (let i = 0; i < paths.length; i++) {
                    const path = paths[i]

                    // Use original SVG colors or default
                    let color = 0x4488ff // default blue
                    if (path.userData && path.userData.style) {
                        const fill = path.userData.style.fill
                        if (fill && fill !== 'none') {
                            color = new THREE.Color(fill)
                        }
                    }

                    const material = new THREE.MeshLambertMaterial({
                        color: color,
                        side: THREE.DoubleSide
                    })

                    const shapes = SVGLoader.createShapes(path)

                    for (let j = 0; j < shapes.length; j++) {
                        const shape = shapes[j]

                        // Create flat geometry - no extrusion, just a thin plane
                        const geometry = new THREE.ShapeGeometry(shape)
                        const mesh3d = new THREE.Mesh(geometry, material)
                        group.add(mesh3d)
                    }
                }

                // Just center the group normally - offset will be handled in animation
                const box = new THREE.Box3().setFromObject(group)
                const center = box.getCenter(new THREE.Vector3())

                group.position.sub(center)

                this.scene.add(group)
                this.mesh = group
                this.setBaseScale(5) // Apply base scale
                resolve(this.mesh)

            }, (progress) => {
            }, (error) => {
                console.error('Error loading SVG plane:', error)
                // Create fallback cube with green color
                this.createFallbackCube(0x00ff00)
                resolve(this.mesh)
            })
        })
    }
}
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'

export class SVGPlane {
    constructor(scene) {
        this.scene = scene
        this.loader = new SVGLoader()
        this.mesh = null
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

                // Scale and orient the SVG group
                group.scale.set(5, 5, 5) // Slightly larger scale
                // Adjust rotation so the plane's nose points forward along the curve
                // group.rotateX(-Math.PI / 2)
                // group.rotateY(Math.PI / 2)
                // group.rotateZ(0) // Rotate 90 degrees counterclockwise to make head point forward

                // Just center the group normally - offset will be handled in animation
                const box = new THREE.Box3().setFromObject(group)
                const center = box.getCenter(new THREE.Vector3())

                group.position.sub(center)

                this.scene.add(group)
                this.mesh = group
                console.log('SVG plane loaded successfully')
                resolve(this.mesh)

            }, (progress) => {
                console.log('Loading SVG progress:', (progress.loaded / progress.total * 100) + '%')
            }, (error) => {
                console.error('Error loading SVG plane:', error)
                this.createFallbackCube()
                resolve(this.mesh)
            })
        })
    }

    createFallbackCube() {
        const geometry = new THREE.BoxGeometry(100, 100, 100)
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 })
        this.mesh = new THREE.Mesh(geometry, material)
        this.scene.add(this.mesh)
        console.log('Using fallback cube for SVG plane')
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
            // SVG plane base scale is 5, so multiply by the scale factor
            const baseScale = 5
            this.mesh.scale.setScalar(baseScale * scale)
        }
    }
}
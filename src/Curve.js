import * as THREE from 'three'

export class Curve {
    constructor(scene) {
        this.scene = scene
        this.curve = null
        this.line = null
    }

    // Create the 3D spline curve and visualization
    create() {
        // Create 3D spline curve using CatmullRomCurve3
        this.curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-1000, -5000, -5000),
            new THREE.Vector3(1000, 0, 0),
            new THREE.Vector3(800, 5000, 5000),
            new THREE.Vector3(-500, 0, 10000)
        ])

        // Get 100 points along the curve
        const points = this.curve.getPoints(100)

        // Create line geometry for the curve visualization
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4488ff })
        this.line = new THREE.Line(lineGeometry, lineMaterial)
        this.scene.add(this.line)

        return this.curve
    }

    // Get position at parameter t (0 to 1)
    getPointAt(t) {
        return this.curve ? this.curve.getPointAt(t) : new THREE.Vector3()
    }

    // Get tangent vector at parameter t (0 to 1)
    getTangentAt(t) {
        return this.curve ? this.curve.getTangentAt(t) : new THREE.Vector3(0, 0, 1)
    }

    // Get the actual curve object
    getCurve() {
        return this.curve
    }

    // Remove curve visualization from scene
    remove() {
        if (this.line) {
            this.scene.remove(this.line)
            this.line = null
        }
        this.curve = null
    }

    // Check if curve exists
    exists() {
        return this.curve !== null
    }
}
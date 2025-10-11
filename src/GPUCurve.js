import * as THREE from 'three'

export class GPUCurve {
    constructor(scene, options = {}) {
        this.scene = scene
        this.controlPoints = options.controlPoints || []
        this.curve = null
        this.instancedMesh = null
        this.line = null
        this.numPoints = 100 // Number of points to draw the curve
    }

    // Create the 3D spline curve and visualization (matches Curve.js API)
    create() {
        // Create 3D spline curve using CatmullRomCurve3
        this.curve = new THREE.CatmullRomCurve3(this.controlPoints)

        this.createInstancedMesh()
        this.createCurveLine()

        return this.curve
    }

    createInstancedMesh() {
        if (this.controlPoints.length < 4) {
            console.warn('GPUCurve needs at least 4 control points')
            return
        }

        // Create shared geometry - small sphere for each curve point
        const geometry = new THREE.SphereGeometry(20, 8, 6)

        // Create shader material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0x4488ff) }
            },
            vertexShader: `
                // Pre-computed curve position for each sphere
                attribute vec3 curvePosition;

                uniform vec3 color;

                varying vec3 vColor;

                void main() {
                    vColor = color;

                    // Use pre-computed curve position directly
                    vec4 worldPosition = vec4(curvePosition + position, 1.0);

                    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    gl_FragColor = vec4(vColor, 1.0);
                }
            `,
            side: THREE.DoubleSide
        })

        // Create instanced mesh
        this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.numPoints)

        // Add curve position attribute
        geometry.setAttribute('curvePosition', new THREE.InstancedBufferAttribute(new Float32Array(this.numPoints * 3), 3))

        this.setupCurveData()
        this.scene.add(this.instancedMesh)
    }

    createCurveLine() {
        if (this.controlPoints.length < 4 || !this.curve) return

        // Get 100 points along the curve (matches Curve.js)
        const points = this.curve.getPoints(this.numPoints)

        // Create line geometry for the curve visualization (matches Curve.js)
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4488ff })
        this.line = new THREE.Line(lineGeometry, lineMaterial)
        this.scene.add(this.line)
    }

    setupCurveData() {
        if (!this.instancedMesh || !this.curve) return

        // Use the same curve as the line
        const points = this.curve.getPoints(this.numPoints)

        const geometry = this.instancedMesh.geometry
        const positionAttr = geometry.attributes.curvePosition

        // Set each sphere's position to the exact curve point
        for (let i = 0; i < this.numPoints; i++) {
            const point = points[i]
            positionAttr.setXYZ(i, point.x, point.y, point.z)
        }

        // Mark attribute for update
        positionAttr.needsUpdate = true
    }

    // Update curve with new control points
    updateControlPoints(controlPoints) {
        this.controlPoints = controlPoints

        // Recreate the curve
        this.curve = new THREE.CatmullRomCurve3(this.controlPoints)

        // Update instanced spheres
        if (this.instancedMesh) {
            this.setupCurveData()
        }

        // Update curve line
        if (this.line) {
            this.scene.remove(this.line)
            this.createCurveLine()
        }
    }

    // Get position at parameter t (0 to 1) - matches Curve.js API
    getPointAt(t) {
        return this.curve ? this.curve.getPointAt(t) : new THREE.Vector3()
    }

    // Get tangent vector at parameter t (0 to 1) - matches Curve.js API
    getTangentAt(t) {
        return this.curve ? this.curve.getTangentAt(t) : new THREE.Vector3(0, 0, 1)
    }

    // Get the actual curve object - matches Curve.js API
    getCurve() {
        return this.curve
    }

    // Remove curve visualization from scene - matches Curve.js API
    remove() {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh)
            this.instancedMesh = null
        }
        if (this.line) {
            this.scene.remove(this.line)
            this.line = null
        }
        this.curve = null
    }

    // Check if curve exists - matches Curve.js API
    exists() {
        return this.curve !== null
    }

    getMesh() {
        return this.instancedMesh
    }
}
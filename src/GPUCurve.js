import * as THREE from 'three'

export class GPUCurve {
    constructor(scene, options = {}) {
        this.scene = scene
        this.controlPoints = options.controlPoints || []
        this.instancedMesh = null
        this.curveLine = null
        this.numPoints = 100 // Number of points to draw the curve

        this.createInstancedMesh()
        this.createCurveLine()
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
        if (this.controlPoints.length < 4) return

        // Create curve using Three.js CatmullRomCurve3
        const curve = new THREE.CatmullRomCurve3(this.controlPoints)
        const points = curve.getPoints(this.numPoints)

        // Create line geometry
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x4488ff,
            linewidth: 2
        })

        this.curveLine = new THREE.Line(lineGeometry, lineMaterial)
        this.scene.add(this.curveLine)
    }

    setupCurveData() {
        if (!this.instancedMesh || this.controlPoints.length < 4) return

        // Use the same curve calculation as the line
        const curve = new THREE.CatmullRomCurve3(this.controlPoints)
        const points = curve.getPoints(this.numPoints)

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

        // Update instanced spheres
        if (this.instancedMesh) {
            this.setupCurveData()
        }

        // Update curve line
        if (this.curveLine) {
            this.scene.remove(this.curveLine)
            this.createCurveLine()
        }
    }

    // Get position at parameter t (0 to 1) - for compatibility with original Curve class
    getPointAt(t) {
        if (this.controlPoints.length < 4) return new THREE.Vector3()

        // Use Three.js CatmullRomCurve3 for compatibility
        const curve = new THREE.CatmullRomCurve3(this.controlPoints)
        return curve.getPointAt(t)
    }

    // Get tangent vector at parameter t (0 to 1)
    getTangentAt(t) {
        if (this.controlPoints.length < 4) return new THREE.Vector3(0, 0, 1)

        const curve = new THREE.CatmullRomCurve3(this.controlPoints)
        return curve.getTangentAt(t)
    }

    // Remove curve visualization from scene
    remove() {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh)
            this.instancedMesh = null
        }
        if (this.curveLine) {
            this.scene.remove(this.curveLine)
            this.curveLine = null
        }
    }

    // Check if curve exists
    exists() {
        return this.instancedMesh !== null && this.controlPoints.length >= 4
    }

    getMesh() {
        return this.instancedMesh
    }
}
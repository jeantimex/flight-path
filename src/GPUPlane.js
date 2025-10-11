import * as THREE from 'three'

export class GPUPlane {
    constructor(scene, maxCount = 100) {
        this.scene = scene
        this.maxCount = maxCount
        this.instancedMesh = null
        this.activeCount = 1 // Start with one plane

        // Flight path data arrays
        this.flightControlPoints = new Float32Array(maxCount * 12) // 4 control points * 3 coords
        this.flightDurations = new Float32Array(maxCount)
        this.flightPhases = new Float32Array(maxCount)

        this.createInstancedMesh()
    }

    createInstancedMesh() {
        // Create shared geometry
        const geometry = new THREE.PlaneGeometry(100, 100)

        // Create shader material with GPU animation
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0.0 },
                planeTexture: { value: this.createPlaneTexture() }
            },
            vertexShader: `
                // Flight path control points (4 points, 3 coords each = 12 floats)
                attribute vec3 controlPoint0;
                attribute vec3 controlPoint1;
                attribute vec3 controlPoint2;
                attribute vec3 controlPoint3;
                attribute float flightDuration;
                attribute float flightPhase;

                uniform float time;

                varying vec2 vUv;

                // CatmullRom curve evaluation
                vec3 evaluateCatmullRom(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
                    float t2 = t * t;
                    float t3 = t2 * t;

                    return 0.5 * (
                        (2.0 * p1) +
                        (-p0 + p2) * t +
                        (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
                        (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
                    );
                }

                // Get tangent vector for CatmullRom curve
                vec3 getCatmullRomTangent(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
                    float t2 = t * t;

                    return 0.5 * (
                        (-p0 + p2) +
                        2.0 * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t +
                        3.0 * (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t2
                    );
                }

                // Create rotation matrix to align plane with flight direction
                mat4 createOrientationMatrix(vec3 forward) {
                    vec3 zAxis = normalize(forward);
                    vec3 up = vec3(0.0, 1.0, 0.0);
                    vec3 xAxis = normalize(cross(up, zAxis));
                    vec3 yAxis = normalize(cross(zAxis, xAxis));

                    return mat4(
                        xAxis.x, yAxis.x, zAxis.x, 0.0,
                        xAxis.y, yAxis.y, zAxis.y, 0.0,
                        xAxis.z, yAxis.z, zAxis.z, 0.0,
                        0.0, 0.0, 0.0, 1.0
                    );
                }

                void main() {
                    vUv = uv;

                    // Calculate animation progress
                    float animTime = time * 0.1 + flightPhase;
                    float t = mod(animTime / flightDuration, 1.0);

                    // Evaluate position along curve
                    vec3 currentPosition = evaluateCatmullRom(controlPoint0, controlPoint1, controlPoint2, controlPoint3, t);

                    // Get tangent for orientation
                    vec3 tangent = normalize(getCatmullRomTangent(controlPoint0, controlPoint1, controlPoint2, controlPoint3, t));

                    // Create orientation matrix
                    mat4 rotationMatrix = createOrientationMatrix(tangent);

                    // Apply 90-degree rotation for proper plane alignment
                    mat4 modelAlignment = mat4(
                        1.0, 0.0, 0.0, 0.0,
                        0.0, 0.0, -1.0, 0.0,
                        0.0, 1.0, 0.0, 0.0,
                        0.0, 0.0, 0.0, 1.0
                    );
                    rotationMatrix = rotationMatrix * modelAlignment;

                    // Transform vertex
                    vec4 worldPosition = vec4(currentPosition, 1.0) + rotationMatrix * vec4(position, 0.0);

                    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D planeTexture;
                varying vec2 vUv;

                void main() {
                    vec4 texColor = texture2D(planeTexture, vUv);
                    gl_FragColor = vec4(0.3, 0.6, 1.0, texColor.a); // Blue color with texture alpha
                }
            `,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false
        })

        // Create instanced mesh
        this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxCount)

        // Add flight path attributes
        geometry.setAttribute('controlPoint0', new THREE.InstancedBufferAttribute(new Float32Array(this.maxCount * 3), 3))
        geometry.setAttribute('controlPoint1', new THREE.InstancedBufferAttribute(new Float32Array(this.maxCount * 3), 3))
        geometry.setAttribute('controlPoint2', new THREE.InstancedBufferAttribute(new Float32Array(this.maxCount * 3), 3))
        geometry.setAttribute('controlPoint3', new THREE.InstancedBufferAttribute(new Float32Array(this.maxCount * 3), 3))
        geometry.setAttribute('flightDuration', new THREE.InstancedBufferAttribute(this.flightDurations, 1))
        geometry.setAttribute('flightPhase', new THREE.InstancedBufferAttribute(this.flightPhases, 1))

        this.initializeInstances()
        this.scene.add(this.instancedMesh)
    }

    createPlaneTexture() {
        // Create a simple texture for the plane (you can replace with SVG texture)
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const ctx = canvas.getContext('2d')

        // Draw a simple plane shape
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, 64, 64)
        ctx.fillStyle = 'black'
        ctx.fillRect(20, 30, 24, 4)
        ctx.fillRect(30, 20, 4, 24)

        const texture = new THREE.CanvasTexture(canvas)
        return texture
    }

    initializeInstances() {
        for (let i = 0; i < this.maxCount; i++) {
            this.flightDurations[i] = 10.0 // 10 second flight duration
            this.flightPhases[i] = i * 2.0 // Staggered start times
        }
    }

    setFlightPath(instanceId, controlPoints) {
        if (instanceId >= this.maxCount) return

        const geometry = this.instancedMesh.geometry

        // Set control points for this instance
        const cp0Attr = geometry.attributes.controlPoint0
        const cp1Attr = geometry.attributes.controlPoint1
        const cp2Attr = geometry.attributes.controlPoint2
        const cp3Attr = geometry.attributes.controlPoint3

        // Set the 4 control points
        cp0Attr.setXYZ(instanceId, controlPoints[0].x, controlPoints[0].y, controlPoints[0].z)
        cp1Attr.setXYZ(instanceId, controlPoints[1].x, controlPoints[1].y, controlPoints[1].z)
        cp2Attr.setXYZ(instanceId, controlPoints[2].x, controlPoints[2].y, controlPoints[2].z)
        cp3Attr.setXYZ(instanceId, controlPoints[3].x, controlPoints[3].y, controlPoints[3].z)

        // Mark attributes for update
        cp0Attr.needsUpdate = true
        cp1Attr.needsUpdate = true
        cp2Attr.needsUpdate = true
        cp3Attr.needsUpdate = true
    }

    update(deltaTime) {
        if (!this.instancedMesh || !this.instancedMesh.material) return

        // Update time uniform to drive GPU animation
        this.instancedMesh.material.uniforms.time.value += deltaTime
    }

    setActiveCount(count) {
        this.activeCount = Math.min(count, this.maxCount)
        if (this.instancedMesh) {
            this.instancedMesh.count = this.activeCount
        }
    }

    getMesh() {
        return this.instancedMesh
    }
}
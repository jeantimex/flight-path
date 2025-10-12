import * as THREE from 'three'

/**
 * MergedGPUPanesShader - Ultimate performance pane renderer with GPU-side animation
 * All curve calculations, transformations, and animations happen in the vertex shader.
 * CPU only updates time uniform per frame - no per-flight work on CPU!
 */
export class MergedGPUPanesShader {
    constructor(scene, options = {}) {
        this.scene = scene
        this.maxPanes = options.maxPanes || 1000
        this.baseSize = options.baseSize || 100

        // Instanced mesh
        this.instancedMesh = null
        this.geometry = null
        this.material = null

        // Per-instance data: curve control points (4 points for CatmullRom)
        // Each flight needs 4 control points (12 floats = 3 vec4 attributes)
        this.controlPointsPack1 = new Float32Array(this.maxPanes * 4) // (p0.x, p0.y, p0.z, p1.x)
        this.controlPointsPack2 = new Float32Array(this.maxPanes * 4) // (p1.y, p1.z, p2.x, p2.y)
        this.controlPointsPack3 = new Float32Array(this.maxPanes * 4) // (p2.z, p3.x, p3.y, p3.z)

        // Per-instance colors and metadata
        this.instanceColors = new Float32Array(this.maxPanes * 3) // RGB per instance
        this.instanceScales = new Float32Array(this.maxPanes) // Scale multiplier per instance
        this.animationParams = new Float32Array(this.maxPanes * 4) // (phase, speed, tiltMode, visible)

        // Tracking
        this.activePanes = 0

        this.initialize()
    }

    /**
     * Initialize the instanced mesh with GPU animation shader
     */
    initialize() {
        // Create plane geometry (centered at origin)
        this.geometry = new THREE.PlaneGeometry(this.baseSize, this.baseSize)

        // Add per-instance attributes for curve control points
        this.geometry.setAttribute(
            'controlPointsPack1',
            new THREE.InstancedBufferAttribute(this.controlPointsPack1, 4)
        )
        this.geometry.setAttribute(
            'controlPointsPack2',
            new THREE.InstancedBufferAttribute(this.controlPointsPack2, 4)
        )
        this.geometry.setAttribute(
            'controlPointsPack3',
            new THREE.InstancedBufferAttribute(this.controlPointsPack3, 4)
        )

        // Add per-instance attributes for rendering
        this.geometry.setAttribute(
            'instanceColor',
            new THREE.InstancedBufferAttribute(this.instanceColors, 3)
        )
        this.geometry.setAttribute(
            'instanceScale',
            new THREE.InstancedBufferAttribute(this.instanceScales, 1)
        )
        this.geometry.setAttribute(
            'animationParams',
            new THREE.InstancedBufferAttribute(this.animationParams, 4)
        )

        // Create shader material with GPU-side animation
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0.0 },
                baseSize: { value: this.baseSize }
            },
            vertexShader: `
                // Per-instance curve control points (packed)
                attribute vec4 controlPointsPack1; // (p0.x, p0.y, p0.z, p1.x)
                attribute vec4 controlPointsPack2; // (p1.y, p1.z, p2.x, p2.y)
                attribute vec4 controlPointsPack3; // (p2.z, p3.x, p3.y, p3.z)

                // Per-instance rendering attributes
                attribute vec3 instanceColor;
                attribute float instanceScale;
                attribute vec4 animationParams; // (phase, speed, tiltMode, visible)

                // Uniforms
                uniform float time;
                uniform float baseSize;

                // Varyings
                varying vec3 vColor;

                // Unpack control points from packed attributes (MUST BE FIRST)
                vec3 getControlPoint(int index) {
                    if (index == 0) {
                        return vec3(controlPointsPack1.x, controlPointsPack1.y, controlPointsPack1.z);
                    } else if (index == 1) {
                        return vec3(controlPointsPack1.w, controlPointsPack2.x, controlPointsPack2.y);
                    } else if (index == 2) {
                        return vec3(controlPointsPack2.z, controlPointsPack2.w, controlPointsPack3.x);
                    } else {
                        return vec3(controlPointsPack3.y, controlPointsPack3.z, controlPointsPack3.w);
                    }
                }

                // CatmullRom curve evaluation for a single segment
                // This interpolates from p1 to p2, using p0 and p3 for tangent calculation
                vec3 evaluateCatmullRomSegment(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
                    float t2 = t * t;
                    float t3 = t2 * t;

                    return 0.5 * (
                        (2.0 * p1) +
                        (-p0 + p2) * t +
                        (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
                        (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
                    );
                }

                // Get tangent vector for CatmullRom curve segment
                vec3 getCatmullRomSegmentTangent(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
                    float t2 = t * t;

                    return 0.5 * (
                        (-p0 + p2) +
                        2.0 * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t +
                        3.0 * (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t2
                    );
                }

                // Evaluate CatmullRom spline through all 4 control points
                // Three.js CatmullRomCurve3 passes through ALL points, so we need 3 segments
                vec3 evaluateCatmullRom(float t, out vec3 tangent) {
                    vec3 p0 = getControlPoint(0);
                    vec3 p1 = getControlPoint(1);
                    vec3 p2 = getControlPoint(2);
                    vec3 p3 = getControlPoint(3);

                    vec3 position;

                    // Divide into 3 segments to pass through all 4 points
                    // Segment 0: p0 to p1 (t: 0.0 to 0.333)
                    // Segment 1: p1 to p2 (t: 0.333 to 0.666)
                    // Segment 2: p2 to p3 (t: 0.666 to 1.0)

                    if (t < 0.333) {
                        // First segment: p0 to p1
                        float localT = t / 0.333;
                        // Need a point before p0 for proper tangent
                        vec3 p_before = p0 + (p0 - p1);
                        position = evaluateCatmullRomSegment(p_before, p0, p1, p2, localT);
                        tangent = normalize(getCatmullRomSegmentTangent(p_before, p0, p1, p2, localT));
                    } else if (t < 0.666) {
                        // Middle segment: p1 to p2
                        float localT = (t - 0.333) / 0.333;
                        position = evaluateCatmullRomSegment(p0, p1, p2, p3, localT);
                        tangent = normalize(getCatmullRomSegmentTangent(p0, p1, p2, p3, localT));
                    } else {
                        // Last segment: p2 to p3
                        float localT = (t - 0.666) / 0.334;
                        // Need a point after p3 for proper tangent
                        vec3 p_after = p3 + (p3 - p2);
                        position = evaluateCatmullRomSegment(p1, p2, p3, p_after, localT);
                        tangent = normalize(getCatmullRomSegmentTangent(p1, p2, p3, p_after, localT));
                    }

                    return position;
                }

                // Create rotation matrix to orient pane along curve
                mat4 createOrientationMatrix(vec3 forward, vec3 up, float tiltMode) {
                    // Normalize forward direction
                    vec3 normalizedForward = normalize(forward);

                    // Calculate right vector (perpendicular to forward and up)
                    vec3 right = normalize(cross(up, normalizedForward));

                    // Recalculate up vector (perpendicular to forward and right)
                    vec3 newUp = normalize(cross(normalizedForward, right));

                    mat4 rotationMatrix;

                    if (tiltMode < 0.5) {
                        // Perpendicular mode: pane normal aligns with forward
                        // GLSL matrices are column-major: mat4(col0, col1, col2, col3)
                        rotationMatrix = mat4(
                            right.x, right.y, right.z, 0.0,              // Column 0 (X axis)
                            newUp.x, newUp.y, newUp.z, 0.0,              // Column 1 (Y axis)
                            normalizedForward.x, normalizedForward.y, normalizedForward.z, 0.0,  // Column 2 (Z axis)
                            0.0, 0.0, 0.0, 1.0                           // Column 3 (translation)
                        );
                    } else {
                        // Tangent mode: pane lies along forward direction (rotated 90 degrees)
                        rotationMatrix = mat4(
                            right.x, right.y, right.z, 0.0,
                            newUp.x, newUp.y, newUp.z, 0.0,
                            normalizedForward.x, normalizedForward.y, normalizedForward.z, 0.0,
                            0.0, 0.0, 0.0, 1.0
                        );
                        // Apply 90-degree rotation around X-axis
                        mat4 tiltRotation = mat4(
                            1.0, 0.0, 0.0, 0.0,
                            0.0, 0.0, 1.0, 0.0,
                            0.0, -1.0, 0.0, 0.0,
                            0.0, 0.0, 0.0, 1.0
                        );
                        rotationMatrix = rotationMatrix * tiltRotation;
                    }

                    return rotationMatrix;
                }

                void main() {
                    vColor = instanceColor;

                    // Extract animation parameters
                    float phase = animationParams.x;
                    float speed = animationParams.y;
                    float tiltMode = animationParams.z;
                    float visible = animationParams.w;

                    // Hide if not visible
                    if (visible < 0.5) {
                        gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
                        return;
                    }

                    // Calculate animation progress
                    float animTime = time * speed + phase;
                    float t = mod(animTime, 1.0);

                    // Evaluate curve position and get tangent
                    vec3 tangent;
                    vec3 curvePosition = evaluateCatmullRom(t, tangent);

                    // Default up vector
                    vec3 up = vec3(0.0, 1.0, 0.0);

                    // Create orientation matrix
                    mat4 rotationMatrix = createOrientationMatrix(tangent, up, tiltMode);

                    // Apply per-instance scale to vertex position
                    vec3 scaledPosition = position * instanceScale;

                    // Transform vertex to world space
                    vec4 worldPosition = vec4(curvePosition, 1.0) +
                                        rotationMatrix * vec4(scaledPosition, 0.0);

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
        this.instancedMesh = new THREE.InstancedMesh(
            this.geometry,
            this.material,
            this.maxPanes
        )

        // Initialize all instances as hidden
        for (let i = 0; i < this.maxPanes; i++) {
            // Initialize colors (red)
            this.instanceColors[i * 3] = 1.0
            this.instanceColors[i * 3 + 1] = 0.4
            this.instanceColors[i * 3 + 2] = 0.4

            // Initialize scale to 0 (hidden)
            this.instanceScales[i] = 0.0

            // Initialize animation params (phase, speed, tiltMode, visible)
            this.animationParams[i * 4] = Math.random() // phase
            this.animationParams[i * 4 + 1] = 0.1 // speed
            this.animationParams[i * 4 + 2] = 0.0 // tiltMode (0=perpendicular)
            this.animationParams[i * 4 + 3] = 0.0 // visible (0=hidden)

            // Initialize control points to zero
            this.controlPointsPack1[i * 4] = 0
            this.controlPointsPack1[i * 4 + 1] = 0
            this.controlPointsPack1[i * 4 + 2] = 0
            this.controlPointsPack1[i * 4 + 3] = 0

            this.controlPointsPack2[i * 4] = 0
            this.controlPointsPack2[i * 4 + 1] = 0
            this.controlPointsPack2[i * 4 + 2] = 0
            this.controlPointsPack2[i * 4 + 3] = 0

            this.controlPointsPack3[i * 4] = 0
            this.controlPointsPack3[i * 4 + 1] = 0
            this.controlPointsPack3[i * 4 + 2] = 0
            this.controlPointsPack3[i * 4 + 3] = 0
        }

        // Mark all attributes for initial upload
        this.markAllAttributesNeedUpdate()

        // Add to scene
        this.scene.add(this.instancedMesh)
    }

    /**
     * Set curve control points for a pane instance
     * This is called ONCE when creating a flight, not every frame!
     * @param {number} index - Index of the pane
     * @param {Array<THREE.Vector3>} controlPoints - Array of 4 control points
     */
    setCurveControlPoints(index, controlPoints) {
        if (index < 0 || index >= this.maxPanes) return
        if (controlPoints.length < 4) {
            console.warn('MergedGPUPanesShader requires 4 control points')
            return
        }

        // Pack control points into attributes
        // Pack 1: (p0.x, p0.y, p0.z, p1.x)
        this.controlPointsPack1[index * 4] = controlPoints[0].x
        this.controlPointsPack1[index * 4 + 1] = controlPoints[0].y
        this.controlPointsPack1[index * 4 + 2] = controlPoints[0].z
        this.controlPointsPack1[index * 4 + 3] = controlPoints[1].x

        // Pack 2: (p1.y, p1.z, p2.x, p2.y)
        this.controlPointsPack2[index * 4] = controlPoints[1].y
        this.controlPointsPack2[index * 4 + 1] = controlPoints[1].z
        this.controlPointsPack2[index * 4 + 2] = controlPoints[2].x
        this.controlPointsPack2[index * 4 + 3] = controlPoints[2].y

        // Pack 3: (p2.z, p3.x, p3.y, p3.z)
        this.controlPointsPack3[index * 4] = controlPoints[2].z
        this.controlPointsPack3[index * 4 + 1] = controlPoints[3].x
        this.controlPointsPack3[index * 4 + 2] = controlPoints[3].y
        this.controlPointsPack3[index * 4 + 3] = controlPoints[3].z

        // Mark pane as visible
        this.animationParams[index * 4 + 3] = 1.0

        // Mark control point attributes for upload
        this.geometry.attributes.controlPointsPack1.needsUpdate = true
        this.geometry.attributes.controlPointsPack2.needsUpdate = true
        this.geometry.attributes.controlPointsPack3.needsUpdate = true
        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Set the color of a specific pane
     */
    setPaneColor(index, color) {
        if (index < 0 || index >= this.maxPanes) return

        const c = color instanceof THREE.Color ? color : new THREE.Color(color)
        this.instanceColors[index * 3] = c.r
        this.instanceColors[index * 3 + 1] = c.g
        this.instanceColors[index * 3 + 2] = c.b

        this.geometry.attributes.instanceColor.needsUpdate = true
    }

    /**
     * Set the size of a specific pane
     */
    setPaneSize(index, size) {
        if (index < 0 || index >= this.maxPanes) return

        const normalizedScale = size / this.baseSize
        this.instanceScales[index] = normalizedScale

        this.geometry.attributes.instanceScale.needsUpdate = true
    }

    /**
     * Set animation speed for a specific pane
     */
    setAnimationSpeed(index, speed) {
        if (index < 0 || index >= this.maxPanes) return

        this.animationParams[index * 4 + 1] = speed

        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Set tilt mode for a specific pane
     * @param {number} index - Index of the pane
     * @param {string} mode - 'Perpendicular' or 'Tangent'
     */
    setTiltMode(index, mode) {
        if (index < 0 || index >= this.maxPanes) return

        const tiltModeValue = mode === 'Tangent' ? 1.0 : 0.0
        this.animationParams[index * 4 + 2] = tiltModeValue

        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Hide a specific pane
     */
    hidePane(index) {
        if (index < 0 || index >= this.maxPanes) return

        this.animationParams[index * 4 + 3] = 0.0 // visible = false

        this.geometry.attributes.animationParams.needsUpdate = true
    }

    /**
     * Update time uniform - called once per frame
     * This is the ONLY method that needs to be called every frame!
     */
    update(deltaTime) {
        if (!this.material || !this.material.uniforms) return

        this.material.uniforms.time.value += deltaTime
    }

    /**
     * Set the number of active panes
     */
    setActivePaneCount(count) {
        this.activePanes = Math.min(count, this.maxPanes)
    }

    /**
     * Get the number of pane instances
     */
    getCount() {
        return this.maxPanes
    }

    /**
     * Remove from scene and cleanup
     */
    remove() {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh)
            this.geometry.dispose()
            this.material.dispose()
            this.instancedMesh = null
        }
    }

    /**
     * Check if merged panes exist
     */
    exists() {
        return this.instancedMesh !== null
    }

    /**
     * Get max panes
     */
    getMaxPanes() {
        return this.maxPanes
    }

    /**
     * Mark all attributes for GPU upload
     */
    markAllAttributesNeedUpdate() {
        if (!this.geometry) return

        if (this.geometry.attributes.controlPointsPack1) {
            this.geometry.attributes.controlPointsPack1.needsUpdate = true
        }
        if (this.geometry.attributes.controlPointsPack2) {
            this.geometry.attributes.controlPointsPack2.needsUpdate = true
        }
        if (this.geometry.attributes.controlPointsPack3) {
            this.geometry.attributes.controlPointsPack3.needsUpdate = true
        }
        if (this.geometry.attributes.instanceColor) {
            this.geometry.attributes.instanceColor.needsUpdate = true
        }
        if (this.geometry.attributes.instanceScale) {
            this.geometry.attributes.instanceScale.needsUpdate = true
        }
        if (this.geometry.attributes.animationParams) {
            this.geometry.attributes.animationParams.needsUpdate = true
        }
    }
}

import * as THREE from 'three'

/**
 * Curves - Ultra-high performance curve renderer
 * Merges all curves into a single mesh with per-vertex colors for maximum performance.
 * This approach renders all curves in a SINGLE draw call regardless of curve count.
 */
export class Curves {
    constructor(scene, options = {}) {
        this.scene = scene
        this.maxCurves = options.maxCurves || 1000
        this.segmentsPerCurve = options.segmentsPerCurve || 100
        this.verticesPerSegment = 2
        this.verticesPerCurve = this.segmentsPerCurve * this.verticesPerSegment
        this.dashSize = options.dashSize !== undefined ? options.dashSize : 0
        this.gapSize = options.gapSize !== undefined ? options.gapSize : 0

        // Buffer geometry for all curves
        this.geometry = null
        this.material = null
        this.mesh = null

        // Pre-allocated buffers
        this.positions = null
        this.colors = null
        this.lineDistances = null

        // Tracking
        this.currentCurveCount = 0
        this.needsPositionUpdate = false
        this.needsColorUpdate = false
        this.needsLineDistanceUpdate = false

        // Store curve data for each slot
        this.curveData = []

        this.initialize()
    }

    /**
     * Initialize the merged geometry and material
     */
    initialize() {
        // Calculate total points needed
        const totalVertices = this.maxCurves * this.verticesPerCurve

        // Pre-allocate buffers
        this.positions = new Float32Array(totalVertices * 3)
        this.colors = new Float32Array(totalVertices * 3)
        this.lineDistances = new Float32Array(totalVertices)

        // Initialize with zeros (invisible)
        this.positions.fill(0)
        this.colors.fill(0)
        this.lineDistances.fill(0)

        // Create buffer geometry
        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(this.positions, 3)
        )
        this.geometry.setAttribute(
            'color',
            new THREE.BufferAttribute(this.colors, 3)
        )
        this.geometry.setAttribute(
            'lineDistance',
            new THREE.BufferAttribute(this.lineDistances, 1)
        )

        // Create material with vertex colors
        this.material = this.createMaterial()

        // Create line segments mesh
        this.mesh = new THREE.LineSegments(this.geometry, this.material)

        // Initially draw nothing
        this.geometry.setDrawRange(0, 0)

        // Add to scene
        this.scene.add(this.mesh)

        // Initialize curve data array
        for (let i = 0; i < this.maxCurves; i++) {
            this.curveData.push({
                controlPoints: [],
                color: 0xFFFFFF,
                visible: false,
                metadata: null
            })
        }
    }

    /**
     * Add or update a curve at a specific index
     * @param {number} curveIndex - Index of the curve (0 to maxCurves-1)
     * @param {Array<THREE.Vector3>} controlPoints - Control points for the curve
     * @param {number|THREE.Color} color - Color for this curve
     */
    setCurve(curveIndex, controlPoints, color = 0x4488ff, metadata = null) {
        if (curveIndex < 0 || curveIndex >= this.maxCurves) {
            console.warn(`Curve index ${curveIndex} out of bounds`)
            return
        }

        if (!controlPoints || controlPoints.length < 2) {
            console.warn('Need at least 2 control points for a curve')
            return
        }

        // Store curve data
        const curveData = this.curveData[curveIndex]
        curveData.controlPoints = controlPoints
        curveData.color = color
        curveData.metadata = metadata ?? null
        curveData.visible = true

        // Create the curve
        const curve = new THREE.CatmullRomCurve3(controlPoints)
        const points = curve.getPoints(this.segmentsPerCurve)

        // Calculate buffer offset for this curve
        const vertexOffset = curveIndex * this.verticesPerCurve

        let distance = 0

        for (let segmentIndex = 0; segmentIndex < this.segmentsPerCurve; segmentIndex++) {
            const startPoint = points[segmentIndex]
            const endPoint = points[segmentIndex + 1]
            const vertexIndex = vertexOffset + segmentIndex * this.verticesPerSegment
            const bufferIndex = vertexIndex * 3

            this.positions[bufferIndex] = startPoint.x
            this.positions[bufferIndex + 1] = startPoint.y
            this.positions[bufferIndex + 2] = startPoint.z

            this.positions[bufferIndex + 3] = endPoint.x
            this.positions[bufferIndex + 4] = endPoint.y
            this.positions[bufferIndex + 5] = endPoint.z

            this.lineDistances[vertexIndex] = distance
            distance += startPoint.distanceTo(endPoint)
            this.lineDistances[vertexIndex + 1] = distance
        }

        this._applyColorToCurve(curveIndex)

        // Mark for update
        this.needsPositionUpdate = true
        this.needsLineDistanceUpdate = true

        // Update curve count if needed
        if (curveIndex >= this.currentCurveCount) {
            this.currentCurveCount = curveIndex + 1
            this.updateDrawRange()
        }
    }

    /**
     * Update the color of a specific curve
     * @param {number} curveIndex - Index of the curve
     * @param {number|THREE.Color} color - New color
     */
    setCurveColor(curveIndex, color, metadata) {
        if (curveIndex < 0 || curveIndex >= this.maxCurves) return

        const curveData = this.curveData[curveIndex]
        if (!curveData.visible) return

        curveData.color = color
        if (metadata !== undefined) {
            curveData.metadata = metadata ?? null
        }

        this._applyColorToCurve(curveIndex)
    }

    _computeGradientParams(color, metadata) {
        let source = null

        if (color && typeof color === 'object' && color.type === 'gradient') {
            source = {
                lat: color.departureLat ?? 0,
                lng: color.departureLng ?? 0
            }
        } else if (metadata && metadata.departure) {
            source = {
                lat: metadata.departure.lat ?? 0,
                lng: metadata.departure.lng ?? 0
            }
        }

        if (!source) {
            return null
        }

        const lng = source.lng
        const lat = source.lat
        const hue = ((lng + 180) % 360) / 360
        const latFactor = Math.min(Math.abs(lat) / 90, 1)
        const saturation = THREE.MathUtils.clamp(0.6 + (0.3 * (1 - latFactor)), 0, 1)

        return {
            hue,
            saturation,
            lightnessStart: 0.35,
            lightnessEnd: 0.75
        }
    }

    _resolveSolidColor(color) {
        if (color instanceof THREE.Color) {
            return color
        }
        if (typeof color === 'number') {
            return new THREE.Color(color)
        }
        if (color && typeof color === 'object' && color.isColor === true) {
            return color
        }
        return new THREE.Color(0x4488ff)
    }

    _getColorForProgress(params, progress, targetColor) {
        const target = targetColor || new THREE.Color()
        const clampedProgress = THREE.MathUtils.clamp(progress, 0, 1)
        const lightness = THREE.MathUtils.clamp(
            params.lightnessStart + (params.lightnessEnd - params.lightnessStart) * clampedProgress,
            0,
            1
        )
        target.setHSL(params.hue, params.saturation, lightness)
        return target
    }

    _applyColorToCurve(curveIndex) {
        if (curveIndex < 0 || curveIndex >= this.maxCurves) return

        const curveData = this.curveData[curveIndex]
        if (!curveData.visible) return

        const gradientParams = this._computeGradientParams(curveData.color, curveData.metadata)
        const hasGradient = !!gradientParams

        const vertexOffset = curveIndex * this.verticesPerCurve
        const startColor = new THREE.Color()
        const endColor = new THREE.Color()
        const solidColor = hasGradient ? null : this._resolveSolidColor(curveData.color)

        for (let segmentIndex = 0; segmentIndex < this.segmentsPerCurve; segmentIndex++) {
            const vertexIndex = vertexOffset + segmentIndex * this.verticesPerSegment
            const bufferIndex = vertexIndex * 3

            if (hasGradient) {
                const startProgress = segmentIndex / this.segmentsPerCurve
                const endProgress = (segmentIndex + 1) / this.segmentsPerCurve
                this._getColorForProgress(gradientParams, startProgress, startColor)
                this._getColorForProgress(gradientParams, endProgress, endColor)

                this.colors[bufferIndex] = startColor.r
                this.colors[bufferIndex + 1] = startColor.g
                this.colors[bufferIndex + 2] = startColor.b

                this.colors[bufferIndex + 3] = endColor.r
                this.colors[bufferIndex + 4] = endColor.g
                this.colors[bufferIndex + 5] = endColor.b
            } else {
                this.colors[bufferIndex] = solidColor.r
                this.colors[bufferIndex + 1] = solidColor.g
                this.colors[bufferIndex + 2] = solidColor.b

                this.colors[bufferIndex + 3] = solidColor.r
                this.colors[bufferIndex + 4] = solidColor.g
                this.colors[bufferIndex + 5] = solidColor.b
            }
        }

        this.needsColorUpdate = true
    }

    /**
     * Hide a specific curve
     * @param {number} curveIndex - Index of the curve to hide
     */
    hideCurve(curveIndex) {
        if (curveIndex < 0 || curveIndex >= this.maxCurves) return

        const curveData = this.curveData[curveIndex]
        curveData.visible = false

        // Set all positions to zero (effectively hiding it)
        const vertexOffset = curveIndex * this.verticesPerCurve * 3
        const totalVertices = this.verticesPerCurve * 3
        for (let i = 0; i < totalVertices; i++) {
            this.positions[vertexOffset + i] = 0
        }
        const distanceOffset = curveIndex * this.verticesPerCurve
        for (let i = 0; i < this.verticesPerCurve; i++) {
            this.lineDistances[distanceOffset + i] = 0
        }

        this.needsPositionUpdate = true
        this.needsLineDistanceUpdate = true
    }

    /**
     * Set the number of visible curves
     * @param {number} count - Number of curves to show
     */
    setVisibleCurveCount(count) {
        this.currentCurveCount = Math.min(count, this.maxCurves)
        this.updateDrawRange()
    }

    /**
     * Update the draw range based on current curve count
     */
    updateDrawRange() {
        const visibleVertices = this.currentCurveCount * this.verticesPerCurve
        this.geometry.setDrawRange(0, visibleVertices)
    }

    /**
     * Apply batched updates to geometry attributes
     * Call this once per frame after all curve updates
     */
    applyUpdates() {
        if (this.needsPositionUpdate) {
            this.geometry.attributes.position.needsUpdate = true
            this.needsPositionUpdate = false
        }
        if (this.needsColorUpdate) {
            this.geometry.attributes.color.needsUpdate = true
            this.needsColorUpdate = false
        }
        if (this.dashSize > 0 && this.needsLineDistanceUpdate) {
            if (this.geometry.attributes.lineDistance) {
                this.geometry.attributes.lineDistance.needsUpdate = true
            }
            this.needsLineDistanceUpdate = false
        } else if (this.dashSize === 0) {
            this.needsLineDistanceUpdate = false
        }
    }

    /**
     * Check if a curve exists and is visible
     * @param {number} curveIndex - Index of the curve
     */
    isCurveVisible(curveIndex) {
        if (curveIndex < 0 || curveIndex >= this.maxCurves) return false
        return this.curveData[curveIndex].visible
    }

    /**
     * Get the curve object for a specific index
     * @param {number} curveIndex - Index of the curve
     * @returns {THREE.CatmullRomCurve3|null}
     */
    getCurve(curveIndex) {
        if (curveIndex < 0 || curveIndex >= this.maxCurves) return null
        const curveData = this.curveData[curveIndex]
        if (!curveData.visible || curveData.controlPoints.length < 2) return null

        return new THREE.CatmullRomCurve3(curveData.controlPoints)
    }

    /**
     * Get position at parameter t for a specific curve
     * @param {number} curveIndex - Index of the curve
     * @param {number} t - Parameter (0 to 1)
     */
    getPointAt(curveIndex, t) {
        const curve = this.getCurve(curveIndex)
        return curve ? curve.getPointAt(t) : new THREE.Vector3()
    }

    /**
     * Get tangent at parameter t for a specific curve
     * @param {number} curveIndex - Index of the curve
     * @param {number} t - Parameter (0 to 1)
     */
    getTangentAt(curveIndex, t) {
        const curve = this.getCurve(curveIndex)
        return curve ? curve.getTangentAt(t) : new THREE.Vector3(0, 0, 1)
    }

    /**
     * Remove all curves and cleanup
     */
    remove() {
        if (this.mesh) {
            this.scene.remove(this.mesh)
            this.geometry.dispose()
            this.material.dispose()
            this.mesh = null
        }
        this.curveData = []
    }

    /**
     * Check if the merged curves exist
     */
    exists() {
        return this.mesh !== null
    }

    /**
     * Get the total number of curves that can be stored
     */
    getMaxCurves() {
        return this.maxCurves
    }

    /**
     * Get the current number of visible curves
     */
    getCurrentCurveCount() {
        return this.currentCurveCount
    }

    /**
     * Update dash pattern for all curves
     * @param {number} dashSize - Length of visible dash
     * @param {number} gapSize - Length of gap between dashes
     */
    setDashPattern(dashSize, gapSize) {
        const nextDash = Math.max(0, dashSize)
        const nextGap = Math.max(0, gapSize)

        if (this.dashSize === nextDash && this.gapSize === nextGap) return

        this.dashSize = nextDash
        this.gapSize = nextGap
        this.updateMaterial()
    }

    createMaterial() {
        if (this.dashSize > 0) {
            return new THREE.LineDashedMaterial({
                vertexColors: true,
                dashSize: this.dashSize,
                gapSize: Math.max(this.gapSize, 1e-4)
            })
        }

        return new THREE.LineBasicMaterial({
            vertexColors: true
        })
    }

    updateMaterial() {
        if (!this.mesh) return

        if (this.material) {
            this.material.dispose()
        }

        this.material = this.createMaterial()
        this.mesh.material = this.material
        this.mesh.material.needsUpdate = true

        if (this.dashSize > 0) {
            this.needsLineDistanceUpdate = true
        }
    }
}

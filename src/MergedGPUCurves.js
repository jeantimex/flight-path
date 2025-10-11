import * as THREE from 'three'

/**
 * MergedGPUCurves - Ultra-high performance curve renderer
 * Merges all curves into a single mesh with per-vertex colors for maximum performance.
 * This approach renders all curves in a SINGLE draw call regardless of curve count.
 */
export class MergedGPUCurves {
    constructor(scene, options = {}) {
        this.scene = scene
        this.maxCurves = options.maxCurves || 1000
        this.segmentsPerCurve = options.segmentsPerCurve || 100
        this.lineWidth = options.lineWidth || 2.0

        // Buffer geometry for all curves
        this.geometry = null
        this.material = null
        this.mesh = null

        // Pre-allocated buffers
        this.positions = null
        this.colors = null

        // Tracking
        this.currentCurveCount = 0
        this.needsPositionUpdate = false
        this.needsColorUpdate = false

        // Store curve data for each slot
        this.curveData = []

        this.initialize()
    }

    /**
     * Initialize the merged geometry and material
     */
    initialize() {
        // Calculate total points needed
        // Each curve segment needs 2 points (line segment)
        const totalPoints = this.maxCurves * this.segmentsPerCurve

        // Pre-allocate buffers
        this.positions = new Float32Array(totalPoints * 3)
        this.colors = new Float32Array(totalPoints * 3)

        // Initialize with zeros (invisible)
        this.positions.fill(0)
        this.colors.fill(0)

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

        // Create material with vertex colors
        this.material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: false,
            linewidth: this.lineWidth // Note: linewidth only works in some browsers/renderers
        })

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
                color: new THREE.Color(0xffffff),
                visible: false
            })
        }
    }

    /**
     * Add or update a curve at a specific index
     * @param {number} curveIndex - Index of the curve (0 to maxCurves-1)
     * @param {Array<THREE.Vector3>} controlPoints - Control points for the curve
     * @param {number|THREE.Color} color - Color for this curve
     */
    setCurve(curveIndex, controlPoints, color = 0x4488ff) {
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
        curveData.color = color instanceof THREE.Color ? color : new THREE.Color(color)
        curveData.visible = true

        // Create the curve
        const curve = new THREE.CatmullRomCurve3(controlPoints)
        const points = curve.getPoints(this.segmentsPerCurve)

        // Calculate buffer offset for this curve
        const pointOffset = curveIndex * this.segmentsPerCurve

        // Fill positions and colors
        for (let i = 0; i < points.length; i++) {
            const bufferIndex = (pointOffset + i) * 3

            // Set position
            this.positions[bufferIndex] = points[i].x
            this.positions[bufferIndex + 1] = points[i].y
            this.positions[bufferIndex + 2] = points[i].z

            // Set color (same color for all vertices in this curve)
            this.colors[bufferIndex] = curveData.color.r
            this.colors[bufferIndex + 1] = curveData.color.g
            this.colors[bufferIndex + 2] = curveData.color.b
        }

        // Mark for update
        this.needsPositionUpdate = true
        this.needsColorUpdate = true

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
    setCurveColor(curveIndex, color) {
        if (curveIndex < 0 || curveIndex >= this.maxCurves) return

        const curveData = this.curveData[curveIndex]
        if (!curveData.visible) return

        curveData.color = color instanceof THREE.Color ? color : new THREE.Color(color)

        // Update color buffer
        const pointOffset = curveIndex * this.segmentsPerCurve
        for (let i = 0; i < this.segmentsPerCurve; i++) {
            const bufferIndex = (pointOffset + i) * 3
            this.colors[bufferIndex] = curveData.color.r
            this.colors[bufferIndex + 1] = curveData.color.g
            this.colors[bufferIndex + 2] = curveData.color.b
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
        const pointOffset = curveIndex * this.segmentsPerCurve
        for (let i = 0; i < this.segmentsPerCurve; i++) {
            const bufferIndex = (pointOffset + i) * 3
            this.positions[bufferIndex] = 0
            this.positions[bufferIndex + 1] = 0
            this.positions[bufferIndex + 2] = 0
        }

        this.needsPositionUpdate = true
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
        const visiblePoints = this.currentCurveCount * this.segmentsPerCurve
        this.geometry.setDrawRange(0, visiblePoints)
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
}

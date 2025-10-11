import * as THREE from 'three'
import { GPUPane } from './GPUPane.js'

/**
 * GPUFlight combines a curve (from MergedGPUCurves) and GPUPane into a single flight unit.
 * This version uses a shared merged curves renderer for maximum performance.
 */
export class GPUFlight {
    constructor(scene, options = {}) {
        this.scene = scene
        this.pane = null
        this.animationTime = 0

        // Reference to the merged curves renderer and this flight's index
        this.mergedCurves = options.mergedCurves || null
        this.curveIndex = options.curveIndex !== undefined ? options.curveIndex : -1

        // Curve options
        this.controlPoints = options.controlPoints || []
        this.curveOptions = {
            segmentCount: options.segmentCount || 100,
            lineWidth: options.lineWidth || 2.0,
            color: options.curveColor || 0x4488ff
        }

        // Pane options
        this.paneOptions = {
            count: options.paneCount || 1,
            paneSize: options.paneSize || 100,
            color: options.paneColor || 0xff6666
        }

        // Animation options
        this.animationSpeed = options.animationSpeed || 0.1
        this.tiltMode = options.tiltMode || 'Perpendicular'

        // Cached curve for performance
        this._cachedCurve = null
    }

    /**
     * Create the curve and pane
     */
    create() {
        // Register curve with merged renderer
        if (this.mergedCurves && this.curveIndex >= 0) {
            this.mergedCurves.setCurve(
                this.curveIndex,
                this.controlPoints,
                this.curveOptions.color
            )
            // Create cached curve for pane animation
            this._cachedCurve = new THREE.CatmullRomCurve3(this.controlPoints)
        }

        // Create the pane(s)
        this.pane = new GPUPane(this.scene, {
            count: this.paneOptions.count,
            paneSize: this.paneOptions.paneSize,
            color: this.paneOptions.color
        })
        this.pane.create()

        return this
    }

    /**
     * Update animation for all panes on the curve
     * @param {number} deltaTime - Time elapsed since last frame
     */
    update(deltaTime) {
        if (!this._cachedCurve || !this.pane) return

        // Update animation time
        this.animationTime += deltaTime * this.animationSpeed

        // Update each pane instance
        const paneCount = this.pane.getCount()
        for (let i = 0; i < paneCount; i++) {
            // Calculate parameter t for this pane
            // If multiple panes, distribute them evenly along the curve
            const offset = paneCount > 1 ? i / paneCount : 0
            const t = ((this.animationTime + offset) % 1)

            // Update pane position on curve using cached curve
            this.pane.updatePaneOnCurve(i, this._cachedCurve, t, 0.001, this.tiltMode)
        }
    }

    /**
     * Set the curve control points and recreate the curve
     */
    setControlPoints(controlPoints) {
        this.controlPoints = controlPoints
        if (this.mergedCurves && this.curveIndex >= 0) {
            this.mergedCurves.setCurve(
                this.curveIndex,
                this.controlPoints,
                this.curveOptions.color
            )
            // Update cached curve
            this._cachedCurve = new THREE.CatmullRomCurve3(this.controlPoints)
        }
    }

    /**
     * Update curve color
     */
    setCurveColor(color) {
        this.curveOptions.color = color
        if (this.mergedCurves && this.curveIndex >= 0) {
            this.mergedCurves.setCurveColor(this.curveIndex, color)
        }
    }

    /**
     * Update curve line width
     * Note: Line width is global in merged curves, this is kept for API compatibility
     */
    setCurveLineWidth(width) {
        this.curveOptions.lineWidth = width
        // Line width is a global setting in MergedGPUCurves
    }

    /**
     * Update curve segment count
     * Note: Segment count is global in merged curves, kept for API compatibility
     */
    setCurveSegmentCount(count) {
        this.curveOptions.segmentCount = count
        // Segment count is a global setting in MergedGPUCurves
        // To change it, you'd need to recreate the entire merged curves renderer
    }

    /**
     * Update pane color
     */
    setPaneColor(color) {
        this.paneOptions.color = color
        if (this.pane) {
            this.pane.setColor(color)
        }
    }

    /**
     * Update pane size
     */
    setPaneSize(size) {
        this.paneOptions.paneSize = size
        if (this.pane) {
            this.pane.setSize(size)
        }
    }

    /**
     * Set animation speed
     */
    setAnimationSpeed(speed) {
        this.animationSpeed = speed
    }

    /**
     * Set tilt mode for panes
     */
    setTiltMode(mode) {
        this.tiltMode = mode
    }

    /**
     * Set scale for a specific pane
     */
    setPaneScale(index, scale) {
        if (this.pane) {
            this.pane.setScale(index, scale)
        }
    }

    /**
     * Get the curve object (returns cached curve for compatibility)
     */
    getCurve() {
        return this._cachedCurve
    }

    /**
     * Get the pane object
     */
    getPane() {
        return this.pane
    }

    /**
     * Check if flight exists
     */
    exists() {
        return this._cachedCurve !== null && this.pane !== null
    }

    /**
     * Remove from scene and cleanup
     */
    remove() {
        // Hide curve in merged renderer
        if (this.mergedCurves && this.curveIndex >= 0) {
            this.mergedCurves.hideCurve(this.curveIndex)
        }

        // Remove pane
        if (this.pane) {
            this.pane.remove()
            this.pane = null
        }

        // Clear cached curve
        this._cachedCurve = null
    }
}

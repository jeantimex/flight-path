import * as THREE from 'three'
import { GPUCurve } from './GPUCurve.js'
import { GPUPane } from './GPUPane.js'

/**
 * GPUFlight combines a GPUCurve and GPUPane into a single flight unit.
 * This makes it easy to create and manage multiple flights with their own curves and panes.
 */
export class GPUFlight {
    constructor(scene, options = {}) {
        this.scene = scene
        this.curve = null
        this.pane = null
        this.animationTime = 0

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
    }

    /**
     * Create the curve and pane
     */
    create() {
        // Create the curve
        this.curve = new GPUCurve(this.scene, {
            controlPoints: this.controlPoints,
            segmentCount: this.curveOptions.segmentCount,
            lineWidth: this.curveOptions.lineWidth,
            color: this.curveOptions.color
        })
        this.curve.create()

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
        if (!this.curve || !this.pane) return

        // Update animation time
        this.animationTime += deltaTime * this.animationSpeed

        // Update each pane instance
        const paneCount = this.pane.getCount()
        for (let i = 0; i < paneCount; i++) {
            // Calculate parameter t for this pane
            // If multiple panes, distribute them evenly along the curve
            const offset = paneCount > 1 ? i / paneCount : 0
            const t = ((this.animationTime + offset) % 1)

            // Update pane position on curve
            this.pane.updatePaneOnCurve(i, this.curve, t, 0.001, this.tiltMode)
        }
    }

    /**
     * Set the curve control points and recreate the curve
     */
    setControlPoints(controlPoints) {
        this.controlPoints = controlPoints
        if (this.curve) {
            this.curve.remove()
            this.curve = new GPUCurve(this.scene, {
                controlPoints: this.controlPoints,
                segmentCount: this.curveOptions.segmentCount,
                lineWidth: this.curveOptions.lineWidth,
                color: this.curveOptions.color
            })
            this.curve.create()
        }
    }

    /**
     * Update curve color
     */
    setCurveColor(color) {
        this.curveOptions.color = color
        if (this.curve) {
            this.curve.setColor(color)
        }
    }

    /**
     * Update curve line width
     */
    setCurveLineWidth(width) {
        this.curveOptions.lineWidth = width
        if (this.curve) {
            this.curve.setLineWidth(width)
        }
    }

    /**
     * Update curve segment count
     */
    setCurveSegmentCount(count) {
        this.curveOptions.segmentCount = count
        if (this.curve && this.controlPoints.length > 0) {
            this.curve.remove()
            this.curve = new GPUCurve(this.scene, {
                controlPoints: this.controlPoints,
                segmentCount: count,
                lineWidth: this.curveOptions.lineWidth,
                color: this.curveOptions.color
            })
            this.curve.create()
        }
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
     * Get the curve object
     */
    getCurve() {
        return this.curve
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
        return this.curve !== null && this.pane !== null
    }

    /**
     * Remove from scene and cleanup
     */
    remove() {
        if (this.curve) {
            this.curve.remove()
            this.curve = null
        }
        if (this.pane) {
            this.pane.remove()
            this.pane = null
        }
    }
}

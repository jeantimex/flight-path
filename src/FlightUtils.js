import * as THREE from 'three'

/**
 * Utility functions for generating flight paths and control points
 */
export class FlightUtils {
    /**
     * Generate random control points for a smooth curve
     * @param {Object} options - Configuration options
     * @param {THREE.Vector3} options.start - Start position (optional, random if not provided)
     * @param {THREE.Vector3} options.end - End position (optional, random if not provided)
     * @param {number} options.numControlPoints - Number of intermediate control points (default: 2-4 random)
     * @param {number} options.spread - How far control points can deviate from the line (default: 2000)
     * @param {Object} options.bounds - Bounding box for random positions
     * @returns {Array<THREE.Vector3>} Array of control points including start and end
     */
    static generateRandomCurve(options = {}) {
        const bounds = options.bounds || {
            minX: -3000, maxX: 3000,
            minY: -2000, maxY: 2000,
            minZ: -3000, maxZ: 3000
        }

        // Generate random start point if not provided
        const start = options.start || new THREE.Vector3(
            THREE.MathUtils.randFloat(bounds.minX, bounds.maxX),
            THREE.MathUtils.randFloat(bounds.minY, bounds.maxY),
            THREE.MathUtils.randFloat(bounds.minZ, bounds.maxZ)
        )

        // Generate random end point if not provided
        const end = options.end || new THREE.Vector3(
            THREE.MathUtils.randFloat(bounds.minX, bounds.maxX),
            THREE.MathUtils.randFloat(bounds.minY, bounds.maxY),
            THREE.MathUtils.randFloat(bounds.minZ, bounds.maxZ)
        )

        // Determine number of intermediate control points
        const numControlPoints = options.numControlPoints !== undefined
            ? options.numControlPoints
            : Math.floor(THREE.MathUtils.randFloat(2, 5))

        // Calculate the spread (how far points can deviate)
        const spread = options.spread || 2000

        const controlPoints = [start]

        // Generate intermediate control points along the path
        for (let i = 1; i <= numControlPoints; i++) {
            const t = i / (numControlPoints + 1)

            // Interpolate between start and end
            const basePoint = new THREE.Vector3().lerpVectors(start, end, t)

            // Add random deviation perpendicular to the line
            const direction = new THREE.Vector3().subVectors(end, start).normalize()
            const up = new THREE.Vector3(0, 1, 0)

            // Create perpendicular vectors
            const right = new THREE.Vector3().crossVectors(direction, up).normalize()
            const perpUp = new THREE.Vector3().crossVectors(right, direction).normalize()

            // Add random offset in perpendicular directions
            const offsetRight = THREE.MathUtils.randFloat(-spread, spread)
            const offsetUp = THREE.MathUtils.randFloat(-spread, spread)
            const offsetForward = THREE.MathUtils.randFloat(-spread * 0.5, spread * 0.5)

            const controlPoint = basePoint.clone()
                .add(right.multiplyScalar(offsetRight))
                .add(perpUp.multiplyScalar(offsetUp))
                .add(direction.multiplyScalar(offsetForward))

            // Clamp to bounds
            controlPoint.x = THREE.MathUtils.clamp(controlPoint.x, bounds.minX, bounds.maxX)
            controlPoint.y = THREE.MathUtils.clamp(controlPoint.y, bounds.minY, bounds.maxY)
            controlPoint.z = THREE.MathUtils.clamp(controlPoint.z, bounds.minZ, bounds.maxZ)

            controlPoints.push(controlPoint)
        }

        controlPoints.push(end)

        return controlPoints
    }

    /**
     * Generate a random color
     * @param {Object} options - Color generation options
     * @param {number} options.saturation - Saturation (0-1, default: 0.6-1.0)
     * @param {number} options.lightness - Lightness (0-1, default: 0.4-0.7)
     * @returns {number} Color as hex number
     */
    static generateRandomColor(options = {}) {
        const hue = Math.random()
        const saturation = options.saturation !== undefined
            ? options.saturation
            : THREE.MathUtils.randFloat(0.6, 1.0)
        const lightness = options.lightness !== undefined
            ? options.lightness
            : THREE.MathUtils.randFloat(0.4, 0.7)

        const color = new THREE.Color()
        color.setHSL(hue, saturation, lightness)

        return color.getHex()
    }

    /**
     * Generate flight configuration with random parameters
     * @param {Object} options - Configuration options
     * @returns {Object} Flight configuration object
     */
    static generateRandomFlightConfig(options = {}) {
        const controlPoints = this.generateRandomCurve(options)

        return {
            controlPoints,
            segmentCount: options.segmentCount || 100,
            lineWidth: options.lineWidth || THREE.MathUtils.randFloat(1.5, 3.0),
            curveColor: options.curveColor || this.generateRandomColor(),
            paneCount: options.paneCount || 1,
            paneSize: options.paneSize || THREE.MathUtils.randFloat(80, 150),
            paneColor: options.paneColor || this.generateRandomColor(),
            animationSpeed: options.animationSpeed || THREE.MathUtils.randFloat(0.05, 0.15),
            tiltMode: options.tiltMode || 'Perpendicular'
        }
    }
}

import * as THREE from 'three'

/**
 * Utility functions for generating flight paths and control points
 */
export class FlightUtils {
    /**
     * Generate a random point inside a sphere centered at the origin.
     * @param {number} radius - Sphere radius
     * @returns {THREE.Vector3}
     */
    static randomPointInSphere(radius) {
        const u = Math.random()
        const v = Math.random()
        const theta = 2 * Math.PI * u
        const phi = Math.acos(2 * v - 1)
        const r = radius * Math.cbrt(Math.random())
        const sinPhi = Math.sin(phi)

        return new THREE.Vector3(
            r * sinPhi * Math.cos(theta),
            r * sinPhi * Math.sin(theta),
            r * Math.cos(phi)
        )
    }

    /**
     * Clamp a vector to lie within a sphere.
     * @param {THREE.Vector3} vector - Vector to clamp (mutated in place)
     * @param {number} radius - Sphere radius
     * @param {THREE.Vector3} center - Sphere center
     * @returns {THREE.Vector3}
     */
    static clampToSphere(vector, radius, center) {
        const offset = vector.clone().sub(center)
        const radiusSq = radius * radius

        if (offset.lengthSq() > radiusSq) {
            offset.setLength(radius)
            vector.copy(offset.add(center))
        }

        return vector
    }

    /**
     * Infer a sphere radius from legacy bounds configuration.
     * @param {Object|undefined} bounds
     * @returns {number}
     */
    static inferRadiusFromBounds(bounds) {
        if (!bounds) {
            return 3000
        }

        const maxX = Math.max(Math.abs(bounds.minX ?? 0), Math.abs(bounds.maxX ?? 0))
        const maxY = Math.max(Math.abs(bounds.minY ?? 0), Math.abs(bounds.maxY ?? 0))
        const maxZ = Math.max(Math.abs(bounds.minZ ?? 0), Math.abs(bounds.maxZ ?? 0))

        return Math.sqrt(maxX * maxX + maxY * maxY + maxZ * maxZ)
    }

    /**
     * Infer the sphere center from legacy bounds configuration.
     * @param {Object|undefined} bounds
     * @returns {THREE.Vector3}
     */
    static inferCenterFromBounds(bounds) {
        if (!bounds) {
            return new THREE.Vector3()
        }

        return new THREE.Vector3(
            ((bounds.minX ?? 0) + (bounds.maxX ?? 0)) * 0.5,
            ((bounds.minY ?? 0) + (bounds.maxY ?? 0)) * 0.5,
            ((bounds.minZ ?? 0) + (bounds.maxZ ?? 0)) * 0.5
        )
    }

    /**
     * Generate random control points for a smooth curve inside a sphere.
     * @param {Object} options - Configuration options
     * @param {THREE.Vector3} options.start - Start position (optional, random inside sphere if not provided)
     * @param {THREE.Vector3} options.end - End position (optional, random inside sphere if not provided)
     * @param {number} options.numControlPoints - Number of intermediate control points (default: 2-4 random)
     * @param {number} options.spread - Radius of random offset applied to intermediate points (default: 60% of sphere radius)
     * @param {number} options.radius - Radius of the sphere containing the curve (default: 3000 or inferred from bounds)
     * @param {THREE.Vector3} options.center - Center of the sphere (default: origin or inferred from bounds)
     * @param {Object} options.bounds - Legacy bounding box config (used to infer radius/center if provided)
     * @returns {Array<THREE.Vector3>} Array of control points including start and end
     */
    static generateRandomCurve(options = {}) {
        const center = options.center
            ? options.center.clone()
            : this.inferCenterFromBounds(options.bounds)

        const radius = options.radius !== undefined
            ? options.radius
            : this.inferRadiusFromBounds(options.bounds)

        const spread = Math.min(
            options.spread !== undefined ? options.spread : radius * 0.6,
            radius
        )

        const start = options.start ? options.start.clone() : this.randomPointInSphere(radius).add(center)
        this.clampToSphere(start, radius, center)

        const end = options.end ? options.end.clone() : this.randomPointInSphere(radius).add(center)
        this.clampToSphere(end, radius, center)

        const numControlPoints = options.numControlPoints !== undefined
            ? options.numControlPoints
            : Math.floor(THREE.MathUtils.randFloat(2, 5))

        const controlPoints = [start]

        for (let i = 1; i <= numControlPoints; i++) {
            const t = i / (numControlPoints + 1)
            const basePoint = new THREE.Vector3().lerpVectors(start, end, t)
            const offset = this.randomPointInSphere(spread)
            const controlPoint = basePoint.add(offset)

            this.clampToSphere(controlPoint, radius, center)
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
            curveColor: options.curveColor || this.generateRandomColor(),
            paneCount: options.paneCount || 1,
            paneSize: options.paneSize || THREE.MathUtils.randFloat(80, 150),
            paneColor: options.paneColor || this.generateRandomColor(),
            animationSpeed: options.animationSpeed || THREE.MathUtils.randFloat(0.05, 0.15),
            tiltMode: options.tiltMode || 'Perpendicular'
        }
    }
}

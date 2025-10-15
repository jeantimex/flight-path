import * as THREE from 'three'

/**
 * Interface for bounding box configuration
 */
interface Bounds {
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    minZ?: number;
    maxZ?: number;
}

/**
 * Interface for random curve generation options
 */
interface RandomCurveOptions {
    start?: THREE.Vector3;
    end?: THREE.Vector3;
    numControlPoints?: number;
    spread?: number;
    radius?: number;
    center?: THREE.Vector3;
    bounds?: Bounds;
}

/**
 * Interface for color generation options
 */
interface ColorOptions {
    saturation?: number;
    lightness?: number;
}

/**
 * Interface for flight configuration options
 */
interface FlightConfigOptions extends RandomCurveOptions {
    segmentCount?: number;
    curveColor?: number;
    paneCount?: number;
    paneSize?: number;
    paneColor?: number;
    animationSpeed?: number;
    tiltMode?: string;
    returnFlight?: boolean;
}

/**
 * Interface for generated flight configuration
 */
export interface FlightConfig {
    controlPoints: THREE.Vector3[];
    segmentCount: number;
    curveColor: number;
    paneCount: number;
    paneSize: number;
    paneColor: number;
    animationSpeed: number;
    tiltMode: string;
    returnFlight: boolean;
}

/**
 * Utility functions for generating flight paths and control points
 */
export class FlightUtils {
    /**
     * Generate a random point inside a sphere centered at the origin.
     * @param radius - Sphere radius
     * @returns Random point inside sphere
     */
    static randomPointInSphere(radius: number): THREE.Vector3 {
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
     * @param vector - Vector to clamp (mutated in place)
     * @param radius - Sphere radius
     * @param center - Sphere center
     * @returns The clamped vector
     */
    static clampToSphere(vector: THREE.Vector3, radius: number, center: THREE.Vector3): THREE.Vector3 {
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
     * @param bounds - Legacy bounds configuration
     * @returns Inferred radius
     */
    static inferRadiusFromBounds(bounds?: Bounds): number {
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
     * @param bounds - Legacy bounds configuration
     * @returns Inferred center point
     */
    static inferCenterFromBounds(bounds?: Bounds): THREE.Vector3 {
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
     * @param options - Configuration options
     * @returns Array of control points including start and end
     */
    static generateRandomCurve(options: RandomCurveOptions = {}): THREE.Vector3[] {
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

        const controlPoints: THREE.Vector3[] = [start]

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
     * @param options - Color generation options
     * @returns Color as hex number
     */
    static generateRandomColor(options: ColorOptions = {}): number {
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
     * @param options - Configuration options
     * @returns Flight configuration object
     */
    static generateRandomFlightConfig(options: FlightConfigOptions = {}): FlightConfig {
        const controlPoints = this.generateRandomCurve(options)

        return {
            controlPoints,
            segmentCount: options.segmentCount || 100,
            curveColor: options.curveColor || this.generateRandomColor(),
            paneCount: options.paneCount || 1,
            paneSize: options.paneSize || THREE.MathUtils.randFloat(80, 150),
            paneColor: options.paneColor || this.generateRandomColor(),
            animationSpeed: options.animationSpeed || THREE.MathUtils.randFloat(0.05, 0.15),
            tiltMode: options.tiltMode || 'Perpendicular',
            returnFlight: options.returnFlight || false
        }
    }
}
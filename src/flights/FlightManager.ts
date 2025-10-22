/**
 * Flight Manager (WebGPU)
 * Manages 1M flight simulations using compute shaders
 */

import flightUpdateShader from '../shaders/flightUpdate.wgsl?raw';
import type { Geolocation, Flight as FlightData } from '../common/Data.ts';

export interface FlightManagerConfig {
  flightCount?: number;
  earthRadius?: number;
  minAltitude?: number;
  maxAltitude?: number;
  planeTextureCount?: number; // Number of plane textures in atlas
  flightData?: FlightData[];
}

export class FlightManager {
  private device: GPUDevice;
  private flightCount: number; // Total allocated
  private visibleFlightCount: number; // Currently visible/active
  private earthRadius: number;
  private minAltitude: number;
  private maxAltitude: number;
  private planeTextureCount: number;
  private flightData: FlightData[];

  // Uniform buffer size constant
  private static readonly UNIFORM_BUFFER_SIZE = 64; // deltaTime + earthRadius + animationSpeed + cullingDistance + cameraPosition + frameNumber + cameraDirection + segmentsPerCurve + decimation + pad

  // Buffers
  private controlPointsBuffer: GPUBuffer | null = null;
  private flightStateBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Compute pipeline
  private computePipeline: GPUComputePipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  // Curve rendering integration (merged shader)
  private curveLineVerticesBuffer: GPUBuffer | null = null;
  private curveSegmentsPerCurve: number = 16;
  private curveDecimation: number = 1;

  // Reusable uniform data
  private uniformData: Float32Array;

  // Animation speed control
  private animationSpeed: number = 1.0; // Default 1.0 (matches GUI 0.1 * 10x scaling)

  // Frame counter for temporal updates
  private frameNumber: number = 0;

  constructor(device: GPUDevice, config: FlightManagerConfig = {}) {
    this.device = device;
    // Always allocate for 1M flights (Option B: pre-allocate max)
    this.flightCount = 1000000;
    this.visibleFlightCount = config.flightCount ?? 1000; // Start with 1K visible
    this.earthRadius = config.earthRadius ?? 3000;
    this.minAltitude = config.minAltitude ?? 30;
    this.maxAltitude = config.maxAltitude ?? 220;
    this.planeTextureCount = config.planeTextureCount ?? 1;
    this.flightData = config.flightData ?? [];

    // Allocate uniform data buffer (reused every frame)
    // deltaTime (4) + earthRadius (4) + animationSpeed (4) + cullingDistance (4) + cameraPosition (12) + frameNumber (4) + cameraDirection (12) + segmentsPerCurve (4) + decimation (4) + pad (8) = 64 bytes
    this.uniformData = new Float32Array(16);
    this.uniformData[1] = this.earthRadius;
    this.uniformData[2] = this.animationSpeed;
    this.uniformData[3] = 20000; // Default culling distance (covers most of visible globe)
    // Note: uniformData[7] will be written as u32 via Uint32Array view (frameNumber)
    // Note: uniformData[8-10] will be normalized camera direction
    // Note: uniformData[11-12] will be curve params (segmentsPerCurve, decimation) as u32

    // Initialize buffers
    this.createBuffers();
    this.initializeFlightData();
  }

  private createBuffers(): void {
    // Control Points Buffer (144MB for 1M flights)
    // 9 control points × vec3 (12 bytes) = 108 bytes per flight
    // Aligned to 16 bytes: 9 × vec4 (16 bytes) = 144 bytes per flight
    const controlPointsSize = this.flightCount * 144;
    this.controlPointsBuffer = this.device.createBuffer({
      size: controlPointsSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Flight State Buffer (16MB for 1M flights)
    // t (4) + speed (4) + packedColor (4) + packedSizeFlags (4) = 16 bytes per flight
    const flightStateSize = this.flightCount * 16;
    this.flightStateBuffer = this.device.createBuffer({
      size: flightStateSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Output Buffer (32MB for 1M flights)
    // position (12 + 4 pad) + direction (12 + 4 pad) = 32 bytes per flight
    const outputSize = this.flightCount * 32;
    this.outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    });

    // Uniform Buffer
    this.uniformBuffer = this.device.createBuffer({
      size: FlightManager.UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const totalSize = (controlPointsSize + flightStateSize + outputSize + 16) / 1024 / 1024;
    console.log(`✅ Flight buffers created (${this.flightCount} flights, ${totalSize.toFixed(2)}MB)`);
  }

  private initializeFlightData(): void {
    // Constants for curve generation - reduced for paths aligned with Earth
    const BULGE_MIN = 0.05; // Minimum bulge amount (5% of altitude)
    const BULGE_MAX = 0.15; // Maximum bulge amount (15% of altitude)
    const BULGE_INFLUENCE = 0.3; // How much bulge affects control points
    const TANGENT_EXTENSION = 0.15; // How far to extend p0/p3 from p1/p2
    const EPSILON = 0.001; // Threshold for detecting parallel vectors
    const FALLBACK_BULGE = 0.1; // Fallback bulge for edge cases

    // Helper: Calculate vector magnitude
    const magnitude = (v: { x: number; y: number; z: number }) =>
      Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);

    // Helper: Normalize vector
    const normalize = (v: { x: number; y: number; z: number }) => {
      const mag = magnitude(v);
      return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
    };

    // Helper: Cross product
    const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    });

    // Generate control points for parabolic curves (9 points)
    const controlPointsData = new Float32Array(this.flightCount * 36); // 9 vec4 per flight

    // Generate random flight states
    const flightStateData = new Uint32Array(this.flightCount * 4); // 4 u32 per flight

    for (let i = 0; i < this.flightCount; i++) {
      const cpOffset = i * 36;
      const stateOffset = i * 4;

      // Use city data if available, otherwise random points
      let p0, p1, p2, p3, p4, p5, p6, p7, p8;

      if (this.flightData.length > 0) {
        // City-to-city flight: use 9-point parabolic arc (matches main branch)
        // Randomize selection across entire dataset for geographic diversity
        const flightIndex = Math.floor(Math.random() * this.flightData.length);
        const flight = this.flightData[flightIndex];

        const departure = this.latLngToVector3(flight.departure.lat, flight.departure.lng, this.earthRadius);
        const arrival = this.latLngToVector3(flight.arrival.lat, flight.arrival.lng, this.earthRadius);

        // Calculate distance and cruise altitude (matches main branch logic)
        const dx = arrival.x - departure.x;
        const dy = arrival.y - departure.y;
        const dz = arrival.z - departure.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const maxDistance = this.earthRadius * Math.PI;
        const distanceRatio = Math.min(distance / (maxDistance * 0.3), 1);
        const cruiseAltitude = this.minAltitude + (this.maxAltitude - this.minAltitude) * Math.pow(distanceRatio, 0.7);

        // Copy exact logic from main branch (FlightUtils.ts generateParabolicControlPoints)
        const depNorm = normalize(departure);
        const arrNorm = normalize(arrival);

        // Helper: lerp + normalize + scale (matches main's Three.js .lerp().normalize().multiplyScalar())
        const lerpNormScale = (a: {x: number, y: number, z: number}, b: {x: number, y: number, z: number}, t: number, scale: number) => {
          const lerped = { x: a.x * (1-t) + b.x * t, y: a.y * (1-t) + b.y * t, z: a.z * (1-t) + b.z * t };
          const norm = normalize(lerped);
          return { x: norm.x * scale, y: norm.y * scale, z: norm.z * scale };
        };

        // p1: startSurface - at minimum altitude
        p1 = {
          x: depNorm.x * (this.earthRadius + this.minAltitude),
          y: depNorm.y * (this.earthRadius + this.minAltitude),
          z: depNorm.z * (this.earthRadius + this.minAltitude),
        };

        // p7: endSurface - at minimum altitude
        p7 = {
          x: arrNorm.x * (this.earthRadius + this.minAltitude),
          y: arrNorm.y * (this.earthRadius + this.minAltitude),
          z: arrNorm.z * (this.earthRadius + this.minAltitude),
        };

        // p2: climbPoint1 (20% along, 40% altitude)
        p2 = lerpNormScale(p1, p7, 0.20, this.earthRadius + cruiseAltitude * 0.40);

        // p3: climbPoint2 (35% along, 75% altitude)
        p3 = lerpNormScale(p1, p7, 0.35, this.earthRadius + cruiseAltitude * 0.75);

        // p4: cruisePeak (50% along, 85% altitude)
        p4 = lerpNormScale(p1, p7, 0.50, this.earthRadius + cruiseAltitude * 0.85);

        // p5: descentPoint1 (65% along, 75% altitude)
        p5 = lerpNormScale(p1, p7, 0.65, this.earthRadius + cruiseAltitude * 0.75);

        // p6: descentPoint2 (80% along, 40% altitude)
        p6 = lerpNormScale(p1, p7, 0.80, this.earthRadius + cruiseAltitude * 0.40);

        // p0: startTangentPoint - main's tangent calculation
        const startNormal = depNorm;
        let pathDirStart = { x: dx, y: dy, z: dz };
        const dotStart = pathDirStart.x * startNormal.x + pathDirStart.y * startNormal.y + pathDirStart.z * startNormal.z;
        let tangentStart = {
          x: pathDirStart.x - startNormal.x * dotStart,
          y: pathDirStart.y - startNormal.y * dotStart,
          z: pathDirStart.z - startNormal.z * dotStart,
        };
        const tangentStartMag = Math.sqrt(tangentStart.x**2 + tangentStart.y**2 + tangentStart.z**2);
        if (tangentStartMag > 1e-6) {
          tangentStart = { x: tangentStart.x / tangentStartMag, y: tangentStart.y / tangentStartMag, z: tangentStart.z / tangentStartMag };
        } else {
          tangentStart = { x: 1, y: 0, z: 0 };
        }
        const tangentDistance = this.earthRadius * 0.08;
        const p0Temp = {
          x: p1.x + tangentStart.x * tangentDistance,
          y: p1.y + tangentStart.y * tangentDistance,
          z: p1.z + tangentStart.z * tangentDistance,
        };
        const p0Norm = normalize(p0Temp);
        const surfaceLength = Math.sqrt(p1.x**2 + p1.y**2 + p1.z**2);
        p0 = { x: p0Norm.x * surfaceLength, y: p0Norm.y * surfaceLength, z: p0Norm.z * surfaceLength };

        // p8: endTangentPoint - main's tangent calculation
        const endNormal = arrNorm;
        let pathDirEnd = { x: -dx, y: -dy, z: -dz };
        const dotEnd = pathDirEnd.x * endNormal.x + pathDirEnd.y * endNormal.y + pathDirEnd.z * endNormal.z;
        let tangentEnd = {
          x: pathDirEnd.x - endNormal.x * dotEnd,
          y: pathDirEnd.y - endNormal.y * dotEnd,
          z: pathDirEnd.z - endNormal.z * dotEnd,
        };
        const tangentEndMag = Math.sqrt(tangentEnd.x**2 + tangentEnd.y**2 + tangentEnd.z**2);
        if (tangentEndMag > 1e-6) {
          tangentEnd = { x: tangentEnd.x / tangentEndMag, y: tangentEnd.y / tangentEndMag, z: tangentEnd.z / tangentEndMag };
        } else {
          tangentEnd = { x: 1, y: 0, z: 0 };
        }
        const p8Temp = {
          x: p7.x + tangentEnd.x * tangentDistance,
          y: p7.y + tangentEnd.y * tangentDistance,
          z: p7.z + tangentEnd.z * tangentDistance,
        };
        const p8Norm = normalize(p8Temp);
        const endSurfaceLength = Math.sqrt(p7.x**2 + p7.y**2 + p7.z**2);
        p8 = { x: p8Norm.x * endSurfaceLength, y: p8Norm.y * endSurfaceLength, z: p8Norm.z * endSurfaceLength };
      } else {
        // Random flight: expand to 9 points for consistency
        const start = this.randomPointOnSphere();
        const end = this.randomPointOnSphere();

        const altitude = this.earthRadius + this.minAltitude +
                        Math.random() * (this.maxAltitude - this.minAltitude);

        // Normalize start and end points
        const startNorm = normalize(start);
        const endNorm = normalize(end);

        // Helper: lerp + normalize + scale
        const lerpNormScale = (a: {x: number, y: number, z: number}, b: {x: number, y: number, z: number}, t: number, scale: number) => {
          const lerped = { x: a.x * (1-t) + b.x * t, y: a.y * (1-t) + b.y * t, z: a.z * (1-t) + b.z * t };
          const norm = normalize(lerped);
          return { x: norm.x * scale, y: norm.y * scale, z: norm.z * scale };
        };

        // p1: start point at min altitude
        p1 = {
          x: startNorm.x * (this.earthRadius + this.minAltitude),
          y: startNorm.y * (this.earthRadius + this.minAltitude),
          z: startNorm.z * (this.earthRadius + this.minAltitude),
        };

        // p7: end point at min altitude
        p7 = {
          x: endNorm.x * (this.earthRadius + this.minAltitude),
          y: endNorm.y * (this.earthRadius + this.minAltitude),
          z: endNorm.z * (this.earthRadius + this.minAltitude),
        };

        // Create parabolic arc with 9 points
        p2 = lerpNormScale(p1, p7, 0.20, this.earthRadius + altitude * 0.40);
        p3 = lerpNormScale(p1, p7, 0.35, this.earthRadius + altitude * 0.75);
        p4 = lerpNormScale(p1, p7, 0.50, this.earthRadius + altitude * 0.85);
        p5 = lerpNormScale(p1, p7, 0.65, this.earthRadius + altitude * 0.75);
        p6 = lerpNormScale(p1, p7, 0.80, this.earthRadius + altitude * 0.40);

        // Calculate perpendicular direction for tangent points
        const perp = cross(startNorm, endNorm);
        const perpMag = magnitude(perp);

        // Tangent extension distance
        const tangentDistance = this.earthRadius * 0.08;

        // p0: tangent before start
        if (perpMag > EPSILON) {
          const perpNorm = normalize(perp);
          const tangentDir = {
            x: -startNorm.x * 0.5 + perpNorm.x * 0.3,
            y: -startNorm.y * 0.5 + perpNorm.y * 0.3,
            z: -startNorm.z * 0.5 + perpNorm.z * 0.3,
          };
          const tangentNorm = normalize(tangentDir);
          const p0Temp = {
            x: p1.x + tangentNorm.x * tangentDistance,
            y: p1.y + tangentNorm.y * tangentDistance,
            z: p1.z + tangentNorm.z * tangentDistance,
          };
          const p0Norm = normalize(p0Temp);
          const surfaceLength = Math.sqrt(p1.x**2 + p1.y**2 + p1.z**2);
          p0 = { x: p0Norm.x * surfaceLength, y: p0Norm.y * surfaceLength, z: p0Norm.z * surfaceLength };
        } else {
          p0 = p1;
        }

        // p8: tangent after end
        if (perpMag > EPSILON) {
          const perpNorm = normalize(perp);
          const tangentDir = {
            x: endNorm.x * 0.5 + perpNorm.x * 0.3,
            y: endNorm.y * 0.5 + perpNorm.y * 0.3,
            z: endNorm.z * 0.5 + perpNorm.z * 0.3,
          };
          const tangentNorm = normalize(tangentDir);
          const p8Temp = {
            x: p7.x + tangentNorm.x * tangentDistance,
            y: p7.y + tangentNorm.y * tangentDistance,
            z: p7.z + tangentNorm.z * tangentDistance,
          };
          const p8Norm = normalize(p8Temp);
          const endSurfaceLength = Math.sqrt(p7.x**2 + p7.y**2 + p7.z**2);
          p8 = { x: p8Norm.x * endSurfaceLength, y: p8Norm.y * endSurfaceLength, z: p8Norm.z * endSurfaceLength };
        } else {
          p8 = p7;
        }
      }

      // Store all 9 control points (vec4 aligned)
      controlPointsData[cpOffset + 0] = p0.x;
      controlPointsData[cpOffset + 1] = p0.y;
      controlPointsData[cpOffset + 2] = p0.z;
      controlPointsData[cpOffset + 3] = 0; // pad

      controlPointsData[cpOffset + 4] = p1.x;
      controlPointsData[cpOffset + 5] = p1.y;
      controlPointsData[cpOffset + 6] = p1.z;
      controlPointsData[cpOffset + 7] = 0; // pad

      controlPointsData[cpOffset + 8] = p2.x;
      controlPointsData[cpOffset + 9] = p2.y;
      controlPointsData[cpOffset + 10] = p2.z;
      controlPointsData[cpOffset + 11] = 0; // pad

      controlPointsData[cpOffset + 12] = p3.x;
      controlPointsData[cpOffset + 13] = p3.y;
      controlPointsData[cpOffset + 14] = p3.z;
      controlPointsData[cpOffset + 15] = 0; // pad

      controlPointsData[cpOffset + 16] = p4.x;
      controlPointsData[cpOffset + 17] = p4.y;
      controlPointsData[cpOffset + 18] = p4.z;
      controlPointsData[cpOffset + 19] = 0; // pad

      controlPointsData[cpOffset + 20] = p5.x;
      controlPointsData[cpOffset + 21] = p5.y;
      controlPointsData[cpOffset + 22] = p5.z;
      controlPointsData[cpOffset + 23] = 0; // pad

      controlPointsData[cpOffset + 24] = p6.x;
      controlPointsData[cpOffset + 25] = p6.y;
      controlPointsData[cpOffset + 26] = p6.z;
      controlPointsData[cpOffset + 27] = 0; // pad

      controlPointsData[cpOffset + 28] = p7.x;
      controlPointsData[cpOffset + 29] = p7.y;
      controlPointsData[cpOffset + 30] = p7.z;
      controlPointsData[cpOffset + 31] = 0; // pad

      controlPointsData[cpOffset + 32] = p8.x;
      controlPointsData[cpOffset + 33] = p8.y;
      controlPointsData[cpOffset + 34] = p8.z;
      controlPointsData[cpOffset + 35] = 0; // pad

      // Flight state
      const stateDataF32 = new Float32Array(flightStateData.buffer, stateOffset * 4, 2);
      stateDataF32[0] = Math.random(); // t: random start position
      stateDataF32[1] = 0.5 + Math.random(); // speed: 0.5 to 1.5 (centered at 1.0)

      // Packed color (RGBA8)
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      flightStateData[stateOffset + 2] = (r << 24) | (g << 16) | (b << 8) | 255;

      // Packed size + textureIndex + flags
      const size = 3 + Math.random() * 5; // 3 to 8
      const isReturnFlight = Math.random() > 0.5;
      const textureIndex = Math.floor(Math.random() * this.planeTextureCount);
      const flags = isReturnFlight ? 1 : 0;
      flightStateData[stateOffset + 3] = (Math.floor(size) << 16) | (textureIndex << 8) | flags;
    }

    // Upload data to GPU
    this.device.queue.writeBuffer(this.controlPointsBuffer!, 0, controlPointsData);
    this.device.queue.writeBuffer(this.flightStateBuffer!, 0, flightStateData);

    console.log(`✅ Flight data initialized (${this.flightCount} flights)`);
  }

  private randomPointOnSphere(): { x: number; y: number; z: number } {
    // Uniform random point on sphere surface
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = this.earthRadius * Math.sin(phi) * Math.cos(theta);
    const y = this.earthRadius * Math.sin(phi) * Math.sin(theta);
    const z = this.earthRadius * Math.cos(phi);

    return { x, y, z };
  }

  private latLngToVector3(lat: number, lng: number, radius: number): { x: number; y: number; z: number } {
    // Convert lat/lng to 3D point (matches main branch Utils.latLngToVector3)
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = ((-lng + 180) * Math.PI) / 180;

    // Standard spherical to cartesian
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    // Apply coordinate transformation for Earth's -90° Y rotation
    const rotatedX = z;
    const rotatedY = y;
    const rotatedZ = -x;

    return { x: rotatedX, y: rotatedY, z: rotatedZ };
  }

  public createPipeline(): void {
    // Create compute shader module
    const shaderModule = this.device.createShaderModule({
      code: flightUpdateShader,
    });

    // Create bind group layout (with curve buffer support)
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }, // Curve line vertices (optional, set later)
        },
      ],
    });

    // Create bind group (will be recreated when curve buffer is set)
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.controlPointsBuffer! } },
        { binding: 2, resource: { buffer: this.flightStateBuffer! } },
        { binding: 3, resource: { buffer: this.outputBuffer! } },
        { binding: 4, resource: { buffer: this.outputBuffer! } }, // Dummy buffer (replaced when curve buffer set)
      ],
    });

    // Create compute pipeline
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    console.log('✅ Flight compute pipeline created');
  }

  public setCurveBuffer(curveLineVerticesBuffer: GPUBuffer, segmentsPerCurve: number, decimation: number): void {
    this.curveLineVerticesBuffer = curveLineVerticesBuffer;
    this.curveSegmentsPerCurve = segmentsPerCurve;
    this.curveDecimation = decimation;

    // Recreate bind group with curve buffer
    if (this.bindGroupLayout) {
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: { buffer: this.controlPointsBuffer! } },
          { binding: 2, resource: { buffer: this.flightStateBuffer! } },
          { binding: 3, resource: { buffer: this.outputBuffer! } },
          { binding: 4, resource: { buffer: this.curveLineVerticesBuffer } },
        ],
      });

      console.log('✅ Curve buffer bound to flight manager (merged shader enabled)');
    }
  }

  public updateCurveParams(segmentsPerCurve: number, decimation: number): void {
    this.curveSegmentsPerCurve = segmentsPerCurve;
    this.curveDecimation = decimation;
  }

  public update(commandEncoder: GPUCommandEncoder, deltaTime: number, cameraPosition: [number, number, number]): void {
    if (!this.computePipeline || !this.bindGroup) {
      return; // Pipeline not ready
    }

    // Update uniforms
    this.uniformData[0] = deltaTime;
    // uniformData[1] = earthRadius (static)
    // uniformData[2] = animationSpeed (static, updated via setAnimationSpeed)
    // uniformData[3] = cullingDistance (static)
    this.uniformData[4] = cameraPosition[0];
    this.uniformData[5] = cameraPosition[1];
    this.uniformData[6] = cameraPosition[2];
    // uniformData[7] = frameNumber (write as u32)
    const uniformDataU32 = new Uint32Array(this.uniformData.buffer);
    uniformDataU32[7] = this.frameNumber;
    this.frameNumber++; // Increment for next frame

    // Precompute normalized camera direction (saves 1M normalize operations in shader)
    const camLength = Math.sqrt(
      cameraPosition[0] * cameraPosition[0] +
      cameraPosition[1] * cameraPosition[1] +
      cameraPosition[2] * cameraPosition[2]
    );
    this.uniformData[8] = cameraPosition[0] / camLength;
    this.uniformData[9] = cameraPosition[1] / camLength;
    this.uniformData[10] = cameraPosition[2] / camLength;

    // Curve tessellation params (write as u32)
    uniformDataU32[11] = this.curveSegmentsPerCurve;
    uniformDataU32[12] = this.curveDecimation;

    this.device.queue.writeBuffer(this.uniformBuffer!, 0, this.uniformData.buffer);

    // Dispatch compute shader
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroup);

    // Dispatch workgroups: visibleFlightCount / 64 threads per workgroup
    // WebGPU limit: max 65535 workgroups per dimension
    const workgroupCount = Math.ceil(this.visibleFlightCount / 64);
    const maxWorkgroupsPerDim = 65535;

    if (workgroupCount <= maxWorkgroupsPerDim) {
      // Simple 1D dispatch
      computePass.dispatchWorkgroups(workgroupCount);
    } else {
      // 2D dispatch for large counts
      const x = maxWorkgroupsPerDim;
      const y = Math.ceil(workgroupCount / maxWorkgroupsPerDim);
      computePass.dispatchWorkgroups(x, y, 1);
    }

    computePass.end();
  }

  public getOutputBuffer(): GPUBuffer | null {
    return this.outputBuffer;
  }

  public getFlightStateBuffer(): GPUBuffer | null {
    return this.flightStateBuffer;
  }

  public getControlPointsBuffer(): GPUBuffer | null {
    return this.controlPointsBuffer;
  }

  public getFlightCount(): number {
    return this.flightCount;
  }

  public getVisibleFlightCount(): number {
    return this.visibleFlightCount;
  }

  public setVisibleFlightCount(count: number): void {
    this.visibleFlightCount = Math.max(1, Math.min(count, this.flightCount));
  }

  public setAnimationSpeed(speed: number): void {
    this.animationSpeed = Math.max(0.01, Math.min(speed, 1.0));
    this.uniformData[2] = this.animationSpeed;
  }

  public setCullingDistance(distance: number): void {
    this.uniformData[3] = Math.max(1000, distance);
  }

  public getCullingDistance(): number {
    return this.uniformData[3];
  }

  public destroy(): void {
    this.controlPointsBuffer?.destroy();
    this.flightStateBuffer?.destroy();
    this.outputBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}

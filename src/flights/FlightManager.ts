/**
 * Flight Manager (WebGPU)
 * Manages 1M flight simulations using compute shaders
 */

import flightUpdateShader from '../shaders/flightUpdate.wgsl?raw';

export interface FlightManagerConfig {
  flightCount?: number;
  earthRadius?: number;
  minAltitude?: number;
  maxAltitude?: number;
  planeTextureCount?: number; // Number of plane textures in atlas
}

export class FlightManager {
  private device: GPUDevice;
  private flightCount: number; // Total allocated
  private visibleFlightCount: number; // Currently visible/active
  private earthRadius: number;
  private minAltitude: number;
  private maxAltitude: number;
  private planeTextureCount: number;

  // Buffers
  private controlPointsBuffer: GPUBuffer | null = null;
  private flightStateBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Compute pipeline
  private computePipeline: GPUComputePipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;

  // Reusable uniform data
  private uniformData: Float32Array;

  constructor(device: GPUDevice, config: FlightManagerConfig = {}) {
    this.device = device;
    // Always allocate for 1M flights (Option B: pre-allocate max)
    this.flightCount = 1000000;
    this.visibleFlightCount = config.flightCount ?? 1000; // Start with 1K visible
    this.earthRadius = config.earthRadius ?? 3000;
    this.minAltitude = config.minAltitude ?? 30;
    this.maxAltitude = config.maxAltitude ?? 220;
    this.planeTextureCount = config.planeTextureCount ?? 1;

    // Allocate uniform data buffer (reused every frame)
    // deltaTime (4) + earthRadius (4) + pad (8) = 16 bytes
    this.uniformData = new Float32Array(4);
    this.uniformData[1] = this.earthRadius;

    // Initialize buffers
    this.createBuffers();
    this.initializeFlightData();
  }

  private createBuffers(): void {
    // Control Points Buffer (48MB for 1M flights)
    // 4 control points × vec3 (12 bytes) = 48 bytes per flight
    // Aligned to 16 bytes: 4 × vec4 (16 bytes) = 64 bytes per flight
    const controlPointsSize = this.flightCount * 64;
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

    // Uniform Buffer (16 bytes)
    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const totalSize = (controlPointsSize + flightStateSize + outputSize + 16) / 1024 / 1024;
    console.log(`✅ Flight buffers created (${this.flightCount} flights, ${totalSize.toFixed(2)}MB)`);
  }

  private initializeFlightData(): void {
    // Constants for curve generation
    const BULGE_MIN = 0.2; // Minimum bulge amount (20% of altitude)
    const BULGE_MAX = 0.4; // Maximum bulge amount (40% of altitude)
    const BULGE_INFLUENCE = 0.5; // How much bulge affects control points
    const TANGENT_EXTENSION = 0.2; // How far to extend p0/p3 from p1/p2
    const EPSILON = 0.001; // Threshold for detecting parallel vectors
    const FALLBACK_BULGE = 0.3; // Fallback bulge for edge cases

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

    // Generate random control points for Catmull-Rom curves
    const controlPointsData = new Float32Array(this.flightCount * 16); // 4 vec4 per flight

    // Generate random flight states
    const flightStateData = new Uint32Array(this.flightCount * 4); // 4 u32 per flight

    for (let i = 0; i < this.flightCount; i++) {
      const cpOffset = i * 16;
      const stateOffset = i * 4;

      // Generate random start and end points on sphere
      const start = this.randomPointOnSphere();
      const end = this.randomPointOnSphere();

      // Generate 4 control points for Catmull-Rom curve with visible curvature
      // Strategy: Create lateral bulge perpendicular to great circle path
      // This makes curves deviate from geodesic, creating visible arcs

      const altitude = this.earthRadius + this.minAltitude +
                      Math.random() * (this.maxAltitude - this.minAltitude);

      // Normalize start and end points
      const startNorm = normalize(start);
      const endNorm = normalize(end);

      // p1: start point at cruise altitude
      const p1 = {
        x: startNorm.x * altitude,
        y: startNorm.y * altitude,
        z: startNorm.z * altitude,
      };

      // p2: end point at cruise altitude
      const p2 = {
        x: endNorm.x * altitude,
        y: endNorm.y * altitude,
        z: endNorm.z * altitude,
      };

      // Calculate perpendicular direction for bulge (cross product of start and end)
      const perp = cross(startNorm, endNorm);
      const perpMag = magnitude(perp);

      // Random bulge amount for visible curvature
      const bulgeAmount = (BULGE_MIN + Math.random() * (BULGE_MAX - BULGE_MIN)) * altitude;

      // Random bulge direction (50% chance to bulge left or right)
      const bulgeDir = Math.random() > 0.5 ? 1 : -1;

      let bulge: { x: number; y: number; z: number };
      if (perpMag > EPSILON) {
        // Normal case: add perpendicular bulge
        const perpNorm = normalize(perp);
        bulge = {
          x: perpNorm.x * bulgeAmount * bulgeDir,
          y: perpNorm.y * bulgeAmount * bulgeDir,
          z: perpNorm.z * bulgeAmount * bulgeDir,
        };
      } else {
        // Edge case: start and end are opposite points, use arbitrary perpendicular
        bulge = {
          x: altitude * FALLBACK_BULGE,
          y: altitude * FALLBACK_BULGE,
          z: 0,
        };
      }

      // p0: position before p1, with bulge to create curved entry
      const p0_unnorm = {
        x: startNorm.x - (endNorm.x - startNorm.x) * TANGENT_EXTENSION + bulge.x * BULGE_INFLUENCE,
        y: startNorm.y - (endNorm.y - startNorm.y) * TANGENT_EXTENSION + bulge.y * BULGE_INFLUENCE,
        z: startNorm.z - (endNorm.z - startNorm.z) * TANGENT_EXTENSION + bulge.z * BULGE_INFLUENCE,
      };
      const p0Norm = normalize(p0_unnorm);
      const p0 = {
        x: p0Norm.x * altitude,
        y: p0Norm.y * altitude,
        z: p0Norm.z * altitude,
      };

      // p3: position after p2, with bulge to create curved exit
      const p3_unnorm = {
        x: endNorm.x + (endNorm.x - startNorm.x) * TANGENT_EXTENSION + bulge.x * BULGE_INFLUENCE,
        y: endNorm.y + (endNorm.y - startNorm.y) * TANGENT_EXTENSION + bulge.y * BULGE_INFLUENCE,
        z: endNorm.z + (endNorm.z - startNorm.z) * TANGENT_EXTENSION + bulge.z * BULGE_INFLUENCE,
      };
      const p3Norm = normalize(p3_unnorm);
      const p3 = {
        x: p3Norm.x * altitude,
        y: p3Norm.y * altitude,
        z: p3Norm.z * altitude,
      };

      // Store control points (vec4 aligned)
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

      // Flight state
      const stateDataF32 = new Float32Array(flightStateData.buffer, stateOffset * 4, 2);
      stateDataF32[0] = Math.random(); // t: random start position
      stateDataF32[1] = 0.05 + Math.random() * 0.15; // speed: 0.05 to 0.2 (original speed)

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

  public createPipeline(): void {
    // Create compute shader module
    const shaderModule = this.device.createShaderModule({
      code: flightUpdateShader,
    });

    // Create bind group layout
    const bindGroupLayout = this.device.createBindGroupLayout({
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
      ],
    });

    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.controlPointsBuffer! } },
        { binding: 2, resource: { buffer: this.flightStateBuffer! } },
        { binding: 3, resource: { buffer: this.outputBuffer! } },
      ],
    });

    // Create compute pipeline
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    console.log('✅ Flight compute pipeline created');
  }

  public update(commandEncoder: GPUCommandEncoder, deltaTime: number): void {
    if (!this.computePipeline || !this.bindGroup) {
      return; // Pipeline not ready
    }

    // Update uniforms
    this.uniformData[0] = deltaTime;
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

  public destroy(): void {
    this.controlPointsBuffer?.destroy();
    this.flightStateBuffer?.destroy();
    this.outputBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}

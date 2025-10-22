/**
 * Curve Manager (WebGPU)
 * Manages curve tessellation and rendering for flight paths
 * Uses compute shader to generate line vertices from Catmull-Rom curves
 */

import type { PerspectiveCamera } from '../core/PerspectiveCamera.ts';
import type { FlightManager } from '../flights/FlightManager.ts';
import curveTessellationShader from '../shaders/curveTessellation.wgsl?raw';
import curvesShader from '../shaders/curves.wgsl?raw';

export interface CurveManagerConfig {
  segmentsPerCurve?: number; // Number of line segments per curve
}

export class CurveManager {
  private device: GPUDevice;
  private segmentsPerCurve: number;
  private flightManager: FlightManager | null = null;

  // Buffers
  private lineVerticesBuffer: GPUBuffer | null = null;

  // Compute pipeline (tessellation)
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private computeUniformBuffer: GPUBuffer | null = null;

  // Render pipeline
  private renderPipeline: GPURenderPipeline | null = null;
  private renderBindGroup: GPUBindGroup | null = null;
  private renderUniformBuffer: GPUBuffer | null = null;

  // Visibility
  private curvesVisible: boolean = true;

  // Dash parameters
  private dashSize: number = 0; // 0 = solid line
  private gapSize: number = 0;

  // Reusable uniform data
  private computeUniformData: Uint32Array;
  private renderUniformData: Float32Array;

  // Performance budget: Maximum curves to render
  private static readonly MAX_CURVES = 50000;

  constructor(device: GPUDevice, config: CurveManagerConfig = {}) {
    this.device = device;
    this.segmentsPerCurve = config.segmentsPerCurve ?? 32; // 32 segments = smooth curves

    // Allocate uniform data buffers
    this.computeUniformData = new Uint32Array(4); // segmentsPerCurve, totalFlights, decimation, pad
    this.computeUniformData[0] = this.segmentsPerCurve;
    this.computeUniformData[2] = 1; // decimation (1 = show all)

    this.renderUniformData = new Float32Array(24); // viewProjectionMatrix (16) + curvesVisible (1) + lineWidth (1) + dashSize (1) + gapSize (1) + cameraPosition (3) + pad (1)
    this.renderUniformData[16] = 1.0; // curvesVisible
    this.renderUniformData[17] = 1.0; // lineWidth
    this.renderUniformData[18] = 0.0; // dashSize (0 = solid)
    this.renderUniformData[19] = 0.0; // gapSize
    // cameraPosition at indices 20-22 (updated each frame)
  }

  public setFlightManager(flightManager: FlightManager): void {
    this.flightManager = flightManager;

    // Update uniform data
    this.computeUniformData[1] = flightManager.getFlightCount();

    // Create buffers
    this.createBuffers();
  }

  private createBuffers(): void {
    if (!this.flightManager) return;

    const flightCount = this.flightManager.getFlightCount();
    const verticesPerCurve = this.segmentsPerCurve * 2; // line-list: 2 vertices per segment
    const totalVertices = flightCount * verticesPerCurve;

    // Line vertices buffer (output from compute, input to render)
    // Each vertex: position (vec3) + pad (1) + color (vec3) + pad (1) = 8 floats = 32 bytes
    const lineVerticesSize = totalVertices * 32;
    this.lineVerticesBuffer = this.device.createBuffer({
      size: lineVerticesSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    });

    const sizeMB = lineVerticesSize / 1024 / 1024;
    console.log(`✅ Curve buffers created (${flightCount} curves × ${this.segmentsPerCurve} segments, ${sizeMB.toFixed(2)}MB)`);
  }

  public createComputePipeline(): void {
    if (!this.flightManager) {
      console.warn('Cannot create compute pipeline: FlightManager not set');
      return;
    }

    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: curveTessellationShader,
    });

    // Create uniform buffer
    this.computeUniformBuffer = this.device.createBuffer({
      size: 16, // 4 u32 × 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    // Create bind group
    this.computeBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.flightManager.getControlPointsBuffer()! } },
        { binding: 2, resource: { buffer: this.flightManager.getFlightStateBuffer()! } },
        { binding: 3, resource: { buffer: this.lineVerticesBuffer! } },
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

    console.log('✅ Curve tessellation pipeline created');
  }

  public createRenderPipeline(presentationFormat: GPUTextureFormat): void {
    if (!this.flightManager) {
      console.warn('Cannot create render pipeline: FlightManager not set');
      return;
    }

    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: curvesShader,
    });

    // Create uniform buffer
    this.renderUniformBuffer = this.device.createBuffer({
      size: 96, // 24 floats × 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group layout
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create bind group
    this.renderBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
      ],
    });

    // Create render pipeline
    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 32, // 8 floats × 4 bytes (position + distance + color + pad)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 1, offset: 12, format: 'float32' },   // distance (after position pad)
              { shaderLocation: 2, offset: 16, format: 'float32x3' }, // color
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: presentationFormat,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'line-list',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, // Transparent lines, don't write depth
        depthCompare: 'less',
      },
    });

    console.log('✅ Curve rendering pipeline created');
  }

  private tessellateCount = 0;

  /**
   * Calculate adaptive LOD parameters based on flight count
   * Returns segment count and decimation factor for performance optimization
   */
  private calculateLOD(flightCount: number): { activeSegments: number; decimation: number } {
    if (flightCount <= CurveManager.MAX_CURVES) {
      // Low count: show all curves with high detail
      return { activeSegments: 32, decimation: 1 };
    }

    // High count: show subset with lower detail
    const estimatedVisible = Math.floor(flightCount * 0.5); // ~50% visible (hemisphere)
    const decimation = Math.ceil(estimatedVisible / CurveManager.MAX_CURVES);

    // Reduce segments based on total load
    let activeSegments: number;
    if (estimatedVisible <= 100000) {
      activeSegments = 16;
    } else if (estimatedVisible <= 250000) {
      activeSegments = 8;
    } else if (estimatedVisible <= 400000) {
      activeSegments = 4;
    } else {
      activeSegments = 2; // Minimum detail at very high counts (>800K flights)
    }

    return { activeSegments, decimation };
  }

  public tessellate(commandEncoder: GPUCommandEncoder): void {
    if (!this.computePipeline || !this.computeBindGroup || !this.flightManager) {
      console.warn('Curve tessellation skipped: pipeline not ready');
      return; // Pipeline not ready
    }

    const flightCount = this.flightManager.getVisibleFlightCount();

    // Calculate adaptive LOD parameters
    const { activeSegments, decimation } = this.calculateLOD(flightCount);

    // Update uniforms
    this.computeUniformData[0] = activeSegments;
    this.computeUniformData[2] = decimation;
    this.device.queue.writeBuffer(this.computeUniformBuffer!, 0, this.computeUniformData.buffer);

    // Dispatch compute shader
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);

    // Dispatch workgroups: totalVertices / 64 threads per workgroup
    // WebGPU limit: max 65535 workgroups per dimension
    // Only tessellate visible flights (flightCount already declared above)
    const verticesPerCurve = this.segmentsPerCurve + 1;
    const totalVertices = flightCount * verticesPerCurve;
    const workgroupCount = Math.ceil(totalVertices / 64);
    const maxWorkgroupsPerDim = 65535;

    let dispatchX: number, dispatchY: number;
    if (workgroupCount <= maxWorkgroupsPerDim) {
      // Simple 1D dispatch
      dispatchX = workgroupCount;
      dispatchY = 1;
      computePass.dispatchWorkgroups(dispatchX);
    } else {
      // 2D dispatch for large counts
      dispatchX = maxWorkgroupsPerDim;
      dispatchY = Math.ceil(workgroupCount / maxWorkgroupsPerDim);
      computePass.dispatchWorkgroups(dispatchX, dispatchY, 1);
    }

    computePass.end();

    // Log once
    if (this.tessellateCount === 0) {
      const actualCurves = Math.ceil(flightCount / decimation);
      console.log(`✅ Adaptive curve LOD (${flightCount} flights → ${actualCurves} curves shown, ${activeSegments} segments, decimation: 1/${decimation}, ${totalVertices} vertices, ${workgroupCount} workgroups in ${dispatchX}×${dispatchY} grid)`);
    }
    this.tessellateCount++;
  }

  public render(renderPass: GPURenderPassEncoder, camera: PerspectiveCamera): void {
    if (!this.renderPipeline || !this.renderBindGroup || !this.flightManager) {
      return; // Pipeline not ready
    }

    // Update uniforms
    this.renderUniformData.set(camera.viewProjectionMatrix, 0);
    this.renderUniformData[18] = this.dashSize;
    this.renderUniformData[19] = this.gapSize;

    // Pass camera position for backface culling
    this.renderUniformData[20] = camera.position[0];
    this.renderUniformData[21] = camera.position[1];
    this.renderUniformData[22] = camera.position[2];

    this.device.queue.writeBuffer(this.renderUniformBuffer!, 0, this.renderUniformData.buffer);

    // Render curves
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.setVertexBuffer(0, this.lineVerticesBuffer!);

    // Calculate vertices based on adaptive LOD (must match tessellation logic)
    const flightCount = this.flightManager.getVisibleFlightCount();
    const { activeSegments } = this.calculateLOD(flightCount);

    const verticesPerCurve = activeSegments * 2; // line-list: 2 vertices per segment
    const totalVertices = flightCount * verticesPerCurve;

    renderPass.draw(totalVertices, 1, 0, 0);
  }

  public setCurvesVisible(visible: boolean): void {
    this.curvesVisible = visible;
    this.renderUniformData[16] = visible ? 1.0 : 0.0;
  }

  public setDashPattern(dashSize: number, gapSize: number): void {
    this.dashSize = Math.max(0, dashSize);
    this.gapSize = Math.max(0, gapSize);
  }

  public destroy(): void {
    this.lineVerticesBuffer?.destroy();
    this.computeUniformBuffer?.destroy();
    this.renderUniformBuffer?.destroy();
  }

  public getControlPointsBuffer(): GPUBuffer | null {
    return this.flightManager?.getControlPointsBuffer() ?? null;
  }
}

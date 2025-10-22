/**
 * Stars (WebGPU)
 * Twinkling starfield using instanced billboards
 */

import type { PerspectiveCamera } from '../core/PerspectiveCamera.ts';
import starsShader from '../shaders/stars.wgsl?raw';

export interface StarsConfig {
  starCount?: number;
  minRadius?: number;
  maxRadius?: number;
  starSize?: number;
}

export class StarsWebGPU {
  private device: GPUDevice;
  private starCount: number;
  private starSize: number;
  private time = 0;

  // Buffers
  private quadVertexBuffer: GPUBuffer | null = null;
  private quadIndexBuffer: GPUBuffer | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Pipeline
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;

  // Reusable uniform data
  private uniformData: Float32Array;

  constructor(device: GPUDevice, config: StarsConfig = {}) {
    this.device = device;
    this.starCount = config.starCount ?? 5000;
    this.starSize = config.starSize ?? 150; // World space size
    const minRadius = config.minRadius ?? 50000;
    const maxRadius = config.maxRadius ?? 100000;

    // Allocate uniform data buffer (reused every frame)
    // viewProjectionMatrix (64) + cameraRight (16) + cameraUp (16) + time (4) + starSize (4) + pad (8) = 112 bytes
    this.uniformData = new Float32Array(28);

    // Create quad geometry (2 triangles)
    this.createQuadGeometry();

    // Create star instances
    this.createStarInstances(minRadius, maxRadius);
  }

  private createQuadGeometry(): void {
    // Quad vertices: [-1,-1], [1,-1], [1,1], [-1,1]
    const quadVertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
       1.0,  1.0,
      -1.0,  1.0,
    ]);

    this.quadVertexBuffer = this.device.createBuffer({
      size: quadVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.quadVertexBuffer.getMappedRange()).set(quadVertices);
    this.quadVertexBuffer.unmap();

    // Quad indices: 2 triangles
    const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    this.quadIndexBuffer = this.device.createBuffer({
      size: quadIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint16Array(this.quadIndexBuffer.getMappedRange()).set(quadIndices);
    this.quadIndexBuffer.unmap();
  }

  private createStarInstances(minRadius: number, maxRadius: number): void {
    // Instance data: position (3 floats) + opacity (1 float) = 16 bytes per star
    const instanceData = new Float32Array(this.starCount * 4);

    for (let i = 0; i < this.starCount; i++) {
      const offset = i * 4;

      // Random position on sphere
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      instanceData[offset + 0] = radius * Math.sin(phi) * Math.cos(theta);
      instanceData[offset + 1] = radius * Math.sin(phi) * Math.sin(theta);
      instanceData[offset + 2] = radius * Math.cos(phi);

      // Random opacity
      instanceData[offset + 3] = Math.random();
    }

    this.instanceBuffer = this.device.createBuffer({
      size: instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.instanceBuffer.getMappedRange()).set(instanceData);
    this.instanceBuffer.unmap();
  }

  public createPipeline(presentationFormat: GPUTextureFormat): void {
    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: starsShader,
    });

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 112, // 28 floats * 4 bytes
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
    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
      ],
    });

    // Create pipeline
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            // Quad vertices (per-vertex)
            arrayStride: 8, // 2 floats
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // quadCorner
            ],
          },
          {
            // Star instances (per-instance)
            arrayStride: 16, // 4 floats
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 2, offset: 12, format: 'float32' },   // opacity
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
              // Additive blending (like Three.js AdditiveBlending)
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'zero',
                dstFactor: 'one',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none', // Billboards visible from both sides
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, // Don't write to depth (stars in background)
        depthCompare: 'less',
      },
    });

    console.log('✅ Stars pipeline created');
  }

  public update(deltaTime: number): void {
    this.time += deltaTime;
  }

  public render(renderPass: GPURenderPassEncoder, camera: PerspectiveCamera): void {
    if (!this.pipeline || !this.bindGroup || !this.uniformBuffer ||
        !this.quadVertexBuffer || !this.quadIndexBuffer || !this.instanceBuffer) {
      return; // Pipeline not ready
    }

    // Update uniforms (reusing pre-allocated buffer)
    // viewProjectionMatrix (16 floats)
    this.uniformData.set(camera.viewProjectionMatrix, 0);

    // cameraRight (3 floats + 1 pad)
    this.uniformData.set(camera.getRightVector(), 16);

    // cameraUp (3 floats + 1 pad)
    this.uniformData.set(camera.getUpVector(), 20);

    // time (1 float)
    this.uniformData[24] = this.time;

    // starSize (1 float)
    this.uniformData[25] = this.starSize;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData.buffer);

    // Render
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.quadVertexBuffer);
    renderPass.setVertexBuffer(1, this.instanceBuffer);
    renderPass.setIndexBuffer(this.quadIndexBuffer, 'uint16');
    renderPass.drawIndexed(6, this.starCount); // 6 indices per quad, starCount instances
  }

  public destroy(): void {
    this.quadVertexBuffer?.destroy();
    this.quadIndexBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}

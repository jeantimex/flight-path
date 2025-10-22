/**
 * Atmosphere (WebGPU)
 * Atmospheric scattering glow effect around Earth
 */

import { mat4 } from 'gl-matrix';
import { createSphereGeometry, type SphereGeometryData } from '../core/SphereGeometry.ts';
import type { PerspectiveCamera } from '../core/PerspectiveCamera.ts';
import atmosphereShader from '../shaders/atmosphere.wgsl?raw';

export interface AtmosphereConfig {
  earthRadius?: number;
  scale?: number; // Atmosphere size relative to Earth (default 1.25)
  widthSegments?: number;
  heightSegments?: number;
}

export class AtmosphereWebGPU {
  private device: GPUDevice;
  private radius: number;

  // Geometry
  private geometry: SphereGeometryData | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;

  // Pipeline
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Transform
  private modelMatrix: mat4;
  private normalMatrix: mat4;

  // Visibility
  private atmosphereVisible: boolean = true;

  // Reusable uniform data
  private uniformData: Float32Array;

  constructor(device: GPUDevice, config: AtmosphereConfig = {}) {
    this.device = device;
    const earthRadius = config.earthRadius ?? 3000;
    const scale = config.scale ?? 1.25;
    this.radius = earthRadius * scale;

    // Initialize matrices
    this.modelMatrix = mat4.create();
    this.normalMatrix = mat4.create();

    // Rotate atmosphere -90° around Y-axis (match Earth rotation)
    mat4.rotateY(this.modelMatrix, this.modelMatrix, -Math.PI / 2);

    // Normal matrix is inverse transpose of model matrix
    mat4.invert(this.normalMatrix, this.modelMatrix);
    mat4.transpose(this.normalMatrix, this.normalMatrix);

    // Allocate uniform data buffer (reused every frame)
    // viewProjectionMatrix (64) + modelMatrix (64) + normalMatrix (64) + cameraPosition (16) = 208 bytes
    this.uniformData = new Float32Array(52);

    // Create geometry
    this.createGeometry(config.widthSegments ?? 64, config.heightSegments ?? 32);
  }

  private createGeometry(widthSegments: number, heightSegments: number): void {
    this.geometry = createSphereGeometry(this.radius, widthSegments, heightSegments);

    // Create vertex buffer
    this.vertexBuffer = this.device.createBuffer({
      size: this.geometry.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(this.geometry.vertices);
    this.vertexBuffer.unmap();

    // Create index buffer
    this.indexBuffer = this.device.createBuffer({
      size: this.geometry.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.indexBuffer.getMappedRange()).set(this.geometry.indices);
    this.indexBuffer.unmap();
  }

  public createPipeline(presentationFormat: GPUTextureFormat): void {
    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: atmosphereShader,
    });

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 208, // 52 floats * 4 bytes
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
            arrayStride: this.geometry!.stride,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
              // Skip UV at offset 24
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
        cullMode: 'front', // BackSide rendering (cull front faces)
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, // Transparent, don't write depth
        depthCompare: 'less',
      },
    });

    console.log('✅ Atmosphere pipeline created');
  }

  public render(renderPass: GPURenderPassEncoder, camera: PerspectiveCamera): void {
    if (!this.pipeline || !this.bindGroup || !this.uniformBuffer ||
        !this.vertexBuffer || !this.indexBuffer || !this.geometry) {
      return; // Pipeline not ready
    }

    if (!this.atmosphereVisible) {
      return; // Atmosphere hidden
    }

    // Update uniforms (reusing pre-allocated buffer)
    // viewProjectionMatrix (16 floats)
    this.uniformData.set(camera.viewProjectionMatrix, 0);

    // modelMatrix (16 floats)
    this.uniformData.set(this.modelMatrix, 16);

    // normalMatrix (16 floats)
    this.uniformData.set(this.normalMatrix, 32);

    // cameraPosition (3 floats + 1 pad)
    this.uniformData.set(camera.position, 48);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData.buffer);

    // Render
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
    renderPass.drawIndexed(this.geometry.indexCount);
  }

  public setAtmosphereVisible(visible: boolean): void {
    this.atmosphereVisible = visible;
  }

  public destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}

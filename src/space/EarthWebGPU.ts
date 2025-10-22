/**
 * Earth (WebGPU)
 * Renders Earth with texture and Phong lighting
 */

import { mat4, vec3 } from 'gl-matrix';
import { createSphereGeometry, type SphereGeometryData } from '../core/SphereGeometry.ts';
import { loadTexture, type LoadedTexture } from '../core/TextureLoader.ts';
import type { PerspectiveCamera } from '../core/PerspectiveCamera.ts';
import earthShader from '../shaders/earth.wgsl?raw';

export interface EarthConfig {
  radius?: number;
  widthSegments?: number;
  heightSegments?: number;
  shininess?: number;
  textureUrl?: string;
  onTextureLoaded?: () => void;
}

export class EarthWebGPU {
  private device: GPUDevice;
  private radius: number;
  private shininess: number;
  private onTextureLoaded: (() => void) | null;

  // Geometry
  private geometry: SphereGeometryData | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;

  // Texture
  private texture: LoadedTexture | null = null;
  private textureLoaded = false;

  // Pipeline
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Transform
  private modelMatrix: mat4;
  private normalMatrix: mat4;

  // Reusable uniform data buffer (avoids allocation per frame)
  private uniformData: Float32Array;
  private lightDirection: vec3;

  constructor(device: GPUDevice, config: EarthConfig = {}) {
    this.device = device;
    this.radius = config.radius ?? 3000;
    this.shininess = config.shininess ?? 10;
    this.onTextureLoaded = config.onTextureLoaded ?? null;

    // Initialize matrices
    this.modelMatrix = mat4.create();
    this.normalMatrix = mat4.create();

    // Rotate Earth -90° around Y-axis (like legacy implementation)
    mat4.rotateY(this.modelMatrix, this.modelMatrix, -Math.PI / 2);

    // Normal matrix is inverse transpose of model matrix
    mat4.invert(this.normalMatrix, this.modelMatrix);
    mat4.transpose(this.normalMatrix, this.normalMatrix);

    // Allocate uniform data buffer once (reused every frame)
    this.uniformData = new Float32Array(60); // 240 bytes / 4 bytes per float

    // Initialize light direction (reused every frame)
    this.lightDirection = vec3.fromValues(0.5, 0.5, 0.5);
    vec3.normalize(this.lightDirection, this.lightDirection);

    // Create geometry
    this.createGeometry(config.widthSegments ?? 64, config.heightSegments ?? 32);

    // Load texture (use BASE_URL for GitHub Pages deployment)
    const textureUrl = config.textureUrl ?? `${import.meta.env.BASE_URL}world.topo.jpg`;
    this.loadTexture(textureUrl);
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

  private async loadTexture(url: string): Promise<void> {
    try {
      this.texture = await loadTexture(this.device, url, {
        flipY: true,
        wrapU: 'repeat',
        wrapV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
      });

      this.textureLoaded = true;

      if (this.onTextureLoaded) {
        this.onTextureLoaded();
      }

      console.log('✅ Earth texture loaded:', url);
    } catch (error) {
      console.error('❌ Failed to load Earth texture:', error);
      this.textureLoaded = true; // Still mark as loaded to unblock app
      if (this.onTextureLoaded) {
        this.onTextureLoaded();
      }
    }
  }

  public createPipeline(presentationFormat: GPUTextureFormat): void {
    if (!this.texture) {
      console.warn('Texture not loaded, deferring pipeline creation');
      return;
    }

    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: earthShader,
    });

    // Create uniform buffer
    // Layout: viewProjectionMatrix (64) + modelMatrix (64) + normalMatrix (64) +
    //         cameraPosition (16) + lightDirection (16) + shininess (16) = 240 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 240,
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
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.texture.view },
        { binding: 2, resource: this.texture.sampler },
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
              { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    console.log('✅ Earth pipeline created');
  }

  public render(renderPass: GPURenderPassEncoder, camera: PerspectiveCamera): void {
    if (!this.pipeline || !this.bindGroup || !this.uniformBuffer ||
        !this.vertexBuffer || !this.indexBuffer || !this.geometry) {
      return; // Pipeline not ready
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

    // lightDirection (3 floats + 1 pad)
    this.uniformData.set(this.lightDirection, 52);

    // shininess (1 float + 3 pad)
    this.uniformData[56] = this.shininess;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData.buffer);

    // Render
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
    renderPass.drawIndexed(this.geometry.indexCount);
  }

  public isTextureLoaded(): boolean {
    return this.textureLoaded;
  }

  public getRadius(): number {
    return this.radius;
  }

  public destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.texture?.texture.destroy();
  }
}

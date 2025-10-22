/**
 * Planes Renderer (WebGPU)
 * Instanced billboard rendering for 1M planes
 * Reads position/direction from FlightManager buffers
 */

import { mat4, vec3 } from 'gl-matrix';
import type { PerspectiveCamera } from '../core/PerspectiveCamera.ts';
import type { FlightManager } from '../flights/FlightManager.ts';
import { loadTexture } from '../core/TextureLoader.ts';
import planesShader from '../shaders/planes.wgsl?raw';

export interface PlanesConfig {
  baseSize?: number;
  texturePath?: string | null;
}

export interface AtlasInfo {
  texture: GPUTexture;
  columns: number;
  rows: number;
  count: number;
}

export class PlanesWebGPU {
  private device: GPUDevice;
  private baseSize: number;

  // Pipeline
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Texture
  private texture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;
  private useTexture: boolean = false;

  // Atlas info
  private atlasColumns: number = 1;
  private atlasRows: number = 1;

  // Flight manager reference
  private flightManager: FlightManager | null = null;

  // Visibility
  private planesVisible: boolean = true;

  // Reusable uniform data
  private uniformData: Float32Array;

  // Dummy texture (1x1 white pixel for when no texture loaded)
  private dummyTexture: GPUTexture | null = null;

  constructor(device: GPUDevice, config: PlanesConfig = {}) {
    this.device = device;
    this.baseSize = config.baseSize ?? 10;

    // Allocate uniform data buffer (reused every frame)
    // viewProjectionMatrix (64) + cameraRight (16) + cameraUp (16) + baseSize (4) + useTexture (4) + planesVisible (4) + atlasColumns (4) + atlasRows (4) + pad (8) = 128 bytes
    this.uniformData = new Float32Array(32);
    this.uniformData[24] = this.baseSize;
    this.uniformData[25] = 0.0; // useTexture
    this.uniformData[26] = 1.0; // planesVisible
    this.uniformData[27] = 1.0; // atlasColumns
    this.uniformData[28] = 1.0; // atlasRows

    // Create dummy texture
    this.createDummyTexture();

    // Load texture if provided
    if (config.texturePath) {
      this.loadPlaneTexture(config.texturePath);
    }
  }

  private createDummyTexture(): void {
    // Create 1x1 white texture
    this.dummyTexture = this.device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Upload white pixel
    const whitePixel = new Uint8Array([255, 255, 255, 255]);
    this.device.queue.writeTexture(
      { texture: this.dummyTexture },
      whitePixel,
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
  }

  public async loadPlaneTexture(path: string): Promise<void> {
    try {
      const loadedTexture = await loadTexture(this.device, path, { flipY: true });
      this.texture = loadedTexture.texture;
      this.useTexture = true;
      this.uniformData[25] = 1.0;

      console.log(`✅ Plane texture loaded: ${path}`);

      // Recreate bind group with new texture
      if (this.flightManager) {
        this.createPipeline();
      }
    } catch (error) {
      console.error('Failed to load plane texture:', error);
      this.texture = null;
      this.useTexture = false;
      this.uniformData[25] = 0.0;
    }
  }

  public setAtlas(atlasInfo: AtlasInfo): void {
    // Destroy old texture if exists (avoid memory leak)
    if (this.texture && this.texture !== this.dummyTexture) {
      this.texture.destroy();
    }

    this.texture = atlasInfo.texture;
    this.atlasColumns = atlasInfo.columns;
    this.atlasRows = atlasInfo.rows;
    this.useTexture = true;

    // Update uniforms
    this.uniformData[25] = 1.0; // useTexture
    this.uniformData[27] = atlasInfo.columns;
    this.uniformData[28] = atlasInfo.rows;

    console.log(`✅ Plane atlas set (${atlasInfo.columns}x${atlasInfo.rows}, ${atlasInfo.count} tiles)`);

    // Recreate bind group with new texture
    if (this.flightManager) {
      this.createPipeline();
    }
  }

  public setFlightManager(flightManager: FlightManager): void {
    this.flightManager = flightManager;
  }

  public createPipeline(presentationFormat: GPUTextureFormat = 'bgra8unorm'): void {
    if (!this.flightManager) {
      console.warn('Cannot create pipeline: FlightManager not set');
      return;
    }

    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: planesShader,
    });

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 128, // 32 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create sampler
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
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
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
    });

    // Create bind group
    const textureView = this.texture
      ? this.texture.createView()
      : this.dummyTexture!.createView();

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.flightManager.getOutputBuffer()! } },
        { binding: 2, resource: { buffer: this.flightManager.getFlightStateBuffer()! } },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: textureView },
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
        topology: 'triangle-strip',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    console.log('✅ Planes pipeline created');
  }

  public render(renderPass: GPURenderPassEncoder, camera: PerspectiveCamera): void {
    if (!this.pipeline || !this.bindGroup || !this.uniformBuffer || !this.flightManager) {
      return; // Pipeline not ready
    }

    // Update uniforms (reusing pre-allocated buffer)
    // viewProjectionMatrix (16 floats)
    this.uniformData.set(camera.viewProjectionMatrix, 0);

    // Camera right and up vectors (world space, from inverse view matrix)
    // View matrix transforms world → view, so inverse transforms view → world
    const invView = mat4.create();
    mat4.invert(invView, camera.viewMatrix);

    // Camera right vector (first column of inverse view matrix)
    const cameraRight = vec3.create();
    vec3.set(cameraRight, invView[0], invView[1], invView[2]);
    this.uniformData.set(cameraRight, 16);

    // Camera up vector (second column of inverse view matrix)
    const cameraUp = vec3.create();
    vec3.set(cameraUp, invView[4], invView[5], invView[6]);
    this.uniformData.set(cameraUp, 20);

    // baseSize, useTexture, planesVisible already set in constructor/methods

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData.buffer);

    // Render instanced planes
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(4, this.flightManager.getVisibleFlightCount()); // 4 vertices per quad, visible instances only
  }

  public setPlanesVisible(visible: boolean): void {
    this.planesVisible = visible;
    this.uniformData[26] = visible ? 1.0 : 0.0;
  }

  public setBaseSize(size: number): void {
    this.baseSize = size;
    this.uniformData[24] = size;
  }

  public destroy(): void {
    this.uniformBuffer?.destroy();
    this.texture?.destroy();
    this.dummyTexture?.destroy();
  }
}

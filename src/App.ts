/**
 * Main WebGPU Application
 * Native WebGPU implementation for 1M flight rendering
 * (Legacy Three.js version: App.legacy.ts)
 */

import {
  initializeWebGPU,
  resizeCanvas,
  showError,
  type WebGPUContext
} from './core/WebGPUContext.ts';
import { PerspectiveCamera } from './core/PerspectiveCamera.ts';
import { OrbitControls } from './core/OrbitControls.ts';
import { EarthWebGPU } from './space/EarthWebGPU.ts';

const EARTH_RADIUS = 3000;

export class WebGPUApp {
  private canvas: HTMLCanvasElement;
  private gpuContext: WebGPUContext | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private earth: EarthWebGPU | null = null;
  private earthTextureLoaded = false;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;

  constructor() {
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';

    const app = document.querySelector('#app');
    if (!app) {
      throw new Error('App container not found');
    }
    app.appendChild(this.canvas);

    // Initialize WebGPU
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Setup WebGPU device and context
      this.gpuContext = await initializeWebGPU({
        canvas: this.canvas,
        powerPreference: 'high-performance',
      });

      console.log('✅ WebGPU initialized successfully');
      console.log('Device:', this.gpuContext.device);
      console.log('Format:', this.gpuContext.presentationFormat);

      // Initialize camera
      const aspect = this.canvas.width / this.canvas.height;
      this.camera = new PerspectiveCamera({
        fov: 75,
        aspect,
        near: 0.1,
        far: 50000,
        position: [0, 2000, 8000],
        target: [0, 0, 0],
        up: [0, 1, 0],
      });

      // Initialize orbit controls
      this.controls = new OrbitControls(this.camera, this.canvas, {
        enableDamping: true,
        dampingFactor: 0.05,
        minDistance: 3200,
        maxDistance: 20000,
        maxPolarAngle: Math.PI,
        enablePan: false,
        enableZoom: true,
        enableRotate: true,
      });

      console.log('✅ Camera and controls initialized');

      // Initialize Earth
      this.earth = new EarthWebGPU(this.gpuContext.device, {
        radius: EARTH_RADIUS,
        onTextureLoaded: () => {
          this.earthTextureLoaded = true;
          // Create pipeline after texture loads
          if (this.earth && this.gpuContext) {
            this.earth.createPipeline(this.gpuContext.presentationFormat);
          }
        },
      });

      console.log('✅ Earth initialized');

      // Setup resize handler
      window.addEventListener('resize', this.handleResize);

      // Start render loop
      this.lastTime = performance.now();
      this.animationFrameId = requestAnimationFrame(this.frame);

    } catch (error) {
      console.error('❌ Failed to initialize WebGPU:', error);
      const message = error instanceof Error ? error.message : String(error);
      showError(`WebGPU Initialization Failed\n\n${message}`);
    }
  }

  private handleResize = (): void => {
    if (!this.gpuContext) return;
    resizeCanvas(this.gpuContext, this.canvas);

    // Update camera aspect ratio
    if (this.camera) {
      const aspect = this.canvas.width / this.canvas.height;
      this.camera.setAspect(aspect);
    }
  };

  private frame = (now: number): void => {
    if (!this.gpuContext) return;

    const deltaTime = Math.min((now - this.lastTime) / 1000, 1 / 20); // Cap at 20fps minimum
    this.lastTime = now;

    this.render(deltaTime);

    this.animationFrameId = requestAnimationFrame(this.frame);
  };

  private render(_deltaTime: number): void {
    if (!this.gpuContext || !this.camera || !this.controls) return;

    // Update camera controls
    this.controls.update();

    const { device, context, depthTextureView } = this.gpuContext;

    // Get current texture from canvas context
    let textureView: GPUTextureView;
    try {
      textureView = context.getCurrentTexture().createView();
    } catch (error) {
      // Can fail during resize, skip this frame
      console.warn('Failed to get current texture, skipping frame:', error);
      return;
    }

    // Create command encoder
    const commandEncoder = device.createCommandEncoder();

    // Create render pass
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTextureView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };

    const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);

    // Render Earth
    if (this.earth) {
      this.earth.render(renderPass, this.camera);
    }

    // TODO: Add more rendering pipelines here
    // - Stars (background)
    // - Atmosphere (transparent)
    // - Compute pass for curves
    // - Curves
    // - Planes

    renderPass.end();

    // Submit commands
    device.queue.submit([commandEncoder.finish()]);
  }

  public destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.handleResize);

    if (this.controls) {
      this.controls.dispose();
    }

    if (this.earth) {
      this.earth.destroy();
    }

    if (this.gpuContext) {
      this.gpuContext.depthTexture.destroy();
      this.gpuContext.device.destroy();
    }
  }
}

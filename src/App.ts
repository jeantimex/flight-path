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

export class WebGPUApp {
  private canvas: HTMLCanvasElement;
  private gpuContext: WebGPUContext | null = null;
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
  };

  private frame = (now: number): void => {
    if (!this.gpuContext) return;

    const deltaTime = Math.min((now - this.lastTime) / 1000, 1 / 20); // Cap at 20fps minimum
    this.lastTime = now;

    this.render(deltaTime);

    this.animationFrameId = requestAnimationFrame(this.frame);
  };

  private render(_deltaTime: number): void {
    if (!this.gpuContext) return;

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

    // TODO: Add rendering pipelines here
    // - Stars
    // - Earth
    // - Atmosphere
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

    if (this.gpuContext) {
      this.gpuContext.depthTexture.destroy();
      this.gpuContext.device.destroy();
    }
  }
}

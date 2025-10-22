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
import { StarsWebGPU } from './space/StarsWebGPU.ts';
import { AtmosphereWebGPU } from './space/AtmosphereWebGPU.ts';
import { FlightManager } from './flights/FlightManager.ts';
import { PlanesWebGPU } from './planes/PlanesWebGPU.ts';
import { CurveManager } from './curves/CurveManager.ts';
import { createAtlas } from './core/AtlasLoader.ts';

const EARTH_RADIUS = 3000;
const BASE_URL = import.meta.env.BASE_URL;

export class WebGPUApp {
  private canvas: HTMLCanvasElement;
  private gpuContext: WebGPUContext | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private earth: EarthWebGPU | null = null;
  private stars: StarsWebGPU | null = null;
  private atmosphere: AtmosphereWebGPU | null = null;
  private flightManager: FlightManager | null = null;
  private planes: PlanesWebGPU | null = null;
  private curves: CurveManager | null = null;
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
        rotateSpeed: 0.3, // Slower rotation for better control
        zoomSpeed: 0.1, // Much slower zoom for fine control
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

      // Initialize Stars
      this.stars = new StarsWebGPU(this.gpuContext.device, {
        starCount: 5000,
        minRadius: 50000,
        maxRadius: 100000,
        starSize: 150,
      });
      this.stars.createPipeline(this.gpuContext.presentationFormat);

      console.log('✅ Stars initialized');

      // Initialize Atmosphere
      this.atmosphere = new AtmosphereWebGPU(this.gpuContext.device, {
        earthRadius: EARTH_RADIUS,
        scale: 1.25,
      });
      this.atmosphere.createPipeline(this.gpuContext.presentationFormat);

      console.log('✅ Atmosphere initialized');

      // Initialize Flight Manager
      this.flightManager = new FlightManager(this.gpuContext.device, {
        flightCount: 1000, // Start with 1K flights for testing
        earthRadius: EARTH_RADIUS,
        minAltitude: 30,
        maxAltitude: 220,
        planeTextureCount: 8, // 8 plane designs in atlas
      });
      this.flightManager.createPipeline();

      console.log('✅ Flight Manager initialized');

      // Initialize Planes
      this.planes = new PlanesWebGPU(this.gpuContext.device, {
        baseSize: 10,
        texturePath: null, // Will load atlas below
      });
      this.planes.setFlightManager(this.flightManager);
      this.planes.createPipeline(this.gpuContext.presentationFormat);

      console.log('✅ Planes initialized');

      // Load plane atlas (8 SVG textures in 4x2 grid)
      const planeAtlas = await createAtlas(this.gpuContext.device, {
        columns: 4,
        rows: 2,
        tileSize: 512,
        images: [
          `${BASE_URL}plane1.svg`,
          `${BASE_URL}plane2.svg`,
          `${BASE_URL}plane3.svg`,
          `${BASE_URL}plane4.svg`,
          `${BASE_URL}plane5.svg`,
          `${BASE_URL}plane6.svg`,
          `${BASE_URL}plane7.svg`,
          `${BASE_URL}plane8.svg`,
        ],
      });

      this.planes.setAtlas(planeAtlas);

      console.log('✅ Plane atlas loaded');

      // Initialize Curves
      this.curves = new CurveManager(this.gpuContext.device, {
        segmentsPerCurve: 32, // 32 segments per curve
      });
      this.curves.setFlightManager(this.flightManager);
      this.curves.createComputePipeline();
      this.curves.createRenderPipeline(this.gpuContext.presentationFormat);

      console.log('✅ Curves initialized');

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

  private render(deltaTime: number): void {
    if (!this.gpuContext || !this.camera || !this.controls) return;

    // Update camera controls
    this.controls.update();

    // Update stars animation
    if (this.stars) {
      this.stars.update(deltaTime);
    }

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

    // Compute pass: Update flight positions
    if (this.flightManager) {
      this.flightManager.update(commandEncoder, deltaTime);
    }

    // Compute pass: Tessellate curves
    if (this.curves) {
      this.curves.tessellate(commandEncoder);
    }

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

    // Render stars (background, depth write OFF)
    if (this.stars) {
      this.stars.render(renderPass, this.camera);
    }

    // Render Earth (opaque, depth write ON)
    if (this.earth) {
      this.earth.render(renderPass, this.camera);
    }

    // Render atmosphere (transparent, depth write OFF)
    if (this.atmosphere) {
      this.atmosphere.render(renderPass, this.camera);
    }

    // Render curves (line strips, depth write OFF)
    if (this.curves) {
      this.curves.render(renderPass, this.camera);
    }

    // Render planes (instanced billboards, depth write ON)
    if (this.planes) {
      this.planes.render(renderPass, this.camera);
    }

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

    if (this.stars) {
      this.stars.destroy();
    }

    if (this.atmosphere) {
      this.atmosphere.destroy();
    }

    if (this.flightManager) {
      this.flightManager.destroy();
    }

    if (this.planes) {
      this.planes.destroy();
    }

    if (this.curves) {
      this.curves.destroy();
    }

    if (this.gpuContext) {
      this.gpuContext.depthTexture.destroy();
      this.gpuContext.device.destroy();
    }
  }
}

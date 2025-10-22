/**
 * Main WebGPU Application
 * Native WebGPU implementation for 1M flight rendering
 * (Legacy Three.js version: App.legacy.ts)
 */

import Stats from 'stats.js';
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
import { ControlsWebGPU } from './managers/ControlsWebGPU.ts';

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
  private guiControls: ControlsWebGPU | null = null;
  private earthTextureLoaded = false;
  private planeAtlasLoaded = false;
  private minLoadingTime = false;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;
  private loadingScreen: HTMLElement | null = null;
  private footerCoordinatesElement: HTMLElement | null = null;
  private stats: Stats;
  private isAnimatingCamera: boolean = false;

  constructor() {
    // Initialize Stats.js for performance monitoring
    this.stats = new Stats();
    this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb
    document.body.appendChild(this.stats.dom);
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.left = '0px';
    this.stats.dom.style.top = '0px';
    this.stats.dom.style.display = 'none'; // Hidden during loading

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

    // Create loading screen
    this.createLoadingScreen();

    // Create footer
    this.createFooter();

    // Initialize WebGPU
    this.initialize();
  }

  private createLoadingScreen(): void {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-screen';
    loadingDiv.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle at top, rgba(0, 40, 80, 0.95), rgba(0, 10, 20, 0.98));
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      transition: opacity 0.5s ease-out;
    `;

    const spinner = document.createElement('div');
    spinner.innerHTML = `
      <div style="
        width: 80px;
        height: 80px;
        border: 4px solid rgba(255, 255, 255, 0.1);
        border-top: 4px solid rgba(88, 166, 255, 1);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      "></div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    loadingDiv.appendChild(spinner);
    document.body.appendChild(loadingDiv);
    this.loadingScreen = loadingDiv;

    // Hide dat.GUI and Stats during loading
    const guiElements = document.querySelectorAll('.dg.ac');
    guiElements.forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
    this.stats.dom.style.display = 'none';

    // Minimum loading time (2 seconds)
    setTimeout(() => {
      this.minLoadingTime = true;
      this.checkReadyToStart();
    }, 2000);
  }

  private createFooter(): void {
    const existing = document.getElementById('app-footer');
    if (existing) {
      this.footerCoordinatesElement = existing.querySelector('#coordinates') as HTMLElement | null;
      if (this.footerCoordinatesElement) {
        this.footerCoordinatesElement.style.display = 'none';
      }
      return;
    }

    const footer = document.createElement('div');
    footer.id = 'app-footer';
    footer.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      color: white;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 10000;
      pointer-events: none;
    `;

    footer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; pointer-events: auto;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width: 16px; height: 16px; fill: white;">
          <path d="M173.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3 .3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5 .3-6.2 2.3zm44.2-1.7c-2.9 .7-4.9 2.6-4.6 4.9 .3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM252.8 8c-138.7 0-244.8 105.3-244.8 244 0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1 100-33.2 167.8-128.1 167.8-239 0-138.7-112.5-244-251.2-244zM105.2 352.9c-1.3 1-1 3.3 .7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3 .3 2.9 2.3 3.9 1.6 1 3.6 .7 4.3-.7 .7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3 .7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3 .7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9s4.3 3.3 5.6 2.3c1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"/>
        </svg>
        <span>Made by</span>
        <a href="https://github.com/jeantimex/flight-path" target="_blank" rel="noopener noreferrer"
           style="color: #58a6ff; text-decoration: none; font-weight: 500;">
          jeantimex
        </a>
      </div>
      <div id="coordinates" style="pointer-events: none; font-family: monospace; font-size: 12px; opacity: 0.8; display: none;">
        Lat: 0.00°, Lng: 0.00°
      </div>
    `;

    document.body.appendChild(footer);
    this.footerCoordinatesElement = footer.querySelector('#coordinates') as HTMLElement | null;
    if (this.footerCoordinatesElement) {
      this.footerCoordinatesElement.style.display = 'none';
    }
  }

  private checkReadyToStart(): void {
    if (this.earthTextureLoaded && this.planeAtlasLoaded && this.minLoadingTime) {
      this.removeLoadingScreen();
    }
  }

  private removeLoadingScreen(): void {
    if (!this.loadingScreen) return;

    this.loadingScreen.style.opacity = '0';
    setTimeout(() => {
      this.loadingScreen?.remove();
      this.loadingScreen = null;

      // Show dat.GUI and Stats after loading
      const guiElements = document.querySelectorAll('.dg.ac');
      guiElements.forEach((el) => {
        (el as HTMLElement).style.display = 'block';
      });
      this.stats.dom.style.display = 'block';

      // Show footer coordinates
      if (this.footerCoordinatesElement) {
        this.footerCoordinatesElement.style.display = 'block';
      }

      // Start camera zoom-in animation
      this.animateInitialCamera();
    }, 500);
  }

  private animateInitialCamera(): void {
    if (!this.camera) {
      console.warn('Camera not initialized, skipping animation');
      return;
    }

    // Simple zoom: animate from current position (far) to target position (close)
    const currentPos = this.camera.position;
    const currentDistance = Math.sqrt(currentPos[0] * currentPos[0] + currentPos[1] * currentPos[1] + currentPos[2] * currentPos[2]);

    // Normalize direction
    const dirX = currentPos[0] / currentDistance;
    const dirY = currentPos[1] / currentDistance;
    const dirZ = currentPos[2] / currentDistance;

    // Set distances - animate from current (far) to target (close)
    const startDistance = currentDistance;  // Start at current position (far)
    const targetDistance = EARTH_RADIUS * 2.06; // End at viewing distance (optimized Earth size)

    const startPos: [number, number, number] = [
      dirX * startDistance,
      dirY * startDistance,
      dirZ * startDistance
    ];

    const targetPos: [number, number, number] = [
      dirX * targetDistance,
      dirY * targetDistance,
      dirZ * targetDistance
    ];

    // Set flag to skip controls update during animation (including delay)
    this.isAnimatingCamera = true;

    // Animate to target position (3s duration, 500ms delay)
    setTimeout(() => {
      const startTime = Date.now();
      const duration = 3000;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-out cubic
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        // Interpolate position (zoom along same direction)
        const x = startPos[0] + (targetPos[0] - startPos[0]) * easeProgress;
        const y = startPos[1] + (targetPos[1] - startPos[1]) * easeProgress;
        const z = startPos[2] + (targetPos[2] - startPos[2]) * easeProgress;

        if (this.camera) {
          this.camera.setPosition(x, y, z);
          this.camera.updateViewMatrix(); // CRITICAL: Update view matrix for camera to take effect!
          // Log every 0.5 seconds
          if (Math.floor(elapsed / 500) !== Math.floor((elapsed - 16) / 500)) {
            const dist = Math.sqrt(x*x + y*y + z*z);
            console.log(`⏱️ Progress: ${(progress*100).toFixed(0)}%, Distance: ${dist.toFixed(0)}`);
          }
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          console.log('✅ Camera animation complete');
          this.isAnimatingCamera = false;

          // Create OrbitControls now that camera is at final position
          if (!this.controls) {
            console.log('🎮 Creating OrbitControls after animation');
            this.controls = new OrbitControls(this.camera!, this.canvas, {
              enableDamping: true,
              dampingFactor: 0.05,
              minDistance: 3200,
              maxDistance: 20000,
              minPolarAngle: Math.PI * 0.05,
              maxPolarAngle: Math.PI * 0.95,
              enablePan: false,
              enableZoom: true,
              enableRotate: true,
              rotateSpeed: 0.3,
              zoomSpeed: 0.05,
            });
          }
        }
      };

      animate();
    }, 500);
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

      // Initialize camera at animation START position (far away)
      const aspect = this.canvas.width / this.canvas.height;
      const finalDistance = EARTH_RADIUS * 2.06; // ~6180 (optimized Earth size at end)
      const startDistance = finalDistance * 1.25; // ~7725 (optimized Earth size at start)

      // Position camera to match main branch initial position (lat: 12.05°, lng: -26.22°)
      // Convert lat/lng to camera position (reverse of updateCoordinateDisplay logic)
      const lat = 12.05;
      const lng = -26.22;
      const phi = (90 - lat) * Math.PI / 180; // 77.95° in radians
      const theta = lng * Math.PI / 180;

      // Calculate display coordinates (x, y, z used in lat/lng calculation)
      const y = Math.cos(phi); // ≈ 0.209
      const x = Math.sin(phi) * Math.cos(theta); // ≈ 0.879
      const z = Math.sin(phi) * Math.sin(theta); // ≈ -0.429

      // Convert back to camera position (reverse of: x=-surfaceZ, y=surfaceY, z=surfaceX)
      // From display code: x = camPos[2], y = -camPos[1], z = -camPos[0]
      const camX = -z * startDistance; // = 0.429 * startDistance
      const camY = -y * startDistance; // = -0.209 * startDistance
      const camZ = x * startDistance;  // = 0.879 * startDistance

      this.camera = new PerspectiveCamera({
        fov: 75,
        aspect,
        near: 0.1,
        far: 50000,
        position: [camX, camY, camZ], // Start position (far away, will animate closer)
        target: [0, 0, 0],
        up: [0, 1, 0],
      });

      // OrbitControls will be initialized AFTER camera animation completes
      // to avoid it resetting the camera position
      this.controls = null as any; // Temporary, will be created after animation

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
          // Check if ready to start
          this.checkReadyToStart();
        },
      });

      console.log('✅ Earth initialized');

      // Initialize Stars
      this.stars = new StarsWebGPU(this.gpuContext.device, {
        starCount: 25000, // Much more stars with twinkling
        minRadius: 50000,
        maxRadius: 100000,
        starSize: 150,
      });
      this.stars.createPipeline(this.gpuContext.presentationFormat);

      console.log('✅ Stars initialized');

      // Initialize Atmosphere (matching main branch)
      this.atmosphere = new AtmosphereWebGPU(this.gpuContext.device, {
        earthRadius: EARTH_RADIUS,
        scale: 1.08, // Slightly bigger atmosphere with edge fade
      });
      this.atmosphere.createPipeline(this.gpuContext.presentationFormat);

      console.log('✅ Atmosphere initialized');

      // Initialize Flight Manager
      // Pre-allocate for 1M flights, start with 1K visible
      this.flightManager = new FlightManager(this.gpuContext.device, {
        flightCount: 1000, // Initial visible count
        earthRadius: EARTH_RADIUS,
        minAltitude: 30,
        maxAltitude: 220,
        planeTextureCount: 8, // 8 plane designs in atlas
      });
      this.flightManager.createPipeline();

      console.log(`✅ Flight Manager initialized (1M allocated, ${this.flightManager.getVisibleFlightCount()} visible)`);

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
      this.planeAtlasLoaded = true;

      console.log('✅ Plane atlas loaded');

      // Check if ready to start
      this.checkReadyToStart();

      // Initialize Curves (render-only, tessellation now merged into flight update shader)
      const curveSegments = 16; // Segments per curve (adaptive LOD will adjust dynamically)
      this.curves = new CurveManager(this.gpuContext.device, {
        segmentsPerCurve: curveSegments,
      });
      this.curves.setFlightManager(this.flightManager);
      // Note: No createComputePipeline() - tessellation merged into FlightManager shader
      this.curves.createRenderPipeline(this.gpuContext.presentationFormat);

      // Bind curve buffer to flight manager for merged shader (flight update + curve tessellation)
      const curveBuffer = this.curves.getLineVerticesBuffer();
      if (curveBuffer) {
        this.flightManager.setCurveBuffer(curveBuffer, curveSegments, 1); // Initial params, updated dynamically
      }

      console.log('✅ Curves initialized');

      // Initialize GUI controls
      this.guiControls = new ControlsWebGPU({
        onFlightCountChange: (count: number) => {
          if (this.flightManager) {
            this.flightManager.setVisibleFlightCount(count);
          }
        },
      });
      this.guiControls.setPlanes(this.planes);
      this.guiControls.setCurves(this.curves);
      this.guiControls.setFlightManager(this.flightManager);
      this.guiControls.setAtmosphere(this.atmosphere);
      this.guiControls.setEarth(this.earth);

      console.log('✅ GUI controls initialized');

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

  private updateCoordinateDisplay(): void {
    if (!this.footerCoordinatesElement || !this.camera || !this.earth) {
      return;
    }

    // Get camera position
    const camPos = this.camera.position;

    // Calculate direction from camera to Earth center
    const dirX = -camPos[0];
    const dirY = -camPos[1];
    const dirZ = -camPos[2];
    const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

    // Normalize direction and scale to Earth surface
    const surfaceX = (dirX / len) * EARTH_RADIUS;
    const surfaceY = (dirY / len) * EARTH_RADIUS;
    const surfaceZ = (dirZ / len) * EARTH_RADIUS;

    // Convert to lat/lng (WebGPU coordinates)
    // Reverse coordinate transformation: x = -z, y = y, z = x
    const x = -surfaceZ;
    const y = surfaceY;
    const z = surfaceX;

    // Calculate spherical coordinates
    const phi = Math.acos(Math.max(-1, Math.min(1, y / EARTH_RADIUS)));
    const theta = Math.atan2(z, x);

    // Convert to degrees
    const lat = 90 - (phi * 180 / Math.PI);
    const lng = theta * 180 / Math.PI;

    this.footerCoordinatesElement.textContent = `Lat: ${lat.toFixed(2)}°, Lng: ${lng.toFixed(2)}°`;
  }

  private frame = (now: number): void => {
    if (!this.gpuContext) return;

    // Begin performance measurement
    this.stats.begin();

    const deltaTime = Math.min((now - this.lastTime) / 1000, 1 / 20); // Cap at 20fps minimum
    this.lastTime = now;

    this.render(deltaTime);

    // End performance measurement
    this.stats.end();

    this.animationFrameId = requestAnimationFrame(this.frame);
  };

  private render(deltaTime: number): void {
    if (!this.gpuContext || !this.camera) return;

    // Update camera controls (skip during animation, skip if not created yet)
    if (!this.isAnimatingCamera && this.controls) {
      this.controls.update();
    }

    // Update real-time sun position
    if (this.guiControls) {
      this.guiControls.updateRealTimeSun();
    }

    // Update stars animation
    if (this.stars) {
      this.stars.update(deltaTime);
    }

    // Update coordinate display
    this.updateCoordinateDisplay();

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

    // Compute pass: Update flight positions + Tessellate curves (merged shader)
    if (this.flightManager && this.curves) {
      const camPos = this.camera.position;

      // Update curve LOD params dynamically based on flight count
      const flightCount = this.flightManager.getVisibleFlightCount();
      const { activeSegments, decimation } = this.curves.calculateLOD(flightCount);
      this.flightManager.updateCurveParams(activeSegments, decimation);

      // Merged update: flight positions + curve tessellation in single pass
      this.flightManager.update(commandEncoder, deltaTime, [camPos[0], camPos[1], camPos[2]]);
    }

    // Compute pass: Visibility culling for indirect rendering
    if (this.planes) {
      this.planes.cullVisibility(commandEncoder);
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

    if (this.guiControls) {
      this.guiControls.destroy();
    }

    if (this.gpuContext) {
      this.gpuContext.depthTexture.destroy();
      this.gpuContext.device.destroy();
    }
  }
}

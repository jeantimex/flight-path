/**
 * WebGPU Controls
 * Matches legacy Controls.ts structure and functionality
 */

import { GUI } from 'dat.gui';
import type { PlanesWebGPU } from '../planes/PlanesWebGPU.ts';
import type { CurveManager } from '../curves/CurveManager.ts';
import type { FlightManager } from '../flights/FlightManager.ts';
import type { AtmosphereWebGPU } from '../space/AtmosphereWebGPU.ts';

export interface ControlsWebGPUParams {
  // Earth Controls (placeholders for future implementation)
  dayNightEffect: boolean;
  atmosphereEffect: boolean;
  realTimeSun: boolean;
  simulatedTime: number;
  timeDisplay: string;
  nightBrightness: number;
  dayBrightness: number;

  // Flight Controls
  numFlights: number;
  returnFlight: boolean;

  // Flight Path
  dashSize: number;
  gapSize: number;
  hidePath: boolean;

  // Plane Controls
  planeSize: number;
  animationSpeed: number;
  elevationOffset: number;
  planeStyle: string;
  hidePlane: boolean;
  planeColor: string;
}

export interface ControlsWebGPUCallbacks {
  onPlanesVisibilityChange?: (visible: boolean) => void;
  onCurvesVisibilityChange?: (visible: boolean) => void;
  onPlaneSizeChange?: (size: number) => void;
  onFlightCountChange?: (count: number) => void;
  onRestart?: () => void;
}

export class ControlsWebGPU {
  private gui: GUI;
  private params: ControlsWebGPUParams;
  private planes: PlanesWebGPU | null = null;
  private curves: CurveManager | null = null;
  private flightManager: FlightManager | null = null;
  private atmosphere: AtmosphereWebGPU | null = null;
  private callbacks: ControlsWebGPUCallbacks;
  private flightCountDebounceTimer: number | null = null;

  constructor(callbacks: ControlsWebGPUCallbacks = {}) {
    this.callbacks = callbacks;

    // Default parameters matching legacy
    this.params = {
      // Earth Controls
      dayNightEffect: true,
      atmosphereEffect: true,
      realTimeSun: true,
      simulatedTime: 12.0,
      timeDisplay: '12:00 UTC',
      nightBrightness: 15,
      dayBrightness: 80,

      // Flight Controls
      numFlights: 1000,
      returnFlight: true,

      // Flight Path
      dashSize: 40,
      gapSize: 40,
      hidePath: false,

      // Plane Controls
      planeSize: 100,
      animationSpeed: 0.1,
      elevationOffset: 15,
      planeStyle: 'SVG',
      hidePlane: false,
      planeColor: '#ff6666',
    };

    // Create dat.GUI
    this.gui = new GUI();
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0px';
    this.gui.domElement.style.right = '0px';

    this.setupControls();
  }

  private setupControls(): void {
    this.setupEarthControls();
    this.setupBrightnessControls();
    this.setupFlightControls();
    this.setupFlightPathControls();
    this.setupPlaneControls();
  }

  private setupEarthControls(): void {
    const earthFolder = this.gui.addFolder('Earth Controls');

    // Note: Day/Night Effect not implemented yet
    const dayNightCtrl = earthFolder
      .add(this.params, 'dayNightEffect')
      .name('Day/Night Effect')
      .listen();
    dayNightCtrl.domElement.style.pointerEvents = 'none';
    dayNightCtrl.domElement.style.opacity = '0.5';

    earthFolder
      .add(this.params, 'atmosphereEffect')
      .name('Atmosphere Effect')
      .onChange((value: boolean) => {
        if (this.atmosphere) {
          this.atmosphere.setAtmosphereVisible(value);
        }
      })

    // Note: Real-time Sun not implemented yet
    const realTimeSunCtrl = earthFolder
      .add(this.params, 'realTimeSun')
      .name('Real-time Sun')
      .listen();
    realTimeSunCtrl.domElement.style.pointerEvents = 'none';
    realTimeSunCtrl.domElement.style.opacity = '0.5';

    // Time Display textbox (editable but not functional yet)
    earthFolder
      .add(this.params, 'timeDisplay')
      .name('Time (UTC)')
      .onChange((value: string) => {
        // Parse time string format "HH:MM UTC"
        const match = value.match(/(\d{1,2}):(\d{2})/);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          if (hours >= 0 && hours <= 24 && minutes >= 0 && minutes < 60) {
            const newTime = hours + minutes / 60;
            this.params.simulatedTime = newTime;
            // Update display to standard format
            this.params.timeDisplay = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} UTC`;
          }
        }
      })
      .listen();

    const timeSliderCtrl = earthFolder
      .add(this.params, 'simulatedTime', 0, 24, 0.1)
      .name('Time Slider')
      .listen();
    timeSliderCtrl.domElement.style.pointerEvents = 'none';
    timeSliderCtrl.domElement.style.opacity = '0.5';

    // Note: Reset Sun Position not implemented yet
    const resetButton = { reset: () => {} };
    const resetCtrl = earthFolder
      .add(resetButton, 'reset')
      .name('Reset Sun Position');
    resetCtrl.domElement.style.pointerEvents = 'none';
    resetCtrl.domElement.style.opacity = '0.5';
  }

  private setupBrightnessControls(): void {
    const brightnessFolder = this.gui.addFolder('Brightness Controls');

    // Note: Day Brightness not implemented yet
    const dayBrightnessCtrl = brightnessFolder
      .add(this.params, 'dayBrightness', 0, 100, 1)
      .name('Day Brightness')
      .listen();
    dayBrightnessCtrl.domElement.style.pointerEvents = 'none';
    dayBrightnessCtrl.domElement.style.opacity = '0.5';

    // Note: Night Brightness not implemented yet
    const nightBrightnessCtrl = brightnessFolder
      .add(this.params, 'nightBrightness', 0, 100, 1)
      .name('Night Brightness')
      .listen();
    nightBrightnessCtrl.domElement.style.pointerEvents = 'none';
    nightBrightnessCtrl.domElement.style.opacity = '0.5';
  }

  private setupFlightControls(): void {
    const flightFolder = this.gui.addFolder('Flight Controls');

    // Flight count slider (1K to 1M) - works in real-time with debouncing
    flightFolder
      .add(this.params, 'numFlights', 1000, 1000000, 1000)
      .name('Number of Flights')
      .onChange((value: number) => {
        // Debounce slider changes (100ms delay)
        if (this.flightCountDebounceTimer !== null) {
          clearTimeout(this.flightCountDebounceTimer);
        }
        this.flightCountDebounceTimer = window.setTimeout(() => {
          this.callbacks.onFlightCountChange?.(value);
          this.flightCountDebounceTimer = null;
        }, 100);
      });

    // Read-only: fixed at initialization
    const returnFlightCtrl = flightFolder
      .add(this.params, 'returnFlight')
      .name('Return Flights')
      .listen();
    returnFlightCtrl.domElement.style.pointerEvents = 'none';
    returnFlightCtrl.domElement.style.opacity = '0.5';

    flightFolder.open();
  }

  private setupFlightPathControls(): void {
    const pathFolder = this.gui.addFolder('Flight Path');

    // Note: Dash Size not implemented yet
    const dashSizeCtrl = pathFolder
      .add(this.params, 'dashSize', 0, 100, 1)
      .name('Dash Size')
      .listen();
    dashSizeCtrl.domElement.style.pointerEvents = 'none';
    dashSizeCtrl.domElement.style.opacity = '0.5';

    // Note: Gap Size not implemented yet
    const gapSizeCtrl = pathFolder
      .add(this.params, 'gapSize', 0, 100, 1)
      .name('Gap Size')
      .listen();
    gapSizeCtrl.domElement.style.pointerEvents = 'none';
    gapSizeCtrl.domElement.style.opacity = '0.5';

    pathFolder
      .add(this.params, 'hidePath')
      .name('Hide Path')
      .onChange((value: boolean) => {
        if (this.curves) {
          this.curves.setCurvesVisible(!value);
        }
        this.callbacks.onCurvesVisibilityChange?.(!value);
      });

    pathFolder.open();
  }

  private setupPlaneControls(): void {
    const planeFolder = this.gui.addFolder('Plane Controls');

    planeFolder
      .add(this.params, 'planeSize', 1, 200, 1)
      .name('Plane Size')
      .onChange((value: number) => {
        const baseSize = value / 10; // Convert 100 scale to 10 base
        if (this.planes) {
          this.planes.setBaseSize(baseSize);
        }
        this.callbacks.onPlaneSizeChange?.(baseSize);
      });

    // Note: Plane Color not implemented yet
    const planeColorCtrl = planeFolder
      .add(this.params, 'planeColor')
      .name('Plane Color')
      .listen();
    planeColorCtrl.domElement.style.pointerEvents = 'none';
    planeColorCtrl.domElement.style.opacity = '0.5';

    // Note: Animation Speed not implemented yet
    const animSpeedCtrl = planeFolder
      .add(this.params, 'animationSpeed', 0.01, 1.0, 0.01)
      .name('Animation Speed')
      .listen();
    animSpeedCtrl.domElement.style.pointerEvents = 'none';
    animSpeedCtrl.domElement.style.opacity = '0.5';

    // Note: Elevation Offset not implemented yet
    const elevationCtrl = planeFolder
      .add(this.params, 'elevationOffset', 0, 100, 1)
      .name('Elevation Offset')
      .listen();
    elevationCtrl.domElement.style.pointerEvents = 'none';
    elevationCtrl.domElement.style.opacity = '0.5';

    // Read-only: Only SVG supported
    const styleCtrl = planeFolder
      .add(this.params, 'planeStyle', ['SVG'])
      .name('Plane Style')
      .listen();
    styleCtrl.domElement.style.pointerEvents = 'none';
    styleCtrl.domElement.style.opacity = '0.5';

    planeFolder
      .add(this.params, 'hidePlane')
      .name('Hide Planes')
      .onChange((value: boolean) => {
        if (this.planes) {
          this.planes.setPlanesVisible(!value);
        }
        this.callbacks.onPlanesVisibilityChange?.(!value);
      });

    planeFolder.open();
  }

  public setPlanes(planes: PlanesWebGPU): void {
    this.planes = planes;
  }

  public setCurves(curves: CurveManager): void {
    this.curves = curves;
  }

  public setFlightManager(flightManager: FlightManager): void {
    this.flightManager = flightManager;
    this.params.numFlights = flightManager.getVisibleFlightCount();
  }

  public setAtmosphere(atmosphere: AtmosphereWebGPU): void {
    this.atmosphere = atmosphere;
  }

  public getFlightCount(): number {
    return this.params.numFlights;
  }

  public destroy(): void {
    this.gui.destroy();
  }

  public show(): void {
    this.gui.domElement.style.display = 'block';
  }

  public hide(): void {
    this.gui.domElement.style.display = 'none';
  }
}

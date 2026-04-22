import { GUI, GUIController } from "dat.gui";
import {
  getCurrentUtcTimeHours,
  hoursToTimeString,
  timeStringToHours,
} from "../common/Utils.js";
import type {
  GUIFolder,
  ColorObject,
  RangeConfig,
  FlightControlsConfig,
  FlightPathControlsConfig,
  PlaneControlsConfig,
  ControlsOptions,
  GuiControls,
  ControlsCallbacks,
  KnownControllerKey,
  Controllers,
  FlightConfig,
  GuiParams,
  SvgAtlasInfo,
} from "../common/Types.js";
import type { Flight } from "../flights/Flight.ts";
import type { Curves } from "../curves/Curves.ts";
import type { PlanesShader } from "../planes/PlanesShader.ts";
import { FlightPathManager } from "./FlightPathManager.ts";
import { PlaneControlsManager } from "./PlaneControlsManager.ts";
import { FlightControlsManager } from "./FlightControlsManager.ts";
import type { EarthControlsManager } from "./EarthControlsManager.ts";

interface ControlsManagerDependencies {
  maxFlights: number;
  getFlights: () => Flight[];
  getPreGeneratedConfigs: () => FlightConfig[];
  getFlightCount: () => number;
  getMergedCurves: () => Curves | null;
  getMergedPanes: () => PlanesShader | null;
  ensurePlaneDefaults: (config?: Partial<FlightConfig>) => FlightConfig;
  assignRandomPlane: (config?: Partial<FlightConfig>) => FlightConfig;
  resolvePaneColor: (config?: Partial<FlightConfig>) => number;
  createFlightFromConfig: (config: FlightConfig, index: number) => Flight;
  loadSvgTexture: () => Promise<{ texture: any; info: SvgAtlasInfo }>;
  initializeFlights: () => void;
  fallbackPlaneColor: number;
  parsePlaneColor: (value: any, fallback: number) => number;
}

interface ControlsContext {
  params: GuiParams;
  managerDependencies: ControlsManagerDependencies;
  earthControlsManager?: EarthControlsManager | null;
  onStarCloudChange?: (value: boolean) => void;
  onStatsMeterChange?: (value: boolean) => void;
  resetSunPosition: () => void;
}

/**
 * Controls class manages all GUI controls and their interactions
 */
export class Controls {
  private gui: GUI | null = null;
  private controllers: Controllers = {};
  private guiControls: GuiControls;
  private callbacks: ControlsCallbacks = {};
  private context: ControlsContext | null = null;
  private managerDeps: ControlsManagerDependencies | null = null;
  private flightPathManager: FlightPathManager | null = null;
  private flightControlsManager: FlightControlsManager | null = null;
  private planeControlsManager: PlaneControlsManager | null = null;

  constructor() {
    this.guiControls = {
      dayNightEffect: true,
      atmosphereEffect: true,
      starCloud: true,
      statsMeter: false,
      realTimeSun: true,
      simulatedTime: getCurrentUtcTimeHours(),
      timeDisplay: hoursToTimeString(getCurrentUtcTimeHours()),
      nightBrightness: 15,
      dayBrightness: 80,
      planeSize: 100,
      planeColor: "#ff6666",
      animationSpeed: 0.1,
      elevationOffset: 15,
      paneStyle: "SVG",
      hidePlane: false,
      dashSize: 40,
      gapSize: 40,
      hidePath: false,
      numFlights: 5000,
      returnFlight: true,
    };
  }

  /**
   * Initialize the GUI controls
   * @param callbacks - Object containing callback functions for different controls
   * @param options - Configuration options for the controls
   */
  public setup(
    callbacks: ControlsCallbacks = {},
    options: ControlsOptions = {},
  ): void {
    this.callbacks = callbacks;
    this.gui = new GUI();

    if (options.planeSize !== undefined) {
      this.guiControls.planeSize = options.planeSize;
    }

    if (options.planeColor !== undefined) {
      this.guiControls.planeColor = this.formatColor(options.planeColor);
    }

    if (options.animationSpeed !== undefined) {
      this.guiControls.animationSpeed = options.animationSpeed;
    }

    if (options.elevationOffset !== undefined) {
      this.guiControls.elevationOffset = options.elevationOffset;
    }

    if (options.paneStyle !== undefined) {
      this.guiControls.paneStyle = options.paneStyle;
    }

    if (options.hidePlane !== undefined) {
      this.guiControls.hidePlane = !!options.hidePlane;
    }

    if (options.dashSize !== undefined) {
      this.guiControls.dashSize = options.dashSize;
    }

    if (options.gapSize !== undefined) {
      this.guiControls.gapSize = options.gapSize;
    }

    if (options.hidePath !== undefined) {
      this.guiControls.hidePath = !!options.hidePath;
    }

    if (options.numFlights !== undefined) {
      this.guiControls.numFlights = options.numFlights;
    }

    if (options.returnFlight !== undefined) {
      this.guiControls.returnFlight = !!options.returnFlight;
    }

    if (options.starCloud !== undefined) {
      this.guiControls.starCloud = !!options.starCloud;
    }

    if (options.statsMeter !== undefined) {
      this.guiControls.statsMeter = !!options.statsMeter;
    }

    this.setupFlightControls({
      flightCountRange: options.flightCountRange || {},
    });
    this.setupFlightPathControls({
      dashRange: options.dashRange || {},
      gapRange: options.gapRange || {},
    });
    this.setupPlaneControls({
      sizeRange: options.planeSizeRange || {},
      speedRange: options.speedRange || {},
      elevationRange: options.elevationRange || {},
      paneStyleOptions: options.paneStyleOptions || ["Pane", "SVG"],
    });
    this.setupSpaceControls();
    this.setupPerformanceControls();
    this.setupEarthControls();
    this.setupBrightnessControls();
    this.gui.close();
  }

  /**
   * Initialize controls using application managers. This wires up default
   * callbacks so callers do not need to provide manual bindings.
   */
  public initialize(
    context: ControlsContext,
    options: ControlsOptions = {},
  ): void {
    this.context = context;
    this.managerDeps = context.managerDependencies;
    this.configureManagers(context.managerDependencies);
    const callbacks = this.createCallbacksFromContext();
    this.setup(callbacks, options);
  }

  public getFlightPathManager(): FlightPathManager | null {
    return this.flightPathManager;
  }

  public getFlightControlsManager(): FlightControlsManager | null {
    return this.flightControlsManager;
  }

  public getPlaneControlsManager(): PlaneControlsManager | null {
    return this.planeControlsManager;
  }

  private createCallbacksFromContext(): ControlsCallbacks {
    if (!this.context) {
      return {};
    }

    const {
      params,
      earthControlsManager,
      onStarCloudChange,
      onStatsMeterChange,
      resetSunPosition,
    } = this.context;
    const planeControlsManager = this.planeControlsManager;
    const flightPathManager = this.flightPathManager;
    const flightControlsManager = this.flightControlsManager;

    return {
      onDayNightEffectChange: (value: boolean) => {
        earthControlsManager?.toggleDayNightEffect(value);
      },
      onAtmosphereEffectChange: (value: boolean) => {
        earthControlsManager?.toggleAtmosphereEffect(value);
      },
      onStarCloudChange: (value: boolean) => {
        params.starCloud = value;
        onStarCloudChange?.(value);
      },
      onStatsMeterChange: (value: boolean) => {
        params.statsMeter = value;
        onStatsMeterChange?.(value);
      },
      onResetSunPosition: () => {
        resetSunPosition();
      },
      onDayBrightnessChange: (value: number) => {
        earthControlsManager?.setDayBrightness(value);
      },
      onNightBrightnessChange: (value: number) => {
        earthControlsManager?.setNightBrightness(value);
      },
      onRealTimeSunChange: (value: boolean) => {
        if (value) {
          earthControlsManager?.enableRealTimeSun();
        } else {
          earthControlsManager?.disableRealTimeSun();
        }
        const { timeDisplay, timeSlider, realTimeSun } = this.controllers;
        timeDisplay?.updateDisplay();
        timeSlider?.updateDisplay();
        realTimeSun?.updateDisplay();
      },
      onTimeSliderChange: (value: number) => {
        earthControlsManager?.setSimulatedTime(value);
        const { timeDisplay, realTimeSun } = this.controllers;
        timeDisplay?.updateDisplay();
        realTimeSun?.updateDisplay();
      },
      onTimeDisplayChange: (value: string) => {
        if (earthControlsManager?.setTimeDisplay(value)) {
          const { timeSlider, realTimeSun } = this.controllers;
          timeSlider?.updateDisplay();
          realTimeSun?.updateDisplay();
        }
      },
      onPlaneSizeChange: (value: number) => {
        planeControlsManager?.setPlaneSize(value);
      },
      onPlaneColorChange: (value: string) => {
        planeControlsManager?.setPlaneColor(value);
      },
      onAnimationSpeedChange: (value: number) => {
        params.randomSpeed = false;
        planeControlsManager?.setAnimationSpeed(value);
      },
      onPlaneElevationChange: (value: number) => {
        planeControlsManager?.setElevationOffset(value);
      },
      onPaneStyleChange: (value: string) => {
        planeControlsManager?.setPaneStyle(value);
      },
      onHidePlaneChange: (value: boolean) => {
        planeControlsManager?.setHidePlane(value);
      },
      onDashSizeChange: (value: number) => {
        flightPathManager?.setDashSize(value);
      },
      onGapSizeChange: (value: number) => {
        flightPathManager?.setGapSize(value);
      },
      onHidePathChange: (value: boolean) => {
        flightPathManager?.setHidePath(value);
      },
      onFlightCountChange: (value: number) => {
        flightControlsManager?.updateFlightCount(value);
      },
      onReturnFlightChange: (value: boolean) => {
        flightControlsManager?.setReturnFlight(value);
      },
    };
  }

  private configureManagers(
    deps: ControlsManagerDependencies,
  ): void {
    if (!this.context) return;
    const { params } = this.context;

    this.flightPathManager = new FlightPathManager({
      params,
      getMergedCurves: deps.getMergedCurves,
      getFlightCount: deps.getFlightCount,
      syncDashSize: (value: number) => this.syncDashSize(value),
      syncGapSize: (value: number) => this.syncGapSize(value),
      syncHidePath: (value: boolean) => this.syncHidePath(value),
    });

    this.planeControlsManager = new PlaneControlsManager({
      params,
      getFlights: deps.getFlights,
      getPreGeneratedConfigs: deps.getPreGeneratedConfigs,
      getMergedPanes: deps.getMergedPanes,
      loadSvgTexture: deps.loadSvgTexture,
      initializeFlights: deps.initializeFlights,
      fallbackPlaneColor: deps.fallbackPlaneColor,
      parsePlaneColor: deps.parsePlaneColor,
      syncPlaneSize: (value: number) => this.syncPlaneSize(value),
      syncPlaneColor: (value: number) => this.syncPlaneColor(value),
      syncPaneStyle: (value: string) => this.syncPaneStyle(value),
      syncAnimationSpeed: (value: number) => this.syncAnimationSpeed(value),
      syncElevationOffset: (value: number) =>
        this.syncPlaneElevation(value),
      syncHidePlane: (value: boolean) => this.syncHidePlane(value),
    });

    this.flightControlsManager = new FlightControlsManager({
      params,
      maxFlights: deps.maxFlights,
      getFlights: deps.getFlights,
      getPreGeneratedConfigs: deps.getPreGeneratedConfigs,
      getMergedCurves: deps.getMergedCurves,
      getMergedPanes: deps.getMergedPanes,
      ensurePlaneDefaults: deps.ensurePlaneDefaults,
      assignRandomPlane: deps.assignRandomPlane,
      resolvePaneColor: deps.resolvePaneColor,
      resolveAnimationSpeed: (config: Partial<FlightConfig> = {}) => {
        return (
          this.planeControlsManager?.resolveAnimationSpeed(
            config as Record<string, any>,
          ) ?? params.animationSpeed
        );
      },
      createFlightFromConfig: deps.createFlightFromConfig,
      updatePathVisibility: () => {
        this.flightPathManager?.applyVisibility();
      },
      updatePlaneVisibility: () => {
        if (this.planeControlsManager) {
          this.planeControlsManager.setHidePlane(params.hidePlane);
        }
      },
      syncFlightCount: (value: number) => this.syncFlightCount(value),
      syncReturnFlight: (value: boolean) => this.syncReturnFlight(value),
    });
  }

  private setupEarthControls(): void {
    if (!this.gui) return;

    const earthFolder: GUIFolder = this.gui.addFolder("Earth Controls");

    earthFolder
      .add(this.guiControls, "dayNightEffect")
      .name("Day/Night Effect")
      .onChange((value: boolean) => {
        if (this.callbacks.onDayNightEffectChange) {
          this.callbacks.onDayNightEffectChange(value);
        }
      });

    earthFolder
      .add(this.guiControls, "atmosphereEffect")
      .name("Atmosphere Effect")
      .onChange((value: boolean) => {
        if (this.callbacks.onAtmosphereEffectChange) {
          this.callbacks.onAtmosphereEffectChange(value);
        }
      });

    this.controllers.realTimeSun = earthFolder
      .add(this.guiControls, "realTimeSun")
      .name("Real-time Sun")
      .onChange((value: boolean) => {
        if (!value) {
          // Reset to default position when disabled
          if (this.callbacks.onResetSunPosition) {
            this.callbacks.onResetSunPosition();
          }
        } else {
          // Update simulated time to current time when enabling real-time
          this.guiControls.simulatedTime = getCurrentUtcTimeHours();
          this.guiControls.timeDisplay = hoursToTimeString(
            this.guiControls.simulatedTime,
          );
          // Refresh GUI controllers to show updated values
          if (this.controllers.timeDisplay) {
            this.controllers.timeDisplay.updateDisplay();
          }
          if (this.controllers.timeSlider) {
            this.controllers.timeSlider.updateDisplay();
          }
        }

        if (this.callbacks.onRealTimeSunChange) {
          this.callbacks.onRealTimeSunChange(value);
        }
      });

    this.controllers.timeDisplay = earthFolder
      .add(this.guiControls, "timeDisplay")
      .name("Time (UTC)")
      .onChange((value: string) => {
        // This should not be called since the input is disabled
        // But keeping for safety
        if (/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(value)) {
          this.guiControls.simulatedTime = timeStringToHours(value);
          if (this.controllers.timeSlider) {
            this.controllers.timeSlider.updateDisplay();
          }
          // Disable real-time sun when manually adjusting time
          if (this.guiControls.realTimeSun) {
            this.guiControls.realTimeSun = false;
            if (this.controllers.realTimeSun) {
              this.controllers.realTimeSun.updateDisplay();
            }
          }

          if (this.callbacks.onTimeDisplayChange) {
            this.callbacks.onTimeDisplayChange(value);
          }
        }
      });

    // Disable the time display input to make it read-only
    if (this.controllers.timeDisplay?.__input) {
      this.controllers.timeDisplay.__input.disabled = true;
      this.controllers.timeDisplay.__input.style.cursor = "default";
      this.controllers.timeDisplay.__input.style.backgroundColor = "#2a2a2a";
      this.controllers.timeDisplay.__input.style.color = "#cccccc";
    }

    this.controllers.timeSlider = earthFolder
      .add(this.guiControls, "simulatedTime", 0, 24, 0.1)
      .name("Time Slider")
      .onChange((value: number) => {
        this.guiControls.timeDisplay = hoursToTimeString(value);
        if (this.controllers.timeDisplay) {
          this.controllers.timeDisplay.updateDisplay();
        }
        // Disable real-time sun when manually adjusting time
        if (this.guiControls.realTimeSun) {
          this.guiControls.realTimeSun = false;
          if (this.controllers.realTimeSun) {
            this.controllers.realTimeSun.updateDisplay();
          }
        }

        if (this.callbacks.onTimeSliderChange) {
          this.callbacks.onTimeSliderChange(value);
        }
      });

    earthFolder.close();
  }

  private setupSpaceControls(): void {
    if (!this.gui) return;

    const spaceFolder: GUIFolder = this.gui.addFolder("Space Controls");

    this.controllers.starCloud = spaceFolder
      .add(this.guiControls, "starCloud")
      .name("Star Cloud")
      .onChange((value: boolean) => {
        if (this.callbacks.onStarCloudChange) {
          this.callbacks.onStarCloudChange(value);
        }
      });

    spaceFolder.close();
  }

  private setupPerformanceControls(): void {
    if (!this.gui) return;

    const performanceFolder: GUIFolder = this.gui.addFolder(
      "Performance Controls",
    );

    this.controllers.statsMeter = performanceFolder
      .add(this.guiControls, "statsMeter")
      .name("Stats Meter")
      .onChange((value: boolean) => {
        if (this.callbacks.onStatsMeterChange) {
          this.callbacks.onStatsMeterChange(value);
        }
      });

    performanceFolder.close();
  }

  private setupBrightnessControls(): void {
    if (!this.gui) return;

    const brightnessFolder: GUIFolder = this.gui.addFolder(
      "Brightness Controls",
    );
    brightnessFolder
      .add(this.guiControls, "dayBrightness", 0, 100, 1)
      .name("Day")
      .onChange((value: number) => {
        if (this.callbacks.onDayBrightnessChange) {
          this.callbacks.onDayBrightnessChange(value);
        }
      });

    brightnessFolder
      .add(this.guiControls, "nightBrightness", 0, 100, 1)
      .name("Night")
      .onChange((value: number) => {
        if (this.callbacks.onNightBrightnessChange) {
          this.callbacks.onNightBrightnessChange(value);
        }
      });

    brightnessFolder.close();
  }

  private setupFlightControls(config: FlightControlsConfig = {}): void {
    if (!this.gui) return;

    const flightCountRange = config.flightCountRange || {};
    const countMin =
      flightCountRange.min !== undefined ? flightCountRange.min : 1;
    const countMax =
      flightCountRange.max !== undefined ? flightCountRange.max : 30000;
    const countStep =
      flightCountRange.step !== undefined ? flightCountRange.step : 1;

    const flightControlsFolder: GUIFolder =
      this.gui.addFolder("Flight Controls");

    this.controllers.numFlights = flightControlsFolder
      .add(this.guiControls, "numFlights", countMin, countMax)
      .name("Flight Count")
      .onChange((value: number) => {
        if (this.callbacks.onFlightCountChange) {
          this.callbacks.onFlightCountChange(value);
        }
      });
    const numFlightsController = this.controllers.numFlights;
    if (
      numFlightsController &&
      typeof numFlightsController.step === "function"
    ) {
      numFlightsController.step(countStep);
    }

    this.controllers.returnFlight = flightControlsFolder
      .add(this.guiControls, "returnFlight")
      .name("Return Flight")
      .onChange((value: boolean) => {
        if (this.callbacks.onReturnFlightChange) {
          this.callbacks.onReturnFlightChange(value);
        }
      });

    flightControlsFolder.close();
  }

  private setupFlightPathControls(config: FlightPathControlsConfig = {}): void {
    if (!this.gui) return;

    const dashRange = config.dashRange || {};
    const gapRange = config.gapRange || {};

    const dashMin = dashRange.min !== undefined ? dashRange.min : 0;
    const dashMax = dashRange.max !== undefined ? dashRange.max : 2000;
    const dashStep = dashRange.step !== undefined ? dashRange.step : 1;

    const gapMin = gapRange.min !== undefined ? gapRange.min : 0;
    const gapMax = gapRange.max !== undefined ? gapRange.max : 2000;
    const gapStep = gapRange.step !== undefined ? gapRange.step : 1;

    const flightPathFolder: GUIFolder = this.gui.addFolder("Flight Path");

    this.controllers.dashSize = flightPathFolder
      .add(this.guiControls, "dashSize", dashMin, dashMax)
      .name("Dash Length")
      .onChange((value: number) => {
        if (this.callbacks.onDashSizeChange) {
          this.callbacks.onDashSizeChange(value);
        }
      });
    const dashSizeController = this.controllers.dashSize;
    if (dashSizeController && typeof dashSizeController.step === "function") {
      dashSizeController.step(dashStep);
    }

    this.controllers.gapSize = flightPathFolder
      .add(this.guiControls, "gapSize", gapMin, gapMax)
      .name("Dash Gap")
      .onChange((value: number) => {
        if (this.callbacks.onGapSizeChange) {
          this.callbacks.onGapSizeChange(value);
        }
      });
    const gapSizeController = this.controllers.gapSize;
    if (gapSizeController && typeof gapSizeController.step === "function") {
      gapSizeController.step(gapStep);
    }

    this.controllers.hidePath = flightPathFolder
      .add(this.guiControls, "hidePath")
      .name("Hide Path")
      .onChange((value: boolean) => {
        if (this.callbacks.onHidePathChange) {
          this.callbacks.onHidePathChange(value);
        }
      });

    flightPathFolder.close();
  }

  private setupPlaneControls(config: PlaneControlsConfig = {}): void {
    if (!this.gui) return;

    const sizeRange = config.sizeRange || {};
    const speedRange = config.speedRange || {};
    const elevationRange = config.elevationRange || {};
    const paneStyleOptions =
      Array.isArray(config.paneStyleOptions) &&
      config.paneStyleOptions.length > 0
        ? config.paneStyleOptions
        : ["Pane", "SVG"];

    const sizeMin = sizeRange.min !== undefined ? sizeRange.min : 5;
    const sizeMax = sizeRange.max !== undefined ? sizeRange.max : 500;
    const sizeStep = sizeRange.step !== undefined ? sizeRange.step : 1;

    const speedMin = speedRange.min !== undefined ? speedRange.min : 0.01;
    const speedMax = speedRange.max !== undefined ? speedRange.max : 0.5;
    const speedStep = speedRange.step !== undefined ? speedRange.step : 0.01;

    const elevationMin =
      elevationRange.min !== undefined ? elevationRange.min : 0;
    const elevationMax =
      elevationRange.max !== undefined ? elevationRange.max : 200;
    const elevationStep =
      elevationRange.step !== undefined ? elevationRange.step : 5;

    const planeFolder: GUIFolder = this.gui.addFolder("Plane Controls");

    this.controllers.planeSize = planeFolder
      .add(this.guiControls, "planeSize", sizeMin, sizeMax)
      .name("Plane Size")
      .onChange((value: number) => {
        if (this.callbacks.onPlaneSizeChange) {
          this.callbacks.onPlaneSizeChange(value);
        }
      });
    const planeSizeController = this.controllers.planeSize;
    if (planeSizeController && typeof planeSizeController.step === "function") {
      planeSizeController.step(sizeStep);
    }

    this.controllers.planeColor = planeFolder
      .addColor(this.guiControls, "planeColor")
      .name("Plane Color")
      .onChange((value: string) => {
        if (this.callbacks.onPlaneColorChange) {
          this.callbacks.onPlaneColorChange(value);
        }
      });

    this.controllers.animationSpeed = planeFolder
      .add(this.guiControls, "animationSpeed", speedMin, speedMax)
      .name("Fly Speed")
      .onChange((value: number) => {
        if (this.callbacks.onAnimationSpeedChange) {
          this.callbacks.onAnimationSpeedChange(value);
        }
      });
    const animationSpeedController = this.controllers.animationSpeed;
    if (
      animationSpeedController &&
      typeof animationSpeedController.step === "function"
    ) {
      animationSpeedController.step(speedStep);
    }

    this.controllers.elevationOffset = planeFolder
      .add(this.guiControls, "elevationOffset", elevationMin, elevationMax)
      .name("Plane Elevation")
      .onChange((value: number) => {
        if (this.callbacks.onPlaneElevationChange) {
          this.callbacks.onPlaneElevationChange(value);
        }
      });
    const elevationOffsetController = this.controllers.elevationOffset;
    if (
      elevationOffsetController &&
      typeof elevationOffsetController.step === "function"
    ) {
      elevationOffsetController.step(elevationStep);
    }

    this.controllers.paneStyle = planeFolder
      .add(this.guiControls, "paneStyle", paneStyleOptions)
      .name("Plane Style")
      .onChange((value: string) => {
        if (this.callbacks.onPaneStyleChange) {
          this.callbacks.onPaneStyleChange(value);
        }
      });

    this.controllers.hidePlane = planeFolder
      .add(this.guiControls, "hidePlane")
      .name("Hide Plane")
      .onChange((value: boolean) => {
        if (this.callbacks.onHidePlaneChange) {
          this.callbacks.onHidePlaneChange(value);
        }
      });

    planeFolder.close();
  }

  public setPlaneSize(value: number): void {
    if (typeof value !== "number") {
      return;
    }

    this.guiControls.planeSize = value;
    if (this.controllers.planeSize) {
      this.controllers.planeSize.updateDisplay();
    }
  }

  public syncPlaneSize(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    if (this.guiControls.planeSize !== value) {
      this.setPlaneSize(value);
    }
  }

  public setPlaneColor(value: string | number | ColorObject): void {
    const formatted = this.formatColor(value);
    this.guiControls.planeColor = formatted;
    if (this.controllers.planeColor) {
      this.controllers.planeColor.updateDisplay();
    }
  }

  public syncPlaneColor(value: string | number | ColorObject): void {
    const formatted = this.formatColor(value);
    if (this.guiControls.planeColor !== formatted) {
      this.setPlaneColor(formatted);
    }
  }

  public setAnimationSpeed(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.animationSpeed = value;
    if (this.controllers.animationSpeed) {
      this.controllers.animationSpeed.updateDisplay();
    }
  }

  public syncAnimationSpeed(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    if (this.guiControls.animationSpeed !== value) {
      this.setAnimationSpeed(value);
    }
  }

  public setPlaneElevation(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.elevationOffset = value;
    if (this.controllers.elevationOffset) {
      this.controllers.elevationOffset.updateDisplay();
    }
  }

  public syncPlaneElevation(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    if (this.guiControls.elevationOffset !== value) {
      this.setPlaneElevation(value);
    }
  }

  public setPaneStyle(value: string): void {
    if (typeof value !== "string") {
      return;
    }
    this.guiControls.paneStyle = value;
    if (this.controllers.paneStyle) {
      this.controllers.paneStyle.updateDisplay();
    }
  }

  public syncPaneStyle(value: string): void {
    if (typeof value !== "string") {
      return;
    }
    if (this.guiControls.paneStyle !== value) {
      this.setPaneStyle(value);
    }
  }

  public setHidePlane(value: unknown): void {
    const boolValue = Boolean(value);
    this.guiControls.hidePlane = boolValue;
    if (this.controllers.hidePlane) {
      this.controllers.hidePlane.updateDisplay();
    }
  }

  public syncHidePlane(value: unknown): void {
    const boolValue = Boolean(value);
    if (this.guiControls.hidePlane !== boolValue) {
      this.setHidePlane(boolValue);
    }
  }

  public setDashSize(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.dashSize = value;
    if (this.controllers.dashSize) {
      this.controllers.dashSize.updateDisplay();
    }
  }

  public syncDashSize(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    if (this.guiControls.dashSize !== value) {
      this.setDashSize(value);
    }
  }

  public setGapSize(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.gapSize = value;
    if (this.controllers.gapSize) {
      this.controllers.gapSize.updateDisplay();
    }
  }

  public syncGapSize(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    if (this.guiControls.gapSize !== value) {
      this.setGapSize(value);
    }
  }

  public setHidePath(value: unknown): void {
    const boolValue = Boolean(value);
    this.guiControls.hidePath = boolValue;
    if (this.controllers.hidePath) {
      this.controllers.hidePath.updateDisplay();
    }
  }

  public syncHidePath(value: unknown): void {
    const boolValue = Boolean(value);
    if (this.guiControls.hidePath !== boolValue) {
      this.setHidePath(boolValue);
    }
  }

  public setFlightCount(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.numFlights = value;
    if (this.controllers.numFlights) {
      this.controllers.numFlights.updateDisplay();
    }
  }

  public syncFlightCount(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    if (this.guiControls.numFlights !== value) {
      this.setFlightCount(value);
    }
  }

  public setReturnFlight(value: unknown): void {
    const boolValue = Boolean(value);
    this.guiControls.returnFlight = boolValue;
    if (this.controllers.returnFlight) {
      this.controllers.returnFlight.updateDisplay();
    }
  }

  public syncReturnFlight(value: unknown): void {
    const boolValue = Boolean(value);
    if (this.guiControls.returnFlight !== boolValue) {
      this.setReturnFlight(boolValue);
    }
  }

  private formatColor(value: string | number | ColorObject): string {
    if (typeof value === "string") {
      return value.startsWith("#") ? value : `#${value}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return `#${value.toString(16).padStart(6, "0")}`;
    }
    if (value && typeof value === "object") {
      const r = Math.round(value.r ?? value.red ?? 0);
      const g = Math.round(value.g ?? value.green ?? 0);
      const b = Math.round(value.b ?? value.blue ?? 0);
      const hex = ((r << 16) | (g << 8) | b) >>> 0;
      return `#${hex.toString(16).padStart(6, "0")}`;
    }
    return this.guiControls.planeColor || "#ff6666";
  }

  /**
   * Update time display for real-time mode
   * Note: This is now handled directly in main.js updateSunPosition()
   */
  public updateTimeDisplay(): void {
    // This method is kept for backward compatibility
    // but the actual updates are now handled in main.js
  }

  /**
   * Get the current GUI controls values
   * @returns Current GUI controls state
   */
  public getControls(): GuiControls {
    return this.guiControls;
  }

  /**
   * Cleanup GUI
   */
  public destroy(): void {
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
    this.controllers = {};
  }
}

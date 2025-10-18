import { GUI, GUIController } from "dat.gui";
import {
  getCurrentUtcTimeHours,
  hoursToTimeString,
  timeStringToHours,
} from "./Utils.js";

// Type definitions for dat.GUI
interface GUIFolder {
  add(
    object: any,
    property: string,
    min?: number,
    max?: number,
    step?: number,
  ): GUIController;
  add(
    object: any,
    property: string,
    options?: string[] | { [key: string]: any },
  ): GUIController;
  addColor(object: any, property: string): GUIController;
  addFolder(name: string): GUIFolder;
  open(): GUIFolder;
  close(): GUIFolder;
}

interface GUIController {
  name(name: string): GUIController;
  onChange(callback: (value: any) => void): GUIController;
  step(step: number): GUIController;
  updateDisplay(): GUIController;
  __input?: HTMLInputElement;
}

// Interface for color object format
interface ColorObject {
  r?: number;
  g?: number;
  b?: number;
  red?: number;
  green?: number;
  blue?: number;
}

// Interface for range configuration
interface RangeConfig {
  min?: number;
  max?: number;
  step?: number;
}

// Interface for flight controls configuration
interface FlightControlsConfig {
  flightCountRange?: RangeConfig;
}

// Interface for flight path controls configuration
interface FlightPathControlsConfig {
  dashRange?: RangeConfig;
  gapRange?: RangeConfig;
}

// Interface for plane controls configuration
interface PlaneControlsConfig {
  sizeRange?: RangeConfig;
  speedRange?: RangeConfig;
  elevationRange?: RangeConfig;
  paneStyleOptions?: string[];
}

// Interface for general configuration options
interface ControlsOptions {
  planeSize?: number;
  planeColor?: string | number | ColorObject;
  animationSpeed?: number;
  elevationOffset?: number;
  paneStyle?: string;
  hidePlane?: boolean;
  dashSize?: number;
  gapSize?: number;
  hidePath?: boolean;
  numFlights?: number;
  returnFlight?: boolean;
  planeSizeRange?: RangeConfig;
  speedRange?: RangeConfig;
  elevationRange?: RangeConfig;
  paneStyleOptions?: string[];
  flightCountRange?: RangeConfig;
  dashRange?: RangeConfig;
  gapRange?: RangeConfig;
}

// Interface for GUI controls state
interface GuiControls {
  dayNightEffect: boolean;
  atmosphereEffect: boolean;
  realTimeSun: boolean;
  simulatedTime: number;
  timeDisplay: string;
  nightBrightness: number;
  dayBrightness: number;
  planeSize: number;
  planeColor: string;
  animationSpeed: number;
  elevationOffset: number;
  paneStyle: string;
  hidePlane: boolean;
  dashSize: number;
  gapSize: number;
  hidePath: boolean;
  numFlights: number;
  returnFlight: boolean;
}

// Interface for callback functions
interface ControlsCallbacks {
  onDayNightEffectChange?: (value: boolean) => void;
  onAtmosphereEffectChange?: (value: boolean) => void;
  onResetSunPosition?: () => void;
  onRealTimeSunChange?: (value: boolean) => void;
  onTimeDisplayChange?: (value: string) => void;
  onTimeSliderChange?: (value: number) => void;
  onDayBrightnessChange?: (value: number) => void;
  onNightBrightnessChange?: (value: number) => void;
  onFlightCountChange?: (value: number) => void;
  onReturnFlightChange?: (value: boolean) => void;
  onDashSizeChange?: (value: number) => void;
  onGapSizeChange?: (value: number) => void;
  onHidePathChange?: (value: boolean) => void;
  onPlaneSizeChange?: (value: number) => void;
  onPlaneColorChange?: (value: string) => void;
  onAnimationSpeedChange?: (value: number) => void;
  onPlaneElevationChange?: (value: number) => void;
  onPaneStyleChange?: (value: string) => void;
  onHidePlaneChange?: (value: boolean) => void;
}

// Known controller keys for strong typing while supporting dynamic keys
type KnownControllerKey =
  | "realTimeSun"
  | "timeDisplay"
  | "timeSlider"
  | "numFlights"
  | "returnFlight"
  | "dashSize"
  | "gapSize"
  | "hidePath"
  | "planeSize"
  | "planeColor"
  | "animationSpeed"
  | "elevationOffset"
  | "paneStyle"
  | "hidePlane";

// Interface for controllers storage
type Controllers = Partial<Record<KnownControllerKey, GUIController>> & {
  [key: string]: GUIController | undefined;
};

/**
 * Controls class manages all GUI controls and their interactions
 */
export class Controls {
  private gui: GUI | null = null;
  private controllers: Controllers = {};
  private guiControls: GuiControls;
  private callbacks: ControlsCallbacks = {};

  constructor() {
    this.guiControls = {
      dayNightEffect: true,
      atmosphereEffect: true,
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
    this.setupEarthControls();
    this.setupBrightnessControls();
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

    earthFolder.open();
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

    brightnessFolder.open();
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

    flightControlsFolder.open();
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

    flightPathFolder.open();
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

    const sizeMin = sizeRange.min !== undefined ? sizeRange.min : 50;
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

    planeFolder.open();
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

  public setPlaneColor(value: string | number | ColorObject): void {
    const formatted = this.formatColor(value);
    this.guiControls.planeColor = formatted;
    if (this.controllers.planeColor) {
      this.controllers.planeColor.updateDisplay();
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

  public setPlaneElevation(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.elevationOffset = value;
    if (this.controllers.elevationOffset) {
      this.controllers.elevationOffset.updateDisplay();
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

  public setHidePlane(value: unknown): void {
    const boolValue = Boolean(value);
    this.guiControls.hidePlane = boolValue;
    if (this.controllers.hidePlane) {
      this.controllers.hidePlane.updateDisplay();
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

  public setGapSize(value: number): void {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.gapSize = value;
    if (this.controllers.gapSize) {
      this.controllers.gapSize.updateDisplay();
    }
  }

  public setHidePath(value: unknown): void {
    const boolValue = Boolean(value);
    this.guiControls.hidePath = boolValue;
    if (this.controllers.hidePath) {
      this.controllers.hidePath.updateDisplay();
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

  public setReturnFlight(value: unknown): void {
    const boolValue = Boolean(value);
    this.guiControls.returnFlight = boolValue;
    if (this.controllers.returnFlight) {
      this.controllers.returnFlight.updateDisplay();
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

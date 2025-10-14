import { GUI } from "dat.gui";
import { getCurrentUtcTimeHours, hoursToTimeString, timeStringToHours } from "./Utils.js";

/**
 * Controls class manages all GUI controls and their interactions
 */
export class Controls {
  constructor() {
    this.gui = null;
    this.controllers = {};
    this.guiControls = {
      dayNightEffect: true,
      atmosphereEffect: true,
      realTimeSun: true,
      simulatedTime: getCurrentUtcTimeHours(),
      timeDisplay: hoursToTimeString(getCurrentUtcTimeHours()),
      nightBrightness: 0.8,
      dayBrightness: 2.0,
      planeSize: 100,
      planeColor: '#ff6666',
      animationSpeed: 0.1,
      elevationOffset: 15,
      paneStyle: 'SVG',
      hidePlane: false,
      dashSize: 40,
      gapSize: 40,
      hidePath: false,
    };
    this.callbacks = {};
  }

  /**
   * Initialize the GUI controls
   * @param {Object} callbacks - Object containing callback functions for different controls
   */
  setup(callbacks = {}, options = {}) {
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

    this.setupLightingControls();
    this.setupBrightnessControls();
    this.setupFlightPathControls({
      dashRange: options.dashRange || {},
      gapRange: options.gapRange || {}
    });
    this.setupPlaneControls({
      sizeRange: options.planeSizeRange || {},
      speedRange: options.speedRange || {},
      elevationRange: options.elevationRange || {},
      paneStyleOptions: options.paneStyleOptions || ['Pane', 'SVG']
    });
  }

  setupLightingControls() {
    const lightingFolder = this.gui.addFolder("Lighting Controls");
    lightingFolder
      .add(this.guiControls, "dayNightEffect")
      .name("Day/Night Effect")
      .onChange((value) => {
        if (this.callbacks.onDayNightEffectChange) {
          this.callbacks.onDayNightEffectChange(value);
        }
      });

    lightingFolder
      .add(this.guiControls, "atmosphereEffect")
      .name("Atmosphere Effect")
      .onChange((value) => {
        if (this.callbacks.onAtmosphereEffectChange) {
          this.callbacks.onAtmosphereEffectChange(value);
        }
      });

    this.controllers.realTimeSun = lightingFolder
      .add(this.guiControls, "realTimeSun")
      .name("Real-time Sun")
      .onChange((value) => {
        if (!value) {
          // Reset to default position when disabled
          if (this.callbacks.onResetSunPosition) {
            this.callbacks.onResetSunPosition();
          }
        } else {
          // Update simulated time to current time when enabling real-time
          this.guiControls.simulatedTime = getCurrentUtcTimeHours();
          this.guiControls.timeDisplay = hoursToTimeString(this.guiControls.simulatedTime);
          // Refresh GUI controllers to show updated values
          this.controllers.timeDisplay.updateDisplay();
          this.controllers.timeSlider.updateDisplay();
        }

        if (this.callbacks.onRealTimeSunChange) {
          this.callbacks.onRealTimeSunChange(value);
        }
      });

    this.controllers.timeDisplay = lightingFolder
      .add(this.guiControls, "timeDisplay")
      .name("Time (UTC)")
      .onChange((value) => {
        // This should not be called since the input is disabled
        // But keeping for safety
        if (/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(value)) {
          this.guiControls.simulatedTime = timeStringToHours(value);
          this.controllers.timeSlider.updateDisplay();
          // Disable real-time sun when manually adjusting time
          if (this.guiControls.realTimeSun) {
            this.guiControls.realTimeSun = false;
            this.controllers.realTimeSun.updateDisplay();
          }

          if (this.callbacks.onTimeDisplayChange) {
            this.callbacks.onTimeDisplayChange(value);
          }
        }
      });

    // Disable the time display input to make it read-only
    if (this.controllers.timeDisplay.__input) {
      this.controllers.timeDisplay.__input.disabled = true;
      this.controllers.timeDisplay.__input.style.cursor = 'default';
      this.controllers.timeDisplay.__input.style.backgroundColor = '#2a2a2a';
      this.controllers.timeDisplay.__input.style.color = '#cccccc';
    }

    this.controllers.timeSlider = lightingFolder
      .add(this.guiControls, "simulatedTime", 0, 24, 0.1)
      .name("Time Slider")
      .onChange((value) => {
        this.guiControls.timeDisplay = hoursToTimeString(value);
        this.controllers.timeDisplay.updateDisplay();
        // Disable real-time sun when manually adjusting time
        if (this.guiControls.realTimeSun) {
          this.guiControls.realTimeSun = false;
          this.controllers.realTimeSun.updateDisplay();
        }

        if (this.callbacks.onTimeSliderChange) {
          this.callbacks.onTimeSliderChange(value);
        }
      });

    lightingFolder.open();
  }

  setupBrightnessControls() {
    const brightnessFolder = this.gui.addFolder("Brightness Controls");
    brightnessFolder
      .add(this.guiControls, "dayBrightness", 0.0, 3.0, 0.1)
      .name("Day")
      .onChange((value) => {
        if (this.callbacks.onDayBrightnessChange) {
          this.callbacks.onDayBrightnessChange(value);
        }
      });

    brightnessFolder
      .add(this.guiControls, "nightBrightness", 0.0, 2.0, 0.1)
      .name("Night")
      .onChange((value) => {
        if (this.callbacks.onNightBrightnessChange) {
          this.callbacks.onNightBrightnessChange(value);
        }
      });

    brightnessFolder.open();
  }

  setupFlightPathControls(config = {}) {
    const dashRange = config.dashRange || {};
    const gapRange = config.gapRange || {};

    const dashMin = dashRange.min !== undefined ? dashRange.min : 0;
    const dashMax = dashRange.max !== undefined ? dashRange.max : 2000;
    const dashStep = dashRange.step !== undefined ? dashRange.step : 1;

    const gapMin = gapRange.min !== undefined ? gapRange.min : 0;
    const gapMax = gapRange.max !== undefined ? gapRange.max : 2000;
    const gapStep = gapRange.step !== undefined ? gapRange.step : 1;

    const flightPathFolder = this.gui.addFolder("Flight Path");

    this.controllers.dashSize = flightPathFolder
      .add(this.guiControls, "dashSize", dashMin, dashMax)
      .name("Dash Length")
      .onChange((value) => {
        if (this.callbacks.onDashSizeChange) {
          this.callbacks.onDashSizeChange(value);
        }
      });
    if (typeof this.controllers.dashSize.step === "function") {
      this.controllers.dashSize.step(dashStep);
    }

    this.controllers.gapSize = flightPathFolder
      .add(this.guiControls, "gapSize", gapMin, gapMax)
      .name("Dash Gap")
      .onChange((value) => {
        if (this.callbacks.onGapSizeChange) {
          this.callbacks.onGapSizeChange(value);
        }
      });
    if (typeof this.controllers.gapSize.step === "function") {
      this.controllers.gapSize.step(gapStep);
    }

    this.controllers.hidePath = flightPathFolder
      .add(this.guiControls, "hidePath")
      .name("Hide Path")
      .onChange((value) => {
        if (this.callbacks.onHidePathChange) {
          this.callbacks.onHidePathChange(value);
        }
      });

    flightPathFolder.open();
  }

  setupPlaneControls(config = {}) {
    const sizeRange = config.sizeRange || {};
    const speedRange = config.speedRange || {};
    const elevationRange = config.elevationRange || {};
    const paneStyleOptions = Array.isArray(config.paneStyleOptions) && config.paneStyleOptions.length > 0
      ? config.paneStyleOptions
      : ["Pane", "SVG"];

    const sizeMin = sizeRange.min !== undefined ? sizeRange.min : 50;
    const sizeMax = sizeRange.max !== undefined ? sizeRange.max : 500;
    const sizeStep = sizeRange.step !== undefined ? sizeRange.step : 1;

    const speedMin = speedRange.min !== undefined ? speedRange.min : 0.01;
    const speedMax = speedRange.max !== undefined ? speedRange.max : 0.5;
    const speedStep = speedRange.step !== undefined ? speedRange.step : 0.01;

    const elevationMin = elevationRange.min !== undefined ? elevationRange.min : 0;
    const elevationMax = elevationRange.max !== undefined ? elevationRange.max : 200;
    const elevationStep = elevationRange.step !== undefined ? elevationRange.step : 5;

    const planeFolder = this.gui.addFolder("Plane Controls");

    this.controllers.planeSize = planeFolder
      .add(this.guiControls, "planeSize", sizeMin, sizeMax)
      .name("Plane Size")
      .onChange((value) => {
        if (this.callbacks.onPlaneSizeChange) {
          this.callbacks.onPlaneSizeChange(value);
        }
      });
    if (typeof this.controllers.planeSize.step === "function") {
      this.controllers.planeSize.step(sizeStep);
    }

    this.controllers.planeColor = planeFolder
      .addColor(this.guiControls, "planeColor")
      .name("Plane Color")
      .onChange((value) => {
        if (this.callbacks.onPlaneColorChange) {
          this.callbacks.onPlaneColorChange(value);
        }
      });

    this.controllers.animationSpeed = planeFolder
      .add(this.guiControls, "animationSpeed", speedMin, speedMax)
      .name("Fly Speed")
      .onChange((value) => {
        if (this.callbacks.onAnimationSpeedChange) {
          this.callbacks.onAnimationSpeedChange(value);
        }
      });
    if (typeof this.controllers.animationSpeed.step === "function") {
      this.controllers.animationSpeed.step(speedStep);
    }

    this.controllers.elevationOffset = planeFolder
      .add(this.guiControls, "elevationOffset", elevationMin, elevationMax)
      .name("Plane Elevation")
      .onChange((value) => {
        if (this.callbacks.onPlaneElevationChange) {
          this.callbacks.onPlaneElevationChange(value);
        }
      });
    if (typeof this.controllers.elevationOffset.step === "function") {
      this.controllers.elevationOffset.step(elevationStep);
    }

    this.controllers.paneStyle = planeFolder
      .add(this.guiControls, "paneStyle", paneStyleOptions)
      .name("Plane Style")
      .onChange((value) => {
        if (this.callbacks.onPaneStyleChange) {
          this.callbacks.onPaneStyleChange(value);
        }
      });

    this.controllers.hidePlane = planeFolder
      .add(this.guiControls, "hidePlane")
      .name("Hide Plane")
      .onChange((value) => {
        if (this.callbacks.onHidePlaneChange) {
          this.callbacks.onHidePlaneChange(value);
        }
      });

    planeFolder.open();
  }

  setPlaneSize(value) {
    if (typeof value !== "number") {
      return;
    }

    this.guiControls.planeSize = value;
    if (this.controllers.planeSize) {
      this.controllers.planeSize.updateDisplay();
    }
  }

  setPlaneColor(value) {
    const formatted = this.formatColor(value);
    this.guiControls.planeColor = formatted;
    if (this.controllers.planeColor) {
      this.controllers.planeColor.updateDisplay();
    }
  }

  setAnimationSpeed(value) {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.animationSpeed = value;
    if (this.controllers.animationSpeed) {
      this.controllers.animationSpeed.updateDisplay();
    }
  }

  setPlaneElevation(value) {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.elevationOffset = value;
    if (this.controllers.elevationOffset) {
      this.controllers.elevationOffset.updateDisplay();
    }
  }

  setPaneStyle(value) {
    if (typeof value !== "string") {
      return;
    }
    this.guiControls.paneStyle = value;
    if (this.controllers.paneStyle) {
      this.controllers.paneStyle.updateDisplay();
    }
  }

  setHidePlane(value) {
    const boolValue = !!value;
    this.guiControls.hidePlane = boolValue;
    if (this.controllers.hidePlane) {
      this.controllers.hidePlane.updateDisplay();
    }
  }

  setDashSize(value) {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.dashSize = value;
    if (this.controllers.dashSize) {
      this.controllers.dashSize.updateDisplay();
    }
  }

  setGapSize(value) {
    if (typeof value !== "number") {
      return;
    }
    this.guiControls.gapSize = value;
    if (this.controllers.gapSize) {
      this.controllers.gapSize.updateDisplay();
    }
  }

  setHidePath(value) {
    const boolValue = !!value;
    this.guiControls.hidePath = boolValue;
    if (this.controllers.hidePath) {
      this.controllers.hidePath.updateDisplay();
    }
  }

  formatColor(value) {
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
  updateTimeDisplay() {
    // This method is kept for backward compatibility
    // but the actual updates are now handled in main.js
  }

  /**
   * Get the current GUI controls values
   * @returns {Object} Current GUI controls state
   */
  getControls() {
    return this.guiControls;
  }

  /**
   * Cleanup GUI
   */
  destroy() {
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
    this.controllers = {};
  }
}

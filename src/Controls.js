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

    this.setupLightingControls();
    this.setupBrightnessControls();
    this.setupPlaneControls(options.planeSizeRange || {});
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

  setupPlaneControls(range = {}) {
    const min = range.min !== undefined ? range.min : 50;
    const max = range.max !== undefined ? range.max : 500;
    const step = range.step !== undefined ? range.step : 1;

    const planeFolder = this.gui.addFolder("Plane Controls");
    this.controllers.planeSize = planeFolder
      .add(this.guiControls, "planeSize", min, max, step)
      .name("Plane Size")
      .onChange((value) => {
        if (this.callbacks.onPlaneSizeChange) {
          this.callbacks.onPlaneSizeChange(value);
        }
      });

    this.controllers.planeColor = planeFolder
      .addColor(this.guiControls, "planeColor")
      .name("Plane Color")
      .onChange((value) => {
        if (this.callbacks.onPlaneColorChange) {
          this.callbacks.onPlaneColorChange(value);
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

  formatColor(value) {
    if (typeof value === "string") {
      return value.startsWith("#") ? value : `#${value}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return `#${value.toString(16).padStart(6, "0")}`;
    }
    if (value && typeof value === "object" && "r" in value) {
      return value;
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

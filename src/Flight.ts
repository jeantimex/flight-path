import * as THREE from "three";

// Type definitions for flight data
interface FlightData {
  departure?: {
    coordinates: [number, number];
    [key: string]: any;
  };
  arrival?: {
    coordinates: [number, number];
    [key: string]: any;
  };
  [key: string]: any;
}

// Interface for merged curves renderer
interface MergedCurvesRenderer {
  setCurve(
    index: number,
    controlPoints: THREE.Vector3[],
    color: number,
    flightData?: FlightData | null,
  ): void;
  setCurveColor(
    index: number,
    color: number,
    flightData?: FlightData | null,
  ): void;
  hideCurve(index: number): void;
}

// Interface for merged panes renderer
interface MergedPanesRenderer {
  setPaneColor(index: number, color: number): void;
  setPaneSize(index: number, size: number): void;
  hidePane(index: number): void;
  setScale?(index: number, scale: number): void;
  setElevationOffset?(index: number, offset: number): void;
  updatePaneOnCurve?(
    index: number,
    curve: THREE.CatmullRomCurve3,
    t: number,
    epsilon: number,
    tiltMode: string,
  ): void;

  // Shader-based panes methods
  setCurveControlPoints?(index: number, points: THREE.Vector3[]): void;
  setAnimationSpeed?(index: number, speed: number): void;
  setTiltMode?(index: number, mode: string): void;
  setTextureIndex?(index: number, textureIndex: number): void;
}

// Interface for curve options
interface CurveOptions {
  segmentCount: number;
  color: number;
}

// Interface for pane options
interface PaneOptions {
  count: number;
  paneSize: number;
  color: number;
  elevationOffset: number;
  textureIndex: number;
}

// Type for tilt modes
type TiltMode = "Perpendicular" | "Horizontal" | "Vertical" | string;

// Interface for Flight constructor options
interface FlightOptions {
  mergedCurves?: MergedCurvesRenderer | null;
  curveIndex?: number;
  mergedPanes?: MergedPanesRenderer | null;
  paneIndex?: number;
  controlPoints?: THREE.Vector3[];
  segmentCount?: number;
  curveColor?: number;
  paneCount?: number;
  paneSize?: number;
  paneColor?: number;
  elevationOffset?: number;
  paneTextureIndex?: number;
  animationSpeed?: number;
  tiltMode?: TiltMode;
  returnFlight?: boolean;
  flightData?: FlightData | null;
}

// Interface for animation speed options
interface AnimationSpeedOptions {
  immediate?: boolean;
}

/**
 * Flight combines a curve (from Curves) and panes (from PanesShader) into a single flight unit.
 * This version uses shared merged renderers for maximum performance.
 */
export class Flight {
  private scene: THREE.Scene;
  private animationTime: number = 0;

  // Reference to the merged renderers and this flight's indices
  private mergedCurves: MergedCurvesRenderer | null;
  private curveIndex: number;
  private mergedPanes: MergedPanesRenderer | null;
  private paneIndex: number;

  // Curve options
  private controlPoints: THREE.Vector3[];
  private curveOptions: CurveOptions;

  // Pane options
  private paneOptions: PaneOptions;

  // Animation options
  private animationSpeed: number;
  private animationSpeedTarget: number;
  private tiltMode: TiltMode;
  private returnFlight: boolean;
  private flightData: FlightData | null;

  // Cached curve for performance (used for CPU-based panes)
  private _cachedCurve: THREE.CatmullRomCurve3 | null = null;

  // Detect if panes are shader-based or CPU-based
  private _isShaderBasedPanes: boolean = false;

  constructor(scene: THREE.Scene, options: FlightOptions = {}) {
    this.scene = scene;
    this.animationTime = 0;

    // Reference to the merged renderers and this flight's indices
    this.mergedCurves = options.mergedCurves || null;
    this.curveIndex =
      options.curveIndex !== undefined ? options.curveIndex : -1;
    this.mergedPanes = options.mergedPanes || null;
    this.paneIndex = options.paneIndex !== undefined ? options.paneIndex : -1;

    // Curve options
    this.controlPoints = options.controlPoints || [];
    this.curveOptions = {
      segmentCount: options.segmentCount || 100,
      color: options.curveColor || 0x4488ff,
    };

    // Pane options
    this.paneOptions = {
      count: options.paneCount || 1,
      paneSize: options.paneSize || 100,
      color: options.paneColor || 0xff6666,
      elevationOffset:
        options.elevationOffset !== undefined ? options.elevationOffset : 0,
      textureIndex:
        options.paneTextureIndex !== undefined ? options.paneTextureIndex : 0,
    };

    // Animation options
    this.animationSpeed = options.animationSpeed || 0.1;
    this.animationSpeedTarget = this.animationSpeed;
    this.tiltMode = options.tiltMode || "Perpendicular";
    this.returnFlight = options.returnFlight || false;
    this.flightData = options.flightData || null;

    // Cached curve for performance (used for CPU-based panes)
    this._cachedCurve = null;

    // Detect if panes are shader-based or CPU-based
    this._isShaderBasedPanes = false;
  }

  /**
   * Create the curve and pane
   */
  public create(): Flight {
    // Register curve with merged renderer
    if (this.mergedCurves && this.curveIndex >= 0) {
      this.mergedCurves.setCurve(
        this.curveIndex,
        this.controlPoints,
        this.curveOptions.color,
        this.flightData,
      );
      // Create cached curve for CPU-based pane animation
      this._cachedCurve = new THREE.CatmullRomCurve3(this.controlPoints);
    }

    // Initialize pane in merged renderer
    if (this.mergedPanes && this.paneIndex >= 0) {
      // Detect if panes are shader-based by checking for setCurveControlPoints method
      this._isShaderBasedPanes =
        typeof this.mergedPanes.setCurveControlPoints === "function";

      if (this._isShaderBasedPanes) {
        // GPU Shader-based panes: Upload control points once
        const fourPoints = this.resampleTo4Points(this.controlPoints);
        this.mergedPanes.setCurveControlPoints!(this.paneIndex, fourPoints);
        this.mergedPanes.setPaneColor(this.paneIndex, this.paneOptions.color);
        this.mergedPanes.setPaneSize(this.paneIndex, this.paneOptions.paneSize);
        if (typeof this.mergedPanes.setElevationOffset === "function") {
          this.mergedPanes.setElevationOffset(
            this.paneIndex,
            this.paneOptions.elevationOffset,
          );
        }
        this.mergedPanes.setAnimationSpeed!(
          this.paneIndex,
          this.animationSpeed,
        );
        this.mergedPanes.setTiltMode!(this.paneIndex, this.tiltMode);
        this._applyPaneTextureIndex();
      } else {
        // CPU-based panes: Just set initial color and size
        this.mergedPanes.setPaneColor(this.paneIndex, this.paneOptions.color);
        this.mergedPanes.setPaneSize(this.paneIndex, this.paneOptions.paneSize);
        if (typeof this.mergedPanes.setElevationOffset === "function") {
          this.mergedPanes.setElevationOffset(
            this.paneIndex,
            this.paneOptions.elevationOffset,
          );
        }
      }
    }

    return this;
  }

  /**
   * Update animation for pane on the curve
   * @param deltaTime - Time elapsed since last frame
   * Note: For shader-based panes, this does nothing (GPU handles animation)
   */
  public update(deltaTime: number): void {
    this._applyAnimationSpeedSmoothing(deltaTime);

    // Shader-based panes don't need per-flight position updates (GPU handles animation)
    if (this._isShaderBasedPanes) return;

    // CPU-based panes need per-flight position updates
    if (!this._cachedCurve || !this.mergedPanes || this.paneIndex < 0) return;

    // Update animation time
    this.animationTime += deltaTime * this.animationSpeed;

    // Calculate parameter t for this pane (supports single pane per flight for now)
    let t = this.animationTime % 1;
    if (this.returnFlight) {
      const cycle = this.animationTime % 2;
      t = cycle > 1 ? 2 - cycle : cycle;
    }

    // Update pane position on curve using merged panes renderer
    if (this.mergedPanes.updatePaneOnCurve) {
      this.mergedPanes.updatePaneOnCurve(
        this.paneIndex,
        this._cachedCurve,
        t,
        0.001,
        this.tiltMode,
      );
    }
  }

  /**
   * Enable or disable return flight behaviour
   */
  public setReturnFlight(enabled: boolean): void {
    const newMode = !!enabled;
    if (this.returnFlight === newMode) {
      return;
    }

    if (newMode) {
      this.animationTime = this.animationTime % 1;
    } else {
      const cycle = this.animationTime % 2;
      const t = cycle > 1 ? 2 - cycle : cycle;
      this.animationTime = t;
    }

    this.returnFlight = newMode;
  }

  /**
   * Set the curve control points and recreate the curve
   */
  public setControlPoints(controlPoints: THREE.Vector3[]): void {
    this.controlPoints = controlPoints;
    if (this.mergedCurves && this.curveIndex >= 0) {
      this.mergedCurves.setCurve(
        this.curveIndex,
        this.controlPoints,
        this.curveOptions.color,
        this.flightData,
      );
      // Update cached curve
      this._cachedCurve = new THREE.CatmullRomCurve3(this.controlPoints);
    }

    if (this._isShaderBasedPanes && this.mergedPanes && this.paneIndex >= 0) {
      const fourPoints = this.resampleTo4Points(this.controlPoints);
      this.mergedPanes.setCurveControlPoints!(this.paneIndex, fourPoints);
    }
  }

  /**
   * Update curve color
   */
  public applyPaneTextureIndex(): void {
    this._applyPaneTextureIndex();
  }

  public setPaneTextureIndex(textureIndex: number): void {
    this.paneOptions.textureIndex = textureIndex;
    this._applyPaneTextureIndex();
  }

  private _applyPaneTextureIndex(): void {
    if (!this._isShaderBasedPanes || !this.mergedPanes || this.paneIndex < 0)
      return;
    if (typeof this.mergedPanes.setTextureIndex === "function") {
      this.mergedPanes.setTextureIndex(
        this.paneIndex,
        this.paneOptions.textureIndex || 0,
      );
    }
  }

  public setCurveColor(color: number): void {
    this.curveOptions.color = color;
    if (this.mergedCurves && this.curveIndex >= 0) {
      this.mergedCurves.setCurveColor(this.curveIndex, color, this.flightData);
    }
  }

  /**
   * Update curve segment count
   * Note: Segment count is global in merged curves, kept for API compatibility
   */
  public setCurveSegmentCount(count: number): void {
    this.curveOptions.segmentCount = count;
    // Segment count is a global setting in Curves
    // To change it, you'd need to recreate the entire merged curves renderer
  }

  /**
   * Update pane color
   */
  public setPaneColor(color: number): void {
    this.paneOptions.color = color;
    if (this.mergedPanes && this.paneIndex >= 0) {
      this.mergedPanes.setPaneColor(this.paneIndex, color);
    }
  }

  /**
   * Update pane size
   */
  public setPaneSize(size: number): void {
    this.paneOptions.paneSize = size;
    if (this.mergedPanes && this.paneIndex >= 0) {
      this.mergedPanes.setPaneSize(this.paneIndex, size);
    }
  }

  /**
   * Set pane elevation offset above the curve
   */
  public setPaneElevation(offset: number): void {
    this.paneOptions.elevationOffset = offset;
    if (
      this.mergedPanes &&
      this.paneIndex >= 0 &&
      typeof this.mergedPanes.setElevationOffset === "function"
    ) {
      this.mergedPanes.setElevationOffset(this.paneIndex, offset);
    }
  }

  /**
   * Set animation speed
   */
  public setAnimationSpeed(
    speed: number,
    options: AnimationSpeedOptions = {},
  ): void {
    this.animationSpeedTarget = speed;

    if (this._isShaderBasedPanes && this.mergedPanes && this.paneIndex >= 0) {
      this.mergedPanes.setAnimationSpeed!(this.paneIndex, speed);
    }

    if (options.immediate) {
      this.animationSpeed = speed;
    }
  }

  private _applyAnimationSpeedSmoothing(deltaTime: number): void {
    const difference = this.animationSpeedTarget - this.animationSpeed;

    if (Math.abs(difference) < 1e-5) {
      if (
        this.animationSpeed !== this.animationSpeedTarget &&
        this._isShaderBasedPanes &&
        this.mergedPanes &&
        this.paneIndex >= 0
      ) {
        this.mergedPanes.setAnimationSpeed!(
          this.paneIndex,
          this.animationSpeedTarget,
        );
      }
      this.animationSpeed = this.animationSpeedTarget;
      return;
    }

    const factor = deltaTime ? Math.min(1, deltaTime * 6) : 1;
    this.animationSpeed += difference * factor;

    if (Math.abs(this.animationSpeedTarget - this.animationSpeed) < 1e-4) {
      this.animationSpeed = this.animationSpeedTarget;
    }

    if (this._isShaderBasedPanes && this.mergedPanes && this.paneIndex >= 0) {
      this.mergedPanes.setAnimationSpeed!(this.paneIndex, this.animationSpeed);
    }
  }

  /**
   * Set tilt mode for panes
   */
  public setTiltMode(mode: TiltMode): void {
    this.tiltMode = mode;

    // Update shader-based panes
    if (this._isShaderBasedPanes && this.mergedPanes && this.paneIndex >= 0) {
      this.mergedPanes.setTiltMode!(this.paneIndex, mode);
    }
  }

  /**
   * Set scale for a specific pane
   */
  public setPaneScale(scale: number): void {
    if (this.mergedPanes && this.paneIndex >= 0 && this.mergedPanes.setScale) {
      this.mergedPanes.setScale(this.paneIndex, scale);
    }
  }

  /**
   * Get the curve object (returns cached curve for compatibility)
   */
  public getCurve(): THREE.CatmullRomCurve3 | null {
    return this._cachedCurve;
  }

  /**
   * Get the pane object (returns merged panes reference for compatibility)
   */
  public getPane(): MergedPanesRenderer | null {
    return this.mergedPanes;
  }

  /**
   * Check if flight exists
   */
  public exists(): boolean {
    return this._cachedCurve !== null && this.mergedPanes !== null;
  }

  /**
   * Remove from scene and cleanup
   */
  public remove(): void {
    // Hide curve in merged renderer
    if (this.mergedCurves && this.curveIndex >= 0) {
      this.mergedCurves.hideCurve(this.curveIndex);
    }

    // Hide pane in merged renderer
    if (this.mergedPanes && this.paneIndex >= 0) {
      this.mergedPanes.hidePane(this.paneIndex);
    }

    // Clear cached curve
    this._cachedCurve = null;
  }

  /**
   * Resample control points to exactly 4 points for shader-based panes
   * @param controlPoints - Original control points
   * @returns Array of exactly 4 control points
   */
  public resampleTo4Points(controlPoints: THREE.Vector3[]): THREE.Vector3[] {
    if (controlPoints.length === 4) {
      return controlPoints;
    }

    // Create a curve from the original points
    const curve = new THREE.CatmullRomCurve3(controlPoints);

    // Sample 4 evenly spaced points along the curve
    return [
      curve.getPoint(0.0),
      curve.getPoint(0.333),
      curve.getPoint(0.666),
      curve.getPoint(1.0),
    ];
  }

  public setFlightData(data: FlightData | null): void {
    this.flightData = data || null;
  }
}

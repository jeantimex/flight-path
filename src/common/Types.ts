import * as THREE from "three";
import { GUIController } from "dat.gui";

// =============================================================================
// FLIGHT DATA AND FLIGHT TYPES
// =============================================================================

export interface FlightData {
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

export interface FlightConfig {
  controlPoints: THREE.Vector3[];
  segmentCount: number;
  curveColor?: any;
  paneCount?: number;
  paneSize: number;
  paneColor?: number;
  animationSpeed?: number;
  tiltMode?: string;
  returnFlight: boolean;
  elevationOffset?: number;
  flightData?: any;
  paneTextureIndex?: number;
  planeInfo?: any;
  _randomSpeed?: number;
}

export interface FlightParams {
  flightCount?: number;
  numFlights?: number;
  returnFlight: boolean;
  dashSize?: number;
  gapSize?: number;
  hidePath?: boolean;
  planeSize?: number;
  planeColor?: string | number;
  animationSpeed?: number;
  elevationOffset?: number;
  paneStyle?: string;
  hidePlane?: boolean;
  segmentCount?: number;
  randomSpeed?: boolean;
}

export interface FlightControlsManagerOptions {
  params: FlightParams;
  maxFlights: number;
  getFlights: () => any[];
  getPreGeneratedConfigs: () => FlightConfig[];
  getMergedCurves: () => any;
  getMergedPanes?: () => any;
  ensurePlaneDefaults: (config?: Partial<FlightConfig>) => FlightConfig;
  assignRandomPlane: (config?: Partial<FlightConfig>) => FlightConfig;
  resolvePaneColor: (config?: Partial<FlightConfig>) => number;
  resolveAnimationSpeed: (config?: Partial<FlightConfig>) => number;
  createFlightFromConfig: (config: FlightConfig, index: number) => any;
  updatePathVisibility: () => void;
  updatePlaneVisibility: () => void;
  syncFlightCount?: (value: number) => void;
  syncReturnFlight?: (value: boolean) => void;
}

export interface FlightPathParams {
  dashSize: number;
  gapSize: number;
  hidePath: boolean;
}

export interface FlightPathManagerOptions {
  params: FlightPathParams;
  getMergedCurves: () => any;
  getFlightCount: () => number;
  syncDashSize?: (value: number) => void;
  syncGapSize?: (value: number) => void;
  syncHidePath?: (value: boolean) => void;
}

// =============================================================================
// RENDERER INTERFACES
// =============================================================================

export interface MergedCurvesRenderer {
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

export interface MergedPanesRenderer {
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

export interface PlanesShaderOptions {
  maxPanes?: number;
  baseSize?: number;
  returnMode?: boolean;
  baseElevation?: number;
}

export interface AtlasInfo {
  columns: number;
  rows: number;
  count: number;
  scale?: {
    x: number;
    y: number;
  };
}

export interface InternalAtlasInfo {
  columns: number;
  rows: number;
  count: number;
  scaleX: number;
  scaleY: number;
}

// =============================================================================
// FLIGHT OPTIONS AND CONFIGURATION
// =============================================================================

export interface CurveOptions {
  segmentCount: number;
  color: number;
}

export interface PaneOptions {
  count: number;
  paneSize: number;
  color: number;
  elevationOffset: number;
  textureIndex: number;
}

export type TiltMode = "Perpendicular" | "Horizontal" | "Vertical" | string;

export interface FlightOptions {
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

export interface AnimationSpeedOptions {
  immediate?: boolean;
}

// =============================================================================
// FLIGHT UTILS TYPES
// =============================================================================

export interface Bounds {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  minZ?: number;
  maxZ?: number;
}

export interface RandomCurveOptions {
  start?: THREE.Vector3;
  end?: THREE.Vector3;
  numControlPoints?: number;
  spread?: number;
  radius?: number;
  center?: THREE.Vector3;
  bounds?: Bounds;
}

export interface ColorOptions {
  saturation?: number;
  lightness?: number;
}

export interface FlightConfigOptions extends RandomCurveOptions {
  segmentCount?: number;
  curveColor?: number;
  paneCount?: number;
  paneSize?: number;
  paneColor?: number;
  animationSpeed?: number;
  tiltMode?: string;
  returnFlight?: boolean;
}

export interface GradientColorConfig {
  type: "gradient";
  departureLat?: number;
  departureLng?: number;
}

// =============================================================================
// GUI AND CONTROLS TYPES
// =============================================================================

export interface GUIFolder {
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

export interface ColorObject {
  r?: number;
  g?: number;
  b?: number;
  red?: number;
  green?: number;
  blue?: number;
}

export interface RangeConfig {
  min?: number;
  max?: number;
  step?: number;
}

export interface FlightControlsConfig {
  flightCountRange?: RangeConfig;
}

export interface FlightPathControlsConfig {
  dashRange?: RangeConfig;
  gapRange?: RangeConfig;
}

export interface PlaneControlsConfig {
  sizeRange?: RangeConfig;
  speedRange?: RangeConfig;
  elevationRange?: RangeConfig;
  paneStyleOptions?: string[];
}

export interface ControlsOptions {
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
  starCloud?: boolean;
  statsMeter?: boolean;
  planeSizeRange?: RangeConfig;
  speedRange?: RangeConfig;
  elevationRange?: RangeConfig;
  paneStyleOptions?: string[];
  flightCountRange?: RangeConfig;
  dashRange?: RangeConfig;
  gapRange?: RangeConfig;
}

export interface GuiControls {
  dayNightEffect: boolean;
  atmosphereEffect: boolean;
  starCloud: boolean;
  statsMeter: boolean;
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

export interface ControlsCallbacks {
  onDayNightEffectChange?: (value: boolean) => void;
  onAtmosphereEffectChange?: (value: boolean) => void;
  onStarCloudChange?: (value: boolean) => void;
  onStatsMeterChange?: (value: boolean) => void;
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

export type KnownControllerKey =
  | "realTimeSun"
  | "starCloud"
  | "statsMeter"
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

export type Controllers = Partial<Record<KnownControllerKey, GUIController>> & {
  [key: string]: GUIController | undefined;
};

// =============================================================================
// CURVES TYPES
// =============================================================================

export interface CurvesOptions {
  segmentCount?: number;
  dashSize?: number;
  gapSize?: number;
  scene?: THREE.Scene;
}

export interface CurveData {
  controlPoints: THREE.Vector3[];
  color: number | THREE.Color | GradientColorConfig;
  visible: boolean;
  metadata: CurveMetadata | null;
}

export interface CurveMetadata {
  departure?: {
    lat: number;
    lng: number;
  };
  [key: string]: any;
}

export interface GradientParams {
  hue: number;
  saturation: number;
  lightnessStart: number;
  lightnessEnd: number;
}

// =============================================================================
// MAIN APPLICATION TYPES
// =============================================================================

export interface PlaneEntry {
  name: string;
  svg: string;
  color: string;
  atlasIndex: number;
}

export interface SvgAtlasInfo {
  columns: number;
  rows: number;
  count: number;
  scale: { x: number; y: number };
}

export interface PerfStats {
  flightUpdates: number;
  mergedUpdates: number;
  controlsUpdate: number;
  render: number;
  total: number;
}

export interface GuiParams {
  numFlights: number;
  elevationOffset: number;
  segmentCount: number;
  planeSize: number;
  planeColor: number;
  animationSpeed: number;
  tiltMode: string;
  paneStyle: string;
  returnFlight: boolean;
  hidePlane: boolean;
  dashSize: number;
  gapSize: number;
  hidePath: boolean;
  randomSpeed: boolean;
  starCloud: boolean;
  statsMeter: boolean;
}

// =============================================================================
// MANAGER OPTIONS
// =============================================================================

export interface EarthControlsOptions {
  ambientLight: THREE.AmbientLight;
  directionalLight: THREE.DirectionalLight;
  getGuiControls: () => any;
  updateLighting: () => void;
  getEarth: () => any;
  getCurrentUtcTimeHours: () => number;
  hoursToTimeString: (hours: number) => string;
}

export interface PlaneControlsManagerOptions {
  params: Record<string, any>;
  getFlights: () => any[];
  getPreGeneratedConfigs: () => Array<Record<string, any>>;
  getMergedPanes: () => any;
  loadSvgTexture: () => Promise<{ texture: any; info: any }>;
  initializeFlights: () => void;
  syncPlaneSize?: (value: number) => void;
  syncPlaneColor?: (value: number) => void;
  syncPaneStyle?: (value: string) => void;
  parsePlaneColor?: (value: any, fallback: number) => number;
  fallbackPlaneColor: number;
  syncAnimationSpeed?: (value: number) => void;
  syncElevationOffset?: (value: number) => void;
  syncHidePlane?: (value: boolean) => void;
}

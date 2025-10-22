import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Flight } from "./flights/Flight.ts";
import { Curves } from "./curves/Curves.ts";
import { PlanesShader } from "./planes/PlanesShader.ts";
import { FlightUtils } from "./flights/FlightUtils.ts";
import { Stars } from "./space/Stars.ts";
import { Earth } from "./space/Earth.ts";
import { Controls } from "./managers/Controls.ts";
import { EarthControlsManager } from "./managers/EarthControlsManager.ts";
import { FlightControlsManager } from "./managers/FlightControlsManager.ts";
import { FlightPathManager } from "./managers/FlightPathManager.ts";
import { PlaneControlsManager } from "./managers/PlaneControlsManager.ts";
import {
  flights as dataFlights,
  type Flight as FlightData,
} from "./common/Data.ts";
import { planes as planeDefinitions } from "./planes/Planes.ts";
import {
  getCurrentUtcTimeHours,
  hoursToTimeString,
  parseHexColor,
  updateLighting as utilsUpdateLighting,
  updateSunPosition as utilsUpdateSunPosition,
  setInitialCameraPosition as utilsSetInitialCameraPosition,
} from "./common/Utils.ts";
import { UIManager } from "./managers/UIManager.ts";
import type {
  PlaneEntry,
  FlightConfig,
  SvgAtlasInfo,
  PerfStats,
  GuiParams,
} from "./common/Types.js";

const DATA_FLIGHT_COUNT: number = Array.isArray(dataFlights)
  ? dataFlights.length
  : 0;
const MAX_FLIGHTS: number = DATA_FLIGHT_COUNT > 0 ? DATA_FLIGHT_COUNT : 30000;
const EARTH_RADIUS: number = 3000;
const MIN_CURVE_ALTITUDE: number = 20;
const TAKEOFF_LANDING_OFFSET: number = 18;
const MIN_CRUISE_ALTITUDE: number = 30;
const MAX_CRUISE_ALTITUDE: number = 220;
const DEFAULT_PLANE_COLOR: number = 0xff6666;
const FALLBACK_PLANE_COUNT: number = 8;
const PLANE_ATLAS_COLUMNS: number = 4;
const PLANE_ATLAS_ROWS: number = 2;
const PLANE_TEXTURE_SIZE: number = 512;
const TARGET_AMBIENT_COLOR = new THREE.Color(0xffffff);
const DEFAULT_DAY_BRIGHTNESS_PERCENT = 70;
const DEFAULT_NIGHT_BRIGHTNESS_PERCENT = 40;

export class App {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly uiManager: UIManager;

  private flights: Flight[] = [];
  private mergedCurves: Curves | null = null;
  private mergedPanes: PlanesShader | null = null;
  private stars: Stars | null = null;
  private earth: Earth | null = null;
  private initialCameraPositioned: boolean = false;
  private earthTextureLoaded = false;
  private minTimeElapsed = false;
  private readonly clock = new THREE.Clock();
  private preGeneratedConfigs: FlightConfig[] = [];
  private minLoadingTimeoutId: number | null = null;

  private readonly planeEntries: PlaneEntry[];
  private readonly planeSvgCount: number;
  private readonly textureLoader = new THREE.TextureLoader();
  private svgTexture: THREE.Texture | null = null;
  private svgAtlasInfo: SvgAtlasInfo | null = null;
  private svgTexturePromise:
    | Promise<{ texture: THREE.Texture; info: SvgAtlasInfo }>
    | null = null;
  private controlsManager!: Controls;
  private guiControls: any = null;
  private earthControlsManager: EarthControlsManager | null = null;
  private readonly params: GuiParams;
  private flightPathManager!: FlightPathManager;
  private flightControlsManager!: FlightControlsManager;
  private planeControlsManager!: PlaneControlsManager;
  private ambientLight: THREE.AmbientLight | null = null;
  private directionalLight: THREE.DirectionalLight | null = null;
  private controls!: OrbitControls;
  private enableProfiling: boolean = false;
  private perfStats: PerfStats = {
    flightUpdates: 0,
    mergedUpdates: 0,
    controlsUpdate: 0,
    render: 0,
    total: 0,
  };

  private readonly updateLightingFn = (): void => {
    this.updateLighting();
  };

  private readonly handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "p" || event.key === "P") {
      this.enableProfiling = !this.enableProfiling;
    }
  };

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);

    this.uiManager.beginStats();

    const delta = this.clock.getDelta();
    let t0: number | undefined;
    let t1: number | undefined;

    if (this.enableProfiling) t0 = performance.now();

    if (this.mergedPanes) {
      this.mergedPanes.update(delta);
    }

    if (this.stars) {
      this.stars.update(delta);
    }

    this.updateSunPosition();
    this.uiManager.updateCoordinateDisplay(this.camera, this.earth);

    if (this.enableProfiling) {
      t1 = performance.now();
      this.perfStats.flightUpdates += (t1 ?? 0) - (t0 ?? 0);
    }

    if (this.enableProfiling) t0 = performance.now();
    if (this.mergedCurves) {
      this.mergedCurves.applyUpdates();
    }
    if (this.enableProfiling) {
      t1 = performance.now();
      this.perfStats.mergedUpdates += (t1 ?? 0) - (t0 ?? 0);
    }

    if (this.enableProfiling) t0 = performance.now();
    this.controls.update();
    if (this.enableProfiling) {
      t1 = performance.now();
      this.perfStats.controlsUpdate += (t1 ?? 0) - (t0 ?? 0);
    }

    if (this.enableProfiling) t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    if (this.enableProfiling) {
      t1 = performance.now();
      this.perfStats.render += (t1 ?? 0) - (t0 ?? 0);
      this.perfStats.total += 1;
    }

    this.uiManager.endStats();
  };

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      50000,
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000);
    document.querySelector("#app")!.appendChild(this.renderer.domElement);

    this.uiManager = new UIManager();

    this.planeEntries = this.createPlaneEntries();
    this.planeSvgCount = this.planeEntries.length;

    const initialPlaneColor = parseHexColor(
      this.planeEntries[0]?.color,
      DEFAULT_PLANE_COLOR,
    );

    this.params = {
      numFlights: Math.min(5000, MAX_FLIGHTS),
      elevationOffset: 15,
      segmentCount: 100,
      planeSize: 100,
      planeColor: initialPlaneColor,
      animationSpeed: 0.1,
      tiltMode: "Tangent",
      paneStyle: "SVG",
      dashSize: 40,
      gapSize: 40,
      hidePath: false,
      hidePlane: false,
      randomSpeed: false,
      returnFlight: true,
    } as GuiParams;

    this.controlsManager = new Controls();

    this.addSpaceEnvironment();
    this.setupLighting();
    this.setupEarthControls();
    this.setupGlobalControls();
    this.preGenerateFlightConfigs();
    this.initializeFlights();
    this.updateLighting();
    this.updateSunPosition();
    this.prepareUi();
    this.setupCamera();
    this.setupOrbitControls();
    this.setupEventListeners();
    this.animate();
  }

  private createPlaneEntries(): PlaneEntry[] {
    if (Array.isArray(planeDefinitions) && planeDefinitions.length > 0) {
      return planeDefinitions.map((plane: any, index: number) => ({
        ...plane,
        atlasIndex: index,
      }));
    }

    return Array.from({ length: FALLBACK_PLANE_COUNT }, (_, index) => ({
      name: `plane${index + 1}`,
      svg: `plane${index + 1}.svg`,
      color: `#${DEFAULT_PLANE_COLOR.toString(16).padStart(6, "0")}`,
      atlasIndex: index,
    }));
  }

  private addSpaceEnvironment(): void {
    this.stars = new Stars(5000, 10000, 20000);
    this.stars.addToScene(this.scene);

    this.earth = new Earth(EARTH_RADIUS, () => {
      this.earthTextureLoaded = true;
      this.checkReadyToStart();
    });
    this.earth.addToScene(this.scene);
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0x404040, 0.35);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.directionalLight.position.set(1000, 1000, 1000);
    this.directionalLight.target.position.set(0, 0, 0);
    this.scene.add(this.directionalLight.target);
    this.scene.add(this.directionalLight);
  }

  private setupEarthControls(): void {
    if (!this.ambientLight || !this.directionalLight) return;

    this.earthControlsManager = new EarthControlsManager({
      ambientLight: this.ambientLight,
      directionalLight: this.directionalLight,
      getGuiControls: () => this.guiControls,
      updateLighting: () => this.updateLighting(),
      getEarth: () => this.earth,
      getCurrentUtcTimeHours,
      hoursToTimeString,
    });
  }

  private setupGlobalControls(): void {
    if (!this.controlsManager) {
      this.controlsManager = new Controls();
    }

    const managerDependencies = {
      maxFlights: MAX_FLIGHTS,
      getFlights: () => this.flights,
      getPreGeneratedConfigs: () => this.preGeneratedConfigs,
      getFlightCount: () => this.flights.length,
      getMergedCurves: () => this.mergedCurves,
      getMergedPanes: () => this.mergedPanes,
      ensurePlaneDefaults: (config?: Partial<FlightConfig>) =>
        this.ensurePlaneDefaults(config),
      assignRandomPlane: (config?: Partial<FlightConfig>) =>
        this.assignRandomPlane(config),
      resolvePaneColor: (config?: Partial<FlightConfig>) =>
        this.resolvePaneColor(config),
      createFlightFromConfig: (config: FlightConfig, index: number) =>
        this.createFlightFromConfig(config, index),
      loadSvgTexture: () => this.loadSvgTexture(),
      initializeFlights: () => this.initializeFlights(),
      fallbackPlaneColor: DEFAULT_PLANE_COLOR,
      parsePlaneColor: (value: any, fallback: number) =>
        parseHexColor(value, fallback),
    };

    const resetSunPosition = (): void => {
      if (this.directionalLight) {
        this.directionalLight.position.set(0, 1000, 1000);
      }
      this.updateSunPosition();
    };

    this.controlsManager.initialize(
      {
        params: this.params,
        managerDependencies,
        earthControlsManager: this.earthControlsManager,
        resetSunPosition,
      },
      {
        planeSize: this.params.planeSize,
        planeSizeRange: { min: 5, max: 500 },
        planeColor: this.params.planeColor,
        animationSpeed: this.params.animationSpeed,
        speedRange: { min: 0.01, max: 0.5, step: 0.01 },
        elevationOffset: this.params.elevationOffset,
        elevationRange: { min: 0, max: 200, step: 5 },
        paneStyle: this.params.paneStyle,
        paneStyleOptions: ["Pane", "SVG"],
        hidePlane: this.params.hidePlane,
        dashSize: this.params.dashSize,
        dashRange: { min: 0, max: 2000, step: 1 },
        gapSize: this.params.gapSize,
        gapRange: { min: 0, max: 2000, step: 1 },
        hidePath: this.params.hidePath,
        numFlights: this.params.numFlights,
        flightCountRange: { min: 1, max: MAX_FLIGHTS, step: 1 },
        returnFlight: this.params.returnFlight,
      },
    );

    const flightPathManager = this.controlsManager.getFlightPathManager();
    const planeControlsManager = this.controlsManager.getPlaneControlsManager();
    const flightControlsManager =
      this.controlsManager.getFlightControlsManager();

    if (!flightPathManager || !planeControlsManager || !flightControlsManager) {
      throw new Error("Failed to initialize core managers");
    }

    this.flightPathManager = flightPathManager;
    this.planeControlsManager = planeControlsManager;
    this.flightControlsManager = flightControlsManager;

    this.guiControls = this.controlsManager.getControls();
    this.earthControlsManager?.initializeFromGui(this.guiControls);
    document.querySelectorAll(".dg.ac").forEach((container) => {
      (container as HTMLElement).style.display = "none";
    });

    if (this.earthControlsManager && this.guiControls) {
      this.earthControlsManager.setDayBrightness(
        this.guiControls.dayBrightness,
      );
      this.earthControlsManager.setNightBrightness(
        this.guiControls.nightBrightness,
      );
      if (this.guiControls.realTimeSun) {
        this.earthControlsManager.enableRealTimeSun();
      }

      this.earthControlsManager.toggleAtmosphereEffect(
        this.guiControls.atmosphereEffect,
      );
      this.earthControlsManager.toggleDayNightEffect(
        this.guiControls.dayNightEffect,
      );
    }
  }

  private setupCamera(): void {
    this.camera.position.set(0, 2000, 8000);
    this.camera.lookAt(0, 0, 0);
  }

  private setupOrbitControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 3200;
    this.controls.maxDistance = 20000;
    this.controls.maxPolarAngle = Math.PI;
  }

  private setupEventListeners(): void {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  private prepareUi(): void {
    this.earthTextureLoaded = false;
    this.minTimeElapsed = false;

    this.uiManager.createLoadingScreen();
    this.uiManager.createFooter();
    this.uiManager.hideDuringLoading();
    this.uiManager.updateCoordinateDisplay(this.camera, this.earth);

    this.minLoadingTimeoutId = window.setTimeout(() => {
      this.minTimeElapsed = true;
      this.checkReadyToStart();
    }, 2000);
  }

  private ensurePlaneDefaults(
    config: Partial<FlightConfig> = {},
  ): FlightConfig {
    return FlightUtils.ensurePlaneDefaults(
      config,
      this.planeEntries,
      DEFAULT_PLANE_COLOR,
      parseHexColor,
    );
  }

  private assignRandomPlane(
    config: Partial<FlightConfig> = {},
  ): FlightConfig {
    return FlightUtils.assignRandomPlane(
      config,
      this.planeEntries,
      DEFAULT_PLANE_COLOR,
      parseHexColor,
    );
  }

  private createDataFlightConfig(entry: FlightData): FlightConfig | null {
    return FlightUtils.createDataFlightConfig(
      entry,
      this.params,
      EARTH_RADIUS,
      TAKEOFF_LANDING_OFFSET,
      MIN_CURVE_ALTITUDE,
      MIN_CRUISE_ALTITUDE,
      MAX_CRUISE_ALTITUDE,
      this.planeEntries,
      DEFAULT_PLANE_COLOR,
      parseHexColor,
    );
  }

  private preGenerateFlightConfigs(): void {
    this.preGeneratedConfigs = FlightUtils.preGenerateFlightConfigs(
      dataFlights,
      MAX_FLIGHTS,
      this.params,
      EARTH_RADIUS,
      MIN_CURVE_ALTITUDE,
      this.planeEntries,
      DEFAULT_PLANE_COLOR,
      parseHexColor,
      (entry: FlightData) => this.createDataFlightConfig(entry),
      (config: Partial<FlightConfig>) => this.assignRandomPlane(config),
    );
  }

  private checkReadyToStart(): void {
    if (this.earthTextureLoaded && this.minTimeElapsed) {
      this.setInitialCameraPosition();
    }
  }

  private resolvePaneColor(
    config: Partial<FlightConfig> = {},
  ): number {
    if (typeof config.paneColor === "number") {
      return config.paneColor;
    }

    const color = parseHexColor(this.params.planeColor, DEFAULT_PLANE_COLOR);
    config.paneColor = color;
    return color;
  }

  private updateLighting(): void {
    if (
      !this.guiControls ||
      !this.ambientLight ||
      !this.directionalLight
    ) {
      return;
    }

    utilsUpdateLighting(
      this.guiControls,
      this.earthControlsManager,
      this.ambientLight,
      this.directionalLight,
      TARGET_AMBIENT_COLOR,
      DEFAULT_DAY_BRIGHTNESS_PERCENT,
      DEFAULT_NIGHT_BRIGHTNESS_PERCENT,
    );
  }

  private updateSunPosition(): void {
    if (!this.directionalLight) {
      return;
    }

    utilsUpdateSunPosition(
      this.directionalLight,
      this.earth,
      this.earthControlsManager,
      this.guiControls,
      this.uiManager,
      this.camera,
      this.updateLightingFn,
    );
  }

  private setInitialCameraPosition(): void {
    this.initialCameraPositioned = utilsSetInitialCameraPosition(
      this.earth,
      this.camera,
      this.uiManager,
      this.initialCameraPositioned,
    );
  }

  private loadSvgTexture(): Promise<{
    texture: THREE.Texture;
    info: SvgAtlasInfo;
  }> {
    if (this.svgTexture && this.svgAtlasInfo) {
      return Promise.resolve({
        texture: this.svgTexture,
        info: this.svgAtlasInfo,
      });
    }

    if (this.svgTexturePromise) {
      return this.svgTexturePromise;
    }

    this.svgTexturePromise = (async () => {
      try {
        const parser = new DOMParser();
        const rasterSize = PLANE_TEXTURE_SIZE;
        const aspect = 30 / 28;
        const heightSize = Math.round(rasterSize * aspect);

        const rasterizedImages: HTMLImageElement[] = [];

        for (const plane of this.planeEntries) {
          const svgPath =
            typeof plane.svg === "string" && plane.svg.length > 0
              ? plane.svg
              : `plane${(plane.atlasIndex ?? 0) + 1}.svg`;
          const url = `${import.meta.env.BASE_URL || "/"}${svgPath}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch SVG (${svgPath}): ${response.status} ${response.statusText}`,
            );
          }
          const svgText = await response.text();
          const doc = parser.parseFromString(svgText, "image/svg+xml");
          const svgElement = doc.documentElement;
          svgElement.setAttribute("width", `${rasterSize}`);
          svgElement.setAttribute("height", `${heightSize}`);
          if (!svgElement.getAttribute("viewBox")) {
            svgElement.setAttribute("viewBox", "0 0 28 30");
          }

          const serialized = new XMLSerializer().serializeToString(svgElement);
          const blob = new Blob([serialized], { type: "image/svg+xml" });
          const objectUrl = URL.createObjectURL(blob);
          const image = await new Promise<HTMLImageElement>(
            (resolve, reject) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
              };
              img.onerror = (error) => {
                URL.revokeObjectURL(objectUrl);
                reject(error);
              };
              img.src = objectUrl;
            },
          );
          rasterizedImages.push(image);
        }

        const atlasCanvas = document.createElement("canvas");
        atlasCanvas.width = PLANE_ATLAS_COLUMNS * rasterSize;
        atlasCanvas.height = PLANE_ATLAS_ROWS * heightSize;
        const ctx = atlasCanvas.getContext("2d")!;
        ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);

        rasterizedImages.forEach((img, idx) => {
          const col = idx % PLANE_ATLAS_COLUMNS;
          const row = Math.floor(idx / PLANE_ATLAS_COLUMNS);
          const x = col * rasterSize;
          const y = row * heightSize;
          ctx.drawImage(img, x, y, rasterSize, heightSize);
        });

        const atlasUrl = atlasCanvas.toDataURL("image/png");

        this.svgAtlasInfo = {
          columns: PLANE_ATLAS_COLUMNS,
          rows: PLANE_ATLAS_ROWS,
          count: this.planeSvgCount,
          scale: { x: 1 / PLANE_ATLAS_COLUMNS, y: 1 / PLANE_ATLAS_ROWS },
        };

        return await new Promise<{
          texture: THREE.Texture;
          info: SvgAtlasInfo;
        }>((resolve, reject) => {
          this.textureLoader.load(
            atlasUrl,
            (texture) => {
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.generateMipmaps = true;
              texture.minFilter = THREE.LinearMipmapLinearFilter;
              texture.magFilter = THREE.LinearFilter;
              texture.anisotropy =
                this.renderer.capabilities?.getMaxAnisotropy?.() || 1;
              texture.needsUpdate = true;
              this.svgTexture = texture;
              resolve({ texture: this.svgTexture, info: this.svgAtlasInfo! });
            },
            undefined,
            (error) => {
              console.error("Failed to load SVG atlas texture:", error);
              reject(error);
            },
          );
        });
      } catch (error) {
        console.error("Failed to prepare SVG texture atlas:", error);
        this.svgTexturePromise = null;
        throw error;
      }
    })();

    return this.svgTexturePromise;
  }

  private applyPaneTexture(): void {
    if (!this.mergedPanes || typeof this.mergedPanes.setTexture !== "function") {
      return;
    }

    if (this.params.paneStyle === "SVG") {
      if (this.svgTexture && this.svgAtlasInfo) {
        this.mergedPanes.setTexture(this.svgTexture, this.svgAtlasInfo);
        this.flights.forEach((flight) => flight.applyPaneTextureIndex?.());
      } else {
        this.mergedPanes.setTexture(null);
        this.loadSvgTexture()
          .then(({ texture, info }) => {
            if (this.params.paneStyle === "SVG" && this.mergedPanes) {
              this.mergedPanes.setTexture(texture, info);
              this.flights.forEach((flight) =>
                flight.applyPaneTextureIndex?.(),
              );
            }
          })
          .catch(() => {});
      }
    } else {
      this.mergedPanes.setTexture(null);
    }
  }

  private createFlightFromConfig(
    config: FlightConfig,
    flightIndex: number,
  ): Flight {
    const flightConfig = {
      ...config,
      mergedCurves: this.mergedCurves,
      curveIndex: flightIndex,
      mergedPanes: this.mergedPanes,
      paneIndex: flightIndex,
    };

    const flight = new Flight(this.scene, flightConfig);
    flight.create();

    if ("flightData" in flightConfig) {
      flight.setFlightData(flightConfig.flightData);
    }
    if (flightConfig.paneTextureIndex !== undefined) {
      flight.setPaneTextureIndex(flightConfig.paneTextureIndex);
    }

    flight.setAnimationSpeed(
      flightConfig.animationSpeed !== undefined
        ? flightConfig.animationSpeed
        : this.params.animationSpeed,
      { immediate: true },
    );
    flight.setTiltMode(this.params.tiltMode);
    if (flightConfig.elevationOffset !== undefined) {
      flight.setPaneElevation(flightConfig.elevationOffset);
    } else {
      flight.setPaneElevation(this.params.elevationOffset);
    }
    flight.setReturnFlight(flightConfig.returnFlight);

    return flight;
  }

  private initializeFlights(): void {
    this.flights.forEach((flight) => flight.remove());
    this.flights = [];

    if (this.mergedCurves) {
      this.mergedCurves.remove();
    }
    if (this.mergedPanes) {
      this.mergedPanes.remove();
    }

    this.mergedCurves = new Curves(this.scene, {
      maxCurves: MAX_FLIGHTS,
      segmentsPerCurve: this.params.segmentCount,
      dashSize: this.params.dashSize,
      gapSize: this.params.gapSize,
    });

    this.mergedPanes = new PlanesShader(this.scene, {
      maxPanes: MAX_FLIGHTS,
      baseSize: this.params.planeSize,
      returnMode: this.params.returnFlight,
      baseElevation: this.params.elevationOffset,
    });

    this.flightPathManager.applyDashPattern();
    this.applyPaneTexture();

    const availableConfigs = this.preGeneratedConfigs.length;
    const desiredCount =
      availableConfigs > 0
        ? Math.min(this.params.numFlights, availableConfigs)
        : this.params.numFlights;

    if (availableConfigs > 0 && this.params.numFlights !== desiredCount) {
      this.params.numFlights = desiredCount;
    }

    for (let i = 0; i < desiredCount; i++) {
      let baseConfig: FlightConfig;
      if (availableConfigs > 0) {
        const configIndex = i % availableConfigs;
        baseConfig = this.ensurePlaneDefaults(
          this.preGeneratedConfigs[configIndex],
        );
        baseConfig.returnFlight = this.params.returnFlight;
        this.preGeneratedConfigs[configIndex] = baseConfig;
      } else {
        baseConfig = this.assignRandomPlane(
          FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 }),
        );
        baseConfig.returnFlight = this.params.returnFlight;
      }

      const flightConfig: FlightConfig = {
        ...baseConfig,
        controlPoints: FlightUtils.cloneControlPoints(
          baseConfig.controlPoints,
        ),
        segmentCount: this.params.segmentCount,
        curveColor: baseConfig.curveColor,
        paneSize: this.params.planeSize,
        paneColor: this.resolvePaneColor(baseConfig),
        animationSpeed: this.planeControlsManager.resolveAnimationSpeed(
          baseConfig as Record<string, any>,
        ),
        elevationOffset:
          baseConfig.elevationOffset !== undefined
            ? baseConfig.elevationOffset
            : this.params.elevationOffset,
        paneTextureIndex: baseConfig.paneTextureIndex,
        returnFlight: this.params.returnFlight,
      };

      const flight = this.createFlightFromConfig(flightConfig, i);
      this.flights.push(flight);
    }

    this.flightPathManager.applyVisibility();
    this.planeControlsManager.setHidePlane(this.params.hidePlane);
    this.flightControlsManager.setReturnFlight(this.params.returnFlight);
  }

}

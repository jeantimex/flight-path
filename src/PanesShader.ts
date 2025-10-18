import * as THREE from "three";
import vertexShader from "./shaders/panes.vert?raw";
import fragmentShader from "./shaders/panes.frag?raw";

/**
 * Options for configuring the PanesShader
 */
export interface PanesShaderOptions {
  maxPanes?: number;
  baseSize?: number;
  returnMode?: boolean;
  baseElevation?: number;
}

/**
 * Atlas information for texture management
 */
export interface AtlasInfo {
  columns: number;
  rows: number;
  count: number;
  scale?: {
    x: number;
    y: number;
  };
}

/**
 * Internal atlas info with required scale properties
 */
interface InternalAtlasInfo {
  columns: number;
  rows: number;
  count: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Tilt mode for pane orientation
 */
export type TiltMode = "Perpendicular" | "Tangent";

/**
 * PanesShader - Ultimate performance pane renderer with GPU-side animation
 * All curve calculations, transformations, and animations happen in the vertex shader.
 * CPU only updates time uniform per frame - no per-flight work on CPU!
 */
export class PanesShader {
  private scene: THREE.Scene;
  private maxPanes: number;
  private baseSize: number;
  private returnModeEnabled: boolean;
  private defaultElevation: number;

  // Instanced mesh components
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.PlaneGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;

  // Per-instance data: curve control points (4 points for CatmullRom)
  // Each flight needs 4 control points (12 floats = 3 vec4 attributes)
  private controlPointsPack1: Float32Array; // (p0.x, p0.y, p0.z, p1.x)
  private controlPointsPack2: Float32Array; // (p1.y, p1.z, p2.x, p2.y)
  private controlPointsPack3: Float32Array; // (p2.z, p3.x, p3.y, p3.z)

  // Per-instance colors and metadata
  private instanceColors: Float32Array; // RGB per instance
  private instanceScales: Float32Array; // Scale multiplier per instance
  private instanceElevations: Float32Array; // Elevation offset per instance
  private instanceUvTransforms: Float32Array; // (offsetX, offsetY, scaleX, scaleY)
  private animationParams: Float32Array; // (phase, speed, tiltMode, visible)

  // Tracking
  private activePanes: number = 0;
  private atlasInfo: InternalAtlasInfo | null = null;
  private planesVisible: boolean = true;
  private returnModePreferred: boolean;
  private pendingReturnCompletion: Uint8Array;

  constructor(scene: THREE.Scene, options: PanesShaderOptions = {}) {
    this.scene = scene;
    this.maxPanes = options.maxPanes || 1000;
    this.baseSize = options.baseSize || 100;
    this.returnModeEnabled = !!options.returnMode;
    this.defaultElevation =
      options.baseElevation !== undefined ? options.baseElevation : 0;
    this.returnModePreferred = this.returnModeEnabled;

    // Initialize arrays
    this.controlPointsPack1 = new Float32Array(this.maxPanes * 4);
    this.controlPointsPack2 = new Float32Array(this.maxPanes * 4);
    this.controlPointsPack3 = new Float32Array(this.maxPanes * 4);
    this.instanceColors = new Float32Array(this.maxPanes * 3);
    this.instanceScales = new Float32Array(this.maxPanes);
    this.instanceElevations = new Float32Array(this.maxPanes);
    this.instanceUvTransforms = new Float32Array(this.maxPanes * 4);
    this.animationParams = new Float32Array(this.maxPanes * 4);
    this.pendingReturnCompletion = new Uint8Array(this.maxPanes);

    this.initialize();
  }

  /**
   * Initialize the instanced mesh with GPU animation shader
   */
  private initialize(): void {
    // Create plane geometry (centered at origin)
    this.geometry = new THREE.PlaneGeometry(this.baseSize, this.baseSize);

    // Add per-instance attributes for curve control points
    this.geometry.setAttribute(
      "controlPointsPack1",
      new THREE.InstancedBufferAttribute(this.controlPointsPack1, 4),
    );
    this.geometry.setAttribute(
      "controlPointsPack2",
      new THREE.InstancedBufferAttribute(this.controlPointsPack2, 4),
    );
    this.geometry.setAttribute(
      "controlPointsPack3",
      new THREE.InstancedBufferAttribute(this.controlPointsPack3, 4),
    );

    // Add per-instance attributes for rendering
    this.geometry.setAttribute(
      "instanceColor",
      new THREE.InstancedBufferAttribute(this.instanceColors, 3),
    );
    this.geometry.setAttribute(
      "instanceScale",
      new THREE.InstancedBufferAttribute(this.instanceScales, 1),
    );
    this.geometry.setAttribute(
      "instanceElevation",
      new THREE.InstancedBufferAttribute(this.instanceElevations, 1),
    );
    this.geometry.setAttribute(
      "instanceUVTransform",
      new THREE.InstancedBufferAttribute(this.instanceUvTransforms, 4),
    );
    this.geometry.setAttribute(
      "animationParams",
      new THREE.InstancedBufferAttribute(this.animationParams, 4),
    );

    // Create shader material with GPU-side animation
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        baseSize: { value: this.baseSize },
        paneMap: { value: null },
        useTexture: { value: 0.0 },
        returnMode: { value: this.returnModeEnabled ? 1.0 : 0.0 },
        paneVisibility: { value: 1.0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
    });

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      this.maxPanes,
    );

    // Initialize all instances as hidden
    for (let i = 0; i < this.maxPanes; i++) {
      // Initialize colors to white so textures tint correctly
      this.instanceColors[i * 3] = 1.0;
      this.instanceColors[i * 3 + 1] = 1.0;
      this.instanceColors[i * 3 + 2] = 1.0;

      // Initialize scale to 0 (hidden)
      this.instanceScales[i] = 0.0;
      this.instanceElevations[i] = this.defaultElevation;

      // Initialize animation params (phase, speed, tiltMode, visible)
      this.animationParams[i * 4] = Math.random(); // phase
      this.animationParams[i * 4 + 1] = 0.1; // speed
      this.animationParams[i * 4 + 2] = 0.0; // tiltMode (0=perpendicular)
      this.animationParams[i * 4 + 3] = 0.0; // visible (0=hidden)

      // Default UV transform covers entire texture
      const uvIndex = i * 4;
      this.instanceUvTransforms[uvIndex] = 0.0;
      this.instanceUvTransforms[uvIndex + 1] = 0.0;
      this.instanceUvTransforms[uvIndex + 2] = 1.0;
      this.instanceUvTransforms[uvIndex + 3] = 1.0;

      // Initialize control points to zero
      this.controlPointsPack1[i * 4] = 0;
      this.controlPointsPack1[i * 4 + 1] = 0;
      this.controlPointsPack1[i * 4 + 2] = 0;
      this.controlPointsPack1[i * 4 + 3] = 0;

      this.controlPointsPack2[i * 4] = 0;
      this.controlPointsPack2[i * 4 + 1] = 0;
      this.controlPointsPack2[i * 4 + 2] = 0;
      this.controlPointsPack2[i * 4 + 3] = 0;

      this.controlPointsPack3[i * 4] = 0;
      this.controlPointsPack3[i * 4 + 1] = 0;
      this.controlPointsPack3[i * 4 + 2] = 0;
      this.controlPointsPack3[i * 4 + 3] = 0;
    }

    // Mark all attributes for initial upload
    this.markAllAttributesNeedUpdate();

    // Add to scene
    this.scene.add(this.instancedMesh);
  }

  /**
   * Set curve control points for a pane instance
   * This is called ONCE when creating a flight, not every frame!
   * @param index - Index of the pane
   * @param controlPoints - Array of 4 control points
   */
  public setCurveControlPoints(
    index: number,
    controlPoints: THREE.Vector3[],
  ): void {
    if (index < 0 || index >= this.maxPanes) return;
    if (controlPoints.length < 4) {
      console.warn("PanesShader requires 4 control points");
      return;
    }

    // Pack control points into attributes
    // Pack 1: (p0.x, p0.y, p0.z, p1.x)
    this.controlPointsPack1[index * 4] = controlPoints[0].x;
    this.controlPointsPack1[index * 4 + 1] = controlPoints[0].y;
    this.controlPointsPack1[index * 4 + 2] = controlPoints[0].z;
    this.controlPointsPack1[index * 4 + 3] = controlPoints[1].x;

    // Pack 2: (p1.y, p1.z, p2.x, p2.y)
    this.controlPointsPack2[index * 4] = controlPoints[1].y;
    this.controlPointsPack2[index * 4 + 1] = controlPoints[1].z;
    this.controlPointsPack2[index * 4 + 2] = controlPoints[2].x;
    this.controlPointsPack2[index * 4 + 3] = controlPoints[2].y;

    // Pack 3: (p2.z, p3.x, p3.y, p3.z)
    this.controlPointsPack3[index * 4] = controlPoints[2].z;
    this.controlPointsPack3[index * 4 + 1] = controlPoints[3].x;
    this.controlPointsPack3[index * 4 + 2] = controlPoints[3].y;
    this.controlPointsPack3[index * 4 + 3] = controlPoints[3].z;

    // Mark pane as visible
    this.animationParams[index * 4 + 3] = 1.0;

    // Mark control point attributes for upload
    if (this.geometry) {
      this.geometry.attributes.controlPointsPack1.needsUpdate = true;
      this.geometry.attributes.controlPointsPack2.needsUpdate = true;
      this.geometry.attributes.controlPointsPack3.needsUpdate = true;
      this.geometry.attributes.animationParams.needsUpdate = true;
    }
  }

  /**
   * Enable or disable return flight mode for all panes
   */
  public setReturnMode(enabled: boolean): void {
    const preferred = !!enabled;
    this.returnModePreferred = preferred;

    if (preferred) {
      this.pendingReturnCompletion.fill(0);
      if (!this.returnModeEnabled) {
        this.returnModeEnabled = true;
        if (this.material?.uniforms?.returnMode) {
          this.material.uniforms.returnMode.value = 1.0;
        }
      }
      return;
    }

    const timeUniform = this._getTimeUniform();
    const period = 2;
    const epsilon = 1e-4;
    let needsUpdate = false;

    for (let i = 0; i < this.activePanes; i++) {
      const baseIndex = i * 4;
      if (this.animationParams[baseIndex + 3] < 0.5) continue;

      const speed = this.animationParams[baseIndex + 1];
      const phase = this.animationParams[baseIndex];
      const cycle = this._wrapProgress(timeUniform * speed + phase, period);

      if (cycle > 1 + epsilon) {
        // Currently on return leg – allow it to finish
        this.pendingReturnCompletion[i] = 1;
      } else {
        this.pendingReturnCompletion[i] = 0;
        if (cycle > 1 - epsilon) {
          // Snap to start of forward leg to avoid entering return
          this.animationParams[baseIndex] = this._wrapProgress(
            phase - 1,
            period,
          );
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate && this.geometry?.attributes?.animationParams) {
      this.geometry.attributes.animationParams.needsUpdate = true;
    }
  }

  /**
   * Set the color of a specific pane
   */
  public setPaneColor(
    index: number,
    color: THREE.Color | THREE.ColorRepresentation,
  ): void {
    if (index < 0 || index >= this.maxPanes) return;

    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.instanceColors[index * 3] = c.r;
    this.instanceColors[index * 3 + 1] = c.g;
    this.instanceColors[index * 3 + 2] = c.b;

    if (this.geometry) {
      this.geometry.attributes.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Set the size of a specific pane
   */
  public setPaneSize(index: number, size: number): void {
    if (index < 0 || index >= this.maxPanes) return;

    const normalizedScale = size / this.baseSize;
    this.instanceScales[index] = normalizedScale;

    if (this.geometry) {
      this.geometry.attributes.instanceScale.needsUpdate = true;
    }
  }

  /**
   * Set elevation offset (distance above curve) for a pane
   */
  public setElevationOffset(index: number, offset: number): void {
    if (index < 0 || index >= this.maxPanes) return;

    this.instanceElevations[index] = offset;
    if (this.geometry && this.geometry.attributes.instanceElevation) {
      this.geometry.attributes.instanceElevation.needsUpdate = true;
    }
  }

  /**
   * Set animation speed for a specific pane
   */
  public setAnimationSpeed(index: number, speed: number): void {
    if (index < 0 || index >= this.maxPanes) return;

    const baseIndex = index * 4;
    const oldSpeed = this.animationParams[baseIndex + 1];
    const oldPhase = this.animationParams[baseIndex];

    const timeUniform = this._getTimeUniform();
    const period = this.returnModeEnabled ? 2 : 1;
    const currentProgress = this._wrapProgress(
      timeUniform * oldSpeed + oldPhase,
      period,
    );

    this.animationParams[baseIndex + 1] = speed;

    const newPhase = this._wrapProgress(
      currentProgress - timeUniform * speed,
      period,
    );
    this.animationParams[baseIndex] = newPhase;

    if (this.geometry) {
      this.geometry.attributes.animationParams.needsUpdate = true;
    }
  }

  /**
   * Set tilt mode for a specific pane
   * @param index - Index of the pane
   * @param mode - 'Perpendicular' or 'Tangent'
   */
  public setTiltMode(index: number, mode: TiltMode): void {
    if (index < 0 || index >= this.maxPanes) return;

    const tiltModeValue = mode === "Tangent" ? 1.0 : 0.0;
    this.animationParams[index * 4 + 2] = tiltModeValue;

    if (this.geometry) {
      this.geometry.attributes.animationParams.needsUpdate = true;
    }
  }

  /**
   * Hide a specific pane
   */
  public hidePane(index: number): void {
    if (index < 0 || index >= this.maxPanes) return;

    this.animationParams[index * 4 + 3] = 0.0; // visible = false

    if (this.geometry) {
      this.geometry.attributes.animationParams.needsUpdate = true;
    }
  }

  /**
   * Update time uniform - called once per frame
   * This is the ONLY method that needs to be called every frame!
   */
  public update(deltaTime: number): void {
    if (!this.material || !this.material.uniforms) return;

    this.material.uniforms.time.value += deltaTime;

    this._reconcileReturnMode();
  }

  /**
   * Set the number of active panes
   */
  public setActivePaneCount(count: number): void {
    const newCount = Math.min(count, this.maxPanes);
    if (newCount < this.activePanes) {
      this.pendingReturnCompletion.fill(0, newCount, this.activePanes);
    }
    this.activePanes = newCount;
  }

  public setPlanesVisible(visible: boolean): void {
    this.planesVisible = !!visible;
    if (
      this.material &&
      this.material.uniforms &&
      this.material.uniforms.paneVisibility
    ) {
      this.material.uniforms.paneVisibility.value = this.planesVisible
        ? 1.0
        : 0.0;
    }
  }

  /**
   * Get the number of pane instances
   */
  public getCount(): number {
    return this.maxPanes;
  }

  /**
   * Enable or disable textured rendering for panes
   * @param texture - Texture to apply or null to disable
   */
  public setTexture(
    texture: THREE.Texture | null,
    atlasInfo: AtlasInfo | null = null,
  ): void {
    if (!this.material || !this.material.uniforms) return;

    this.material.uniforms.paneMap.value = texture;
    this.material.uniforms.useTexture.value = texture ? 1.0 : 0.0;

    if (texture) {
      texture.needsUpdate = true;
    }
    this.material.needsUpdate = true;

    if (texture && atlasInfo) {
      this.atlasInfo = {
        columns: atlasInfo.columns,
        rows: atlasInfo.rows,
        count: atlasInfo.count,
        scaleX: atlasInfo.scale?.x ?? 1,
        scaleY: atlasInfo.scale?.y ?? 1,
      };
    } else {
      this.atlasInfo = null;
    }
  }

  public setTextureIndex(index: number, textureIndex: number = 0): void {
    if (index < 0 || index >= this.maxPanes) return;

    const uvIndex = index * 4;
    if (this.atlasInfo) {
      const columns = Math.max(1, this.atlasInfo.columns || 1);
      const rows = Math.max(1, this.atlasInfo.rows || 1);
      const totalSlots = columns * rows;
      const count = Math.max(1, this.atlasInfo.count || totalSlots);
      const slot = ((textureIndex % count) + count) % count;
      const safeSlot = slot % totalSlots;
      const col = safeSlot % columns;
      const row = Math.floor(safeSlot / columns);
      const scaleX = this.atlasInfo.scaleX || 1 / columns;
      const scaleY = this.atlasInfo.scaleY || 1 / rows;
      const offsetX = col * scaleX;
      const offsetY = row * scaleY;
      this.instanceUvTransforms[uvIndex] = offsetX;
      this.instanceUvTransforms[uvIndex + 1] = offsetY;
      this.instanceUvTransforms[uvIndex + 2] = scaleX;
      this.instanceUvTransforms[uvIndex + 3] = scaleY;
    } else {
      this.instanceUvTransforms[uvIndex] = 0.0;
      this.instanceUvTransforms[uvIndex + 1] = 0.0;
      this.instanceUvTransforms[uvIndex + 2] = 1.0;
      this.instanceUvTransforms[uvIndex + 3] = 1.0;
    }

    if (this.geometry && this.geometry.attributes.instanceUVTransform) {
      this.geometry.attributes.instanceUVTransform.needsUpdate = true;
    }
  }

  /**
   * Remove from scene and cleanup
   */
  public remove(): void {
    if (this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
      if (this.geometry) {
        this.geometry.dispose();
      }
      if (this.material) {
        this.material.dispose();
      }
      this.instancedMesh = null;
    }
  }

  /**
   * Check if merged panes exist
   */
  public exists(): boolean {
    return this.instancedMesh !== null;
  }

  /**
   * Get max panes
   */
  public getMaxPanes(): number {
    return this.maxPanes;
  }

  /**
   * Mark all attributes for GPU upload
   */
  private markAllAttributesNeedUpdate(): void {
    if (!this.geometry) return;

    if (this.geometry.attributes.controlPointsPack1) {
      this.geometry.attributes.controlPointsPack1.needsUpdate = true;
    }
    if (this.geometry.attributes.controlPointsPack2) {
      this.geometry.attributes.controlPointsPack2.needsUpdate = true;
    }
    if (this.geometry.attributes.controlPointsPack3) {
      this.geometry.attributes.controlPointsPack3.needsUpdate = true;
    }
    if (this.geometry.attributes.instanceColor) {
      this.geometry.attributes.instanceColor.needsUpdate = true;
    }
    if (this.geometry.attributes.instanceScale) {
      this.geometry.attributes.instanceScale.needsUpdate = true;
    }
    if (this.geometry.attributes.instanceElevation) {
      this.geometry.attributes.instanceElevation.needsUpdate = true;
    }
    if (this.geometry.attributes.instanceUVTransform) {
      this.geometry.attributes.instanceUVTransform.needsUpdate = true;
    }
    if (this.geometry.attributes.animationParams) {
      this.geometry.attributes.animationParams.needsUpdate = true;
    }
  }

  private _getTimeUniform(): number {
    return this.material &&
      this.material.uniforms &&
      this.material.uniforms.time
      ? this.material.uniforms.time.value
      : 0;
  }

  private _wrapProgress(value: number, period: number): number {
    if (period <= 0) {
      return 0;
    }
    let result = value % period;
    if (result < 0) {
      result += period;
    }
    return result;
  }

  private _reconcileReturnMode(): void {
    if (this.returnModePreferred) {
      if (!this.returnModeEnabled && this.material?.uniforms?.returnMode) {
        this.returnModeEnabled = true;
        this.material.uniforms.returnMode.value = 1.0;
      }
      return;
    }

    if (!this.returnModeEnabled) {
      return;
    }

    const timeUniform = this._getTimeUniform();
    const period = 2;
    const epsilon = 1e-4;
    let anyPending = false;
    let needsUpdate = false;

    for (let i = 0; i < this.activePanes; i++) {
      const baseIndex = i * 4;
      if (this.animationParams[baseIndex + 3] < 0.5) continue;

      const speed = this.animationParams[baseIndex + 1];
      const phase = this.animationParams[baseIndex];
      const cycle = this._wrapProgress(timeUniform * speed + phase, period);

      if (this.pendingReturnCompletion[i]) {
        if (cycle <= 1 - epsilon) {
          // Finished the return leg, restart forward motion
          this.pendingReturnCompletion[i] = 0;
          this.animationParams[baseIndex] = this._wrapProgress(
            -timeUniform * speed,
            period,
          );
          needsUpdate = true;
        } else {
          anyPending = true;
        }
        continue;
      }

      if (cycle > 1 + epsilon) {
        // Prevent new return legs from starting
        this.animationParams[baseIndex] = this._wrapProgress(phase - 1, period);
        needsUpdate = true;
      }
    }

    if (needsUpdate && this.geometry?.attributes?.animationParams) {
      this.geometry.attributes.animationParams.needsUpdate = true;
    }

    if (!anyPending) {
      this.returnModeEnabled = false;
      if (this.material?.uniforms?.returnMode) {
        this.material.uniforms.returnMode.value = 0.0;
      }
    }
  }
}

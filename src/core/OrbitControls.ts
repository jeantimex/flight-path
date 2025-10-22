/**
 * OrbitControls - Pure JavaScript implementation
 * Replaces THREE.OrbitControls using gl-matrix
 */

import { vec3 } from 'gl-matrix';
import type { PerspectiveCamera } from './PerspectiveCamera.ts';

export interface OrbitControlsConfig {
  enableDamping?: boolean;
  dampingFactor?: number;
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  enablePan?: boolean;
  enableZoom?: boolean;
  enableRotate?: boolean;
  rotateSpeed?: number;
  zoomSpeed?: number;
  enableKeys?: boolean;
  keyRotateSpeed?: number;
  keyZoomSpeed?: number;
}

interface SphericalCoords {
  radius: number;
  theta: number; // Horizontal rotation (azimuth)
  phi: number;   // Vertical rotation (polar angle)
}

export class OrbitControls {
  private camera: PerspectiveCamera;
  private domElement: HTMLElement;

  // Settings
  public enableDamping: boolean;
  public dampingFactor: number;
  public minDistance: number;
  public maxDistance: number;
  public minPolarAngle: number;
  public maxPolarAngle: number;
  public enablePan: boolean;
  public enableZoom: boolean;
  public enableRotate: boolean;
  public rotateSpeed: number;
  public zoomSpeed: number;
  public enableKeys: boolean;
  public keyRotateSpeed: number;
  public keyZoomSpeed: number;

  // State
  private spherical: SphericalCoords;
  private sphericalDelta: SphericalCoords;
  private state: 'NONE' | 'ROTATE' | 'ZOOM' | 'PAN' = 'NONE';

  // Mouse state
  private rotateStart = { x: 0, y: 0 };
  private rotateEnd = { x: 0, y: 0 };

  // Event handlers (bound to this)
  private onMouseDown = this.handleMouseDown.bind(this);
  private onMouseMove = this.handleMouseMove.bind(this);
  private onMouseUp = this.handleMouseUp.bind(this);
  private onWheel = this.handleWheel.bind(this);
  private onContextMenu = this.handleContextMenu.bind(this);
  private onKeyDown = this.handleKeyDown.bind(this);

  constructor(camera: PerspectiveCamera, domElement: HTMLElement, config: OrbitControlsConfig = {}) {
    this.camera = camera;
    this.domElement = domElement;

    // Apply config
    this.enableDamping = config.enableDamping ?? true;
    this.dampingFactor = config.dampingFactor ?? 0.05;
    this.minDistance = config.minDistance ?? 100;
    this.maxDistance = config.maxDistance ?? 20000;
    this.minPolarAngle = config.minPolarAngle ?? 0;
    this.maxPolarAngle = config.maxPolarAngle ?? Math.PI;
    this.enablePan = config.enablePan ?? false;
    this.enableZoom = config.enableZoom ?? true;
    this.enableRotate = config.enableRotate ?? true;
    this.rotateSpeed = config.rotateSpeed ?? 1.0;
    this.zoomSpeed = config.zoomSpeed ?? 1.0;
    this.enableKeys = config.enableKeys ?? true;
    this.keyRotateSpeed = config.keyRotateSpeed ?? 0.02;
    this.keyZoomSpeed = config.keyZoomSpeed ?? 100;

    // Initialize spherical coordinates from camera position
    const offset = vec3.create();
    vec3.subtract(offset, camera.position, camera.target);

    this.spherical = {
      radius: vec3.length(offset),
      theta: Math.atan2(offset[0], offset[2]),
      phi: Math.acos(Math.max(-1, Math.min(1, offset[1] / vec3.length(offset)))),
    };

    this.sphericalDelta = {
      radius: 0,
      theta: 0,
      phi: 0,
    };

    // Attach event listeners
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.domElement.addEventListener('contextmenu', this.onContextMenu);

    if (this.enableKeys) {
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  private handleMouseDown(event: MouseEvent): void {
    if (!this.enableRotate) return;

    if (event.button === 0) { // Left click
      this.state = 'ROTATE';
      this.rotateStart = { x: event.clientX, y: event.clientY };

      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.state === 'ROTATE') {
      this.rotateEnd = { x: event.clientX, y: event.clientY };

      const deltaX = this.rotateEnd.x - this.rotateStart.x;
      const deltaY = this.rotateEnd.y - this.rotateStart.y;

      const element = this.domElement;

      // Calculate rotation angles
      this.sphericalDelta.theta -= (2 * Math.PI * deltaX) / element.clientHeight * this.rotateSpeed;
      this.sphericalDelta.phi -= (2 * Math.PI * deltaY) / element.clientHeight * this.rotateSpeed;

      this.rotateStart = this.rotateEnd;
    }
  }

  private handleMouseUp(): void {
    this.state = 'NONE';
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.enableZoom) return;

    event.preventDefault();

    const delta = event.deltaY;

    if (delta < 0) {
      // Zoom in
      this.sphericalDelta.radius -= this.spherical.radius * 0.05 * this.zoomSpeed;
    } else {
      // Zoom out
      this.sphericalDelta.radius += this.spherical.radius * 0.05 * this.zoomSpeed;
    }
  }

  private handleContextMenu(event: Event): void {
    event.preventDefault();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.enableKeys) return;

    switch (event.key) {
      // Zoom controls
      case '+':
      case '=':
        // Zoom in
        this.sphericalDelta.radius -= this.keyZoomSpeed;
        break;
      case '-':
      case '_':
        // Zoom out
        this.sphericalDelta.radius += this.keyZoomSpeed;
        break;

      // Rotation controls
      case 'ArrowLeft':
        // Rotate left
        this.sphericalDelta.theta -= this.keyRotateSpeed;
        event.preventDefault();
        break;
      case 'ArrowRight':
        // Rotate right
        this.sphericalDelta.theta += this.keyRotateSpeed;
        event.preventDefault();
        break;
      case 'ArrowUp':
        // Rotate up
        this.sphericalDelta.phi -= this.keyRotateSpeed;
        event.preventDefault();
        break;
      case 'ArrowDown':
        // Rotate down
        this.sphericalDelta.phi += this.keyRotateSpeed;
        event.preventDefault();
        break;
    }
  }

  /**
   * Update camera position based on controls (call every frame)
   */
  public update(): void {
    // Apply damping to deltas
    if (this.enableDamping) {
      this.sphericalDelta.theta *= (1 - this.dampingFactor);
      this.sphericalDelta.phi *= (1 - this.dampingFactor);
      this.sphericalDelta.radius *= (1 - this.dampingFactor);
    }

    // Update spherical coordinates
    this.spherical.theta += this.sphericalDelta.theta;
    this.spherical.phi += this.sphericalDelta.phi;
    this.spherical.radius += this.sphericalDelta.radius;

    // Clamp phi (polar angle) to prevent camera flipping
    this.spherical.phi = Math.max(
      this.minPolarAngle,
      Math.min(this.maxPolarAngle, this.spherical.phi)
    );

    // Clamp radius (distance)
    this.spherical.radius = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.spherical.radius)
    );

    // Convert spherical to Cartesian coordinates
    const sinPhiRadius = Math.sin(this.spherical.phi) * this.spherical.radius;

    this.camera.setPosition(
      sinPhiRadius * Math.sin(this.spherical.theta) + this.camera.target[0],
      Math.cos(this.spherical.phi) * this.spherical.radius + this.camera.target[1],
      sinPhiRadius * Math.cos(this.spherical.theta) + this.camera.target[2]
    );

    // Update camera view matrix
    this.camera.updateViewMatrix();

    // Reset deltas if not damping
    if (!this.enableDamping) {
      this.sphericalDelta.theta = 0;
      this.sphericalDelta.phi = 0;
      this.sphericalDelta.radius = 0;
    }
  }

  /**
   * Cleanup event listeners
   */
  public dispose(): void {
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.domElement.removeEventListener('wheel', this.onWheel);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);

    if (this.enableKeys) {
      window.removeEventListener('keydown', this.onKeyDown);
    }
  }
}

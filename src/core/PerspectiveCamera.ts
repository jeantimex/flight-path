/**
 * PerspectiveCamera - Pure JavaScript implementation
 * Replaces THREE.PerspectiveCamera using gl-matrix
 */

import { mat4, vec3 } from 'gl-matrix';

export interface CameraConfig {
  fov?: number;
  aspect?: number;
  near?: number;
  far?: number;
  position?: [number, number, number];
  target?: [number, number, number];
  up?: [number, number, number];
}

export class PerspectiveCamera {
  // Camera parameters
  public fov: number;
  public aspect: number;
  public near: number;
  public far: number;

  // Camera position and orientation
  public position: vec3;
  public target: vec3;
  public up: vec3;

  // Matrices (Float32Array for WebGPU)
  public projectionMatrix: mat4;
  public viewMatrix: mat4;
  public viewProjectionMatrix: mat4;

  constructor(config: CameraConfig = {}) {
    this.fov = config.fov ?? 75;
    this.aspect = config.aspect ?? 1;
    this.near = config.near ?? 0.1;
    this.far = config.far ?? 50000;

    this.position = vec3.fromValues(
      config.position?.[0] ?? 0,
      config.position?.[1] ?? 2000,
      config.position?.[2] ?? 8000,
    );

    this.target = vec3.fromValues(
      config.target?.[0] ?? 0,
      config.target?.[1] ?? 0,
      config.target?.[2] ?? 0,
    );

    this.up = vec3.fromValues(
      config.up?.[0] ?? 0,
      config.up?.[1] ?? 1,
      config.up?.[2] ?? 0,
    );

    // Initialize matrices
    this.projectionMatrix = mat4.create();
    this.viewMatrix = mat4.create();
    this.viewProjectionMatrix = mat4.create();

    this.updateProjectionMatrix();
    this.updateViewMatrix();
  }

  /**
   * Update projection matrix based on FOV, aspect, near, far
   */
  public updateProjectionMatrix(): void {
    const fovRadians = (this.fov * Math.PI) / 180;
    mat4.perspective(this.projectionMatrix, fovRadians, this.aspect, this.near, this.far);
  }

  /**
   * Update view matrix based on position, target, up
   */
  public updateViewMatrix(): void {
    mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);

    // Update combined view-projection matrix
    mat4.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
  }

  /**
   * Set camera aspect ratio (call on window resize)
   */
  public setAspect(aspect: number): void {
    this.aspect = aspect;
    this.updateProjectionMatrix();
    // Note: View matrix update happens in updateViewMatrix() called by controls
  }

  /**
   * Set camera position
   */
  public setPosition(x: number, y: number, z: number): void {
    vec3.set(this.position, x, y, z);
  }

  /**
   * Set camera target (look-at point)
   */
  public setTarget(x: number, y: number, z: number): void {
    vec3.set(this.target, x, y, z);
  }

  /**
   * Get camera right vector (for billboarding)
   */
  public getRightVector(): vec3 {
    const right = vec3.create();
    // Right vector is first column of view matrix
    right[0] = this.viewMatrix[0];
    right[1] = this.viewMatrix[4];
    right[2] = this.viewMatrix[8];
    return right;
  }

  /**
   * Get camera up vector (for billboarding)
   */
  public getUpVector(): vec3 {
    const up = vec3.create();
    // Up vector is second column of view matrix
    up[0] = this.viewMatrix[1];
    up[1] = this.viewMatrix[5];
    up[2] = this.viewMatrix[9];
    return up;
  }

  /**
   * Get camera forward vector
   */
  public getForwardVector(): vec3 {
    const forward = vec3.create();
    vec3.subtract(forward, this.target, this.position);
    vec3.normalize(forward, forward);
    return forward;
  }
}

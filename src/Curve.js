import * as THREE from "three";

export class Curve {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.curve = null;
    this.line = null;
    this.controlPoints = options.controlPoints || [];
  }

  create() {
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints);

    const points = this.curve.getPoints(200);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x4c4c4c });

    this.line = new THREE.Line(geometry, material);
    this.scene.add(this.line);

    return this.curve;
  }

  getPointAt(t, target = new THREE.Vector3()) {
    if (!this.curve) {
      return target.set(0, 0, 0);
    }
    return this.curve.getPointAt(t, target);
  }

  getTangentAt(t, target = new THREE.Vector3()) {
    if (!this.curve) {
      return target.set(0, 0, 1);
    }
    return this.curve.getTangentAt(t, target);
  }

  getCurve() {
    return this.curve;
  }

  remove() {
    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      this.line.material.dispose();
      this.line = null;
    }
    this.curve = null;
  }

  exists() {
    return this.curve !== null;
  }
}

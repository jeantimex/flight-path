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

  getPointAt(t) {
    return this.curve ? this.curve.getPointAt(t) : new THREE.Vector3();
  }

  getTangentAt(t) {
    return this.curve ? this.curve.getTangentAt(t) : new THREE.Vector3(0, 0, 1);
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

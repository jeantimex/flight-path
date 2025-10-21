import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { Plane } from "./Plane.js";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(0, 0, 1);

export class SVGPlane extends Plane {
  constructor(scene) {
    super(scene);
    this.loader = new SVGLoader();
    this.baseScale = 50;
    this.svgWidth = 1;
    this.svgHeight = 1;
  }

  async load() {
    return new Promise((resolve) => {
      this.loader.load(
        "/plane8.svg",
        (data) => {
          const paths = data.paths;
          const group = new THREE.Group();

          for (const path of paths) {
            let color = 0x4488ff;
            if (path.userData && path.userData.style) {
              const fill = path.userData.style.fill;
              if (fill && fill !== "none") {
                color = new THREE.Color(fill);
              }
            }

            const material = new THREE.MeshBasicMaterial({
              color,
              side: THREE.DoubleSide,
            });

            const shapes = SVGLoader.createShapes(path);
            for (const shape of shapes) {
              const geometry = new THREE.ShapeGeometry(shape);
              const mesh = new THREE.Mesh(geometry, material);
              group.add(mesh);
            }
          }

          const box = new THREE.Box3().setFromObject(group);
          const center = box.getCenter(new THREE.Vector3());

          this.svgWidth = box.max.x - box.min.x;
          this.svgHeight = box.max.y - box.min.y;

          group.position.sub(center);

          this.scene.add(group);
          this.setMesh(group);
          resolve(group);
        },
        undefined,
        (error) => {
          console.error("Error loading SVG plane:", error);
          this.createFallbackCube(0x00ff00);
          resolve(this.mesh);
        },
      );
    });
  }

  updatePositionAndOrientation(curve, planeSize, t) {
    super.updatePositionAndOrientation(curve, planeSize, t);

    if (!this.mesh) return;

    this.mesh.rotateX(Math.PI / 2);

    const tangent = curve.getTangentAt(t).clone().normalize();

    const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP);
    if (right.lengthSq() < 1e-6) {
      right.crossVectors(FALLBACK_AXIS, tangent);
    }
    right.normalize();

    const forward = tangent;

    const horizontalOffset = (this.svgWidth / 2) * this.baseScale * planeSize;
    const forwardOffset = (this.svgHeight / 2) * this.baseScale * planeSize;

    const horizontalVector = right.clone().multiplyScalar(-horizontalOffset);
    const forwardVector = forward.clone().multiplyScalar(forwardOffset);

    this.mesh.position.add(horizontalVector);
    this.mesh.position.add(forwardVector);
  }
}

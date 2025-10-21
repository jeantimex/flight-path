import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const loader = new SVGLoader();

export async function loadSVGPlaneGeometry(path = "/plane8.svg") {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      (data) => {
        if (!data.paths || data.paths.length === 0) {
          reject(new Error(`SVG at "${path}" does not contain any paths`));
          return;
        }

        const geometries = [];

        for (const path of data.paths) {
          const shapes = SVGLoader.createShapes(path);
          for (const shape of shapes) {
            geometries.push(new THREE.ShapeGeometry(shape));
          }
        }

        if (geometries.length === 0) {
          reject(new Error(`No shapes could be created from SVG "${path}"`));
          return;
        }

        const mergedGeometry = mergeGeometries(geometries, true);
        if (!mergedGeometry) {
          reject(new Error(`Failed to merge SVG geometries from "${path}"`));
          return;
        }

        mergedGeometry.computeBoundingBox();
        const boundingBox = mergedGeometry.boundingBox;
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);

        mergedGeometry.translate(-center.x, -center.y, -center.z);
        mergedGeometry.rotateX(Math.PI / 2);

        const nonIndexed = mergedGeometry.toNonIndexed();
        const positionAttribute = nonIndexed.getAttribute("position");
        const positions = new Float32Array(positionAttribute.array);

        resolve({
          positions,
          vertexCount: positionAttribute.count,
          width: size.x,
          height: size.y,
        });
      },
      undefined,
      (error) => {
        reject(error);
      },
    );
  });
}

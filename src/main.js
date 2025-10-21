import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GUI } from "dat.gui";
import WebGPURenderer from "three/src/renderers/webgpu/WebGPURenderer.js";
import { Curve } from "./Curve.js";
import { loadSVGPlaneGeometry } from "./SVGPlaneGeometry.js";

const PLANE_COUNT = 100;
const DEFAULT_PLANE_COUNT = 100;
const DEFAULT_PLANE_SCALE = 5;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(0, 0, 1);

if (typeof navigator === "undefined" || !navigator.gpu) {
  throw new Error("WebGPU is not supported on this device.");
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  50000,
);
camera.position.set(0, 2000, 8000);
camera.lookAt(0, 0, 0);

const canvas = document.createElement("canvas");
document.querySelector("#app").appendChild(canvas);

const renderer = new WebGPURenderer({
  antialias: true,
  canvas,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0xefefef);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.minDistance = 100;
controls.maxDistance = 20000;
controls.maxPolarAngle = Math.PI;

const clock = new THREE.Clock();
const params = {
  planeCount: DEFAULT_PLANE_COUNT,
  planeScale: DEFAULT_PLANE_SCALE,
};
const planeEntries = [];
const curves = [];
let planeMesh;
let planeGeometry;
let planeMaterial;
let svgWidth = 0;
let svgHeight = 0;
let gui;

const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempTangent = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const tempUp = new THREE.Vector3();
const tempForwardDir = new THREE.Vector3();
const tempHorizontal = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const tempFinalPosition = new THREE.Vector3();
const scaleVector = new THREE.Vector3();

async function initializeScene() {
  await renderer.init();

  const planeData = await loadSVGPlaneGeometry("/plane8.svg");
  planeGeometry = planeData.geometry;
  svgWidth = planeData.width;
  svgHeight = planeData.height;

  planeMaterial = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    side: THREE.DoubleSide,
  });

  rebuildPlanes(params.planeCount);
  setupGUI();

  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    updatePlanes(delta);
    controls.update();
    renderer.render(scene, camera);
  });
}

function setupGUI() {
  if (gui) return;

  gui = new GUI();
  gui
    .add(params, "planeCount", 10, 30000, 10)
    .name("Plane Count")
    .onFinishChange((value) => {
      rebuildPlanes(Math.max(1, Math.floor(value)));
    });

  gui
    .add(params, "planeScale", 1, 200, 1)
    .name("Plane Scale")
    .onChange(() => updateScaleVector());

  updateScaleVector();
}

function rebuildPlanes(count) {
  if (!planeGeometry || !planeMaterial) return;

  const targetCount = Math.max(1, Math.floor(count));
  params.planeCount = targetCount;

  if (planeMesh) {
    scene.remove(planeMesh);
  }

  curves.forEach((curve) => curve.remove());
  curves.length = 0;
  planeEntries.length = 0;

  planeMesh = new THREE.InstancedMesh(
    planeGeometry,
    planeMaterial,
    targetCount,
  );
  planeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  planeMesh.frustumCulled = false;
  scene.add(planeMesh);

  for (let i = 0; i < targetCount; i += 1) {
    const rand = mulberry32(i * 7919 + 1);

    const controlPoints = createCurveControlPoints(rand);
    const curve = new Curve(scene, { controlPoints });
    curve.create();
    curves.push(curve);

    const speed = 0.04 + rand() * 0.08;

    planeEntries.push({
      curve,
      timeOffset: rand(),
      speed,
      svgWidth,
      svgHeight,
    });
  }

  planeMesh.instanceMatrix.needsUpdate = true;
}

function updatePlanes(delta) {
  if (!planeMesh) return;

  for (let i = 0; i < planeEntries.length; i += 1) {
    const entry = planeEntries[i];
    entry.timeOffset = (entry.timeOffset + delta * entry.speed) % 1;

    entry.curve.getPointAt(entry.timeOffset, tempPosition);
    entry.curve.getTangentAt(entry.timeOffset, tempTangent).normalize();

    tempRight.crossVectors(tempTangent, WORLD_UP);
    if (tempRight.lengthSq() < 1e-6) {
      tempRight.crossVectors(FALLBACK_AXIS, tempTangent);
    }
    tempRight.normalize();
    tempUp.crossVectors(tempRight, tempTangent).normalize();
    tempForwardDir.copy(tempTangent).negate();

    const scale = params.planeScale;

    tempHorizontal
      .copy(tempRight)
      .multiplyScalar((-entry.svgWidth / 2) * scale);
    tempForward.copy(tempTangent).multiplyScalar((entry.svgHeight / 2) * scale);

    tempFinalPosition.copy(tempPosition).add(tempHorizontal).add(tempForward);

    tempMatrix.makeBasis(tempRight, tempUp, tempForwardDir);
    tempMatrix.scale(scaleVector);
    tempMatrix.setPosition(tempFinalPosition);

    planeMesh.setMatrixAt(i, tempMatrix);
  }

  planeMesh.instanceMatrix.needsUpdate = true;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createCurveControlPoints(rand) {
  const basePoints = [
    new THREE.Vector3(-1000, -5000, -5000),
    new THREE.Vector3(1000, 0, 0),
    new THREE.Vector3(800, 5000, 5000),
    new THREE.Vector3(-500, 0, 10000),
  ];

  const offset = new THREE.Vector3(
    (rand() - 0.5) * 20000,
    (rand() - 0.5) * 4000,
    (rand() - 0.5) * 20000,
  );

  return basePoints.map((point) => {
    const jitter = new THREE.Vector3(
      (rand() - 0.5) * 4000,
      (rand() - 0.5) * 6000,
      (rand() - 0.5) * 4000,
    );
    return point.clone().add(offset).add(jitter);
  });
}

window.addEventListener("resize", () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

initializeScene().catch((error) => {
  console.error("Failed to initialize scene:", error);
});
function updateScaleVector() {
  const s = params.planeScale;
  scaleVector.set(s, s, s);
}

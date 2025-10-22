import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GUI } from "dat.gui";

const DEFAULT_PLANE_COUNT = 100;
const DEFAULT_PLANE_SCALE = 20;
const WORKGROUP_SIZE = 64;
const CURVE_SEGMENTS = 64;
const CURVE_LOD_SEGMENTS = [
  CURVE_SEGMENTS,
  Math.max(8, Math.floor(CURVE_SEGMENTS / 2)),
  Math.max(4, Math.floor(CURVE_SEGMENTS / 4)),
];
const MAX_CURVE_SEGMENTS = CURVE_LOD_SEGMENTS[0];
const MAX_CURVE_VERTICES = MAX_CURVE_SEGMENTS + 1;
const CURVE_LOD_DISTANCES = [4000, 12000];
const CURVE_CULL_DISTANCE = 20000;
const CONTROL_POINTS_PER_CURVE = 4;
let device;
let context;
let presentationFormat;
let depthTexture;
let depthTextureView;

let planeVertexBuffer;
let planeVertexCount = 0;
let curveDrawEntries = [];
let visibleCurves = [];
let lineSceneBindGroup;
let lineInstanceBindGroup;
let curveInstanceBuffer;
let curveInstanceBufferSize = 0;

let computePipeline;
let renderPipeline;
let linePipeline;

let computeBindGroup;
let renderSceneBindGroup;
let renderInstanceBindGroup;

let computeUniformBuffer;
let renderUniformBuffer;

let controlBuffer;
let infoBuffer;
let stateBuffer;
let particleBuffer;

let workgroupCount = 0;
let planeCount = DEFAULT_PLANE_COUNT;

let cachedCurveControlPoints = [];

const computeUniformArray = new Float32Array(4);
const renderUniformArray = new Float32Array(24);

const PARTICLE_VERTICES = new Float32Array([
  -0.5, -0.5,
  0.5, -0.5,
  -0.5, 0.5,
  -0.5, 0.5,
  0.5, -0.5,
  0.5, 0.5,
]);
const PARTICLE_VERTEX_COUNT = PARTICLE_VERTICES.length / 2;

const params = {
  planeCount: DEFAULT_PLANE_COUNT,
  planeScale: DEFAULT_PLANE_SCALE,
  showCurves: true,
};

let gui;

const canvas = document.createElement("canvas");
canvas.style.width = "100%";
canvas.style.height = "100%";
document.querySelector("#app").appendChild(canvas);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  50000,
);
camera.position.set(0, 2000, 8000);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.minDistance = 100;
controls.maxDistance = 20000;
controls.maxPolarAngle = Math.PI;
controls.enablePan = false;
controls.enableZoom = true;
controls.enableRotate = true;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
};
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

let previousTime = performance.now();
const tempMatrix = new THREE.Matrix4();

async function initialize() {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported on this device.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Unable to acquire GPU adapter.");
  }

  device = await adapter.requestDevice();

  context = canvas.getContext("webgpu");
  presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  configureContext();

  await createPipelines();

  createParticleGeometry();

  rebuildPlanes(params.planeCount);
  setupGUI();

  window.addEventListener("resize", () => {
    configureContext();
  });

  requestAnimationFrame(frame);
}

function configureContext() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(window.innerWidth * dpr));
  const height = Math.max(1, Math.floor(window.innerHeight * dpr));

  canvas.width = width;
  canvas.height = height;

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "opaque",
    size: [width, height],
  });

  if (depthTexture) {
    depthTexture.destroy();
  }

  depthTexture = device.createTexture({
    size: [width, height, 1],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  depthTextureView = depthTexture.createView();

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

async function createPipelines() {
  const computeModule = device.createShaderModule({
    code: computeShaderWGSL(),
  });

  computePipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: computeModule,
      entryPoint: "main",
    },
  });

  const renderModule = device.createShaderModule({
    code: renderShaderWGSL(),
  });

  renderPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: renderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 8,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x2",
            },
          ],
        },
      ],
    },
    fragment: {
      module: renderModule,
      entryPoint: "fs_main",
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "none",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const lineModule = device.createShaderModule({
    code: lineShaderWGSL(),
  });

  linePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: lineModule,
      entryPoint: "vs_main",
      buffers: [],
    },
    fragment: {
      module: lineModule,
      entryPoint: "fs_main",
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: "line-strip",
      cullMode: "none",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
  });

  if (!renderUniformBuffer) {
    renderUniformBuffer = device.createBuffer({
      size: renderUniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  const renderSceneLayout = renderPipeline.getBindGroupLayout(0);
  renderSceneBindGroup = device.createBindGroup({
    layout: renderSceneLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: renderUniformBuffer,
        },
      },
    ],
  });
}

function createParticleGeometry() {
  planeVertexCount = PARTICLE_VERTEX_COUNT;
  if (planeVertexBuffer) {
    planeVertexBuffer.destroy();
  }
  planeVertexBuffer = device.createBuffer({
    size: PARTICLE_VERTICES.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(planeVertexBuffer, 0, PARTICLE_VERTICES);
}

function setupGUI() {
  if (gui) return;

  gui = new GUI();
  gui.domElement.style.width = "320px";
  gui
    .add(params, "planeCount", 10, 1000000, 10)
    .name("Plane Count")
    .onFinishChange((value) => {
      rebuildPlanes(Math.max(1, Math.floor(value)));
    });

  gui.add(params, "planeScale", 0.1, 200, 0.1).name("Plane Scale");

  gui
    .add(params, "showCurves")
    .name("Show Curves")
    .onChange((value) => {
      setCurvesEnabled(value);
    });
}

function disposeCurveResources() {
  if (curveInstanceBuffer) {
    curveInstanceBuffer.destroy();
    curveInstanceBuffer = null;
    curveInstanceBufferSize = 0;
  }
  curveDrawEntries = [];
  visibleCurves = [];
  lineInstanceBindGroup = null;
}

function setCurvesEnabled(enabled) {
  const shouldShow = Boolean(enabled);
  params.showCurves = shouldShow;

  if (shouldShow) {
    rebuildCurveGeometry();
  } else {
    disposeCurveResources();
  }
}

function rebuildCurveGeometry(controlPointsSource = cachedCurveControlPoints) {
  disposeCurveResources();

  if (!params.showCurves || !device) {
    return;
  }

  if (!controlPointsSource || controlPointsSource.length === 0) {
    return;
  }

  const targetCount = Math.min(planeCount, controlPointsSource.length);
  if (targetCount <= 0) {
    return;
  }

  const boundsBox = new THREE.Box3();
  const boundsCenter = new THREE.Vector3();

  for (let i = 0; i < targetCount; i += 1) {
    const controlPoints = controlPointsSource[i];
    boundsBox.setFromPoints(controlPoints);
    boundsBox.getCenter(boundsCenter);

    let radius = 0;
    for (const point of controlPoints) {
      radius = Math.max(radius, point.distanceTo(boundsCenter));
    }

    const segmentCounts = CURVE_LOD_SEGMENTS.map((segments) =>
      Math.max(4, Math.min(segments, MAX_CURVE_SEGMENTS)),
    );

    curveDrawEntries.push({
      curveIndex: i,
      segmentCounts,
      bounds: {
        center: boundsCenter.clone(),
        radius,
      },
    });
  }

  refreshVisibleCurves();
}

function refreshVisibleCurves() {
  visibleCurves = [];

  if (
    !params.showCurves ||
    !device ||
    curveDrawEntries.length === 0 ||
    !controlBuffer
  ) {
    updateCurveInstanceResources();
    return;
  }

  const maxCurves = Math.min(planeCount, curveDrawEntries.length);
  if (maxCurves === 0) {
    updateCurveInstanceResources();
    return;
  }

  const cameraPosition = camera.position;

  for (let i = 0; i < maxCurves; i += 1) {
    const entry = curveDrawEntries[i];
    const distance =
      cameraPosition.distanceTo(entry.bounds.center) - entry.bounds.radius;

    if (distance > CURVE_CULL_DISTANCE) {
      continue;
    }

    let lodIndex = 0;
    if (distance > CURVE_LOD_DISTANCES[0]) {
      lodIndex = 1;
    }
    if (distance > CURVE_LOD_DISTANCES[1]) {
      lodIndex = 2;
    }
    lodIndex = Math.min(lodIndex, entry.segmentCounts.length - 1);

    const segmentCount = Math.max(1, entry.segmentCounts[lodIndex] | 0);

    visibleCurves.push({
      curveIndex: entry.curveIndex,
      segmentCount,
    });
  }

  updateCurveInstanceResources();
}

function updateCurveInstanceResources() {
  if (!device || !linePipeline || !controlBuffer) return;

  if (visibleCurves.length === 0) {
    if (curveInstanceBuffer) {
      curveInstanceBuffer.destroy();
      curveInstanceBuffer = null;
      curveInstanceBufferSize = 0;
    }
    lineInstanceBindGroup = null;
    return;
  }

  const instanceArray = new Uint32Array(visibleCurves.length * 4);
  for (let i = 0; i < visibleCurves.length; i += 1) {
    const base = i * 4;
    const info = visibleCurves[i];
    instanceArray[base + 0] = info.curveIndex;
    instanceArray[base + 1] = info.segmentCount;
    instanceArray[base + 2] = 0;
    instanceArray[base + 3] = 0;
  }

  const requiredSize = instanceArray.byteLength;
  let recreatedBuffer = false;
  if (!curveInstanceBuffer || curveInstanceBufferSize < requiredSize) {
    if (curveInstanceBuffer) {
      curveInstanceBuffer.destroy();
    }
    curveInstanceBuffer = device.createBuffer({
      size: Math.max(requiredSize, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    curveInstanceBufferSize = requiredSize;
    recreatedBuffer = true;
  }

  device.queue.writeBuffer(curveInstanceBuffer, 0, instanceArray);

  if (!lineInstanceBindGroup || recreatedBuffer) {
    const lineInstanceLayout = linePipeline.getBindGroupLayout(1);
    lineInstanceBindGroup = device.createBindGroup({
      layout: lineInstanceLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: controlBuffer },
        },
        {
          binding: 1,
          resource: { buffer: curveInstanceBuffer },
        },
      ],
    });
  }
}

function rebuildPlanes(count) {
  planeCount = Math.max(1, Math.floor(count));
  params.planeCount = planeCount;
  workgroupCount = Math.ceil(planeCount / WORKGROUP_SIZE);

  const controlPointStride = CONTROL_POINTS_PER_CURVE * 4;
  const controlPointsArray = new Float32Array(planeCount * controlPointStride);
  const infoArray = new Float32Array(planeCount * 4);
  const stateArray = new Float32Array(planeCount * 4);
  cachedCurveControlPoints = [];

  for (let i = 0; i < planeCount; i += 1) {
    const rand = mulberry32(i * 7919 + 1);
    const controlPoints = createCurveControlPoints(rand);

    for (let j = 0; j < CONTROL_POINTS_PER_CURVE; j += 1) {
      const offset = i * controlPointStride + j * 4;
      const point = controlPoints[j];
      controlPointsArray[offset + 0] = point.x;
      controlPointsArray[offset + 1] = point.y;
      controlPointsArray[offset + 2] = point.z;
      controlPointsArray[offset + 3] = 0;
    }

    const infoOffset = i * 4;
    const speed = 0.04 + rand() * 0.08;
    infoArray[infoOffset + 0] = 0;
    infoArray[infoOffset + 1] = 0;
    infoArray[infoOffset + 2] = speed;
    infoArray[infoOffset + 3] = 0;

    const stateOffset = i * 4;
    stateArray[stateOffset + 0] = rand();
    stateArray[stateOffset + 1] = 0;
    stateArray[stateOffset + 2] = 0;
    stateArray[stateOffset + 3] = 0;

    cachedCurveControlPoints.push(controlPoints);
  }

  if (controlBuffer) controlBuffer.destroy();
  if (infoBuffer) infoBuffer.destroy();
  if (stateBuffer) stateBuffer.destroy();
  if (particleBuffer) particleBuffer.destroy();

  controlBuffer = device.createBuffer({
    size: controlPointsArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  infoBuffer = device.createBuffer({
    size: infoArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  stateBuffer = device.createBuffer({
    size: stateArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  particleBuffer = device.createBuffer({
    size: planeCount * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(controlBuffer, 0, controlPointsArray);
  device.queue.writeBuffer(infoBuffer, 0, infoArray);
  device.queue.writeBuffer(stateBuffer, 0, stateArray);

  if (params.showCurves) {
    rebuildCurveGeometry();
  } else {
    disposeCurveResources();
  }

  if (!computeUniformBuffer) {
    computeUniformBuffer = device.createBuffer({
      size: computeUniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: controlBuffer } },
      { binding: 1, resource: { buffer: infoBuffer } },
      { binding: 2, resource: { buffer: stateBuffer } },
      { binding: 3, resource: { buffer: particleBuffer } },
      { binding: 4, resource: { buffer: computeUniformBuffer } },
    ],
  });

  const renderInstanceLayout = renderPipeline.getBindGroupLayout(1);
  renderInstanceBindGroup = device.createBindGroup({
    layout: renderInstanceLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: particleBuffer,
        },
      },
    ],
  });

  const lineSceneLayout = linePipeline.getBindGroupLayout(0);
  lineSceneBindGroup = device.createBindGroup({
    layout: lineSceneLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: renderUniformBuffer,
        },
      },
    ],
  });
}

function frame(now) {
  const delta = Math.min((now - previousTime) / 1000, 1 / 20);
  previousTime = now;

  controls.update();
  updateSceneUniforms();
  stepSimulation(delta);

  requestAnimationFrame(frame);
}

function updateSceneUniforms() {
  camera.updateMatrixWorld(true);
  tempMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  renderUniformArray.set(tempMatrix.elements, 0);

  const cameraMatrix = camera.matrixWorld.elements;
  renderUniformArray[16] = cameraMatrix[0];
  renderUniformArray[17] = cameraMatrix[1];
  renderUniformArray[18] = cameraMatrix[2];
  renderUniformArray[19] = 0;
  renderUniformArray[20] = cameraMatrix[4];
  renderUniformArray[21] = cameraMatrix[5];
  renderUniformArray[22] = cameraMatrix[6];
  renderUniformArray[23] = 0;

  device.queue.writeBuffer(renderUniformBuffer, 0, renderUniformArray);
}

function stepSimulation(delta) {
  if (!device || planeCount === 0) return;

  computeUniformArray[0] = delta;
  computeUniformArray[1] = params.planeScale;
  computeUniformArray[2] = planeCount;
  computeUniformArray[3] = 0;
  device.queue.writeBuffer(computeUniformBuffer, 0, computeUniformArray);

  const encoder = device.createCommandEncoder();

  const computePass = encoder.beginComputePass();
  computePass.setPipeline(computePipeline);
  computePass.setBindGroup(0, computeBindGroup);
  computePass.dispatchWorkgroups(workgroupCount);
  computePass.end();

  const colorTexture = context.getCurrentTexture();
  const colorView = colorTexture.createView();

  if (params.showCurves) {
    refreshVisibleCurves();
  } else if (visibleCurves.length > 0) {
    visibleCurves = [];
    updateCurveInstanceResources();
  }

  const renderPassDescriptor = {
    colorAttachments: [
      {
        view: colorView,
        clearValue: { r: 0.93, g: 0.93, b: 0.94, a: 1.0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthTextureView,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  };

  const renderPass = encoder.beginRenderPass(renderPassDescriptor);
  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, renderSceneBindGroup);
  renderPass.setBindGroup(1, renderInstanceBindGroup);
  renderPass.setVertexBuffer(0, planeVertexBuffer);
  renderPass.draw(planeVertexCount, planeCount, 0, 0);

  if (params.showCurves && lineInstanceBindGroup && visibleCurves.length > 0) {
    renderPass.setPipeline(linePipeline);
    renderPass.setBindGroup(0, lineSceneBindGroup);
    renderPass.setBindGroup(1, lineInstanceBindGroup);
    renderPass.draw(MAX_CURVE_VERTICES, visibleCurves.length, 0, 0);
  }

  renderPass.end();

  device.queue.submit([encoder.finish()]);
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

function computeShaderWGSL() {
  return /* wgsl */ `
struct ControlPoints {
  data : array<vec4<f32>>,
};

struct PlaneInfo {
  data : array<vec4<f32>>,
};

struct PlaneState {
  data : array<vec4<f32>>,
};

struct OutputParticles {
  data : array<vec4<f32>>,
};

struct Uniforms {
  delta: f32,
  scale: f32,
  count: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> controlPoints : ControlPoints;
@group(0) @binding(1) var<storage, read> planeInfo : PlaneInfo;
@group(0) @binding(2) var<storage, read_write> planeState : PlaneState;
@group(0) @binding(3) var<storage, read_write> particles : OutputParticles;
@group(0) @binding(4) var<uniform> uniforms : Uniforms;

fn catmullRom(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * (
    (2.0 * p1) +
    (-p0 + p2) * t +
    (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
    (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let index = id.x;
  let count = u32(uniforms.count + 0.5);
  if (index >= count) {
    return;
  }

  let base = index * ${CONTROL_POINTS_PER_CURVE}u;

  var state = planeState.data[index];
  let info = planeInfo.data[index];

  let updatedTime = fract(state.x + info.z * uniforms.delta);
  state.x = updatedTime;
  planeState.data[index] = state;

  let segments = ${CONTROL_POINTS_PER_CURVE - 1}u;
  let scaled = f32(segments) * updatedTime;
  let clampedScaled = min(scaled, f32(segments));
  let segmentIndex = min(u32(floor(clampedScaled)), segments - 1u);
  let localT = clampedScaled - f32(segmentIndex);

  let maxIndex = i32(${CONTROL_POINTS_PER_CURVE - 1});
  let i0 = clamp(i32(segmentIndex) - 1, 0, maxIndex);
  let i1 = clamp(i32(segmentIndex), 0, maxIndex);
  let i2 = clamp(i32(segmentIndex) + 1, 0, maxIndex);
  let i3 = clamp(i32(segmentIndex) + 2, 0, maxIndex);

  let p0 = controlPoints.data[base + u32(i0)].xyz;
  let p1 = controlPoints.data[base + u32(i1)].xyz;
  let p2 = controlPoints.data[base + u32(i2)].xyz;
  let p3 = controlPoints.data[base + u32(i3)].xyz;

  let point = catmullRom(p0, p1, p2, p3, localT);
  particles.data[index] = vec4<f32>(point, uniforms.scale);
}
`;
}

function renderShaderWGSL() {
  return /* wgsl */ `
struct SceneUniforms {
  viewProjection : mat4x4<f32>,
  cameraRight : vec4<f32>,
  cameraUp : vec4<f32>,
};

struct ParticlePositions {
  data : array<vec4<f32>>,
};

@group(0) @binding(0) var<uniform> scene : SceneUniforms;
@group(1) @binding(0) var<storage, read> particles : ParticlePositions;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) quadPosition : vec2<f32>,
  @builtin(instance_index) instanceIndex : u32
) -> VertexOutput {
  var output : VertexOutput;
  let particle = particles.data[instanceIndex];
  let center = particle.xyz;
  let size = particle.w;

  let right = scene.cameraRight.xyz;
  let up = scene.cameraUp.xyz;
  let offset = (quadPosition.x * right + quadPosition.y * up) * size;
  let worldPosition = vec4<f32>(center + offset, 1.0);
  output.position = scene.viewProjection * worldPosition;
  return output;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.27, 0.53, 1.0, 1.0);
}
`;
}

function lineShaderWGSL() {
  return /* wgsl */ `
struct SceneUniforms {
  viewProjection : mat4x4<f32>,
  cameraRight : vec4<f32>,
  cameraUp : vec4<f32>,
};

struct ControlPoints {
  data : array<vec4<f32>>,
};

struct CurveInstance {
  curveIndex : u32,
  segments : u32,
  _pad0 : u32,
  _pad1 : u32,
};

struct CurveInstances {
  data : array<CurveInstance>,
};

@group(0) @binding(0) var<uniform> scene : SceneUniforms;
@group(1) @binding(0) var<storage, read> controlPoints : ControlPoints;
@group(1) @binding(1) var<storage, read> curveInstances : CurveInstances;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
};

fn catmullRom(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * (
    (2.0 * p1) +
    (-p0 + p2) * t +
    (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
    (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
  );
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> VertexOutput {
  var output : VertexOutput;
  let instance = curveInstances.data[instanceIndex];
  let segments = max(instance.segments, 1u);
  let clampedVertex = min(vertexIndex, segments);
  let t = f32(clampedVertex) / f32(segments);

  let segmentCount = ${CONTROL_POINTS_PER_CURVE - 1}u;
  let scaled = t * f32(segmentCount);
  let segmentFloat = floor(scaled);
  let segmentIndex = min(u32(segmentFloat), segmentCount - 1u);
  let localT = scaled - segmentFloat;

  let base = instance.curveIndex * ${CONTROL_POINTS_PER_CURVE}u;
  let maxIndex = ${CONTROL_POINTS_PER_CURVE - 1};
  let i0 = clamp(i32(segmentIndex) - 1, 0, maxIndex);
  let i1 = clamp(i32(segmentIndex), 0, maxIndex);
  let i2 = clamp(i32(segmentIndex) + 1, 0, maxIndex);
  let i3 = clamp(i32(segmentIndex) + 2, 0, maxIndex);

  let p0 = controlPoints.data[base + u32(i0)].xyz;
  let p1 = controlPoints.data[base + u32(i1)].xyz;
  let p2 = controlPoints.data[base + u32(i2)].xyz;
  let p3 = controlPoints.data[base + u32(i3)].xyz;

  let point = catmullRom(p0, p1, p2, p3, localT);

  output.position = scene.viewProjection * vec4<f32>(point, 1.0);
  return output;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.25, 0.25, 0.25, 1.0);
}
`;
}

initialize().catch((error) => {
  console.error("Failed to initialize WebGPU scene:", error);
});

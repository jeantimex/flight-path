import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GUI } from "dat.gui";
import { loadSVGPlaneGeometry } from "./SVGPlaneGeometry.js";

const DEFAULT_PLANE_COUNT = 100;
const DEFAULT_PLANE_SCALE = 5;
const WORKGROUP_SIZE = 64;
const MAX_RENDERED_CURVES = 500;
const CURVE_SEGMENTS = 64;
let device;
let context;
let presentationFormat;
let depthTexture;
let depthTextureView;

let planeVertexBuffer;
let planeVertexCount = 0;
let curveVertexBuffer;
let curveDraws = [];
let lineSceneBindGroup;

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
let matricesBuffer;

let workgroupCount = 0;
let planeCount = DEFAULT_PLANE_COUNT;

let svgWidth = 0;
let svgHeight = 0;
let cachedCurveControlPoints = [];

const computeUniformArray = new Float32Array(4);
const renderUniformArray = new Float32Array(16);

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

  const planeData = await loadSVGPlaneGeometry("/plane8.svg");
  planeVertexCount = planeData.vertexCount;
  svgWidth = planeData.width;
  svgHeight = planeData.height;
  planeVertexBuffer = device.createBuffer({
    size: planeData.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(planeVertexBuffer, 0, planeData.positions);

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
          arrayStride: 12,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x3",
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
      buffers: [
        {
          arrayStride: 12,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x3",
            },
          ],
        },
      ],
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

function setupGUI() {
  if (gui) return;

  gui = new GUI();
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
  if (curveVertexBuffer) {
    curveVertexBuffer.destroy();
    curveVertexBuffer = null;
  }
  curveDraws = [];
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

  const curveVertices = [];
  let curveVertexOffset = 0;

  for (const controlPoints of controlPointsSource) {
    const catmull = new THREE.CatmullRomCurve3(controlPoints);
    for (let s = 0; s <= CURVE_SEGMENTS; s += 1) {
      const t = s / CURVE_SEGMENTS;
      const point = catmull.getPoint(t);
      curveVertices.push(point.x, point.y, point.z);
    }
    curveDraws.push({
      offset: curveVertexOffset,
      count: CURVE_SEGMENTS + 1,
    });
    curveVertexOffset += CURVE_SEGMENTS + 1;
  }

  if (curveVertices.length === 0) {
    return;
  }

  const curveData = new Float32Array(curveVertices);
  curveVertexBuffer = device.createBuffer({
    size: curveData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(curveVertexBuffer, 0, curveData);
}

function rebuildPlanes(count) {
  planeCount = Math.max(1, Math.floor(count));
  params.planeCount = planeCount;
  workgroupCount = Math.ceil(planeCount / WORKGROUP_SIZE);

  const controlPointsArray = new Float32Array(planeCount * 16);
  const infoArray = new Float32Array(planeCount * 4);
  const stateArray = new Float32Array(planeCount * 4);
  cachedCurveControlPoints = [];

  for (let i = 0; i < planeCount; i += 1) {
    const rand = mulberry32(i * 7919 + 1);
    const controlPoints = createCurveControlPoints(rand);

    for (let j = 0; j < 4; j += 1) {
      const offset = i * 16 + j * 4;
      const point = controlPoints[j];
      controlPointsArray[offset + 0] = point.x;
      controlPointsArray[offset + 1] = point.y;
      controlPointsArray[offset + 2] = point.z;
      controlPointsArray[offset + 3] = 0;
    }

    const infoOffset = i * 4;
    const speed = 0.04 + rand() * 0.08;
    infoArray[infoOffset + 0] = svgWidth;
    infoArray[infoOffset + 1] = svgHeight;
    infoArray[infoOffset + 2] = speed;
    infoArray[infoOffset + 3] = 0;

    const stateOffset = i * 4;
    stateArray[stateOffset + 0] = rand();
    stateArray[stateOffset + 1] = 0;
    stateArray[stateOffset + 2] = 0;
    stateArray[stateOffset + 3] = 0;

    if (i < MAX_RENDERED_CURVES) {
      cachedCurveControlPoints.push(controlPoints);
    }
  }

  if (controlBuffer) controlBuffer.destroy();
  if (infoBuffer) infoBuffer.destroy();
  if (stateBuffer) stateBuffer.destroy();
  if (matricesBuffer) matricesBuffer.destroy();

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
  matricesBuffer = device.createBuffer({
    size: planeCount * 64,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.INDIRECT,
  });

  device.queue.writeBuffer(controlBuffer, 0, controlPointsArray);
  device.queue.writeBuffer(infoBuffer, 0, infoArray);
  device.queue.writeBuffer(stateBuffer, 0, stateArray);

  const identityMatrices = new Float32Array(planeCount * 16);
  for (let i = 0; i < planeCount; i += 1) {
    const offset = i * 16;
    identityMatrices[offset + 0] = 1;
    identityMatrices[offset + 5] = 1;
    identityMatrices[offset + 10] = 1;
    identityMatrices[offset + 15] = 1;
    identityMatrices[offset + 12] = (i % 10) * 200 - 1000;
    identityMatrices[offset + 13] = ((i / 10) | 0) * 200 - 1000;
  }
  device.queue.writeBuffer(matricesBuffer, 0, identityMatrices);

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
      { binding: 3, resource: { buffer: matricesBuffer } },
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
          buffer: matricesBuffer,
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
  renderUniformArray.set(tempMatrix.elements);
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

  if (params.showCurves && curveVertexBuffer && curveDraws.length > 0) {
    renderPass.setPipeline(linePipeline);
    renderPass.setBindGroup(0, lineSceneBindGroup);
    renderPass.setVertexBuffer(0, curveVertexBuffer);
    for (const draw of curveDraws) {
      renderPass.draw(draw.count, 1, draw.offset, 0);
    }
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

struct OutputMatrices {
  data : array<mat4x4<f32>>,
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
@group(0) @binding(3) var<storage, read_write> outputMatrices : OutputMatrices;
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

fn catmullRomTangent(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  return 0.5 * (
    (-p0 + p2) +
    (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * (2.0 * t) +
    (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * (3.0 * t2)
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let index = id.x;
  let count = u32(uniforms.count + 0.5);
  if (index >= count) {
    return;
  }

  let base = index * 4u;
  let p0 = controlPoints.data[base + 0u].xyz;
  let p1 = controlPoints.data[base + 1u].xyz;
  let p2 = controlPoints.data[base + 2u].xyz;
  let p3 = controlPoints.data[base + 3u].xyz;

  var state = planeState.data[index];
  let info = planeInfo.data[index];

  let updatedTime = fract(state.x + info.z * uniforms.delta);
  state.x = updatedTime;
  planeState.data[index] = state;

  let point = catmullRom(p0, p1, p2, p3, updatedTime);
  var tangent = normalize(catmullRomTangent(p0, p1, p2, p3, updatedTime));

  var right = cross(tangent, vec3<f32>(0.0, 1.0, 0.0));
  if (dot(right, right) < 1e-6) {
    right = cross(vec3<f32>(0.0, 0.0, 1.0), tangent);
  }
  right = normalize(right);
  var up = normalize(cross(right, tangent));
  let forward = -tangent;

  let halfWidth = info.x * 0.5 * uniforms.scale;
  let halfHeight = info.y * 0.5 * uniforms.scale;
  let position = point + (-right * halfWidth) + (tangent * halfHeight);

  let scale = uniforms.scale;
  let col0 = vec4<f32>(right * scale, 0.0);
  let col1 = vec4<f32>(up * scale, 0.0);
  let col2 = vec4<f32>(forward * scale, 0.0);
  let col3 = vec4<f32>(position, 1.0);

  outputMatrices.data[index] = mat4x4<f32>(col0, col1, col2, col3);
}
`;
}

function renderShaderWGSL() {
  return /* wgsl */ `
struct SceneUniforms {
  viewProjection : mat4x4<f32>,
};

struct InstanceMatrices {
  data : array<mat4x4<f32>>,
};

@group(0) @binding(0) var<uniform> scene : SceneUniforms;
@group(1) @binding(0) var<storage, read> instanceMatrices : InstanceMatrices;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn vs_main(@location(0) position : vec3<f32>, @builtin(instance_index) instanceIndex : u32) -> VertexOutput {
  var output : VertexOutput;
  let model = instanceMatrices.data[instanceIndex];
  let worldPosition = model * vec4<f32>(position, 1.0);
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
};

@group(0) @binding(0) var<uniform> scene : SceneUniforms;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn vs_main(@location(0) position : vec3<f32>) -> VertexOutput {
  var output : VertexOutput;
  output.position = scene.viewProjection * vec4<f32>(position, 1.0);
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

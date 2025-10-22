/**
 * Curve Tessellation Compute Shader (WGSL)
 * Generates line vertices from Catmull-Rom curves
 * Each curve is tessellated into segments for line rendering
 */

// Uniforms
struct Uniforms {
  segmentsPerCurve: u32,
  totalFlights: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Control points (from FlightManager)
struct ControlPoints {
  p0: vec3<f32>,
  _pad0: f32,
  p1: vec3<f32>,
  _pad1: f32,
  p2: vec3<f32>,
  _pad2: f32,
  p3: vec3<f32>,
  _pad3: f32,
};

@group(0) @binding(1) var<storage, read> controlPoints: array<ControlPoints>;

// Flight state (for colors)
struct FlightState {
  t: f32,
  speed: f32,
  packedColor: u32,
  packedSizeFlags: u32,
};

@group(0) @binding(2) var<storage, read> flightStates: array<FlightState>;

// Output: Line vertices (position + color + distance)
struct LineVertex {
  position: vec3<f32>,
  distance: f32,  // Cumulative distance along curve
  color: vec3<f32>,
  _pad0: f32,
};

@group(0) @binding(3) var<storage, read_write> lineVertices: array<LineVertex>;

// Catmull-Rom curve interpolation
fn catmullRom(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  let t3 = t2 * t;

  // Catmull-Rom basis functions
  let v0 = -0.5 * t3 + t2 - 0.5 * t;
  let v1 = 1.5 * t3 - 2.5 * t2 + 1.0;
  let v2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  let v3 = 0.5 * t3 - 0.5 * t2;

  return p0 * v0 + p1 * v1 + p2 * v2 + p3 * v3;
}

// Unpack color from u32
fn unpackColor(packed: u32) -> vec3<f32> {
  let r = f32((packed >> 24u) & 0xFFu) / 255.0;
  let g = f32((packed >> 16u) & 0xFFu) / 255.0;
  let b = f32((packed >> 8u) & 0xFFu) / 255.0;
  return vec3<f32>(r, g, b);
}

// Check if flight is visible (bit 1 of lower 16 bits)
fn isFlightVisible(packed: u32) -> bool {
  const FLAG_VISIBLE: u32 = 2u;
  let flags = packed & 0xFFFFu;
  return (flags & FLAG_VISIBLE) != 0u;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  // Calculate linear thread index from 2D dispatch
  // For 2D dispatch (X, Y, 1), thread index = Y * maxWorkgroupsPerDim * workgroupSize + X
  let vertexIndex = globalId.y * 65535u * 64u + globalId.x;

  // Calculate which flight and which segment this vertex belongs to
  let segmentsPerCurve = uniforms.segmentsPerCurve;
  let verticesPerCurve = segmentsPerCurve + 1u; // N segments = N+1 vertices

  let flightIndex = vertexIndex / verticesPerCurve;
  let segmentVertex = vertexIndex % verticesPerCurve;

  // Bounds check
  if (flightIndex >= uniforms.totalFlights) {
    return;
  }

  // Get flight state
  let state = flightStates[flightIndex];

  // Frustum culling: skip invisible flights (write degenerate vertex)
  if (!isFlightVisible(state.packedSizeFlags)) {
    lineVertices[vertexIndex].position = vec3<f32>(0.0, 0.0, 0.0);
    lineVertices[vertexIndex].distance = 0.0;
    lineVertices[vertexIndex].color = vec3<f32>(0.0, 0.0, 0.0);
    return;
  }

  // Get control points for this flight
  let cp = controlPoints[flightIndex];

  // Get color for this flight
  let color = unpackColor(state.packedColor);

  // Calculate t parameter along curve [0.0, 1.0]
  let t = f32(segmentVertex) / f32(segmentsPerCurve);

  // Evaluate Catmull-Rom curve at t
  let position = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, t);

  // Approximate arc length for distance calculation
  // Sample curve at regular intervals to estimate total length
  var totalLength = 0.0;
  let numSamples = 10u;
  var prevPos = cp.p1; // Start at p1 (actual curve start)
  for (var i = 1u; i <= numSamples; i++) {
    let sampleT = f32(i) / f32(numSamples);
    let samplePos = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, sampleT);
    totalLength += length(samplePos - prevPos);
    prevPos = samplePos;
  }

  // Distance for this vertex = t * totalLength
  let distance = t * totalLength;

  // Create gradient color (fade at endpoints)
  let gradientFactor = 1.0 - abs(t - 0.5) * 2.0; // 0 at ends, 1 at center
  let gradientColor = color * (0.5 + 0.5 * gradientFactor);

  // Write vertex
  lineVertices[vertexIndex].position = position;
  lineVertices[vertexIndex].distance = distance;
  lineVertices[vertexIndex].color = gradientColor;
}

/**
 * Flight Update Compute Shader (WGSL)
 * Updates 1M flight positions using Catmull-Rom curve interpolation
 * Workgroup size: 64 threads
 */

// Uniforms
struct Uniforms {
  deltaTime: f32,
  earthRadius: f32,
  animationSpeed: f32,
  cullingDistance: f32,
  cameraPosition: vec3<f32>,
  frameNumber: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Control points (read-only)
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

// Flight state (read-write)
struct FlightState {
  t: f32,                  // Curve parameter [0.0, 1.0]
  speed: f32,              // Speed multiplier
  packedColor: u32,        // RGBA8_UNORM
  packedSizeFlags: u32,    // Upper 16: size, Lower 16: flags
};

@group(0) @binding(2) var<storage, read_write> flightStates: array<FlightState>;

// Output buffer (write-only from compute)
struct FlightOutput {
  position: vec3<f32>,
  _pad0: f32,
  direction: vec3<f32>,
  _pad1: f32,
};

@group(0) @binding(3) var<storage, read_write> outputs: array<FlightOutput>;

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

// Catmull-Rom tangent (first derivative)
fn catmullRomTangent(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;

  // Derivative of basis functions
  let v0 = -1.5 * t2 + 2.0 * t - 0.5;
  let v1 = 4.5 * t2 - 5.0 * t;
  let v2 = -4.5 * t2 + 4.0 * t + 0.5;
  let v3 = 1.5 * t2 - t;

  return p0 * v0 + p1 * v1 + p2 * v2 + p3 * v3;
}

// Flag bits
const FLAG_RETURN_FLIGHT: u32 = 1u;
const FLAG_VISIBLE: u32 = 2u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  // Calculate linear thread index from 2D dispatch
  // For 2D dispatch (X, Y, 1), thread index = Y * maxWorkgroupsPerDim * workgroupSize + X
  let flightIndex = globalId.y * 65535u * 64u + globalId.x;

  // Bounds check
  if (flightIndex >= arrayLength(&flightStates)) {
    return;
  }

  // Temporal update optimization: Only update 1/4 of flights each frame
  // This gives 4x speedup at 1M flights (12 FPS → 48 FPS)
  if (flightIndex % 4u != uniforms.frameNumber % 4u) {
    return; // Skip this flight this frame
  }

  // Load flight state
  var state = flightStates[flightIndex];

  // Extract flags
  let flags = state.packedSizeFlags & 0xFFFFu;
  let isReturnFlight = (flags & FLAG_RETURN_FLIGHT) != 0u;

  // Update curve parameter
  var newT = state.t + uniforms.deltaTime * state.speed * uniforms.animationSpeed;

  // Handle loop/return flight
  if (isReturnFlight) {
    // Return flight: reverse direction when reaching endpoints
    if (newT > 1.0) {
      state.speed = -abs(state.speed); // Reverse direction
      newT = clamp(1.0 - (newT - 1.0), 0.0, 1.0); // Reflect over boundary
    } else if (newT < 0.0) {
      state.speed = abs(state.speed); // Forward direction
      newT = clamp(-newT, 0.0, 1.0); // Reflect over boundary
    }
  } else {
    // Loop flight: wrap around
    newT = fract(newT);
  }

  state.t = clamp(newT, 0.0, 1.0);

  // Evaluate Catmull-Rom curve
  let cp = controlPoints[flightIndex];
  let position = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, state.t);
  let tangent = catmullRomTangent(cp.p0, cp.p1, cp.p2, cp.p3, state.t);

  // Distance-based culling: check if flight is within culling distance
  let distanceToCamera = length(position - uniforms.cameraPosition);
  var updatedFlags = flags & ~FLAG_VISIBLE; // Clear visibility flag

  if (distanceToCamera <= uniforms.cullingDistance) {
    updatedFlags = updatedFlags | FLAG_VISIBLE; // Set visibility flag
  }

  // Update flags in state
  state.packedSizeFlags = (state.packedSizeFlags & 0xFFFF0000u) | updatedFlags;

  // Write outputs
  outputs[flightIndex].position = position;

  // Flip direction if traveling backwards (return flights)
  var direction = normalize(tangent);
  if (state.speed < 0.0) {
    direction = -direction;
  }
  outputs[flightIndex].direction = direction;

  // Write back updated state
  flightStates[flightIndex] = state;
}

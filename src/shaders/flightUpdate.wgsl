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
  cameraDirection: vec3<f32>,  // Precomputed normalize(cameraPosition)
  segmentsPerCurve: u32,        // Curve tessellation params
  decimation: u32,              // Show every Nth curve
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
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

// Curve line vertices output (for rendering curves)
struct LineVertex {
  position: vec3<f32>,
  distance: f32,  // Cumulative distance along curve
  color: vec3<f32>,
  _pad0: f32,
};

@group(0) @binding(4) var<storage, read_write> lineVertices: array<LineVertex>;

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

// Unpack color from u32
fn unpackColor(packed: u32) -> vec3<f32> {
  let r = f32((packed >> 24u) & 0xFFu) / 255.0;
  let g = f32((packed >> 16u) & 0xFFu) / 255.0;
  let b = f32((packed >> 8u) & 0xFFu) / 255.0;
  return vec3<f32>(r, g, b);
}

// Flag bits
const FLAG_RETURN_FLIGHT: u32 = 1u;
const FLAG_VISIBLE: u32 = 2u;

// Curve tessellation constants
const ARC_LENGTH_SAMPLES: u32 = 10u;

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
  // This gives 4x speedup for compute shader (250K updates/frame instead of 1M)
  // Reduced from 1/8 to 1/4 for smoother animation now that merged shader is faster
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

  // Visibility culling: distance + hemisphere check
  let distanceToCamera = length(position - uniforms.cameraPosition);
  var updatedFlags = flags & ~FLAG_VISIBLE; // Clear visibility flag

  // Check if within culling distance AND on visible hemisphere
  if (distanceToCamera <= uniforms.cullingDistance) {
    // Backface culling: check if plane is on visible side of Earth
    let pointDir = normalize(position);
    // Use precomputed normalized camera direction (saves 1M normalize ops)
    let dotProduct = dot(pointDir, uniforms.cameraDirection);

    // Only visible if on front hemisphere (dot > -0.1)
    if (dotProduct > -0.1) {
      updatedFlags = updatedFlags | FLAG_VISIBLE; // Set visibility flag
    }
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

  // === MERGED: Curve Tessellation ===
  // Tessellate curve vertices for this flight (merged to eliminate second pass)

  // Check decimation: only tessellate every Nth curve
  if (flightIndex % uniforms.decimation == 0u) {
    // Only tessellate if visible
    let isVisible = (updatedFlags & FLAG_VISIBLE) != 0u;

    if (isVisible) {
      // Get color for this flight
      let color = unpackColor(state.packedColor);

      // Tessellate curve segments
      let segmentsPerCurve = uniforms.segmentsPerCurve;
      let verticesPerCurve = segmentsPerCurve * 2u; // line-list: 2 vertices per segment

      // Calculate arc length for distance
      var totalLength = 0.0;
      var prevPos = cp.p1; // Start at p1 (actual curve start)
      for (var i = 1u; i <= ARC_LENGTH_SAMPLES; i++) {
        let sampleT = f32(i) / f32(ARC_LENGTH_SAMPLES);
        let samplePos = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, sampleT);
        totalLength += length(samplePos - prevPos);
        prevPos = samplePos;
      }

      // Generate line vertices for each segment
      for (var segIdx = 0u; segIdx < segmentsPerCurve; segIdx++) {
        // Start vertex
        let tStart = f32(segIdx) / f32(segmentsPerCurve);
        let posStart = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, tStart);
        let distStart = tStart * totalLength;
        let gradientStart = 1.0 - abs(tStart - 0.5) * 2.0;
        let colorStart = color * (0.5 + 0.5 * gradientStart);

        let vertexIdxStart = flightIndex * verticesPerCurve + segIdx * 2u;
        lineVertices[vertexIdxStart].position = posStart;
        lineVertices[vertexIdxStart].distance = distStart;
        lineVertices[vertexIdxStart].color = colorStart;

        // End vertex
        let tEnd = f32(segIdx + 1u) / f32(segmentsPerCurve);
        let posEnd = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, tEnd);
        let distEnd = tEnd * totalLength;
        let gradientEnd = 1.0 - abs(tEnd - 0.5) * 2.0;
        let colorEnd = color * (0.5 + 0.5 * gradientEnd);

        let vertexIdxEnd = flightIndex * verticesPerCurve + segIdx * 2u + 1u;
        lineVertices[vertexIdxEnd].position = posEnd;
        lineVertices[vertexIdxEnd].distance = distEnd;
        lineVertices[vertexIdxEnd].color = colorEnd;
      }
    } else {
      // Flight not visible - write degenerate vertices
      let verticesPerCurve = uniforms.segmentsPerCurve * 2u;
      for (var vIdx = 0u; vIdx < verticesPerCurve; vIdx++) {
        let vertexIdx = flightIndex * verticesPerCurve + vIdx;
        lineVertices[vertexIdx].position = vec3<f32>(0.0, 0.0, 0.0);
        lineVertices[vertexIdx].distance = 0.0;
        lineVertices[vertexIdx].color = vec3<f32>(0.0, 0.0, 0.0);
      }
    }
  }

  // Write back updated state
  flightStates[flightIndex] = state;
}

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

// Control points (read-only) - 9 points for parabolic curve (matches main branch)
struct ControlPoints {
  p0: vec3<f32>,  // startTangentPoint
  _pad0: f32,
  p1: vec3<f32>,  // startSurface
  _pad1: f32,
  p2: vec3<f32>,  // climbPoint1
  _pad2: f32,
  p3: vec3<f32>,  // climbPoint2
  _pad3: f32,
  p4: vec3<f32>,  // cruisePeak
  _pad4: f32,
  p5: vec3<f32>,  // descentPoint1
  _pad5: f32,
  p6: vec3<f32>,  // descentPoint2
  _pad6: f32,
  p7: vec3<f32>,  // endSurface
  _pad7: f32,
  p8: vec3<f32>,  // endTangentPoint
  _pad8: f32,
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

// Piecewise parabolic interpolation through 9 control points (matches main branch)
fn parabolicCurve(cp: ControlPoints, t: f32) -> vec3<f32> {
  // t ranges from 0 to 1, divide into 8 segments
  // Segment 0: p0 -> p1 (t: 0.000 - 0.125)
  // Segment 1: p1 -> p2 (t: 0.125 - 0.250)
  // Segment 2: p2 -> p3 (t: 0.250 - 0.375)
  // Segment 3: p3 -> p4 (t: 0.375 - 0.500)
  // Segment 4: p4 -> p5 (t: 0.500 - 0.625)
  // Segment 5: p5 -> p6 (t: 0.625 - 0.750)
  // Segment 6: p6 -> p7 (t: 0.750 - 0.875)
  // Segment 7: p7 -> p8 (t: 0.875 - 1.000)

  let segmentT = t * 8.0;
  let segment = i32(floor(segmentT));
  let localT = fract(segmentT);

  var p_start: vec3<f32>;
  var p_end: vec3<f32>;

  if (segment == 0) {
    p_start = cp.p0;
    p_end = cp.p1;
  } else if (segment == 1) {
    p_start = cp.p1;
    p_end = cp.p2;
  } else if (segment == 2) {
    p_start = cp.p2;
    p_end = cp.p3;
  } else if (segment == 3) {
    p_start = cp.p3;
    p_end = cp.p4;
  } else if (segment == 4) {
    p_start = cp.p4;
    p_end = cp.p5;
  } else if (segment == 5) {
    p_start = cp.p5;
    p_end = cp.p6;
  } else if (segment == 6) {
    p_start = cp.p6;
    p_end = cp.p7;
  } else {
    p_start = cp.p7;
    p_end = cp.p8;
  }

  // Linear interpolation between points
  return mix(p_start, p_end, localT);
}

// Tangent for parabolic curve
fn parabolicTangent(cp: ControlPoints, t: f32) -> vec3<f32> {
  let segmentT = t * 8.0;
  let segment = i32(floor(segmentT));

  var p_start: vec3<f32>;
  var p_end: vec3<f32>;

  if (segment == 0) {
    p_start = cp.p0;
    p_end = cp.p1;
  } else if (segment == 1) {
    p_start = cp.p1;
    p_end = cp.p2;
  } else if (segment == 2) {
    p_start = cp.p2;
    p_end = cp.p3;
  } else if (segment == 3) {
    p_start = cp.p3;
    p_end = cp.p4;
  } else if (segment == 4) {
    p_start = cp.p4;
    p_end = cp.p5;
  } else if (segment == 5) {
    p_start = cp.p5;
    p_end = cp.p6;
  } else if (segment == 6) {
    p_start = cp.p6;
    p_end = cp.p7;
  } else {
    p_start = cp.p7;
    p_end = cp.p8;
  }

  return normalize(p_end - p_start);
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

  // Evaluate parabolic curve (9 control points)
  let cp = controlPoints[flightIndex];
  let position = parabolicCurve(cp, state.t);
  let tangent = parabolicTangent(cp, state.t);

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
      var prevPos = cp.p0; // Start at p0 (actual curve start)
      for (var i = 1u; i <= ARC_LENGTH_SAMPLES; i++) {
        let sampleT = f32(i) / f32(ARC_LENGTH_SAMPLES);
        let samplePos = parabolicCurve(cp, sampleT);
        totalLength += length(samplePos - prevPos);
        prevPos = samplePos;
      }

      // Generate line vertices for each segment
      for (var segIdx = 0u; segIdx < segmentsPerCurve; segIdx++) {
        // Start vertex
        let tStart = f32(segIdx) / f32(segmentsPerCurve);
        let posStart = parabolicCurve(cp, tStart);
        let distStart = tStart * totalLength;
        let gradientStart = 1.0 - abs(tStart - 0.5) * 2.0;
        let colorStart = color * (0.5 + 0.5 * gradientStart);

        let vertexIdxStart = flightIndex * verticesPerCurve + segIdx * 2u;
        lineVertices[vertexIdxStart].position = posStart;
        lineVertices[vertexIdxStart].distance = distStart;
        lineVertices[vertexIdxStart].color = colorStart;

        // End vertex
        let tEnd = f32(segIdx + 1u) / f32(segmentsPerCurve);
        let posEnd = parabolicCurve(cp, tEnd);
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

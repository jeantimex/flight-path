/**
 * Visibility Culling Compute Shader
 * Compacts visible flight indices for indirect rendering
 */

// Flight state (read-only)
struct FlightState {
  t: f32,
  speed: f32,
  packedColor: u32,
  packedSizeFlags: u32,
};

@group(0) @binding(0) var<storage, read> flightStates: array<FlightState>;

// Compact output: array of visible flight indices
@group(0) @binding(1) var<storage, read_write> visibleIndices: array<u32>;

// Atomic counter for visible count
@group(0) @binding(2) var<storage, read_write> visibleCount: atomic<u32>;

// Indirect draw args buffer
struct DrawIndirectArgs {
  vertexCount: u32,      // 4 (quad vertices)
  instanceCount: u32,    // Number of visible flights (written by compute)
  firstVertex: u32,      // 0
  firstInstance: u32,    // 0
};

@group(0) @binding(3) var<storage, read_write> drawArgs: DrawIndirectArgs;

// Uniforms
struct Uniforms {
  totalFlights: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(4) var<uniform> uniforms: Uniforms;

// Check if flight is visible (bit 1 of lower 16 bits)
fn isFlightVisible(packed: u32) -> bool {
  const FLAG_VISIBLE: u32 = 2u;
  let flags = packed & 0xFFFFu;
  return (flags & FLAG_VISIBLE) != 0u;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  // Calculate linear thread index from 2D dispatch
  let flightIndex = globalId.y * 65535u * 256u + globalId.x;

  // Bounds check
  if (flightIndex >= uniforms.totalFlights) {
    return;
  }

  // Check visibility flag set by flight update shader
  let state = flightStates[flightIndex];
  if (isFlightVisible(state.packedSizeFlags)) {
    // Atomically increment counter and get index
    let outputIndex = atomicAdd(&visibleCount, 1u);

    // Write this flight's index to the compact array
    visibleIndices[outputIndex] = flightIndex;
  }
}

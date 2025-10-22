# Flight Data Structure Design (1M Flights)

## Overview
GPU-optimized data structures for rendering 1 million simultaneous flight paths using WebGPU compute shaders.

## Memory Budget

Total: **~88MB** for 1M flights (optimized with packing)

### Control Points Buffer (48MB)
```
Storage buffer (read-only in compute shader)
- 1M flights × 4 control points × vec3 (12 bytes) = 48MB
- Layout: [p0, p1, p2, p3] per flight (Catmull-Rom curve)
```

### Flight State Buffer (16MB) - PACKED
```
Storage buffer (read-write in compute shader)
- 1M flights × 4 u32 = 16MB (was 28MB)
- Per-flight packed data:
  - t: f32                  // Position on curve [0.0, 1.0]
  - speed: f32              // Animation speed multiplier
  - packedColor: u32        // RGBA8 (R8G8B8A8_UNORM)
  - packedSizeFlags: u32    // 16-bit size + 16-bit flags

Packing benefits:
- Saves 12MB memory (40% reduction)
- Better cache coherency (16 bytes vs 28 bytes per flight)
- Color precision: 8 bits per channel (sufficient for visualization)
```

### Output Buffer (24MB)
```
Storage buffer (write-only from compute, read-only in vertex shader)
- 1M flights × 6 floats = 24MB
- Per-flight output:
  - position: vec3<f32>     // Current world position
  - direction: vec3<f32>    // Forward direction for orientation
```

## Buffer Layouts

### ControlPointsBuffer
```wgsl
struct ControlPoints {
  p0: vec3<f32>,
  p1: vec3<f32>,
  p2: vec3<f32>,
  p3: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> controlPoints: array<ControlPoints>;
```

### FlightStateBuffer
```wgsl
struct FlightState {
  t: f32,                  // Curve parameter [0.0, 1.0]
  speed: f32,              // Speed multiplier
  packedColor: u32,        // RGBA8_UNORM (8 bits per channel)
  packedSizeFlags: u32,    // Upper 16 bits: size (f16), Lower 16 bits: flags
};

@group(0) @binding(1) var<storage, read_write> flightStates: array<FlightState>;

// Helper functions for packing/unpacking
fn packColor(color: vec3<f32>) -> u32 {
  let r = u32(clamp(color.r, 0.0, 1.0) * 255.0);
  let g = u32(clamp(color.g, 0.0, 1.0) * 255.0);
  let b = u32(clamp(color.b, 0.0, 1.0) * 255.0);
  return (r << 24u) | (g << 16u) | (b << 8u) | 255u;
}

fn unpackColor(packed: u32) -> vec3<f32> {
  let r = f32((packed >> 24u) & 0xFFu) / 255.0;
  let g = f32((packed >> 16u) & 0xFFu) / 255.0;
  let b = f32((packed >> 8u) & 0xFFu) / 255.0;
  return vec3<f32>(r, g, b);
}

fn packSizeFlags(size: f32, flags: u32) -> u32 {
  let sizeU16 = u32(clamp(size, 0.0, 65535.0));
  return (sizeU16 << 16u) | (flags & 0xFFFFu);
}

fn unpackSize(packed: u32) -> f32 {
  return f32(packed >> 16u);
}

fn unpackFlags(packed: u32) -> u32 {
  return packed & 0xFFFFu;
}
```

### OutputBuffer
```wgsl
struct FlightOutput {
  position: vec3<f32>,
  direction: vec3<f32>,
};

@group(0) @binding(2) var<storage, read_write> outputs: array<FlightOutput>;
```

## Initialization Strategy

### CPU-side (JavaScript)
1. Generate random control points for each flight
2. Initialize flight states with random t, speed, color
3. Upload buffers to GPU once
4. GPU handles all animation updates

### GPU Compute Shader
```wgsl
@compute @workgroup_size(64)
fn updateFlights(
  @builtin(global_invocation_id) globalId: vec3<u32>
) {
  let flightIndex = globalId.x;
  if (flightIndex >= arrayLength(&flightStates)) {
    return;
  }

  // Update t parameter
  var state = flightStates[flightIndex];
  state.t += deltaTime * state.speed;

  // Handle loop/return flight
  if (state.t > 1.0) {
    state.t = 0.0; // Or reverse direction for return flights
  }

  // Evaluate Catmull-Rom curve at t
  let cp = controlPoints[flightIndex];
  let position = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, state.t);
  let direction = catmullRomTangent(cp.p0, cp.p1, cp.p2, cp.p3, state.t);

  // Write output
  outputs[flightIndex].position = position;
  outputs[flightIndex].direction = normalize(direction);
  flightStates[flightIndex] = state;
}
```

## Performance Targets

- **Compute shader dispatch**: 1M flights / 64 threads = 15,625 workgroups
- **Target**: < 5ms per frame (200fps compute budget)
- **GPU memory**: 88MB (well within 1GB WebGPU limits)
- **Memory bandwidth**:
  - Read: 48MB (control) + 16MB (state) = 64MB
  - Write: 24MB (output) + 16MB (state) = 40MB
  - Total: 104MB/frame × 60fps = 6.2 GB/s (~1-3% of GPU bandwidth)

## Curve Rendering Strategy (affects Step 12)

### Option A: No curve rendering (planes only)
- Memory: 88MB
- Performance: Best (compute + instanced planes only)
- Bandwidth: 6.2 GB/s

### Option B: Frustum culling + on-demand curves
- Render curves only for visible flights (~30% = 300K)
- Generate curve geometry in compute shader
- Memory: 88MB + ~50MB for visible curves = 138MB
- Performance: Good (selective rendering)
- Additional compute: ~1-2ms for curve tessellation

### Option C: Full pre-tessellation
- 1M curves × 50 segments × 2 vertices × vec3 = 1.2GB
- Not recommended (exceeds memory budget)

**Recommendation**: Start with Option A (planes only), add Option B if curves needed.

## Integration Points

### Step 10: Compute Shader
- Reads: ControlPointsBuffer, FlightStateBuffer, uniforms (deltaTime)
- Writes: OutputBuffer, FlightStateBuffer (updated t)

### Step 11: Instanced Plane Rendering
- Reads: OutputBuffer (position, direction)
- Reads: FlightStateBuffer (size, color) via separate binding
- Renders: 1M quads in single draw call

### Step 12: Curve Rendering (optional)
- Reads: ControlPointsBuffer, FlightStateBuffer (for visibility)
- Generates: Curve vertices in compute shader
- Renders: Line strips with gradient coloring

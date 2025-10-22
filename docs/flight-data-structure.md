# Flight Data Structure Design (1M Flights)

## Overview
GPU-optimized data structures for rendering 1 million simultaneous flight paths using WebGPU compute shaders.

## Memory Budget

Total: **~112MB** for 1M flights (with alignment padding)

### Control Points Buffer (64MB)
```
Storage buffer (read-only in compute shader)
- 1M flights × 64 bytes = 64MB
- Layout: 4 × vec4 (16 bytes each, aligned) = 64 bytes per flight
- Per-flight: [p0, p1, p2, p3] (Catmull-Rom curve control points)
- Note: WebGPU requires 16-byte alignment for vec3 in storage buffers
```

### Flight State Buffer (16MB) - PACKED
```
Storage buffer (read-write in compute shader)
- 1M flights × 16 bytes = 16MB
- Per-flight packed data:
  - t: f32                  // Position on curve [0.0, 1.0]
  - speed: f32              // Base speed (multiplied by animationSpeed uniform)
  - packedColor: u32        // RGBA8 (R8G8B8A8_UNORM)
  - packedSizeFlags: u32    // Bits 16-31: size, Bits 8-15: textureIndex, Bits 0-7: flags

Packing benefits:
- Compact 16-byte alignment
- Better cache coherency
- Color precision: 8 bits per channel (sufficient for visualization)
- Flags include: isReturnFlight
```

### Output Buffer (32MB)
```
Storage buffer (write-only from compute, read-only in vertex shader)
- 1M flights × 32 bytes = 32MB
- Per-flight output (with alignment padding):
  - position: vec3<f32> + pad (16 bytes)
  - direction: vec3<f32> + pad (16 bytes)
- Total: 32 bytes per flight
```

## Buffer Layouts

### ControlPointsBuffer
```wgsl
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
```

### FlightStateBuffer
```wgsl
struct FlightState {
  t: f32,                  // Curve parameter [0.0, 1.0]
  speed: f32,              // Speed multiplier
  packedColor: u32,        // RGBA8_UNORM (8 bits per channel)
  packedSizeFlags: u32,    // Bits 16-31: size, Bits 8-15: textureIndex, Bits 0-7: flags
};

@group(0) @binding(2) var<storage, read_write> flightStates: array<FlightState>;

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

fn packSizeFlags(size: f32, textureIndex: u32, flags: u32) -> u32 {
  let sizeU16 = u32(clamp(size, 0.0, 65535.0));
  return (sizeU16 << 16u) | ((textureIndex & 0xFFu) << 8u) | (flags & 0xFFu);
}

fn unpackSize(packed: u32) -> f32 {
  return f32(packed >> 16u);
}

fn unpackTextureIndex(packed: u32) -> u32 {
  return (packed >> 8u) & 0xFFu;
}

fn unpackFlags(packed: u32) -> u32 {
  return packed & 0xFFu;
}
```

### OutputBuffer
```wgsl
struct FlightOutput {
  position: vec3<f32>,
  _pad0: f32,
  direction: vec3<f32>,
  _pad1: f32,
};

@group(0) @binding(3) var<storage, read_write> outputs: array<FlightOutput>;
```

## Initialization Strategy

### CPU-side (JavaScript)
1. Generate random control points for each flight
2. Initialize flight states with random t, speed, color
3. Upload buffers to GPU once
4. GPU handles all animation updates

### GPU Compute Shader
```wgsl
// Uniforms
struct Uniforms {
  deltaTime: f32,
  earthRadius: f32,
  animationSpeed: f32,  // Global speed multiplier (0.01-1.0)
  _pad0: f32,
};

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  // 2D dispatch support for >65K workgroups
  let flightIndex = globalId.y * 65535u * 64u + globalId.x;

  if (flightIndex >= arrayLength(&flightStates)) {
    return;
  }

  var state = flightStates[flightIndex];
  let flags = state.packedSizeFlags & 0xFFFFu;
  let isReturnFlight = (flags & FLAG_RETURN_FLIGHT) != 0u;

  // Update t parameter with global animation speed
  var newT = state.t + uniforms.deltaTime * state.speed * uniforms.animationSpeed;

  // Handle loop/return flight
  if (isReturnFlight) {
    // Reverse direction at endpoints
    if (newT > 1.0) {
      state.speed = -abs(state.speed);
      newT = clamp(1.0 - (newT - 1.0), 0.0, 1.0);
    } else if (newT < 0.0) {
      state.speed = abs(state.speed);
      newT = clamp(-newT, 0.0, 1.0);
    }
  } else {
    newT = fract(newT); // Loop continuously
  }

  state.t = clamp(newT, 0.0, 1.0);

  // Evaluate Catmull-Rom curve
  let cp = controlPoints[flightIndex];
  let position = catmullRom(cp.p0, cp.p1, cp.p2, cp.p3, state.t);
  let tangent = catmullRomTangent(cp.p0, cp.p1, cp.p2, cp.p3, state.t);

  outputs[flightIndex].position = position;

  // Flip direction if traveling backwards
  var direction = normalize(tangent);
  if (state.speed < 0.0) {
    direction = -direction;
  }
  outputs[flightIndex].direction = direction;

  flightStates[flightIndex] = state;
}
```

## Performance Targets

- **Compute shader dispatch**: 1M flights / 64 threads = 15,625 workgroups
  - Uses 2D dispatch (65535 × Y) to bypass 65K workgroup limit
- **Target**: < 5ms per frame (200fps compute budget)
- **GPU memory**: 112MB (well within 1GB WebGPU limits)
- **Memory bandwidth**:
  - Read: 64MB (control) + 16MB (state) + 0.016MB (uniforms) = 80MB
  - Write: 32MB (output) + 16MB (state) = 48MB
  - Total: 128MB/frame × 60fps = 7.68 GB/s (~1-3% of GPU bandwidth)

## Curve Rendering Strategy (IMPLEMENTED - Steps 12-13)

### Implemented: Compute Shader Tessellation
- **Memory**: 112MB (flight data) + 33MB (curve vertices) = 145MB total
- **Strategy**: Generate curve line vertices in compute shader
- **Segmentation**: 32 segments per curve (33 vertices)
- **Performance**: ~1-2ms additional compute time
- **Rendering**: Line strips with dashed line support

### Curve Tessellation Details
- **Buffer**: lineVerticesBuffer (1M × 33 vertices × 32 bytes = 33MB)
- **Compute shader**: Evaluates Catmull-Rom curves at 32 points
- **Features**:
  - Arc length calculation for dashed lines (10-sample approximation)
  - Gradient coloring (fades at endpoints)
  - Supports dash/gap patterns in fragment shader
  - Only tessellates visible flight count (dynamic)

## Integration Points (IMPLEMENTED)

### Step 10: Compute Shader (Flight Updates)
- **File**: `src/shaders/flightUpdate.wgsl`
- **Reads**: ControlPointsBuffer, FlightStateBuffer, uniforms (deltaTime, animationSpeed)
- **Writes**: OutputBuffer, FlightStateBuffer (updated t, speed)
- **Features**: 2D dispatch, return flight support, speed reversal

### Step 11: Instanced Plane Rendering
- **File**: `src/planes/PlanesWebGPU.ts`, `src/shaders/planes.wgsl`
- **Reads**: OutputBuffer (position, direction), FlightStateBuffer (size, color, textureIndex)
- **Renders**: 1M billboards in single draw call
- **Features**:
  - SVG/Pane modes (textured sprites vs solid quads)
  - Elevation offset (radial from Earth)
  - Color override (unified color or random per plane)
  - 8-tile texture atlas (4×2 grid)

### Steps 12-13: Curve Rendering
- **Files**: `src/curves/CurveManager.ts`, `src/shaders/curveTessellation.wgsl`, `src/shaders/curves.wgsl`
- **Reads**: ControlPointsBuffer, FlightStateBuffer
- **Generates**: Line vertices in compute shader (32 segments per curve)
- **Renders**: Line strips with gradient coloring and dashed line support
- **Features**:
  - Arc length calculation for dash patterns
  - Visibility control (hide/show paths)
  - Dash/gap size configurable (0-100 range)

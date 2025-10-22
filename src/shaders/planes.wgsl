/**
 * Planes Rendering Shader (WGSL)
 * Instanced billboard rendering for 1M planes
 * Reads position/direction from FlightManager output buffer
 */

// Uniforms
struct Uniforms {
  viewProjectionMatrix: mat4x4<f32>,
  cameraRight: vec3<f32>,
  _pad0: f32,
  cameraUp: vec3<f32>,
  _pad1: f32,
  baseSize: f32,
  useTexture: f32,
  planesVisible: f32,
  atlasColumns: f32,
  atlasRows: f32,
  _pad2: f32,
  _pad3: f32,
  _pad4: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Flight output buffer (from compute shader)
struct FlightOutput {
  position: vec3<f32>,
  _pad0: f32,
  direction: vec3<f32>,
  _pad1: f32,
};

@group(0) @binding(1) var<storage, read> flightOutputs: array<FlightOutput>;

// Flight state buffer (for colors and sizes)
struct FlightState {
  t: f32,
  speed: f32,
  packedColor: u32,
  packedSizeFlags: u32,
};

@group(0) @binding(2) var<storage, read> flightStates: array<FlightState>;

// Texture atlas
@group(0) @binding(3) var planeSampler: sampler;
@group(0) @binding(4) var planeTexture: texture_2d<f32>;

// Vertex output
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

// Helper: Unpack color from u32 RGBA8
fn unpackColor(packed: u32) -> vec3<f32> {
  let r = f32((packed >> 24u) & 0xFFu) / 255.0;
  let g = f32((packed >> 16u) & 0xFFu) / 255.0;
  let b = f32((packed >> 8u) & 0xFFu) / 255.0;
  return vec3<f32>(r, g, b);
}

// Helper: Unpack size from u32
fn unpackSize(packed: u32) -> f32 {
  return f32(packed >> 16u);
}

// Helper: Unpack texture index from u32 (bits 8-15)
fn unpackTextureIndex(packed: u32) -> u32 {
  return (packed >> 8u) & 0xFFu;
}

// Vertex shader
@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  var output: VertexOutput;

  // Check visibility
  if (uniforms.planesVisible < 0.5) {
    output.position = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return output;
  }

  // Bounds check
  if (instanceIndex >= arrayLength(&flightOutputs)) {
    output.position = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return output;
  }

  // Load flight data
  let flightOutput = flightOutputs[instanceIndex];
  let flightState = flightStates[instanceIndex];

  // Unpack color, size, and texture index
  let color = unpackColor(flightState.packedColor);
  let size = unpackSize(flightState.packedSizeFlags);
  let textureIndex = unpackTextureIndex(flightState.packedSizeFlags);

  // Quad vertices (centered at origin)
  // vertexIndex: 0=TL, 1=TR, 2=BL, 3=BR (triangle strip)
  let quadOffsets = array<vec2<f32>, 4>(
    vec2<f32>(-0.5, 0.5),  // Top-left
    vec2<f32>(0.5, 0.5),   // Top-right
    vec2<f32>(-0.5, -0.5), // Bottom-left
    vec2<f32>(0.5, -0.5),  // Bottom-right
  );

  let quadUVs = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 0.0), // Top-left
    vec2<f32>(1.0, 0.0), // Top-right
    vec2<f32>(0.0, 1.0), // Bottom-left
    vec2<f32>(1.0, 1.0), // Bottom-right
  );

  let offset = quadOffsets[vertexIndex];
  var uv = quadUVs[vertexIndex];

  // Apply atlas UV transform if using texture
  if (uniforms.useTexture > 0.5) {
    let columns = u32(uniforms.atlasColumns);
    let rows = u32(uniforms.atlasRows);
    let col = textureIndex % columns;
    let row = textureIndex / columns;

    let tileWidth = 1.0 / uniforms.atlasColumns;
    let tileHeight = 1.0 / uniforms.atlasRows;

    uv = vec2<f32>(
      f32(col) * tileWidth + uv.x * tileWidth,
      f32(row) * tileHeight + uv.y * tileHeight,
    );
  }

  // Orient billboard to align with flight direction
  // The plane texture has nose pointing "up" in texture space,
  // so billboard's "up" vector should point in flight direction
  let flightDir = normalize(flightOutput.direction);
  let worldUp = normalize(flightOutput.position); // Radial up from Earth center

  // Right vector perpendicular to flight direction (for wings)
  var right = normalize(cross(worldUp, flightDir));
  if (length(right) < 0.001) {
    // Handle case where flight direction is vertical (parallel to worldUp)
    let fallbackUp = vec3<f32>(0.0, 1.0, 0.0);
    right = normalize(cross(fallbackUp, flightDir));
  }

  // Up points in flight direction (so plane nose points forward)
  let up = flightDir;

  // Create billboard vertex in local space, then transform to world space
  let localOffset = right * offset.x + up * offset.y;
  let billboardOffset = localOffset * size * uniforms.baseSize;
  let worldPosition = flightOutput.position + billboardOffset;

  // Transform to clip space
  output.position = uniforms.viewProjectionMatrix * vec4<f32>(worldPosition, 1.0);
  output.color = color;
  output.uv = uv;

  return output;
}

// Fragment shader
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  var baseColor = input.color;

  if (uniforms.useTexture > 0.5) {
    let textureColor = textureSample(planeTexture, planeSampler, input.uv);

    // Alpha cutoff
    if (textureColor.a < 0.05) {
      discard;
    }

    // Paint mask: tint gray parts (#D9D9D9 in linear space ≈ 0.6939)
    let paintBase = vec3<f32>(0.6939);
    let paintDistance = distance(textureColor.rgb, paintBase);
    let paintMask = smoothstep(0.25, 0.0, paintDistance);

    baseColor = mix(textureColor.rgb, input.color, paintMask);

    return vec4<f32>(clamp(baseColor, vec3<f32>(0.0), vec3<f32>(1.0)), textureColor.a);
  } else {
    return vec4<f32>(clamp(baseColor, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }
}

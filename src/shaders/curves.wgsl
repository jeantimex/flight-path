/**
 * Curve Rendering Shader (WGSL)
 * Renders flight path curves with gradient colors
 */

// Uniforms
struct Uniforms {
  viewProjectionMatrix: mat4x4<f32>,
  curvesVisible: f32,
  lineWidth: f32,
  dashSize: f32,
  gapSize: f32,
  cameraPosition: vec3<f32>,  // Camera position for backface culling
  _pad0: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Vertex input (from compute shader output)
struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) distance: f32,
  @location(2) color: vec3<f32>,
};

// Vertex output
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) distance: f32,
};

// Vertex shader
@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // Hide if not visible
  if (uniforms.curvesVisible < 0.5) {
    output.position = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return output;
  }

  // Backface culling: Hide curves on far side of Earth
  // Calculate vector from Earth center (0,0,0) to curve point
  let pointDir = normalize(input.position);

  // Calculate vector from Earth center to camera
  let cameraDir = normalize(uniforms.cameraPosition);

  // Dot product: >0 means point is on visible hemisphere
  let dotProduct = dot(pointDir, cameraDir);

  // Cull points on far side (with small threshold to avoid edge artifacts)
  if (dotProduct < -0.1) {
    output.position = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return output;
  }

  // Transform to clip space
  output.position = uniforms.viewProjectionMatrix * vec4<f32>(input.position, 1.0);
  output.color = input.color;
  output.distance = input.distance;

  return output;
}

// Fragment shader
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Implement dashed line rendering
  if (uniforms.dashSize > 0.0) {
    let dashGapSize = uniforms.dashSize + uniforms.gapSize;
    let posInCycle = input.distance % dashGapSize;

    // Discard fragments in gap
    if (posInCycle > uniforms.dashSize) {
      discard;
    }
  }

  return vec4<f32>(input.color, 1.0);
}

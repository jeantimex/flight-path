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

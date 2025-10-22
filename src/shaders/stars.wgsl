/**
 * Stars Shader (WGSL)
 * Twinkling starfield using instanced quads
 */

struct Uniforms {
  viewProjectionMatrix: mat4x4<f32>,
  cameraRight: vec3<f32>,
  _pad0: f32,
  cameraUp: vec3<f32>,
  _pad1: f32,
  time: f32,
  starSize: f32,
  _pad2: f32,
  _pad3: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Per-vertex input (quad corners: -1,-1  1,-1  1,1  -1,1)
struct VertexInput {
  @location(0) quadCorner: vec2<f32>,
};

// Per-instance input (star data)
struct InstanceInput {
  @location(1) position: vec3<f32>,
  @location(2) opacity: f32,
};

// Vertex output / Fragment input
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) opacity: f32,
  @location(1) quadUV: vec2<f32>,
};

@vertex
fn vertexMain(vertex: VertexInput, instance: InstanceInput) -> VertexOutput {
  var output: VertexOutput;

  // Billboard quad facing camera
  let offset = uniforms.cameraRight * vertex.quadCorner.x * uniforms.starSize +
               uniforms.cameraUp * vertex.quadCorner.y * uniforms.starSize;

  let worldPos = instance.position + offset;
  output.position = uniforms.viewProjectionMatrix * vec4<f32>(worldPos, 1.0);
  output.opacity = instance.opacity;

  // UV coordinates for circular star shape (0,0 to 1,1)
  output.quadUV = vertex.quadCorner * 0.5 + 0.5;

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Circular star shape
  let dist = length(input.quadUV - vec2<f32>(0.5));
  if (dist > 0.5) {
    discard;
  }

  // Twinkling animation - more pronounced blinking
  let twinkle = sin(uniforms.time * input.opacity * 4.0 + input.opacity * 15.0) * 0.5 + 0.5;

  // Fade from center to edge
  let alpha = (1.0 - dist * 2.0) * twinkle;

  return vec4<f32>(1.0, 1.0, 1.0, alpha);
}

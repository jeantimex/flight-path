/**
 * Atmosphere Shader (WGSL)
 * Atmospheric scattering glow effect
 */

struct Uniforms {
  viewProjectionMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  cameraPosition: vec3<f32>,
  _pad0: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Vertex input
struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

// Vertex output / Fragment input
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // Transform position to world space
  let worldPos = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
  output.worldPosition = worldPos.xyz;

  // Transform position to clip space
  output.position = uniforms.viewProjectionMatrix * worldPos;

  // Transform normal to world space
  let worldNormal = uniforms.normalMatrix * vec4<f32>(input.normal, 0.0);
  output.worldNormal = normalize(worldNormal.xyz);

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Rim lighting: glow at edges where normal faces away from camera
  let viewDir = normalize(uniforms.cameraPosition - input.worldPosition);
  let rawIntensity = pow(0.6 - dot(input.worldNormal, viewDir), 2.0);
  let intensity = rawIntensity * 0.3; // Reduce intensity by 70% for lighter atmosphere

  // Blue atmospheric glow
  let color = vec3<f32>(0.3, 0.6, 1.0);

  return vec4<f32>(color * intensity, intensity);
}

/**
 * Earth Shader (WGSL)
 * Phong lighting with texture mapping
 */

// Uniforms
struct Uniforms {
  viewProjectionMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  cameraPosition: vec3<f32>,
  _pad0: f32,
  lightDirection: vec3<f32>,
  _pad1: f32,
  shininess: f32,
  _pad2: f32,
  _pad3: f32,
  _pad4: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var earthTexture: texture_2d<f32>;
@group(0) @binding(2) var earthSampler: sampler;

// Vertex shader input
struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

// Vertex shader output / Fragment shader input
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
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
  output.normal = normalize(worldNormal.xyz);

  // Pass UV coordinates
  output.uv = input.uv;

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Sample texture
  let texColor = textureSample(earthTexture, earthSampler, input.uv);

  // Normalize interpolated normal
  let normal = normalize(input.normal);

  // Light direction (normalized)
  let lightDir = normalize(uniforms.lightDirection);

  // View direction
  let viewDir = normalize(uniforms.cameraPosition - input.worldPosition);

  // Ambient
  let ambient = 0.3;

  // Diffuse (Lambertian)
  let diffuse = max(dot(normal, lightDir), 0.0);

  // Specular (Phong)
  let reflectDir = reflect(-lightDir, normal);
  let spec = pow(max(dot(viewDir, reflectDir), 0.0), uniforms.shininess);
  let specular = spec * 0.2; // Specular intensity

  // Combine lighting
  let lighting = ambient + diffuse + specular;

  // Apply lighting to texture color
  let finalColor = texColor.rgb * lighting;

  return vec4<f32>(finalColor, texColor.a);
}

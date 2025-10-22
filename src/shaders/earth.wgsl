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
  dayNightEnabled: f32,
  dayBrightness: f32,    // 0.0 to 1.0
  nightBrightness: f32,  // 0.0 to 1.0
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

  var finalColor: vec3<f32>;

  if (uniforms.dayNightEnabled > 0.5) {
    // Day/Night lighting enabled
    // Calculate sun angle (-1 to 1, where 1 = directly facing sun)
    let sunAngle = dot(normal, lightDir);

    // Diffuse lighting (0 to 1)
    let diffuse = max(sunAngle, 0.0);

    // Specular (Phong)
    let reflectDir = reflect(-lightDir, normal);
    let spec = pow(max(dot(viewDir, reflectDir), 0.0), uniforms.shininess);
    let specular = spec * 0.2;

    // Convert brightness percentages to intensity multipliers
    // dayBrightness of 0.7 (70%) gives dayIntensity of ~1.6
    // nightBrightness of 0.4 (40%) gives nightIntensity of ~0.5
    let dayIntensity = uniforms.dayBrightness * 2.0 + 0.2;
    let nightIntensity = uniforms.nightBrightness * 1.0 + 0.1;

    // Smooth transition at terminator (sunAngle from -0.2 to 0.2)
    let terminatorBlend = smoothstep(-0.2, 0.2, sunAngle);

    // Blend between night and day lighting
    let ambientIntensity = mix(nightIntensity, dayIntensity * 0.95, terminatorBlend);

    // Day side: full lighting with specular
    // Night side: just ambient (simulating city lights/moonlight)
    let lighting = ambientIntensity + diffuse * dayIntensity + specular;

    finalColor = texColor.rgb * lighting;
  } else {
    // Day/Night disabled: use simple lighting
    let ambient = 0.3;
    let diffuse = max(dot(normal, lightDir), 0.0);
    let reflectDir = reflect(-lightDir, normal);
    let spec = pow(max(dot(viewDir, reflectDir), 0.0), uniforms.shininess);
    let specular = spec * 0.2;
    let lighting = ambient + diffuse + specular;
    finalColor = texColor.rgb * lighting;
  }

  return vec4<f32>(finalColor, texColor.a);
}

varying vec3 vColor;
varying vec2 vUv;
uniform sampler2D paneMap;
uniform float useTexture;

void main() {
  vec4 textureColor = vec4(1.0);
  if(useTexture > 0.5) {
    textureColor = texture2D(paneMap, vUv);
    if(textureColor.a < 0.05)
      discard;
  }

  vec3 gradientColor = vColor;
  vec3 baseColor = textureColor.rgb;

  if(useTexture > 0.5) {
        // Base body color in linear space (converted from #D9D9D9)
    vec3 paintBase = vec3(0.6939);
    float paintDistance = distance(baseColor, paintBase);
    float paintMask = smoothstep(0.25, 0.0, paintDistance);

    baseColor = mix(baseColor, gradientColor, paintMask);
  } else {
    baseColor = gradientColor;
  }

  vec3 finalColor = clamp(baseColor, 0.0, 1.0);
  float finalAlpha = useTexture > 0.5 ? textureColor.a : 1.0;
  gl_FragColor = vec4(finalColor, finalAlpha);
}

uniform float time;
uniform float hashSeed;
uniform bool showStarCloud;
uniform vec3 cloudOffsetA;
uniform vec3 cloudOffsetB;
uniform vec3 cloudOffsetC;
uniform vec3 dustOffset;
uniform vec3 skyBasisX;
uniform vec3 skyBasisY;
uniform vec3 skyBasisZ;
uniform vec3 baseColor;
uniform vec3 coolColor;
uniform vec3 warmColor;
uniform vec3 roseColor;
uniform vec3 violetColor;
uniform vec3 paleColor;
uniform vec3 cameraBasisX;
uniform vec3 cameraBasisY;
uniform vec3 cameraBasisZ;
uniform vec2 cameraFovScale;

varying vec2 vUv;

float hash(vec3 p) {
  p += hashSeed;
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p *= 2.08;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p *= cameraFovScale;

  vec3 cameraDir = normalize(
    cameraBasisX * p.x + cameraBasisY * p.y + cameraBasisZ
  );
  vec3 dir = normalize(
    vec3(
      dot(cameraDir, skyBasisX),
      dot(cameraDir, skyBasisY),
      dot(cameraDir, skyBasisZ)
    )
  );

  float bandTilt = mix(-0.65, 0.65, hash(vec3(2.0, 7.0, 11.0)));
  float band = pow(1.0 - abs(dir.y * 0.95 + dir.x * bandTilt), 2.4);
  float cloudA = fbm(dir * 3.2 + cloudOffsetA + vec3(0.0, 0.0, time * 0.005));
  float cloudB = fbm(dir * 8.0 + cloudOffsetB);
  float cloudC = fbm(dir * 5.4 + cloudOffsetC);
  float nebula = smoothstep(0.38, 0.82, cloudA) * band;
  nebula += smoothstep(0.5, 0.88, cloudB) * band * 0.35;
  float warmNebula = smoothstep(0.42, 0.9, cloudC) * band;
  float violetNebula = smoothstep(0.6, 0.94, cloudB + cloudC * 0.35) * band;
  float dustLane = smoothstep(0.5, 0.9, fbm(dir * 12.0 + dustOffset)) * band;

  vec3 blueCloud = coolColor * nebula * 0.65;
  vec3 goldCloud = warmColor * warmNebula * 0.45;
  vec3 roseCloud = roseColor * violetNebula * 0.24;
  vec3 violetCloud = violetColor * pow(violetNebula, 2.0) * 0.28;
  vec3 paleCloud = paleColor * pow(nebula + warmNebula, 2.0) * 0.24;

  vec3 starCell = floor(dir * 420.0);
  float starRand = hash(starCell);
  float star = smoothstep(0.996, 1.0, starRand);
  float brightStar = smoothstep(0.9995, 1.0, starRand);
  vec3 starColor = mix(
    vec3(0.55, 0.68, 1.0),
    vec3(1.0, 0.96, 0.82),
    hash(starCell + 4.7)
  );

  float blinkChance = smoothstep(0.45, 1.0, hash(starCell + 17.3));
  float blinkRate = mix(0.55, 2.2, hash(starCell + 9.1));
  float blinkClock = time * blinkRate + hash(starCell + 22.4) * 40.0;
  float blinkWindow = floor(blinkClock);
  float blinkT = fract(blinkClock);
  float blinkSeed = hash(
    starCell + vec3(blinkWindow, blinkWindow * 2.17, blinkWindow * 3.31)
  );
  float twinkle =
    pow(
      smoothstep(0.78, 0.98, blinkT) * (1.0 - smoothstep(0.98, 1.0, blinkT)),
      0.8
    );
  twinkle *= smoothstep(0.35, 1.0, blinkSeed);
  float blink = 0.55 + 0.45 * twinkle * blinkChance;

  float sparkleChance = smoothstep(0.88, 1.0, hash(starCell + 31.7));
  float sparkleRate = mix(0.25, 1.1, hash(starCell + 42.2));
  float sparkleClock = time * sparkleRate + hash(starCell + 51.9) * 70.0;
  float sparkleWindow = floor(sparkleClock);
  float sparkleT = fract(sparkleClock);
  float sparkleSeed = hash(
    starCell + vec3(sparkleWindow * 4.7, sparkleWindow, sparkleWindow * 1.9)
  );
  float sparkle =
    smoothstep(0.78, 0.92, sparkleT) * (1.0 - smoothstep(0.92, 1.0, sparkleT));
  sparkle *= sparkleChance * smoothstep(0.72, 1.0, sparkleSeed);

  vec3 cloudColor = showStarCloud
    ? blueCloud + paleCloud + goldCloud + roseCloud + violetCloud
    : vec3(0.0);
  float dustMask = showStarCloud ? dustLane : 0.0;

  vec3 color = baseColor + cloudColor;
  color += starColor * star * blink * 1.15;
  color += vec3(1.0) * brightStar * (0.7 + 1.2 * twinkle * blinkChance);
  color += vec3(0.85, 0.92, 1.0) * star * sparkle * 2.2;
  color *= 1.0 - dustMask * 0.35;

  gl_FragColor = vec4(color, 1.0);
}

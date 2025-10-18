uniform float time;
varying float vOpacity;

void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;

  float twinkle = sin(time * vOpacity * 3.0 + vOpacity * 10.0) * 0.3 + 0.7;
  float alpha = (1.0 - dist * 2.0) * twinkle;

  gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
}

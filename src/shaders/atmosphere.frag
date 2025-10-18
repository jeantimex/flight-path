varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
  gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
}

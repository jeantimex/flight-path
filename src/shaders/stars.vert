attribute float opacity;
varying float vOpacity;

void main() {
  vOpacity = opacity;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 3.0;
  gl_Position = projectionMatrix * mvPosition;
}

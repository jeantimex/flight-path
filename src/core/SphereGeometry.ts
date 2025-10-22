/**
 * Sphere Geometry Generator for WebGPU
 * Creates vertex buffer data for UV sphere
 */

export interface SphereGeometryData {
  vertices: Float32Array; // Interleaved: position (3) + normal (3) + uv (2)
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
  stride: number; // Bytes per vertex
}

/**
 * Generate UV sphere geometry
 * @param radius - Sphere radius
 * @param widthSegments - Number of horizontal segments (longitude)
 * @param heightSegments - Number of vertical segments (latitude)
 * @returns Geometry data with interleaved vertices
 */
export function createSphereGeometry(
  radius: number,
  widthSegments: number = 64,
  heightSegments: number = 32,
): SphereGeometryData {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Generate vertices
  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments; // 0 to 1
    const phi = v * Math.PI; // 0 to PI (north pole to south pole)

    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments; // 0 to 1
      const theta = u * Math.PI * 2; // 0 to 2*PI (around equator)

      // Spherical to Cartesian coordinates
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      // Position
      const px = -radius * sinPhi * cosTheta; // Negative to match Three.js winding
      const py = radius * cosPhi;
      const pz = radius * sinPhi * sinTheta;

      // Normal (normalized position for sphere)
      const nx = -sinPhi * cosTheta;
      const ny = cosPhi;
      const nz = sinPhi * sinTheta;

      // UV coordinates
      const uvU = u;
      const uvV = v;

      // Interleaved vertex data: [position, normal, uv]
      vertices.push(
        px, py, pz,    // position
        nx, ny, nz,    // normal
        uvU, uvV       // uv
      );
    }
  }

  // Generate indices (two triangles per quad)
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      const c = a + 1;
      const d = b + 1;

      // Triangle 1
      indices.push(a, b, c);
      // Triangle 2
      indices.push(b, d, c);
    }
  }

  const stride = 8 * 4; // 8 floats per vertex × 4 bytes per float

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    vertexCount: vertices.length / 8,
    indexCount: indices.length,
    stride,
  };
}

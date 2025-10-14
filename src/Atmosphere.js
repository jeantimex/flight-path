import * as THREE from "three";

export class Atmosphere {
  constructor(earthRadius = 3000) {
    this.earthRadius = earthRadius;
    this.mesh = null;
    this.material = null;
    this.createAtmosphere();
  }

  createAtmosphere() {
    const atmosphereGeometry = new THREE.SphereGeometry(
      this.earthRadius * 1.25,
      64,
      32
    );
    this.material = new THREE.ShaderMaterial({
      vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
      fragmentShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
                    gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
                }
            `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(atmosphereGeometry, this.material);
    this.mesh.rotation.y = -Math.PI / 2; // Match Earth rotation
  }

  addToScene(scene) {
    if (this.mesh) {
      scene.add(this.mesh);
    }
  }

  dispose() {
    if (this.mesh && this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
  }
}

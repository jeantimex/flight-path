import * as THREE from "three";
import atmosphereVertexShader from "./shaders/atmosphere.vert?raw";
import atmosphereFragmentShader from "./shaders/atmosphere.frag?raw";

export class Atmosphere {
  private earthRadius: number;
  public mesh: THREE.Mesh | null;
  private material: THREE.ShaderMaterial | null;

  constructor(earthRadius: number = 3000) {
    this.earthRadius = earthRadius;
    this.mesh = null;
    this.material = null;
    this.createAtmosphere();
  }

  private createAtmosphere(): void {
    const atmosphereGeometry = new THREE.SphereGeometry(
      this.earthRadius * 1.25,
      64,
      32,
    );
    this.material = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(atmosphereGeometry, this.material);
    this.mesh.rotation.y = -Math.PI / 2; // Match Earth rotation
  }

  public addToScene(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.add(this.mesh);
    }
  }

  public dispose(): void {
    if (this.mesh && this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
  }
}

import * as THREE from "three";
import starsVertexShader from "./shaders/stars.vert?raw";
import starsFragmentShader from "./shaders/stars.frag?raw";

export class Stars {
  private starCount: number;
  private minRadius: number;
  private maxRadius: number;
  public mesh: THREE.Points | null;
  private material: THREE.ShaderMaterial | null;
  private time: number;

  constructor(
    starCount: number = 5000,
    minRadius: number = 50000,
    maxRadius: number = 100000,
  ) {
    this.starCount = starCount;
    this.minRadius = minRadius;
    this.maxRadius = maxRadius;
    this.mesh = null;
    this.material = null;
    this.time = 0;
    this.createStars();
  }

  private createStars(): void {
    const starsGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(this.starCount * 3);
    const starOpacities = new Float32Array(this.starCount);

    for (let i = 0; i < this.starCount * 3; i += 3) {
      const radius =
        this.minRadius + Math.random() * (this.maxRadius - this.minRadius);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      starPositions[i] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i + 2] = radius * Math.cos(phi);

      starOpacities[i / 3] = Math.random();
    }

    starsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3),
    );
    starsGeometry.setAttribute(
      "opacity",
      new THREE.BufferAttribute(starOpacities, 1),
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
      },
      vertexShader: starsVertexShader,
      fragmentShader: starsFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(starsGeometry, this.material);
  }

  public addToScene(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.add(this.mesh);
    }
  }

  public update(deltaTime: number = 0.01): void {
    this.time += deltaTime;
    if (this.material) {
      this.material.uniforms.time.value = this.time;
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

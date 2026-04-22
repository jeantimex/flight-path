import * as THREE from "three";
import starsVertexShader from "../shaders/stars.vert?raw";
import starsFragmentShader from "../shaders/stars.frag?raw";

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomColor(
  hue: number,
  saturation: number,
  lightness: number,
): THREE.Color {
  return new THREE.Color().setHSL(hue, saturation, lightness);
}

function randomFromRanges(ranges: Array<[number, number]>): number {
  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return randomRange(range[0], range[1]);
}

export class Stars {
  public mesh: THREE.Mesh | null;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly material: THREE.ShaderMaterial;
  private readonly cameraBasisX = new THREE.Vector3(1, 0, 0);
  private readonly cameraBasisY = new THREE.Vector3(0, 1, 0);
  private readonly cameraBasisZ = new THREE.Vector3(0, 0, -1);
  private readonly fovScale = new THREE.Vector2(1, 1);
  private time = 0;

  constructor(
    _starCount: number = 5000,
    _minRadius: number = 50000,
    _maxRadius: number = 100000,
  ) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();

    const skySeed = randomRange(1, 10000);
    const skyRotation = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        "XYZ",
      ),
    );
    const skyAccentHue = randomFromRanges([
      [0.0, 0.07],
      [0.82, 0.96],
    ]);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        hashSeed: { value: skySeed },
        showStarCloud: { value: true },
        cloudOffsetA: {
          value: new THREE.Vector3(
            randomRange(-80, 80),
            randomRange(-80, 80),
            randomRange(-80, 80),
          ),
        },
        cloudOffsetB: {
          value: new THREE.Vector3(
            randomRange(-80, 80),
            randomRange(-80, 80),
            randomRange(-80, 80),
          ),
        },
        cloudOffsetC: {
          value: new THREE.Vector3(
            randomRange(-80, 80),
            randomRange(-80, 80),
            randomRange(-80, 80),
          ),
        },
        dustOffset: {
          value: new THREE.Vector3(
            randomRange(-80, 80),
            randomRange(-80, 80),
            randomRange(-80, 80),
          ),
        },
        skyBasisX: {
          value: new THREE.Vector3().setFromMatrixColumn(skyRotation, 0),
        },
        skyBasisY: {
          value: new THREE.Vector3().setFromMatrixColumn(skyRotation, 1),
        },
        skyBasisZ: {
          value: new THREE.Vector3().setFromMatrixColumn(skyRotation, 2),
        },
        baseColor: {
          value: randomColor(randomRange(0.58, 0.68), 0.45, 0.006),
        },
        coolColor: {
          value: randomColor(
            randomRange(0.58, 0.68),
            randomRange(0.62, 0.9),
            randomRange(0.22, 0.38),
          ),
        },
        warmColor: {
          value: randomColor(
            randomRange(0.055, 0.13),
            randomRange(0.72, 0.95),
            randomRange(0.38, 0.56),
          ),
        },
        roseColor: {
          value: randomColor(
            randomRange(0.0, 0.045),
            randomRange(0.72, 0.95),
            randomRange(0.32, 0.5),
          ),
        },
        violetColor: {
          value: randomColor(
            skyAccentHue,
            randomRange(0.58, 0.9),
            randomRange(0.22, 0.38),
          ),
        },
        paleColor: {
          value: randomColor(
            randomRange(0.08, 0.14),
            randomRange(0.38, 0.65),
            randomRange(0.58, 0.74),
          ),
        },
        cameraBasisX: { value: this.cameraBasisX },
        cameraBasisY: { value: this.cameraBasisY },
        cameraBasisZ: { value: this.cameraBasisZ },
        cameraFovScale: { value: this.fovScale },
      },
      vertexShader: starsVertexShader,
      fragmentShader: starsFragmentShader,
      depthWrite: false,
      depthTest: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  public addToScene(_scene: THREE.Scene): void {
    // The universe background is rendered as its own full-screen pass.
  }

  public update(deltaTime: number = 0.01): void {
    this.time += deltaTime;
    this.material.uniforms.time.value = this.time;
  }

  public render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
  ): void {
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(
      this.cameraBasisX,
      this.cameraBasisY,
      this.cameraBasisZ,
    );
    this.cameraBasisZ.negate();

    const fovY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    this.fovScale.set(fovY * camera.aspect, fovY);

    renderer.render(this.scene, this.camera);
  }

  public setStarCloudVisible(visible: boolean): void {
    this.material.uniforms.showStarCloud.value = visible;
  }

  public dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
    this.material.dispose();
  }
}

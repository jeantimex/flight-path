import * as THREE from 'three'

export class Plane {
    constructor(scene) {
        this.scene = scene
        this.mesh = null
        this.baseScale = 1
    }

    async load() {
        throw new Error('load() must be implemented by subclasses')
    }

    createFallbackCube(color = 0xff6666) {
        const geometry = new THREE.BoxGeometry(100, 100, 100)
        const material = new THREE.MeshBasicMaterial({ color })
        this.mesh = new THREE.Mesh(geometry, material)
        this.scene.add(this.mesh)
    }

    remove() {
        if (this.mesh) {
            this.scene.remove(this.mesh)
            this.mesh = null
        }
    }

    getMesh() {
        return this.mesh
    }

    setMesh(mesh) {
        this.mesh = mesh
        if (mesh && this.baseScale) {
            this.setBaseScale(this.baseScale)
        }
    }

    setScale(scale) {
        if (this.mesh) {
            this.mesh.scale.setScalar(this.baseScale * scale)
        }
    }

    setBaseScale(baseScale) {
        this.baseScale = baseScale
        if (this.mesh) {
            this.mesh.scale.setScalar(baseScale)
        }
    }

    updatePositionAndOrientation(curve, planeSize, t) {
        if (!this.mesh || !curve || !curve.exists()) return

        this.setScale(planeSize)

        const position = curve.getPointAt(t)
        const tangent = curve.getTangentAt(t).normalize()

        const up = new THREE.Vector3(0, 1, 0)
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize()
        const newUp = new THREE.Vector3().crossVectors(right, tangent).normalize()

        this.mesh.position.copy(position)

        const rotationMatrix = new THREE.Matrix4()
        rotationMatrix.makeBasis(right, newUp, tangent.clone().negate())
        this.mesh.setRotationFromMatrix(rotationMatrix)
    }
}

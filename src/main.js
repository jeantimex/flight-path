import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js'
import { Curve } from './Curve.js'
import { SimplePlane } from './SimplePlane.js'

const planeSize = 1.0
const curveType = 'Original'

if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('WebGPU is not supported on this device.')
}

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
camera.position.set(0, 2000, 8000)
camera.lookAt(0, 0, 0)

const canvas = document.createElement('canvas')
document.querySelector('#app').appendChild(canvas)

const renderer = new WebGPURenderer({
    antialias: true,
    canvas
})

renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(window.devicePixelRatio || 1)
renderer.setClearColor(0xEFEFEF)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.screenSpacePanning = false
controls.minDistance = 100
controls.maxDistance = 20000
controls.maxPolarAngle = Math.PI

const clock = new THREE.Clock()
let animationTime = 0
let flightCurve
let currentPlane

function getCurveControlPoints(type) {
    if (type === 'Circle') {
        const radius = 3000
        return [
            new THREE.Vector3(radius, 0, 0),
            new THREE.Vector3(0, 0, radius),
            new THREE.Vector3(-radius, 0, 0),
            new THREE.Vector3(0, 0, -radius),
            new THREE.Vector3(radius, 0, 0)
        ]
    }

    return [
        new THREE.Vector3(-1000, -5000, -5000),
        new THREE.Vector3(1000, 0, 0),
        new THREE.Vector3(800, 5000, 5000),
        new THREE.Vector3(-500, 0, 10000)
    ]
}

async function initializeScene() {
    await renderer.init()

    const controlPoints = getCurveControlPoints(curveType)
    flightCurve = new Curve(scene, { controlPoints })
    flightCurve.create()

    currentPlane = new SimplePlane(scene)
    await currentPlane.load()

    renderer.setAnimationLoop(() => {
        const delta = clock.getDelta()
        animationTime += delta * 0.1
        const t = animationTime % 1

        updatePlaneOnCurve(t)
        controls.update()
        renderer.render(scene, camera)
    })
}

function updatePlaneOnCurve(t) {
    if (!currentPlane || !flightCurve || !flightCurve.exists()) return
    currentPlane.updatePositionAndOrientation(flightCurve, planeSize, t)
}

window.addEventListener('resize', () => {
    const width = window.innerWidth
    const height = window.innerHeight
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
})

initializeScene().catch((error) => {
    console.error('Failed to initialize scene:', error)
})

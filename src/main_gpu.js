import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import { GPUCurve } from './GPUCurve.js'
import { GPUPane } from './GPUPane.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0xEFEFEF)
document.querySelector('#app').appendChild(renderer.domElement)

// Global variables
let flightCurve
let gpuPane
const clock = new THREE.Clock()
let animationTime = 0

// GUI controls
const params = {
    curveType: 'Original',
    lineWidth: 2.0,
    segmentCount: 100,
    curveColor: 0x4488ff,
    planeSize: 100,
    planeColor: 0xff6666,
    animationSpeed: 0.1,
    tiltMode: 'Perpendicular'
}

// Setup dat.GUI
const gui = new dat.GUI()
gui.add(params, 'curveType', ['Original', 'Circle']).name('Curve Type').onChange(switchCurveType)
gui.add(params, 'lineWidth', 0.5, 10.0).name('Line Width').onChange(updateLineWidth)
gui.add(params, 'segmentCount', 50, 500).step(50).name('Segments').onChange(updateSegmentCount)
gui.addColor(params, 'curveColor').name('Curve Color').onChange(updateCurveColor)
gui.add(params, 'planeSize', 50, 500).name('Plane Size').onChange(updatePlaneSize)
gui.addColor(params, 'planeColor').name('Plane Color').onChange(updatePlaneColor)
gui.add(params, 'animationSpeed', 0.01, 0.5).name('Animation Speed')
gui.add(params, 'tiltMode', ['Perpendicular', 'Tangent']).name('Tilt Mode')

// Function to get curve control points based on type
function getCurveControlPoints(type) {
    if (type === 'Circle') {
        const radius = 3000
        return [
            new THREE.Vector3(radius, 0, 0),
            new THREE.Vector3(0, 0, radius),
            new THREE.Vector3(-radius, 0, 0),
            new THREE.Vector3(0, 0, -radius),
            new THREE.Vector3(radius, 0, 0) // Close the circle
        ]
    } else {
        // Original curve
        return [
            new THREE.Vector3(-1000, -5000, -5000),
            new THREE.Vector3(1000, 0, 0),
            new THREE.Vector3(800, 5000, 5000),
            new THREE.Vector3(-500, 0, 10000)
        ]
    }
}

// Create the GPU pane (using instanced rendering)
function createGPUPane() {
    gpuPane = new GPUPane(scene, {
        count: 1, // Start with 1 pane, can easily increase this later
        paneSize: params.planeSize,
        color: params.planeColor
    })
    gpuPane.create()
}

// Initialize GPU curve
function initializeCurve() {
    // Create the flight curve using GPU instanced rendering
    const controlPoints = getCurveControlPoints(params.curveType)
    flightCurve = new GPUCurve(scene, {
        controlPoints,
        lineWidth: params.lineWidth,
        segmentCount: params.segmentCount,
        color: params.curveColor
    })
    flightCurve.create()
}

// Update pane position and orientation along the curve
function updatePaneOnCurve(t) {
    if (!gpuPane || !flightCurve || !flightCurve.exists()) return

    // Update the first pane instance (index 0) with tilt mode
    gpuPane.updatePaneOnCurve(0, flightCurve, t, 0.001, params.tiltMode)
}

// Function to update curve color
function updateCurveColor(color) {
    if (flightCurve) {
        flightCurve.setColor(color)
    }
}

// Function to update line width
function updateLineWidth(width) {
    if (flightCurve) {
        flightCurve.setLineWidth(width)
    }
}

// Function to update segment count
function updateSegmentCount(count) {
    if (flightCurve) {
        // Recreate curve with new segment count
        const controlPoints = getCurveControlPoints(params.curveType)
        flightCurve.remove()
        flightCurve = new GPUCurve(scene, {
            controlPoints,
            lineWidth: params.lineWidth,
            segmentCount: count,
            color: params.curveColor
        })
        flightCurve.create()
    }
}

// Function to update plane size
function updatePlaneSize(size) {
    if (gpuPane) {
        gpuPane.setSize(size)
    }
}

// Function to update plane color
function updatePlaneColor(color) {
    if (gpuPane) {
        gpuPane.setColor(color)
    }
}

// Initialize the curve and pane
initializeCurve()
createGPUPane()

// Add lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.6)
scene.add(ambientLight)
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
directionalLight.position.set(1000, 1000, 1000)
scene.add(directionalLight)

// Position camera
camera.position.set(0, 2000, 8000)
camera.lookAt(0, 0, 0)

// Setup OrbitControls
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.screenSpacePanning = false
controls.minDistance = 100
controls.maxDistance = 20000
controls.maxPolarAngle = Math.PI

// Function to switch between curve types
function switchCurveType(value) {
    // Remove current curve
    if (flightCurve) {
        flightCurve.remove()
        flightCurve = null
    }

    // Create new GPU curve
    const controlPoints = getCurveControlPoints(value)
    flightCurve = new GPUCurve(scene, {
        controlPoints,
        lineWidth: params.lineWidth,
        segmentCount: params.segmentCount,
        color: params.curveColor
    })
    flightCurve.create()
}

// Animation loop
function animate() {
    requestAnimationFrame(animate)

    const delta = clock.getDelta()

    // Update animation time
    animationTime += delta * params.animationSpeed
    const t = (animationTime % 1) // Loop from 0 to 1

    // Update pane position and orientation
    updatePaneOnCurve(t)

    // Update controls
    controls.update()

    renderer.render(scene, camera)
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// Start animation
animate()

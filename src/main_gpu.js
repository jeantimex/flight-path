import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import { GPUFlight } from './GPUFlight.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0xEFEFEF)
document.querySelector('#app').appendChild(renderer.domElement)

// Global variables
let flight
const clock = new THREE.Clock()

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

// Initialize GPU flight (curve + pane)
function initializeFlight() {
    const controlPoints = getCurveControlPoints(params.curveType)

    flight = new GPUFlight(scene, {
        controlPoints,
        segmentCount: params.segmentCount,
        lineWidth: params.lineWidth,
        curveColor: params.curveColor,
        paneCount: 1,
        paneSize: params.planeSize,
        paneColor: params.planeColor,
        animationSpeed: params.animationSpeed,
        tiltMode: params.tiltMode
    })

    flight.create()
}

// Function to update curve color
function updateCurveColor(color) {
    if (flight) {
        flight.setCurveColor(color)
    }
}

// Function to update line width
function updateLineWidth(width) {
    if (flight) {
        flight.setCurveLineWidth(width)
    }
}

// Function to update segment count
function updateSegmentCount(count) {
    if (flight) {
        flight.setCurveSegmentCount(count)
    }
}

// Function to update plane size
function updatePlaneSize(size) {
    if (flight) {
        flight.setPaneSize(size)
    }
}

// Function to update plane color
function updatePlaneColor(color) {
    if (flight) {
        flight.setPaneColor(color)
    }
}

// Initialize the flight
initializeFlight()

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
    if (flight) {
        const controlPoints = getCurveControlPoints(value)
        flight.setControlPoints(controlPoints)
    }
}

// Animation loop
function animate() {
    requestAnimationFrame(animate)

    const delta = clock.getDelta()

    // Update flight (curve + pane animation)
    if (flight) {
        flight.setAnimationSpeed(params.animationSpeed)
        flight.setTiltMode(params.tiltMode)
        flight.update(delta)
    }

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

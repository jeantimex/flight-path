import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import { GPUPlane } from './GPUPlane.js'
import { GPUCurve } from './GPUCurve.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0xEFEFEF)
document.querySelector('#app').appendChild(renderer.domElement)

// Global variables
const clock = new THREE.Clock()
let gpuPlane = null
let gpuCurve = null

// GUI controls
const params = {
    curveType: 'Original',
    planeCount: 1
}

// Setup dat.GUI
const gui = new dat.GUI()
gui.add(params, 'curveType', ['Original', 'Circle']).name('Curve Type').onChange(switchCurveType)
gui.add(params, 'planeCount', 1, 10).step(1).name('Plane Count').onChange(updatePlaneCount)

// Function to get curve control points based on type
function getCurveControlPoints(type) {
    if (type === 'Circle') {
        const radius = 3000
        return [
            new THREE.Vector3(radius, 0, 0),
            new THREE.Vector3(0, 0, radius),
            new THREE.Vector3(-radius, 0, 0),
            new THREE.Vector3(0, 0, -radius)
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

// Initialize GPU planes and curve
async function initializeGPUPlanes() {
    // Create GPU curve visualization
    const controlPoints = getCurveControlPoints(params.curveType)
    gpuCurve = new GPUCurve(scene, { controlPoints })
    gpuCurve.create() // Call create() to match Curve.js API

    // Create GPU plane system
    gpuPlane = new GPUPlane(scene, 10) // Max 10 planes

    // Set initial flight path for first plane
    gpuPlane.setFlightPath(0, controlPoints)
    gpuPlane.setActiveCount(params.planeCount)
}

// Function to update plane count
function updatePlaneCount(count) {
    if (gpuPlane) {
        gpuPlane.setActiveCount(count)

        // Set flight paths for all active planes
        const controlPoints = getCurveControlPoints(params.curveType)
        for (let i = 0; i < count; i++) {
            gpuPlane.setFlightPath(i, controlPoints)
        }
    }
}

// Function to switch between curve types
function switchCurveType(value) {
    const controlPoints = getCurveControlPoints(value)

    // Update curve visualization
    if (gpuCurve) {
        gpuCurve.updateControlPoints(controlPoints)
    }

    // Update all active planes with new curve
    if (gpuPlane) {
        for (let i = 0; i < params.planeCount; i++) {
            gpuPlane.setFlightPath(i, controlPoints)
        }
    }
}

// Start with GPU planes
initializeGPUPlanes()

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

// Animation loop
function animate() {
    requestAnimationFrame(animate)

    const delta = clock.getDelta()

    // Update GPU plane animation
    if (gpuPlane) {
        gpuPlane.update(delta)
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
import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import { Plane } from './Plane.js'
import { GLBPlane } from './GLBPlane.js'
import { SVGPlane } from './SVGPlane.js'
import { Curve } from './Curve.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0xEFEFEF)
document.querySelector('#app').appendChild(renderer.domElement)

// Global variables
let flightCurve
const clock = new THREE.Clock()
let animationTime = 0
let currentPlane = null

// GUI controls
const params = {
    modelType: 'GLB',
    planeSize: 1.0,
    curveType: 'Original'
}

// Setup dat.GUI
const gui = new dat.GUI()
gui.add(params, 'modelType', ['GLB', 'SVG']).name('Model Type').onChange(switchModelType)
gui.add(params, 'planeSize', 0.5, 5.0).name('Plane Size').onChange(updatePlaneSize)
gui.add(params, 'curveType', ['Original', 'Circle']).name('Curve Type').onChange(switchCurveType)

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

// Initialize with GLB plane
async function initializePlane() {
    // Create the flight curve
    const controlPoints = getCurveControlPoints(params.curveType)
    flightCurve = new Curve(scene, { controlPoints })
    flightCurve.create()

    // Create the plane
    currentPlane = new GLBPlane(scene)
    await currentPlane.load()
}

// Function to update plane size
function updatePlaneSize(size) {
    if (currentPlane && currentPlane.getMesh()) {
        currentPlane.setScale(size)
    }
}

// Start with GLB plane
initializePlane()

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


// Function to update plane position and orientation based on curve
function updatePlaneOnCurve(t) {
    if (!currentPlane || !flightCurve || !flightCurve.exists()) return

    // Delegate to the plane's specific implementation
    currentPlane.updatePositionAndOrientation(flightCurve, params.planeSize, t)
}

// Function to switch between curve types
async function switchCurveType(value) {
    // Store current animation time to continue from same position
    const currentTime = animationTime

    // Remove current curve
    if (flightCurve) {
        flightCurve.remove()
        flightCurve = null
    }

    // Create new curve
    const controlPoints = getCurveControlPoints(value)
    flightCurve = new Curve(scene, { controlPoints })
    flightCurve.create()

    // Restore animation time and immediately update position
    animationTime = currentTime
    if (currentPlane && flightCurve && flightCurve.exists()) {
        const t = (animationTime % 1)
        updatePlaneOnCurve(t)
    }
}

// Function to switch between model types
async function switchModelType(value) {
    // Store current animation time to continue from same position
    const currentTime = animationTime

    // Remove current plane
    if (currentPlane) {
        currentPlane.remove()
        currentPlane = null
    }

    if (value === 'GLB') {
        currentPlane = new GLBPlane(scene)
    } else if (value === 'SVG') {
        currentPlane = new SVGPlane(scene)
    }

    if (currentPlane) {
        await currentPlane.load()
    }

    // Restore animation time and immediately update position
    animationTime = currentTime
    if (currentPlane && flightCurve && flightCurve.exists()) {
        const t = (animationTime % 1)
        updatePlaneOnCurve(t)
    }
}

// Motion will be initialized after model loads

// Animation loop
function animate() {
    requestAnimationFrame(animate)

    const delta = clock.getDelta()

    // Update animation time
    animationTime += delta * 0.1 // Adjust speed as needed
    const t = (animationTime % 1) // Loop from 0 to 1

    // Update plane position and orientation
    updatePlaneOnCurve(t)

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
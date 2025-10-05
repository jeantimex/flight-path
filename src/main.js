import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import { Plane } from './Plane.js'
import { GLBPlane } from './GLBPlane.js'
import { SVGPlane } from './SVGPlane.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0xEFEFEF)
document.querySelector('#app').appendChild(renderer.domElement)

// Global variables
let curve
const clock = new THREE.Clock()
let animationTime = 0
let currentPlane = null

// GUI controls
const params = {
    modelType: 'GLB',
    planeSize: 1.0
}

// Setup dat.GUI
const gui = new dat.GUI()
gui.add(params, 'modelType', ['GLB', 'SVG']).name('Model Type').onChange(switchModelType)
gui.add(params, 'planeSize', 0.5, 5.0).name('Plane Size').onChange(updatePlaneSize)

// Initialize with GLB plane
async function initializePlane() {
    currentPlane = new GLBPlane(scene)
    await currentPlane.load()
    motion()
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

// Motion function based on your code
function motion() {
    // Create 3D spline curve using CatmullRomCurve3
    curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1000, -5000, -5000),
        new THREE.Vector3(1000, 0, 0),
        new THREE.Vector3(800, 5000, 5000),
        new THREE.Vector3(-500, 0, 10000)
    ])

    // Get 100 points along the curve
    const points = curve.getPoints(100)

    // Create line geometry for the curve visualization
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4488ff })
    const line = new THREE.Line(lineGeometry, lineMaterial)
    scene.add(line)

    // Create animation timeline
    const times = []
    for (let i = 0; i <= 100; i++) {
        times.push(i)
    }

    // Create position array from curve points
    const posArr = []
    points.forEach(point => {
        posArr.push(point.x, point.y, point.z)
    })


    // We'll handle position and rotation manually in the animation loop
    // Remove the keyframe animation system for better control
    // Create a custom animation approach
}

// Function to update plane position and orientation based on curve
function updatePlaneOnCurve(t) {
    if (!currentPlane || !curve) return

    // Get current position on curve
    const position = curve.getPointAt(t)

    // Get tangent vector at current position (direction of movement)
    const tangent = curve.getTangentAt(t).normalize()

    // Create a proper orientation matrix
    // We want the plane's forward direction to align with the tangent
    const up = new THREE.Vector3(0, 1, 0) // World up vector
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize()
    const newUp = new THREE.Vector3().crossVectors(right, tangent).normalize()

    // Delegate to the plane's specific implementation
    currentPlane.updatePositionAndOrientation(position, tangent, up, right, newUp, params.planeSize)
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

    // Initialize motion with new mesh
    motion()

    // Apply current scale to the new plane
    currentPlane.setScale(params.planeSize)

    // Restore animation time and immediately update position
    animationTime = currentTime
    if (currentPlane && curve) {
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
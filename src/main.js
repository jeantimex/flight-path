import './style.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x111111)
document.querySelector('#app').appendChild(renderer.domElement)

// Global variables
let curve, mesh, mixer
const clock = new THREE.Clock()
const loader = new GLTFLoader()
let animationTime = 0

// Load the plane model
let planeModel = null
loader.load('/src/plane.glb', (gltf) => {
    planeModel = gltf.scene
    planeModel.scale.set(50, 50, 50) // Adjust scale as needed
    scene.add(planeModel)
    mesh = planeModel // Use the plane as the animated mesh

    // Initialize motion after model is loaded
    motion()
}, (progress) => {
    console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%')
}, (error) => {
    console.error('Error loading plane model:', error)
    // Fallback to cube if model fails to load
    const geometry = new THREE.BoxGeometry(100, 100, 100)
    const material = new THREE.MeshBasicMaterial({ color: 0xff6666 })
    mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    motion()
})

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
    if (!mesh || !curve) return

    // Get current position on curve
    const position = curve.getPointAt(t)
    mesh.position.copy(position)

    // Get tangent vector at current position (direction of movement)
    const tangent = curve.getTangentAt(t).normalize()

    // Create a proper orientation matrix
    // We want the plane's forward direction to align with the tangent
    const up = new THREE.Vector3(0, 1, 0) // World up vector
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize()
    const newUp = new THREE.Vector3().crossVectors(right, tangent).normalize()

    // Create rotation matrix
    const rotationMatrix = new THREE.Matrix4()
    rotationMatrix.makeBasis(right, newUp, tangent.clone().negate())

    // Apply rotation to the mesh
    mesh.setRotationFromMatrix(rotationMatrix)

    // Additional rotation adjustment if needed (depends on your plane model's orientation)
    // You might need to adjust these values based on how your plane is oriented in the .glb file
    mesh.rotateY(Math.PI) // Rotate 180 degrees around Y if plane faces wrong direction
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
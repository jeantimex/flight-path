import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import { GPUFlight } from './GPUFlight.js'
import { MergedGPUCurves } from './MergedGPUCurves.js'
import { MergedGPUPanes } from './MergedGPUPanes.js'
import { FlightUtils } from './FlightUtils.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0xEFEFEF)
document.querySelector('#app').appendChild(renderer.domElement)

// Global variables
let flights = []
let mergedCurves = null
let mergedPanes = null
const clock = new THREE.Clock()
const MAX_FLIGHTS = 30000
let preGeneratedConfigs = []

// GUI controls
const params = {
    numFlights: 1,
    curveType: 'Original',
    lineWidth: 2.0,
    segmentCount: 100,
    curveColor: 0x4488ff,
    planeSize: 100,
    planeColor: 0xff6666,
    animationSpeed: 0.1,
    tiltMode: 'Perpendicular'
}

// Pre-generate flight configurations for stability
function preGenerateFlightConfigs() {
    console.log(`Pre-generating ${MAX_FLIGHTS} flight configurations...`)
    preGeneratedConfigs = []

    for (let i = 0; i < MAX_FLIGHTS; i++) {
        const config = FlightUtils.generateRandomFlightConfig({
            segmentCount: params.segmentCount,
            tiltMode: params.tiltMode
        })
        preGeneratedConfigs.push(config)
    }

    console.log('Flight configurations ready!')
}

// Regenerate all pre-generated configs (for when curve type changes)
function regenerateFlightConfigs() {
    preGenerateFlightConfigs()
    initializeFlights()
}

// Setup dat.GUI
const gui = new dat.GUI()
gui.add(params, 'numFlights', 1, MAX_FLIGHTS).step(1).name('Number of Flights').onChange(updateFlightCount)
gui.add(params, 'curveType', ['Original', 'Circle', 'Random']).name('Curve Type').onChange(switchCurveType)
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
    } else if (type === 'Random') {
        return FlightUtils.generateRandomCurve()
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

// Create a single flight from config
function createFlightFromConfig(config, flightIndex) {
    // Add merged renderers and indices to config
    const flightConfig = {
        ...config,
        mergedCurves: mergedCurves,
        curveIndex: flightIndex,
        mergedPanes: mergedPanes,
        paneIndex: flightIndex
    }
    const flight = new GPUFlight(scene, flightConfig)
    flight.create()
    return flight
}

// Initialize all flights (full reset)
function initializeFlights() {
    // Clear existing flights
    flights.forEach(flight => flight.remove())
    flights = []

    // Remove old merged renderers if they exist
    if (mergedCurves) {
        mergedCurves.remove()
    }
    if (mergedPanes) {
        mergedPanes.remove()
    }

    // Create new merged curves renderer
    mergedCurves = new MergedGPUCurves(scene, {
        maxCurves: MAX_FLIGHTS,
        segmentsPerCurve: params.segmentCount,
        lineWidth: params.lineWidth
    })

    // Create new merged panes renderer
    mergedPanes = new MergedGPUPanes(scene, {
        maxPanes: MAX_FLIGHTS,
        baseSize: params.planeSize
    })

    if (params.curveType === 'Random' || params.numFlights > 1) {
        // Use pre-generated random configs
        for (let i = 0; i < params.numFlights; i++) {
            const config = preGeneratedConfigs[i % preGeneratedConfigs.length]
            const flight = createFlightFromConfig(config, i)
            flights.push(flight)
        }
    } else {
        // Single flight with GUI parameters
        const controlPoints = getCurveControlPoints(params.curveType)
        const config = {
            controlPoints,
            segmentCount: params.segmentCount,
            lineWidth: params.lineWidth,
            curveColor: params.curveColor,
            paneCount: 1,
            paneSize: params.planeSize,
            paneColor: params.planeColor,
            animationSpeed: params.animationSpeed,
            tiltMode: params.tiltMode
        }
        const flight = createFlightFromConfig(config, 0)
        flights.push(flight)
    }

    // Update visible counts in merged renderers
    mergedCurves.setVisibleCurveCount(flights.length)
    mergedPanes.setActivePaneCount(flights.length)
}

// Update flight count (preserves existing flights)
function updateFlightCount(count) {
    const oldCount = flights.length
    params.numFlights = count

    if (count > oldCount) {
        // Add new flights (starting from the beginning)
        if (params.curveType === 'Random' || count > 1) {
            for (let i = oldCount; i < count; i++) {
                const config = preGeneratedConfigs[i % preGeneratedConfigs.length]
                const flight = createFlightFromConfig(config, i)
                flights.push(flight)
            }
        }
    } else if (count < oldCount) {
        // Remove excess flights
        const flightsToRemove = flights.splice(count)
        flightsToRemove.forEach(flight => flight.remove())
    }

    // Update visible counts in merged renderers
    if (mergedCurves) {
        mergedCurves.setVisibleCurveCount(flights.length)
    }
    if (mergedPanes) {
        mergedPanes.setActivePaneCount(flights.length)
    }
}

// Function to update curve color
function updateCurveColor(color) {
    flights.forEach(flight => flight.setCurveColor(color))
    // Apply batched updates to merged curves
    if (mergedCurves) {
        mergedCurves.applyUpdates()
    }
}

// Function to update line width
function updateLineWidth(width) {
    // Note: Line width is global in merged curves
    // Would need to recreate merged curves to change it
    console.log('Line width change requires recreating curves. Use segment count or colors for dynamic changes.')
}

// Function to update segment count
function updateSegmentCount(count) {
    // Note: Segment count is global in merged curves
    // Need to recreate all curves
    params.segmentCount = count
    initializeFlights()
}

// Function to update plane size
function updatePlaneSize(size) {
    flights.forEach(flight => flight.setPaneSize(size))
    // Apply updates to merged panes
    if (mergedPanes && mergedPanes.geometry && mergedPanes.geometry.attributes.instanceScale) {
        mergedPanes.geometry.attributes.instanceScale.needsUpdate = true
    }
}

// Function to update plane color
function updatePlaneColor(color) {
    flights.forEach(flight => flight.setPaneColor(color))
    // Apply updates to merged panes
    if (mergedPanes && mergedPanes.geometry && mergedPanes.geometry.attributes.instanceColor) {
        mergedPanes.geometry.attributes.instanceColor.needsUpdate = true
    }
}

// Pre-generate all flight configurations on startup
preGenerateFlightConfigs()

// Initialize the flights
initializeFlights()

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
    if (value === 'Random') {
        // Regenerate random configs when switching to Random
        regenerateFlightConfigs()
    } else {
        // Just reinitialize with new curve type
        initializeFlights()
    }
}

// Animation loop
function animate() {
    requestAnimationFrame(animate)

    const delta = clock.getDelta()

    // Update all flights
    flights.forEach(flight => {
        flight.setAnimationSpeed(params.animationSpeed)
        flight.setTiltMode(params.tiltMode)
        flight.update(delta)
    })

    // Apply any pending updates to merged curves
    if (mergedCurves) {
        mergedCurves.applyUpdates()
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

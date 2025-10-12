import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import Stats from 'stats.js'
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

// Setup Stats.js for performance monitoring
const stats = new Stats()
stats.showPanel(0) // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom)

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
gui.add(params, 'animationSpeed', 0.01, 0.5).name('Animation Speed').onChange((value) => {
    flights.forEach(flight => flight.setAnimationSpeed(value))
})
gui.add(params, 'tiltMode', ['Perpendicular', 'Tangent']).name('Tilt Mode').onChange((value) => {
    flights.forEach(flight => flight.setTiltMode(value))
})

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

    // Set initial animation speed and tilt mode
    flight.setAnimationSpeed(params.animationSpeed)
    flight.setTiltMode(params.tiltMode)

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
            // Override paneSize and paneColor with current GUI values
            const flightConfig = {
                ...config,
                paneSize: params.planeSize,
                paneColor: params.planeColor
            }
            const flight = createFlightFromConfig(flightConfig, i)
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
                // Override paneSize with current GUI value
                const flightConfig = {
                    ...config,
                    paneSize: params.planeSize,
                    paneColor: params.planeColor
                }
                const flight = createFlightFromConfig(flightConfig, i)
                flights.push(flight)
            }
            // Apply batched updates immediately after creating flights
            if (mergedCurves) {
                mergedCurves.applyUpdates()
            }
            if (mergedPanes) {
                mergedPanes.applyUpdates()
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
    // Updates will be applied in animation loop via applyUpdates()
}

// Function to update plane color
function updatePlaneColor(color) {
    flights.forEach(flight => flight.setPaneColor(color))
    // Updates will be applied in animation loop via applyUpdates()
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

// Performance profiling (toggle with 'p' key)
let enableProfiling = false
const perfStats = {
    flightUpdates: 0,
    mergedUpdates: 0,
    controlsUpdate: 0,
    render: 0,
    total: 0
}

// Toggle profiling with 'p' key
window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        enableProfiling = !enableProfiling
        console.log(`Performance profiling ${enableProfiling ? 'ENABLED' : 'DISABLED'}`)
        if (enableProfiling) {
            console.log('Press P again to see stats and disable profiling')
        }
    }
})

// Animation loop
function animate() {
    requestAnimationFrame(animate)

    stats.begin() // Begin measuring

    const delta = clock.getDelta()
    let t0, t1

    // Update all flights
    if (enableProfiling) t0 = performance.now()
    // Note: setAnimationSpeed and setTiltMode are now called only when params change (see GUI onChange handlers)
    // This removes 60,000 redundant function calls per frame with 30,000 flights!
    flights.forEach(flight => {
        flight.update(delta)
    })
    if (enableProfiling) {
        t1 = performance.now()
        perfStats.flightUpdates += (t1 - t0)
    }

    // Apply any pending updates to merged renderers
    if (enableProfiling) t0 = performance.now()
    if (mergedCurves) {
        mergedCurves.applyUpdates()
    }
    if (mergedPanes) {
        mergedPanes.applyUpdates()
    }
    if (enableProfiling) {
        t1 = performance.now()
        perfStats.mergedUpdates += (t1 - t0)
    }

    // Update controls
    if (enableProfiling) t0 = performance.now()
    controls.update()
    if (enableProfiling) {
        t1 = performance.now()
        perfStats.controlsUpdate += (t1 - t0)
    }

    // Render
    if (enableProfiling) t0 = performance.now()
    renderer.render(scene, camera)
    if (enableProfiling) {
        t1 = performance.now()
        perfStats.render += (t1 - t0)
        perfStats.total++

        // Log stats every 60 frames
        if (perfStats.total % 60 === 0) {
            const frames = perfStats.total
            console.log('=== Performance Stats (avg per frame) ===')
            console.log(`Flight Updates: ${(perfStats.flightUpdates / frames).toFixed(2)}ms (${flights.length} flights)`)
            console.log(`Merged Updates: ${(perfStats.mergedUpdates / frames).toFixed(2)}ms`)
            console.log(`Controls Update: ${(perfStats.controlsUpdate / frames).toFixed(2)}ms`)
            console.log(`Render: ${(perfStats.render / frames).toFixed(2)}ms`)
            console.log(`Total per frame: ${((perfStats.flightUpdates + perfStats.mergedUpdates + perfStats.controlsUpdate + perfStats.render) / frames).toFixed(2)}ms`)
            console.log(`Target: 16.67ms (60 FPS)`)
        }
    }

    stats.end() // End measuring
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// Start animation
animate()

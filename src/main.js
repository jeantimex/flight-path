import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import Stats from 'stats.js'
import { Flight } from './Flight.js'
import { Curves } from './Curves.js'
import { PanesShader } from './PanesShader.js'
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

const textureLoader = new THREE.TextureLoader()
let svgTexture = null
let svgTexturePromise = null

// GUI controls
const params = {
    numFlights: 1,
    segmentCount: 100,
    curveColor: 0x4488ff,
    planeSize: 100,
    planeColor: 0xff6666,
    animationSpeed: 0.1,
    tiltMode: 'Perpendicular',
    paneStyle: 'Pane',
    dashSize: 40,
    gapSize: 40,
    randomCurveColor: false,
    randomPaneColor: false
}

// Pre-generate flight configurations for stability
function preGenerateFlightConfigs() {
    preGeneratedConfigs = []

    for (let i = 0; i < MAX_FLIGHTS; i++) {
        const config = FlightUtils.generateRandomFlightConfig({
            segmentCount: params.segmentCount,
            tiltMode: params.tiltMode,
            numControlPoints: 2
        })
        config.controlPoints = normalizeControlPoints(config.controlPoints)
        config._randomPaneColor = false
        preGeneratedConfigs.push(config)
    }
}

// Setup dat.GUI
const gui = new dat.GUI()
gui.add(params, 'numFlights', 1, MAX_FLIGHTS).step(1).name('Number of Flights').onChange(updateFlightCount)
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
gui.add(params, 'paneStyle', ['Pane', 'SVG']).name('Pane Style').onChange(updatePaneStyle)
gui.add(params, 'dashSize', 0, 2000).name('Dash Length').onChange(updateDashPattern)
gui.add(params, 'gapSize', 0, 2000).name('Dash Gap').onChange(updateDashPattern)
gui.add(params, 'randomCurveColor').name('Random Curve Color').onChange(() => {
    applyCurveColorMode()
})
gui.add(params, 'randomPaneColor').name('Random Pane Color').onChange(() => {
    applyPaneColorMode()
})

function normalizeControlPoints(points) {
    const sourcePoints = points && points.length ? cloneControlPoints(points) : []
    if (sourcePoints.length === 4) {
        return sourcePoints
    }

    const curve = new THREE.CatmullRomCurve3(sourcePoints)
    return [
        curve.getPoint(0.0),
        curve.getPoint(0.333),
        curve.getPoint(0.666),
        curve.getPoint(1.0)
    ]
}

function resolveCurveColor(config = {}) {
    if (params.randomCurveColor) {
        if (!config.curveColor) {
            config.curveColor = FlightUtils.generateRandomColor()
        }
        return config.curveColor
    }
    return params.curveColor
}

function applyCurveColorMode() {
    flights.forEach((flight, index) => {
        const config = preGeneratedConfigs[index] || {}
        const color = params.randomCurveColor ? resolveCurveColor(config) : params.curveColor
        flight.setCurveColor(color)
    })

    if (mergedCurves) {
        mergedCurves.applyUpdates()
    }
}

function resolvePaneColor(config = {}) {
    if (params.randomPaneColor) {
        if (!config._randomPaneColor) {
            config.paneColor = FlightUtils.generateRandomColor()
            config._randomPaneColor = true
        }
        return config.paneColor
    }

    config._randomPaneColor = false
    config.paneColor = params.planeColor
    return config.paneColor
}

function applyPaneColorMode() {
    flights.forEach((flight, index) => {
        const config = preGeneratedConfigs[index] || {}
        const color = resolvePaneColor(config)
        flight.setPaneColor(color)
    })
}

function loadSvgTexture() {
    if (svgTexture) {
        return Promise.resolve(svgTexture)
    }

    if (svgTexturePromise) {
        return svgTexturePromise
    }

    svgTexturePromise = new Promise((resolve, reject) => {
        textureLoader.load('/src/plane8.svg', (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace
            texture.generateMipmaps = true
            texture.needsUpdate = true
            svgTexture = texture
            resolve(svgTexture)
        }, undefined, (error) => {
            console.error('Failed to load SVG texture:', error)
            svgTexturePromise = null
            reject(error)
        })
    })

    return svgTexturePromise
}

function applyPaneTexture() {
    if (!mergedPanes || typeof mergedPanes.setTexture !== 'function') return

    if (params.paneStyle === 'SVG') {
        if (svgTexture) {
            mergedPanes.setTexture(svgTexture)
        } else {
            mergedPanes.setTexture(null)
            loadSvgTexture().then((texture) => {
                if (params.paneStyle === 'SVG' && mergedPanes) {
                    mergedPanes.setTexture(texture)
                }
            }).catch(() => {})
        }
    } else {
        mergedPanes.setTexture(null)
    }
}

const curveActions = {
    randomizeCurve() {
        randomizeAllFlightCurves()
    }
}
gui.add(curveActions, 'randomizeCurve').name('Randomize All Curves')

function cloneControlPoints(points) {
    return points.map(point => point.clone())
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
    const flight = new Flight(scene, flightConfig)
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
    mergedCurves = new Curves(scene, {
        maxCurves: MAX_FLIGHTS,
        segmentsPerCurve: params.segmentCount,
        dashSize: params.dashSize,
        gapSize: params.gapSize
    })

    // Create new merged panes renderer (GPU Shader)
    mergedPanes = new PanesShader(scene, {
        maxPanes: MAX_FLIGHTS,
        baseSize: params.planeSize
    })

    updateDashPattern()
    applyPaneTexture()

    for (let i = 0; i < params.numFlights; i++) {
        const baseConfig = preGeneratedConfigs[i % preGeneratedConfigs.length] || FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 })
        const flightConfig = {
            ...baseConfig,
            controlPoints: normalizeControlPoints(baseConfig.controlPoints),
            segmentCount: params.segmentCount,
            curveColor: resolveCurveColor(baseConfig),
            paneSize: params.planeSize,
            paneColor: resolvePaneColor(baseConfig)
        }
        const flight = createFlightFromConfig(flightConfig, i)
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
        if (count > 1) {
            for (let i = oldCount; i < count; i++) {
                const baseConfig = preGeneratedConfigs[i % preGeneratedConfigs.length] || FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 })
                const flightConfig = {
                    ...baseConfig,
                    controlPoints: normalizeControlPoints(baseConfig.controlPoints),
                    segmentCount: params.segmentCount,
                    curveColor: resolveCurveColor(baseConfig),
                    paneSize: params.planeSize,
                    paneColor: resolvePaneColor(baseConfig)
                }
                const flight = createFlightFromConfig(flightConfig, i)
                flights.push(flight)
            }
            // Apply batched updates immediately after creating flights
            if (mergedCurves) {
                mergedCurves.applyUpdates()
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
    if (params.randomCurveColor) {
        params.curveColor = color
        return
    }

    flights.forEach(flight => flight.setCurveColor(color))
    // Apply batched updates to merged curves
    if (mergedCurves) {
        mergedCurves.applyUpdates()
    }
}

// Function to update segment count
function updateSegmentCount(count) {
    // Note: Segment count is global in merged curves
    // Need to recreate all curves
    params.segmentCount = count
    preGenerateFlightConfigs()
    initializeFlights()
}

// Function to update plane size
function updatePlaneSize(size) {
    flights.forEach(flight => flight.setPaneSize(size))
    // Updates will be applied in animation loop via applyUpdates()
}

// Function to update plane color
function updatePlaneColor(color) {
    params.planeColor = color

    if (params.randomPaneColor) {
        return
    }

    applyPaneColorMode()
}

function updateDashPattern() {
    if (mergedCurves) {
        mergedCurves.setDashPattern(params.dashSize, params.gapSize)
        mergedCurves.applyUpdates()
    }
}

function updatePaneStyle() {
    if (params.paneStyle === 'SVG') {
        loadSvgTexture().catch(() => {})
    }
    initializeFlights()
}

function randomizeAllFlightCurves() {
    flights.forEach((flight, index) => {
        const randomConfig = FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 })
        const normalizedPoints = normalizeControlPoints(randomConfig.controlPoints)

        const existingConfig = preGeneratedConfigs[index] || {}
        const updatedConfig = {
            ...existingConfig,
            ...randomConfig,
            controlPoints: normalizedPoints,
            segmentCount: params.segmentCount,
            curveColor: randomConfig.curveColor,
        }
        updatedConfig._randomPaneColor = params.randomPaneColor
        preGeneratedConfigs[index] = updatedConfig

        flight.setControlPoints(normalizedPoints)
        const curveColor = resolveCurveColor(updatedConfig)
        flight.setCurveColor(curveColor)
        const paneColor = resolvePaneColor(updatedConfig)
        flight.setPaneColor(paneColor)
    })

    if (mergedCurves) {
        mergedCurves.applyUpdates()
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

    // GPU Shader mode: Only update the time uniform (no per-flight work!)
    if (mergedPanes) {
        mergedPanes.update(delta)
    }

    if (enableProfiling) {
        t1 = performance.now()
        perfStats.flightUpdates += (t1 - t0)
    }

    // Apply any pending updates to merged renderers
    if (enableProfiling) t0 = performance.now()
    if (mergedCurves) {
        mergedCurves.applyUpdates()
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
            // Logging removed intentionally to keep console clean.
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

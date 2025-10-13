import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import Stats from 'stats.js'
import { Flight } from './Flight.js'
import { Curves } from './Curves.js'
import { PanesShader } from './PanesShader.js'
import { FlightUtils } from './FlightUtils.js'
import { Stars } from './Stars.js'
import { Earth } from './Earth.js'
import { Controls } from './Controls.js'
import { getSunVector3, getCurrentUtcTimeHours, animateCameraToPosition, vector3ToLatLng, hoursToTimeString } from './Utils.js'

// Scene setup
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x000000)
document.querySelector('#app').appendChild(renderer.domElement)

// Setup Stats.js for performance monitoring
const stats = new Stats()
stats.showPanel(0) // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom)
stats.dom.style.display = 'none'
stats.dom.style.position = 'absolute'
stats.dom.style.left = '0px'
stats.dom.style.top = '0px'

// Global variables
let flights = []
let mergedCurves = null
let mergedPanes = null
let stars = null
let earth = null
let initialCameraPositioned = false
const clock = new THREE.Clock()
const MAX_FLIGHTS = 30000
let preGeneratedConfigs = []
let loadingScreenCreated = false
let minLoadingTimeoutId = null

const textureLoader = new THREE.TextureLoader()
const PLANE_TEXTURE_URL = `${import.meta.env.BASE_URL || '/'}plane8.svg`
let svgTexture = null
let svgTexturePromise = null
let loadingScreenElement = null
let footerCoordinatesElement = null
let controlsManager = null
let guiControls = null

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
    randomPaneColor: false,
    randomSpeed: false,
    returnFlight: false
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
        config._randomSpeed = typeof config.animationSpeed === 'number' ? config.animationSpeed : undefined
        config.returnFlight = params.returnFlight
        preGeneratedConfigs.push(config)
    }
}

function createLoadingScreen() {
    if (loadingScreenCreated) return
    loadingScreenCreated = true

    const loadingDiv = document.createElement('div')
    loadingDiv.id = 'loading-screen'
    loadingDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #000000;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
    `

    const spinner = document.createElement('div')
    spinner.style.cssText = `
        width: 50px;
        height: 50px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top: 3px solid #58a6ff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    `

    const style = document.createElement('style')
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `
    document.head.appendChild(style)

    loadingDiv.appendChild(spinner)
    document.body.appendChild(loadingDiv)
    loadingScreenElement = loadingDiv
}

function hideUIElementsDuringLoading() {
    document.querySelectorAll('.dg.ac').forEach(container => {
        container.style.display = 'none'
    })
    stats.dom.style.display = 'none'
    if (footerCoordinatesElement) {
        footerCoordinatesElement.style.display = 'none'
    }
}

function showUIElementsAfterLoading() {
    document.querySelectorAll('.dg.ac').forEach(container => {
        container.style.display = 'block'
    })
    stats.dom.style.display = 'block'

    if (footerCoordinatesElement) {
        footerCoordinatesElement.style.display = 'block'
    }
}

function removeLoadingScreen() {
    if (!loadingScreenElement) return
    loadingScreenElement.style.opacity = '0'
    loadingScreenElement.style.transition = 'opacity 0.5s ease-out'
    setTimeout(() => {
        loadingScreenElement?.remove()
        loadingScreenElement = null
        showUIElementsAfterLoading()
    }, 500)
}

function checkReadyToStart() {
    if (window.earthTextureLoaded && window.minTimeElapsed) {
        setInitialCameraPosition()
    }
}

function createFooter() {
    const existing = document.getElementById('app-footer')
    if (existing) {
        footerCoordinatesElement = existing.querySelector('#coordinates')
        if (footerCoordinatesElement) {
            footerCoordinatesElement.style.display = 'none'
        }
        return
    }

    const footer = document.createElement('div')
    footer.id = 'app-footer'
    footer.style.cssText = `
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 40px;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        color: white;
        font-family: Arial, sans-serif;
        font-size: 14px;
        z-index: 10000;
        pointer-events: none;
    `

    footer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; pointer-events: auto;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width: 16px; height: 16px; fill: white;">
                <path d="M173.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3 .3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5 .3-6.2 2.3zm44.2-1.7c-2.9 .7-4.9 2.6-4.6 4.9 .3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM252.8 8c-138.7 0-244.8 105.3-244.8 244 0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1 100-33.2 167.8-128.1 167.8-239 0-138.7-112.5-244-251.2-244zM105.2 352.9c-1.3 1-1 3.3 .7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3 .3 2.9 2.3 3.9 1.6 1 3.6 .7 4.3-.7 .7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3 .7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3 .7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9s4.3 3.3 5.6 2.3c1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"/>
            </svg>
            <span>Made by</span>
            <a href="https://github.com/jeantimex/flight-path" target="_blank" rel="noopener noreferrer"
               style="color: #58a6ff; text-decoration: none; font-weight: 500;">
                jeantimex
            </a>
        </div>
        <div id="coordinates" style="pointer-events: none; font-family: monospace; font-size: 12px; opacity: 0.8; display: none;">
            Lat: 0.00°, Lng: 0.00°
        </div>
    `

    document.body.appendChild(footer)
    footerCoordinatesElement = footer.querySelector('#coordinates')
    if (footerCoordinatesElement) {
        footerCoordinatesElement.style.display = 'none'
    }
}

function updateCoordinateDisplay() {
    if (!footerCoordinatesElement || !camera || !earth) return

    const direction = new THREE.Vector3(0, 0, 0).sub(camera.position).normalize()
    const surfacePoint = direction.clone().multiplyScalar(earth.getRadius())
    const coords = vector3ToLatLng(surfacePoint, earth.getRadius())

    footerCoordinatesElement.textContent = `Lat: ${coords.lat.toFixed(2)}°, Lng: ${coords.lng.toFixed(2)}°`
}

// Setup dat.GUI
const gui = new dat.GUI()
gui.add(params, 'numFlights', 1, MAX_FLIGHTS).step(1).name('Number of Flights').onChange(updateFlightCount)
gui.add(params, 'segmentCount', 50, 500).step(50).name('Segments').onChange(updateSegmentCount)
gui.addColor(params, 'curveColor').name('Curve Color').onChange(updateCurveColor)
gui.add(params, 'planeSize', 50, 500).name('Plane Size').onChange(updatePlaneSize)
gui.addColor(params, 'planeColor').name('Plane Color').onChange(updatePlaneColor)
gui.add(params, 'animationSpeed', 0.01, 0.5).name('Animation Speed').onChange(() => {
    applyAnimationSpeedMode()
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
gui.add(params, 'randomSpeed').name('Random Speed').onChange(() => {
    applyAnimationSpeedMode()
})
gui.add(params, 'returnFlight').name('Return Flight').onChange(() => {
    applyReturnMode()
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

function generateRandomSpeed() {
    return THREE.MathUtils.randFloat(0.03, 0.25)
}

function resolveAnimationSpeed(config = {}) {
    if (params.randomSpeed) {
        if (typeof config._randomSpeed !== 'number') {
            const base = typeof config.animationSpeed === 'number'
                ? config.animationSpeed
                : generateRandomSpeed()
            config._randomSpeed = base
        }
        return config._randomSpeed
    }
    return params.animationSpeed
}

function applyAnimationSpeedMode() {
    flights.forEach((flight, index) => {
        const config = preGeneratedConfigs[index] || {}
        const speed = resolveAnimationSpeed(config)
        flight.setAnimationSpeed(speed)
    })
}

function toggleAtmosphereEffect(enabled) {
    if (earth && earth.atmosphere) {
        earth.atmosphere.mesh.visible = enabled
    }
}

function toggleDayNightEffect(enabled) {
    if (enabled) {
        updateLighting()
    } else {
        directionalLight.intensity = 0.5
        ambientLight.intensity = 1.2
    }
}

function updateLighting() {
    if (!guiControls) return
    if (guiControls.dayNightEffect) {
        directionalLight.intensity = guiControls.dayBrightness
        ambientLight.intensity = guiControls.nightBrightness
    }
}

function setupGlobalControls() {
    controlsManager = new Controls()

    controlsManager.setup({
        onDayNightEffectChange: toggleDayNightEffect,
        onAtmosphereEffectChange: toggleAtmosphereEffect,
        onResetSunPosition: () => {
            directionalLight.position.set(0, 1000, 1000)
            updateSunPosition()
        },
        onDayBrightnessChange: updateLighting,
        onNightBrightnessChange: updateLighting,
        onRealTimeSunChange: (value) => {
            if (value) {
                const currentUtc = getCurrentUtcTimeHours()
                guiControls.simulatedTime = currentUtc
                guiControls.timeDisplay = hoursToTimeString(currentUtc)
                const { timeDisplay, timeSlider } = controlsManager.controllers || {}
                if (timeDisplay) timeDisplay.updateDisplay()
                if (timeSlider) timeSlider.updateDisplay()
            }
        },
        onTimeSliderChange: (value) => {
            guiControls.simulatedTime = value
            guiControls.timeDisplay = hoursToTimeString(value)
            const { timeDisplay, realTimeSun } = controlsManager.controllers || {}
            if (timeDisplay) timeDisplay.updateDisplay()
            if (guiControls.realTimeSun) {
                guiControls.realTimeSun = false
                if (realTimeSun) realTimeSun.updateDisplay()
            }
        },
        onTimeDisplayChange: (value) => {
            guiControls.timeDisplay = value
        }
    })

    guiControls = controlsManager.getControls()
    window.guiControlsInstance = controlsManager

    document.querySelectorAll('.dg.ac').forEach(container => {
        container.style.display = 'none'
    })

    toggleAtmosphereEffect(guiControls.atmosphereEffect)
    toggleDayNightEffect(guiControls.dayNightEffect)
}

function applyReturnMode() {
    preGeneratedConfigs.forEach((config, index) => {
        if (!config) return
        config.returnFlight = params.returnFlight
    })

    flights.forEach(flight => {
        flight.setReturnFlight(params.returnFlight)
    })

    if (mergedPanes && typeof mergedPanes.setReturnMode === 'function') {
        mergedPanes.setReturnMode(params.returnFlight)
    }
}

function updateSunPosition() {
    if (!directionalLight) return

    const radius = earth ? earth.getRadius() : 3000

    if (guiControls) {
        if (guiControls.realTimeSun) {
            const currentUtc = getCurrentUtcTimeHours()
            guiControls.simulatedTime = currentUtc
            guiControls.timeDisplay = hoursToTimeString(currentUtc)
            if (controlsManager && controlsManager.controllers) {
                const { timeDisplay, timeSlider } = controlsManager.controllers
                if (timeDisplay) timeDisplay.updateDisplay()
                if (timeSlider) timeSlider.updateDisplay()
            }
        }

        if (guiControls.dayNightEffect) {
            const sunVector = getSunVector3(radius, guiControls.simulatedTime)
            directionalLight.position.copy(sunVector)
        }

        updateLighting()
    } else {
        const sunVector = getSunVector3(radius, getCurrentUtcTimeHours())
        directionalLight.position.copy(sunVector)
    }

    directionalLight.lookAt(0, 0, 0)
    updateCoordinateDisplay()
}

function setInitialCameraPosition() {
    if (!earth || initialCameraPositioned) return

    const radius = earth.getRadius()
    const sunPos = getSunVector3(radius, getCurrentUtcTimeHours())
    const sunDirection = sunPos.clone().normalize()

    const angle = THREE.MathUtils.degToRad(70)
    const rotatedDirection = new THREE.Vector3(
        sunDirection.x * Math.cos(angle) + sunDirection.z * Math.sin(angle),
        sunDirection.y,
        -sunDirection.x * Math.sin(angle) + sunDirection.z * Math.cos(angle)
    )

    const targetDistance = radius * 2.1
    const targetPosition = rotatedDirection.multiplyScalar(targetDistance)
    const startPosition = targetPosition.clone().multiplyScalar(1.25)

    camera.position.copy(startPosition)
    camera.lookAt(0, 0, 0)
    animateCameraToPosition(camera, startPosition, targetPosition, 3000, 500)

    initialCameraPositioned = true

    removeLoadingScreen()
}

function loadSvgTexture() {
    if (svgTexture) {
        return Promise.resolve(svgTexture)
    }

    if (svgTexturePromise) {
        return svgTexturePromise
    }

    svgTexturePromise = new Promise((resolve, reject) => {
        textureLoader.load(PLANE_TEXTURE_URL, (texture) => {
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
    flight.setAnimationSpeed(flightConfig.animationSpeed !== undefined ? flightConfig.animationSpeed : params.animationSpeed)
    flight.setTiltMode(params.tiltMode)
    flight.setReturnFlight(flightConfig.returnFlight)

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
        baseSize: params.planeSize,
        returnMode: params.returnFlight
    })

    updateDashPattern()
    applyPaneTexture()

    for (let i = 0; i < params.numFlights; i++) {
        const baseConfig = preGeneratedConfigs[i % preGeneratedConfigs.length] || FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 })
        baseConfig.returnFlight = params.returnFlight
        const flightConfig = {
            ...baseConfig,
            controlPoints: normalizeControlPoints(baseConfig.controlPoints),
            segmentCount: params.segmentCount,
            curveColor: resolveCurveColor(baseConfig),
            paneSize: params.planeSize,
            paneColor: resolvePaneColor(baseConfig),
            animationSpeed: resolveAnimationSpeed(baseConfig),
            returnFlight: params.returnFlight
        }
        const flight = createFlightFromConfig(flightConfig, i)
        flights.push(flight)
    }

    // Update visible counts in merged renderers
    mergedCurves.setVisibleCurveCount(flights.length)
    mergedPanes.setActivePaneCount(flights.length)

    applyReturnMode()
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
                baseConfig.returnFlight = params.returnFlight
                const flightConfig = {
                    ...baseConfig,
                    controlPoints: normalizeControlPoints(baseConfig.controlPoints),
                    segmentCount: params.segmentCount,
                    curveColor: resolveCurveColor(baseConfig),
                    paneSize: params.planeSize,
                    paneColor: resolvePaneColor(baseConfig),
                    animationSpeed: resolveAnimationSpeed(baseConfig),
                    returnFlight: params.returnFlight
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
        updatedConfig._randomSpeed = params.randomSpeed ? randomConfig.animationSpeed : undefined
        updatedConfig.returnFlight = params.returnFlight
        preGeneratedConfigs[index] = updatedConfig

        flight.setControlPoints(normalizedPoints)
        const curveColor = resolveCurveColor(updatedConfig)
        flight.setCurveColor(curveColor)
        const paneColor = resolvePaneColor(updatedConfig)
        flight.setPaneColor(paneColor)
        const speed = resolveAnimationSpeed(updatedConfig)
        flight.setAnimationSpeed(speed)
        flight.setReturnFlight(params.returnFlight)
    })

    if (mergedCurves) {
        mergedCurves.applyUpdates()
    }
}

// Pre-generate all flight configurations on startup
preGenerateFlightConfigs()

// Initialize the flights
initializeFlights()

// Add stars background
stars = new Stars(5000, 10000, 20000)
stars.addToScene(scene)

// Add Earth with atmosphere
earth = new Earth(3000, () => {
    window.earthTextureLoaded = true
    checkReadyToStart()
})
earth.addToScene(scene)

// Add lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.35)
scene.add(ambientLight)
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0)
directionalLight.position.set(1000, 1000, 1000)
directionalLight.target.position.set(0, 0, 0)
scene.add(directionalLight.target)
scene.add(directionalLight)

setupGlobalControls()
updateLighting()
updateSunPosition()
window.earthTextureLoaded = false
window.minTimeElapsed = false
createLoadingScreen()
createFooter()
hideUIElementsDuringLoading()
minLoadingTimeoutId = setTimeout(() => {
    window.minTimeElapsed = true
    checkReadyToStart()
}, 2000)

// Position camera
camera.position.set(0, 2000, 8000)
camera.lookAt(0, 0, 0)

// Setup OrbitControls
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.screenSpacePanning = false
controls.minDistance = 3200
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

    if (stars) {
        stars.update(delta)
    }

    updateSunPosition()
    updateCoordinateDisplay()

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

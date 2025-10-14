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
import { flights as dataFlights } from './Data.js'
import { planes as planeDefinitions } from './Planes.js'
import { getSunVector3, getCurrentUtcTimeHours, animateCameraToPosition, vector3ToLatLng, hoursToTimeString, latLngToVector3 } from './Utils.js'

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
const DATA_FLIGHT_COUNT = Array.isArray(dataFlights) ? dataFlights.length : 0
const MAX_FLIGHTS = DATA_FLIGHT_COUNT > 0 ? DATA_FLIGHT_COUNT : 30000
const EARTH_RADIUS = 3000
let preGeneratedConfigs = []
let loadingScreenCreated = false
let minLoadingTimeoutId = null

const DEFAULT_PLANE_COLOR = 0xff6666
const FALLBACK_PLANE_COUNT = 8

function parseHexColor(colorValue, fallback = DEFAULT_PLANE_COLOR) {
    if (typeof colorValue === 'number' && Number.isFinite(colorValue)) {
        return colorValue
    }
    if (typeof colorValue === 'string') {
        const normalized = colorValue.trim().replace(/^#/, '')
        if (normalized.length > 0) {
            const parsed = parseInt(normalized, 16)
            if (!Number.isNaN(parsed)) {
                return parsed
            }
        }
    }
    return fallback
}

const planeEntries = Array.isArray(planeDefinitions) && planeDefinitions.length > 0
    ? planeDefinitions.map((plane, index) => ({
        ...plane,
        atlasIndex: index
    }))
    : Array.from({ length: FALLBACK_PLANE_COUNT }, (_, index) => ({
        name: `plane${index + 1}`,
        svg: `plane${index + 1}.svg`,
        color: `#${DEFAULT_PLANE_COLOR.toString(16).padStart(6, '0')}`,
        atlasIndex: index
    }))

const PLANE_SVG_COUNT = planeEntries.length
const INITIAL_PLANE_COLOR = parseHexColor(planeEntries[0]?.color, DEFAULT_PLANE_COLOR)

const textureLoader = new THREE.TextureLoader()
const PLANE_ATLAS_COLUMNS = 4
const PLANE_ATLAS_ROWS = 2
const PLANE_TEXTURE_SIZE = 512
let svgTexture = null
let svgAtlasInfo = null
let svgTexturePromise = null
let loadingScreenElement = null
let footerCoordinatesElement = null
let controlsManager = null
let guiControls = null

// GUI controls
const params = {
    numFlights: Math.min(5000, MAX_FLIGHTS),
    elevationOffset: 15,
    segmentCount: 100,
    planeSize: 100,
    planeColor: INITIAL_PLANE_COLOR,
    animationSpeed: 0.1,
    tiltMode: 'Tangent',
    paneStyle: 'SVG',
    dashSize: 40,
    gapSize: 40,
    hidePath: false,
    hidePlane: false,
    randomSpeed: false,
    returnFlight: true
}

function clonePlaneEntry(entry) {
    if (!entry) return null
    const { name, svg, color, atlasIndex } = entry
    return { name, svg, color, atlasIndex }
}

function getPlaneEntryByAtlasIndex(index) {
    if (typeof index !== 'number') return null
    if (index < 0 || index >= planeEntries.length) return null
    return planeEntries[index]
}

function getPlaneEntryBySvg(svgName) {
    if (typeof svgName !== 'string' || !svgName) return null
    return planeEntries.find(entry => entry.svg === svgName) || null
}

function getPlaneEntryByName(name) {
    if (typeof name !== 'string' || !name) return null
    return planeEntries.find(entry => entry.name === name) || null
}

function getRandomPlaneEntry() {
    if (!planeEntries.length) return null
    const randomIndex = Math.floor(Math.random() * planeEntries.length)
    return planeEntries[randomIndex]
}

function ensurePlaneDefaults(config = {}) {
    const providedPlaneInfo = config.planeInfo
    let planeEntry = null

    if (providedPlaneInfo && typeof providedPlaneInfo === 'object') {
        if (typeof providedPlaneInfo.atlasIndex === 'number') {
            planeEntry = getPlaneEntryByAtlasIndex(providedPlaneInfo.atlasIndex)
        }
        if (!planeEntry && providedPlaneInfo.svg) {
            planeEntry = getPlaneEntryBySvg(providedPlaneInfo.svg)
        }
        if (!planeEntry && providedPlaneInfo.name) {
            planeEntry = getPlaneEntryByName(providedPlaneInfo.name)
        }
    }

    if (!planeEntry && typeof config.paneTextureIndex === 'number') {
        planeEntry = getPlaneEntryByAtlasIndex(config.paneTextureIndex)
    }

    if (!planeEntry) {
        planeEntry = getRandomPlaneEntry()
    }

    if (!planeEntry) {
        const fallbackColor = typeof config.paneColor === 'number'
            ? config.paneColor
            : DEFAULT_PLANE_COLOR
        const fallbackTextureIndex = typeof config.paneTextureIndex === 'number'
            ? config.paneTextureIndex
            : 0

        return {
            ...config,
            paneColor: fallbackColor,
            paneTextureIndex: fallbackTextureIndex,
            planeInfo: providedPlaneInfo ?? null
        }
    }

    return {
        ...config,
        paneColor: parseHexColor(planeEntry.color, DEFAULT_PLANE_COLOR),
        paneTextureIndex: planeEntry.atlasIndex,
        planeInfo: clonePlaneEntry(planeEntry)
    }
}

function assignRandomPlane(config = {}) {
    return ensurePlaneDefaults({
        ...config,
        planeInfo: null,
        paneTextureIndex: undefined,
        paneColor: undefined
    })
}

function createGradientColorConfig(departure) {
    if (!departure) {
        return null
    }

    return {
        type: 'gradient',
        departureLat: departure.lat,
        departureLng: departure.lng
    }
}

function generateParabolicControlPoints(departure, arrival, radius = EARTH_RADIUS) {
    if (!departure || !arrival) {
        return []
    }

    const surfaceOffset = 5
    const maxCruiseAltitude = 200
    const minCruiseAltitude = 15

    const origin = latLngToVector3(departure.lat, departure.lng, radius)
    const destination = latLngToVector3(arrival.lat, arrival.lng, radius)

    const startSurface = origin.clone().normalize().multiplyScalar(radius + surfaceOffset)
    const endSurface = destination.clone().normalize().multiplyScalar(radius + surfaceOffset)

    const distance = startSurface.distanceTo(endSurface)
    const maxDistance = radius * Math.PI
    const distanceRatio = Math.min(distance / (maxDistance * 0.3), 1)
    const cruiseAltitude = minCruiseAltitude + (maxCruiseAltitude - minCruiseAltitude) * Math.pow(distanceRatio, 0.7)

    const climbPoint1 = startSurface.clone().lerp(endSurface, 0.2).normalize().multiplyScalar(radius + cruiseAltitude * 0.4)
    const climbPoint2 = startSurface.clone().lerp(endSurface, 0.35).normalize().multiplyScalar(radius + cruiseAltitude * 0.75)
    const cruisePeak = startSurface.clone().lerp(endSurface, 0.5).normalize().multiplyScalar(radius + cruiseAltitude * 0.85)
    const descentPoint1 = startSurface.clone().lerp(endSurface, 0.65).normalize().multiplyScalar(radius + cruiseAltitude * 0.75)
    const descentPoint2 = startSurface.clone().lerp(endSurface, 0.8).normalize().multiplyScalar(radius + cruiseAltitude * 0.4)

    // Tangent guiding points near takeoff/landing to avoid surface penetration
    const startNormal = startSurface.clone().normalize()
    let pathDirStart = endSurface.clone().sub(startSurface)
    if (pathDirStart.lengthSq() < 1e-6) {
        pathDirStart = new THREE.Vector3().randomDirection()
    }
    let tangentStart = pathDirStart.clone().sub(startNormal.clone().multiplyScalar(pathDirStart.dot(startNormal)))
    if (tangentStart.lengthSq() < 1e-6) {
        tangentStart = new THREE.Vector3().crossVectors(startNormal, new THREE.Vector3(0, 1, 0))
        if (tangentStart.lengthSq() < 1e-6) {
            tangentStart = new THREE.Vector3(1, 0, 0)
        }
    }
    tangentStart.normalize()
    const tangentDistance = radius * 0.08
    const surfaceLength = startSurface.length()
    const startTangentPoint = startSurface.clone().add(tangentStart.clone().multiplyScalar(tangentDistance)).normalize().multiplyScalar(surfaceLength)

    const endNormal = endSurface.clone().normalize()
    let pathDirEnd = startSurface.clone().sub(endSurface)
    if (pathDirEnd.lengthSq() < 1e-6) {
        pathDirEnd = new THREE.Vector3().randomDirection()
    }
    let tangentEnd = pathDirEnd.clone().sub(endNormal.clone().multiplyScalar(pathDirEnd.dot(endNormal)))
    if (tangentEnd.lengthSq() < 1e-6) {
        tangentEnd = new THREE.Vector3().crossVectors(endNormal, new THREE.Vector3(0, 1, 0))
        if (tangentEnd.lengthSq() < 1e-6) {
            tangentEnd = new THREE.Vector3(1, 0, 0)
        }
    }
    tangentEnd.normalize()
    const endSurfaceLength = endSurface.length()
    const endTangentPoint = endSurface.clone().add(tangentEnd.clone().multiplyScalar(tangentDistance)).normalize().multiplyScalar(endSurfaceLength)

    return [
        startSurface,
        startTangentPoint,
        climbPoint1,
        climbPoint2,
        cruisePeak,
        descentPoint1,
        descentPoint2,
        endTangentPoint,
        endSurface
    ]
}

function createDataFlightConfig(entry) {
    if (!entry) {
        return null
    }

    const { departure, arrival } = entry
    const controlPoints = generateParabolicControlPoints(departure, arrival, EARTH_RADIUS)
    if (!controlPoints.length) {
        return null
    }

    return assignRandomPlane({
        controlPoints,
        segmentCount: params.segmentCount,
        curveColor: createGradientColorConfig(departure),
        paneCount: 1,
        paneSize: params.planeSize,
        elevationOffset: params.elevationOffset,
        animationSpeed: params.animationSpeed,
        tiltMode: params.tiltMode,
        returnFlight: params.returnFlight,
        flightData: {
            departure,
            arrival
        }
    })
}

// Pre-generate flight configurations for stability
function preGenerateFlightConfigs() {
    preGeneratedConfigs = []

    if (Array.isArray(dataFlights) && dataFlights.length > 0) {
        dataFlights.forEach((flightEntry) => {
            const config = createDataFlightConfig(flightEntry)
            if (!config) {
                return
            }

            const configWithPlane = ensurePlaneDefaults(config)
            const normalizedPoints = normalizeControlPoints(configWithPlane.controlPoints)

            preGeneratedConfigs.push({
                ...configWithPlane,
                controlPoints: normalizedPoints,
                elevationOffset: configWithPlane.elevationOffset !== undefined ? configWithPlane.elevationOffset : params.elevationOffset,
                paneTextureIndex: configWithPlane.paneTextureIndex,
                paneColor: configWithPlane.paneColor,
                planeInfo: configWithPlane.planeInfo,
                _randomSpeed: typeof configWithPlane.animationSpeed === 'number' ? configWithPlane.animationSpeed : undefined,
                returnFlight: params.returnFlight
            })
        })

        return
    }

    for (let i = 0; i < MAX_FLIGHTS; i++) {
        let config = FlightUtils.generateRandomFlightConfig({
            segmentCount: params.segmentCount,
            tiltMode: params.tiltMode,
            numControlPoints: 2
        })
        config = assignRandomPlane({
            ...config,
            elevationOffset: params.elevationOffset,
            flightData: null
        })
        const normalizedPoints = normalizeControlPoints(config.controlPoints)
        preGeneratedConfigs.push({
            ...config,
            controlPoints: normalizedPoints,
            elevationOffset: config.elevationOffset,
            paneTextureIndex: config.paneTextureIndex,
            paneColor: config.paneColor,
            planeInfo: config.planeInfo,
            _randomSpeed: typeof config.animationSpeed === 'number' ? config.animationSpeed : undefined,
            returnFlight: params.returnFlight,
            flightData: null
        })
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
// gui.add(params, 'segmentCount', 50, 500).step(50).name('Segments').onChange(updateSegmentCount)
// gui.add(params, 'randomSpeed').name('Random Speed').onChange(() => {
//     applyAnimationSpeedMode()
// })

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

function resolvePaneColor(config = {}) {
    if (typeof config.paneColor === 'number') {
        return config.paneColor
    }

    const color = parseHexColor(params.planeColor, DEFAULT_PLANE_COLOR)
    config.paneColor = color
    return color
}

function applyPaneColorMode() {
    flights.forEach((flight, index) => {
        const config = preGeneratedConfigs[index] || {}
        const color = resolvePaneColor(config)
        flight.setPaneColor(color)
    })
}

function updatePathVisibility() {
    if (!mergedCurves) return
    const visibleCount = params.hidePath ? 0 : flights.length
    mergedCurves.setVisibleCurveCount(visibleCount)
}

function updatePlaneVisibility() {
    if (!mergedPanes) return
    const visibleCount = params.hidePlane ? 0 : flights.length
    mergedPanes.setActivePaneCount(visibleCount)
    if (typeof mergedPanes.setPlanesVisible === 'function') {
        mergedPanes.setPlanesVisible(!params.hidePlane)
    }
}

function setHidePlane(value) {
    const shouldHide = !!value
    if (params.hidePlane !== shouldHide) {
        params.hidePlane = shouldHide
    }

    updatePlaneVisibility()

    if (controlsManager && typeof controlsManager.setHidePlane === 'function') {
        if (controlsManager.guiControls?.hidePlane !== shouldHide) {
            controlsManager.setHidePlane(shouldHide)
        }
    }
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

function updateAnimationSpeed(value) {
    const numeric = Number(value)
    const speed = Number.isFinite(numeric) ? numeric : params.animationSpeed
    params.animationSpeed = speed
    applyAnimationSpeedMode()

    if (controlsManager && typeof controlsManager.setAnimationSpeed === 'function') {
        if (controlsManager.guiControls?.animationSpeed !== speed) {
            controlsManager.setAnimationSpeed(speed)
        }
    }
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
        },
        onPlaneSizeChange: (value) => {
            updatePlaneSize(value)
        },
        onPlaneColorChange: (value) => {
            updatePlaneColor(value)
        },
        onAnimationSpeedChange: (value) => {
            params.randomSpeed = false
            updateAnimationSpeed(value)
        },
        onPlaneElevationChange: (value) => {
            updatePlaneElevation(value)
        },
        onPaneStyleChange: (value) => {
            updatePaneStyle(value)
        },
        onHidePlaneChange: (value) => {
            setHidePlane(value)
        },
        onDashSizeChange: (value) => {
            updateDashSize(value)
        },
        onGapSizeChange: (value) => {
            updateGapSize(value)
        },
        onHidePathChange: (value) => {
            updateHidePath(value)
        },
        onFlightCountChange: (value) => {
            updateFlightCount(value)
        },
        onReturnFlightChange: (value) => {
            updateReturnFlight(value)
        }
    }, {
        planeSize: params.planeSize,
        planeSizeRange: { min: 50, max: 500 },
        planeColor: params.planeColor,
        animationSpeed: params.animationSpeed,
        speedRange: { min: 0.01, max: 0.5, step: 0.01 },
        elevationOffset: params.elevationOffset,
        elevationRange: { min: 0, max: 200, step: 5 },
        paneStyle: params.paneStyle,
        paneStyleOptions: ['Pane', 'SVG'],
        hidePlane: params.hidePlane,
        dashSize: params.dashSize,
        dashRange: { min: 0, max: 2000, step: 1 },
        gapSize: params.gapSize,
        gapRange: { min: 0, max: 2000, step: 1 },
        hidePath: params.hidePath,
        numFlights: params.numFlights,
        flightCountRange: { min: 1, max: MAX_FLIGHTS, step: 1 },
        returnFlight: params.returnFlight
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
    if (svgTexture && svgAtlasInfo) {
        return Promise.resolve({ texture: svgTexture, info: svgAtlasInfo })
    }

    if (svgTexturePromise) {
        return svgTexturePromise
    }

    svgTexturePromise = (async () => {
        try {
            const parser = new DOMParser()
            const rasterSize = PLANE_TEXTURE_SIZE
            const aspect = 30 / 28
            const heightSize = Math.round(rasterSize * aspect)

            const rasterizedImages = []

            for (const plane of planeEntries) {
                const svgPath = typeof plane.svg === 'string' && plane.svg.length > 0
                    ? plane.svg
                    : `plane${(plane.atlasIndex ?? 0) + 1}.svg`
                const url = `${import.meta.env.BASE_URL || '/'}${svgPath}`
                const response = await fetch(url)
                if (!response.ok) {
                    throw new Error(`Failed to fetch SVG (${svgPath}): ${response.status} ${response.statusText}`)
                }
                const svgText = await response.text()
                const doc = parser.parseFromString(svgText, 'image/svg+xml')
                const svgElement = doc.documentElement
                svgElement.setAttribute('width', `${rasterSize}`)
                svgElement.setAttribute('height', `${heightSize}`)
                if (!svgElement.getAttribute('viewBox')) {
                    svgElement.setAttribute('viewBox', '0 0 28 30')
                }

                const serialized = new XMLSerializer().serializeToString(svgElement)
                const blob = new Blob([serialized], { type: 'image/svg+xml' })
                const objectUrl = URL.createObjectURL(blob)
                const image = await new Promise((resolve, reject) => {
                    const img = new Image()
                    img.crossOrigin = 'anonymous'
                    img.onload = () => {
                        URL.revokeObjectURL(objectUrl)
                        resolve(img)
                    }
                    img.onerror = (error) => {
                        URL.revokeObjectURL(objectUrl)
                        reject(error)
                    }
                    img.src = objectUrl
                })
                rasterizedImages.push(image)
            }

            const atlasCanvas = document.createElement('canvas')
            atlasCanvas.width = PLANE_ATLAS_COLUMNS * rasterSize
            atlasCanvas.height = PLANE_ATLAS_ROWS * heightSize
            const ctx = atlasCanvas.getContext('2d')
            ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height)

            rasterizedImages.forEach((img, idx) => {
                const col = idx % PLANE_ATLAS_COLUMNS
                const row = Math.floor(idx / PLANE_ATLAS_COLUMNS)
                const x = col * rasterSize
                const y = row * heightSize
                ctx.drawImage(img, x, y, rasterSize, heightSize)
            })

            const atlasUrl = atlasCanvas.toDataURL('image/png')

            svgAtlasInfo = {
                columns: PLANE_ATLAS_COLUMNS,
                rows: PLANE_ATLAS_ROWS,
                count: PLANE_SVG_COUNT,
                scale: { x: 1 / PLANE_ATLAS_COLUMNS, y: 1 / PLANE_ATLAS_ROWS }
            }

            return await new Promise((resolve, reject) => {
                textureLoader.load(atlasUrl, (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace
                    texture.generateMipmaps = true
                    texture.minFilter = THREE.LinearMipmapLinearFilter
                    texture.magFilter = THREE.LinearFilter
                    texture.anisotropy = renderer.capabilities?.getMaxAnisotropy?.() || 1
                    texture.needsUpdate = true
                    svgTexture = texture
                    resolve({ texture: svgTexture, info: svgAtlasInfo })
                }, undefined, (error) => {
                    console.error('Failed to load SVG atlas texture:', error)
                    reject(error)
                })
            })
        } catch (error) {
            console.error('Failed to prepare SVG texture atlas:', error)
            svgTexturePromise = null
            throw error
        }
    })()

    return svgTexturePromise
}

function applyPaneTexture() {
    if (!mergedPanes || typeof mergedPanes.setTexture !== 'function') return

    if (params.paneStyle === 'SVG') {
        if (svgTexture && svgAtlasInfo) {
            mergedPanes.setTexture(svgTexture, svgAtlasInfo)
            flights.forEach(flight => flight.applyPaneTextureIndex?.())
        } else {
            mergedPanes.setTexture(null)
            loadSvgTexture().then(({ texture, info }) => {
                if (params.paneStyle === 'SVG' && mergedPanes) {
                    mergedPanes.setTexture(texture, info)
                    flights.forEach(flight => flight.applyPaneTextureIndex?.())
                }
            }).catch(() => {})
        }
    } else {
        mergedPanes.setTexture(null)
    }
}

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
    if ('flightData' in flightConfig) {
        flight.setFlightData(flightConfig.flightData)
    }
    if (flightConfig.paneTextureIndex !== undefined) {
        flight.setPaneTextureIndex(flightConfig.paneTextureIndex)
    }

    // Set initial animation speed and tilt mode
    flight.setAnimationSpeed(
        flightConfig.animationSpeed !== undefined ? flightConfig.animationSpeed : params.animationSpeed,
        { immediate: true }
    )
    flight.setTiltMode(params.tiltMode)
    if (flightConfig.elevationOffset !== undefined) {
        flight.setPaneElevation(flightConfig.elevationOffset)
    } else {
        flight.setPaneElevation(params.elevationOffset)
    }
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
        returnMode: params.returnFlight,
        baseElevation: params.elevationOffset
    })

    updateDashPattern()
    applyPaneTexture()

    const availableConfigs = preGeneratedConfigs.length
    const desiredCount = availableConfigs > 0
        ? Math.min(params.numFlights, availableConfigs)
        : params.numFlights

    if (availableConfigs > 0 && params.numFlights !== desiredCount) {
        params.numFlights = desiredCount
    }

    for (let i = 0; i < desiredCount; i++) {
        let baseConfig
        if (preGeneratedConfigs.length) {
            const configIndex = i % preGeneratedConfigs.length
            baseConfig = ensurePlaneDefaults(preGeneratedConfigs[configIndex])
            baseConfig.returnFlight = params.returnFlight
            preGeneratedConfigs[configIndex] = baseConfig
        } else {
            baseConfig = assignRandomPlane(FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 }))
            baseConfig.returnFlight = params.returnFlight
        }

        const flightConfig = {
            ...baseConfig,
            controlPoints: cloneControlPoints(baseConfig.controlPoints),
            segmentCount: params.segmentCount,
            curveColor: baseConfig.curveColor,
            paneSize: params.planeSize,
            paneColor: resolvePaneColor(baseConfig),
            animationSpeed: resolveAnimationSpeed(baseConfig),
            elevationOffset: baseConfig.elevationOffset !== undefined ? baseConfig.elevationOffset : params.elevationOffset,
            paneTextureIndex: baseConfig.paneTextureIndex,
            returnFlight: params.returnFlight
        }
        const flight = createFlightFromConfig(flightConfig, i)
        flights.push(flight)
    }

    // Update visible counts in merged renderers
    updatePathVisibility()
    updatePlaneVisibility()

    applyReturnMode()
}

// Update flight count (preserves existing flights)
function updateFlightCount(count) {
    const oldCount = flights.length
    const availableConfigs = preGeneratedConfigs.length || MAX_FLIGHTS
    const targetCount = Math.min(count, availableConfigs)
    params.numFlights = targetCount

    if (targetCount > oldCount) {
        // Add new flights (starting from the beginning)
        if (targetCount > 1) {
            for (let i = oldCount; i < targetCount; i++) {
                let baseConfig
                if (preGeneratedConfigs.length) {
                    const configIndex = i % preGeneratedConfigs.length
                    baseConfig = ensurePlaneDefaults(preGeneratedConfigs[configIndex])
                    baseConfig.returnFlight = params.returnFlight
                    preGeneratedConfigs[configIndex] = baseConfig
                } else {
                    baseConfig = assignRandomPlane(FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 }))
                    baseConfig.returnFlight = params.returnFlight
                }
                const flightConfig = {
                    ...baseConfig,
                    controlPoints: cloneControlPoints(baseConfig.controlPoints),
                    segmentCount: params.segmentCount,
                    curveColor: baseConfig.curveColor,
                    paneSize: params.planeSize,
                    paneColor: resolvePaneColor(baseConfig),
                    animationSpeed: resolveAnimationSpeed(baseConfig),
                    elevationOffset: baseConfig.elevationOffset !== undefined ? baseConfig.elevationOffset : params.elevationOffset,
                    paneTextureIndex: baseConfig.paneTextureIndex,
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
    } else if (targetCount < oldCount) {
        // Remove excess flights
        const flightsToRemove = flights.splice(targetCount)
        flightsToRemove.forEach(flight => flight.remove())
    }

    // Update visible counts in merged renderers
    updatePathVisibility()
    updatePlaneVisibility()

    // Sync with Controls.js
    if (controlsManager && typeof controlsManager.setFlightCount === 'function') {
        if (controlsManager.guiControls?.numFlights !== params.numFlights) {
            controlsManager.setFlightCount(params.numFlights)
        }
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
    params.planeSize = size
    flights.forEach(flight => flight.setPaneSize(size))
    preGeneratedConfigs = preGeneratedConfigs.map(config => ({
        ...config,
        paneSize: size
    }))
    if (controlsManager && typeof controlsManager.setPlaneSize === 'function') {
        if (controlsManager.guiControls?.planeSize !== size) {
            controlsManager.setPlaneSize(size)
        }
    }
    // Updates will be applied in animation loop via applyUpdates()
}

// Function to update plane elevation offset
function updatePlaneElevation(value) {
    params.elevationOffset = value
    preGeneratedConfigs = preGeneratedConfigs.map((config, index) => {
        const updatedConfig = { ...config, elevationOffset: value }
        if (index < flights.length) {
            flights[index].setPaneElevation(value)
        }
        return updatedConfig
    })

    if (controlsManager && typeof controlsManager.setPlaneElevation === 'function') {
        if (controlsManager.guiControls?.elevationOffset !== value) {
            controlsManager.setPlaneElevation(value)
        }
    }
}

// Function to update path elevation offset
// Function to update plane color
function updatePlaneColor(color) {
    let inputColor = color
    if (color && typeof color === 'object') {
        const clamp = (component) => {
            const numeric = Number(component)
            if (!Number.isFinite(numeric)) return 0
            return Math.max(0, Math.min(255, Math.round(numeric)))
        }
        const r = clamp(color.r ?? color.red)
        const g = clamp(color.g ?? color.green)
        const b = clamp(color.b ?? color.blue)
        inputColor = (r << 16) | (g << 8) | b
    }

    const normalizedColor = parseHexColor(inputColor, DEFAULT_PLANE_COLOR)
    params.planeColor = normalizedColor

    preGeneratedConfigs = preGeneratedConfigs.map((config, index) => {
        const updatedConfig = { ...config, paneColor: normalizedColor }
        if (index < flights.length) {
            flights[index].setPaneColor(normalizedColor)
        }
        return updatedConfig
    })

    if (controlsManager && typeof controlsManager.setPlaneColor === 'function') {
        const formatted = `#${normalizedColor.toString(16).padStart(6, '0')}`
        if (controlsManager.guiControls?.planeColor !== formatted) {
            controlsManager.setPlaneColor(normalizedColor)
        }
    }
}

function updateDashPattern() {
    if (mergedCurves) {
        mergedCurves.setDashPattern(params.dashSize, params.gapSize)
        mergedCurves.applyUpdates()
    }
}

function updateDashSize(size) {
    params.dashSize = size
    updateDashPattern()

    if (controlsManager && typeof controlsManager.setDashSize === 'function') {
        if (controlsManager.guiControls?.dashSize !== size) {
            controlsManager.setDashSize(size)
        }
    }
}

function updateGapSize(size) {
    params.gapSize = size
    updateDashPattern()

    if (controlsManager && typeof controlsManager.setGapSize === 'function') {
        if (controlsManager.guiControls?.gapSize !== size) {
            controlsManager.setGapSize(size)
        }
    }
}

function updateHidePath(value) {
    params.hidePath = !!value
    updatePathVisibility()

    if (controlsManager && typeof controlsManager.setHidePath === 'function') {
        if (controlsManager.guiControls?.hidePath !== params.hidePath) {
            controlsManager.setHidePath(params.hidePath)
        }
    }
}

function updateReturnFlight(value) {
    params.returnFlight = !!value
    applyReturnMode()

    if (controlsManager && typeof controlsManager.setReturnFlight === 'function') {
        if (controlsManager.guiControls?.returnFlight !== params.returnFlight) {
            controlsManager.setReturnFlight(params.returnFlight)
        }
    }
}

function updatePaneStyle(style) {
    const nextStyle = typeof style === 'string' ? style : params.paneStyle
    if (params.paneStyle !== nextStyle) {
        params.paneStyle = nextStyle
    }

    if (controlsManager && typeof controlsManager.setPaneStyle === 'function') {
        if (controlsManager.guiControls?.paneStyle !== params.paneStyle) {
            controlsManager.setPaneStyle(params.paneStyle)
        }
    }

    if (params.paneStyle === 'SVG') {
        loadSvgTexture().then(({ texture, info }) => {
            if (params.paneStyle === 'SVG' && mergedPanes) {
                mergedPanes.setTexture(texture, info)
                flights.forEach(flight => flight.applyPaneTextureIndex?.())
            }
        }).catch(() => {})
    } else if (mergedPanes) {
        mergedPanes.setTexture(null)
    }

    initializeFlights()
}

function randomizeAllFlightCurves() {
    flights.forEach((flight, index) => {
        const randomConfig = FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 })
        const normalizedPoints = normalizeControlPoints(randomConfig.controlPoints)

        const existingConfig = preGeneratedConfigs[index] || {}
        let updatedConfig = {
            ...existingConfig,
            ...randomConfig,
            controlPoints: normalizedPoints,
            segmentCount: params.segmentCount,
            curveColor: randomConfig.curveColor,
            elevationOffset: existingConfig.elevationOffset !== undefined ? existingConfig.elevationOffset : params.elevationOffset,
            flightData: existingConfig.flightData ?? null,
            planeInfo: null,
            paneTextureIndex: undefined,
            paneColor: undefined
        }
        updatedConfig = assignRandomPlane(updatedConfig)
        updatedConfig._randomSpeed = params.randomSpeed ? randomConfig.animationSpeed : undefined
        updatedConfig.returnFlight = params.returnFlight
        preGeneratedConfigs[index] = updatedConfig

        flight.setFlightData(updatedConfig.flightData)
        flight.setControlPoints(cloneControlPoints(normalizedPoints))
        flight.setPaneElevation(updatedConfig.elevationOffset)
        flight.setPaneTextureIndex(updatedConfig.paneTextureIndex)
        flight.setCurveColor(updatedConfig.curveColor)
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

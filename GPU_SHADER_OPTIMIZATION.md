# GPU Shader Optimization for Flight Panes

## Overview

`MergedGPUPanesShader.js` is a fully GPU-accelerated pane renderer that **eliminates CPU bottlenecks** by moving all curve calculations, transformations, and animations to the GPU shader.

## Performance Comparison

### Current Approach (MergedGPUPanes - CPU-based)
```
Per frame with 30,000 flights:
├─ For each flight (30,000x):
│  ├─ curve.getPointAt(t) - CatmullRom interpolation
│  ├─ curve.getPointAt(t + delta) - Lookahead for tangent
│  ├─ Vector cross products (CPU)
│  ├─ Matrix composition (CPU)
│  └─ setMatrixAt(index, matrix) - Upload to GPU
├─ Total CPU time: ~17ms
└─ GPU render time: 0.24ms
```

### GPU Shader Approach (MergedGPUPanesShader - GPU-based)
```
Setup (once per flight):
└─ Upload 4 control points as vertex attributes

Per frame:
├─ Update ONE uniform: time += deltaTime
├─ GPU processes all 30,000 flights in parallel:
│  ├─ Curve evaluation
│  ├─ Tangent calculation
│  ├─ Matrix composition
│  └─ Vertex transformation
├─ Expected CPU time: <1ms
└─ GPU render time: ~0.3ms
```

**Expected improvement: ~17ms → ~1ms = 17x faster CPU time!**

## How It Works

### 1. Curve Control Points as Vertex Attributes
Control points are uploaded **once** when a flight is created:
```javascript
// Pack 4 control points into 3 vec4 attributes (12 floats)
controlPointsPack1: (p0.x, p0.y, p0.z, p1.x)
controlPointsPack2: (p1.y, p1.z, p2.x, p2.y)
controlPointsPack3: (p2.z, p3.x, p3.y, p3.z)
```

### 2. CatmullRom Curve Evaluation in Shader
The GPU shader evaluates the curve position:
```glsl
vec3 evaluateCatmullRom(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    return 0.5 * (
        (2.0 * p1) +
        (-p0 + p2) * t +
        (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
        (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    );
}
```

### 3. All Calculations in Vertex Shader
```glsl
void main() {
    // Calculate animation progress
    float t = mod(time * speed + phase, 1.0);

    // Evaluate curve position (GPU)
    vec3 curvePosition = evaluateCatmullRom(p0, p1, p2, p3, t);

    // Get tangent for orientation (GPU)
    vec3 tangent = getCatmullRomTangent(p0, p1, p2, p3, t);

    // Create rotation matrix (GPU)
    mat4 rotationMatrix = createOrientationMatrix(tangent, up, tiltMode);

    // Transform vertex (GPU)
    vec4 worldPosition = vec4(curvePosition, 1.0) +
                        rotationMatrix * vec4(scaledPosition, 0.0);

    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
}
```

### 4. CPU Work Minimal
```javascript
// Per frame for ALL flights:
update(deltaTime) {
    this.material.uniforms.time.value += deltaTime  // One line!
}
```

## Migration Guide

### Current GPUFlight.js Structure
```javascript
constructor(scene, options) {
    this.mergedPanes = options.mergedPanes  // MergedGPUPanes instance
    this.paneIndex = options.paneIndex
    this._cachedCurve = new THREE.CatmullRomCurve3(controlPoints)
}

update(deltaTime) {
    this.animationTime += deltaTime * this.animationSpeed
    const t = (this.animationTime % 1)
    this.mergedPanes.updatePaneOnCurve(this.paneIndex, this._cachedCurve, t, 0.001, this.tiltMode)
}
```

### Using GPU Shader Version

#### 1. Update main_gpu.js to use MergedGPUPanesShader
```javascript
import { MergedGPUPanesShader } from './MergedGPUPanesShader.js'

// Create shader-based panes renderer
mergedPanes = new MergedGPUPanesShader(scene, {
    maxPanes: MAX_FLIGHTS,
    baseSize: params.planeSize
})
```

#### 2. Update GPUFlight.js to work with shader panes
```javascript
create() {
    // For shader-based panes, upload control points once
    if (this.mergedPanes && this.paneIndex >= 0) {
        // Ensure we have exactly 4 control points
        const controlPoints = this.controlPoints.length === 4
            ? this.controlPoints
            : this.resampleTo4Points(this.controlPoints)

        this.mergedPanes.setCurveControlPoints(this.paneIndex, controlPoints)
        this.mergedPanes.setPaneColor(this.paneIndex, this.paneOptions.color)
        this.mergedPanes.setPaneSize(this.paneIndex, this.paneOptions.paneSize)
        this.mergedPanes.setAnimationSpeed(this.paneIndex, this.animationSpeed)
        this.mergedPanes.setTiltMode(this.paneIndex, this.tiltMode)
    }
}

update(deltaTime) {
    // No work needed! GPU handles everything
    // (The mergedPanes.update(deltaTime) is called once in main_gpu.js)
}

// Helper to ensure 4 control points
resampleTo4Points(points) {
    if (points.length === 4) return points

    const curve = new THREE.CatmullRomCurve3(points)
    return [
        curve.getPoint(0.0),
        curve.getPoint(0.333),
        curve.getPoint(0.666),
        curve.getPoint(1.0)
    ]
}
```

#### 3. Update animation loop in main_gpu.js
```javascript
function animate() {
    const delta = clock.getDelta()

    // No more per-flight CPU work!
    // flights.forEach(flight => flight.update(delta))  // Remove this

    // Just update the GPU shader time uniform
    if (mergedPanes) {
        mergedPanes.update(delta)
    }

    // Apply any pending updates (color, size changes)
    if (mergedCurves) {
        mergedCurves.applyUpdates()
    }

    renderer.render(scene, camera)
}
```

## Requirements

1. **Control Points**: Shader version requires exactly **4 control points** for CatmullRom interpolation
2. **Three.js Version**: Requires Three.js with ShaderMaterial support
3. **GPU Compatibility**: Requires GPU with vertex shader support (all modern GPUs)

## API Compatibility

The shader version maintains the same API as MergedGPUPanes for easy migration:

```javascript
// Setup (called once per flight)
setCurveControlPoints(index, [p0, p1, p2, p3])
setPaneColor(index, color)
setPaneSize(index, size)
setAnimationSpeed(index, speed)
setTiltMode(index, 'Perpendicular' | 'Tangent')

// Animation (called once per frame for ALL flights)
update(deltaTime)

// Hide panes
hidePane(index)
```

## Expected Results

With 30,000 flights:

| Metric | Current (CPU) | GPU Shader | Improvement |
|--------|---------------|------------|-------------|
| Flight Updates | 17ms | <1ms | 17x faster |
| Merged Updates | 0ms | 0ms | Same |
| GPU Render | 0.24ms | ~0.3ms | Minimal increase |
| **Total** | **17.24ms** | **~1.3ms** | **13x faster** |
| **FPS** | ~58 FPS | 60+ FPS | Locked 60 FPS |

## Limitations

1. **Fixed Control Points**: Once curve is set, can't change control points dynamically (would need to re-upload attributes)
2. **Memory**: Stores 12 floats (48 bytes) per flight for control points vs current approach using CPU-side Three.js curve object
3. **Debugging**: Shader code is harder to debug than CPU code

## Next Steps

To implement:

1. Update `GPUFlight.js` to support both CPU and GPU pane renderers
2. Add helper method to ensure 4 control points
3. Update `main_gpu.js` to use `MergedGPUPanesShader` instead of `MergedGPUPanes`
4. Remove per-flight `update()` calls from animation loop
5. Test and profile

## Conclusion

Moving pane animation to GPU shaders **eliminates the CPU bottleneck entirely**, allowing for smooth 60 FPS with 30,000+ flights. The CPU only needs to update a single `time` uniform per frame, while the GPU handles all curve evaluations, transformations, and rendering in parallel.

# Web Relighting Implementation Plan

## Overview (from Report)

Implement professional-grade image relighting in the browser using:

- **Depth Anything V2** - AI depth estimation model
- **ONNX Runtime Web** - GPU inference with WebGPU backend  
- **Three.js WebGPU + TSL** - Rendering with shading language

---

## Architecture Summary

```
User Image → Depth Estimation (AI) → Normal Map → Lighting Shaders → Output
                    ↓
             GPU Memory (Zero-Copy)
                    ↓
          Three.js TSL Shaders
          ├── Normal Reconstruction
          ├── Lambertian Diffuse
          ├── Raymarching Shadows
          └── Ambient Occlusion
```

---

## Phase 1: Environment & Model Setup

### 1.1 Install Dependencies

```bash
npm install three@0.166 onnxruntime-web
```

### 1.2 Model Conversion

1. Download **Depth Anything V2 Small** model
2. Export to ONNX with FP16 precision:

   ```bash
   python dynamo.py --model small --output depth_anything_v2.onnx --fp16
   ```

### 1.3 ORT Session Initialization

```javascript
const session = await ort.InferenceSession.create('depth_anything_v2.onnx', {
    executionProviders: ['webgpu']
});
```

---

## Phase 2: WebGPU Inference Loop (Zero-Copy)

### Critical: IO Binding for Performance

The report emphasizes **zero-copy** data transfer:

1. **Texture Upload** → Image to GPUTexture
2. **Tensor from GPU** → `ort.Tensor.fromGpuBuffer()` (no CPU copy)
3. **Inference** → Model runs on GPU
4. **Output Binding** → `preferredOutputLocation: 'gpu-buffer'`
5. **Render Interop** → Three.js `StorageTexture` wraps GPU buffer

### Implementation

```javascript
// Zero-copy tensor creation
const inputTensor = ort.Tensor.fromGpuBuffer(gpuBuffer, { 
    dims: [1, 3, height, width],
    dataType: 'float32' 
});

// Run inference with output on GPU
const results = await session.run({ input: inputTensor }, {
    preferredOutputLocation: { output: 'gpu-buffer' }
});

// Get depth map as GPU texture
const depthBuffer = results.output.getData();
const depthTexture = new THREE.StorageTexture(depthBuffer, ...);
```

---

## Phase 3: Relighting Shaders (TSL)

### 3.1 Normal Map Reconstruction (Sobel/Central Difference)

```javascript
import { texture, uv, vec2, vec3, normalize, float } from 'three/tsl';

const normalNode = Fn(() => {
    const epsilon = float(1.0 / resolution);
    const strength = float(10.0); // Relief exaggeration
    
    const val = depthTexture.sample(uv());
    const valRight = depthTexture.sample(uv().add(vec2(epsilon, 0)));
    const valDown = depthTexture.sample(uv().add(vec2(0, epsilon)));
    
    const dx = valRight.sub(val);
    const dy = valDown.sub(val);
    
    return normalize(vec3(
        dx.negate().mul(strength),
        dy.negate().mul(strength),
        1.0
    ));
});
```

### 3.2 Lambertian Diffuse Lighting

```javascript
const lightDir = normalize(lightPos.sub(positionWorld));
const diffuse = max(dot(normalNode(), lightDir), 0.0);
const litColor = baseTexture.mul(diffuse);
```

### 3.3 Screen-Space Raymarching Shadows

Algorithm:

1. Reconstruct 3D position from UV + depth
2. Calculate direction to light
3. March along ray in small steps
4. At each step, compare ray depth vs depth map
5. If `Z_ray > Z_map + bias` → in shadow

```javascript
const shadowNode = Fn(() => {
    let shadow = float(1.0);
    const stepSize = float(0.01);
    const numSteps = 32;
    
    for (let i = 0; i < numSteps; i++) {
        const samplePos = origin.add(lightDir.mul(stepSize.mul(i)));
        const sampleUV = projectToScreen(samplePos);
        const mapDepth = depthTexture.sample(sampleUV);
        const rayDepth = samplePos.z;
        
        if (rayDepth > mapDepth.add(bias)) {
            shadow = float(0.3); // In shadow
            break;
        }
    }
    return shadow;
});
```

### 3.4 Horizon-Based Ambient Occlusion (HBAO)

Adds soft darkening in crevices:

- March rays in multiple directions
- Calculate "horizon angle" (sky visibility)
- Darken based on occlusion

---

## Phase 4: Integration with Orlume Editor

### 4.1 Files to Create/Modify

```
src/
├── 3d/
│   ├── DepthEstimator.js       # ONNX depth model wrapper
│   ├── RelightingRenderer.js   # Three.js WebGPU renderer
│   └── shaders/
│       ├── normal.tsl.js       # Normal reconstruction
│       ├── shadows.tsl.js      # Raymarching shadows
│       └── ao.tsl.js           # Ambient occlusion
├── app/modules/
│   └── RelightingModule.js     # UI and controls
```

### 4.2 UI Controls

- **Light position**: Mouse drag or sliders (X, Y, Z)
- **Light intensity**: Slider
- **Shadow strength**: Slider
- **AO intensity**: Slider
- **Normal strength**: Relief exaggeration

---

## Key Takeaways from Report

| Point | Detail |
|-------|--------|
| **Depth is the Driver** | Quality depends on Depth Anything V2 |
| **Zero-Copy Mandatory** | Data must stay on GPU - IO binding required |
| **2.5D is an Illusion** | Clever shaders trick the eye |
| **Occlusion Artifacts** | Manage user expectations on limits |

---

## Estimated Timeline

| Phase | Effort |
|-------|--------|
| Model setup + ONNX | 1 day |
| Zero-copy pipeline | 2 days |
| TSL shaders | 2 days |
| UI integration | 1 day |
| **Total** | **~6 days** |

---

## Dependencies

```json
{
  "three": "^0.166.0",
  "onnxruntime-web": "^1.17.0"
}
```

## Model Source

- [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2)
- Use "Small" variant for web performance

# ORLUME AI Photo Editor - Complete Technical Documentation

> **Version:** 1.0  
> **Author:** Kunal Chaugule  
> **Project Type:** Web-Based AI Photo Editor with Real-time 3D Relighting

---

## 1. Executive Summary

**Orlume** is an advanced, browser-based AI photo editor that leverages cutting-edge machine learning models, WebGL/WebGPU acceleration, and real-time 3D rendering to provide professional-grade image editing capabilities. The key innovation is the **3D Relighting System** that converts 2D photographs into interactive 3D scenes with physically-based lighting.

### Key Technical Achievements
- **Real-time Depth Estimation** using Depth Anything V2 via Transformers.js
- **Semantic Segmentation** with SegFormer B0 (150 ADE20K classes) for material-aware rendering
- **GPU-Accelerated Rendering** with WebGL2 and WebGPU backends
- **Physically-Based Rendering (PBR)** with GGX specular, HBAO ambient occlusion
- **3D Mesh Generation** with Three.js integration and real-time shadows
- **AI-Powered Image Enhancement** using Real-ESRGAN and GFPGAN

---

## 2. Machine Learning Models

### 2.1 Depth Anything V2 (Monocular Depth Estimation)

| Property | Details |
|----------|---------|
| **Model** | `Xenova/depth-anything-small-hf` via Hugging Face Transformers.js |
| **Architecture** | Vision Transformer (ViT) based depth estimation |
| **Input** | Single RGB image (any resolution) |
| **Output** | Dense depth map (normalized 0-1 range) |
| **Backend Support** | WebGPU (preferred), WASM (fallback) |
| **File** | `src/ml/DepthEstimator.js` |

**Technical Pipeline:**
```
Input Image → ViT Encoder → Depth Decoder → Normalized Depth Map → Bilinear Upscaling
```

**Key Implementation Details:**
- Progressive loading with real-time progress callbacks
- Automatic fallback chain: WebGPU → WASM for maximum compatibility
- Min-max normalization for consistent depth range
- Output resolution matches input resolution via bilinear interpolation

---

### 2.2 SegFormer B0 (Semantic Segmentation)

| Property | Details |
|----------|---------|
| **Model** | `Xenova/segformer-b0-finetuned-ade-512-512` |
| **Dataset** | ADE20K (150 semantic classes) |
| **Architecture** | Hierarchical Transformer encoder with lightweight MLP decoder |
| **Input** | RGB image (resized to 512×512 internally) |
| **Output** | Per-pixel class labels + material property map |
| **File** | `src/ml/SegmentationEstimator.js` |

**Supported Classes & Material Properties:**

| Class Category | Examples | Material Properties |
|---------------|----------|---------------------|
| **Sky** | sky | Emissive=1.0, ForceDepth=1.0 |
| **People** | person | Subsurface=0.35, Roughness=0.6 |
| **Metals** | car, building | Metallic=0.95, Roughness=0.3 |
| **Glass** | window, mirror | Transparency=0.9, Roughness=0.02 |
| **Vegetation** | tree, plant, grass | Subsurface=0.1, Roughness=0.85 |
| **Fabrics** | curtain, blanket | Roughness=0.9, Subsurface=0.08 |
| **Emissive** | lamp, chandelier, sconce | Emissive=0.8 |

**Output Encoding (RGBA):**
- R = Roughness (0-255 → 0.0-1.0)
- G = Metallic (0-255 → 0.0-1.0)
- B = Subsurface Scattering (0-255 → 0.0-1.0)
- A = Emissive (0-255 → 0.0-1.0)

---

### 2.3 MediaPipe Face Mesh (Facial Geometry)

| Property | Details |
|----------|---------|
| **Model** | Google MediaPipe Face Mesh |
| **Vertices** | 468 facial landmarks |
| **Triangles** | ~900 triangles for dense mesh |
| **Output** | 3D vertex positions, normals, depth map |
| **File** | `src/ml/FaceMeshDetector.js` |

**Features:**
- Complete face mesh triangulation with smooth vertex normals
- Barycentric interpolation for high-quality depth maps
- Facial region extraction (eyes, nose, lips, cheeks)
- Skin mask generation for subsurface scattering
- Real-time face tracking for animated relighting

**Normal Calculation:**
- Per-triangle face normals computed via cross product
- Smooth vertex normals via area-weighted averaging
- Gaussian blur post-processing for artifact-free surfaces

---

### 2.4 Real-ESRGAN (AI Image Upscaling)

| Property | Details |
|----------|---------|
| **Model** | Real-ESRGAN x4 |
| **Architecture** | RRDB (Residual-in-Residual Dense Block) |
| **Scale Factors** | 2×, 4× |
| **Backend** | Self-hosted Python server or Browser AI fallback |
| **File** | `src/ml/ImageUpscaler.js` |

**Processing Modes:**
1. **Server Mode** - Real-ESRGAN + GFPGAN via HTTP API
2. **Browser Mode** - ESRGAN-thick via Transformers.js
3. **Classic Mode** - Bicubic + Unsharp Mask (no AI)

---

### 2.5 GFPGAN (Face Restoration)

| Property | Details |
|----------|---------|
| **Model** | GFPGAN v1.4 |
| **Purpose** | Face enhancement and restoration |
| **Integration** | Combined with Real-ESRGAN pipeline |
| **Backend** | Self-hosted Python server |

---

## 3. Surface Normal Estimation

### 3.1 GPU-Based Normal Generation

| Algorithm | Description | File |
|-----------|-------------|------|
| **Scharr Kernel** | 3×3 gradient operator with better rotational symmetry than Sobel | `NormalEstimator.js` |
| **Sobel Kernel** | Classic 3×3 gradient operator | `DepthEstimator.js` |
| **Multi-Scale** | Combine gradients at multiple radii for detail preservation | `NormalEstimator.js` |

**Scharr Kernel Implementation:**
```
Gx = [-3, 0, +3]  Gy = [-3, -10, -3]
     [-10,0,+10]       [ 0,   0,  0]
     [-3, 0, +3]       [+3, +10, +3]
```

**9-Tap Gaussian Normal Smoothing (Fragment Shader):**
```glsl
vec3 avgNormal = (
    n00 * 1.0 + n10 * 2.0 + n20 * 1.0 +
    n01 * 2.0 + n11 * 4.0 + n21 * 2.0 +
    n02 * 1.0 + n12 * 2.0 + n22 * 1.0
) / 16.0;
```

### 3.2 Segment-Aware Normals
- Sharp edges at object boundaries detected via segmentation
- Edge enhancement at depth discontinuities
- Bilateral filtering to preserve edges while smoothing surfaces

---

## 4. Lighting & Rendering Pipeline

### 4.1 Core Lighting System

| Component | Description | File |
|-----------|-------------|------|
| **LightingSystem** | WebGL2 real-time lighting renderer | `src/core/LightingSystem.js` |
| **MeshSystem** | Three.js 3D mesh generation with displacement | `src/core/MeshSystem.js` |
| **DepthSystem** | Depth processing and normal generation | `src/core/DepthSystem.js` |

### 4.2 GLSL Fragment Shader Features

#### Screen Space Ambient Occlusion (SSAO)
```glsl
// 8-sample hemisphere around fragment
float calculateSSAO(vec2 uv, float depth) {
    // Sample in 8 directions at fixed radius
    // Compare depth with neighbors
    // Return occlusion factor (0 = fully occluded, 1 = no occlusion)
}
```

**Parameters:**
- Sample count: 8 directions (cardinal + diagonals)
- Sample radius: 8 pixels
- Intensity: Configurable via `u_ssaoStrength`

#### Soft Shadows (Dithered Ray Marching)
```glsl
float calculateSoftShadow(vec2 uv, vec2 lightPos, float lightHeight) {
    // Pseudo-random dithering to break up banding
    float dither = hash(uv * u_resolution) * 0.5;
    
    // 9-tap Gaussian depth blur (3px radius)
    float sampleDepth = sampleDepthSmooth(samplePos);
    
    // 48 ray marching steps with quadratic distribution
    // Height-aware ray with gradient accumulation
}
```

**Anti-Banding Techniques:**
1. Per-pixel pseudo-random dither offset using hash function
2. 9-tap Gaussian blur for depth sampling (3-pixel radius)
3. Gradient-based soft blocking instead of hard thresholds
4. 48 ray steps (doubled from 16) for smoother transitions
5. Quadratic step distribution (denser near fragment)

#### Specular Highlights (Blinn-Phong)
```glsl
vec3 halfDir = normalize(lightDir + viewDir);
float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
```

#### Distance Falloff
```glsl
float falloff = 1.0 / (1.0 + dist * dist * 3.0);  // Inverse square with bias
```

### 4.3 HBAO (Horizon-Based Ambient Occlusion)

| Property | Details |
|----------|---------|
| **Algorithm** | Ray marching in multiple directions to compute horizon angle |
| **Directions** | 8 (configurable) |
| **Steps per Direction** | 8 (configurable) |
| **Post-Processing** | Gaussian blur for soft edges |
| **File** | `src/effects/HBAOShader.js` |

**Technical Implementation:**
```glsl
float computeHorizonAngle(vec2 uv, vec2 direction, float centerDepth) {
    // March rays outward from fragment
    // Track maximum elevation angle encountered
    // Return horizon visibility factor
}
```

---

## 5. Physically-Based Rendering (PBR)

### 5.1 PBR Shader Implementation

| Term | Formula | Description |
|------|---------|-------------|
| **GGX Distribution (D)** | `D(m) = α² / (π * ((n·m)² * (α²-1) + 1)²)` | Microfacet normal distribution |
| **Fresnel-Schlick (F)** | `F(v,h) = F0 + (1-F0) * (1-(v·h))⁵` | Surface reflectivity vs viewing angle |
| **Smith Geometry (G)** | `G(l,v,h) = G1(l) * G1(v)` | Microfacet shadowing/masking |
| **Lambert Diffuse** | `kd * (1/π) * albedo * (n·l)` | Matte surface reflection |

### 5.2 Material Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| Roughness | 0.0-1.0 | Surface smoothness (0=mirror, 1=matte) |
| Metallic | 0.0-1.0 | Metalness (0=dielectric, 1=metal) |
| Subsurface | 0.0-1.0 | Subsurface scattering (skin, wax, leaves) |
| Emissive | 0.0-1.0 | Self-illumination (lamps, screens) |

### 5.3 Exposure-Based Output
- PBR lighting computed in linear space
- Converted to exposure stops for natural brightness
- Soft highlight compression to prevent blow-out
- ACES tone mapping for cinematic look

---

## 6. 3D Mesh System (Three.js Integration)

### 6.1 Mesh Generation Pipeline

```
Depth Map → Plane Geometry → Vertex Displacement → UV Mapping → Textured Mesh
```

**Geometry Parameters:**
- Resolution: 64-512 segments (configurable)
- Aspect ratio preserved from source image
- Displacement amount: 0.0-1.0 (uniform)

### 6.2 Vertex Shader (Displacement)
```glsl
void main() {
    float depth = texture2D(u_depth, uv).r;
    vec3 displaced = position;
    displaced.z += depth * u_displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
```

### 6.3 Interactive Controls
- **Orbit Controls** - Rotate, zoom, pan via OrbitControls
- **Auto-Fit Camera** - Distance calculated from aspect ratio
- **Screen-Space Panning** - Two-finger/right-drag panning
- **Raycast Click** - UV coordinate detection for light placement

---

## 7. God Rays (Volumetric Lighting)

### 7.1 Effect Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| Intensity | 0.0-2.0 | Ray brightness |
| Decay | 0.9-1.0 | Falloff per sample |
| Density | 0.0-1.0 | Blur distance |
| Samples | 32-128 | Ray marching iterations |
| Exposure | 0.0-2.0 | Overall brightness curve |
| Chromatic | 0.0-0.1 | RGB channel separation |
| Bloom | 0.0-1.0 | Glow intensity |
| Scatter | 0.0-1.0 | Atmospheric scattering |

### 7.2 Shader Algorithm
```glsl
void main() {
    vec2 toSun = u_sunPos - uv;
    vec2 ray = toSun / float(samples);
    
    for (int i = 0; i < samples; i++) {
        vec2 samplePos = uv + ray * float(i);
        float luminance = sampleScene(samplePos);
        float depthMask = sampleDepth(samplePos) > u_threshold ? 1.0 : 0.0;
        accumulator += luminance * depthMask * pow(u_decay, float(i));
    }
    
    // Apply chromatic aberration, bloom, tone mapping
}
```

---

## 8. GPU Acceleration Backends

### 8.1 WebGPU Backend (Modern)

| Feature | Description |
|---------|-------------|
| **API** | WebGPU (navigator.gpu) |
| **Shader Language** | WGSL |
| **Render Pipeline** | Programmable render pipeline with bind groups |
| **Texture Format** | BGRA8Unorm (surface format auto-detected) |
| **File** | `src/gpu/WebGPUBackend.js` |

**Capabilities:**
- High-performance WGSL compute and render shaders
- Ping-pong framebuffer rendering
- Dynamic bind group creation
- Automatic fallback to WebGL2

### 8.2 WebGL2 Backend (Fallback)

| Feature | Description |
|---------|-------------|
| **API** | WebGL 2.0 |
| **Shader Language** | GLSL ES 3.00 |
| **Extensions** | EXT_color_buffer_float, OES_texture_float_linear |
| **File** | `src/gpu/WebGL2Backend.js` |

### 8.3 Develop Pipeline (Image Processing)

| Unit | Parameter | Range | Description |
|------|-----------|-------|-------------|
| Exposure | stops | -5.0 to +5.0 | EV adjustment |
| Contrast | factor | 0.0-2.0 | S-curve contrast |
| Highlights | recovery | -1.0 to +1.0 | Highlight detail |
| Shadows | lift | -1.0 to +1.0 | Shadow detail |
| Whites | clipping | -1.0 to +1.0 | White point |
| Blacks | crushing | -1.0 to +1.0 | Black point |
| Temperature | kelvin | 2000-12000 | Color temperature |
| Tint | green-magenta | -1.0 to +1.0 | Tint correction |
| Vibrance | saturation | 0.0-2.0 | Selective saturation |
| Saturation | global | 0.0-2.0 | Global saturation |

---

## 9. Editor Tools

### 9.1 Liquify Tool (Mesh Warping)

| Mode | Description | Algorithm |
|------|-------------|-----------|
| **Push** | Move pixels in brush direction | Translate grid vertices along delta |
| **Enlarge** | Bloat/expand area | Push vertices outward from center |
| **Shrink** | Pucker/contract area | Pull vertices toward center |
| **Swirl Right** | Clockwise rotation | Rotate around center with Gaussian falloff |
| **Swirl Left** | Counter-clockwise rotation | Opposite rotation |
| **Reset** | Restore original | Lerp back to original positions |

**Technical Details:**
- Grid resolution: 128×128 vertices
- WebGL mesh rendering
- Gaussian brush falloff
- Smooth interpolation for natural deformation

### 9.2 Healing/Clone Tool

| Feature | Description |
|---------|-------------|
| **Clone Stamp** | Copy pixels from source to destination |
| **Healing** | Content-aware blending with surrounding pixels |
| **Aligned** | Maintain fixed offset from source |
| **Flow** | Continuous stroke with interpolation |

### 9.3 Crop Tool

| Feature | Description |
|---------|-------------|
| **Free Crop** | Arbitrary aspect ratio |
| **Aspect Ratios** | 1:1, 4:3, 16:9, 3:2, 5:4, 2:3, 9:16 |
| **Rotation** | 0-360° with 90° quick buttons |
| **Transform Handles** | Corner resize, edge resize |
| **Grid Overlay** | Rule of thirds, golden ratio |

### 9.4 Background Removal

| Feature | Description |
|---------|-------------|
| **AI Model** | 851-labs/background-remover API |
| **Output** | Alpha-matted PNG |
| **Replacement Options** | Transparent, solid color, gradient, custom image |
| **Transform** | Interactive scaling, positioning of subject |

---

## 10. Mask System (Local Adjustments)

### 10.1 Mask Types

| Type | Description | Implementation |
|------|-------------|----------------|
| **Brush Mask** | Hand-painted mask | Gaussian brush strokes to texture |
| **Radial Mask** | Circular gradient | Inner/outer radius with feathering |
| **Gradient Mask** | Linear gradient | Direction and falloff |

### 10.2 Per-Layer Adjustments

Each mask layer supports independent adjustments:
- Exposure, Contrast, Highlights, Shadows
- Temperature, Tint, Saturation
- Clarity, Sharpness

### 10.3 Compositing

- Multi-layer support with ping-pong framebuffers
- Alpha blending with mask values
- Preserve original in unmasked areas

---

## 11. Application Architecture

### 11.1 Module System

```
EditorApp (Root)
├── EditorState (Reactive State Management)
├── EditorUI (DOM & Event Handling)
├── HistoryManager (Undo/Redo Stack)
├── GPUProcessor (Render Pipeline)
├── MaskSystem (Local Adjustments)
└── Modules/
    ├── Relighting2Module (3D Lighting)
    ├── GodRaysModule (Volumetric Light)
    ├── BackgroundRemovalModule (AI Segmentation)
    ├── UpscaleModule (AI Enhancement)
    ├── LiquifyModule (Mesh Warping)
    ├── CropModule (Transform)
    ├── HealingModule (Content-Aware)
    ├── CloneModule (Stamp Tool)
    ├── ZoomPanModule (Navigation)
    ├── ExportModule (File Output)
    ├── KeyboardModule (Shortcuts)
    └── LayersModule (Layer Management)
```

### 11.2 State Management

**Reactive Pattern:**
```javascript
class EditorState {
    set(key, value) {
        this.state[key] = value;
        this.notify(key);  // Trigger UI updates
    }
    subscribe(key, callback) {
        this.listeners[key].push(callback);
    }
}
```

### 11.3 History System

- Command pattern for undo/redo
- Canvas snapshot for image state
- Adjustments saved as parameter objects
- Memory-efficient delta storage

---

## 12. Progressive Web App (PWA)

### 12.1 PWA Features

| Feature | Implementation |
|---------|----------------|
| **Installable** | Web App Manifest |
| **Offline Support** | Service Worker caching |
| **Responsive** | Adaptive layout for mobile/desktop |
| **Keyboard Shortcuts** | Full shortcut support |

### 12.2 Service Worker Caching

Cached resources:
- Application shell (HTML, CSS, JS)
- ONNX model files for offline AI
- User assets (cached on first load)

---

## 13. Export Pipeline

### 13.1 Supported Formats

| Format | Quality | Metadata |
|--------|---------|----------|
| JPEG | 0-100% | EXIF preserved |
| PNG | Lossless | Alpha channel |
| WebP | 0-100% | Modern compression |

### 13.2 Resolution Options

- Original resolution
- Custom dimensions with aspect lock
- AI upscaling (2×, 4×)

---

## 14. Technical Dependencies

### 14.1 External Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| Three.js | 0.160+ | 3D rendering, mesh generation |
| Transformers.js | 2.17+ | ML model inference |
| MediaPipe | 0.10+ | Face mesh detection |
| ONNX Runtime | 1.17+ | Neural network inference |

### 14.2 Browser Requirements

| Feature | Minimum Version |
|---------|-----------------|
| Chrome | 113+ (WebGPU) / 90+ (WebGL2) |
| Firefox | 120+ (WebGPU) / 90+ (WebGL2) |
| Safari | 17+ (WebGPU) / 15+ (WebGL2) |
| Edge | 113+ (WebGPU) / 90+ (WebGL2) |

---

## 15. Performance Optimizations

### 15.1 Rendering Optimizations

| Optimization | Technique |
|--------------|-----------|
| **Debounced Rendering** | requestAnimationFrame batching |
| **Render-on-Demand** | Only render when needsRender flag set |
| **LOD Mesh** | Lower resolution during interaction |
| **Texture Caching** | Reuse textures between frames |
| **Ping-Pong Buffers** | Efficient multi-pass rendering |

### 15.2 ML Model Optimizations

| Optimization | Technique |
|--------------|-----------|
| **Model Caching** | IndexedDB storage for ONNX models |
| **Progressive Loading** | Stream model weights with progress |
| **Backend Fallback** | WebGPU → WASM automatic fallback |
| **Quantization** | FP16/INT8 models for faster inference |

---

## 16. File Structure

```
src/
├── core/           # Core systems (Depth, Lighting, Mesh)
├── ml/             # ML models (Depth, Segmentation, Face, Upscale)
├── effects/        # Shaders and effects (PBR, HBAO, GodRays)
├── gpu/            # GPU backends (WebGL2, WebGPU, MaskSystem)
├── app/            # Application (Editor, State, UI, History)
│   └── modules/    # Feature modules (Relight, Crop, Heal, etc.)
├── tools/          # Interactive tools (Liquify, Clone, Crop, Heal)
├── services/       # External services (Replicate API)
├── renderer/       # Rendering utilities
└── styles/         # CSS stylesheets
```

---

## 17. Summary of Technical Innovations

1. **Real-time 3D Relighting** - First browser-based implementation combining depth estimation, normal mapping, and PBR rendering for interactive photo relighting

2. **Dithered Shadow Algorithm** - Novel approach using pseudo-random per-pixel offset, 9-tap Gaussian depth blur, and 48-step ray marching to eliminate banding artifacts

3. **Material-Aware Rendering** - Semantic segmentation provides per-pixel material properties (roughness, metallic, subsurface) for physically-accurate lighting

4. **Hybrid GPU Acceleration** - Automatic WebGPU/WebGL2 backend selection with seamless fallback

5. **Pre-Built Mesh Pipeline** - Background mesh construction during depth estimation for instant 3D toggle

6. **Browser-Native AI** - Complete ML inference stack running in browser without server dependency

---

*Document generated for academic presentation. All implementations are original work unless otherwise cited.*

# Orlume - AI Photo Editor

Transform your photos with AI-powered depth estimation, dynamic relighting, and 3D effects.

![Orlume](https://img.shields.io/badge/AI-Powered-blueviolet)
![WebGPU](https://img.shields.io/badge/WebGPU-Enabled-green)

## Features

- **AI Depth Estimation** — Depth Anything V2 model via Transformers.js
- **Dynamic Relighting** — Place lights, cast shadows, Blinn-Phong shading
- **3D View** — Three.js displacement mapping from depth
- **Parallax Effect** — Depth-based layered motion
- **Fully Browser-Based** — No server required, runs on WebGPU/WASM


```mermaid
flowchart TD
    A[" User Uploads Image"] --> B{"Resolution > 4K?"}
    B -->|Yes| C[" Modal: Ask to Resize"]
    C -->|Approve| D[" Multi-Step Downscale to 4K"]
    C -->|Cancel| Z[" Abort"]
    B -->|No| E[" Image OK"]
    D --> E

    E --> F[" sRGB → Linear Color Space"]
    F --> G[" Depth Anything V2\n(ViT Encoder → Depth Decoder)"]

    G --> H["Surface Normal Estimation"]
    H --> H1["Gaussian Blur Depth\n(radius 8)"]
    H1 --> H2["Sobel 3×3 Gradient\n(nz = 4.0)"]
    H2 --> H3["Gaussian Blur Normals\n(radius 6 + renormalize)"]
    H3 --> H4{"Neural Normals\nAvailable?"}
    H4 -->|Yes| H5[" Neural Normal Estimator"]
    H5 --> H6["Blend: 70% Neural + 30% Depth"]
    H4 -->|No| H7["Use Depth Normals Only"]
    H6 --> I["Final Normals"]
    H7 --> I

    G --> J[" Scene Analyzer\n(Material / Roughness / Curvature)"]
    I --> J

    J --> K[" Confidence Estimator\n+ Lighting Analyzer"]
    K --> L[" Build G-Buffer"]

    L --> M{"GPU Renderer\nAvailable?"}
    M -->|"WebGPU"| N1[" WebGPU Renderer\n(WGSL Shader)"]
    M -->|"WebGL2"| N2[" WebGL2 Deferred Renderer\n(GLSL Shader)"]
    M -->|"None"| N3[" CPU Fallback\n(Simple Lambertian)"]

    N1 --> O[" Relit Output"]
    N2 --> O
    N3 --> O

    style A fill:#4F46E5,color:#fff
    style G fill:#7C3AED,color:#fff
    style H5 fill:#7C3AED,color:#fff
    style J fill:#2563EB,color:#fff
    style K fill:#0891B2,color:#fff
    style N1 fill:#059669,color:#fff
    style N2 fill:#059669,color:#fff
    style N3 fill:#D97706,color:#fff
    style O fill:#16A34A,color:#fff
    style Z fill:#DC2626,color:#fff
```

### GPU Shader Rendering Pipeline

What happens inside the fragment shader on every frame:

```mermaid
flowchart TD
    subgraph Inputs[" G-Buffer Textures"]
        T1["u_albedo\n(sRGB image)"]
        T2["u_normals\n(packed [-1,1] → [0,255])"]
        T3["u_depth\n(normalized [0,1])"]
        T4["u_sceneMap\n(material/roughness/curvature/layer)"]
    end

    T1 --> SRGB["sRGB → Linear Conversion"]
    T2 --> NBLUR["5-Tap Cross Blur\n(center 0.4 + NESW 0.15)"]
    T3 --> DEPTH["Depth Sample"]
    T4 --> SCENE["Decode Scene Map\n(Material, Roughness, Curvature, Layer)"]

    SRGB --> HYBRID
    NBLUR --> SH_NEW & SH_ORIG & SPEC & SSAO_C & SHADOW_C & SSS_C & RIM_C

    subgraph Lighting[" Hybrid Relighting"]
        SH_NEW["evaluateSH9(normal)\nNew Light SH"]
        SH_ORIG["evaluateOrigSH(normal)\nOriginal Light SH"]
        SH_NEW --> RATIO["Ratio Method\nimage × (newSH / origSH)"]
        SH_ORIG --> RATIO
        SH_ORIG --> ALBEDO_M["Albedo Method\n(image / origSH) × newSH"]
        SH_NEW --> ALBEDO_M
        RATIO --> HYBRID["Confidence Blend\nmix(ratio, albedo, confidence × 0.6)"]
        ALBEDO_M --> HYBRID
    end

    subgraph PBR[" PBR Specular"]
        SPEC["Cook-Torrance BRDF"]
        GGX["GGX Distribution (D)"]
        SMITH["Smith Geometry (G)"]
        FRESNEL["Schlick Fresnel (F)"]
        GGX --> SPEC_OUT["Specular = D×G×F / (4·NdotV·NdotL)"]
        SMITH --> SPEC_OUT
        FRESNEL --> SPEC_OUT
        SPEC --> GGX & SMITH & FRESNEL
    end

    subgraph Shadows[" Screen-Space Effects"]
        SSAO_C["SSAO\n(8 samples, curvature-aware)"]
        SHADOW_C["Contact Shadows\n(16-step ray march)"]
        SSAO_C --> COMBINED_S["Combined Shadow\nmin(AO, shadow) × curvature"]
        SHADOW_C --> COMBINED_S
    end

    subgraph MaterialFX[" Material Effects"]
        SSS_C["SSS (Skin Only)\nWrap diffuse + backscatter"]
        HAIR_C["Hair Specular\nDual-lobe anisotropic"]
        RIM_C["Rim Light\nFresnel⁴ × material strength"]
    end

    HYBRID --> COMPOSE
    SPEC_OUT --> COMPOSE
    COMBINED_S --> COMPOSE
    SSS_C --> COMPOSE
    HAIR_C --> COMPOSE
    RIM_C --> COMPOSE
    SCENE --> COMPOSE

    COMPOSE[" Composition\nbase × curvature × depthAtten × shadow\n+ specular + rim + SSS"] --> OKLAB

    OKLAB[" OKLAB Color Preservation\nKeep 70% original chroma"] --> GAMUT
    GAMUT[" Soft-Knee Gamut Mapping\ntanh compression > 0.8"] --> FINAL
    FINAL["Linear → sRGB\nFinal Output"] --> OUT[" fragColor"]

    style Inputs fill:#1E293B,color:#fff
    style Lighting fill:#1E1B4B,color:#fff
    style PBR fill:#1C1917,color:#fff
    style Shadows fill:#1A1A2E,color:#fff
    style MaterialFX fill:#1A1A2E,color:#fff
    style OUT fill:#16A34A,color:#fff
```

### Normal Estimation Evolution

The iterative journey through 7 approaches:

```mermaid
flowchart LR
    subgraph Failed[" Failed Approaches"]
        direction TB
        A1["v1: Raw Sobel\n→ Aluminum foil noise"] ~~~ A2["v2: Scharr Kernel\n→ Still noisy"]
        A2 ~~~ A3["v3: Multi-Scale\n→ Micro-noise persisted"]
        A3 ~~~ A4["v4: Bilateral Filter\n→ 15s+ on 4K, Page Unresponsive"]
        A4 ~~~ A7["v7: 1/8 Downscale\n→ Too much detail lost"]
    end

    subgraph Current[" Current Architecture (v5 + v6)"]
        direction TB
        B1["Depth Map\n(Float32Array)"] --> B2["Gaussian Blur\n(radius 8, async)"]
        B2 --> B3["Sobel 3×3\n(nz = 4.0 = flatter)"]
        B3 --> B4["Gaussian Blur Normals\n(radius 6, renormalize)"]
        B4 --> B5["Depth-Derived\nNormals"]

        B6[" Neural Normal\nEstimator"] --> B7["Neural Normals"]

        B5 --> B8["Blend\n30% Depth + 70% Neural"]
        B7 --> B8
        B8 --> B9["Final Normals ✓"]
    end

    Failed -->|"Lessons learned"| Current

    style Failed fill:#7F1D1D,color:#fff
    style Current fill:#14532D,color:#fff
    style B9 fill:#16A34A,color:#fff
```

### GPU Backend Fallback Chain

```mermaid
flowchart LR
    START["App Init"] --> CHECK1{"navigator.gpu\nexists?"}
    CHECK1 -->|Yes| TRY_GPU["Try WebGPU\nRenderer Init"]
    CHECK1 -->|No| TRY_GL["Try WebGL2\nRenderer Init"]

    TRY_GPU -->|" Success"| WEBGPU[" WebGPU\n(WGSL Shaders)\nBest Quality"]
    TRY_GPU -->|" Failed"| TRY_GL

    TRY_GL -->|" Success"| WEBGL2[" WebGL2\n(GLSL ES 3.0)\n95% of Users"]
    TRY_GL -->|" Failed"| CPU[" CPU Fallback\n(Simple Lambertian)\nAlways Works"]

    style WEBGPU fill:#059669,color:#fff
    style WEBGL2 fill:#2563EB,color:#fff
    style CPU fill:#D97706,color:#fff
```

### ML Model Loading Strategy

```mermaid
flowchart TD
    subgraph Background[" Background Loading (App Open)"]
        OPEN["User Opens Editor"] --> CACHE{"Cached in\nCache Storage?"}
        CACHE -->|Yes| INSTANT["⚡ Instant Load\n< 1 second"]
        CACHE -->|No| DOWNLOAD[" Download ~50MB\nWith Progress Callbacks"]
        DOWNLOAD --> STORE[" Cache for Next Visit"]
    end

    subgraph Inference[" Inference (User Clicks Analyze)"]
        ANALYZE["User Clicks Analyze"] --> READY{"Models Ready?"}
        READY -->|Yes| RUN["Run Pipeline\n(0s model wait)"]
        READY -->|No| WAIT["Wait for Loading..."]
        WAIT --> RUN

        RUN --> DEPTH_M["Depth Anything V2"]
        RUN --> NORMAL_M["Neural Normal Est."]
        RUN --> SEG_M["SegFormer B0"]

        DEPTH_M --> BACKEND{"Backend"}
        BACKEND -->|"WebGPU"| GPU_INF["⚡ GPU Inference"]
        BACKEND -->|"WASM"| CPU_INF[" CPU Inference"]
    end

    Background --> Inference

    style Background fill:#1E293B,color:#fff
    style Inference fill:#1E1B4B,color:#fff
    style INSTANT fill:#16A34A,color:#fff
    style GPU_INF fill:#059669,color:#fff
    style CPU_INF fill:#D97706,color:#fff
```





## Getting Started

```bash
# Clone the repository
git clone https://github.com/kunal0230/Orlume.git
cd Orlume

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173/ in your browser.

## Usage

1. **Upload** an image (drag & drop or click)
2. **Estimate Depth** — AI generates depth map
3. **Relight** — Click to place lights, drag to move, right-click to delete
4. **3D View** — Explore the scene in 3D
5. **Export** — Save your edited image

## Tech Stack

- **Vite** — Build tool
- **Transformers.js** — AI model inference
- **Three.js** — 3D rendering
- **WebGPU** — Hardware acceleration

## License

MIT

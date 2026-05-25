# Orlume — Architecture Quick Reference

> **Read this first.** Every AI agent session starts here. ≤ 150 lines. No fluff.

## What Is This?

Orlume is a **browser-based, GPU-accelerated photo editor** (vanilla JS + WebGL2/WebGPU). Lightroom-class: HSL, tone curves, color grading, AI healing, bg removal, liquify, god rays, text overlays, masks, presets.

## Core Data Flow

```
User Input (slider drag / click / tool action)
        │
        ▼
 ┌─────────────┐     setAdjustment(name, val)     ┌──────────────┐
 │  EditorUI    │ ──────────────────────────────▶  │ EditorState   │
 │  (controller)│     setParam(name, val)          │ (truth store) │
 │  ~1492 lines │ ──────────────────────────────▶  └──────────────┘
 └──────┬───────┘
        │  gpu.setParam(name, val)  ← triggers render()
        ▼
 ┌─────────────┐     renderDevelop(texture, params)
 │ GPUProcessor │ ──────────────────────────────▶  WebGL2Backend / WebGPUBackend
 │  (params{})  │
 └──────┬───────┘
        │  output → gpu-canvas
        ▼
 historyModule.pushDebounced()  →  HistoryManager (50-state stack)
```

**State Sync Rule:** On every adjustment change, you MUST update BOTH:
1. `gpu.setParam(name, value)` — drives rendering
2. `state.setAdjustment(name, value)` — drives undo/redo snapshots

## Directory Map (one sentence each)

```
src/
├── app/
│   ├── EditorApp.js           # Entry point. Creates GPU, MaskSystem, State, UI.
│   ├── EditorState.js         # Central state: adjustments, tool, image, brush, events.
│   ├── EditorUI.js            # Main controller: DOM events, mode switching, module init.
│   ├── HistoryManager.js      # Generic undo/redo stack, 50 entries max, JSON deep-copy.
│   ├── TextLayer.js           # Single text layer data model.
│   ├── TextLayerManager.js    # Manages collection of text layers.
│   └── modules/               # All feature modules (see MODULE_REGISTRY.md).
├── gpu/
│   ├── GPUProcessor.js        # Unified GPU API: params, setParam, render, loadImage.
│   ├── GPUBackend.js          # Backend factory: WebGPU preferred, WebGL2 fallback.
│   ├── WebGL2Backend.js       # WebGL2 implementation.
│   ├── WebGPUBackend.js       # WebGPU implementation.
│   ├── MaskSystem.js          # Brush/radial/gradient mask rasterization (WebGL2).
│   ├── MaskSystemWebGPU.js    # Mask rasterization (WebGPU path).
│   ├── MaskSystemFactory.js   # Picks correct mask system for active backend.
│   └── shaders/               # GLSL/WGSL shaders (develop.glsl, blur.glsl, MaskShaders).
├── tools/                     # Standalone tool classes: CropTool, LiquifyTool, HealingTool, CloneTool.
├── effects/                   # GodRaysEffect, GodRaysShader, AdvancedGodRaysShader.
├── components/                # UI widgets: ToneCurveEditor, ColorGradingWheel.
├── services/                  # ReplicateService (AI API proxy client).
├── modules/                   # PRO features: RelightingProModule.
├── ml/                        # Client-side ML: DepthEstimator, SegmentationEstimator, etc.
├── presets/                   # PresetLibrary (preset definitions + blending logic).
├── renderer/                  # CanvasManager, SceneManager (3D relighting).
├── styles/                    # CSS.
├── utils/                     # Analytics, PWA install.
└── relighting/                # 3D relighting support assets.
api/                           # Vercel serverless: replicate.js, feedback.js.
pages/                         # Static pages: feedback.html, docs, about.
handouts/                      # ← YOU ARE HERE.
```

## Mode Switching Pattern

```
EditorUI.setMode(mode)
  ├── _deactivateAllOverlayTools()     // ALWAYS first: liquify, healing, clone, bgRemoval
  ├── Special cleanup for previous mode (crop, godrays, text, 3d-pro)
  ├── state.setTool(mode)
  ├── Update toolbar button classes
  ├── Hide ALL mode headers + panels
  └── Show target panel + activate tool
```

## Destructive Operation Template

**Modules that replace the source image** (crop, liquify apply, healing apply, bg removal apply, god rays apply) MUST follow this exact sequence:

```javascript
// STEP 1: Cancel pending debounce — we're pushing manually
clearTimeout(this.editor._historyDebounceTimer);

// STEP 2: Capture BEFORE state
const snapshot = this.editor._captureFullState();

// STEP 3: Push BEFORE modifying anything
this.editor.history.pushState(snapshot);

// STEP 4: Create result image
const resultImage = await this._createResult();       // tool-specific

// STEP 5: Load into GPU + update state
this.state.setImage(resultImage);                      // generates new imageId
this.gpu.loadImage(resultImage);
this.state.originalImage = resultImage;

// STEP 6: Update UI
setTimeout(() => this.editor.renderHistogram(), 100);
```

⚠️ **If you push history AFTER modifying state, undo is permanently broken for that operation.**

## History System (Two-Layer)

| Layer | Class | Role |
|-------|-------|------|
| Generic stack | `HistoryManager` | Push/pop/undo/redo. 50 entries max. JSON deep-copy. |
| Application layer | `HistoryModule` | `captureFullState()` / `restoreState()`. Image registry (`Map<imageId, dataURL>`). Dynamic module discovery (`editor.*Module.getState()`). |

## Overlay Tool Lifecycle

Tools with 2D canvas overlays (Liquify, Healing, Clone, BG Removal, GodRays, Comparison):
1. `activate()` → create/show overlay canvas, bind events
2. User interacts on overlay canvas
3. `apply()` → render result → follow destructive op template → deactivate
4. `deactivate()` → remove overlay canvas, unbind events

## Key Files By Size (for orientation)

| File | Lines | Role |
|------|-------|------|
| `EditorUI.js` | ~1492 | Main controller |
| `RelightingProModule.js` | ~50k bytes | 3D relighting (PRO) |
| `WebGPUBackend.js` | ~40k bytes | WebGPU rendering |
| `BackgroundRemovalModule.js` | ~34k bytes | AI bg removal |
| `GodRaysModule.js` | ~31k bytes | Volumetric light |
| `PresetLibrary.js` | ~32k bytes | Preset definitions |
| `MaskSystem.js` | ~30k bytes | Brush/mask GPU rasterization |

## Serverless Backend

| Function | Env Var | Purpose |
|----------|---------|---------|
| `api/replicate.js` | `REPLICATE_API_TOKEN` | Proxies AI requests (healing, upscale, bg-removal) to Replicate |
| `api/feedback.js` | `RESEND_API_KEY` | Feedback/crash reports → Resend email API → `kunalchaugule36@gmail.com` |

Env vars are set in **Vercel Dashboard** (not `.env.local`). Only `VITE_`-prefixed vars are client-side.

## Next: Read These Files

1. **`01_SYSTEM_CONTRACT.md`** — Invariants that can never be broken. Read before writing any code.
2. **`02_MODULE_REGISTRY.md`** — Every module's interface, state support, constructor signatures.
3. **`03_GPU_PARAMS.md`** — Every GPU parameter: type, default, range, batching safety.
4. **`04_CODING_STANDARDS.md`** — Patterns, anti-patterns, templates for common operations.
5. **`05_KNOWN_ISSUES.md`** — Technical debt, known bugs, workarounds.
6. **`06_MAINTENANCE.md`** — How to update these handouts when you change code.

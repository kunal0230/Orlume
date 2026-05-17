# Orlume Photo Editor — Architecture Overview

> **Purpose:** This document gives a new AI agent working on this codebase all the context needed to be productive immediately without re-reading every file.

## What Is This?

Orlume is a **browser-based, GPU-accelerated photo editor** built with vanilla JS + WebGL2/WebGPU. It's a Lightroom-class tool with professional features: HSL color grading, tone curves, AI healing/bg-removal, liquify, clone stamp, god rays, text overlays, and more.

## Directory Structure

```
prime-kilonova/
├── src/
│   ├── app/
│   │   ├── EditorApp.js          # Entry point: coordinates GPU, state, masks, UI
│   │   ├── EditorState.js        # Central state store (adjustments, tool selection, image)
│   │   ├── EditorUI.js           # Main controller (~1477 lines): DOM events, mode switching, module orchestration
│   │   ├── HistoryManager.js     # Generic undo/redo stack (50 states max)
│   │   └── modules/
│   │       ├── HistoryModule.js      # State capture/restore, image registry for destructive undo
│   │       ├── CropModule.js         # Crop, rotate, flip
│   │       ├── LiquifyModule.js      # Warp/push/pinch tool
│   │       ├── HealingModule.js      # AI inpainting (LaMa), face enhance, bg removal
│   │       ├── CloneModule.js        # Clone stamp tool
│   │       ├── BackgroundRemovalModule.js  # AI bg removal with transform overlay
│   │       ├── GodRaysModule.js      # Volumetric lighting effect
│   │       ├── HSLModule.js          # Per-channel hue/saturation/luminance (8 colors × 3)
│   │       ├── PresetsModule.js      # Preset library with intensity blending
│   │       ├── ToneCurveModule.js    # RGBA tone curves with LUT output
│   │       ├── ColorGradingModule.js # 3-way color wheels (shadows/mids/highlights)
│   │       ├── TextModule.js         # Text overlays with transform/style
│   │       ├── ComparisonModule.js   # Before/after slider
│   │       ├── ZoomPanModule.js      # Zoom + pan controls
│   │       ├── ExportModule.js       # File export (JPEG/PNG/WebP)
│   │       ├── UpscaleModule.js      # AI upscaling
│   │       ├── KeyboardModule.js     # Keyboard shortcuts
│   │       └── LayersModule.js       # Mask layer management UI
│   ├── gpu/
│   │   ├── GPUProcessor.js       # Unified GPU API (params, render, textures)
│   │   ├── GPUBackend.js         # Backend factory (WebGPU → WebGL2 fallback)
│   │   └── WebGL2Backend.js      # WebGL2 implementation
│   ├── tools/                    # Standalone tool classes (HealingTool, CloneTool, etc.)
│   ├── effects/                  # Effect processors (GodRaysEffect)
│   ├── components/               # UI components (ToneCurveEditor, ColorGradingWheel)
│   ├── services/                 # External API services (ReplicateService)
│   ├── modules/                  # PRO modules (RelightingProModule)
│   └── presets/                  # Preset definitions (PresetLibrary)
├── docs/                         # Research documentation
└── handouts/                     # 👈 YOU ARE HERE — onboarding docs
```

## Core Data Flow

```
User Input (slider/click)
    ↓
EditorUI (controller) → updates EditorState + GPUProcessor.setParam()
    ↓
GPUProcessor.render() → WebGL2Backend.renderDevelop(inputTexture, params)
    ↓
Canvas output (gpu-canvas)
    ↓
HistoryModule.pushDebounced() → captures snapshot for undo/redo
```

## Key Design Patterns

### 1. Mode Switching
`EditorUI.setMode(mode)` is the central mode router. It:
1. Calls `_deactivateAllOverlayTools()` to clean up overlay-based tools
2. Hides all mode headers and panels
3. Shows the target mode's panel and activates its tool

### 2. Overlay Tools
Tools like Liquify, Healing, Clone, and BG Removal use a **2D canvas overlay** on top of the WebGPU canvas. They:
- Create their own `<canvas>` element positioned absolutely over `gpu-canvas`
- Capture mouse events on their overlay
- When "Apply" is clicked: render result → load into GPU → update state

### 3. Destructive Operations
Crop, Liquify Apply, Healing Apply, BG Removal Apply, and GodRays Apply are "destructive" — they replace the source image. The pattern is:
1. Capture state BEFORE the operation (`_captureFullState()`)
2. Push to history BEFORE modifying
3. Create new image from tool output
4. Call `state.setImage(newImage)` (generates new `imageId`)
5. Call `gpu.loadImage(newImage)`

### 4. History / Undo System
- `HistoryManager`: Generic stack with max 50 entries
- `HistoryModule`: Application-specific state capture/restore
  - `imageRegistry`: Map<imageId, dataURL> — stores image versions for destructive undo
  - `captureFullState()`: Snapshots adjustments, masks, module states
  - Dynamic module discovery: iterates `editor.*Module` properties, calls `getState()`

### 5. GPU Parameters
`GPUProcessor.params` is a flat object with ~40+ keys (exposure, contrast, hslHueRed, curveLutRgb, etc.). `setParam()` updates a value and triggers `render()`.

**Important:** Curve LUT params (`curveLutRgb`, `curveLutRed`, `curveLutGreen`, `curveLutBlue`) must be `null` when unused, NOT `0`. Setting them to `0` corrupts rendering.

## Common Pitfalls

1. **Property naming**: Module properties use camelCase (`bgRemovalModule`, not `backgroundRemovalModule`)
2. **WebGPU canvas can't be read**: Use `gpu.toImageData()` to get pixel data, never `canvas.getContext('2d')`
3. **`setParam()` triggers render**: Each call = full GPU render. Batch updates when possible.
4. **Image loading is async**: `new Image(); img.src = url; return img;` — the image isn't loaded yet! Always use `img.onload`.
5. **History push timing**: ALWAYS capture and push BEFORE modifying state for destructive ops.

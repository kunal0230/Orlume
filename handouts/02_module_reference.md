# Module Reference — Quick Lookup

> Every module, its purpose, its state management status, and known quirks.

## Module Status Table

| Module | Property Name | Has `getState()` | Has `setState()` | Has `deactivate()` | Overlay Canvas? | Notes |
|--------|--------------|:-:|:-:|:-:|:-:|-------|
| HistoryModule | `historyModule` | N/A | N/A | N/A | ❌ | Manages history, not a tool |
| CropModule | `cropModule` | ❌ | ❌ | ✅ (via cropTool) | ❌ | Uses CropTool overlay |
| LiquifyModule | `liquifyModule` | ❌ | ❌ | ✅ | ✅ | 2D overlay for warp |
| HealingModule | `healingModule` | ❌ | ❌ | ✅ | ✅ | AI inpainting |
| CloneModule | `cloneModule` | ❌ | ❌ | ✅ | ✅ | Alt+click source |
| BackgroundRemovalModule | `bgRemovalModule` | ❌ | ❌ | ✅ | ✅ | Transform overlay |
| GodRaysModule | `godRaysModule` | ✅ | ✅ | ✅ | ✅ (preview canvas) | Volumetric light |
| HSLModule | `hslModule` | ✅ | ✅ | ❌ | ❌ | 24 slider params |
| PresetsModule | `presetsModule` | ❌ | ❌ | ❌ | ❌ | Applies to GPU params |
| ToneCurveModule | `toneCurveModule` | ✅ | ✅ | ❌ | ❌ | LUT-based curves |
| ColorGradingModule | `colorGradingModule` | ✅* | ✅* | ❌ | ❌ | *Added in bugfix session |
| TextModule | `textModule` | ✅ | ✅ | ✅ | ❌ | Text overlay manager |
| ComparisonModule | `comparisonModule` | ❌ | ❌ | ❌ | ✅ | Before/after slider |
| ZoomPanModule | `zoomPanModule` | ❌ | ❌ | ❌ | ❌ | Zoom + pan controls |
| ExportModule | `exportModule` | ❌ | ❌ | ❌ | ❌ | File export |
| UpscaleModule | `upscaleModule` | ❌ | ❌ | ❌ | ❌ | AI upscaling |
| KeyboardModule | `keyboardModule` | ❌ | ❌ | ❌ | ❌ | Shortcuts |
| RelightingProModule | `relightingProModule` | ❌ | ❌ | ✅ | ❌ | 3D relighting |
| FeedbackModule | `feedbackModule` | ❌ | ❌ | ❌ | ❌ | Global feedback modal |

## Property Name Conventions

**CRITICAL**: Module properties in `EditorUI` use **abbreviated camelCase**:
- ✅ `bgRemovalModule` (correct)
- ❌ `backgroundRemovalModule` (wrong — was a bug)

The naming convention follows the import alias, not the class name.

## Mode Switching Flow

```
setMode(mode)
  │
  ├─→ _deactivateAllOverlayTools()   // Cleans up: liquify, healing, clone, bgRemoval
  │
  ├─→ Special cleanup for previous mode:
  │     • crop: cropTool.deactivate() + clearTransformPreview()
  │     • godrays: godRaysModule.deactivate()
  │     • text: textModule.deactivate()
  │     • 3d-pro: relightingProModule.deactivate()
  │
  ├─→ state.setTool(mode)
  ├─→ Update toolbar buttons
  ├─→ Hide all mode headers + panels
  │
  └─→ Show target mode panel + activate tool
```

## Destructive Operation Pattern

All modules that modify the source image MUST follow this pattern:

```javascript
// 1. Capture BEFORE
clearTimeout(this.editor._historyDebounceTimer);
const snapshot = this.editor._captureFullState();
this.history.pushState(snapshot);

// 2. Create result
const resultImage = await this._createResult();

// 3. Update state (generates new imageId)
this.state.setImage(resultImage);
this.gpu.loadImage(resultImage);
this.state.originalImage = resultImage;

// 4. Update UI
setTimeout(() => this.editor.renderHistogram(), 100);
```

## GPU Parameter Reference

### Standard params (numeric, default 0):
`exposure`, `contrast`, `highlights`, `shadows`, `whites`, `blacks`, `temperature`, `tint`, `vibrance`, `saturation`, `clarity`, `structure`, `dehaze`

### HSL params (24 total, default 0):
`hslHue{Color}`, `hslSat{Color}`, `hslLum{Color}` where Color ∈ {Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta}

### Color Grading params (default 0):
`shadowsHue`, `shadowsSat`, `shadowsLum`, `midtonesHue`, `midtonesSat`, `midtonesLum`, `highlightsHue`, `highlightsSat`, `highlightsLum`, `colorBalance` (default 0), `colorBlending` (default 50)

### Curve LUT params (default `null`, NOT `0`):
`curveLutRgb`, `curveLutRed`, `curveLutGreen`, `curveLutBlue`

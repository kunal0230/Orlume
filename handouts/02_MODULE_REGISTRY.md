# Orlume — Module Registry

> **Single source of truth** for every module. Table format for machine-readability.

## Module Interface Table

| # | Class Name | Property on `EditorUI` | `getState()` | `setState()` | `deactivate()` | Overlay Canvas | Init Method |
|---|-----------|----------------------|:---:|:---:|:---:|:---:|-------------|
| 1 | `HistoryModule` | `historyModule` | N/A | N/A | N/A | ❌ | constructor only |
| 2 | `CropModule` | `cropModule` | ❌ | ❌ | ✅ (via cropTool) | ❌ (CropTool has overlay) | `.init()` |
| 3 | `LiquifyModule` | `liquifyModule` | ❌ | ❌ | ✅ | ✅ | `.init()` |
| 4 | `HealingModule` | `healingModule` | ❌ | ❌ | ✅ | ✅ | `.init()` |
| 5 | `CloneModule` | `cloneModule` | ❌ | ❌ | ✅ | ✅ | `.init()` |
| 6 | `BackgroundRemovalModule` | **`bgRemovalModule`** | ❌ | ❌ | ✅ | ✅ | `.init()` |
| 7 | `GodRaysModule` | `godRaysModule` | ✅ | ✅ | ✅ | ✅ (preview canvas) | `.init()` |
| 8 | `HSLModule` | `hslModule` | ✅ | ✅ | ❌ | ❌ | `.init()` |
| 9 | `PresetsModule` | `presetsModule` | ❌ | ❌ | ❌ | ❌ | `.init()` |
| 10 | `ToneCurveModule` | `toneCurveModule` | ✅ | ✅ | ❌ | ❌ | `.init()` |
| 11 | `ColorGradingModule` | `colorGradingModule` | ✅ | ✅ | ❌ | ❌ | `.init()` |
| 12 | `TextModule` | `textModule` | ✅ | ✅ | ✅ | ❌ | `.init()` |
| 13 | `ComparisonModule` | `comparisonModule` | ❌ | ❌ | ❌ | ✅ | `.init()` |
| 14 | `ZoomPanModule` | `zoomPanModule` | ❌ | ❌ | ❌ | ❌ | `.init()` |
| 15 | `ExportModule` | `exportModule` | ❌ | ❌ | ❌ | ❌ | `.init()` |
| 16 | `UpscaleModule` | `upscaleModule` | ❌ | ❌ | ❌ | ❌ | `.init()` |
| 17 | `KeyboardModule` | `keyboardModule` | ❌ | ❌ | ❌ | ❌ | `.init()` |
| 18 | `LayersModule` | `layersModule` | ❌ | ❌ | ❌ | ❌ | constructor only |
| 19 | `RelightingProModule` | `relightingProModule` | ❌ | ❌ | ✅ | ❌ | constructor only |
| 20 | `FeedbackModule` | `feedbackModule` | ❌ | ❌ | ❌ | ❌ | `.init()` |
| 21 | `CrashReporterModule` | `crashReporterModule` | ❌ | ❌ | ❌ | ❌ | `.init()` |

### Reading This Table

- **`getState()` / `setState()`**: If ✅, the module participates in undo/redo via `HistoryModule`'s dynamic module discovery. `HistoryModule.captureFullState()` iterates all `editor.*Module` properties and calls `getState()` on any that have it.
- **Overlay Canvas**: If ✅, the module creates a `<canvas>` element positioned over `gpu-canvas`. These modules **MUST** be included in `_deactivateAllOverlayTools()` (see System Contract LAW 9).
- **`deactivate()`**: If ✅, must be called during mode switching cleanup.

---

## Overlay Tool Deactivation Map

`EditorUI._deactivateAllOverlayTools()` cleans up these four:

```javascript
_deactivateAllOverlayTools() {
    this.liquifyModule?.deactivate();
    this.healingModule?.deactivate();
    this.cloneModule?.deactivate();
    this.bgRemovalModule?.deactivate();   // ← NOT backgroundRemovalModule
}
```

Additionally, `setMode()` handles per-mode cleanup:
- **crop** → `cropTool.deactivate()` + `_clearTransformPreview()`
- **godrays** → `godRaysModule.deactivate()`
- **text** → `textModule.deactivate()`
- **3d-pro** → `relightingProModule.deactivate()`

---

## Tool Files (src/tools/)

| Tool Class | File | Used By |
|-----------|------|---------|
| `CropTool` | `tools/CropTool.js` | `CropModule` |
| `LiquifyTool` | `tools/LiquifyTool.js` | `LiquifyModule` |
| `HealingTool` | `tools/HealingTool.js` | `HealingModule` |
| `CloneTool` | `tools/CloneTool.js` | `CloneModule` |

---

## Component Constructors

### ColorGradingWheel

```javascript
new ColorGradingWheel(container, label, onChange, onInteractionEnd)
```

| Param | Type | Description |
|-------|------|-------------|
| `container` | `HTMLElement` | DOM parent to append the wheel into |
| `label` | `string` | Display label (e.g., `'Shadows'`, `'Midtones'`, `'Highlights'`) |
| `onChange` | `(h, s, l) => void` | Called on every drag/slider move (live preview) |
| `onInteractionEnd` | `() => void \| null` | Called on mouseup, slider `change` event, dblclick reset — **use for history push** |

> ⚠️ **If `onInteractionEnd` is omitted or `null`, undo will NOT work for color grading changes.** (System Contract LAW 12)

### ToneCurveEditor

```javascript
new ToneCurveEditor(container, onCurveChange)
```

| Param | Type | Description |
|-------|------|-------------|
| `container` | `HTMLElement` | DOM parent |
| `onCurveChange` | `(channel, lut) => void` | Called when curve is modified. `channel` is `'rgb'`, `'red'`, `'green'`, or `'blue'`. `lut` is a 256-entry `Float32Array` or `null`. |

---

## Module Quirks & Bug Notes

### PresetsModule
- Param name is `structure`, **NOT** `texture`. The `globalSliders` array was fixed.
- After applying a preset, MUST sync all params back to `state` via `setAdjustment()` (System Contract LAW 3).
- Value display IDs use `val-` prefix (System Contract LAW 5).
- `_resetAll()` must sync zeroed params back to `EditorState`.

### GodRaysModule
- Canvas click listener is managed via `activate()`/`deactivate()` using `_boundOnCanvasClick`. It is NOT permanently attached.
- `_applyEffect()` converts result to `HTMLImageElement` via temp canvas → `dataURL` → `new Image()`. Never pass `ImageData` directly to `gpu.loadImage()`.
- Regression note: M6 fix renamed `_initCanvasClick()` → `_onCanvasClick()`. Old call in `init()` was removed.

### HealingModule
- Uses `gpu.toImageData()` to get current canvas content. Never reads WebGPU canvas with 2D context (System Contract LAW 7).

### BackgroundRemovalModule
- `_getCurrentImage()` is async — must `await` it.

### CloneModule
- Does NOT use `setTimeout` for reactivation after apply (System Contract LAW 13).
- `_renderPreview()` was fixed to not aggressively reset canvas dimensions (was causing GPU thrashing).

### ColorGradingModule
- `getState()` and `setState()` were added in a bugfix session — they are not original.
- `updateGrade()` batches 3 param updates into a single `gpu.render()` call (System Contract LAW 14).

### CrashReporterModule
- Reads tool from `editorUI.state.currentTool` (System Contract LAW 6).
- Calls `feedbackModule.openCrashReport(crashData)` to pre-fill the feedback modal.

### MaskSystem & LayersModule
- Operates under both WebGL2 (`MaskSystem.js`) and WebGPU (`MaskSystemWebGPU.js`).
- `GPUProcessor.render()` natively composites active mask adjustments on top of develop adjustments via `applyMaskedAdjustments()`.
- Supports Brush (isotropic stamps with hardness/flow/erase), Radial Gradient (inside-out isotropic falloff with invert), and Linear Gradient (half-plane linear ramp with invert).
- Red rubylith overlay visualization can be toggled via button or 'O' key, and is automatically hidden when navigating away from Masks panel (`isMaskMode = false`).
- Full undo/redo integration in `HistoryModule` captures layer IDs, names, types, visibility, adjustments, and replayed strokes/shapes.
- Automatically handles dimension updates via `onImageDimensionsChanged()` when cropping or upscaling.

### FeedbackModule
- `openModal()` calls `form.reset()` BEFORE setting `toolContextInput.value` (System Contract LAW 11).
- `_injectFeedbackButtons()` injects buttons into all tool panels. Captures tool name automatically.

### HistoryModule
- `imageRegistry` is a `Map<imageId, dataURL>` that stores image versions for destructive undo.
- `_pruneImageRegistry()` cleans up unreferenced images when history changes.
- Dynamic module discovery: iterates `editor.*Module` properties, calls `getState()` on each that has it.
- `restoreState()` calls `this.editor.state.resetAdjustments()` and `this.editor.gpu.reset()`, NOT `this.editor.resetAdjustments()`.

---

## Mode → Panel ID Mapping

| Mode String | Panel ID | Header ID |
|------------|----------|-----------|
| `develop` | `panel-develop` | `develop-mode-tabs` |
| `3d-pro` | `panel-3d-pro` | `relight-pro-mode-header` |
| `export` | `panel-export` | `export-mode-header` |
| `crop` | `panel-crop` | `crop-mode-header` |
| `upscale` | `panel-upscale` | `upscale-mode-header` |
| `liquify` | `panel-liquify` | `liquify-mode-header` |
| `healing` | `panel-healing` | `healing-mode-header` |
| `clone` | `panel-clone` | `clone-mode-header` |
| `hsl` | `panel-hsl` | `hsl-mode-header` |
| `presets` | `panel-presets` | `presets-mode-header` |
| `bg-remove` | `panel-bg-remove` | `bg-remove-mode-header` |
| `godrays` | `panel-godrays` | `godrays-mode-header` |
| `text` | `panel-text` | `text-mode-header` |

---

## File Locations

| Module Type | Directory |
|------------|-----------|
| Feature modules | `src/app/modules/` |
| PRO modules | `src/modules/` |
| Tool classes | `src/tools/` |
| UI components | `src/components/` |
| Effects | `src/effects/` |
| GPU processing | `src/gpu/` |
| ML models | `src/ml/` |
| Services | `src/services/` |
| Presets | `src/presets/` |
| 3D renderer | `src/renderer/` |

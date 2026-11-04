# Orlume — Known Issues & Technical Debt

> **Living register.** Update this file every time you discover a new issue, fix one, or learn of a workaround.

---

## Active Issues

| # | Issue | Affected Module(s) | Severity | Workaround | Status |
|---|-------|-------------------|----------|------------|--------|
| K1 | Comparison "Before" shows post-crop image after destructive ops (not original pre-crop) | `ComparisonModule` | Low | Semi-intended — drawing original onto cropped canvas would stretch. Users may find this confusing. | Open — by design |
| K2 | `ZoomPanModule` and `ComparisonModule` attach permanent `mousemove`/`mouseup` listeners to `document` | `ZoomPanModule`, `ComparisonModule` | Low | Harmless — they short-circuit when not dragging. But technically permanent listeners. | Open — cosmetic |

---

## Resolved Issues (Bug Audit Log)

### Critical Fixes

| # | Date | Bug | File(s) | Root Cause | Fix | Invariant |
|---|------|-----|---------|------------|-----|-----------|
| B1 | May 2026 | BG removal overlay not cleaned up on mode switch | `EditorUI.js` | `_deactivateAllOverlayTools` referenced `this.backgroundRemovalModule` (undefined) instead of `this.bgRemovalModule` | Fixed property name | LAW 4 |
| B2 | May 2026 | `HistoryModule.restoreState()` crashed on undo for all destructive ops | `HistoryModule.js` | Called `this.editor.resetAdjustments()` (doesn't exist) instead of `this.editor.state.resetAdjustments()` + `this.editor.gpu.reset()` | Fixed method path | — |
| B3 | May 2026 | Rendering corrupted after reset following tone curve usage | `PresetsModule.js`, `GPUProcessor.js` | `_resetParams()` and `reset()` set curve LUTs to `0` instead of `null` | Set to `null` | LAW 2 |

### High Priority Fixes

| # | Date | Bug | File(s) | Root Cause | Fix | Invariant |
|---|------|-----|---------|------------|-----|-----------|
| B4 | May 2026 | God rays undo impossible | `GodRaysModule.js` | `_applyEffect()` pushed history AFTER modifying image | Moved push before modification | LAW 1 |
| B5 | May 2026 | God rays crash when passing ImageData to `loadImage()` | `GodRaysModule.js` | Passed `ImageData` directly instead of `HTMLImageElement` | Convert via temp canvas → dataURL → Image | LAW 8 |
| B6 | May 2026 | "Reset All" only reset global sliders | `EditorUI.js` | Didn't reset HSL, Tone Curves, Color Grading, Presets | Added reset calls for all modules | — |
| B7 | May 2026 | Color grading fired 3 GPU renders per slider move | `ColorGradingModule.js` | Called `setParam()` 3 times (Hue, Sat, Lum) | Batch: write to `gpu.params` directly, call `render()` once | LAW 14 |
| B8 | May 2026 | Color grading missing from undo/redo | `ColorGradingModule.js` | No `getState()`/`setState()` methods | Added both methods | — |

### Medium Priority Fixes

| # | Date | Bug | File(s) | Root Cause | Fix | Invariant |
|---|------|-----|---------|------------|-----|-----------|
| B9 | May 2026 | Healing tool crash on init (couldn't read GPU canvas) | `HealingModule.js` | Used raw WebGPU canvas with 2D context | Use `gpu.toImageData()` | LAW 7 |
| B10 | May 2026 | BG removal returned unloaded image | `BackgroundRemovalModule.js` | `_getCurrentImage()` returned Image before `onload` | Made async with proper await | LAW 8 |
| B11 | May 2026 | Clone preview caused GPU thrashing | `CloneModule.js` | Aggressively reset canvas dimensions in `_renderPreview()` | Conditional dimension check | — |
| B12 | May 2026 | Clone tool reactivation race condition | `CloneModule.js` | Used `setTimeout` for reactivation | Removed setTimeout, synchronous flow | LAW 13 |
| B13 | May 2026 | God rays click listener permanent (event leak) | `GodRaysModule.js` | Listener attached in `init()`, never removed | Moved to `activate()`/`deactivate()` | — |
| B14 | May 2026 | Image registry never pruned (memory leak) | `HistoryModule.js` | No cleanup of unreferenced image dataURLs | Added `_pruneImageRegistry()` on history change | — |
| B15 | May 2026 | Preset reset didn't sync to EditorState | `PresetsModule.js` | `_resetAll()` zeroed GPU params but not state | Sync zeroed params back to state | LAW 3 |

### Low Priority / ESLint Fixes

| # | Date | Bug | File(s) | Root Cause | Fix | Invariant |
|---|------|-----|---------|------------|-----|-----------|
| B16 | May 2026 | Preset slider text stays at 0 | `PresetsModule.js` | `getElementById(param)` instead of `getElementById('val-' + param)` | Fixed ID | LAW 5 |
| B17 | May 2026 | Structure slider ignored by presets | `PresetsModule.js` | Array had `'texture'` instead of `'structure'` | Renamed | — |
| B18 | May 2026 | Crash reports show "Unknown" tool | `CrashReporterModule.js` | Read `editorUI.currentTool` instead of `editorUI.state.currentTool` | Fixed path | LAW 6 |
| B19 | May 2026 | ESLint `no-case-declarations` | `CropTool.js`, `BackgroundRemovalModule.js` | `const` in unscoped `case` blocks | Wrapped in `{ }` | LAW 15 |
| B20 | May 2026 | ESLint `no-empty` | `WebGL2Backend.js`, `SegmentationEstimator.js` | Empty blocks | Added comments | LAW 15 |
| B21 | May 2026 | 93 ESLint `no-undef` errors | `eslint.config.js` | Missing browser/WebGPU globals in flat config | Added all | LAW 15 |

### Feedback System Fixes

| # | Date | Bug | File(s) | Root Cause | Fix | Invariant |
|---|------|-----|---------|------------|-----|-----------|
| B22 | May 2026 | form.reset() wiped tool context | `FeedbackModule.js` | Reset called after setting value | Reordered | LAW 11 |
| B23 | May 2026 | FormSubmit.co returning HTTP 521 | — | Third-party service down | Migrated to own Vercel serverless + Resend | LAW 10 |
| B24 | May 2026 | Feedback page showed generic alert for invalid email | `pages/feedback.html` | No client-side validation | Added inline error banner + validation | — |
| B25 | May 2026 | Resend 403 error | `api/feedback.js` | `from` address on testing domain | Switched to `feedback@orlume.io` (verified domain) | — |

### Regression Fixes

| # | Date | Bug | File(s) | Root Cause | Fix | Invariant |
|---|------|-----|---------|------------|-----|-----------|
| R1 | May 2026 | God rays crash on init after M6 fix | `GodRaysModule.js` | M6 renamed `_initCanvasClick()` → `_onCanvasClick()` but left old call in `init()` | Removed stale call | — |
| B26 | May 2026 | Color grading undo not working | `ColorGradingWheel.js`, `ColorGradingModule.js` | No `onInteractionEnd` callback passed to wheel constructor | Added 4th arg | LAW 12 |
| B27 | Nov 2026 | Cloud AI backend maintenance state indicators | `editor.html`, `UpscaleModule.js`, `HealingModule.js`, `BackgroundRemovalModule.js` | Cloud neural inference services for Upscale, Spot Healing, and BG Removal are offline | Preserved offline indicators, banners, and guards by design; marked newly implemented Masks subsystem as Beta | — |
| B28 | Nov 2026 | Image changed / double adjustments when clicking Apply (Crop, Liquify, Clone, Healing, GodRays) | `CropModule.js`, `LiquifyModule.js`, `CloneModule.js`, `HealingModule.js`, `GodRaysModule.js` | Tools read post-shader pixels (`gpu.toImageData()`) and `gpu.loadImage()` re-applied non-zero develop adjustments | Sourced tools from clean `state.originalImage`, cleanly preserving existing adjustments without multiplying | — |
| B29 | Nov 2026 | Upscale crashed on WebGPU backend | `UpscaleModule.js` | Called `upscaleFromWebGL(gpu.gl)` where `gpu.gl` is null on WebGPU | Passed clean canvas source directly to `upscale()` | LAW 7 |
| B30 | Nov 2026 | Relighting Pro Apply button did nothing | `RelightingProModule.js` | No history snapshot, no `state.setImage()`, no UI feedback, no mode transition | Implemented complete apply workflow with LAW 1 history push | LAW 1 |
| B31 | Nov 2026 | Text layers missing on export and hidden prematurely on tool switch | `ExportModule.js`, `TextModule.js` | Export bypassed `TextLayerManager.renderToCanvas()`; deactivation hid overlay when layers existed | Composited text onto export canvas; preserve text visibility across tools | — |
| B32 | Nov 2026 | Radial and linear gradient masks not interactive on canvas | `EditorUI.js`, `MaskSystem.js`, `MaskSystemWebGPU.js` | Canvas event listeners returned early for non-brush tools and linear gradient mask shader dispatch was missing | Added `createLinearMask()` to WebGL2 and WebGPU backends and canvas drag handlers | — |
| B33 | Nov 2026 | Undo destroyed for destructive operations | `HistoryModule.js` | `_pruneImageRegistry()` checked `state.state.imageId` instead of `state.imageId`, deleting all historical images | Checked `state?.imageId || state?.state?.imageId` | — |
| B34 | Nov 2026 | Mask system incomplete & crashing; disappearing on tool switches; aspect ratio distortion; inverted gradients | `MaskSystem.js`, `MaskSystemWebGPU.js`, `MaskShaders.js`, `GPUProcessor.js`, `HistoryModule.js`, `EditorUI.js`, `LayersModule.js` | Mask adjustments bypassed in `GPUProcessor.render()`; WebGPU gradients had flipped Y coords; non-square images stretched circular dabs into ovals; layer undo failed to restore/replay layers; dimension changes wiped layers | Unified mask compositing into `GPUProcessor.render()`; isotropic Euclidean distance calculations in shaders; full layer synchronization and stroke replay in `HistoryModule`; added layer invert, duplicate, overlay toggle ('O'); seamless tool switching | LAW 1, LAW 7, LAW 14 |

---

## Technical Debt

| # | Description | Impact | Suggested Fix |
|---|-------------|--------|---------------|
| D1 | `EditorUI.js` is ~1492 lines — a god object | Hard to navigate, easy to break | Further modularize: extract file handling, brush controls, zoom into modules |
| D2 | Backward-compatibility shims in EditorUI (e.g., `this.cropTool`, `this.liquifyTool`) | Confusing dual access paths | Deprecate shims, use modules directly |
| D3 | Permanent document-level listeners in ZoomPanModule and ComparisonModule | Minor — short-circuit when inactive | Use activate/deactivate pattern like GodRaysModule |
| D4 | `colorBlending` default `50` not handled in `resetAdjustments()` | Reset sets it to 0, not 50 | Add special handling for non-zero defaults |
| D5 | `HistoryModule._pruneImageRegistry()` may have incorrect path check (`state.state.imageId` vs `state.imageId`) | Potential memory leak from un-pruned images | Verify actual snapshot structure and fix path |
| D6 | No automated tests | All validation is manual | Add unit tests for state management, integration tests for undo/redo |
| D7 | `editor.html` is 142KB — all UI in one file | Hard to find specific panel HTML | Consider component-based HTML templating or splitting |

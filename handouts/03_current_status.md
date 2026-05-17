# Project Status & Audit Report

> **Last Updated:** May 2026
> **Context:** A massive system audit was performed to fix bugs in state management, tool cleanup, and GPU parameter syncing.

## ✅ Bugs Fixed

### Critical
1. **[Fixed]** `EditorUI._deactivateAllOverlayTools` was referencing `this.backgroundRemovalModule` instead of `this.bgRemovalModule`. Background removal overlay is now correctly cleaned up.
2. **[Fixed]** `HistoryModule.restoreState()` was calling `this.editor.resetAdjustments()` which crashed undo for all destructive operations (crop, liquify, etc). It now correctly calls `this.editor.state.resetAdjustments()` and `this.editor.gpu.reset()`.
3. **[Fixed]** `PresetsModule._resetParams()` and `GPUProcessor.reset()` were setting curve LUTs to `0` instead of `null`, which corrupted output when resetting after tone curve usage.

### High Priority
4. **[Fixed]** `GodRaysModule._applyEffect()` pushed history *after* modifying the image, making undo impossible. It now captures state before applying.
5. **[Fixed]** `GodRaysModule` was passing `ImageData` directly to `gpu.loadImage()` instead of an HTMLImageElement.
6. **[Fixed]** The "Reset All" button now resets HSL, Tone Curves, Color Grading, and Presets modules in addition to global sliders.
7. **[Fixed]** `ColorGradingModule.updateGrade()` was firing 3 GPU renders per slider move. It now batches parameter updates.
8. **[Fixed]** `ColorGradingModule` was missing `getState()` and `setState()`. It is now fully integrated into the Undo/Redo history stack.

### Medium & Low Priority
9. **[Fixed]** `HealingModule` was attempting to reinitialize its tool using the raw WebGPU canvas, which 2D context cannot read. It now uses `gpu.toImageData()`.
10. **[Fixed]** `BackgroundRemovalModule._getCurrentImage()` returned an Image before it finished loading. It is now properly `async`.
11. **[Fixed]** `CloneModule._renderPreview()` was aggressively resetting canvas dimensions, causing GPU thrashing.
12. **[Fixed]** `CloneModule.apply()` used a `setTimeout` for reactivation, which caused a race condition when switching tools.
13. **[Fixed]** The GodRays click listener is no longer permanently attached to the canvas, preventing event leaks.
14. **[Fixed]** `HistoryModule._pruneImageRegistry()` was implemented to clean up unused Data URLs from memory when history is overwritten.
15. **[Fixed]** `PresetsModule._resetAll()` now syncs the zeroed parameters back to `EditorState` so that history snapshots correctly record the reset state.

## ⚠️ Known Issues Remaining

1. **Comparison Module "Before" image:** After a destructive operation (like Crop), the "Before" view shows the post-crop image (without color adjustments) instead of the absolute original image. This is semi-intended because drawing the absolute original onto a cropped canvas would stretch the image, but it may be unexpected for users.
2. **Permanent Document Listeners:** `ZoomPanModule` and `ComparisonModule` attach `mousemove` and `mouseup` listeners to the `document` during initialization. These are harmless because they short-circuit when not dragging, but are technically permanent listeners.

## Current Architecture Notes
- The app uses a hybrid `Canvas2D` (for UI overlays like Liquify, Clone, Healing) + `WebGPU` (for color processing) architecture.
- Destructive edits (Crop, Liquify, Healing) must **always** push history *before* replacing the `state.originalImage`.
- Curve parameters (`curveLutRgb`, `curveLutRed`, etc.) must be `null` when disabled, never `0`.

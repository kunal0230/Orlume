# Orlume — System Contract

> **LAWS.** These invariants must never be broken. Every rule here was learned from a production bug. Violating any one of them will corrupt state, break undo, crash rendering, or silently lose user work.

---

## LAW 1 — History Push Timing (Destructive Operations)

**For any operation that replaces the source image** (crop, liquify apply, healing apply, bg removal apply, god rays apply, upscale apply):

> **Push history BEFORE modifying state. Never after.**

```javascript
// CORRECT ✅
clearTimeout(this.editor._historyDebounceTimer);
const snapshot = this.editor._captureFullState();
this.editor.history.pushState(snapshot);
// ... now perform the destructive operation ...

// WRONG ❌ — undo will restore to the ALREADY-MODIFIED state
this.state.setImage(newImage);
this.editor.history.pushState(snapshot); // TOO LATE
```

**Root cause:** `GodRaysModule._applyEffect()` originally pushed history after modifying the image, making undo impossible. This is the single most common agent mistake.

---

## LAW 2 — Curve LUT Params: `null`, Never `0`

**The four curve LUT parameters must be `null` when disabled, not `0` or `undefined`.**

| Param | Correct Default | Wrong Default |
|-------|----------------|---------------|
| `curveLutRgb` | `null` | `0` ❌ |
| `curveLutRed` | `null` | `0` ❌ |
| `curveLutGreen` | `null` | `0` ❌ |
| `curveLutBlue` | `null` | `0` ❌ |

Setting them to `0` corrupts the rendering pipeline — the shader interprets `0` as a valid 256-entry LUT of all zeros, mapping every pixel to black.

**Every `reset()` method** that touches curve params must set them to `null`:
```javascript
// CORRECT ✅
if (key.startsWith('curveLut')) {
    this.params[key] = null;
} else {
    this.params[key] = 0;
}
```

**Root cause:** `PresetsModule._resetParams()` and `GPUProcessor.reset()` both originally set curve LUTs to `0`.

---

## LAW 3 — State Sync: GPU ↔ EditorState

**Every slider/adjustment change must update BOTH `GPUProcessor.params` AND `EditorState.globalAdjustments`.**

```javascript
// CORRECT ✅ — both systems are in sync
gpu.setParam(name, value);           // drives rendering
state.setAdjustment(name, value);    // drives undo snapshots

// WRONG ❌ — undo will restore stale values
gpu.setParam(name, value);
// forgot state.setAdjustment()
```

**When writing bulk param updates** (e.g., preset apply), sync ALL params back to state:
```javascript
for (const [param, value] of Object.entries(presetParams)) {
    gpu.setParam(param, value);
    state.setAdjustment(param, value); // MUST do this
}
```

**Root cause:** `PresetsModule._applyPreset()` originally wrote GPU params but never called `state.setAdjustment()`, so undo/redo restored stale values.

---

## LAW 4 — Module Property Naming

**Module properties on `EditorUI` use the import alias, not the class name.**

| Class Name | Correct Property | Wrong Property |
|------------|-----------------|----------------|
| `BackgroundRemovalModule` | `bgRemovalModule` ✅ | `backgroundRemovalModule` ❌ |
| `ColorGradingModule` | `colorGradingModule` ✅ | — |
| `RelightingProModule` | `relightingProModule` ✅ | `relightingModule` ❌ |
| `CrashReporterModule` | `crashReporterModule` ✅ | — |

**Root cause:** `EditorUI._deactivateAllOverlayTools` referenced `this.backgroundRemovalModule` (undefined), so BG removal overlay was never cleaned up.

The naming convention follows the **abbreviated camelCase** pattern:
- `bgRemovalModule` → **bg** = abbreviation of "background"
- `hslModule` → **hsl** = abbreviation
- All others: `lowerCamelCase` of the module purpose (e.g., `godRaysModule`, `toneCurveModule`)

---

## LAW 5 — Slider Display Element IDs

**Value display `<span>` elements use the `val-` prefix. Slider `<input>` elements use the `slider-` prefix.**

```javascript
// CORRECT ✅
const slider = document.getElementById(`slider-${param}`);
const valueDisplay = document.getElementById(`val-${param}`);

// WRONG ❌ — returns the wrong element or null
const valueDisplay = document.getElementById(param);
const valueDisplay = document.getElementById(`slider-${param}`); // that's the input
```

**Root cause:** `PresetsModule._applyPreset()` used `getElementById(param)` instead of `getElementById('val-' + param)`, so display spans never updated.

---

## LAW 6 — State Property Paths

**The current tool is at `editorUI.state.currentTool`, NOT `editorUI.currentTool`.**

```javascript
// CORRECT ✅
const tool = this.editorUI.state.currentTool;

// WRONG ❌ — undefined, because currentTool lives on EditorState, not EditorUI
const tool = this.editorUI.currentTool;
```

**Root cause:** `CrashReporterModule` read `editorUI.currentTool` and always showed "Unknown" for the active tool in crash reports.

---

## LAW 7 — WebGPU Canvas Cannot Be Read with 2D Context

**Never call `canvas.getContext('2d')` on the GPU canvas.** It has a WebGPU/WebGL context and will return `null` for 2D.

```javascript
// CORRECT ✅ — use GPUProcessor's export method
const imageData = gpu.toImageData();

// WRONG ❌ — returns null, causes TypeError
const ctx = document.getElementById('gpu-canvas').getContext('2d');
const imageData = ctx.getImageData(...);
```

**Root cause:** `HealingModule` tried to read the WebGPU canvas with a 2D context to initialize its tool.

---

## LAW 8 — Async Image Loading

**`new Image()` with `.src = url` does NOT load synchronously.** Always use `img.onload`.

```javascript
// CORRECT ✅
const img = new Image();
img.onload = () => {
    state.setImage(img);
    gpu.loadImage(img);
};
img.src = dataUrl;

// WRONG ❌ — image not loaded yet, dimensions are 0
const img = new Image();
img.src = dataUrl;
state.setImage(img); // img.width === 0 at this point
```

**Root cause:** `BackgroundRemovalModule._getCurrentImage()` returned an Image before it finished loading.

---

## LAW 9 — Overlay Tool Deactivation on Mode Switch

**`_deactivateAllOverlayTools()` MUST be called at the start of every `setMode()`.** This cleans up liquify, healing, clone, and bg removal overlays.

```javascript
setMode(mode) {
    this._deactivateAllOverlayTools(); // ALWAYS FIRST
    // ... then deactivate mode-specific tools (crop, godrays, text, 3d-pro)
    // ... then activate new mode
}
```

If a new overlay tool is added, it **MUST** be added to `_deactivateAllOverlayTools()`.

---

## LAW 10 — Feedback System: Use Own Backend

**All feedback/crash reports POST to `/api/feedback` (Vercel serverless → Resend API).** Never use FormSubmit.co, Formspree, or any external form service.

```javascript
// CORRECT ✅
await fetch('/api/feedback', { method: 'POST', body: JSON.stringify(data) });

// WRONG ❌ — third-party service, was returning HTTP 521
await fetch('https://formsubmit.co/...', ...);
```

**Root cause:** FormSubmit.co went down (HTTP 521), breaking all feedback.

---

## LAW 11 — form.reset() Ordering

**When pre-filling a form, call `form.reset()` BEFORE setting input values, never after.**

```javascript
// CORRECT ✅
form.reset();                            // clears all fields
toolContextInput.value = currentTool;    // then set context

// WRONG ❌ — reset() wipes the value you just set
toolContextInput.value = currentTool;
form.reset();                            // oops, context is now empty
```

**Root cause:** `FeedbackModule.openModal()` called `form.reset()` after setting `toolContextInput.value`.

---

## LAW 12 — ColorGradingWheel Constructor: 4th Argument

**`ColorGradingWheel` requires `onInteractionEnd` as its 4th constructor argument for history support.**

```javascript
// CORRECT ✅
new ColorGradingWheel(container, 'Shadows', onChange, () => this.editorUI._pushHistoryDebounced());

// WRONG ❌ — undo won't work for color grading
new ColorGradingWheel(container, 'Shadows', onChange);
```

**Root cause:** Color grading changes couldn't be undone because no `onInteractionEnd` callback was passed.

---

## LAW 13 — No setTimeout for Tool Reactivation

**Never use `setTimeout` to reactivate a tool after apply.** It causes race conditions when the user switches tools during the delay.

```javascript
// CORRECT ✅ — synchronous reactivation or use event/callback
this.deactivate();
this.activate();

// WRONG ❌ — user may have switched tools by the time this fires
setTimeout(() => this.activate(), 100);
```

**Root cause:** `CloneModule.apply()` used `setTimeout` for reactivation, causing a race condition.

---

## LAW 14 — setParam() Triggers Render

**Each call to `gpu.setParam(name, value)` triggers a full GPU render.** When updating multiple params, batch them:

```javascript
// CORRECT ✅ — one render
gpu.params.shadowsHue = h;
gpu.params.shadowsSat = s;
gpu.params.shadowsLum = l;
gpu.render();

// WRONG ❌ — three full renders
gpu.setParam('shadowsHue', h);
gpu.setParam('shadowsSat', s);
gpu.setParam('shadowsLum', l);
```

**Root cause:** `ColorGradingModule.updateGrade()` originally fired 3 renders per slider move.

---

## LAW 15 — ESLint Globals (Flat Config)

**ESLint 9+ flat config has no `env: { browser: true }`.** All browser/WebGPU globals must be listed explicitly in `eslint.config.js`.

When using a new browser API (e.g., `IntersectionObserver`, `ResizeObserver`), **add it to the globals list** or it will trigger `no-undef`.

When using `const` inside a `switch` `case`, **wrap the case body in `{ }`** or it triggers `no-case-declarations`.

---

## LAW 16 — Environment Variables

| Context | Prefix | Location |
|---------|--------|----------|
| Serverless functions | None (e.g., `RESEND_API_KEY`) | Vercel Dashboard → Settings → Env Vars |
| Client-side (Vite) | `VITE_` prefix | `.env.local` |

**Never put server secrets in `.env.local`** — they'd be bundled into the client.

---

## Quick Checklist Before Writing Code

Before modifying any file, confirm:

- [ ] Am I pushing history BEFORE the destructive operation?
- [ ] Am I setting curve LUT defaults to `null`, not `0`?
- [ ] Am I updating both `gpu.setParam()` AND `state.setAdjustment()`?
- [ ] Am I using the correct module property name (e.g., `bgRemovalModule`)?
- [ ] Am I using `val-${param}` for display spans and `slider-${param}` for inputs?
- [ ] Am I using `editorUI.state.currentTool`, not `editorUI.currentTool`?
- [ ] Am I using `gpu.toImageData()` instead of trying `canvas.getContext('2d')`?
- [ ] Am I waiting for `img.onload` before using the image?

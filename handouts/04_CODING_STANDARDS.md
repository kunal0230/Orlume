# Orlume — Coding Standards

> **Every agent must follow these rules** when writing new code for this project. Copy-pasteable templates for common operations.

---

## 1. File Placement

| What you're adding | Where it goes |
|-------------------|--------------|
| New feature module | `src/app/modules/NewFeatureModule.js` |
| New tool class (canvas-based) | `src/tools/NewTool.js` |
| New UI component (reusable widget) | `src/components/NewComponent.js` |
| New effect processor | `src/effects/NewEffect.js` |
| New ML model wrapper | `src/ml/NewEstimator.js` |
| New external API service | `src/services/NewService.js` |
| New PRO-only module | `src/modules/NewProModule.js` |
| New preset pack | `src/presets/` |
| New shader | `src/gpu/shaders/` |
| New serverless function | `api/new-function.js` |
| New static page | `pages/new-page.html` |

---

## 2. Naming Conventions

### Module Properties
Module instances on `EditorUI` use **abbreviated camelCase** matching the import alias:

```javascript
// In EditorUI constructor:
this.bgRemovalModule = new BackgroundRemovalModule(this);  // "bg" abbreviation
this.hslModule = new HSLModule(this);                      // "hsl" abbreviation
this.godRaysModule = new GodRaysModule(this);              // camelCase of name
```

### DOM Element IDs
| Element Type | Pattern | Example |
|-------------|---------|---------|
| Slider input | `slider-{param}` | `slider-exposure` |
| Value display | `val-{param}` | `val-exposure` |
| Mask slider | `slider-mask-{param}` | `slider-mask-exposure` |
| Mask value | `val-mask-{param}` | `val-mask-exposure` |
| Tool button | `tool-{mode}` | `tool-develop` |
| Panel section | `panel-{mode}` | `panel-develop` |
| Mode header | `{mode}-mode-header` | `crop-mode-header` |
| Action button | `btn-{action}` | `btn-reset`, `btn-export` |

### CSS Classes
- Tool buttons: `.tool-btn`
- Panel sections: `.panel-section`
- Mask tool buttons: `.mask-tool-btn`

### Callback Naming
- Event handler methods: `_onEventName` (e.g., `_onCanvasClick`)
- Private methods: `_methodName` (leading underscore)
- History push: `_pushHistoryDebounced()`
- State capture: `_captureFullState()`

---

## 3. Event Listener Hygiene

### `input` vs `change` Events

| Event | When to Use | Purpose |
|-------|------------|---------|
| `input` | Fires on every value change (drag) | Live preview — update GPU + display |
| `change` | Fires on commit (mouseup) | Push to history for undo support |

```javascript
// TEMPLATE: Standard slider setup
slider.addEventListener('input', () => {
    const value = parseFloat(slider.value);
    valueDisplay.textContent = formatValue(value);
    this.gpu.setParam(name, value);
    this.state.setAdjustment(name, value);
    requestAnimationFrame(() => this.renderHistogram());
});

slider.addEventListener('change', () => {
    this._pushHistoryDebounced();  // commit to undo stack
});

slider.addEventListener('dblclick', () => {
    slider.value = defaultValue;
    valueDisplay.textContent = formatDefault();
    this.gpu.setParam(name, defaultValue);
    this.state.setAdjustment(name, defaultValue);
    this._pushHistoryDebounced();
});
```

### Cleanup Pattern for Overlay Tools

```javascript
activate() {
    if (!this._boundHandler) {
        this._boundHandler = this._onEvent.bind(this);
    }
    canvas.addEventListener('click', this._boundHandler);
}

deactivate() {
    if (this._boundHandler) {
        canvas.removeEventListener('click', this._boundHandler);
    }
}
```

**Never attach permanent listeners** for tools that are only active in one mode. Bind on `activate()`, unbind on `deactivate()`.

---

## 4. History Push Pattern (Destructive Operations)

**Copy-paste this template** for any operation that replaces the source image:

```javascript
async applyMyTool() {
    if (!this._hasResult()) return;

    // ── STEP 1: Cancel pending debounce ──
    clearTimeout(this.editor._historyDebounceTimer);

    // ── STEP 2: Capture BEFORE state ──
    const snapshot = this.editor._captureFullState();

    // ── STEP 3: Push BEFORE modifying ──
    this.editor.history.pushState(snapshot);

    // ── STEP 4: Create result image ──
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.resultWidth;
    tempCanvas.height = this.resultHeight;
    const ctx = tempCanvas.getContext('2d');
    // ... draw result to tempCanvas ...
    const dataUrl = tempCanvas.toDataURL('image/png');

    // ── STEP 5: Load result (async!) ──
    const img = new Image();
    img.onload = () => {
        // Update state (generates new imageId)
        this.state.setImage(img);
        this.state.originalImage = img;

        // Load into GPU
        this.gpu.loadImage(img);

        // Update UI
        if (this.editor.elements.perfIndicator) {
            this.editor.elements.perfIndicator.textContent = `${img.width}×${img.height}`;
        }
        setTimeout(() => this.editor.renderHistogram(), 100);

        // Deactivate tool
        this.deactivate();
    };
    img.src = dataUrl;
}
```

---

## 5. State Update Pattern (Slider → GPU + State + Display + History)

**For non-destructive adjustments** (e.g., a new slider):

```javascript
// In module init():
const slider = document.getElementById('slider-myParam');
const display = document.getElementById('val-myParam');

slider.addEventListener('input', () => {
    const value = parseFloat(slider.value);
    display.textContent = Math.round(value);

    // Update BOTH systems (System Contract LAW 3)
    this.gpu.setParam('myParam', value);
    this.state.setAdjustment('myParam', value);

    requestAnimationFrame(() => this.editorUI.renderHistogram());
});

// Commit to history on release
slider.addEventListener('change', () => {
    this.editorUI._pushHistoryDebounced();
});
```

---

## 6. Module Integration Checklist

When adding a new module:

- [ ] Create class in `src/app/modules/`
- [ ] Export from `src/app/modules/index.js`
- [ ] Import and instantiate in `EditorUI` constructor
- [ ] Call `.init()` in `EditorUI._initEventListeners()` (if needed)
- [ ] If it has an overlay canvas → add to `_deactivateAllOverlayTools()`
- [ ] If it has `getState()`/`setState()` → it auto-integrates with undo/redo
- [ ] If it has `deactivate()` → add cleanup to `setMode()` for its mode
- [ ] Add mode `case` in `setMode()` switch statement
- [ ] Add panel HTML in `editor.html`
- [ ] Add mode header hide in `setMode()`'s "hide all headers" block
- [ ] Update `02_MODULE_REGISTRY.md` with new module entry

---

## 7. ESLint Rules

### Adding New Globals
When using a new browser/WebGPU API, add it to `eslint.config.js`:
```javascript
globals: {
    // ... existing globals ...
    NewApiName: 'readonly',  // FIXED: missing-browser-globals
}
```

### The `no-case-declarations` Fix
Wrap `case` blocks containing `const`/`let` in braces:
```javascript
// WRONG ❌
case 'example':
    const result = compute();
    break;

// CORRECT ✅
case 'example': {
    const result = compute();
    break;
}
```

### The `no-empty` Fix
Add an explanatory comment to empty blocks:
```javascript
// WRONG ❌
if (condition) {
} else {
}

// CORRECT ✅
if (condition) {
    // Intentionally empty: condition handled by side effect
} else {
    // No action needed for this branch
}
```

---

## 8. Comment Conventions

### `// FIXED:` Tag System
Every bug fix line in the codebase is marked with:
```javascript
// FIXED: descriptive-tag-name
```
Example tags: `color-grading-history`, `missing-browser-globals`, `preset-state-sync`

This lets agents search for all fixes and understand their rationale.

### JSDoc
Add JSDoc for:
- Public module methods
- Constructor params (especially non-obvious ones)
- Complex return types

```javascript
/**
 * Apply the healing result to the main canvas.
 * Follows the destructive operation template (see CODING_STANDARDS.md §4).
 * @returns {Promise<void>}
 */
async applyHealing() { ... }
```

### Module Headers
Every module file starts with:
```javascript
/**
 * ModuleName.js - Brief one-line description
 *
 * Handles:
 * - Bullet point of responsibility
 * - Another responsibility
 */
```

---

## 9. Anti-Patterns (What NOT To Do)

| ❌ Don't | ✅ Do Instead | Why |
|----------|-------------|-----|
| `getElementById(param)` for display | `getElementById('val-' + param)` | Bare param is the wrong element ID |
| `editorUI.currentTool` | `editorUI.state.currentTool` | `currentTool` lives on State, not UI |
| `this.backgroundRemovalModule` | `this.bgRemovalModule` | Property uses abbreviated name |
| `canvas.getContext('2d')` on GPU canvas | `gpu.toImageData()` | GPU canvas has WebGPU/WebGL context |
| `form.reset()` after setting values | `form.reset()` before setting values | reset() clears all values |
| `curveLut = 0` | `curveLut = null` | `0` corrupts shader output |
| `setTimeout(() => activate())` after apply | Synchronous reactivation or event callback | Race condition with mode switches |
| `FormSubmit.co` or external form services | `POST /api/feedback` | Own backend, no 3rd-party dependency |
| `img.src = url; use(img);` | `img.onload = () => use(img);` | Image loading is async |
| History push after destructive op | History push BEFORE destructive op | Undo restores wrong state |
| Multiple `setParam()` calls | Batch to `gpu.params[x] = v; gpu.render()` | Each setParam triggers full render |
| `new ColorGradingWheel(c, l, cb)` (3 args) | `new ColorGradingWheel(c, l, cb, histCb)` (4 args) | Missing 4th arg = no undo |
| Putting secrets in `.env.local` | Vercel Dashboard env vars | `.env.local` is client-side only via Vite |

---

## 10. GPU Image Load Pattern (Safe Handoff)

`GPUProcessor.loadImage()` uses the Safe Handoff pattern to prevent "destroyed texture" errors:

```
1. Create NEW texture from image
2. Store reference to OLD texture
3. ATOMIC SWAP: this.inputTexture = newTexture
4. Render with new texture (synchronous)
5. Delete old texture (now safe)
```

**Never delete the current texture before creating the replacement.** Stale render commands will reference the deleted texture and crash.

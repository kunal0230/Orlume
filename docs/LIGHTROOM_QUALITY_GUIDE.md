# Lightroom-Quality Core Tools - Implementation Guide

> **Version:** 1.1  
> **Status:**  Phase 1 Complete (Clarity, Texture, Dehaze Implemented)  
> **Last Updated:** 2026-01-30  
> **Goal:** Match or exceed Adobe Lightroom Classic's Develop module quality

---

## Progress Tracker

### Develop Panel

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| Exposure | ✅ Done | - | 2^x stops, working well |
| Contrast | ✅ Done | - | Filmic S-curve |
| Highlights | ✅ Done | - | Tone-mapped recovery |
| Shadows | ✅ Done | - | Luminance-masked lifting |
| Whites | ✅ Done | - | Soft clipping implemented |
| Blacks | ✅ Done | - | Point control implemented |
| Temperature | ✅ Done | - | Bradford adaptation |
| Tint | ✅ Done | - | Works |
| Vibrance | ✅ Done | - | Skin protection |
| Saturation | ✅ Done | - | OKLAB-based |
| **Clarity** | ✅ Done | P0 | Frequency Separation implemented |
| **Texture** | ✅ Done | P0 | Implemented via `u_structure` |
| **Dehaze** | ✅ Done | P0 | Dark channel approximation |

### HSL Panel

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| Hue per color | ✅ Done | - | 8 colors |
| Saturation per color | ✅ Done | - | 8 colors |
| Luminance per color | ✅ Done | - | 8 colors |
| Color picker | 🔲 New | P2 | Click to identify channel |
| Improved weights | 🔲 Upgrade | P1 | Gaussian falloff |
| Luminosity weighting | 🔲 New | P2 | Adjust by brightness |

### Color Grading (NEW)

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| Shadows wheel | 🔲 New | P1 | Hue + Saturation |
| Midtones wheel | 🔲 New | P1 | Hue + Saturation |
| Highlights wheel | 🔲 New | P1 | Hue + Saturation |
| Blending control | 🔲 New | P1 | Zone transitions |
| Balance control | 🔲 New | P1 | Shadows vs Highlights |
| Per-zone luminance | 🔲 New | P2 | Brightness per zone |

### Tone Curve

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| Point curve (RGB) | ✅ Done | - | Bezier control |
| Per-channel curves | ✅ Done | - | R/G/B separate |
| Parametric mode | 🔲 New | P2 | Slider-based zones |
| Histogram overlay | ✅ Done | P3 | Show distribution |
| Curve presets | 🔲 New | P3 | S-curve, Film, etc. |

### Effects

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| **Vignette** | 🔲 New | P1 | Amount/Midpoint/Feather |
| **Film Grain** | 🔲 New | P2 | Amount/Size/Roughness |
| **LUT Support** | 🔲 New | P1 | .cube file loading |
| Filter presets | 🔲 New | P2 | Built-in looks |

---

## Implementation Priority

### Phase 1: Core Develop (Done)

- [x] Clarity effect (2-pass GPU processing)
- [x] Texture effect (micro-contrast as `u_structure`)
- [x] Dehaze (approximation)
- [x] Improved Highlights/Shadows recovery
- [x] Improved Whites/Blacks point control

### Phase 2: Color & Effects (Next)

- [ ] Color Grading (3-way wheels) - shader
- [ ] Color Grading - UI components
- [ ] Vignette effect
- [ ] Film Grain effect
- [ ] LUT support (.cube loading)

### Phase 3: Polish (Future)

- [ ] Tone Curve parametric mode
- [ ] HSL color picker
- [x] Improved white balance (Bradford)
- [x] Improved vibrance (skin protection)
- [ ] Built-in filter presets

---

## Technical Implementation

### New Uniforms Required

```glsl
// Develop Panel - New
uniform float u_clarity;      // -100 to +100
uniform float u_texture;      // -100 to +100
uniform float u_dehaze;       // -100 to +100

// Color Grading
uniform vec2 u_shadowsColor;      // x=hue (0-1), y=saturation (0-1)
uniform float u_shadowsLum;       // -100 to +100
uniform vec2 u_midtonesColor;
uniform float u_midtonesLum;
uniform vec2 u_highlightsColor;
uniform float u_highlightsLum;
uniform float u_colorBalance;     // -100 to +100
uniform float u_colorBlending;    // 0-100

// Effects
uniform float u_vignetteAmount;    // -100 to +100
uniform float u_vignetteMidpoint;  // 0-100
uniform float u_vignetteRoundness; // -100 to +100
uniform float u_vignetteFeather;   // 0-100
uniform float u_grainAmount;       // 0-100
uniform float u_grainSize;         // 0-100
uniform float u_grainRoughness;    // 0-100
uniform sampler3D u_lut;           // 3D LUT texture
uniform float u_lutIntensity;      // 0-100
```

### Multi-Pass Rendering (For Clarity/Texture)

```
Pass 1: Gaussian Blur (σ = 2-3% of width) → blurTexture
Pass 2: Develop shader with clarity using blurTexture
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/gpu/shaders/develop.glsl` | Externalized develop shader |
| `src/gpu/shaders/effects.glsl` | Vignette, grain, LUT shaders |
| `src/gpu/shaders/blur.glsl` | Gaussian blur for clarity |
| `src/effects/LUTProcessor.js` | .cube file parsing & 3D texture |
| `src/components/ColorWheel.js` | Color grading wheel UI |
| `src/presets/FilterPresets.js` | Built-in filter definitions |

## Files to Modify

| File | Changes |
|------|---------|
| `src/gpu/WebGL2Backend.js` | New uniforms, multi-pass rendering |
| `src/gpu/WebGPUBackend.js` | Same changes for WebGPU |
| `src/gpu/GPUProcessor.js` | New params in default state |
| `src/app/EditorUI.js` | Color grading UI, new controls |
| `src/app/modules/DevelopModule.js` | Wire up new sliders |

---

## Quality Benchmarks

After implementation, test these scenarios:

| Test | Expected Result |
|------|-----------------|
| Exposure ±5 stops | No banding or clipping artifacts |
| Shadow recovery +100 | No visible noise amplification |
| Highlight recovery -100 | No color shift in recovered areas |
| White balance extremes | Accurate, no color pollution |
| HSL hue shift | No visible color transitions |
| Color grading | Smooth zone blending |
| LUT application | Matches reference implementation |
| 24MP image processing | <50ms total render time |

---

## Reference Materials

### Color Science

- [OKLAB Color Space](https://bottosson.github.io/posts/oklab/)
- [Bradford Chromatic Adaptation](http://www.brucelindbloom.com/index.html?Eqn_ChromAdapt.html)
- [CIE Color Calculator](http://www.brucelindbloom.com/)

### Algorithms

- [Dark Channel Prior (Dehaze)](https://kaiminghe.github.io/publications/pami10dehaze.pdf)
- [High-Pass Sharpening](https://en.wikipedia.org/wiki/Unsharp_masking)
- [Filmic Tone Mapping](https://www.gdcvault.com/play/1012351/Uncharted-2-HDR)

### LUT Formats

- [.cube LUT Specification](https://wwwimages2.adobe.com/content/dam/acom/en/products/speedgrade/cc/pdfs/cube-lut-specification-1.0.pdf)

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-27 | 1.0 | Initial plan created |

---

*This document is updated as features are implemented. Check boxes indicate completion status.*

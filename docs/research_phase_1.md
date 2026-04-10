# Research Phase 1: Learned Confidence for Hybrid SH Relighting

**Contribution C1 — The First Publication**

---

## Context & Goals

### What This Is
This is **not** a thesis. This is a focused research effort to:
1. Build a strong research profile for approaching computational imaging labs for internship
2. Produce the **first of 3 planned publications** from the Orlume project
3. Demonstrate ability to formalize, experiment, and publish — the skill labs want to see

### The Big Picture (3 Publications)

| # | Paper | When | Status |
|---|---|---|---|
| **P1** | Learned Confidence for Hybrid SH Relighting | **End of 2026** | ← **THIS DOCUMENT (Phase 1)** |
| P2 | Task-Driven Intrinsic Decomposition for SH Transfer | Mid 2027 | Phase 2 (future) |
| P3 | Neural G-Buffer Fusion for Deferred Relighting | Late 2027 | Phase 3 (future) |

### Why C1 First?
- **Smallest scope**: ~15K parameter model, ~30KB deployed, trains in hours not days
- **Cleanest novelty**: Formalizing the ratio/albedo tradeoff as a per-pixel optimization and training a lightweight predictor within a real-time browser pipeline — the *application-specific + efficiency* angle is genuinely new, even though learned uncertainty is a known concept in other vision tasks (depth, flow)
- **Independently publishable**: Doesn't need intrinsic decomposition (C2) or G-buffer refinement (C3)
- **Directly builds on existing code**: The hand-tuned heuristic is already in the shader (line 291 of `deferred_lighting.wgsl`, line 773 of `WebGL2DeferredRenderer.js`) — we formalize and improve it
- **Strong for internship profile**: Shows you can take an engineering system, identify a research gap, formalize it mathematically, and validate experimentally

### Target Conferences (Realistic for End-of-2026 Submission)

| Conference | Submission Deadline | Decision | Fit |
|---|---|---|---|
| **ACCV 2026** | **July 5, 2026** | ~Sep 2026 | ⭐ PRIMARY TARGET — Asian CV conference, good for first paper, competitive but not CVPR-level |
| **WACV 2027** | ~Aug 2026 (TBA) | ~Oct 2026 | ⭐ BACKUP — Winter CV conference, well-respected, good fit for applied CV |
| **CVPR 2027** | ~Nov 2026 | ~Feb 2027 | STRETCH — Top venue, submit if ACCV goes well, can improve paper with reviews |
| **BMVC 2026** | May 29, 2026 | ~Aug 2026 | TOO TIGHT — Only 7 weeks from now, not enough time |

**Primary plan**: Submit to **ACCV 2026** (deadline July 5). That gives us **12 weeks** from today (April 10).

### Go/No-Go Checkpoints (Hard Rules)

| Date | Checkpoint | Pass Criteria | If FAIL → |
|---|---|---|---|
| **May 7** | Differentiable renderer validated | SH core PSNR > 45dB vs WebGL2 | Switch target to WACV 2027 (~Aug deadline) |
| **May 21** | Synthetic data ready + baselines computed | ≥ 150 scenes rendered, baseline PSNR measured | Pivot to Kubric/existing datasets |
| **June 4** | ConfNet beats hand-tuned heuristic | ≥ 0.3 dB PSNR improvement on val set | Pivot to study paper (error analysis only, no trained model) |
| **June 18** | Browser integration works | ONNX model runs in browser, < 50ms on target hardware | Ship WASM fallback; drop "real-time" claim |

### Co-Author / Advisor Note

> **IMPORTANT**: Submitting as a sole author with no faculty advisor significantly reduces acceptance odds at any venue. Reviewers are less forgiving on experimental gaps. **Action item (Week 1)**: Reach out to a professor (at your university or a collaborator) who works in computational imaging/photography. Even a nominal supervisory role adds credibility. Target: TU Graz IVC lab, or any advisor familiar with inverse rendering.

---

## The Research Question (One Sentence)

> *Can a lightweight learned predictor, given G-buffer features, produce per-pixel blend weights that predict the relative reliability of two complementary SH relighting estimators, consistently outperforming fixed heuristics across diverse scenes — with negligible overhead (~5ms for ConfNet alone) in a browser deployment?*

---

## The Exact Problem We're Solving

### Current Code (The Hand-Tuned Heuristic)

In both our WGSL and GLSL shaders, line 289-291 of `deferred_lighting.wgsl`:

```wgsl
// Blend: use albedo method where shading is confident, ratio where not
let albedoConfidence = smoothstep(0.15, 0.5, origSH);
let baseResult = mix(ratioResult, albedoResult, albedoConfidence * 0.6);
```

This says: "If the original SH evaluation is strong (origSH > 0.5), trust the albedo method 60%. If weak (origSH < 0.15), use only the ratio method."

**Problems**:
1. The thresholds `0.15`, `0.5` are hand-picked — there's no principled reason for these values
2. The max blend weight `0.6` is arbitrary — why not 0.7? 0.4?
3. The confidence depends ONLY on `origSH` magnitude — it ignores depth quality, normal quality, material type, surface curvature, all of which affect relighting quality
4. It's a scalar function of one variable — the optimal blending is a function of the full G-buffer

### What We Replace It With

A **tiny neural network** (4 conv layers, ~15K params) that takes 8 G-buffer features as input and outputs a per-pixel blend weight `w ∈ [0, 1]`:

```
shader line 291 becomes:
let baseResult = mix(ratioResult, albedoResult, confNetOutput);
```

Where `confNetOutput` is computed by the ConfNet from the G-buffer before the shader runs.

---

## Detailed 12-Week Plan

### Overview

```
Week  1-2:  Literature Review + Mathematical Formalization
Week  3-4:  Differentiable Renderer (PyTorch mirror of our shader)
Week  5-6:  Synthetic Data Pipeline (Blender) + Baseline Metrics
Week  7-8:  ConfNet Training + Ablations
Week  9-10: Browser Integration + Self-Supervised Fine-Tuning
Week 11-12: Paper Writing + Submission
```

---

### Week 1-2: Literature Review + Mathematical Formalization

**Goal**: Understand the field deeply enough to position our contribution. Write the formal math that turns our shader heuristic into a research problem.

#### Week 1 (April 10 – April 16)

**Day 1-2: Core SH Relighting Papers**

Read and annotate these papers. For each, write 3-4 sentences: what they do, what's missing, how we differ.

| # | Paper | Year | Why Read It |
|---|---|---|---|
| 1 | Ramamoorthi & Hanrahan — "An Efficient Representation for Irradiance Environment Maps" | 2001 | Foundation of SH lighting. Our SH9/SH7 evaluation directly implements their math. |
| 2 | Zhou et al. — "Deep Single-Image Portrait Relighting" (DPR) | 2019 | Most similar approach to ours (SH-based, single image). We must differentiate from this. |
| 3 | Pandey et al. — "Total Relighting" | 2021 | Stronger method but server-only. Our speed advantage. |
| 4 | Sun et al. — "Single Image Portrait Relighting" | 2019 | Another SH approach. Shows ratio-based relighting. |
| 5 | Nestmeyer et al. — "Learning Physics-guided Face Relighting" | 2020 | Self-supervised decomposition for relighting. Our C2 predecessor. Shows the coupling is studied. |

**Day 3-4: Uncertainty/Confidence Papers**

| # | Paper | Year | Why Read It |
|---|---|---|---|
| 6 | Poggi et al. — "On the Uncertainty of Self-Supervised Monocular Depth Estimation" | 2020 | Closest to what we do: predicting where a vision system will fail. But for depth, not relighting. |
| 7 | Kendall & Gal — "What Uncertainties Do We Need in Bayesian Deep Learning for CV?" | 2017 | Foundational uncertainty paper. Aleatoric vs epistemic. We model aleatoric uncertainty. |
| 8 | Lakshminarayanan et al. — "Simple and Scalable Predictive Uncertainty" | 2017 | Deep ensembles for uncertainty. Alternative to our single-network approach. |
| 9 | Ilg et al. — "Uncertainty Estimates for Optical Flow" | 2018 | Learned uncertainty in optical flow. Methodology translates to our problem. |

**Day 5: Related Hybrid Methods**

| # | Paper | Year | Why Read It |
|---|---|---|---|
| 10 | Yu & Smith — "InverseRenderNet" | 2019 | Intrinsic + relighting. Our C2 predecessor but we differentiate on confidence. |
| 11 | Sengupta et al. — "SfSNet" | 2018 | Face intrinsic decomposition. Narrow scope (faces only) vs our general approach. |
| 12 | Liu et al. — "Neural Intrinsic Decomposition with Self-Supervised Shading Guidance" | 2024 | Most recent decomposition work. Don't need to beat this for C1. |

**Deliverable**: Annotated bibliography (2-3 pages) in `docs/research/literature_review.md`

---

#### Week 2 (April 17 – April 23)

**Day 1-3: Mathematical Formalization**

This is the theoretical core of the paper. Formalize what our shader does into equations.

**Section A: Image Formation Model**

Define the forward rendering model our shader implements:

```
I_relit(p) = f(A(p), N(p), D(p), M(p), L_new, L_orig)

where:
  p     = pixel position
  A(p)  = albedo (currently = original image, since no decomposition)
  N(p)  = surface normal (from depth-derived + neural blend)
  D(p)  = depth (from Depth Anything V2)
  M(p)  = material properties (roughness, metallic, from SegFormer + DB)
  L_new = target lighting (SH9 coefficients, 9 values)
  L_orig= estimated original lighting (SH7 coefficients, 7 values)
```

**Section B: The Two Relighting Methods**

Formalize the ratio and albedo methods:

```
Method R (Ratio):
  I_R(p) = I_orig(p) × [SH₉(N(p), L_new) / max(SH₇(N(p), L_orig), ε₁)]
  where ε₁ = 0.08 (our shader value)

Method A (Albedo):  
  Â(p)   = I_orig(p) / max(SH₇(N(p), L_orig), ε₂)      [de-light]
  Â(p)   = min(Â(p), τ)                                   [clamp, τ = 1.5]
  I_A(p) = Â(p) × max(SH₉(N(p), L_new), 0) × κ + Â(p) × α
  where ε₂ = 0.25, κ = 2·intensity, α = ambient (our shader values)
```

**Section C: Error Analysis (THE NOVEL PART)**

Derive when each method fails:

```
Error of Ratio method:
  E_R(p) = |I_R(p) - I_GT(p)|
  
  Case 1: When L_new ≈ L_orig (small lighting change)
    SH₉(N, L_new) / SH₇(N, L_orig) ≈ 1 → I_R ≈ I_orig ✓ (ratio works)
    
  Case 2: When SH₇(N, L_orig) ≈ 0 (original shadow region)
    Ratio = SH₉(N, L_new) / ε₁ → can be huge → I_R blows up ✗
    But clamp at ε₁ = 0.08 limits the ratio → still produces artifacts

  Case 3: When SH₉(N, L_new) ≈ 0 (target shadow region)
    Ratio ≈ 0 → I_R ≈ 0 → entire pixel goes black ✗
    Original texture is destroyed

Error of Albedo method:
  E_A(p) = |I_A(p) - I_GT(p)|

  Case 1: When SH₇(N, L_orig) is large (well-lit region)
    Â(p) = I_orig / SH₇ is stable → I_A is good ✓
    
  Case 2: When SH₇(N, L_orig) ≈ 0 (shadow region)
    Â(p) = I_orig / ε₂ → albedo overestimated → I_A blows up ✗
    Even with clamp τ = 1.5, the estimated albedo is wrong

  Case 3: When normals N(p) are noisy
    SH₇ evaluation is wrong → division by wrong value → cascading error ✗
```

**Section D: The Confidence Problem**

```
Current heuristic:
  w(p) = 0.6 × smoothstep(0.15, 0.5, SH₇(N(p), L_orig))
  I_hybrid(p) = (1 - w(p)) × I_R(p) + w(p) × I_A(p)

Limitations:
  1. w depends only on origSH — ignores normal quality, depth quality, material
  2. Maximum blend is 0.6 — never fully trusts albedo method
  3. Fixed thresholds — not adapted to image content

Proposed:
  w(p) = ConfNet(D(p), N(p), M(p), SH₇(N(p), L_orig), ∇D(p), σ²_N(p))
  
  where ConfNet : R^8 → [0, 1] is a lightweight CNN
  
  Trained with supervision:
    w*(p) = argmin_w |w · I_A(p) + (1-w) · I_R(p) - I_GT(p)|
```

> **THEORETICAL LIMITATION (Strategic Fix #2 — Convex Span Assumption)**:
> The formulation restricts the solution to `w · I_A + (1-w) · I_R`, i.e. convex combinations of the two estimators. This **cannot correct errors when both methods fail** (e.g., specular highlights, GI effects outside the SH model). This is our biggest theoretical weakness.
>
> **In the paper, state explicitly**: "We restrict the solution space to convex combinations for efficiency and interpretability; extending to residual correction is future work."
>
> **In supplementary, include a residual experiment** (small effort, large reviewer value):
> ```python
> # training/confnet_residual.py — Extension experiment for supplementary
> class ConfNetResidual(nn.Module):
>     def __init__(self):
>         super().__init__()
>         self.weight_net = ConfNet()  # predicts w
>         self.residual_net = nn.Sequential(
>             nn.Conv2d(8, 16, 3, padding=1), nn.ReLU(),
>             nn.Conv2d(16, 3, 1)  # predicts RGB residual
>         )
>     
>     def forward(self, gbuffer, I_A, I_R):
>         w = self.weight_net(gbuffer)
>         blend = w * I_A + (1 - w) * I_R
>         residual = torch.tanh(self.residual_net(gbuffer))  # bounded [-1, 1]
>         return torch.clamp(blend + 0.1 * residual, 0.0, 1.0)  # safe output
> ```
> Even if the gain is small (~0.1 dB), it preemptively addresses the convex span objection. Report it as: "Residual correction provides marginal improvement (X dB), confirming that the primary error source is the ratio/albedo tradeoff, not model expressiveness."

**Day 4-5: Write Related Work Section Draft**

Write a 3-page related work section covering:
1. SH-based relighting (Ramamoorthi, DPR, SfSNet)
2. Neural relighting (Total Relighting, IC-Light, diffusion methods)
3. Uncertainty in computer vision (Kendall, Poggi, Ilg, Shen et al. "Conditional-Flow NeRF") — acknowledge that learned uncertainty is well-explored for depth, flow, and NeRF, but distinguish that no prior work applies it to *relighting blend weight optimization* within a *real-time hybrid pipeline*. The novelty is application-specific, not conceptual.
4. Hybrid physics-learning methods — highlight the gap

> **FRAMING NOTE**: Do NOT write "no one predicts where a vision system will fail" — that's false (Poggi, Ilg, Kendall all do). Do NOT write "failure prediction" — a strict reviewer will say this is just optimal interpolation, not failure prediction. DO write: "Uncertainty modeling has been applied to depth estimation, optical flow, and NeRF rendering, but predicting the *relative reliability* of two complementary relighting estimators within a real-time hybrid pipeline has not been explored. We frame this as per-pixel blend weight optimization over the G-buffer."
>
> **TITLE SUGGESTION (Strategic Fix #9)**: Consider replacing the sensational title with something more defensible:
> - Current: “Where Will Relighting Fail? Learned Per-Pixel Confidence for Hybrid Spherical Harmonic Transfer”
> - Alternative: “Learning Per-Pixel Blending Weights for Hybrid Spherical Harmonic Relighting”
> - The alternative is more precise, reviewer-friendly, and harder to attack. Keep the current title only if writing quality is excellent.

**Deliverable**: `docs/research/math_formalization.md` + `docs/research/related_work_draft.md`

---

### Week 3-4: Differentiable Renderer

**Goal**: Build a PyTorch module that exactly mirrors our WGSL/GLSL shader. This is the foundation for ALL training — ConfNet is trained by rendering through this module and comparing to ground truth.

#### Week 3 (April 24 – April 30)

**Day 1-2: Core Renderer**

Create `training/diff_renderer.py`:

```python
# File: training/diff_renderer.py
# Purpose: Differentiable PyTorch implementation of deferred_lighting.wgsl

import torch
import torch.nn as nn
import torch.nn.functional as F

class DifferentiableRelighter(nn.Module):
    """
    Mirrors the fragment shader in:
      - src/relighting/v8/rendering/shaders/deferred_lighting.wgsl (lines 233-449)
      - src/relighting/v8/rendering/WebGL2DeferredRenderer.js (lines 547-880)
    
    Every operation uses PyTorch ops so gradients flow through.
    """
    
    def __init__(self):
        super().__init__()
    
    def evaluate_sh9(self, normals, sh_coeffs):
        """
        Mirrors evaluateSH9() in WGSL (lines 103-116)
        normals: (B, 3, H, W) — [x, y, z]
        sh_coeffs: (B, 9)
        returns: (B, 1, H, W)
        """
        nx = normals[:, 0:1]  # (B, 1, H, W)
        ny = normals[:, 1:2]
        nz = normals[:, 2:3]
        
        sh = sh_coeffs  # (B, 9)
        
        result = (
            sh[:, 0:1, None, None] * 0.282095 +
            sh[:, 1:2, None, None] * 0.488603 * ny +
            sh[:, 2:3, None, None] * 0.488603 * nz +
            sh[:, 3:4, None, None] * 0.488603 * nx +
            sh[:, 4:5, None, None] * 1.092548 * nx * ny +
            sh[:, 5:6, None, None] * 1.092548 * ny * nz +
            sh[:, 6:7, None, None] * 0.315392 * (3.0 * nz * nz - 1.0) +
            sh[:, 7:8, None, None] * 1.092548 * nx * nz +
            sh[:, 8:9, None, None] * 0.546274 * (nx * nx - ny * ny)
        )
        
        return torch.clamp(result, min=0.0)
    
    def evaluate_sh7(self, normals, sh_coeffs):
        """Mirrors evaluateOrigSH() in WGSL (lines 118-129)"""
        # Same as SH9 but only 7 coefficients, min clamp at 0.05
        nx, ny, nz = normals[:, 0:1], normals[:, 1:2], normals[:, 2:3]
        sh = sh_coeffs
        
        result = (
            sh[:, 0:1, None, None] * 0.282095 +
            sh[:, 1:2, None, None] * 0.488603 * ny +
            sh[:, 2:3, None, None] * 0.488603 * nz +
            sh[:, 3:4, None, None] * 0.488603 * nx +
            sh[:, 4:5, None, None] * 1.092548 * nx * ny +
            sh[:, 5:6, None, None] * 1.092548 * ny * nz +
            sh[:, 6:7, None, None] * 0.315392 * (3.0 * nz * nz - 1.0)
        )
        
        return torch.clamp(result, min=0.05)
    
    def hybrid_relight(self, image_linear, normals, new_sh, orig_sh,
                       intensity, ambient, confidence_map=None):
        """
        Mirrors WGSL lines 271-291 (HYBRID ALBEDO/RATIO RELIGHTING)
        
        If confidence_map is None, uses the hand-tuned heuristic.
        If confidence_map is provided, uses the learned confidence.
        """
        new_sh_eval = self.evaluate_sh9(normals, new_sh)   # (B, 1, H, W)
        orig_sh_eval = self.evaluate_sh7(normals, orig_sh) # (B, 1, H, W)
        
        # RATIO METHOD (line 277-280)
        shading_ratio = new_sh_eval / torch.clamp(orig_sh_eval, min=0.08)
        smooth_ratio = torch.lerp(
            torch.ones_like(shading_ratio), 
            shading_ratio, 
            intensity
        )
        ratio_result = image_linear * smooth_ratio
        
        # ALBEDO METHOD (line 282-287)
        orig_shading = torch.clamp(orig_sh_eval, min=0.25)
        albedo = torch.clamp(image_linear / orig_shading, max=1.5)
        albedo_result = (
            albedo * torch.clamp(new_sh_eval, min=0.0) * intensity * 2.0 + 
            albedo * ambient
        )
        
        # BLEND (line 289-291)
        if confidence_map is None:
            # Hand-tuned heuristic (BASELINE we beat)
            w = self._smoothstep(0.15, 0.5, orig_sh_eval) * 0.6
        else:
            w = confidence_map
        
        return torch.lerp(ratio_result, albedo_result, w)
    
    # ... (full PBR specular, SSAO, shadows, OKLAB, gamut mapping)
```

**Day 3-4: PBR Specular + Effects**

Implement the remaining shader functions in PyTorch:
- `cook_torrance_brdf()` — mirrors `distributionGGX`, `geometrySmith`, `fresnelSchlick` (WGSL lines 131-152)
- `compute_ssao()` — mirrors WGSL lines 156-172 (differentiable approximation)
- `compute_shadow()` — mirrors WGSL lines 174-202
- `compute_sss()` — mirrors WGSL lines 207-217
- `oklab_preserve_chroma()` — mirrors WGSL lines 418-428
- `soft_gamut_map()` — mirrors WGSL lines 434-446
- `srgb_to_linear()` and `linear_to_srgb()` — mirrors WGSL lines 63-73

**Day 5: Full Forward Pass**

Wire everything together into `forward()`:
```python
def forward(self, image_srgb, normals, depth, scene_map,
            new_sh, orig_sh, light_dir, light_color,
            intensity, ambient, confidence_map=None):
    # 1. sRGB → Linear
    # 2. Normal cross-blur
    # 3. Hybrid relight (ratio/albedo blend)
    # 4. Material classification
    # 5. PBR specular
    # 6. SSS + curvature + rim
    # 7. SSAO + shadows
    # 8. Composition
    # 9. OKLAB + gamut
    # 10. Linear → sRGB
    return output_srgb
```

#### Week 4 (May 1 – May 7)

**Day 1-2: Validation (Tiered PSNR Targets)**

**Critical step**: Verify the PyTorch renderer matches the WebGL2/WGSL shader.

1. Create 100 test G-buffers (random depth, normals, images, materials)
2. Render each through both:
   - WebGL2 shader (run in browser, screenshot/readPixels)
   - PyTorch renderer (run on CPU/GPU, export as PNG)
3. Compute PSNR between outputs

**Tiered acceptance criteria** (SSAO/shadows are stochastic — can't match exactly):

| Component | Target PSNR | Rationale |
|---|---|---|
| **SH evaluation (SH9, SH7)** | > 55 dB | Pure math, must be nearly identical |
| **Hybrid relighting core (ratio + albedo + blend)** | > 45 dB | Core contribution path, must be tight |
| **PBR specular (GGX, Fresnel, Smith)** | > 42 dB | Deterministic but floating point sensitive |
| **SSAO + Contact Shadows** | > 30 dB | Stochastic sampling — accept visual match, not bit-exact |
| **Full pipeline (end-to-end)** | > 35 dB | Stochastic effects drag this down, acceptable |

> **KEY INSIGHT**: ConfNet is only trained through the hybrid relighting core (ratio/albedo blend), NOT through SSAO/shadows. We only need the SH + blend path to be exact. The stochastic effects are added *after* and do not affect ConfNet's gradients.

```bash
# Validation script structure
training/
├── diff_renderer.py         # The differentiable renderer
├── validate_renderer.py     # Comparison script (reports per-component PSNR)
├── test_gbuffers/            # 100 test cases (JSON: depth, normals, etc.)
└── test_outputs/             # Browser vs PyTorch outputs for comparison
```

**Day 3-4: Fix Discrepancies + Early ONNX/WebGPU Smoke Test**

Fix renderer discrepancies:
- For SH / ratio / albedo: must be exact match — debug until > 45dB
- For SSAO/shadows: implement simplified deterministic version for training (fixed sample pattern instead of pseudo-random)

**Also on Day 4: ONNX Runtime Web smoke test (addresses execution risk #14)**:
```javascript
// Create a tiny test: 2-layer conv net → ONNX → load in browser
// Test on BOTH:
//   1. ONNX Runtime Web with WebGPU execution provider
//   2. ONNX Runtime Web with WASM execution provider (fallback)
// Measure inference time for a 512×512 input
// If WebGPU EP fails: plan for WASM from the start, adjust latency claims
```

> **WHY NOW**: If ONNX Runtime Web's WebGPU EP can't run a basic conv net, we discover it in Week 4, not Week 9. WASM fallback will be slower (~20-30ms instead of ~5ms) but still viable.

**Day 5: Create Training Utilities**

```python
# training/dataset.py — PyTorch dataset for synthetic data
# training/losses.py — All loss functions
# training/confnet.py — ConfNet architecture
# training/train.py — Training loop
```

**⚠️ GO/NO-GO CHECKPOINT (May 7)**: If SH + blend path PSNR < 45dB, switch target to WACV 2027.

**Deliverable**: `training/` directory with validated differentiable renderer. Per-component PSNR report. ONNX WebGPU smoke test results.

---

### Week 5-6: Synthetic Data Pipeline + External Benchmarks + Baseline Metrics

**Goal**: Create paired training data, download external evaluation benchmark (Multi-Illumination), and measure current system performance as baseline.

#### Week 5 (May 8 – May 14)

**Day 1-3: Blender Data Pipeline**

Create a Blender Python pipeline that renders scenes with ground truth:

```
training/data/
├── blender_render.py       # Main rendering script
├── scenes/                  # Scene definitions
│   ├── indoor/              # Indoor scenes (ShapeNet / Replica assets)
│   ├── outdoor/             # Outdoor scenes
│   └── portraits/           # Face/portrait renders (FLAME model)
├── materials/               # PBR material library
├── output/                  # Rendered output (synthetic)
│   ├── scene_0001/
│   │   ├── image_light_00.png              # Rendered under lighting 0
│   │   ├── image_light_00_direct.png       # ← DIRECT ONLY (no GI)
│   │   ├── image_light_01.png
│   │   ├── image_light_01_direct.png       # ← DIRECT ONLY
│   │   ├── ...
│   │   ├── albedo.png                      # Ground truth albedo
│   │   ├── shading_light_00_direct.exr     # ← DIRECT shading only
│   │   ├── depth.exr
│   │   ├── normals.exr
│   │   ├── sh_coeffs.json                  # SH9 coefficients for each lighting
│   │   └── metadata.json
│   └── ...
└── external/                # External evaluation datasets
    └── multi_illumination/  # Murmann et al. 2019 (download separately)
```

> **CRITICAL FIX (Feedback #1 — GT Domain Gap)**: Our model produces *direct SH irradiance only*. Cycles path tracing includes global illumination (bounced light, caustics, inter-reflections). If we train against full GI renders, we penalize ConfNet for effects it cannot produce, poisoning the GT confidence labels.
>
> **Solution**: Render TWO versions of each image:
> 1. `image_light_XX.png` — Full Cycles render (256 samples, all bounces) — for qualitative figures only
> 2. `image_light_XX_direct.png` — Direct illumination only (set `max_bounces=0` in Cycles, or use `Diffuse Direct` AOV) — **this is the training GT**
>
> The GT confidence map `w*` is computed against the **direct-only** renders, matching what our SH model can physically represent.

**Rendering settings**:
- Resolution: 512×512 (training), 1024×1024 (evaluation)
- Renderer: Cycles
- Samples: **64-128** (not 256 — see timing fix below)
- Lighting: SH9 environment maps (10 per scene — see lighting source note below)
- AOV passes: Albedo (diffuse color), Diffuse Direct (shading without GI), Depth (Z), Normal (world space)

> **FIX (Feedback R2#9 — Realistic SH Lighting)**: Purely random SH9 coefficients produce physically implausible lighting (negative irradiance, wildly inconsistent color). The model will learn confidence for unrealistic scenarios and fail to generalize.
>
> **Solution**: Sample lighting from **real HDR environment maps**:
> 1. Download the **Laval Indoor/Outdoor HDR Database** (~500 real HDR panoramas, free for research) AND supplement with **Poly Haven indoor HDRs** (~100 free indoor panoramas) to ensure distribution overlap with Multi-Illumination (see distribution check below).
> 2. Fit SH9 **per color channel (RGB)** to each HDR using vectorized spherical integration:
>    ```python
>    # training/data/fit_sh_to_hdr.py
>    import numpy as np
>    from imageio import imread
>    
>    def fit_sh9_from_hdr(hdr_path):
>        """Fit 9 SH coefficients per RGB channel to an HDR equirectangular panorama.
>        Returns: (9, 3) array — 9 SH coefficients for each of R, G, B.
>        
>        NOTE (R3#1): SceneAnalyzer returns per-channel RGB SH coefficients (27 values).
>        We must match this: fit SH9 per channel, NOT on scalar luminance.
>        At inference, channel 5 (origSH) = mean(SH7_R, SH7_G, SH7_B) or luminance-weighted.
>        Be consistent between training and inference.
>        """
>        hdr = imread(hdr_path)  # (H, W, 3)
>        H, W = hdr.shape[:2]
>        
>        # Vectorized (R3#2): O(1) numpy ops, not O(H×W) Python loops
>        # Double-for-loop version takes hours per HDR; this takes ~50ms.
>        theta = np.linspace(np.pi / (2*H), np.pi - np.pi / (2*H), H)[:, None]  # (H, 1)
>        phi = np.linspace(np.pi / W, 2*np.pi - np.pi / W, W)[None, :]          # (1, W)
>        
>        sin_t = np.sin(theta)   # (H, 1)
>        cos_t = np.cos(theta)
>        sin_p = np.sin(phi)     # (1, W)
>        cos_p = np.cos(phi)
>        
>        # Direction vectors on unit sphere
>        nx = sin_t * cos_p      # (H, W)
>        ny = sin_t * sin_p
>        nz = np.broadcast_to(cos_t, (H, W))
>        
>        # Solid angle per pixel
>        solid = sin_t * (np.pi / H) * (2 * np.pi / W)  # (H, 1) broadcasts
>        
>        # 9 SH basis functions (L=0,1,2)
>        basis = [
>            0.282095 * np.ones((H, W)),                # Y_0^0
>            0.488603 * ny,                              # Y_1^-1
>            0.488603 * nz,                              # Y_1^0
>            0.488603 * nx,                              # Y_1^1
>            1.092548 * nx * ny,                         # Y_2^-2
>            1.092548 * ny * nz,                         # Y_2^-1
>            0.315392 * (3.0 * nz * nz - 1.0),          # Y_2^0
>            1.092548 * nx * nz,                         # Y_2^1
>            0.546274 * (nx * nx - ny * ny),             # Y_2^2
>        ]
>        
>        # Fit per channel: (9, 3)
>        sh_coeffs = np.zeros((9, 3))
>        for c in range(3):  # R, G, B
>            channel = hdr[:, :, c]  # (H, W)
>            for i in range(9):
>                sh_coeffs[i, c] = np.sum(channel * basis[i] * solid)
>        
>        return sh_coeffs  # (9, 3) — 9 bands, 3 channels
>    ```
> 3. Pre-compute SH9 for all HDRs → `training/data/laval_sh_bank.npy` as `(N, 9, 3)` array
> 4. During Blender rendering, sample 10 SH9 vectors from this bank per scene
> 5. For ConfNet channel 5 (origSH), compute: `origSH = 0.2126*SH7_R + 0.7152*SH7_G + 0.0722*SH7_B` — luminance-weighted, matching how the shader evaluates it. **Do this identically in both training and inference.**
>
> **DISTRIBUTION CHECK (R3#10 — Laval vs Multi-Illumination Overlap)**:
> After fitting SH9 to both Laval and Multi-Illumination HDRs, verify distribution overlap:
> ```python
> # In Week 5 Day 4 — takes 5 minutes, prevents silent domain gap
> laval_sh = np.load('laval_sh_bank.npy')   # (N_laval, 9, 3)
> multi_sh = np.load('multi_illum_sh.npy')   # (N_multi, 9, 3)
> fig, axes = plt.subplots(3, 3)
> for i in range(9):
>     ax = axes[i//3, i%3]
>     ax.hist(laval_sh[:, i, :].mean(axis=1), bins=50, alpha=0.5, label='Laval')
>     ax.hist(multi_sh[:, i, :].mean(axis=1), bins=50, alpha=0.5, label='MultiIllum')
>     ax.set_title(f'SH band {i}')
> plt.savefig('results/figures/sh_distribution_check.png')
> ```
> If distributions don't overlap on bands 0-3 (DC + linear terms): supplement Laval with indoor HDRs from **Poly Haven** or **MIT Indoor HDR**. This is critical — a training/eval distribution gap on lighting would invalidate A12.

> **TIMING FIX (Feedback #13 — Blender Rendering Time)**:
> The original plan estimated 40 GPU-hours for 5,500 images. Realistic estimate at 512×512, 256 samples on a consumer GPU (RTX 3080-class) is **2-5 minutes/render**, giving 180-460 GPU-hours — 4.5-12× longer than planned.
>
> **Mitigations**:
> 1. Reduce samples to 64-128 (still clean for direct-only lighting, ~1-2 min/render)
> 2. Reduce to 10 lightings per scene (not 25) — still yields plenty of training pairs
> 3. Use 150 base scenes × 10 lightings = 1,500 renders → ~25-50 GPU-hours (feasible on one GPU over a weekend)
> 4. Training pairs per scene: C(10, 2) = 45 pairs → 150 × 45 = **6,750 training pairs** (sufficient for a 15K-param model)

**Day 4-5: Data Generation (Start Rendering) + Download & Preprocess External Data**

Parallel tasks:
1. **Start Blender rendering** (batch job, runs over weekend)
   - 150 base scenes (80 ShapeNet + 40 Replica rooms + 20 procedural + 10 FLAME faces)
   - 10 lightings each (sampled from Laval SH bank), 512×512, 64 samples, direct-only + full render
   - Estimated time: ~30-50 GPU-hours on local GPU

> **TRAIN/TEST SPLIT PROTOCOL (Feedback R2#8)**:
> Split by scene index AND ensure no category overlap:
> - **Train**: scenes 0-99 (60 ShapeNet + 25 Replica + 10 procedural + 5 FLAME)
> - **Val**: scenes 100-119 (10 ShapeNet from DIFFERENT categories + 5 Replica + 5 procedural)
> - **Test**: scenes 120-149 (10 ShapeNet from DIFFERENT categories + 10 Replica + 5 procedural + 5 FLAME)
> Enforce: no ShapeNet category appears in both train and test (e.g., train gets chairs/tables, test gets lamps/sofas).
> Write category assignments into `training/data/split.json` and freeze before any training.

2. **Download + Preprocess Multi-Illumination Dataset** (Murmann et al., CVPR 2019)
   - Available at: https://projects.csail.mit.edu/illumination/
   - 1,000 real indoor scenes photographed under 25 different illuminations
   - This is our **external evaluation benchmark**

> **CRITICAL (Feedback R2#1 + R3#7 — SH Fitting Required)**:
> Multi-Illumination provides photographs, NOT SH coefficients. To use it with our pipeline, we must fit SH9 to each illumination condition. Without this, we have no way to set `L_new` for evaluation.
>
> **Preprocessing step** (Day 5, ~30 min vectorized):
> ```python
> # training/data/preprocess_multi_illumination.py
> 
> from fit_sh_to_hdr import fit_sh9_from_hdr
> import json, glob, os
> import numpy as np
> from imageio import imread
> 
> def is_hdr(path):
>     """Check if image is HDR (EXR/HDR) or LDR (JPG/PNG)."""
>     ext = os.path.splitext(path)[1].lower()
>     return ext in ['.exr', '.hdr']
> 
> def load_and_normalize(path):
>     """Load image, normalize to linear HDR-like range."""
>     img = imread(path).astype(np.float32)
>     if is_hdr(path):
>         return img  # Already linear HDR
>     else:
>         # LDR: undo sRGB gamma, scale to [0, 1]
>         img = img / 255.0
>         img = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
>         return img
> 
> for scene_dir in sorted(glob.glob('multi_illumination/scenes/*')):
>     sh_per_light = {}
>     light_files = sorted(glob.glob(f'{scene_dir}/light_*.*'))
>     for light_idx, img_path in enumerate(light_files):
>         img = load_and_normalize(img_path)  # handles both HDR and LDR
>         sh_per_light[light_idx] = fit_sh9_from_hdr_array(img).tolist()  # (9, 3)
>     with open(f'{scene_dir}/sh_coeffs.json', 'w') as f:
>         json.dump(sh_per_light, f)
> ```
>
> **SH PROJECTION CAVEAT (Strategic Fix #4 — Must Include in Paper)**:
> Multi-Illumination lighting contains high-frequency components (cast shadows, specular highlights) that SH9 cannot represent. Our evaluation measures improvement *within the SH approximation*, not absolute relighting quality.
> **In the paper**: "We project target illumination into SH space, introducing an approximation error. Our evaluation measures the improvement of ConfNet over baseline methods under this shared SH model. We visualize the SH-reconstructed vs. original lighting in supplementary Figure S3 to quantify this approximation."
> **In supplementary**: Show side-by-side of original Multi-Illumination image vs SH9-reconstructed lighting × GT albedo. This quantifies how much information SH discards.

> **FIXED EVALUATION PROTOCOL (Feedback R2#11 — Reproducibility)**:
> Do NOT evaluate all C(25,2) pairs. Establish a fixed protocol:
> - **5 source lights**: indices [0, 5, 10, 15, 20] (spread across the light stage)
> - **5 target lights**: indices [2, 7, 12, 17, 22] (different from sources)
> - This gives **25 evaluation pairs per scene**, consistent across all scenes
> - Write these indices into `training/data/eval_pairs.json` and freeze (R3#9: store alongside `split_scenes.json` in `training/data/`, not at `training/` root)
> - All numbers in the paper use this exact protocol — reproducible by anyone who downloads the dataset

> **DPR CAVEAT (Feedback R2#2)**: DPR is trained on portraits only. Multi-Illumination is mainly indoor scenes (bookshelves, rooms, tables). DPR quality numbers on this benchmark will be poor/meaningless for non-portrait images. **Solution**: Report DPR numbers on portrait subset only (tag ~50-100 scenes containing people/faces). Label clearly in the paper: "DPR evaluated on portrait subset (N=XX scenes); our method evaluated on all scenes." The latency comparison table remains valid across all scenes.

**Alternative if Blender is too slow**: Use **Kubric** (Google's synthetic data tool, pre-optimized for fast rendering) or **OpenRooms** (pre-rendered indoor scenes with intrinsic decomposition GT).

> **⚠️ GO/NO-GO CHECKPOINT (May 21)**: At least 100 scenes rendered with direct-only GT. Multi-Illumination downloaded + SH fitted. If neither is ready, pivot to Kubric.

#### Week 6 (May 15 – May 21)

**Day 1-2: Compute Baseline Metrics**

Run the current Orlume pipeline (with hand-tuned confidence) on the synthetic data and measure quality:

```python
# training/eval_baseline.py

For each scene s and lighting pair (L_orig → L_new):
    1. Take image_L_orig as input
    2. Run through Orlume pipeline:
       - Depth Anything for depth
       - NormalEstimator for normals
       - SegFormer for segmentation
       - MaterialEstimator for materials
       - SceneAnalyzer for scene map
    3. Render with hand-tuned confidence (the current heuristic)
    4. Compare output to ground truth image_L_new
    5. Compute: PSNR, SSIM, LPIPS

Save per-pixel error maps for analysis.
```

**NOTE**: For this baseline, run the differentiable renderer with `confidence_map=None` (uses the hand-tuned heuristic). This gives us numbers to beat.

**Day 3-4: Error Analysis (generates key figure for paper)**

The most important analysis for the paper:

```python
# training/error_analysis.py

For 100K pixels across all test images:
    1. Compute ratio_error = |ratio_result - GT|
    2. Compute albedo_error = |albedo_result - GT|
    3. Record: origSH_value, depth, normal_variance, material_type, curvature
    
    Plot:
    - Scatter: origSH vs ratio_error (expect: low origSH → high error)
    - Scatter: origSH vs albedo_error (expect: very low origSH → high error)
    - The "crossover point" where ratio beats albedo and vice versa
    - Color by material type (does skin behave differently from metal?)
    - Color by normal quality (do noisy normals hurt albedo method more?)
```

This analysis produces the **key figure** of the paper: showing that the optimal blend weight is NOT just a function of origSH, but depends on the full G-buffer. This justifies learning the confidence.

**Day 5: Generate Ground Truth Confidence Maps**

For each training sample, compute the optimal per-pixel blend weight:

```python
# training/compute_gt_confidence.py

For each pixel p in each training sample:
    ratio_result = I_orig * (newSH / origSH)
    albedo_result = (I_orig / origSH) * newSH
    gt_relit = ground_truth_DIRECT_ONLY_image_under_L_new  # ← DIRECT ONLY (Feedback #1)
    
    # Optimal weight: minimize blend error
    ratio_err = |ratio_result(p) - gt_relit(p)|  (per-channel L1, averaged)
    albedo_err = |albedo_result(p) - gt_relit(p)|
    
    w_optimal(p) = ratio_err² / (ratio_err² + albedo_err² + ε)
    # w=1 when ratio is bad (use albedo), w=0 when albedo is bad (use ratio)
```

> **FIX (Feedback #3 — GT Confidence Instability)**: When both errors are near-zero (well-lit, clean geometry), `w*` becomes numerically unstable (ratio of two tiny numbers → random noise). These are the *easiest* pixels — the confidence map should work fine for them regardless of weight.
>
> **Solution**: Soft-mask low-error regions during training:
> ```python
> # Regions where both methods work well (total error < threshold)
> total_err = ratio_err + albedo_err
> easy_mask = (total_err < 0.02).float()  # pixels where both methods are fine
>
> # In these regions, set w* = 0.5 (either method works, don't care)
> w_optimal = torch.where(easy_mask > 0.5, torch.full_like(w_optimal, 0.5), w_optimal)
>
> # During training, down-weight easy-pixel loss contribution:
> pixel_weights = 1.0 - 0.8 * easy_mask  # easy pixels contribute 20% weight
> loss = (pixel_weights * BCE(w_pred, w_optimal)).mean()
> ```
> This focuses training on the hard pixels — boundaries, shadows, specular regions — where confidence actually matters.

**Deliverable**: Baseline PSNR/SSIM numbers. Error analysis plots. Ground truth confidence maps with easy-region masking.

---

### Week 7-8: ConfNet Training + Ablations

**Goal**: Train the confidence predictor and prove it beats the hand-tuned heuristic.

#### Week 7 (May 22 – May 28)

**Day 1: ConfNet Architecture**

```python
# training/confnet.py

class ConfNet(nn.Module):
    """
    Lightweight confidence predictor for hybrid SH relighting.
    
    Input: 8-channel G-buffer features
      Ch 0: depth (normalized 0-1)
      Ch 1: normal_x (from normal map)
      Ch 2: normal_y
      Ch 3: normal_z
      Ch 4: roughness (from scene map)
      Ch 5: origSH evaluation (SH7(N, L_orig))
      Ch 6: depth gradient magnitude (|∇D|) — see EXACT DEFINITION below
      Ch 7: normal variance (σ²(N) in 3×3 window) — see EXACT DEFINITION below
    
    EXACT DEFINITIONS (Final Fix #2 — must match between Python and JS):
    
      Ch 6 — Depth Gradient (central difference, Sobel-like):
        grad_x = (D[i, j+1] - D[i, j-1]) / 2.0
        grad_y = (D[i+1, j] - D[i-1, j]) / 2.0
        |∇D| = sqrt(grad_x² + grad_y²)
        # Boundary: replicate-pad (D[-1] = D[0], D[H] = D[H-1])
    
      Ch 7 — Normal Variance (3×3 window mean squared deviation):
        For each pixel (i, j):
          N_mean = mean(N[i-1:i+2, j-1:j+2])   # (3,) mean normal in 3×3
          σ²(N) = mean(||N[k,l] - N_mean||² for k,l in 3×3 window)
        # Boundary: replicate-pad
    
      Python implementation (training/dataset.py):
        def compute_depth_gradient(depth):  # (H, W)
            gx = F.pad(depth, (1,1,0,0), mode='replicate')
            gx = (gx[:, 2:] - gx[:, :-2]) / 2.0
            gy = F.pad(depth, (0,0,1,1), mode='replicate')
            gy = (gy[2:, :] - gy[:-2, :]) / 2.0
            return torch.sqrt(gx**2 + gy**2 + 1e-8)
        
        def compute_normal_variance(normals):  # (3, H, W)
            N_mean = F.avg_pool2d(normals.unsqueeze(0), 3, stride=1, padding=1)[0]
            diff = normals - N_mean  # (3, H, W)
            return (diff**2).sum(dim=0)  # (H, W)
      
      JS implementation (src/ml/ConfidencePredictor.js) — COPY EXACT LOGIC:
        // Must use identical computation: central difference + avg_pool
        // Any mismatch = silent distribution shift = performance drop
    
    Output: 1-channel confidence map w ∈ [0, 1]
      w = 0 → use ratio method
      w = 1 → use albedo method
    
    Architecture: 4 conv layers, no downsampling, ~15K parameters
    """
    
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(8, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            
            nn.Conv2d(32, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            
            nn.Conv2d(32, 16, 3, padding=1),
            nn.BatchNorm2d(16),
            nn.ReLU(inplace=True),
            
            nn.Conv2d(16, 1, 1),
            nn.Sigmoid()
        )
    
    def forward(self, gbuffer_features):
        return self.net(gbuffer_features)
```

**Day 2-3: Training Loop**

```python
# training/train.py

Training strategy:
    Optimizer: AdamW (lr=1e-3, weight_decay=1e-4)
    Scheduler: CosineAnnealingLR (T_max=50 epochs)
    Epochs: 50 (should converge in ~30)
```

> **FIX (Feedback #4 — ConfNet Memory at Full Resolution)**:
> Input tensor at batch 16 × 8 channels × 512×512 = ~268 MB, plus 32-channel intermediates = ~1.5GB per forward pass. This is tight on consumer GPUs (8-12GB).
>
> **Solution**: Train on **256×256 random crops** from 512×512 renders, not full resolution.
> - Batch size 16 × 8 × 256 × 256 = ~67 MB — easily fits on any GPU
> - ConfNet has no downsampling (fully convolutional) → inference resolution is independent of training resolution
> - At inference time in the browser, it runs on full resolution (any size) because it's just 3×3 convolutions
> - Crop size 256×256 provides sufficient spatial context for the 3×3 receptive field (effective RF = 9×9 after 4 layers)

```python
    Batch size: 16 (256×256 random crops from 512×512 renders)
    # Memory: ~67 MB input + ~200 MB activations = ~267 MB total (fits on any 4GB+ GPU)
```

Loss options (try all, ablate):
```python
    A. Direct supervision (simplest):
       L = weighted_BCE(w_pred, w_optimal, pixel_weights)  # easy-pixel masking
       
    B. Rendering loss (end-to-end, better):
       L = ||blend(ratio, albedo, w_pred) - GT_direct||₁  # GT = direct-only render
       
    C. Combined:
       L = 0.5 * weighted_BCE(w_pred, w_optimal) + 0.5 * ||blend - GT_direct||₁
    
    D. Rendering loss + perceptual:
       L = ||blend - GT_direct||₁ + 0.1 * LPIPS(blend, GT_direct)
    
    E. Rendering loss + entropy + TV regularization (Final Fixes #5, #10):
       L = ||blend - GT_direct||₁ + λ_ent * H(w) + λ_tv * TV(w)
       where H(w) = -(w * log(w + ε) + (1-w) * log(1-w + ε))  # per-pixel entropy
       TV(w) = ||∇w||₁  # total variation — prevents noisy confidence maps
       # Start: λ_ent = 0.01, λ_tv = 0.001; ablate both in A10
```

> **WHY ENTROPY (Strategic Fix #5 — Loss Bias)**: Pure rendering loss `||blend - GT||` has a bias toward safe averaging (w ≈ 0.5 everywhere), since a 50/50 blend rarely produces terrible results. The entropy term encourages the model to make confident per-pixel decisions (w close to 0 or 1), producing sharper confidence maps and better relighting in regions where one method is clearly superior.

**Also add during training: Input Noise Injection (Final Fixes #1 + #6 — Empirically Calibrated Sim2Real)**:

**STEP 1 (Week 6 Day 2): Measure real noise distributions**
```python
# training/measure_noise.py — Run ONCE on synthetic test set
#
# Do NOT guess σ values. Measure them empirically:
# 1. Run Depth Anything on Blender-rendered images (where GT depth is known)
# 2. Compute per-pixel error: err = estimated - GT
# 3. Fit σ from the error distribution

for scene in blender_test_scenes:
    gt_depth = load_gt_depth(scene)  # from Blender AOV
    est_depth = depth_anything.predict(render_image(scene))
    depth_errors.append((est_depth - gt_depth).flatten())

    gt_normals = load_gt_normals(scene)
    est_normals = normal_estimator.predict(est_depth)
    normal_errors.append(angular_error(est_normals, gt_normals).flatten())

σ_d = np.std(np.concatenate(depth_errors))   # measured, not guessed
σ_n = np.std(np.concatenate(normal_errors))   # measured, not guessed
np.save('training/data/noise_params.npz', σ_d=σ_d, σ_n=σ_n)
print(f'Measured: σ_d={σ_d:.4f}, σ_n={σ_n:.4f}')  # expect ~0.01-0.05
```

**STEP 2 (Week 7): Apply calibrated + structured noise during training**
```python
# In dataset.py __getitem__, AFTER loading clean synthetic G-buffer:
noise_params = np.load('training/data/noise_params.npz')
σ_d, σ_n = noise_params['σ_d'], noise_params['σ_n']

if self.training and self.noise_augment:
    # --- Depth noise: Gaussian + edge artifacts (structured) ---
    gbuffer[0] += torch.randn_like(gbuffer[0]) * σ_d
    # Add edge-correlated noise (Depth Anything fails at depth discontinuities)
    edges = compute_depth_gradient(gbuffer[0]) > 0.1  # boolean edge mask
    gbuffer[0] += edges.float() * torch.randn_like(gbuffer[0]) * (3 * σ_d)
    
    # --- Normal noise: angular perturbation (not additive) ---
    angle_noise = torch.randn(1, *gbuffer.shape[1:]) * σ_n  # rotation angle
    axis = F.normalize(torch.randn(3, *gbuffer.shape[1:]), dim=0)  # random axis
    gbuffer[1:4] = rodrigues_rotate(gbuffer[1:4], axis, angle_noise)
    gbuffer[1:4] = F.normalize(gbuffer[1:4], dim=0)
    
    # --- Roughness: multiplicative noise (not additive) ---
    gbuffer[4] *= (1.0 + torch.randn_like(gbuffer[4]) * 0.1)
    gbuffer[4] = torch.clamp(gbuffer[4], 0.0, 1.0)
    
    # --- origSH: bias + scaling noise (SH estimation has systematic errors) ---
    gbuffer[5] *= (1.0 + torch.randn_like(gbuffer[5]) * 0.05)  # scaling
    gbuffer[5] += torch.randn_like(gbuffer[5]) * 0.02           # bias
    
    # --- Channels 6-7: recompute from noisy inputs ---
    gbuffer[6] = compute_depth_gradient(gbuffer[0])
    gbuffer[7] = compute_normal_variance(gbuffer[1:4])
```

> **WHY EMPIRICALLY CALIBRATED NOISE (Final Fix #1)**:
> Previous versions used guessed σ values (0.02, 0.05). A reviewer will say: "Noise model is arbitrary → results unreliable." Measuring σ directly from Depth Anything vs GT takes ~30 minutes and makes the noise model **empirically grounded**.
>
> **WHY STRUCTURED NOISE (Final Fix #6)**:
> Real estimator errors are not i.i.d. Gaussian. Depth Anything fails at edges, SH estimation has systematic bias, normals have angular (not additive) errors. The structured noise model above is still simple but captures the dominant failure modes.

**Day 4-5: First Training Run + Debug**

Run training option B (rendering loss). Monitor:
- Training loss curve (should decrease monotonically)
- Validation PSNR (on 50 held-out scenes, report every epoch)
- Visualize predicted confidence maps — do they make sense?
  - Should be high (→ use albedo) in well-lit regions with reliable normals
  - Should be low (→ use ratio) in shadows, flat textures, noisy normal areas

**Expected result**: PSNR improvement of 0.5-2.0 dB over hand-tuned baseline.

#### Week 8 (May 29 – June 4)

**Day 1-3: Ablation Studies**

Run these experiments systematically. Each takes ~2 hours to train:

| Experiment | Change | What We Learn |
|---|---|---|
| **A1**: ConfNet CNN (full, 8 channels) | — | Our method |
| **A2**: ConfNet (origSH only, 1 channel) | Remove all features except origSH | Is origSH sufficient? (Should be worse → justifies multi-feature) |
| **A3**: ConfNet (depth + normals only, 4 ch) | Remove roughness, origSH, gradients | Are geometric features enough? |
| **A4**: ConfNet (no depth gradient) | Remove channel 6 | Does depth quality signal help? |
| **A5**: ConfNet (no normal variance) | Remove channel 7 | Does normal quality signal help? |
| **A6**: Hand-tuned heuristic (current code) | `smoothstep(0.15, 0.5, origSH) * 0.6` | Baseline we must beat |
| **A7**: Oracle confidence (GT w*) | Use ground truth optimal weights | Upper bound (how good could we get?) |
| **A8**: w = 0 everywhere (ratio only) | All ratio | Lower bound for ratio |
| **A9**: w = 1 everywhere (albedo only) | All albedo | Lower bound for albedo |
| **A10**: Loss B vs C vs D vs E | Different training losses | Which loss works best? Include entropy reg. |
| **A11**: ConfNet (full) on Blender images with estimated G-buffers | Run Depth Anything + NormalEstimator on synthetic images (clean edges → better estimates than real photos) | **Isolates relighting confidence from estimation noise** (Feedback R2#5). Same model, same pipeline, but input images have cleaner geometry → if PSNR improves significantly, ConfNet is partly compensating for estimation errors, not just relighting tradeoffs. |
| **A12**: Evaluate on Multi-Illumination (external) | Fixed 25-pair protocol, different data distribution | **Generalization test**. Numbers here matter more than synthetic eval. |
| **A13**: Linear baseline: `w = sigmoid(sum(a_i * x_i) + b)` | Learned linear mapping on ALL 8 features | **Is the CNN necessary?** If linear performs close, CNN is overkill. (NOT same as A2: A2 uses 1 feature with CNN, A13 uses 8 features with linear. Tests whether spatial convolution matters.) |
| **A14**: MLP baseline: `w = MLP(mean_pool(features))` | Small FC network (2 layers, 64 hidden) on globally-pooled features | Does spatial structure matter, or only mean statistics? |
| **A15**: ConfNet + residual correction | `blend + 0.1 * tanh(R(gbuffer))` | Supplementary: does bounded residual help? (Strategic Fix #2) |

> **INTERPRETABILITY STUDY (Final Fixes #8, #9, #11 -- Grouped Sensitivity + Causal Analysis)**:
> After training A1, generate:
>
> 1. **Grouped sensitivity analysis** (Final Fix #9 -- correlated features):
>    Channels are correlated (depth<->gradient, normals<->variance). Zeroing one while keeping the other creates an inconsistent state. **Group ablations**:
>    - Zero out {depth + gradient} together -> measures geometry importance
>    - Zero out {normals + variance} together -> measures normal quality importance
>    - Zero out roughness alone -> measures material importance
>    - Zero out origSH alone -> measures lighting importance
>    Report PSNR drop per group. Call this "sensitivity analysis" (not feature importance).
>
> 2. **Causal perturbation experiment** (Final Fix #11 -- proves genuine learning):
>    For 100 test images, smoothly vary one input group while holding others fixed:
>    - Sweep origSH from 0->1 -> plot resulting w curve (should show smooth transition)
>    - Add artificial depth edge -> does w shift? (should go toward ratio)
>    - Perturb normal quality -> does w respond? (should go toward ratio in noisy areas)
>    This proves ConfNet responds to meaningful scene features, not just dataset statistics.
>
> 3. **Failure decomposition figure** (Final Fix #12 -- paper-selling visual):
>    For 5 challenging scenes, show side-by-side:
>    | Input | Ratio error | Albedo error | Learned w | Final result | GT |
>    This single figure communicates the entire paper's contribution at a glance.
>
> 4. **Confidence map overlays**: visualize learned w overlaid on the input, colored by which method was selected. Show correlation with shadow boundaries, depth edges, material transitions.
>
> This turns the paper from "engineering" into "insight + method" -- much stronger for reviewers.

> **FIX (Feedback R2#5 — A11 Distribution Mismatch)**: The original A11 (feed Blender GT depth/normals directly) creates a distribution mismatch: ConfNet was trained on noisy estimated normals but receives perfect GT normals at test time. This tests out-of-distribution behavior, not cleanly separated effects.
>
> **Revised A11**: Instead of swapping inputs, run the **same Depth Anything + NormalEstimator pipeline** on the **Blender-rendered synthetic images**. Synthetic images have clean edges and uniform lighting, so the estimators produce much better geometry than on real photos. This gives a natural "better inputs" condition without distribution mismatch. If A11 >> A1, ConfNet is compensating for estimation noise.
>
> **Optional A11b** (if time permits): Train a *separate* ConfNet from scratch on GT geometry inputs, then compare. This is the clean separation but costs an extra training run.

**Day 4-5: Analyze Results + Make Tables**

Create the main results table (report on BOTH synthetic and Multi-Illumination):

```
Table 1: Synthetic Evaluation (direct-only GT, our Blender data)
| Method                    | PSNR ↑ | SSIM ↑ | LPIPS ↓ | Size  | Time   |
|---------------------------|--------|--------|---------|-------|--------|
| Ratio only (A8)           | ?.??   | ?.??   | ?.???   | 0     | 0ms    |
| Albedo only (A9)          | ?.??   | ?.??   | ?.???   | 0     | 0ms    |
| Hand-tuned (A6, current)  | ?.??   | ?.??   | ?.???   | 0     | 0ms    |
| ConfNet-origSH (A2)       | ?.??   | ?.??   | ?.???   | 5KB   | ?ms    |
| ConfNet-geom (A3)         | ?.??   | ?.??   | ?.???   | 20KB  | ?ms    |
| ConfNet-full (A1, ours)   | ?.??   | ?.??   | ?.???   | 30KB  | ?ms    |
| ConfNet + GT geom (A11)   | ?.??   | ?.??   | ?.???   | 30KB  | ?ms    |
| Oracle (A7, upper bound)  | ?.??   | ?.??   | ?.???   | ∞     | ∞      |

Table 2: Multi-Illumination Evaluation (real images, Murmann 2019)
| Method                    | PSNR ↑ | PSNR (norm.) ↑ | SSIM ↑ | LPIPS ↓ |
|---------------------------|--------|----------------|--------|---------|  
| Hand-tuned (A6)           | ?.??   | ?.??           | ?.??   | ?.???   |
| ConfNet-full (A1, ours)   | ?.??   | ?.??           | ?.??   | ?.???   |
| DPR (Zhou 2019) *         | ?.??   | ?.??           | ?.??   | ?.???   |

> **NORMALIZATION (Final Fix #13)**: Raw PSNR on Multi-Illumination will be low due to SH projection error + global color/intensity mismatch. Add a normalized column:
> ```python
> def normalize_for_eval(pred, target):
>     pred_norm = (pred - pred.mean()) / (pred.std() + 1e-6)
>     pred_norm = pred_norm * target.std() + target.mean()
>     return torch.clamp(pred_norm, 0.0, 1.0)
> ```
> Report BOTH raw and normalized PSNR. Normalized measures relighting structure quality; raw measures absolute accuracy.

* DPR comparison: run their released model on same images (Feedback #6)
  If DPR code unavailable: cite their published numbers and show latency comparison
```

> **REQUIRED (Feedback #6 — Learned Baseline Comparison)**: Reviewers WILL ask why we don't compare to DPR and IC-Light. Our answer is latency and deployment, but we must show the tradeoff explicitly. Add a **latency comparison table**:
>
> ```
> Table 3: Latency Comparison (addresses reviewer concern proactively)
> | Method               | Quality (LPIPS) | Latency     | Deployment    | Control |
> |----------------------|-----------------|-------------|---------------|---------|
> | IC-Light (diffusion) | ?.???           | ~5-30 sec   | Server (A100) | Low     |
> | DPR (SH, CNN)        | ?.???           | ~200 ms     | Server (GPU)  | Medium  |
> | Ours (SH, ConfNet)   | ?.???           | ~50 ms total| Browser (local)| High   |
> ```
> We don't need to beat them on quality. We need to show the operating point is different.

Create per-category breakdown (portraits vs indoor vs outdoor vs materials).

> **⚠️ GO/NO-GO CHECKPOINT (June 4)**: ConfNet must beat hand-tuned by ≥ 0.3 dB on synthetic val set. If not, pivot to study/analysis paper (error analysis + formalization only, no trained model). Still publishable.

**Deliverable**: Trained ConfNet model. Complete ablation table. Confidence map visualizations.

---

### Week 9-10: Browser Integration + Self-Supervised Fine-Tuning

**Goal**: Deploy ConfNet in Orlume and validate it works in the real browser pipeline. Fine-tune on real images.

#### Week 9 (June 5 – June 11)

**Day 1-2: ONNX Export + G-Buffer Pre-computation**

```python
# training/export_onnx.py

# Export trained ConfNet to ONNX
torch.onnx.export(
    model,
    dummy_input,  # (1, 8, 512, 512)
    "confnet.onnx",
    opset_version=17,
    input_names=["gbuffer"],
    output_names=["confidence"],
    dynamic_axes={"gbuffer": {2: "height", 3: "width"},
                  "confidence": {2: "height", 3: "width"}}
)

# Convert to FP16 (R3#4: use onnxconverter_common, NOT onnxmltools — better opset 17 support)
from onnxconverter_common import convert_float_to_float16
import onnx
model_fp32 = onnx.load("confnet.onnx")
model_fp16 = convert_float_to_float16(model_fp32, keep_io_types=True)  # keep I/O as float32
onnx.save(model_fp16, "confnet_fp16.onnx")

# Verify ONNX output matches PyTorch output
# Max acceptable error: 0.01 per pixel
# NOTE: keep_io_types=True ensures input/output stay float32 (WebGPU compatible)
#       while internal weights are fp16 (smaller model, faster inference)
```

> **FIX (R2#4 + R3#4)**: `onnxruntime.quantization.quantize_dynamic` produces INT8, not FP16. `onnxmltools` exists but has poor opset 17 support. Use `onnxconverter_common.convert_float_to_float16` with `keep_io_types=True` — this keeps input/output as float32 for WebGPU compatibility while converting internal weights to fp16.

**Also Day 2: Pre-compute G-Buffers for fine-tuning (Feedback R2#7)**

```python
# training/precompute_gbuffers.py
#
# The self-supervised fine-tuning loop (Week 10) needs G-buffers for every real image.
# Running the full Orlume pipeline (Depth Anything + NormalEstimator + SegFormer +
# MaterialEstimator + SceneAnalyzer) costs ~2-3 seconds per image.
# Running it on-the-fly during training makes each epoch glacially slow.
#
# SOLUTION: Pre-compute and cache all G-buffers BEFORE the fine-tuning loop.

import os, glob, json
import numpy as np
# (Import Orlume pipeline components)

def precompute_all_gbuffers(image_dir, output_dir):
    """Pre-compute 8-channel G-buffer features for all images in a directory."""
    os.makedirs(output_dir, exist_ok=True)
    
    for img_path in glob.glob(f'{image_dir}/*.jpg'):
        basename = os.path.splitext(os.path.basename(img_path))[0]
        out_path = f'{output_dir}/{basename}_gbuffer.npz'
        if os.path.exists(out_path):
            continue
        
        # Run full pipeline once
        depth = depth_anything.predict(img_path)      # ~500ms
        normals = normal_estimator.predict(depth)       # ~200ms
        segmentation = segformer.predict(img_path)      # ~800ms
        materials = material_estimator.predict(segmentation)  # ~50ms
        scene_map = scene_analyzer.analyze(depth, normals, materials)  # ~100ms
        orig_sh = scene_analyzer.estimate_lighting()     # ~50ms
        
        # Compute 8 ConfNet input channels
        gbuffer = assemble_confnet_input(
            depth, normals, scene_map, orig_sh
        )  # (8, H, W) float32
        
        np.savez_compressed(out_path, gbuffer=gbuffer, orig_sh=orig_sh)
    
    print(f'Pre-computed {len(glob.glob(f"{output_dir}/*.npz"))} G-buffers')

# Run this BEFORE finetune_selfsupervised.py
# For 200 images: ~200 × 2s = ~7 minutes (one-time cost)
```

**Day 3-4: Browser Integration**

Create `src/ml/ConfidencePredictor.js`:

```javascript
// src/ml/ConfidencePredictor.js

import { pipeline, env } from '@xenova/transformers';

export class ConfidencePredictor {
    constructor() {
        this.model = null;
        this.isLoaded = false;
    }
    
    async init() {
        // Load ONNX model via ONNX Runtime Web (or Transformers.js custom pipeline)
        // Model is ~30KB — loads instantly
    }
    
    async predict(gBuffer) {
        // Extract 8 features from G-buffer:
        // depth, normal_xyz, roughness, origSH, depth_gradient, normal_variance
        //
        // IMPORTANT (Feedback R2#10): Channel 5 (origSH) requires L_orig
        // from SceneAnalyzer. Assert it's available:
        if (!gBuffer.origSH || gBuffer.origSH.every(v => v === 0)) {
            throw new Error('ConfidencePredictor: L_orig (origSH) not computed. ' +
                'Ensure SceneAnalyzer.estimateLighting() runs BEFORE ConfidencePredictor.predict().');
        }
        
        // Run inference
        // Returns Float32Array (H×W) of confidence values
    }
}
```

> **PIPELINE ORDERING (Feedback R2#10)**:
> ConfNet channel 5 = `SH7(N, L_orig)`, which requires the estimated original lighting coefficients from SceneAnalyzer. The correct execution order is:
> ```
> 1. DepthEstimator.estimate()      → depth
> 2. NormalEstimator.generate()     → normals
> 3. SegmentationEstimator.run()    → segmentation
> 4. MaterialEstimator.estimate()   → materials
> 5. SceneAnalyzer.analyze()        → scene_map + L_orig (SH coefficients)
> 6. ConfidencePredictor.predict()  → confidence_map  ← MUST come AFTER step 5
> 7. WebGL2DeferredRenderer.render() → final image (uses confidence_map)
> ```
> Add the loud assertion above to catch ordering bugs at development time.

Modify `RelightingPipeline.js` to use ConfNet output:
- After SceneAnalyzer completes (~line 265), run ConfidencePredictor
- Pass confidence map to the renderer
- Renderer uses it instead of the hardcoded `smoothstep * 0.6`

Modify shader (both WGSL and GLSL):
- Add `confMapTex` as a new G-buffer texture
- Replace line 291: `mix(ratioResult, albedoResult, albedoConfidence * 0.6)` with `mix(ratioResult, albedoResult, textureSample(confMapTex, ...).r)`

**Day 5: A/B Test in Browser**

Run the full Orlume pipeline on 20 diverse real images (from Unsplash):
- With hand-tuned confidence (current)
- With ConfNet confidence (new)
- Side-by-side visual comparison
- Screenshot both results for the paper

#### Week 10 (June 12 – June 18)

**Day 1-3: Self-Supervised Fine-Tuning on Real Images**

The model was trained on synthetic data. Fine-tune on real images using self-supervised losses.

**Pre-requisite**: G-buffers for all fine-tuning images are already cached from Week 9's `precompute_gbuffers.py`. The training loop loads cached `.npz` files, NOT re-running the full pipeline each iteration.

```python
# training/finetune_selfsupervised.py

class FinetuneDataset(Dataset):
    def __init__(self, gbuffer_dir, crop_size=256):
        self.files = glob.glob(f'{gbuffer_dir}/*.npz')
        self.crop_size = crop_size  # R3#6: must crop cached G-buffers to 256×256
    
    def __getitem__(self, idx):
        data = np.load(self.files[idx])
        gbuffer = torch.from_numpy(data['gbuffer'])  # (8, H, W) full resolution
        orig_sh = torch.from_numpy(data['orig_sh'])   # (9, 3)
        
        # Random 256×256 crop (R3#6: matches training resolution)
        _, H, W = gbuffer.shape
        y = random.randint(0, H - self.crop_size)
        x = random.randint(0, W - self.crop_size)
        gbuffer = gbuffer[:, y:y+self.crop_size, x:x+self.crop_size]
        
        return gbuffer, orig_sh

For a batch of cached G-buffers (no ground truth):
    
    1. Load cached G-buffer + random 256×256 crop (NOT re-running full pipeline)
    
    2. Predict confidence: w = ConfNet(G-buffer)
    
    3. Render under K slightly different lightings (small SH perturbations):
       I_1 = Render(G-buffer, L + δ₁, w)
       I_2 = Render(G-buffer, L + δ₂, w)
       ...
    
    4. PRIMARY LOSS — Temporal smoothness:
       L_smooth = Σᵢ ||I_i - I_{i+1}|| / ||δᵢ - δ_{i+1}||
       # Small light changes → small output changes
       # High loss means the confidence map is causing discontinuities
       # This is the STRONGER signal — uses same G-buffer, only light changes
    
    5. SECONDARY LOSS — Cycle consistency (REUSES ORIGINAL G-BUFFER):
       I_relit = Render(G-buffer, L₁→L₂, w)
       I_back = Render(G-buffer, L₂→L₁, ConfNet(G-buffer))  # SAME G-buffer, NOT re-estimated
       L_cycle = ||I_back - I_orig||
       # Weight: λ_cycle = 0.1 (low weight — approximation since G-buffer doesn't change)
    
    6. Backprop through ConfNet only (freeze renderer)
```

> **FIX (Feedback #5 + R3#5 — Cycle Consistency Fully Fixed)**:
> The original cycle loss required re-running the full Orlume pipeline on the relit image, which produces different depth/normals → cycle never closes cleanly.
>
> **Resolution**: The cycle loss now **reuses the original G-buffer** for the return render (step 5 above). This is an approximation (the G-buffer doesn't actually represent the relit image), but it avoids the estimation cascade entirely and provides a valid local regularization signal. Weight remains low (λ = 0.1).
>
> In the paper: "For cycle consistency, we reuse the original G-buffer for the return render, avoiding compounding estimation errors. This approximation is valid for small light perturbations where scene geometry is unchanged."

**Day 4-5: Final Evaluation on Real Images**

Collect qualitative results:
- 10 portraits (diverse skin tones, lighting conditions)
- 10 indoor scenes (complex materials, shadows)
- 10 outdoor scenes (natural light, vegetation)
- For each: show input, hand-tuned result, ConfNet result, confidence map visualization

Create failure case examples too (where ConfNet doesn't help or hurts).

**Deliverable**: Deployed ConfNet in browser. Before/after visual comparisons. Fine-tuned model.

---

### Week 11-12: Paper Writing + Submission

**Goal**: Write and submit to ACCV 2026 (deadline July 5).

#### Week 11 (June 19 – June 25)

**Day 1: Paper Structure**

```
Title: "Learning Per-Pixel Blending Weights for Hybrid
        Spherical Harmonic Relighting"
        (Alt: "Where Will Relighting Fail? Learned Per-Pixel Confidence
               for Hybrid Spherical Harmonic Transfer" — use only if writing is strong)

Abstract (250 words)

1. Introduction (1 page)
   - Single-image relighting is important
   - Ratio vs albedo methods: tradeoff exists but never formalized
   - We propose learned blending weights → predicts relative reliability of two complementary estimators
   - ConfNet adds ~5ms overhead (negligible within the full pipeline)
   - MUST PREEMPT (Final Fix #8): "Why not predict relighting directly?"
     Add paragraph: "End-to-end neural relighting (diffusion models) achieves superior
     visual quality but sacrifices controllability, interpretability, and real-time deployment.
     Our hybrid approach retains explicit SH control, runs in-browser with no server, and
     produces physically meaningful intermediate representations (confidence maps) that
     enable user-in-the-loop editing."

2. Related Work (1.5 pages)
   - 2.1 Single-Image Relighting (DPR, Total Relighting, IC-Light)
   - 2.2 Uncertainty in Computer Vision (Kendall, Poggi — highlight: not done for relighting)
   - 2.3 Hybrid Physics-Learning Methods

3. Method (2.5 pages)
   - 3.1 Hybrid SH Relighting Formulation (our math from Week 2)
   - 3.2 Error Analysis: When Does Each Method Fail? (THE KEY SECTION)
   - 3.3 ConfNet Architecture (15K params, 8-channel input)
   - 3.4 Training: Supervised + Self-Supervised Fine-Tuning
   - 3.5 Browser Deployment

4. Experiments (2.5 pages — see page budget note)
   - 4.1 Synthetic Benchmark (PSNR/SSIM/LPIPS — direct-only GT, our data)
   - 4.2 Multi-Illumination Benchmark (PSNR/SSIM/LPIPS — fixed 25-pair protocol, Murmann 2019)
   - 4.3 Comparison with DPR (portrait subset only) & IC-Light (latency table)
   - 4.4 Ablation Study (A1-A10 in main paper; A11/A12 details in supplementary)
   - 4.5 Error Analysis Visualization (1 key scatter plot — space permitting)
   - 4.6 Latency Analysis (hardware-specific, 3 devices)

> **PAGE BUDGET (R2#6 + R3#3)**: ACCV uses LNCS format. Typical limit is **14 pages total including references** (verify exact limit when ACCV 2026 CFP is published — varies by year). Content should be tight regardless. The additions (Multi-Illumination table, latency table, A11/A12) add ~1.25 pages. **Move to supplementary**:
> - Per-category breakdown (portraits/indoor/outdoor) → supplementary Table S1
> - A11/A12 ablation details → supplementary Section S2
> - Qualitative real-world results (Figure 4) can be compact — 2×3 grid, half page
> Plan the main paper layout in Week 11 Day 1 with exact figure/table sizing.

> **LATENCY REPORTING (Feedback #15 + R3#8 — Consistent Framing)**:
> Three different latency numbers appeared in prior versions (5ms, 10ms, 50ms). **Use this consistent framing everywhere**:
> - **ConfNet overhead**: ~5ms (this is our contribution's cost)
> - **Full pipeline**: ~50ms total (dominated by Depth Anything + SegFormer, NOT ConfNet)
> - **Paper claim**: "ConfNet adds negligible overhead (~5ms) to the existing pipeline"
> - Do NOT claim "real-time relighting" for the full pipeline unless total < 33ms
>
> Report median + 95th percentile timings on THREE specific devices:
>   1. Desktop: RTX 3070 + Chrome (WebGPU EP)
>   2. Laptop: M2 MacBook Pro + Chrome (WebGPU EP)
>   3. Laptop: M2 MacBook Pro + Chrome (WASM fallback)
> Report as a **component breakdown table**:
>   Depth Anything | Normal Est. | Segmentation | SceneAnalysis | **ConfNet** | GPU Render | Total
> This makes it crystal clear that ConfNet is not the bottleneck.

5. Conclusion (0.5 pages)
   - Summary, limitations (single directional light, no GI, synthetic-real gap), ethical note (relighting as manipulation)
   - Future work: intrinsic decomposition (Paper 2), video extension

Total: ~14 pages (LNCS format) + supplementary
```

**Day 2-3: Write Sections 1-3**

The method section is mostly done from Week 2 (math formalization). Polish it.

Key writing rules:
- Every claim backed by data or citation
- No overclaiming (we don't beat diffusion on quality — we compete on speed + controllability)
- Honest about limitations
- Clear, concise, no filler

**Day 4-5: Write Section 4 (Experiments)**

Turn the results from Weeks 7-10 into paper-quality tables and figures.

Key figures:
1. **Figure 1**: System overview (G-buffer → ConfNet → Hybrid relighting)
2. **Figure 2**: Error analysis scatter plot (origSH vs error, colored by material)
3. **Figure 3**: **Failure decomposition** (Final Fix #12 — THE paper-selling figure):
   For 3 diverse scenes: Input | Ratio error map | Albedo error map | Learned w | Final result | GT
   This communicates the entire contribution at a glance.
4. **Figure 4**: Qualitative comparisons on real images (hand-tuned vs ConfNet)
5. **Table 1**: Main results (PSNR/SSIM/LPIPS, both raw and normalized for Multi-Illum)
6. **Table 2**: Ablation study (A1-A15, grouped logically)

#### Week 12 (June 26 – July 4)

**Day 1-2: Draft Review + Polish**

- Self-review the full draft
- Fix clarity issues, check math notation consistency
- Ensure all figures are publication quality (vector graphics for plots, high-res for images)
- Write abstract and conclusion

**Day 3-4: Supplementary Material**

- Additional qualitative results (more images, failure cases)
- Full ablation details (A11-A15 results, per-category breakdown)
- Architecture diagram + channel 6/7 exact formulas with Python/JS parity verification
- Model size and latency breakdown by component
- SH-reconstructed vs original lighting visualization for Multi-Illumination (Strategic Fix #4)
- Residual correction experiment (A15) results — bounded with tanh (Final Fix #3)
- Grouped sensitivity analysis + causal perturbation results (Final Fixes #9, #11)
- Noise calibration methodology: σ_d and σ_n measurement protocol (Final Fix #1)
- Paradigm comparison table: diffusion vs CNN direct vs hybrid-ConfNet (Final Fix #8)
- Video showing interactive relighting with confidence visualization (optional but impressive)

**Day 5 (July 1-3): Final Edits + Submit**

- Proofread
- Check formatting against ACCV template
- Submit before July 5 deadline

**Day 6 (July 4): Backup Plan**

If not satisfied with paper quality:
- Don't submit to ACCV
- Continue polishing for WACV 2027 (deadline ~August) or CVPR 2027 (~November)
- Better to submit a strong paper late than a weak paper early

---

## File Structure (What Gets Created)

```
prime-kilonova/
├── docs/
│   ├── research_plan.md                    # Overall 3-paper plan (already created)
│   ├── research_phase_1.md                 # THIS DOCUMENT
│   └── research/
│       ├── literature_review.md            # Week 1 deliverable
│       ├── math_formalization.md           # Week 2 deliverable
│       └── related_work_draft.md           # Week 2 deliverable
│
├── training/                               # NEW: Research codebase
│   ├── README.md                           # Setup instructions
│   ├── requirements.txt                    # PyTorch, onnx, onnxconverter-common, lpips, imageio
│   │
│   ├── diff_renderer.py                    # Differentiable renderer (Week 3)
│   ├── validate_renderer.py               # Renderer validation (Week 4)
│   │
│   ├── confnet.py                          # ConfNet architecture (Week 7)
│   ├── confnet_residual.py                 # Residual extension for supplementary (Week 8)
│   ├── dataset.py                          # Data loading + noise injection (Week 5)
│   ├── losses.py                           # Loss functions incl. entropy reg (Week 7)
│   ├── train.py                            # Training loop (Week 7)
│   ├── eval_baseline.py                    # Baseline evaluation (Week 6)
│   ├── error_analysis.py                   # Error scatter plots (Week 6)
│   ├── interpretability.py                 # Feature importance analysis (Week 8)
│   ├── compute_gt_confidence.py            # Ground truth confidence (Week 6)
│   ├── export_onnx.py                      # ONNX export (Week 9)
│   ├── precompute_gbuffers.py              # Cache G-buffers for fine-tuning (Week 9)
│   ├── finetune_selfsupervised.py          # Self-supervised fine-tuning (Week 10)
│   │
│   ├── data/
│   │   ├── blender_render.py               # Blender rendering script (Week 5)
│   │   ├── fit_sh_to_hdr.py                # SH9 fitting from HDR panoramas (Week 5)
│   │   ├── preprocess_multi_illumination.py # SH fitting for eval dataset (Week 5)
│   │   ├── laval_sh_bank.npy               # Pre-computed SH9 (N, 9, 3) from Laval HDRs
│   │   ├── split_scenes.json               # Train/val/test scene assignments (frozen)
│   │   ├── eval_pairs.json                 # Fixed evaluation light pairs (frozen)
│   │   └── output/                         # Rendered data (gitignored)
│   │
│   ├── checkpoints/                        # Saved models (gitignored)
│   ├── results/                            # Experiment results
│   │   ├── baseline_metrics.json
│   │   ├── ablation_table.json
│   │   └── figures/                        # Paper figures
│   │
│   └── paper/                              # LaTeX paper (Week 11-12)
│       ├── main.tex
│       ├── figures/
│       └── accv2026.sty                    # Conference template
│
├── src/
│   ├── ml/
│   │   └── ConfidencePredictor.js          # NEW: Browser inference (Week 9)
│   │
│   └── relighting/v8/
│       ├── core/RelightingPipeline.js      # MODIFIED: integrate ConfNet (Week 9)
│       └── rendering/
│           ├── WebGL2DeferredRenderer.js   # MODIFIED: accept confidence texture (Week 9)
│           └── shaders/
│               └── deferred_lighting.wgsl  # MODIFIED: use confidence texture (Week 9)
```

---

## Resource Requirements

| Resource | Estimated Cost | Purpose |
|---|---|---|
| **GPU for training** | $0 (university) or $50 (Colab Pro+) | ConfNet trains in < 4 hours on any modern GPU (256×256 crops) |
| **GPU for Blender rendering** | $0 (local) or $40 (cloud) | 150 scenes × 10 lights × 2 passes (direct + full) = 3,000 renders → ~25-50 GPU-hours |
| **Multi-Illumination Dataset** | Free (MIT download) | External evaluation benchmark — requires SH fitting preprocessing |
| **Laval HDR Database** | Free (research license) | Source of realistic SH9 training lighting |
| **Storage** | ~80GB | Rendered data (~30GB) + Multi-Illumination (~40GB) + checkpoints |
| **LaTeX** | Free (Overleaf) | Paper writing |
| **DPR model** | Free (GitHub release) | Baseline comparison (portrait subset only) |
| **Total** | $0-$90 | Very low cost for a publication |

---

## Risk Mitigation

| Risk | Prob | Impact | Mitigation |
|---|---|---|---|
| ConfNet doesn't beat hand-tuned | 25% | HIGH | Still publish the formal error analysis as a study/analysis paper. Ratio/albedo formalization is novel regardless. |
| GT domain gap poisons training | 20% | HIGH | **FIXED**: Train against direct-only renders, not full GI. Validate by inspecting GT confidence maps for caustic artifacts. |
| Blender rendering too slow | 40% | MED | **FIXED**: Reduced to 150 scenes × 10 lights × 64 samples = ~30-50 GPU-hrs. Fallback: Kubric or OpenRooms. |
| ACCV deadline too tight | 35% | MED | Hard go/no-go checkpoints (May 7, May 21, June 4). WACV 2027 fallback with 4+ extra weeks. |
| Synthetic-to-real gap | 40% | MED | **FIXED**: Empirically calibrated noise + structured augmentation + Multi-Illumination fine-tuning. |
| ONNX RT WebGPU doesn't work | 30% | MED | **FIXED**: Smoke test in Week 4, not Week 9. WASM fallback (~20-30ms, still interactive). |
| Reviewer says "incremental" | 35% | HIGH | Preempt with "why not direct relighting" paragraph + paradigm comparison table. Cite Poggi/Ilg/Kendall. |
| No co-author / advisor | 60% | MED | **Action**: Reach out to professor in Week 1. Even a nominal advisor helps acceptance odds. |
| ConfNet learns normal quality, not relighting confidence | 25% | MED | **FIXED**: A11 ablation + grouped sensitivity analysis + causal perturbation cleanly separates effects. |
| Channel 6/7 Python!=JS mismatch | 30% | HIGH | **FIXED**: Exact formulas defined once, copy to both. Verify parity in Week 9 with numerical test. |
| Noise model arbitrary | 40% | HIGH | **FIXED**: Measure σ from Depth Anything vs GT. Report calibration methodology in supplementary. |

---

## How This Helps Your Internship Applications

When you approach a research lab, you can say:

> "I built a browser-based relighting system (Orlume). During development, I noticed the hybrid SH method uses a hand-tuned heuristic to blend two complementary relighting estimators. I formalized this as optimal blending under a constrained physically-inspired renderer, trained a lightweight predictor that learns the relative reliability of each estimator from G-buffer features, and proved through causal analysis that the model captures genuine scene-level reasoning (not just dataset correlations). The model is 30KB, adds ~5ms overhead, and improves quality by X dB. Paper submitted to ACCV 2026."

This demonstrates:
1. **Systems building** (Orlume itself — real deployed product)
2. **Problem identification** (finding the research question in engineering code)
3. **Mathematical formalization** (optimal blending under constrained renderer)
4. **ML training + rigorous evaluation** (ConfNet, 15 ablations, 3 baselines, interpretability)
5. **Deployment** (browser integration with verified Python↔JS parity)
6. **Publication** (paper submission)

This is exactly the profile that gets internships at labs like:
- Google Research (Computational Photography)
- Adobe Research
- MIT CSAIL (computational imaging groups)
- ETH Zürich (Computer Vision Lab)
- INRIA (visual computing)

---

## Checklist (Track Progress)

- [ ] **Week 1**: Read 12+ papers, write annotated bibliography, **reach out to potential advisor**
- [ ] **Week 2**: Write math formalization + related work draft
- [ ] **Week 3**: Build differentiable renderer (PyTorch)
- [ ] **Week 4**: Validate renderer (SH core > 45dB), **ONNX WebGPU smoke test**, ⚠️ GO/NO-GO #1
- [ ] **Week 5**: Build Blender pipeline (direct-only, Laval+PolyHaven SH, **per-channel RGB**), download Multi-Illumination + **fit SH9 + distribution check**, freeze splits, start rendering
- [ ] **Week 6**: Baseline metrics, error analysis plots, GT confidence maps, **measure noise σ_d/σ_n from DA vs GT**, ⚠️ GO/NO-GO #2
- [ ] **Week 7**: Train ConfNet (256×256 crops, **calibrated noise injection**, **entropy+TV reg**), first results
- [ ] **Week 8**: Complete ablation table (A1-A15 incl. **Linear(8-feat)/MLP baselines** + residual + **grouped sensitivity + causal perturbation**), **Multi-Illumination pipeline runs** (moved from Wk9), ⚠️ GO/NO-GO #3
- [ ] **Week 9**: ONNX export (**FP16 via onnxconverter_common**), browser integration, **verify Ch6/7 Python↔JS parity**, **precompute G-buffers**, DPR portrait-subset comparison
- [ ] **Week 10**: Self-supervised fine-tuning (cached G-buffers, **256×256 crops**), real-image eval, **component latency breakdown** (3 devices)
- [ ] **Week 11**: Write paper (title: "Learning Per-Pixel Blending Weights…", **failure decomposition figure**, interpretability, **preempt 'why not direct relighting'**)
- [ ] **Week 12**: Polish, supplementary (residual + sensitivity + causal perturbation + noise calibration + SH viz), submit to ACCV

---

*This phase produces 1 paper. After ACCV submission, immediately start Phase 2 (Intrinsic Decomposition). Phases don't overlap heavily — each builds on the previous.*

# Research Plan: Real-Time Single-Image Relighting via Hybrid Physics-Learning Pipeline with Learned Confidence

**Project**: Orlume — Browser-Native Computational Imaging System  
**Target**: Master's Thesis + 1-2 Publications  
**Last Updated**: 2026-04-09  
**Status**: Planning Phase

---

## Table of Contents

1. [Honest Assessment: What is NOT Novel](#1-honest-assessment-what-is-not-novel)
2. [Verified Research Gaps](#2-verified-research-gaps)
3. [Thesis Positioning & Narrative](#3-thesis-positioning--narrative)
4. [Research Contributions (Mapped to Gaps)](#4-research-contributions-mapped-to-gaps)
5. [Technical Deep-Dive](#5-technical-deep-dive)
6. [Evaluation Strategy](#6-evaluation-strategy)
7. [Thesis Structure](#7-thesis-structure)
8. [Publication Strategy](#8-publication-strategy)
9. [Timeline](#9-timeline)
10. [Risk Assessment](#10-risk-assessment)
11. [References & Reading List](#11-references--reading-list)

---

## 1. Honest Assessment: What is NOT Novel

Before claiming any contribution, we must be clear about what the research community has already solved or is actively working on. **We must NOT claim novelty on any of these.**

### 1A. Intrinsic Decomposition + Relighting Coupling

**Status**: Well-explored research direction.

- Joint relighting + decomposition pipelines already exist (InverseRenderNet, Yu & Smith 2019, Li et al. 2020)
- Self-supervised decomposition using relighting consistency is published (Nestmeyer et al. 2020, Yu et al. 2020)
- The problem of separating albedo from shading is a classic ill-posed inverse problem (Barrow & Tenenbaum 1978)
- Task-aware decomposition (optimizing decomposition for a downstream task) is emerging but not specific to our exact formulation

**Our constraint**: We *cannot* say "we are the first to combine intrinsic decomposition with relighting." We *can* say our decomposition is optimized for a specific downstream rendering formulation (SH transfer) under extreme compute constraints (browser).

### 1B. Diffusion-Based Relighting is SOTA

**Status**: Diffusion models dominate visual quality benchmarks.

- IC-Light, ControlNet-based relighting, Stable Diffusion + lighting control
- Produce stunning results but:
  - Lack physical consistency (albedo changes, geometry distortion)
  - Poor local/fine-grained control (can't place a point light precisely)
  - Slow inference (seconds to minutes)
  - Require GPU servers

**Our constraint**: We *cannot* compete on raw visual quality against diffusion. We *can* compete on:
- Physics-based controllability (precise light placement, SH rotation)
- Real-time interaction (< 50ms per frame)
- Client-side deployment (no server, no data upload, privacy-preserving)
- Predictable, physically-grounded behavior

### 1C. Ground-Truth Data is Scarce

**Status**: Universal problem in intrinsic decomposition and relighting.

- MIT Intrinsic Images: only 20 objects
- IIW/SAW: relative judgments, not ground truth
- Multi-Illumination (Murmann 2019): real scenes, 25 illuminations, but no material ground truth
- Everyone uses synthetic data + domain adaptation

**Our constraint**: This is NOT our novelty. It's a shared constraint. We rely on synthetic data (Blender) with domain adaptation techniques.

### 1D. Single-Image Relighting is Fundamentally Under-Constrained

**Status**: Acknowledged by the entire field.

- Cannot perfectly recover geometry, materials, and illumination from a single 2D image
- Any solution is an approximation — the question is how to make the best approximation for a given use case

**Our constraint**: We must frame our work as "best approximation under browser constraints" — not as solving the ill-posed problem.

---

## 2. Verified Research Gaps

These are the real gaps where our system has a genuine advantage. Each gap is backed by evidence from the literature.

### GAP 1: No Work Targets Real-Time Browser-Native Relighting

**Evidence**:
- All strong relighting methods run on GPU servers (IC-Light, Total Relighting, NeRF-based methods)
- Models are typically > 100MB (diffusion) or > 500MB (NeRF)
- No published work optimizes a relighting pipeline for WebGPU/WASM constraints
- The systems challenge of running depth + normals + segmentation + PBR rendering + SH lighting interactively in a browser is unstudied

**Why it matters**: Privacy (no image upload), accessibility (no GPU server), interactivity (real-time light manipulation), deployment (zero install).

**Our advantage**: Orlume already runs this pipeline. The research contribution is formalizing the design decisions, measuring the quality-latency tradeoffs, and publishing the first benchmark of browser-native relighting quality.

**Contribution type**: Systems + ML co-design paper.

---

### GAP 2: Confidence / Uncertainty Modeling for Relighting is Almost Ignored

**Evidence**:
- Relighting papers report average metrics (PSNR, SSIM) over entire images
- No per-pixel "will this relight correctly?" signal is modeled
- Failure modes (specular surfaces, flat textures, extreme shadows) are discussed qualitatively but never predicted
- The closest work is uncertainty in depth estimation (Poggi et al. 2020), but it's not applied to relighting
- No one predicts *where* relighting artifacts will appear before they happen

**Why it matters**:
- For editing tools: users need to know which regions are trustworthy
- For hybrid systems: confidence guides blending between physics and learning
- For the field: understanding failure modes is as important as improving average quality

**Our advantage**: Our system already has a hand-crafted `ConfidenceEstimator.js` (3-tier depth/normal/material analysis). The research gap is replacing this with a *learned* predictor and proving it improves relighting quality.

**Contribution type**: Novel ML contribution (publishable independently).

---

### GAP 3: Hybrid Physics + Learning Pipelines are Underexplored

**Evidence**:
- Current field is split into two extremes:
  - **Pure physics**: SH relighting, PBR rendering, inverse rendering (controllable but inaccurate, struggles with real images)
  - **Pure learning**: Diffusion, GAN, encoder-decoder (realistic but uncontrollable, black-box)
- The hybrid middle ground — physics-based rendering with learned corrections — is underexplored
- Specifically: no published work uses SH-based relighting with a *learned* residual correction network
- The ratio/albedo duality in SH transfer (our `mix(ratioResult, albedoResult, w)`) has never been formally analyzed

**Why it matters**:
- Physics gives control (light position, color, intensity, SH rotation)
- Learning fixes the physics model's errors on real images
- Together: controllable + realistic

**Our advantage**: Our shader implements exactly this hybrid approach. The research contribution is formalizing the framework, learning the correction, and demonstrating it's better than either extreme alone.

**Contribution type**: Core algorithmic novelty.

---

### GAP 4: G-Buffer Consistency for Relighting is Not Solved

**Evidence**:
- Standard practice: estimate depth, normals, segmentation, materials independently
- Each estimate has errors; these errors compound through the rendering pipeline
- Depth errors → bad normals → wrong shading. Segmentation errors → wrong materials → wrong specular
- No published work jointly refines a G-buffer specifically optimized for downstream relighting
- Multi-task estimation exists (Zamir et al., Taskonomy 2018) but not task-driven G-buffer refinement

**Why it matters**: The G-buffer is the bottleneck of deferred relighting. If the G-buffer is wrong, no amount of rendering sophistication helps.

**Our advantage**: Our system builds a concrete G-buffer (albedo + normals + depth + scene map) and renders through it. We can train a refinement network end-to-end through a differentiable version of our renderer.

**Contribution type**: Novel ML contribution.

---

### GAP 5: Task-Driven Intrinsic Decomposition (Optimize for Relighting, Not Reconstruction)

**Evidence**:
- Intrinsic decomposition methods optimize for reconstruction: `||I - A × S||`
- This doesn't guarantee the decomposition is useful for relighting
- Perfect reconstruction loss can be satisfied by many albedo/shading pairs (ill-posed)
- When the decomposed albedo is used for relighting, errors manifest as artifacts
- No work optimizes intrinsic decomposition loss specifically for downstream SH-based relighting quality

**Why it matters**: The decomposition that minimizes reconstruction error is NOT necessarily the decomposition that produces the best relighting.

**Our advantage**: We have a concrete downstream task (SH relighting in our shader) with a differentiable formulation. We can add SH-consistency and relighting-quality losses to the decomposition training.

**Contribution type**: Novel loss function / training paradigm.

---

## 3. Thesis Positioning & Narrative

### The Thesis Argument (One Sentence)

> *A hybrid physics-learning pipeline, when co-designed with learned confidence estimation and task-driven intrinsic decomposition, achieves controllable single-image relighting at real-time browser-native speeds — a quality-latency operating point inaccessible to pure learning (diffusion) or pure physics (inverse rendering) approaches.*

### Why This is a Thesis, Not a Paper

A single paper would address one gap. This thesis addresses the **intersection** of all five gaps through a unified system — the contribution is not just the individual techniques but the *framework* that connects them.

### Positioning Against SOTA

```
                    HIGH QUALITY
                        ↑
                        |
        IC-Light ●      |       ● Total Relighting
        (Diffusion)     |       (Neural, server)
                        |
                        |
                        |        ● DPR (SH, portraits)
                        |
                        |   ★ OURS (Hybrid, browser)
                        |
    ● SfSNet            |        ● Basic SH methods
    (Faces only)        |
                        |
                        +———————————————————→ REAL-TIME
                    SLOW                    INTERACTIVE
```

We don't compete on the quality axis (we lose to diffusion).  
We compete on the **quality × speed × controllability × privacy** product.  
No existing method occupies our position in this space.

### Contribution Hierarchy

```
THESIS-LEVEL (the whole story):
  "Real-time browser-native relighting via hybrid physics-learning"

  PAPER-LEVEL CONTRIBUTIONS (individually publishable):
    C1: Learned confidence for hybrid SH relighting ← GAP 2 + GAP 3
    C2: Task-driven intrinsic decomposition for SH transfer ← GAP 5
    C3: Neural G-buffer refinement for deferred relighting ← GAP 4

  SYSTEMS CONTRIBUTION (strong but harder to publish alone):
    C4: First browser-native relighting benchmark ← GAP 1
```

---

## 4. Research Contributions (Mapped to Gaps)

### 4.1 Contribution C1: Learned Confidence for Hybrid SH Relighting

**Addresses**: GAP 2 (confidence is ignored) + GAP 3 (hybrid pipelines underexplored)

**Problem Statement**: Our SH relighting shader combines two methods:
- **Ratio method**: `output = image × (newSH / origSH)` — safe, preserves texture, but can't change lighting drastically
- **Albedo method**: `output = (image / origSH) × newSH` — higher quality when decomposition is good, but blows up when origSH ≈ 0

Currently, blending is hand-tuned: `mix(ratio, albedo, smoothstep(0.15, 0.5, origSH) * 0.6)` (hardcoded in our GLSL shader, line 773).

**The Actual Research Question**: 
> *Can a lightweight learned predictor, given the G-buffer, predict per-pixel blend weights that are provably better than any fixed heuristic?*

**Why This is Real Research**:
- Formalizes the ratio/albedo duality (never done before)
- Creates a framework for "relighting confidence" (new concept)
- Tiny model (< 100KB), fits in browser, runs in < 15ms
- Self-supervised fine-tuning path for real images

**What We Claim**: Not that we invented SH relighting (well-known). We claim:
1. The first formal analysis of ratio vs. albedo SH transfer error modes
2. A learned per-pixel confidence map that reduces relighting artifacts by X dB compared to fixed blending
3. The confidence map generalizes as a failure predictor for user feedback

**What We Do NOT Claim**: Novel SH formulation, novel rendering technique, or SOTA visual quality.

---

### 4.2 Contribution C2: Task-Driven Intrinsic Decomposition for SH Transfer

**Addresses**: GAP 5 (decomposition not optimized for relighting)

**Problem Statement**: Current Orlume uses the original image as albedo (`this.albedo = imageData`). This bakes in original shading, causing double-lighting artifacts. Intrinsic decomposition methods exist, but they optimize `L_recon = ||I - A × S||`, which doesn't guarantee relight quality.

**The Actual Research Question**:
> *Does adding a relighting-quality loss to intrinsic decomposition training improve downstream relighting fidelity, compared to reconstruction-only losses?*

**Why This is Real Research**:
- Novel loss function: `L_relight = ||Render(A_pred, SH_new) - GT_relit||` alongside `L_recon`
- SH-consistency regularizer: `L_SH = ||S_pred - SH(N, l_est)||²` (constrains shading to be physically plausible)
- Tests a clear hypothesis: task-driven beats task-agnostic decomposition
- Practical constraint: model must be < 10MB for browser deployment (drives architectural choices)

**What We Claim**:
1. A training procedure that incorporates downstream SH rendering into the decomposition loss
2. Empirical evidence that task-driven decomposition improves relighting quality even when reconstruction metrics are similar
3. A compact model that fits the browser constraint

**What We Do NOT Claim**: First intrinsic decomposition, first decomposition for relighting, or SOTA decomposition accuracy. We explicitly acknowledge prior work combining the two tasks and differentiate our contribution as the *SH-specific loss formulation* under *extreme compute constraints*.

---

### 4.3 Contribution C3: Neural G-Buffer Refinement for Deferred Relighting

**Addresses**: GAP 4 (G-buffer consistency)

**Problem Statement**: Our G-buffer contains depth (Depth Anything), normals (Sobel + neural blend), materials (SegFormer + DB lookup), and scene properties (SceneAnalyzer heuristics). These are estimated independently. Errors compound: depth noise → noisy normals → wrong shading → artifacts.

**The Actual Research Question**:
> *Does a small refinement network that enforces cross-channel consistency in the G-buffer improve relighting quality, when trained end-to-end through a differentiable renderer?*

**Why This is Real Research**:
- Novel end-to-end optimization: G-buffer → differentiable renderer → relit image → loss against ground truth
- The network learns to fix exactly the errors that matter for rendering (not all errors equally)
- Cross-channel consistency losses formalize relationships that are currently implicit:
  - Depth gradients should align with normal directions
  - Material boundaries should align with segmentation boundaries
  - Curvature from depth should match curvature from normals
- Small model (< 5MB), residual learning (output = input + small Δ)

**What We Claim**:
1. A G-buffer refinement framework trained end-to-end through a differentiable relighting renderer
2. Cross-channel consistency losses that enforce depth-normal, material-segmentation, and curvature coherence
3. Measurable improvement in relighting quality with negligible latency increase

**What We Do NOT Claim**: First multi-task estimation, first G-buffer in computational photography, or SOTA depth/normal estimation. We explicitly acknowledge Taskonomy and similar multi-task work, differentiating our contribution as *task-driven refinement for a specific rendering pipeline*.

---

### 4.4 Systems Contribution C4: Browser-Native Relighting Benchmark

**Addresses**: GAP 1 (no browser-native relighting exists)

**This is a supporting contribution, not a standalone paper.** It provides:

1. **First benchmark**: Quality vs. latency vs. model size for browser-native relighting
2. **Design space exploration**: Which ML models are Pareto-optimal for browser deployment?
3. **Engineering insights**: WebGPU vs WebGL2 vs WASM performance for each pipeline stage
4. **Reproducible system**: Open-source implementation with all models, shaders, and evaluation scripts

This goes into Chapter 3 of the thesis (System Architecture) and supports the experimental evaluation of C1-C3.

---

## 5. Technical Deep-Dive

### 5.1 Differentiable Renderer (Foundation for C1, C2, C3)

All three contributions require training through the relighting pipeline. We must implement a **PyTorch differentiable version** of our WebGL2 fragment shader.

**Architecture Mirror**: The differentiable renderer must faithfully reproduce our GLSL shader logic:

```python
class DifferentiableRelighter(nn.Module):
    """
    Mirrors WebGL2DeferredRenderer fragment shader.
    All operations use PyTorch ops → gradients flow through.
    """
    
    def forward(self, albedo, normals, depth, scene_map,
                new_sh_coeffs, orig_sh_coeffs, light_dir):
        """
        Args:
            albedo: (B, 3, H, W) linear RGB
            normals: (B, 3, H, W) world-space normals
            depth: (B, 1, H, W) normalized depth
            scene_map: (B, 4, H, W) material/roughness/curvature/layer
            new_sh_coeffs: (B, 9) target SH9 coefficients
            orig_sh_coeffs: (B, 7) estimated original SH7 coefficients
            light_dir: (B, 3) normalized light direction
        Returns:
            relit: (B, 3, H, W) sRGB output
        """
        # ---- STEP 1: Normal smoothing (5-tap cross blur) ----
        normals = self.cross_blur_normals(normals)
        
        # ---- STEP 2: SH evaluation ----
        new_sh = self.evaluate_sh9(normals, new_sh_coeffs)   # (B, 1, H, W)
        orig_sh = self.evaluate_sh7(normals, orig_sh_coeffs) # (B, 1, H, W)
        
        # ---- STEP 3: Hybrid relighting ----
        # Ratio method (always stable)
        ratio = new_sh / orig_sh.clamp(min=0.08)
        ratio_result = albedo * ratio.lerp(torch.ones_like(ratio), 1 - intensity)
        
        # Albedo method (better quality when confident)
        orig_shading = orig_sh.clamp(min=0.25)
        estimated_albedo = (albedo / orig_shading).clamp(max=1.5)
        albedo_result = estimated_albedo * new_sh * intensity * 2.0 + estimated_albedo * ambient
        
        # ---- STEP 4: Blend (this is what C1 learns) ----
        # Default: hand-tuned confidence
        confidence = (orig_sh - 0.15).clamp(0, 1) / (0.5 - 0.15)  # smoothstep approx
        base = confidence * 0.6 * albedo_result + (1 - confidence * 0.6) * ratio_result
        
        # ---- STEP 5: Material-aware PBR specular ----
        roughness = scene_map[:, 1:2]
        specular = self.cook_torrance(normals, light_dir, roughness)
        
        # ---- STEP 6: SSS, shadows, rim light ----
        sss = self.subsurface_scatter(normals, light_dir, scene_map[:, 0:1])
        ssao = self.screen_space_ao(depth, normals)
        
        # ---- STEP 7: Composition ----
        result = base * ssao + specular * spec_scale + sss
        
        # ---- STEP 8: OKLAB color preservation ----
        result = self.oklab_preserve_chroma(result, albedo, strength=0.7)
        
        # ---- STEP 9: Gamut mapping + sRGB ----
        result = self.soft_gamut_map(result)
        result = self.linear_to_srgb(result)
        
        return result
```

**Validation requirement**: On 1000 random G-buffers, the differentiable renderer must match the WebGL2 shader output within **PSNR > 45 dB** (accounting for FP32 vs FP16 differences and bilinear interpolation differences).

### 5.2 Contribution C1: ConfNet Details

#### Architecture

```
Input: G-Buffer features (H×W×C)
  Channels:
    - depth (1)
    - normal_x, normal_y, normal_z (3)
    - roughness (1)
    - orig_SH_evaluation (1)
    - local_depth_gradient_magnitude (1)
    - local_normal_variance (1)
  Total: C = 8

Network:
  Conv2d(8, 32, 3, padding=1) → BN → ReLU
  Conv2d(32, 32, 3, padding=1) → BN → ReLU
  Conv2d(32, 16, 3, padding=1) → BN → ReLU
  Conv2d(16, 1, 1) → Sigmoid

Output: w(H×W×1) ∈ [0, 1]
  w = 0 → use ratio method
  w = 1 → use albedo method

Parameters: ~15K
Model size: ~30KB (FP16 ONNX)
Inference: ~5ms (WebGPU)
```

#### Training Procedure

**Phase 1: Synthetic Supervision**

```
For each synthetic scene (Blender):
  1. Render under lighting L_orig → get image I
  2. Render under lighting L_new  → get ground truth GT
  3. Extract ground truth: albedo A_gt, shading S_gt, depth D_gt, normals N_gt
  
  4. Compute both relighting methods:
     ratio_result  = I × SH(N, L_new) / SH(N, L_orig)
     albedo_result = A_gt × SH(N, L_new)  [using GT albedo, best case]
  
  5. Compute per-pixel optimal weight:
     For each pixel p:
       err_ratio(p)  = |ratio_result(p) - GT(p)|
       err_albedo(p) = |albedo_result(p) - GT(p)|
       w_optimal(p) = softmax(-λ × [err_ratio(p), err_albedo(p)])[1]
  
  6. Train ConfNet:
     w_pred = ConfNet(G_buffer_features)
     L_conf = BCE(w_pred, w_optimal)
```

**Phase 2: Self-Supervised Fine-Tuning on Real Images**

```
For real images (no GT available):
  1. Run full pipeline: image → G-buffer → relit under L₁, L₂, ..., L_K
  2. Temporal consistency loss:
     Small changes in light → small changes in output
     L_temporal = ||∂output/∂light|| should be smooth
  3. Photometric consistency:
     If we relight from L₁→L₂ and L₂→L₁, we should get the original back
     L_cycle = ||Relight(Relight(I, L₁→L₂), L₂→L₁) - I||
```

#### Analysis Plan (The "Formalization" Part)

This is what makes it a research paper, not just an engineering improvement:

1. **Theoretical analysis of ratio vs. albedo error**:
   - When does ratio fail? → When `origSH ≈ newSH` (no lighting change to transfer)
   - When does albedo fail? → When `origSH ≈ 0` (shadow regions, division by near-zero)
   - Derive error bounds as functions of origSH magnitude, lighting change angle, albedo dynamic range

2. **Empirical validation**:
   - Scatter plot: `origSH` value vs. method error for 100K pixels
   - Show that the learned confidence correlates with but improves upon the theoretical prediction

3. **Ablation**:
   - ConfNet (learned) vs. `0.6 × smoothstep(0.15, 0.5, origSH)` (current hand-tuned)
   - ConfNet vs. simple origSH thresholding
   - ConfNet vs. depth-only confidence
   - ConfNet with vs. without self-supervised fine-tuning

### 5.3 Contribution C2: IDNet Details

#### Architecture

```
Input: RGB Image (H×W×3)

Encoder: MobileNetV3-Small (pre-trained on ImageNet)
  Conv 3→16 → InvertedResidual blocks → features (H/8 × W/8 × 112)
  
  OPTIONAL: Shared encoder with depth model (amortize loading cost)
  If using Depth Anything V2's encoder → replace MobileNetV3 with ViT-Small features
  This requires Depth Anything to output intermediate features (may need custom ONNX export)

Albedo Decoder:
  TransposeConv 112→64 (H/4) + skip from encoder level 3
  TransposeConv 64→32 (H/2) + skip from encoder level 2
  TransposeConv 32→16 (H) + skip from encoder level 1
  Conv 16→3 → Sigmoid
  Output: Albedo A (H×W×3) ∈ [0, 1]

Shading Decoder:
  TransposeConv 112→64 (H/4) + skip
  TransposeConv 64→32 (H/2) + skip
  TransposeConv 32→16 (H) + skip
  Conv 16→1 → Softplus  [shading is positive, unbounded]
  Output: Shading S (H×W×1) ∈ [0, ∞)

Total parameters: ~5M
Model size: ~10MB (FP16 ONNX)
Inference: ~150ms (WebGPU), ~400ms (WASM)
```

#### Training Loss (The Novel Part)

```
L_total = λ₁·L_recon + λ₂·L_relight + λ₃·L_SH + λ₄·L_smooth + λ₅·L_distill

# --- Standard (not novel) ---
L_recon = ||I - A ⊙ S||₁                          
# Reconstruction: image should equal albedo × shading

L_smooth = ||∇A||₁ ⊙ exp(-α·||∇I||₁)              
# Albedo smoothness: albedo gradients should be sparse
# (Retinex prior: albedo changes at edges, not in smooth regions)

L_distill = ||A - A_teacher||₁ + ||S - S_teacher||₁  
# Knowledge distillation from a large teacher model
# Teacher: Omnidata or InverseRenderNet (run offline, not in browser)

# --- NOVEL (our contribution) ---
L_relight = ||DiffRenderer(A_pred, SH_new) - GT_relit||₁
# Task-driven loss: the decomposition that produces the best relighting
# GT_relit is ground truth from Blender under new illumination
# DiffRenderer is our differentiable renderer from Section 5.1

L_SH = ||S_pred - SH₇(N_est, l_est)||²
# SH consistency: predicted shading should be expressible as SH evaluation
# N_est = estimated normals (from Depth Anything), l_est = estimated light direction
# This constrains shading to be physically plausible (smooth, low-frequency)
# Unlike standard L_recon which allows arbitrary shading patterns

Weights: λ₁=1.0, λ₂=0.5, λ₃=0.3, λ₄=0.1, λ₅=0.5
```

**The key insight we publish**: The `L_relight` loss creates an implicit feedback loop — the decomposition is trained to produce albedos that *look good when re-rendered*, not just albedos that reconstruct the input well. We show cases where `L_recon` is similar but `L_relight` is significantly better with our task-driven approach.

#### Integration into Existing Code

```javascript
// In RelightingPipeline.js, replace lines 248-253:

// BEFORE (current):
// Step 5: Intrinsic Decomposition
// TODO: Implement actual intrinsic decomposition
// this.albedo = imageData;

// AFTER (with IDNet):
this._reportProgress(progressCallback, 70, 'Decomposing intrinsic layers...');
const intrinsicResult = await this.intrinsicDecomposer.decompose(
    processedImage, 
    this.width, 
    this.height
);
this.albedo = intrinsicResult.albedo;           // Clean albedo (no baked shading)
this.originalShading = intrinsicResult.shading;  // Estimated shading map
// The shading map replaces the hand-estimated origSH in the renderer
```

### 5.4 Contribution C3: GBRefNet Details

#### Architecture

```
Input: Raw G-Buffer + Original Image
  Channels:
    - image_rgb (3) — provides color/texture context
    - depth (1)
    - normal_xyz (3)
    - scene_map_rgba (4) — material, roughness, curvature, depth_layer
  Total input: 11 channels

Network: Residual U-Net (3 levels, residual = learn only the correction Δ)
  
  Encoder:
    Level 1: Conv(11, 32, 3) → BN → ReLU → Conv(32, 32, 3) → BN → ReLU → MaxPool
    Level 2: Conv(32, 64, 3) → BN → ReLU → Conv(64, 64, 3) → BN → ReLU → MaxPool  
    Level 3: Conv(64, 128, 3) → BN → ReLU → Conv(128, 128, 3) → BN → ReLU
    
  Decoder:
    Level 2: Upsample → Cat(skip2) → Conv(192, 64, 3) → BN → ReLU → Conv(64, 64, 3) → BN → ReLU
    Level 1: Upsample → Cat(skip1) → Conv(96, 32, 3) → BN → ReLU → Conv(32, 32, 3) → BN → ReLU
    Output: Conv(32, 8, 1)  → 1 depth + 3 normals + 4 scene_map

  Residual connection:
    output = input_gbuffer + α · network_output   (α = 0.1, learnable scale)
    
  Post-processing:
    - Re-normalize normals: N_refined = normalize(N_refined)
    - Clamp depth: D_refined = clamp(D_refined, 0, 1)
    - Clamp scene map channels to valid ranges

Total parameters: ~2.1M
Model size: ~4.2MB (FP16 ONNX)
Inference: ~80ms (WebGPU)
```

#### Training Loss

```
L_total = λ₁·L_relight + λ₂·L_depth_normal + λ₃·L_material_seg + λ₄·L_curvature + λ₅·L_identity

# --- Primary: train through differentiable renderer ---
L_relight = ||DiffRenderer(GB_refined, L_new) - GT_relit||₁ + 
            0.1 × LPIPS(DiffRenderer(GB_refined, L_new), GT_relit)
# → Network learns to fix G-buffer errors that hurt rendering

# --- Cross-channel consistency (novel losses) ---

L_depth_normal = || ∂D/∂x + N_x/N_z ||² + || ∂D/∂y + N_y/N_z ||²
# Depth gradients should be consistent with normal components
# If depth increases to the right, normals should point left
# (This relationship is geometric and exact for Lambertian surfaces)

L_material_seg = KL(softmax(M_refined) || M_from_segformer)
# Refined materials should stay close to segmentation-based priors
# Prevents the network from inventing materials that don't match the class

L_curvature = || (∂²D/∂x² + ∂²D/∂y²) - curvature_from_normals ||²
# Mean curvature from depth second derivatives should match 
# curvature computed from normal derivatives
# (These are two independent measurements of the same geometric quantity)

# --- Regularization ---
L_identity = ||GB_refined - GB_input||₂
# Don't change the G-buffer too much (the inputs are already decent)
# This prevents mode collapse and ensures the corrections are small

Weights: λ₁=1.0, λ₂=0.3, λ₃=0.1, λ₄=0.2, λ₅=0.01
```

### 5.5 Synthetic Data Pipeline (Shared by All Contributions)

```
Blender Pipeline (Python scripted):

1. Scene Setup:
   - Load 3D scene (ShapeNet objects, Replica rooms, procedural terrain)
   - Assign PBR materials from curated library (500+ materials)
   - Place camera at random viewpoint

2. Lighting:
   - Sample K random SH9 lighting environments (K=25 per scene)
   - Option A: Random SH coefficients with realistic constraints
   - Option B: Sample from real HDR environment maps, project to SH9
   
3. Render Ground Truth:
   For each lighting condition:
   - Full render: image I_k
   - AOV passes: albedo A_gt, shading S_gt, depth D_gt, normals N_gt
   - Material maps: roughness, metallic (from Blender material nodes)
   
4. Format:
   - Images: PNG 512×512 (training), 1024×1024 (evaluation)
   - Depth: EXR float32
   - Normals: 16-bit PNG
   - Materials: 8-bit PNG (RGBA = roughness/metallic/subsurface/emissive)

Target: 50K scenes × 25 lightings = 1.25M paired images
Storage: ~2TB
Render time: ~500 GPU-hours on a single RTX 3090
```

---

## 6. Evaluation Strategy

### 6.1 Metrics (Honest About What We Measure)

| Metric | What It Shows | Where Used |
|---|---|---|
| **PSNR** | Pixel-level accuracy | Relighting vs GT |
| **SSIM** | Structural similarity | Relighting vs GT |
| **LPIPS** (AlexNet) | Perceptual quality | Relighting vs GT |
| **si-LMSE** | Scale-invariant local error | Intrinsic decomposition (C2) |
| **WHDR** | Weighted human disagreement rate | Albedo quality on IIW |
| **Inference latency** | Speed | All models, per-component |
| **Model size** | Deployability | All models |
| **Total pipeline time** | End-to-end | Full system |

### 6.2 Benchmarks

| Dataset | Size | Use | Measures |
|---|---|---|---|
| **Multi-Illumination** (Murmann 2019) | 1000 scenes × 25 lights | Relighting quality | PSNR/SSIM/LPIPS: input under light A, predict light B |
| **VIDIT** | 300 scenes × 40 lights | Relighting quality | Same metrics, more lighting diversity |
| **MIT Intrinsic** | 20 objects | Decomposition quality | si-LMSE on albedo/shading |
| **IIW** (Bell 2014) | 5000 images | Albedo ordinal quality | WHDR (pairwise albedo judgments) |
| **Custom in-the-wild** | 200 diverse images | Qualitative + user study | No GT, user study only |

### 6.3 Baselines

| Baseline | Category | How We Compare |
|---|---|---|
| **Current Orlume (no intrinsic, hand-tuned confidence)** | Our own baseline | Ablation: how much does each contribution add? |
| **DPR** (Zhou 2019) | SH-based, portraits | Same paradigm, they do portraits, we do general scenes |
| **IC-Light** (Zhang 2024) | Diffusion-based | Visual quality comparison (they win), speed comparison (we win), controllability comparison (we win) |
| **StyLitGAN** (2023) | Style transfer | Show we preserve identity better |
| **InverseRenderNet** (Yu 2019) | Intrinsic + relighting | Direct competitor for C2 |
| **Ratio-only / Albedo-only** | Ablation | Show hybrid is better than either alone |

### 6.4 User Study

**Design**: Forced-choice comparison (simpler than DSIS, more statistical power for small N)

```
Setup:
- 25 participants (recruited from university, mix of CS and non-CS)
- 40 source images (10 portraits, 10 outdoor, 10 indoor, 10 mixed)
- Each image relit to 3 target directions (120 total comparisons)
- Each comparison: "Which relighting looks more natural?" 
  → Ours vs. Current Orlume
  → Ours vs. IC-Light
  → Ours vs. DPR

Analysis:
- Bradley-Terry model for ranking
- Binomial test for pairwise significance
- Report: 95% CI on preference rate
```

### 6.5 Ablation Table (Pre-Planned)

| Configuration | Change from Full | Question |
|---|---|---|
| Full system (C1+C2+C3) | — | Upper bound |
| No ConfNet (C2+C3, hand-tuned confidence) | Remove C1 | How much does learned confidence help? |
| No IDNet (C1+C3, image as albedo) | Remove C2 | How much does decomposition help? |
| No GBRefNet (C1+C2, raw G-buffer) | Remove C3 | How much does refinement help? |
| No L_relight in IDNet (C1+C2'+C3) | Remove task-driven loss | Does task-driven really help? |
| No L_SH in IDNet (C1+C2''+C3) | Remove SH consistency | Does SH constraint help? |
| No self-supervised ConfNet fine-tuning | Remove phase 2 | Does real-image fine-tuning help? |
| No cross-channel losses in GBRefNet | Remove consistency losses | Do consistency losses matter? |
| Current Orlume (baseline) | Remove C1+C2+C3 | Lower bound |

---

## 7. Thesis Structure

### Proposed Title
> **"Learned Confidence and Task-Driven Decomposition for Real-Time Single-Image Relighting in the Browser"**

### Chapter Plan

| Ch | Title | Pages | Content |
|---|---|---|---|
| **1** | Introduction | 8 | Problem: editing lighting in photos. Motivation: real-time, in-browser, no upload. Contributions: C1-C4. Thesis outline. |
| **2** | Background | 22 | Image formation (rendering equation → SH approximation). Intrinsic images (Barrow 1978 → present). Monocular depth/normals. Deferred rendering. Browser-based ML (ONNX, WebGPU). **Honest positioning**: what's solved, what's open. |
| **3** | System Architecture | 18 | Full Orlume pipeline description. G-buffer design. SH relighting math. Material-aware PBR. WebGPU/WebGL2 infrastructure. Performance benchmarks. Browser constraint analysis. **(C4: Systems contribution)** |
| **4** | Learned Confidence for Hybrid Relighting | 16 | Formal analysis of ratio vs. albedo error. ConfNet architecture. Synthetic training + self-supervised fine-tuning. Experiments. **(C1)** |
| **5** | Task-Driven Intrinsic Decomposition | 16 | IDNet architecture. Novel SH-consistency and relighting losses. Knowledge distillation for browser size. Experiments on MIT/IIW. **(C2)** |
| **6** | Neural G-Buffer Refinement | 14 | GBRefNet architecture. Cross-channel consistency losses. End-to-end training through differentiable renderer. Experiments. **(C3)** |
| **7** | Evaluation | 18 | Full benchmark results. User study. Ablation table. Comparison with baselines. Failure case analysis. Latency breakdown. |
| **8** | Discussion | 6 | Limitations (single light, Lambertian assumption, 8-bit depth). Ethical considerations (relighting as manipulation). Comparison to diffusion (different tradeoff, not replacement). Future: video, multi-light, HDR. |
| **9** | Conclusion | 3 | Summary. Impact. Open problems. |
| | **Total** | **~121** | |

---

## 8. Publication Strategy

### Decoupled Papers (Each Independently Publishable)

**Paper 1** (strongest, submit first):
> *"Where Will Relighting Fail? Learned Per-Pixel Confidence for Hybrid Spherical Harmonic Transfer"*
- Content: C1 (ConfNet) + formal ratio/albedo analysis
- Target: **ECCV 2026** or **ICCV 2027** (depends on timeline)
- Why strong: New concept (relighting confidence), clean formulation, small model = easy to reproduce
- Backup: CVPR Workshop on Computational Photography

**Paper 2** (combine C2+C3 for stronger story):
> *"Task-Driven Scene Decomposition for Interactive Relighting: From Intrinsic Images to Refined G-Buffers"*
- Content: IDNet (C2) + GBRefNet (C3) + differentiable renderer
- Target: **CVPR 2027** or **ACM TOG**
- Why strong: End-to-end story from decomposition → refinement → rendering
- Backup: IEEE TPAMI (journal, rolling deadline)

**Paper 3** (systems paper, if time permits):
> *"Orlume: A Browser-Native Pipeline for Real-Time AI Photo Relighting"*
- Content: C4 (system description) + lightweight versions of C1-C3
- Target: **SIGGRAPH Asia** (systems track) or **ACM MM** (multimedia)
- Why appropriate: Systems contributions valued at these venues

### Recommended Order

1. **Month 3-4**: Draft Paper 1 (ConfNet) — smallest scope, fastest to validate
2. **Month 5-6**: Draft Paper 2 (IDNet + GBRefNet) — needs more experiments
3. **Month 7+**: Submit Paper 1, draft Paper 3, submit Paper 2

---

## 9. Timeline

### Phase 1: Foundation (Weeks 1-6)

| Week | Task | Deliverable |
|---|---|---|
| 1-2 | Deep literature review (50+ papers) | Annotated bibliography, related work draft |
| 2-3 | Blender synthetic data pipeline | Script that renders scenes with GT intrinsic decomposition |
| 3-4 | Differentiable renderer in PyTorch | Module that matches WebGL2 output (PSNR > 45dB) |
| 4-5 | Generate initial training data | 10K scenes × 25 lightings |
| 5-6 | Baseline metrics on Multi-Illumination | Current Orlume PSNR/SSIM/LPIPS numbers |

### Phase 2: Core Research (Weeks 7-16)

| Week | Task | Deliverable |
|---|---|---|
| 7-9 | C1: Train ConfNet (synthetic phase) | ConfNet that beats hand-tuned by > 0.5 dB |
| 9-10 | C1: Self-supervised fine-tuning | ConfNet fine-tuned on real images |
| 10-13 | C2: Train IDNet | IDNet with competitive LMSE on MIT, < 10MB |
| 12-14 | C3: Train GBRefNet | GBRefNet with measurable improvement |
| 14-16 | ONNX export + browser integration | All 3 models running in Orlume |

### Phase 3: Evaluation (Weeks 17-20)

| Week | Task | Deliverable |
|---|---|---|
| 17-18 | Full benchmark evaluation | Numbers on Multi-Illumination, VIDIT, MIT Intrinsic, IIW |
| 18-19 | Ablation experiments | Complete ablation table |
| 19-20 | User study | 25 participants, statistical analysis |

### Phase 4: Writing (Weeks 21-26)

| Week | Task | Deliverable |
|---|---|---|
| 21-22 | Paper 1 draft (ConfNet) | Complete draft for advisor review |
| 22-24 | Thesis chapters 1-5 | First complete draft |
| 24-25 | Thesis chapters 6-9 | Full thesis draft |
| 25-26 | Revisions + defense prep | Final thesis |

### Critical Milestones

- **Week 6**: Differentiable renderer validated ✓ → foundation for all research
- **Week 10**: ConfNet improvement confirmed ✓ → Paper 1 is viable
- **Week 14**: IDNet deployed in browser ✓ → Paper 2 is viable
- **Week 20**: All experiments complete ✓ → writing can begin
- **Week 26**: Thesis + Paper 1 submitted ✓

---

## 10. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **ConfNet doesn't beat hand-tuned baseline** | 25% | HIGH | Publish formal analysis of ratio/albedo duality as theoretical contribution; pivot to attention-based blending |
| **IDNet quality insufficient for publication** | 30% | MEDIUM | Use as engineering contribution in system paper; focus thesis on C1+C3 |
| **Differentiable renderer too slow for training** | 15% | HIGH | Train at low resolution (256×256), evaluate at high resolution; use gradient checkpointing |
| **Synthetic-to-real domain gap** | 40% | MEDIUM | Aggressive augmentation; perceptual losses (LPIPS); self-supervised fine-tuning on real images |
| **Browser inference too slow (> 300ms per model)** | 20% | HIGH | INT8 quantization; reduce model via pruning; process at half resolution and upsample |
| **Insufficient training compute** | 15% | MEDIUM | Google Colab Pro+ (~$50/month); apply for university GPU time; train smaller models first |
| **User study shows no preference** | 25% | MEDIUM | Increase N; focus on specific image categories where we expect to win (portraits, indoor) |

### Minimum Viable Thesis (if everything goes wrong)

Even in the worst case, we can defend:
1. **C4 (systems)**: Orlume already works — describing and benchmarking it is a valid systems contribution
2. **C1 partial**: Formal analysis of ratio vs. albedo SH transfer (theoretical contribution, no ML needed)
3. **C2 partial**: Showing that any intrinsic decomposition improves relighting (even off-the-shelf, no training)

This gives a "solid B+" thesis even if all ML training fails.

---

## 11. References & Reading List

### Must-Read Papers (Essential Background)

**Intrinsic Images**:
- Barrow & Tenenbaum (1978) — "Recovering Intrinsic Scene Characteristics" (origin of the field)
- Grosse et al. (2009) — "Ground truth dataset and baseline evaluations for intrinsic images"
- Bell et al. (2014) — "Intrinsic Images in the Wild" (IIW dataset)
- Li & Snavely (2018) — "CGIntrinsics: Better Intrinsic Images by Learning from Rendering"
- Nestmeyer et al. (2020) — "Learning Physics-guided Face Relighting under Directional Light"

**Single-Image Relighting**:
- Zhou et al. (2019) — "Deep Single-Image Portrait Relighting" (DPR) — SH-based
- Pandey et al. (2021) — "Total Relighting" — environment map relighting
- Zhang et al. (2024) — "IC-Light" — diffusion-based relighting
- Sengupta et al. (2018) — "SfSNet: Learning Shape, Reflectance and Illuminance of Faces"

**Depth & Normals**:
- Yang et al. (2024) — "Depth Anything V2" (what we use)
- Bae et al. (2024) — "DSINE: Dense Surface Normal Estimation" (potential replacement for our normals)
- Ranftl et al. (2021) — "DPT: Vision Transformers for Dense Prediction"

**Deferred Rendering & PBR**:
- Karis & Epic Games (2013) — "Real Shading in Unreal Engine 4"
- Ramamoorthi & Hanrahan (2001) — "An Efficient Representation for Irradiance Environment Maps" (SH for rendering)

**Uncertainty/Confidence in Vision**:
- Poggi et al. (2020) — "On the Uncertainty of Self-Supervised Monocular Depth Estimation"
- Kendall & Gal (2017) — "What Uncertainties Do We Need in Bayesian Deep Learning for Computer Vision?"

**Multi-Task Learning / G-Buffer**:
- Zamir et al. (2018) — "Taskonomy: Disentangling Task Transfer Learning"
- Zamir et al. (2020) — "Robust Learning Through Cross-Task Consistency"

### Papers to Position Against (Competitors)

- Yu & Smith (2019) — "InverseRenderNet" (intrinsic + lighting, server-based)
- Wei et al. (2020) — "Single Image Intrinsic Decomposition with Discriminative-Generative Priors"
- Zhu et al. (2022) — "Learning-based Relighting with Various Illumination Representation"
- Liu et al. (2024) — "Neural Intrinsic Decomposition with Self-Supervised Shading Guidance" (recent!)

### System/Deployment Papers

- Nickolls et al. — "WebGPU: A Web API for Modern GPU Programming"
- Hugging Face — "Transformers.js: Running ML Models in the Browser"

---

## Appendix A: Code References (Where Research Connects to Codebase)

| Contribution | Primary File(s) | Integration Point |
|---|---|---|
| C1: ConfNet | New: `src/ml/ConfidencePredictor.js` | Replace hand-tuned blend in `WebGL2DeferredRenderer.js` line 773: `mix(ratioResult, albedoResult, albedoConfidence * 0.6)` → `mix(ratioResult, albedoResult, confnet_output)` |
| C2: IDNet | New: `src/ml/IntrinsicDecomposer.js` | Replace `RelightingPipeline.js` lines 248-253: `this.albedo = imageData` → `this.albedo = idnet.decompose(image).albedo` |
| C3: GBRefNet | New: `src/ml/GBufferRefiner.js` | Insert after `RelightingPipeline.js` line 265 (after `_buildGBuffer()`): `this.gBuffer = await refiner.refine(this.gBuffer)` |
| C4: Benchmark | New: `benchmark/` directory | Performance measurement scripts for all pipeline stages |
| Differentiable Renderer | New: `training/diff_renderer.py` | PyTorch mirror of `WebGL2DeferredRenderer.js` shader (lines 547-880) |

## Appendix B: Honest "What If" Scenarios

| Scenario | Outcome | Action |
|---|---|---|
| All 3 contributions work | Excellent thesis, 2 papers | Submit Paper 1 to ECCV, Paper 2 to CVPR |
| Only C1 works | Good thesis, 1 paper | Focus thesis on confidence analysis; C2/C3 become "future work" |
| Only C2 works | Good thesis, 1 paper | Focus on task-driven decomposition; C1/C3 become "future work" |
| Only C3 works | Decent thesis, workshop paper | G-buffer refinement alone is a narrower contribution |
| Nothing works | Baseline thesis | Formalize the existing hybrid pipeline as a systems contribution (C4); include negative experimental results as science |

---

*This document is a living plan. Update it as experiments produce results.*

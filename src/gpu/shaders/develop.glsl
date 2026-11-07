#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

// Basic adjustments
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;
uniform float u_saturation;
uniform float u_clarity;
uniform float u_structure;
uniform float u_dehaze;
uniform bool u_enableDither;

// Exposure Clipping Warning (Lightroom Style)
uniform bool u_showClipping;
uniform bool u_clipShadows;
uniform bool u_clipHighlights;

// HSL Per-Channel (8 colors × 3 channels = 24 uniforms)
uniform bool u_hasHSL;
uniform float u_hslHue[8];    // Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta
uniform float u_hslSat[8];
uniform float u_hslLum[8];

// Tone Curve LUT textures
uniform bool u_hasCurveLut;
uniform bool u_hasRgbCurve;
uniform sampler2D u_curveLutTexRgb;
uniform bool u_hasRedCurve;
uniform sampler2D u_curveLutTexRed;
uniform bool u_hasGreenCurve;
uniform sampler2D u_curveLutTexGreen;
uniform bool u_hasBlueCurve;
uniform sampler2D u_curveLutTexBlue;

// 3D LUT Color Grading
uniform bool u_hasLut3d;
uniform highp sampler3D u_lut3dTexture;
uniform float u_lut3dIntensity;
uniform float u_lut3dSize;

// Multi-scale base textures
uniform bool u_hasBase;             // True when multi-scale illumination base buffers are active
uniform sampler2D u_blurTexture;    // Base illumination (~3.0% long edge)
uniform sampler2D u_clarityTexture; // Mid-scale illumination (~0.86% long edge)
uniform bool u_isBaseLinear;        // Base textures are in physical linear light space
uniform mat3 u_wbMatrix;            // Precomputed CPU Bradford LMS Chromatic Adaptation Matrix

#include <modules/common.glsl>
#include <modules/color_grading.glsl>

// Color Grading Uniforms
uniform vec2 u_shadowsColor;      // x=Hue, y=Sat
uniform vec2 u_midtonesColor;
uniform vec2 u_highlightsColor;
uniform vec2 u_shadowsChromaDir;   // Precomputed normalized OKLab (a, b) direction
uniform vec2 u_midtonesChromaDir;
uniform vec2 u_highlightsChromaDir;
uniform float u_shadowsLum;
uniform float u_midtonesLum;
uniform float u_highlightsLum;
uniform float u_colorBalance;     // -100 to 100
uniform float u_colorBlending;    // 0 to 100

// Smooth half-texel mapping for 1D Curve LUT textures
float getCurveCoord(float val) {
    return (clamp(val, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
}

// Gamut compression: smoothly desaturates out-of-gamut RGB toward luminance.
// Guards against Y <= 0 (which occurs after extreme WB shifts) to prevent
// the k = Y/(Y-mn) formula from inverting the pixel instead of compressing it.
vec3 gamutCompress(vec3 c) {
    float Y  = max(0.0, luminance(c));  // Non-negative guard: prevents mirror artifact
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float k = 1.0;
    if (mx > 1.0 && mx > Y) k = min(k, (1.0 - Y) / (mx - Y));
    if (mn < 0.0 && Y > mn) k = min(k, Y / (Y - mn));
    return Y + (c - Y) * max(0.0, k);
}

// Jorge Jimenez Interleaved Gradient Noise for screen-space TPDF dither
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// Joint Bilateral Upsampling (Kopf et al., SIGGRAPH 2007)
// Samples low-res texture with edge-preserving bilateral weighting guided by full-res log luminance
vec3 jointUpsample(sampler2D lowResTex, vec2 uv, float guideLogLuma, float sigmaJoint) {
    vec2 lowResSize = vec2(textureSize(lowResTex, 0));
    vec2 pos = uv * lowResSize - 0.5;
    vec2 p0 = floor(pos);
    vec2 f = fract(pos);
    
    vec2 uv00 = (p0 + vec2(0.5, 0.5)) / lowResSize;
    vec2 uv10 = (p0 + vec2(1.5, 0.5)) / lowResSize;
    vec2 uv01 = (p0 + vec2(0.5, 1.5)) / lowResSize;
    vec2 uv11 = (p0 + vec2(1.5, 1.5)) / lowResSize;
    
    vec3 c00 = textureLod(lowResTex, uv00, 0.0).rgb;
    vec3 c10 = textureLod(lowResTex, uv10, 0.0).rgb;
    vec3 c01 = textureLod(lowResTex, uv01, 0.0).rgb;
    vec3 c11 = textureLod(lowResTex, uv11, 0.0).rgb;
    
    float sw00 = (1.0 - f.x) * (1.0 - f.y);
    float sw10 = f.x * (1.0 - f.y);
    float sw01 = (1.0 - f.x) * f.y;
    float sw11 = f.x * f.y;
    
    float twoSigmaSq = 2.0 * sigmaJoint * sigmaJoint;
    
    float l00 = log2(max(luminance(c00), 1e-4));
    float l10 = log2(max(luminance(c10), 1e-4));
    float l01 = log2(max(luminance(c01), 1e-4));
    float l11 = log2(max(luminance(c11), 1e-4));
    
    float rw00 = exp(-(l00 - guideLogLuma) * (l00 - guideLogLuma) / twoSigmaSq);
    float rw10 = exp(-(l10 - guideLogLuma) * (l10 - guideLogLuma) / twoSigmaSq);
    float rw01 = exp(-(l01 - guideLogLuma) * (l01 - guideLogLuma) / twoSigmaSq);
    float rw11 = exp(-(l11 - guideLogLuma) * (l11 - guideLogLuma) / twoSigmaSq);
    
    float w00 = sw00 * rw00;
    float w10 = sw10 * rw10;
    float w01 = sw01 * rw01;
    float w11 = sw11 * rw11;
    
    float totalW = w00 + w10 + w01 + w11;
    if (totalW < 1e-4) {
        return c00 * sw00 + c10 * sw10 + c01 * sw01 + c11 * sw11;
    }
    return (c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11) / totalW;
}

// Apply per-channel HSL adjustments preserving angular falloff, near-neutral and shadow noise protection
vec3 applyHSLAdjustments(vec3 hsl, float maxLinearChan) {
    float hue = hsl.x;
    float sat = hsl.y;
    float lum = hsl.z;
    
    // Smooth fade for near-neutral pixels and near-black pixels to prevent noise amplification
    float satFade = smoothstep(0.01, 0.06, sat);
    float blackFade = smoothstep(0.015, 0.08, maxLinearChan);
    float totalFade = satFade * blackFade;
    if (totalFade <= 0.0) return hsl;
    
    float totalHueShift = 0.0;
    float totalSatShift = 0.0;
    float totalLumShift = 0.0;
    float totalWeight = 0.0;
    
    for (int i = 0; i < 8; i++) {
        float weight = getColorWeight(hue, i);
        if (weight > 0.001) {
            totalWeight += weight;
            totalHueShift += u_hslHue[i] * 0.6 * weight;
            totalSatShift += (u_hslSat[i] / 100.0) * weight;
            totalLumShift += (u_hslLum[i] / 100.0) * 0.4 * weight;
        }
    }
    
    if (totalWeight > 0.001) {
        // Normalize only if overlapping bands exceed 1.0 to preserve angular falloff
        float normFactor = max(1.0, totalWeight);
        float avgHueShift = (totalHueShift / normFactor) * totalFade;
        float avgSatShift = (totalSatShift / normFactor) * totalFade;
        float avgLumShift = (totalLumShift / normFactor) * totalFade;
        
        hsl.x = mod(hue + avgHueShift + 360.0, 360.0);
        hsl.y = clamp(sat * max(0.0, 1.0 + avgSatShift), 0.0, 1.0);
        hsl.z = clamp(lum + avgLumShift, 0.0, 1.0);
    }
    
    return hsl;
}


void main() {
    vec4 pixel = texture(u_texture, v_texCoord);
    vec3 srgb = pixel.rgb;
    
    // Convert source to linear space for guide luminance and physical adjustments
    vec3 linear = vec3(sRGBtoLinear(srgb.r), sRGBtoLinear(srgb.g), sRGBtoLinear(srgb.b));
    float guideLuma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    float guideLogLuma = log2(max(guideLuma, 1e-4));

    // Multi-scale base textures sampled via Joint-Bilateral Upsampling (prevents edge halos)
    // u_blurTexture: Large-scale base illumination B (~3.0% long edge)
    // u_clarityTexture: Mid-scale illumination M (~0.86% long edge)
    vec3 baseLinear = linear;
    vec3 midLinear  = linear;
    if (u_hasBase) {
        vec3 blurredPix = jointUpsample(u_blurTexture, v_texCoord, guideLogLuma, 1.0);
        vec3 clarityPix = jointUpsample(u_clarityTexture, v_texCoord, guideLogLuma, 0.6);
        baseLinear = u_isBaseLinear ? blurredPix : vec3(sRGBtoLinear(blurredPix.r), sRGBtoLinear(blurredPix.g), sRGBtoLinear(blurredPix.b));
        midLinear  = u_isBaseLinear ? clarityPix : vec3(sRGBtoLinear(clarityPix.r), sRGBtoLinear(clarityPix.g), sRGBtoLinear(clarityPix.b));
    }
    
    // --- 1. WHITE BALANCE (Precomputed Bradford LMS Adaptation Matrix) ---
    linear = u_wbMatrix * linear;
    baseLinear = u_wbMatrix * baseLinear;
    midLinear = u_wbMatrix * midLinear;

    // --- 2. EXPOSURE (Linear Photometric Gain) ---
    if (u_exposure != 0.0) {
        float gain = pow(2.0, u_exposure);
        linear *= gain;
        baseLinear *= gain;
        midLinear *= gain;
    }

    // --- 3. DEHAZE (Dark Channel Prior on Base Illumination with Global Atmospheric Light) ---
    if (u_dehaze != 0.0) {
        const vec3 A = vec3(0.95, 0.95, 0.98);
        float darkBase = min(baseLinear.r, min(baseLinear.g, baseLinear.b));
        float t = clamp(1.0 - u_dehaze * 0.65 * darkBase, 0.25, 1.5);
        float darkPix = min(linear.r, min(linear.g, linear.b));
        float tPix = clamp(1.0 - u_dehaze * 0.65 * min(darkBase, darkPix), 0.25, 1.5);
        
        linear = (linear - A) / tPix + A;
        baseLinear = (baseLinear - A) / t + A;
        midLinear = (midLinear - A) / t + A;
    }

    // --- 4. EDGE-AWARE MULTI-SCALE LOCAL TONE MAPPING ---
    // True 3-scale frequency separation:
    // Scale 1 (Micro-detail, <= 1.5px normalized): Fine micro-texture
    // Scale 2 (Mid-scale, ~0.86% image): Clarity / local contrast punch
    // Scale 3 (Base illumination, ~3% image): Shadows, Highlights, Whites, Blacks
    float luma = luminance(linear);
    float baseLuma = luminance(baseLinear);
    float midLuma = luminance(midLinear);
    
    if (u_shadows != 0.0 || u_highlights != 0.0 || u_whites != 0.0 || u_blacks != 0.0 || u_clarity != 0.0 || u_structure != 0.0) {
        float L = log2(max(luma, 1e-5));
        float B = log2(max(baseLuma, 1e-5));
        float M = log2(max(midLuma, 1e-5));
        
        // Resolution-normalized micro-texture sampling radius (matches 1.5px on 2048px canonical dimension)
        // Ensures preview and full-res export render identical micro-texture
        vec2 texSize = vec2(textureSize(u_texture, 0));
        float maxDim = max(texSize.x, texSize.y);
        float sampleRadius = max(1.0, 1.5 * (maxDim / 2048.0));
        vec2 invTexSize = sampleRadius / texSize;
        float lod = log2(sampleRadius);
        
        vec3 cUp    = textureLod(u_texture, v_texCoord + vec2(0.0, invTexSize.y), lod).rgb;
        vec3 cDown  = textureLod(u_texture, v_texCoord - vec2(0.0, invTexSize.y), lod).rgb;
        vec3 cLeft  = textureLod(u_texture, v_texCoord - vec2(invTexSize.x, 0.0), lod).rgb;
        vec3 cRight = textureLod(u_texture, v_texCoord + vec2(invTexSize.x, 0.0), lod).rgb;
        
        vec3 fineAvgSrgb = (srgb * 2.0 + cUp + cDown + cLeft + cRight) / 6.0;
        vec3 fineAvgRawLinear = vec3(sRGBtoLinear(fineAvgSrgb.r), sRGBtoLinear(fineAvgSrgb.g), sRGBtoLinear(fineAvgSrgb.b));
        
        // Derive micro-contrast directly from raw untransformed luminance ratio
        // This makes D_fine 100% immune to exposure, WB, and dehaze deltas
        float rawL = log2(max(1e-5, luminance(vec3(sRGBtoLinear(srgb.r), sRGBtoLinear(srgb.g), sRGBtoLinear(srgb.b)))));
        float rawF = log2(max(1e-5, luminance(fineAvgRawLinear)));
        float D_fine = rawL - rawF; // Micro-texture (<= 1.5px normalized)
        
        // In adapted space, F carries identical WB, exposure, and dehaze as L:
        float F = L - D_fine;
        
        // Laplacian 3-scale decomposition:
        // Band 1: Micro-texture (<= 1.5px normalized)
        // Band 2: Mid-scale texture (1.5px to ~35px)
        // Band 3: Macro local contrast (~35px to ~120px)
        float D_mid  = F - M;
        float D_base = M - B;
        
        float B2 = B;
        
        // Shadows: lift/compress base illumination in dark zones (monotonic, min slope > 0.33)
        if (u_shadows != 0.0) {
            float shadowMask = 1.0 - smoothstep(-6.0, -1.8, B);
            float shadowGain = (u_shadows > 0.0 ? u_shadows * 1.5 : u_shadows * 0.7);
            B2 += shadowGain * shadowMask;
        }
        
        // Highlights: compress/boost base illumination in bright zones (monotonic, min slope > 0.33)
        if (u_highlights != 0.0) {
            float highlightMask = smoothstep(-2.5, 0.0, B);
            float highlightGain = (u_highlights < 0.0 ? u_highlights * 0.65 : u_highlights * 0.6);
            B2 += highlightGain * highlightMask;
        }
        
        // Whites: shoulder stretch/compression up to peak white B ~ 0.0 (monotonic, min slope > 0.33)
        if (u_whites != 0.0) {
            float whiteMask = smoothstep(-1.5, 0.1, B);
            float whiteGain = (u_whites < 0.0 ? u_whites * 0.35 : u_whites * 0.4);
            B2 += whiteGain * whiteMask;
        }
        
        // Blacks: base modulation on deep shadows (monotonic, min slope > 0.33)
        if (u_blacks != 0.0) {
            float blackMask = 1.0 - smoothstep(-7.5, -3.2, B);
            B2 += u_blacks * 0.35 * blackMask;
        }
        
        // Structure / Texture: scales micro-detail D_fine (<= 1.5px) with shadow noise damping
        float sFine = 0.6; // ~0.6 EV threshold
        float fineBoost = u_structure * 0.65 * exp(-D_fine * D_fine / (2.0 * sFine * sFine));
        float shadowDamp = smoothstep(-7.0, -3.5, B);
        fineBoost *= shadowDamp;
        
        // Clarity (Lightroom-style): operates primarily on macro local contrast D_base (M - B),
        // with smooth secondary support on mid-scale D_mid (F - M)
        float sBase = 1.2; // ~1.2 EV threshold
        float baseBoost = u_clarity * 0.75 * exp(-D_base * D_base / (2.0 * sBase * sBase));
        float sMid = 0.8;  // ~0.8 EV threshold
        float midBoost = u_clarity * 0.35 * exp(-D_mid * D_mid / (2.0 * sMid * sMid));
        
        // Reconstruct log luminance:
        // When gains are 0: B2 + D_base + D_mid + D_fine = B + (M - B) + (F - M) + (L - F) = L (exact identity)
        float L2 = B2 + D_base * (1.0 + baseBoost) + D_mid * (1.0 + midBoost) + D_fine * (1.0 + fineBoost);
        float outLuma = exp2(L2);
        
        // Scale linear RGB to match new local tone mapped luminance
        linear *= (outLuma / max(1e-5, luma));
    }
    
    // Additive toe lift for blacks (restores Portra-style lifted blacks and anchors deep floor)
    if (u_blacks != 0.0) {
        float blackToe = u_blacks * 0.04;
        float toeWeight = clamp(1.0 - luminance(linear) / 0.18, 0.0, 1.0);
        linear += vec3(blackToe * toeWeight * toeWeight);
    }

    // --- 5. CONTRAST (Lightroom Style: Luminance-Ratio + Per-Channel Filmic Blend) ---
    // Smooth C-infinity Hill sigmoid for positive contrast, exact Hermite quintic for negative.
    if (u_contrast != 0.0) {
        float lumaC = luminance(linear);
        float pLuma = pow(max(1e-5, lumaC), 1.0 / 2.2);
        
        float sLuma = 0.0;
        if (u_contrast >= 0.0) {
            float cExp = exp(u_contrast * 0.85);
            float x = clamp(pLuma, 1e-5, 1.0 - 1e-5);
            float xc = pow(x, cExp);
            float xinc = pow(1.0 - x, cExp);
            sLuma = xc / (xc + xinc);
        } else {
            // Negative contrast: Hermite quintic polynomial passing through (0,0), (0.5, 0.5), (1,1)
            // with slope 1.0 at both endpoints and slope s at midpoint (0.5).
            // Guarantees strict monotonicity everywhere (min slope = s) without endpoint steepening.
            float s = exp(u_contrast * 0.85);
            float t = pLuma - 0.5;
            float t2 = t * t;
            sLuma = clamp(0.5 + t * (s + (1.0 - s) * t2 * (8.0 - 16.0 * t2)), 0.0, 1.0);
        }
        
        float outLuma = pow(clamp(sLuma, 0.0, 1.0), 2.2);
        
        // Ratio contrast: preserves hue stability (additive offset for negative contrast eliminates near-black cliff)
        vec3 ratioContrast = (u_contrast >= 0.0) ? (linear * (outLuma / max(1e-5, lumaC))) : (linear + vec3(outLuma - lumaC));
        
        // Per-channel contrast in gamma space for filmic saturation richness (matches luma path)
        vec3 pChan = pow(max(linear, vec3(1e-5)), vec3(1.0 / 2.2));
        vec3 sChan = vec3(0.0);
        if (u_contrast >= 0.0) {
            float cExp = exp(u_contrast * 0.85);
            vec3 xChan = clamp(pChan, vec3(1e-5), vec3(1.0 - 1e-5));
            vec3 xChanC = pow(xChan, vec3(cExp));
            vec3 xChanInc = pow(vec3(1.0) - xChan, vec3(cExp));
            sChan = xChanC / (xChanC + xChanInc);
        } else {
            float s = exp(u_contrast * 0.85);
            vec3 tc = pChan - vec3(0.5);
            vec3 tc2 = tc * tc;
            sChan = clamp(vec3(0.5) + tc * (vec3(s) + (1.0 - s) * tc2 * (vec3(8.0) - 16.0 * tc2)), vec3(0.0), vec3(1.0));
        }
        vec3 chanContrast = pow(clamp(sChan, vec3(0.0), vec3(1.0)), vec3(2.2));
        
        // 75% ratio-preserving for hue stability, 25% per-channel for filmic color density
        linear = mix(ratioContrast, chanContrast, 0.25);
    }
    
    // --- 6. HSL COLOR MIXER (Per-channel Hue, Saturation, Luminance in Perceptual Space) ---
    // Evaluated post-white-balance, post-exposure, and post-tone-mapping to target true developed scene colors
    if (u_hasHSL) {
        // Extract HDR dynamic headroom if pixel luminance exceeds 1.0
        float maxChan = max(linear.r, max(linear.g, linear.b));
        float hdrScale = max(1.0, maxChan);
        vec3 normLinear = linear / hdrScale;
        
        vec3 gammaRgb = vec3(linearToSRGB(clamp(normLinear.r, 0.0, 1.0)), 
                             linearToSRGB(clamp(normLinear.g, 0.0, 1.0)), 
                             linearToSRGB(clamp(normLinear.b, 0.0, 1.0)));
        vec3 hsl = rgbToHsl(gammaRgb);
        vec3 adjHsl = applyHSLAdjustments(hsl, maxChan);
        
        // If adjustments modified HSL, re-project back to linear and restore HDR scale
        if (adjHsl != hsl) {
            vec3 adjGamma = hslToRgb(adjHsl);
            vec3 adjLinear = vec3(sRGBtoLinear(adjGamma.r), sRGBtoLinear(adjGamma.g), sRGBtoLinear(adjGamma.b));
            linear = adjLinear * hdrScale;
        }
    }
    
    // --- 7. VIBRANCE / SATURATION (Smart Skin Protection in OKLab) ---
    if (u_vibrance != 0.0 || u_saturation != 0.0) {
        vec3 lab = linearRGBtoOKLab(linear);
        float sat = length(lab.yz);
        
        // Vibrance: Smart Saturation
        if (u_vibrance != 0.0) {
            // Hue detection for skin tone protection: centered at ~48 degrees (0.84 rad) in OKLab
            // with wide Gaussian falloff covering 25° to 70° (all human skin demographics)
            float hue = atan(lab.z, lab.y);
            float hueDist = abs(hue - 0.84);
            float skinWeight = exp(-pow(hueDist * 1.8, 2.0));
            
            // Saturation Mask: In-gamut OKLab chroma tops out around 0.28-0.32
            // Smoothly boost low-chroma tones while protecting already-saturated tones
            float curSatMask = 1.0 - smoothstep(0.04, 0.28, sat);
            
            float protection = 0.55 * skinWeight;
            float mask = curSatMask * (1.0 - protection);
            
            // Clamped multiplier: Prevents negative chroma inversion (which flips hue 180 degrees)
            float vibGain = max(0.0, 1.0 + u_vibrance * 1.2 * mask);
            lab.yz *= vibGain;
        }
        
        // Saturation: Global boost (photographic scaling matching Lightroom punch without out-of-gamut clipping)
        if (u_saturation != 0.0) {
            float satGain = (u_saturation >= 0.0) ? (1.0 + u_saturation * 0.75) : max(0.0, 1.0 + u_saturation);
            lab.yz *= satGain;
        }
        
        linear = max(vec3(0.0), OKLabToLinearRGB(lab));
    }
    
    // --- 8. COLOR GRADING (3-Way: Shadows, Midtones, Highlights in OKLab) ---
    if (u_shadowsColor.y > 0.0 || u_midtonesColor.y > 0.0 || u_highlightsColor.y > 0.0 || 
        u_shadowsLum != 0.0 || u_midtonesLum != 0.0 || u_highlightsLum != 0.0) {
        
        float balance = u_colorBalance * 0.01;
        float blending = u_colorBlending * 0.01;
        float shadowsLum = u_shadowsLum * 0.01;
        float midtonesLum = u_midtonesLum * 0.01;
        float highlightsLum = u_highlightsLum * 0.01;
        
        linear = applyColorGrading(
            linear,
            u_shadowsColor,
            u_midtonesColor,
            u_highlightsColor,
            u_shadowsChromaDir,
            u_midtonesChromaDir,
            u_highlightsChromaDir,
            balance,
            blending,
            shadowsLum,
            midtonesLum,
            highlightsLum
        );
    }

    // Gamut Compression: desaturates out-of-gamut colors toward luminance to avoid hue shifts
    linear = gamutCompress(linear);

    // Convert to sRGB for display / LUT stage
    vec3 finalSrgb = vec3(linearToSRGB(clamp(linear.r, 0.0, 1.0)), 
                          linearToSRGB(clamp(linear.g, 0.0, 1.0)), 
                          linearToSRGB(clamp(linear.b, 0.0, 1.0)));
    
    // Apply Tone Curve (with exact half-texel LUT alignment)
    if (u_hasCurveLut) {
        if (u_hasRgbCurve) {
            float rVal = texture(u_curveLutTexRgb, vec2(getCurveCoord(finalSrgb.r), 0.5)).r;
            float gVal = texture(u_curveLutTexRgb, vec2(getCurveCoord(finalSrgb.g), 0.5)).r;
            float bVal = texture(u_curveLutTexRgb, vec2(getCurveCoord(finalSrgb.b), 0.5)).r;
            finalSrgb = vec3(rVal, gVal, bVal);
        }
        
        if (u_hasRedCurve) {
            finalSrgb.r = texture(u_curveLutTexRed, vec2(getCurveCoord(finalSrgb.r), 0.5)).r;
        }
        if (u_hasGreenCurve) {
            finalSrgb.g = texture(u_curveLutTexGreen, vec2(getCurveCoord(finalSrgb.g), 0.5)).r;
        }
        if (u_hasBlueCurve) {
            finalSrgb.b = texture(u_curveLutTexBlue, vec2(getCurveCoord(finalSrgb.b), 0.5)).r;
        }
    }
    
    // Apply 3D LUT Color Grading (in high-precision sRGB space)
    if (u_hasLut3d) {
        vec3 lutCoord = (clamp(finalSrgb, 0.0, 1.0) * (u_lut3dSize - 1.0) + 0.5) / u_lut3dSize;
        vec3 graded = texture(u_lut3dTexture, lutCoord).rgb;
        finalSrgb = mix(finalSrgb, graded, clamp(u_lut3dIntensity, 0.0, 1.0));
    }
    
    // Live Exposure Clipping Warning (Evaluated on undithered signal)
    if (u_showClipping) {
        // Any-channel highlight clip
        if (u_clipHighlights && (finalSrgb.r >= 0.996 || finalSrgb.g >= 0.996 || finalSrgb.b >= 0.996)) {
            fragColor = vec4(1.0, 0.0, 0.0, pixel.a);
            return;
        }
        // Shadow clip (all-channel clipped black floor, avoids false-positives on saturated colors)
        if (u_clipShadows && (finalSrgb.r <= 0.003 && finalSrgb.g <= 0.003 && finalSrgb.b <= 0.003)) {
            fragColor = vec4(0.0, 0.35, 1.0, pixel.a);
            return;
        }
    }
    
    // Screen-space Triangular Probability Density Function (TPDF) Dither
    // Only applied when adjustments are active to ensure unedited images are bit-identical
    if (u_enableDither) {
        float tpdf = (ign(gl_FragCoord.xy) + ign(gl_FragCoord.xy + 5.588238) - 1.0) * (1.0 / 255.0);
        finalSrgb += vec3(tpdf);
    }
    
    fragColor = vec4(clamp(finalSrgb, 0.0, 1.0), pixel.a);
}

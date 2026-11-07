// Color Grading Module
// Professional 3-Way Color Grading in Perceptual OKLab Color Space
// Modulates scene chromaticity and lightness with tone-partitioned weights and deep black pinning.

vec3 applyColorGrading(
    vec3 linearColor,
    vec2 u_shadows,          // x = Hue (0..1), y = Sat (0..1)
    vec2 u_midtones,         // x = Hue (0..1), y = Sat (0..1)
    vec2 u_highlights,       // x = Hue (0..1), y = Sat (0..1)
    vec2 u_shadowsChromaDir, // Precomputed normalized OKLab (a, b) direction
    vec2 u_midtonesChromaDir,
    vec2 u_highlightsChromaDir,
    float u_balance,         // -1.0 to +1.0
    float u_blending,        // 0.0 to 1.0
    float u_shadowsLum,
    float u_midtonesLum,
    float u_highlightsLum
) {
    // 1. Convert Linear RGB to Perceptual OKLab
    vec3 lab = linearRGBtoOKLab(max(linearColor, vec3(0.0)));
    float L = lab.x;
    
    // 2. Calculate Zone Boundaries and Weights
    // Balance [-1, 1] shifts the tonal midpoint
    float mid = clamp(0.5 + u_balance * 0.25, 0.15, 0.85);
    
    // Blending [0, 1] controls transition smoothness / overlap
    float blend = 0.2 + u_blending * 0.3;
    
    // Shadows: Low pass falloff toward mid + blend * 0.5
    float shadowWeight = 1.0 - smoothstep(0.0, mid + blend * 0.5, L);
    
    // Highlights: High pass rise from mid - blend * 0.5 to 1.0
    float highlightWeight = smoothstep(mid - blend * 0.5, 1.0, L);
    
    // Midtones: Gaussian bell curve centered at mid
    float midDist = (L - mid) / max(0.12, blend);
    float midtoneWeight = exp(-midDist * midDist * 2.0);
    
    // Normalize zone weights so they sum to <= 1.0 (prevents over-saturating midtones with 3 tints)
    float totalW = shadowWeight + midtoneWeight + highlightWeight;
    if (totalW > 1.0) {
        shadowWeight /= totalW;
        midtoneWeight /= totalW;
        highlightWeight /= totalW;
    }
    
    // 3. True Photographic Tonal Tapering
    // Deep Black Pinning: Anchors code values 0-25 (L < 0.26 in OKLab) to prevent milky shadow haze
    float shadowTaper = smoothstep(0.04, 0.26, L);
    
    // Specular Highlight Roll-off: Sun reflections and pure specular glints remain uncolored
    float highlightTaper = 1.0 - smoothstep(0.85, 1.0, L) * 0.85;
    
    // 4. Modulate Chromaticity Vector (a, b)
    // Professional color wheel intensity: up to ~0.09 OKLab chroma units at peak (matches Lightroom/Photoshop)
    const float MAX_CHROMA_SCALE = 0.35;
    vec2 deltaChroma = vec2(0.0);
    
    if (u_shadows.y > 0.0) {
        deltaChroma += u_shadowsChromaDir * (u_shadows.y * MAX_CHROMA_SCALE * shadowWeight * shadowTaper);
    }
    if (u_midtones.y > 0.0) {
        deltaChroma += u_midtonesChromaDir * (u_midtones.y * (MAX_CHROMA_SCALE * 0.70) * midtoneWeight);
    }
    if (u_highlights.y > 0.0) {
        deltaChroma += u_highlightsChromaDir * (u_highlights.y * MAX_CHROMA_SCALE * highlightWeight * highlightTaper);
    }
    
    lab.yz += deltaChroma;
    
    // 5. Apply Per-Zone Luminance Adjustments (Modulating Perceptual Lightness L)
    float lumShift = (u_shadowsLum * shadowWeight * shadowTaper +
                      u_midtonesLum * midtoneWeight +
                      u_highlightsLum * highlightWeight * highlightTaper) * 0.25;
    lab.x = clamp(L + lumShift, 0.0, 1.0);
    
    // 6. Reconstruct Linear RGB
    vec3 graded = OKLabToLinearRGB(lab);
    return max(graded, vec3(0.0));
}

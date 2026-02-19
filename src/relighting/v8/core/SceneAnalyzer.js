/**
 * SceneAnalyzer.js - v8 PRO Relighting
 * 
 * Intelligent scene understanding module that analyzes image content
 * to produce a per-pixel scene map for material-aware relighting.
 * 
 * Scene Map RGBA encoding:
 *   R = Material type (0.0=bg, 0.25=skin, 0.5=hair, 0.75=fabric, 1.0=hard/metal)
 *   G = Surface roughness (0.0=smooth → 1.0=rough)
 *   B = Surface curvature (0.0=concave, 0.5=flat, 1.0=convex)
 *   A = Depth layer (0.0=far → 1.0=near)
 */

export class SceneAnalyzer {
    constructor() {
        // Material detection thresholds
        this.skinHueRange = [10, 45];    // degrees in HSL
        this.skinSatRange = [0.15, 0.75];
        this.skinLumRange = [0.2, 0.85];
    }

    /**
     * Analyze the scene and produce a scene map texture
     * @param {ImageData} imageData - Original image
     * @param {Object} depth - { data: Float32Array, width, height }
     * @param {Object} normals - { data: Float32Array, width, height }
     * @returns {Promise<ImageData>} Scene map (RGBA: material, roughness, curvature, depthLayer)
     */
    async analyze(imageData, depth, normals) {
        const { data, width, height } = imageData;
        const sceneMap = new ImageData(width, height);

        // Pre-compute depth statistics for layer segmentation
        const depthStats = this._computeDepthStats(depth);

        // Pre-compute local texture variance (for roughness + material detection)
        const textureVariance = this._computeTextureVariance(data, width, height);

        // Pre-compute curvature from depth second derivatives
        const curvature = this._computeCurvature(depth);

        // Pre-compute normal variance (for material boundary detection)
        const normalVariance = this._computeNormalVariance(normals);

        // Classify each pixel in chunks to avoid blocking the main thread
        // on large images (4K+ = 8+ million pixels to classify)
        const CHUNK_SIZE = 128; // rows per chunk

        for (let startY = 0; startY < height; startY += CHUNK_SIZE) {
            const endY = Math.min(startY + CHUNK_SIZE, height);

            for (let y = startY; y < endY; y++) {
                for (let x = 0; x < width; x++) {
                    const i = y * width + x;
                    const px = i * 4;

                    // Get pixel color
                    const r = data[px] / 255;
                    const g = data[px + 1] / 255;
                    const b = data[px + 2] / 255;

                    // Get depth value
                    const d = depth.data[i];

                    // === Material Classification ===
                    const material = this._classifyMaterial(
                        r, g, b, d,
                        textureVariance[i],
                        normalVariance[i],
                        depthStats
                    );

                    // === Roughness Estimation ===
                    const roughness = this._estimateRoughness(
                        material,
                        textureVariance[i],
                        normalVariance[i]
                    );

                    // === Curvature ===
                    const curv = curvature[i];

                    // === Depth Layer ===
                    const depthLayer = this._computeDepthLayer(d, depthStats);

                    // Write to scene map (RGBA, 0-255)
                    sceneMap.data[px] = Math.round(material * 255);     // R: material
                    sceneMap.data[px + 1] = Math.round(roughness * 255);    // G: roughness
                    sceneMap.data[px + 2] = Math.round(curv * 255);         // B: curvature
                    sceneMap.data[px + 3] = Math.round(depthLayer * 255);   // A: depth layer
                }
            }

            // Yield to the main thread between chunks to prevent "Page Unresponsive"
            if (startY + CHUNK_SIZE < height) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        console.log('🧠 Scene analysis complete');
        return sceneMap;
    }

    /**
     * Compute per-pixel texture variance in a local neighborhood
     * High variance = textured/rough, low variance = smooth/glossy
     */
    _computeTextureVariance(data, width, height) {
        const variance = new Float32Array(width * height);
        const radius = 2;

        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                let sumLum = 0;
                let sumLum2 = 0;
                let count = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const idx = ((y + dy) * width + (x + dx)) * 4;
                        const lum = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
                        sumLum += lum;
                        sumLum2 += lum * lum;
                        count++;
                    }
                }

                const mean = sumLum / count;
                variance[y * width + x] = sumLum2 / count - mean * mean;
            }
        }

        return variance;
    }

    /**
     * Compute surface curvature from depth second derivatives
     * Returns 0.0 = strongly concave, 0.5 = flat, 1.0 = strongly convex
     */
    _computeCurvature(depth) {
        const { data, width, height } = depth;
        const curvature = new Float32Array(width * height);

        // Resolution independence: scale by image diagonal
        // Higher resolution = smaller per-pixel local diffs for same geometric feature
        const diagonal = Math.sqrt(width * width + height * height);
        const scaleFactor = diagonal * 0.15; // Tuned constant

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;

                // Second derivatives
                const d2x = data[i - 1] - 2 * data[i] + data[i + 1];
                const d2y = data[i - width] - 2 * data[i] + data[i + width];

                // Mean curvature
                const meanCurv = (d2x + d2y) * 0.5;

                // Map to 0-1: concave(0) → flat(0.5) → convex(1)
                // Normalize by resolution
                curvature[i] = Math.max(0, Math.min(1, 0.5 + meanCurv * scaleFactor));
            }
        }

        return curvature;
    }

    /**
     * Compute per-pixel normal variance (how much normals change locally)
     * High variance = edges/creases, low variance = smooth surface
     */
    _computeNormalVariance(normals) {
        const { data, width, height } = normals;
        const variance = new Float32Array(width * height);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const ci = i * 3;

                // Center normal
                const cnx = data[ci], cny = data[ci + 1], cnz = data[ci + 2];

                // Compare with 4 neighbors
                let totalDiff = 0;
                const neighbors = [
                    (i - 1) * 3, (i + 1) * 3,
                    (i - width) * 3, (i + width) * 3
                ];

                for (const ni of neighbors) {
                    if (ni >= 0 && ni + 2 < data.length) {
                        const dx = data[ni] - cnx;
                        const dy = data[ni + 1] - cny;
                        const dz = data[ni + 2] - cnz;
                        totalDiff += Math.sqrt(dx * dx + dy * dy + dz * dz);
                    }
                }

                variance[i] = totalDiff / 4;
            }
        }

        return variance;
    }

    /**
     * Compute depth statistics for segmentation
     */
    _computeDepthStats(depth) {
        const { data } = depth;
        let min = Infinity, max = -Infinity;
        let sum = 0;

        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            if (d < min) min = d;
            if (d > max) max = d;
            sum += d;
        }

        const mean = sum / data.length;
        const range = max - min || 1;

        // Compute histogram for layer detection
        const bins = 32;
        const histogram = new Float32Array(bins);
        for (let i = 0; i < data.length; i++) {
            const bin = Math.min(bins - 1, Math.floor(((data[i] - min) / range) * bins));
            histogram[bin]++;
        }

        // Find dominant depth clusters (foreground/midground/background)
        const layers = this._findDepthLayers(histogram, bins, min, range);

        return { min, max, mean, range, layers };
    }

    /**
     * Find natural depth layer boundaries using histogram valleys
     */
    _findDepthLayers(histogram, bins, min, range) {
        // Smooth histogram
        const smoothed = new Float32Array(bins);
        for (let i = 1; i < bins - 1; i++) {
            smoothed[i] = (histogram[i - 1] + histogram[i] * 2 + histogram[i + 1]) / 4;
        }
        smoothed[0] = histogram[0];
        smoothed[bins - 1] = histogram[bins - 1];

        // Find valleys (layer boundaries)
        const valleys = [];
        for (let i = 2; i < bins - 2; i++) {
            if (smoothed[i] < smoothed[i - 1] && smoothed[i] < smoothed[i + 1]) {
                valleys.push(min + (i / bins) * range);
            }
        }

        // Default: 3 equal layers if no clear valleys
        if (valleys.length === 0) {
            return [min + range * 0.33, min + range * 0.66];
        }

        return valleys.slice(0, 3); // Max 3 layer boundaries
    }

    /**
     * Classify pixel material type
     * Returns: 0.0=background, 0.25=skin, 0.5=hair, 0.75=fabric, 1.0=hard/metal
     */
    _classifyMaterial(r, g, b, depth, textureVar, normalVar, depthStats) {
        // Convert to HSL for skin detection
        const { h, s, l } = this._rgbToHsl(r, g, b);

        // Background detection: flat depth in far region
        const normalizedDepth = (depth - depthStats.min) / depthStats.range;
        if (normalizedDepth < 0.1 && textureVar < 0.002 && normalVar < 0.05) {
            return 0.0; // Background
        }

        // Skin detection: warm hue + moderate saturation + smooth normals
        const hDeg = h * 360;
        const isSkinHue = (hDeg >= this.skinHueRange[0] && hDeg <= this.skinHueRange[1]) ||
            (hDeg >= 340);  // Also catches pink/red tones
        const isSkinSat = s >= this.skinSatRange[0] && s <= this.skinSatRange[1];
        const isSkinLum = l >= this.skinLumRange[0] && l <= this.skinLumRange[1];
        const hasSmoothNormals = normalVar < 0.15;

        if (isSkinHue && isSkinSat && isSkinLum && hasSmoothNormals) {
            return 0.25; // Skin
        }

        // Hair detection: dark, high texture, consistent depth
        const isDark = l < 0.35;
        const hasTexture = textureVar > 0.003;
        if (isDark && hasTexture && normalVar > 0.05) {
            return 0.5; // Hair
        }

        // Metal/hard surface detection: high saturation or very smooth with highlights
        const isShiny = textureVar < 0.001 && s < 0.15 && l > 0.6;
        const isMetallic = s > 0.5 && textureVar < 0.002;
        if (isShiny || isMetallic) {
            return 1.0; // Hard/metal
        }

        // Default: fabric/organic
        return 0.75; // Fabric
    }

    /**
     * Estimate surface roughness based on material type and texture
     */
    _estimateRoughness(materialType, textureVar, normalVar) {
        // Base roughness from material type
        let roughness;
        if (materialType <= 0.05) {
            roughness = 0.9; // Background: very rough (matte)
        } else if (materialType <= 0.3) {
            roughness = 0.35; // Skin: slightly glossy
        } else if (materialType <= 0.55) {
            roughness = 0.7; // Hair: rough
        } else if (materialType <= 0.8) {
            roughness = 0.65; // Fabric: moderately rough
        } else {
            roughness = 0.15; // Metal: very smooth
        }

        // Modulate by actual texture variance
        roughness += Math.min(0.2, textureVar * 10);

        return Math.max(0.05, Math.min(0.98, roughness));
    }

    /**
     * Compute depth layer (0 = far, 1 = near)
     */
    _computeDepthLayer(depth, depthStats) {
        // Normalize depth to 0-1 range
        const normalized = (depth - depthStats.min) / depthStats.range;
        return Math.max(0, Math.min(1, normalized));
    }

    /**
     * RGB to HSL conversion
     */
    _rgbToHsl(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;

        if (max === min) {
            return { h: 0, s: 0, l };
        }

        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        let h;
        if (max === r) {
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        } else if (max === g) {
            h = ((b - r) / d + 2) / 6;
        } else {
            h = ((r - g) / d + 4) / 6;
        }

        return { h, s, l };
    }
}

export default SceneAnalyzer;

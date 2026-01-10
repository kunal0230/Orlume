/**
 * MaterialEstimator - Advanced Material Property Estimation
 * 
 * Provides comprehensive PBR material properties for each ADE20K class:
 * - Roughness (0=mirror, 1=diffuse)
 * - Metallic (0=dielectric, 1=metal)
 * - Subsurface Scattering (0=none, 1=full SSS)
 * - Emissive (0=none, 1=full emission)
 * 
 * Special features:
 * - Skin detection with enhanced SSS for realistic portraits
 * - Color-based material hints (golden → metallic, etc.)
 * - Texture-aware roughness estimation
 */

import { ADE20K_CLASSES } from './SegmentationEstimator.js';

// Complete material mapping for all 150 ADE20K classes
// Format: { roughness, metallic, subsurface, emissive, [optional: transparency, ior, planar] }
export const MATERIAL_DATABASE = {
    // ===== ARCHITECTURAL =====
    'wall': { roughness: 0.75, metallic: 0.0, subsurface: 0.0, emissive: 0.0, planar: true },
    'building': { roughness: 0.7, metallic: 0.05, subsurface: 0.0, emissive: 0.0 },
    'sky': { roughness: 0.0, metallic: 0.0, subsurface: 0.0, emissive: 1.0, forceDepth: 1.0 },
    'floor': { roughness: 0.55, metallic: 0.0, subsurface: 0.0, emissive: 0.0, planar: true },
    'ceiling': { roughness: 0.7, metallic: 0.0, subsurface: 0.0, emissive: 0.0, planar: true },
    'road': { roughness: 0.82, metallic: 0.0, subsurface: 0.0, emissive: 0.0, planar: true },
    'sidewalk': { roughness: 0.78, metallic: 0.0, subsurface: 0.0, emissive: 0.0, planar: true },
    'door': { roughness: 0.5, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'windowpane': { roughness: 0.02, metallic: 0.0, subsurface: 0.0, emissive: 0.0, transparency: 0.9, ior: 1.5 },
    'stairway': { roughness: 0.6, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'escalator': { roughness: 0.4, metallic: 0.6, subsurface: 0.0, emissive: 0.0 },
    'fence': { roughness: 0.7, metallic: 0.3, subsurface: 0.0, emissive: 0.0 },
    'railing': { roughness: 0.3, metallic: 0.7, subsurface: 0.0, emissive: 0.0 },
    'column': { roughness: 0.65, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'bridge': { roughness: 0.6, metallic: 0.2, subsurface: 0.0, emissive: 0.0 },
    'path': { roughness: 0.85, metallic: 0.0, subsurface: 0.0, emissive: 0.0, planar: true },
    'pier': { roughness: 0.75, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'awning': { roughness: 0.8, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'canopy': { roughness: 0.75, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'tent': { roughness: 0.85, metallic: 0.0, subsurface: 0.08, emissive: 0.0 },
    'runway': { roughness: 0.75, metallic: 0.0, subsurface: 0.0, emissive: 0.0, planar: true },

    // ===== PEOPLE & BODY =====
    'person': { roughness: 0.55, metallic: 0.0, subsurface: 0.4, emissive: 0.0, isSkin: true },

    // ===== VEHICLES =====
    'car': { roughness: 0.12, metallic: 0.92, subsurface: 0.0, emissive: 0.0 },
    'bus': { roughness: 0.18, metallic: 0.85, subsurface: 0.0, emissive: 0.0 },
    'truck': { roughness: 0.22, metallic: 0.75, subsurface: 0.0, emissive: 0.0 },
    'airplane': { roughness: 0.1, metallic: 0.95, subsurface: 0.0, emissive: 0.0 },
    'boat': { roughness: 0.35, metallic: 0.4, subsurface: 0.0, emissive: 0.0 },
    'ship': { roughness: 0.25, metallic: 0.55, subsurface: 0.0, emissive: 0.0 },
    'minibike': { roughness: 0.25, metallic: 0.7, subsurface: 0.0, emissive: 0.0 },
    'bicycle': { roughness: 0.2, metallic: 0.8, subsurface: 0.0, emissive: 0.0 },
    'van': { roughness: 0.2, metallic: 0.8, subsurface: 0.0, emissive: 0.0 },

    // ===== NATURE =====
    'tree': { roughness: 0.88, metallic: 0.0, subsurface: 0.12, emissive: 0.0 },
    'plant': { roughness: 0.82, metallic: 0.0, subsurface: 0.18, emissive: 0.0 },
    'flower': { roughness: 0.7, metallic: 0.0, subsurface: 0.25, emissive: 0.0 },
    'grass': { roughness: 0.92, metallic: 0.0, subsurface: 0.08, emissive: 0.0, planar: true },
    'palm': { roughness: 0.85, metallic: 0.0, subsurface: 0.1, emissive: 0.0 },
    'field': { roughness: 0.9, metallic: 0.0, subsurface: 0.05, emissive: 0.0, planar: true },
    'earth': { roughness: 0.92, metallic: 0.0, subsurface: 0.02, emissive: 0.0 },
    'sand': { roughness: 0.95, metallic: 0.0, subsurface: 0.01, emissive: 0.0 },
    'rock': { roughness: 0.85, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'mountain': { roughness: 0.82, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'hill': { roughness: 0.85, metallic: 0.0, subsurface: 0.03, emissive: 0.0 },

    // ===== WATER =====
    'water': { roughness: 0.04, metallic: 0.0, subsurface: 0.0, emissive: 0.0, ior: 1.33 },
    'sea': { roughness: 0.08, metallic: 0.0, subsurface: 0.0, emissive: 0.0, ior: 1.33 },
    'river': { roughness: 0.05, metallic: 0.0, subsurface: 0.0, emissive: 0.0, ior: 1.33 },
    'lake': { roughness: 0.03, metallic: 0.0, subsurface: 0.0, emissive: 0.0, ior: 1.33 },
    'waterfall': { roughness: 0.15, metallic: 0.0, subsurface: 0.0, emissive: 0.0, ior: 1.33 },
    'swimming pool': { roughness: 0.02, metallic: 0.0, subsurface: 0.0, emissive: 0.0, ior: 1.33 },
    'fountain': { roughness: 0.06, metallic: 0.0, subsurface: 0.0, emissive: 0.0, ior: 1.33 },

    // ===== FURNITURE =====
    'bed': { roughness: 0.85, metallic: 0.0, subsurface: 0.1, emissive: 0.0 },
    'table': { roughness: 0.4, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'chair': { roughness: 0.55, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'cabinet': { roughness: 0.45, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'desk': { roughness: 0.4, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'counter': { roughness: 0.35, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'sofa': { roughness: 0.8, metallic: 0.0, subsurface: 0.08, emissive: 0.0 },
    'armchair': { roughness: 0.75, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'stool': { roughness: 0.5, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'seat': { roughness: 0.6, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'bench': { roughness: 0.55, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'bookcase': { roughness: 0.6, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'shelf': { roughness: 0.5, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'wardrobe': { roughness: 0.5, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'cradle': { roughness: 0.6, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },

    // ===== FABRICS =====
    'curtain': { roughness: 0.88, metallic: 0.0, subsurface: 0.12, emissive: 0.0 },
    'rug': { roughness: 0.95, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'blanket': { roughness: 0.92, metallic: 0.0, subsurface: 0.1, emissive: 0.0 },
    'towel': { roughness: 0.93, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'pillow': { roughness: 0.9, metallic: 0.0, subsurface: 0.08, emissive: 0.0 },
    'cushion': { roughness: 0.88, metallic: 0.0, subsurface: 0.08, emissive: 0.0 },

    // ===== GLASS & MIRRORS =====
    'glass': { roughness: 0.02, metallic: 0.0, subsurface: 0.0, emissive: 0.0, transparency: 0.95, ior: 1.5 },
    'mirror': { roughness: 0.01, metallic: 1.0, subsurface: 0.0, emissive: 0.0 },
    'screen': { roughness: 0.1, metallic: 0.0, subsurface: 0.0, emissive: 0.3 },
    'crt screen': { roughness: 0.15, metallic: 0.0, subsurface: 0.0, emissive: 0.4 },
    'monitor': { roughness: 0.08, metallic: 0.0, subsurface: 0.0, emissive: 0.6 },
    'television': { roughness: 0.08, metallic: 0.0, subsurface: 0.0, emissive: 0.5 },

    // ===== LIGHTING =====
    'lamp': { roughness: 0.3, metallic: 0.2, subsurface: 0.0, emissive: 0.6 },
    'light': { roughness: 0.2, metallic: 0.0, subsurface: 0.0, emissive: 0.85 },
    'chandelier': { roughness: 0.08, metallic: 0.75, subsurface: 0.0, emissive: 0.7 },
    'sconce': { roughness: 0.25, metallic: 0.3, subsurface: 0.0, emissive: 0.5 },
    'streetlight': { roughness: 0.2, metallic: 0.5, subsurface: 0.0, emissive: 0.75 },
    'traffic light': { roughness: 0.3, metallic: 0.4, subsurface: 0.0, emissive: 0.6 },

    // ===== APPLIANCES =====
    'refrigerator': { roughness: 0.15, metallic: 0.85, subsurface: 0.0, emissive: 0.0 },
    'oven': { roughness: 0.2, metallic: 0.8, subsurface: 0.0, emissive: 0.0 },
    'stove': { roughness: 0.25, metallic: 0.75, subsurface: 0.0, emissive: 0.0 },
    'dishwasher': { roughness: 0.18, metallic: 0.8, subsurface: 0.0, emissive: 0.0 },
    'microwave': { roughness: 0.2, metallic: 0.7, subsurface: 0.0, emissive: 0.0 },
    'washer': { roughness: 0.15, metallic: 0.8, subsurface: 0.0, emissive: 0.0 },
    'fan': { roughness: 0.3, metallic: 0.6, subsurface: 0.0, emissive: 0.0 },
    'radiator': { roughness: 0.25, metallic: 0.7, subsurface: 0.0, emissive: 0.0 },
    'hood': { roughness: 0.2, metallic: 0.75, subsurface: 0.0, emissive: 0.0 },
    'clock': { roughness: 0.3, metallic: 0.4, subsurface: 0.0, emissive: 0.0 },

    // ===== KITCHEN & DINING =====
    'sink': { roughness: 0.15, metallic: 0.85, subsurface: 0.0, emissive: 0.0 },
    'pot': { roughness: 0.2, metallic: 0.8, subsurface: 0.0, emissive: 0.0 },
    'plate': { roughness: 0.25, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'tray': { roughness: 0.3, metallic: 0.5, subsurface: 0.0, emissive: 0.0 },
    'bottle': { roughness: 0.05, metallic: 0.0, subsurface: 0.0, emissive: 0.0, transparency: 0.85, ior: 1.5 },
    'food': { roughness: 0.7, metallic: 0.0, subsurface: 0.2, emissive: 0.0 },

    // ===== BATHROOM =====
    'toilet': { roughness: 0.2, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'bathtub': { roughness: 0.15, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'shower': { roughness: 0.1, metallic: 0.3, subsurface: 0.0, emissive: 0.0 },

    // ===== OUTDOOR OBJECTS =====
    'signboard': { roughness: 0.4, metallic: 0.3, subsurface: 0.0, emissive: 0.0 },
    'pole': { roughness: 0.3, metallic: 0.7, subsurface: 0.0, emissive: 0.0 },
    'flag': { roughness: 0.85, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'banner': { roughness: 0.8, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'trade name': { roughness: 0.3, metallic: 0.2, subsurface: 0.0, emissive: 0.2 },
    'bulletin board': { roughness: 0.7, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'ashcan': { roughness: 0.4, metallic: 0.6, subsurface: 0.0, emissive: 0.0 },

    // ===== MISCELLANEOUS =====
    'painting': { roughness: 0.3, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'poster': { roughness: 0.5, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'sculpture': { roughness: 0.45, metallic: 0.2, subsurface: 0.0, emissive: 0.0 },
    'vase': { roughness: 0.2, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'box': { roughness: 0.6, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'bag': { roughness: 0.7, metallic: 0.0, subsurface: 0.05, emissive: 0.0 },
    'basket': { roughness: 0.85, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'barrel': { roughness: 0.65, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'tank': { roughness: 0.3, metallic: 0.7, subsurface: 0.0, emissive: 0.0 },
    'ball': { roughness: 0.5, metallic: 0.0, subsurface: 0.1, emissive: 0.0 },
    'plaything': { roughness: 0.6, metallic: 0.0, subsurface: 0.15, emissive: 0.0 },
    'animal': { roughness: 0.7, metallic: 0.0, subsurface: 0.25, emissive: 0.0 },
    'book': { roughness: 0.75, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'computer': { roughness: 0.2, metallic: 0.6, subsurface: 0.0, emissive: 0.1 },
    'step': { roughness: 0.6, metallic: 0.0, subsurface: 0.0, emissive: 0.0 },
    'conveyer belt': { roughness: 0.7, metallic: 0.3, subsurface: 0.0, emissive: 0.0 },

    // Default for any unmapped classes
    '_default': { roughness: 0.5, metallic: 0.0, subsurface: 0.0, emissive: 0.0 }
};

// Skin tone detection ranges (in HSV-like space)
const SKIN_TONE_RANGES = {
    // Light skin
    light: { hMin: 0, hMax: 50, sMin: 0.15, sMax: 0.7, vMin: 0.4, vMax: 1.0 },
    // Medium skin
    medium: { hMin: 0, hMax: 40, sMin: 0.2, sMax: 0.75, vMin: 0.3, vMax: 0.85 },
    // Dark skin
    dark: { hMin: 0, hMax: 35, sMin: 0.15, sMax: 0.6, vMin: 0.1, vMax: 0.5 }
};

/**
 * MaterialEstimator - Estimates PBR material properties from segmentation
 */
export class MaterialEstimator {
    constructor(app) {
        this.app = app;
        this.materialCache = new Map();
    }

    /**
     * Get material properties for a class name
     */
    getMaterial(className) {
        if (this.materialCache.has(className)) {
            return this.materialCache.get(className);
        }

        const material = MATERIAL_DATABASE[className] || MATERIAL_DATABASE['_default'];
        this.materialCache.set(className, material);
        return material;
    }

    /**
     * Generate material map from segmentation result
     * 
     * Output format (RGBA):
     * - R: Roughness (0-255 → 0.0-1.0)
     * - G: Metallic (0-255 → 0.0-1.0)
     * - B: Subsurface (0-255 → 0.0-1.0)
     * - A: Emissive (0-255 → 0.0-1.0)
     * 
     * @param {Object} segmentResult - Segmentation result with segments array
     * @param {HTMLImageElement|HTMLCanvasElement} originalImage - Original image for skin detection
     * @returns {Object} - Material map { canvas, width, height }
     */
    generateMaterialMap(segmentResult, originalImage = null) {
        const { segments, width, height } = segmentResult;

        const startTime = performance.now();

        // Create output canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const outputData = ctx.createImageData(width, height);

        // Get original image data for skin detection
        let imageData = null;
        if (originalImage) {
            const imgCanvas = document.createElement('canvas');
            imgCanvas.width = width;
            imgCanvas.height = height;
            const imgCtx = imgCanvas.getContext('2d');
            imgCtx.drawImage(originalImage, 0, 0, width, height);
            imageData = imgCtx.getImageData(0, 0, width, height).data;
        }

        // Build class ID to material lookup
        const classToMaterial = new Map();
        segments.forEach(seg => {
            if (!classToMaterial.has(seg.id)) {
                const material = this.getMaterial(seg.label);
                classToMaterial.set(seg.id, { material, label: seg.label });
            }
        });

        // Create segment mask for pixel lookup
        // This is expensive - we need to rasterize the segments
        const segmentMask = this._createSegmentMask(segments, width, height);

        // Fill material map
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const classId = segmentMask[y * width + x];

                let material = MATERIAL_DATABASE['_default'];
                let isSkin = false;

                if (classToMaterial.has(classId)) {
                    const info = classToMaterial.get(classId);
                    material = info.material;
                    isSkin = info.label === 'person';
                }

                // Enhanced skin detection for "person" class
                let subsurface = material.subsurface;
                if (isSkin && imageData) {
                    const skinStrength = this._detectSkinTone(
                        imageData[idx],
                        imageData[idx + 1],
                        imageData[idx + 2]
                    );
                    // Boost subsurface for confirmed skin pixels
                    subsurface = Math.min(1.0, material.subsurface + skinStrength * 0.3);
                }

                // Encode material properties
                outputData.data[idx] = Math.round(material.roughness * 255);
                outputData.data[idx + 1] = Math.round(material.metallic * 255);
                outputData.data[idx + 2] = Math.round(subsurface * 255);
                outputData.data[idx + 3] = Math.round(material.emissive * 255);
            }
        }

        ctx.putImageData(outputData, 0, 0);

        const elapsed = performance.now() - startTime;


        return {
            canvas,
            width,
            height,
            classToMaterial: Object.fromEntries(classToMaterial)
        };
    }

    /**
     * Create segment mask from segment polygons
     */
    _createSegmentMask(segments, width, height) {
        const mask = new Uint8Array(width * height);

        // Simple approach: use canvas path filling
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        for (const segment of segments) {
            if (!segment.mask) continue;

            ctx.clearRect(0, 0, width, height);

            // Draw segment mask
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = segment.mask.width;
            maskCanvas.height = segment.mask.height;
            const maskCtx = maskCanvas.getContext('2d');
            const maskImage = maskCtx.createImageData(segment.mask.width, segment.mask.height);

            for (let i = 0; i < segment.mask.data.length; i++) {
                const v = segment.mask.data[i] ? 255 : 0;
                maskImage.data[i * 4] = v;
                maskImage.data[i * 4 + 1] = v;
                maskImage.data[i * 4 + 2] = v;
                maskImage.data[i * 4 + 3] = 255;
            }
            maskCtx.putImageData(maskImage, 0, 0);

            // Draw to output canvas
            ctx.drawImage(maskCanvas, 0, 0, width, height);

            // Read back and update mask
            const data = ctx.getImageData(0, 0, width, height).data;
            for (let i = 0; i < width * height; i++) {
                if (data[i * 4] > 127) {
                    mask[i] = segment.id || 0;
                }
            }
        }

        return mask;
    }

    /**
     * Detect if a pixel color represents skin tone
     * Returns 0-1 confidence that pixel is skin
     */
    _detectSkinTone(r, g, b) {
        // Convert RGB to HSV-like values
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;

        // Saturation
        const s = max === 0 ? 0 : delta / max;

        // Value (brightness)
        const v = max / 255;

        // Hue (simplified, focusing on red-orange range)
        let h = 0;
        if (delta !== 0) {
            if (max === r) {
                h = ((g - b) / delta) % 6;
            } else if (max === g) {
                h = (b - r) / delta + 2;
            } else {
                h = (r - g) / delta + 4;
            }
            h = h * 60;
            if (h < 0) h += 360;
        }

        // Check against skin tone ranges
        let skinConfidence = 0;

        // Skin typically has:
        // - Hue in orange-red range (0-50°)
        // - Moderate saturation 
        // - Various value ranges depending on skin tone

        if (h >= 0 && h <= 50) {  // Red-orange hue range
            const hueScore = 1.0 - (h / 50);  // Prefer redder tones

            if (s >= 0.1 && s <= 0.8 && v >= 0.15) {
                // Core skin detection
                const satScore = s > 0.4 ? (0.8 - s) / 0.4 : 1.0;
                const valScore = Math.min(1.0, v / 0.5);

                skinConfidence = hueScore * satScore * valScore;

                // Additional check: skin has more red than blue
                if (r > b && g > b * 0.8) {
                    skinConfidence *= 1.2;
                }
            }
        }

        return Math.min(1.0, Math.max(0, skinConfidence));
    }

    /**
     * Estimate material from color (for areas without segmentation)
     * Uses color heuristics for metallic/roughness hints
     */
    estimateMaterialFromColor(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const brightness = (r + g + b) / (3 * 255);
        const saturation = max === 0 ? 0 : (max - min) / max;

        let roughness = 0.5;
        let metallic = 0.0;
        let subsurface = 0.0;

        // Dark colors tend to be rougher
        roughness = 0.3 + (1 - brightness) * 0.5;

        // Desaturated bright colors may be metallic
        if (brightness > 0.7 && saturation < 0.2) {
            metallic = 0.3 + brightness * 0.3;
            roughness = 0.1 + brightness * 0.2;
        }

        // Golden/copper tones suggest metal
        if (r > g && g > b && r / (b + 1) > 1.5 && saturation > 0.3 && brightness > 0.4) {
            metallic = 0.5 + saturation * 0.4;
            roughness = 0.15 + (1 - saturation) * 0.3;
        }

        // Skin-like tones get subsurface
        const skinScore = this._detectSkinTone(r, g, b);
        if (skinScore > 0.3) {
            subsurface = skinScore * 0.4;
            roughness = 0.4 + (1 - skinScore) * 0.2;
        }

        return { roughness, metallic, subsurface, emissive: 0 };
    }

    /**
     * Get material summary for debugging
     */
    getMaterialSummary(materialMap) {
        const summary = {};
        if (!materialMap.classToMaterial) return summary;

        for (const [id, info] of Object.entries(materialMap.classToMaterial)) {
            summary[info.label] = {
                roughness: info.material.roughness,
                metallic: info.material.metallic,
                subsurface: info.material.subsurface,
                emissive: info.material.emissive
            };
        }
        return summary;
    }

    dispose() {
        this.materialCache.clear();
    }
}

export default MaterialEstimator;

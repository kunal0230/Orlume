/**
 * FusionEngine - Combines multi-modal analysis into enhanced outputs
 * 
 * Fuses depth estimation + semantic segmentation + edge detection to produce:
 * - Refined depth map (segmentation-guided edge sharpening)
 * - Material properties map (from segmentation classes)
 * - Enhanced normal map (multi-scale, edge-aware)
 * 
 * This is the brain of the multi-modal intelligence system.
 */

import { CLASS_MATERIALS, ADE20K_CLASSES } from '../ml/SegmentationEstimator.js';

export class FusionEngine {
    constructor() {
        // Temporary canvases for processing
        this._tempCanvas = null;
        this._tempCtx = null;
    }

    /**
     * Fuse depth map with segmentation data
     * 
     * @param {HTMLCanvasElement} depthMap - Raw depth map
     * @param {Object} segmentationResult - Result from SegmentationEstimator
     * @param {Object} options - Fusion options
     * @returns {Object} - Enhanced outputs
     */
    async fuse(depthMap, segmentationResult, options = {}) {
        const startTime = performance.now();
        console.log('🔀 Starting depth-segmentation fusion...');

        const width = depthMap.width;
        const height = depthMap.height;

        // Step 1: Get depth data
        const depthCtx = depthMap.getContext('2d');
        const depthData = depthCtx.getImageData(0, 0, width, height);
        const depth = new Float32Array(width * height);
        for (let i = 0; i < depth.length; i++) {
            depth[i] = depthData.data[i * 4] / 255.0;
        }

        // Step 2: Build segment mask and material data
        const { segmentMask, materials, depthOverrides } = this._processSegments(
            segmentationResult, width, height
        );

        // Step 3: Apply depth corrections
        const correctedDepth = this._applyDepthCorrections(
            depth, segmentMask, depthOverrides, width, height
        );

        // Step 4: Apply edge-aware smoothing
        const smoothedDepth = this._edgeAwareSmooth(
            correctedDepth, segmentMask, width, height
        );

        // Step 5: Generate enhanced normal map
        const normalMap = this._generateEnhancedNormals(
            smoothedDepth, segmentMask, width, height, options.normalStrength || 3.0
        );

        // Step 6: Create output canvases
        const refinedDepthCanvas = this._depthToCanvas(smoothedDepth, width, height);
        const materialCanvas = this._materialsToCanvas(materials, width, height);

        const elapsed = performance.now() - startTime;
        console.log(`✅ Fusion complete (${elapsed.toFixed(0)}ms)`);

        return {
            refinedDepth: refinedDepthCanvas,
            normalMap: normalMap,
            materialMap: materialCanvas,
            segmentMask: segmentMask,
            elapsed
        };
    }

    /**
     * Process segmentation results into usable arrays
     */
    _processSegments(segmentResult, width, height) {
        const { segments } = segmentResult;

        // Per-pixel data
        const segmentMask = new Int32Array(width * height).fill(-1);
        const materials = new Float32Array(width * height * 4); // RGBA: roughness, metallic, subsurface, emissive
        const depthOverrides = new Float32Array(width * height).fill(-1);

        // Initialize with default material
        const defaultMat = CLASS_MATERIALS['_default'];
        for (let i = 0; i < width * height; i++) {
            materials[i * 4] = defaultMat.roughness;
            materials[i * 4 + 1] = defaultMat.metallic;
            materials[i * 4 + 2] = defaultMat.subsurface;
            materials[i * 4 + 3] = defaultMat.emissive || 0;
        }

        // Process each segment
        for (let segIdx = 0; segIdx < segments.length; segIdx++) {
            const segment = segments[segIdx];
            const label = segment.label;
            const classId = ADE20K_CLASSES.indexOf(label);
            const material = CLASS_MATERIALS[label] || CLASS_MATERIALS['_default'];
            const mask = segment.mask;

            if (mask && classId >= 0) {
                // Get mask bitmap data
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = mask.width;
                maskCanvas.height = mask.height;
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.drawImage(mask, 0, 0);
                const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height).data;

                const scaleX = width / mask.width;
                const scaleY = height / mask.height;

                for (let y = 0; y < mask.height; y++) {
                    for (let x = 0; x < mask.width; x++) {
                        const maskIdx = (y * mask.width + x) * 4;
                        if (maskData[maskIdx] > 127) {
                            const outX = Math.min(Math.floor(x * scaleX), width - 1);
                            const outY = Math.min(Math.floor(y * scaleY), height - 1);
                            const pixelIdx = outY * width + outX;

                            segmentMask[pixelIdx] = classId;

                            materials[pixelIdx * 4] = material.roughness;
                            materials[pixelIdx * 4 + 1] = material.metallic;
                            materials[pixelIdx * 4 + 2] = material.subsurface;
                            materials[pixelIdx * 4 + 3] = material.emissive || 0;

                            if (material.forceDepth !== undefined) {
                                depthOverrides[pixelIdx] = material.forceDepth;
                            }
                        }
                    }
                }
            }
        }

        return { segmentMask, materials, depthOverrides };
    }

    /**
     * Apply depth corrections based on segmentation
     * - Force sky to infinite depth
     * - Enforce planar surfaces (floors, walls)
     */
    _applyDepthCorrections(depth, segmentMask, depthOverrides, width, height) {
        const corrected = new Float32Array(depth);

        for (let i = 0; i < depth.length; i++) {
            // Apply forced depth (e.g., sky = 1.0)
            if (depthOverrides[i] >= 0) {
                corrected[i] = depthOverrides[i];
            }
        }

        // Planar surface enforcement for floors and walls
        const planarClasses = ['floor', 'wall', 'ceiling', 'road', 'sidewalk'];
        for (const className of planarClasses) {
            const classId = ADE20K_CLASSES.indexOf(className);
            if (classId >= 0) {
                this._enforcePlanar(corrected, segmentMask, classId, width, height);
            }
        }

        return corrected;
    }

    /**
     * Enforce planar depth for a segment class
     * Fits a plane to the segment and smooths depth
     */
    _enforcePlanar(depth, segmentMask, classId, width, height) {
        // Collect pixels belonging to this class
        const pixels = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (segmentMask[idx] === classId) {
                    pixels.push({ x, y, depth: depth[idx], idx });
                }
            }
        }

        if (pixels.length < 100) return; // Not enough pixels for plane fitting

        // Simple approach: compute median depth and apply with gradient
        pixels.sort((a, b) => a.depth - b.depth);
        const medianDepth = pixels[Math.floor(pixels.length / 2)].depth;

        // Blend towards median (keeps some variation, removes noise)
        for (const p of pixels) {
            const blend = 0.7; // How much to enforce planarity
            depth[p.idx] = depth[p.idx] * (1 - blend) + medianDepth * blend;
        }
    }

    /**
     * Edge-aware depth smoothing using segmentation boundaries
     */
    _edgeAwareSmooth(depth, segmentMask, width, height) {
        const smoothed = new Float32Array(depth);
        const iterations = 2;

        for (let iter = 0; iter < iterations; iter++) {
            const temp = new Float32Array(smoothed);

            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    const currentClass = segmentMask[idx];

                    // Collect neighbors with same class
                    let sum = 0;
                    let count = 0;

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nIdx = (y + dy) * width + (x + dx);
                            const neighborClass = segmentMask[nIdx];

                            // Only average with same-class neighbors (edge-aware)
                            if (neighborClass === currentClass) {
                                sum += temp[nIdx];
                                count++;
                            }
                        }
                    }

                    if (count > 0) {
                        // Blend: 70% original, 30% smoothed
                        smoothed[idx] = temp[idx] * 0.7 + (sum / count) * 0.3;
                    }
                }
            }
        }

        return smoothed;
    }

    /**
     * Generate enhanced normal map from depth
     * Uses multi-scale approach and segment boundaries for sharp edges
     */
    _generateEnhancedNormals(depth, segmentMask, width, height, strength) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const currentClass = segmentMask[idx];

                // Sample neighbors
                const left = x > 0 ? depth[(y) * width + (x - 1)] : depth[idx];
                const right = x < width - 1 ? depth[(y) * width + (x + 1)] : depth[idx];
                const top = y > 0 ? depth[(y - 1) * width + x] : depth[idx];
                const bottom = y < height - 1 ? depth[(y + 1) * width + x] : depth[idx];

                // Check for segment boundaries - use sharper gradients there
                const leftClass = x > 0 ? segmentMask[(y) * width + (x - 1)] : currentClass;
                const rightClass = x < width - 1 ? segmentMask[(y) * width + (x + 1)] : currentClass;
                const topClass = y > 0 ? segmentMask[(y - 1) * width + x] : currentClass;
                const bottomClass = y < height - 1 ? segmentMask[(y + 1) * width + x] : currentClass;

                // Compute gradients
                let dx = (right - left) * strength;
                let dy = (bottom - top) * strength;

                // Enhance gradients at segment boundaries
                if (leftClass !== currentClass || rightClass !== currentClass) {
                    dx *= 2.0; // Sharper horizontal edge
                }
                if (topClass !== currentClass || bottomClass !== currentClass) {
                    dy *= 2.0; // Sharper vertical edge
                }

                // Normal from gradients
                const len = Math.sqrt(dx * dx + dy * dy + 1);
                const nx = -dx / len;
                const ny = -dy / len;
                const nz = 1 / len;

                // Encode as RGB (0-255)
                const pixelIdx = idx * 4;
                data[pixelIdx] = Math.round((nx * 0.5 + 0.5) * 255);
                data[pixelIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                data[pixelIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                data[pixelIdx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Convert depth array to canvas
     */
    _depthToCanvas(depth, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < depth.length; i++) {
            const value = Math.round(depth[i] * 255);
            const pixelIdx = i * 4;
            data[pixelIdx] = value;
            data[pixelIdx + 1] = value;
            data[pixelIdx + 2] = value;
            data[pixelIdx + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Convert materials array to canvas
     * R = roughness, G = metallic, B = subsurface, A = emissive
     */
    _materialsToCanvas(materials, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            data[i * 4] = Math.round(materials[i * 4] * 255);       // roughness
            data[i * 4 + 1] = Math.round(materials[i * 4 + 1] * 255); // metallic
            data[i * 4 + 2] = Math.round(materials[i * 4 + 2] * 255); // subsurface
            data[i * 4 + 3] = Math.round(materials[i * 4 + 3] * 255); // emissive
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Cleanup resources
     */
    dispose() {
        this._tempCanvas = null;
        this._tempCtx = null;
    }
}

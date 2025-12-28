/**
 * SegmentationEstimator - Semantic Segmentation using SegFormer
 * 
 * Uses SegFormer B0 (ADE20K - 150 classes) via Transformers.js
 * Runs in parallel with depth estimation for multi-modal analysis.
 * 
 * Key classes: person, sky, building, tree, road, car, water, etc.
 */

// ADE20K class labels (150 classes)
export const ADE20K_CLASSES = [
    'wall', 'building', 'sky', 'floor', 'tree', 'ceiling', 'road', 'bed',
    'windowpane', 'grass', 'cabinet', 'sidewalk', 'person', 'earth',
    'door', 'table', 'mountain', 'plant', 'curtain', 'chair', 'car',
    'water', 'painting', 'sofa', 'shelf', 'house', 'sea', 'mirror',
    'rug', 'field', 'armchair', 'seat', 'fence', 'desk', 'rock',
    'wardrobe', 'lamp', 'bathtub', 'railing', 'cushion', 'base',
    'box', 'column', 'signboard', 'chest of drawers', 'counter', 'sand',
    'sink', 'skyscraper', 'fireplace', 'refrigerator', 'grandstand',
    'path', 'stairs', 'runway', 'case', 'pool table', 'pillow', 'screen door',
    'stairway', 'river', 'bridge', 'bookcase', 'blind', 'coffee table',
    'toilet', 'flower', 'book', 'hill', 'bench', 'countertop', 'stove',
    'palm', 'kitchen island', 'computer', 'swivel chair', 'boat', 'bar',
    'arcade machine', 'hovel', 'bus', 'towel', 'light', 'truck', 'tower',
    'chandelier', 'awning', 'streetlight', 'booth', 'television', 'airplane',
    'dirt track', 'apparel', 'pole', 'land', 'bannister', 'escalator',
    'ottoman', 'bottle', 'buffet', 'poster', 'stage', 'van', 'ship',
    'fountain', 'conveyer belt', 'canopy', 'washer', 'plaything', 'swimming pool',
    'stool', 'barrel', 'basket', 'waterfall', 'tent', 'bag', 'minibike',
    'cradle', 'oven', 'ball', 'food', 'step', 'tank', 'trade name',
    'microwave', 'pot', 'animal', 'bicycle', 'lake', 'dishwasher', 'screen',
    'blanket', 'sculpture', 'hood', 'sconce', 'vase', 'traffic light',
    'tray', 'ashcan', 'fan', 'pier', 'crt screen', 'plate', 'monitor',
    'bulletin board', 'shower', 'radiator', 'glass', 'clock', 'flag'
];

// Material properties for each class (roughness, subsurface, metallic, emissive)
export const CLASS_MATERIALS = {
    // Sky - emissive, infinite depth
    'sky': { roughness: 0, subsurface: 0, metallic: 0, emissive: 1.0, forceDepth: 1.0 },

    // People - subsurface scattering
    'person': { roughness: 0.6, subsurface: 0.35, metallic: 0, emissive: 0 },

    // Vehicles - metallic
    'car': { roughness: 0.15, subsurface: 0, metallic: 0.9, emissive: 0 },
    'bus': { roughness: 0.2, subsurface: 0, metallic: 0.8, emissive: 0 },
    'truck': { roughness: 0.25, subsurface: 0, metallic: 0.7, emissive: 0 },
    'airplane': { roughness: 0.15, subsurface: 0, metallic: 0.95, emissive: 0 },
    'boat': { roughness: 0.3, subsurface: 0, metallic: 0.5, emissive: 0 },
    'ship': { roughness: 0.25, subsurface: 0, metallic: 0.6, emissive: 0 },

    // Water - reflective
    'water': { roughness: 0.05, subsurface: 0, metallic: 0, emissive: 0, ior: 1.33 },
    'sea': { roughness: 0.08, subsurface: 0, metallic: 0, emissive: 0, ior: 1.33 },
    'river': { roughness: 0.06, subsurface: 0, metallic: 0, emissive: 0, ior: 1.33 },
    'lake': { roughness: 0.04, subsurface: 0, metallic: 0, emissive: 0, ior: 1.33 },
    'swimming pool': { roughness: 0.02, subsurface: 0, metallic: 0, emissive: 0, ior: 1.33 },

    // Glass/Windows
    'windowpane': { roughness: 0.02, subsurface: 0, metallic: 0, emissive: 0, transparency: 0.9 },
    'glass': { roughness: 0.02, subsurface: 0, metallic: 0, emissive: 0, transparency: 0.95 },
    'mirror': { roughness: 0.01, subsurface: 0, metallic: 1.0, emissive: 0 },

    // Nature - organic
    'tree': { roughness: 0.85, subsurface: 0.1, metallic: 0, emissive: 0 },
    'plant': { roughness: 0.8, subsurface: 0.15, metallic: 0, emissive: 0 },
    'flower': { roughness: 0.7, subsurface: 0.2, metallic: 0, emissive: 0 },
    'grass': { roughness: 0.9, subsurface: 0.05, metallic: 0, emissive: 0 },
    'palm': { roughness: 0.85, subsurface: 0.08, metallic: 0, emissive: 0 },

    // Ground surfaces
    'floor': { roughness: 0.6, subsurface: 0, metallic: 0, emissive: 0, planar: true },
    'road': { roughness: 0.8, subsurface: 0, metallic: 0, emissive: 0, planar: true },
    'sidewalk': { roughness: 0.75, subsurface: 0, metallic: 0, emissive: 0, planar: true },
    'sand': { roughness: 0.95, subsurface: 0.02, metallic: 0, emissive: 0 },
    'earth': { roughness: 0.9, subsurface: 0.03, metallic: 0, emissive: 0 },

    // Walls/Buildings
    'wall': { roughness: 0.75, subsurface: 0, metallic: 0, emissive: 0, planar: true },
    'building': { roughness: 0.7, subsurface: 0, metallic: 0.1, emissive: 0 },
    'ceiling': { roughness: 0.7, subsurface: 0, metallic: 0, emissive: 0, planar: true },

    // Fabrics
    'curtain': { roughness: 0.85, subsurface: 0.1, metallic: 0, emissive: 0 },
    'rug': { roughness: 0.95, subsurface: 0.05, metallic: 0, emissive: 0 },
    'blanket': { roughness: 0.9, subsurface: 0.08, metallic: 0, emissive: 0 },
    'towel': { roughness: 0.92, subsurface: 0.05, metallic: 0, emissive: 0 },

    // Lights (emissive)
    'lamp': { roughness: 0.3, subsurface: 0, metallic: 0.2, emissive: 0.5 },
    'light': { roughness: 0.2, subsurface: 0, metallic: 0, emissive: 0.8 },
    'chandelier': { roughness: 0.1, subsurface: 0, metallic: 0.7, emissive: 0.6 },
    'streetlight': { roughness: 0.2, subsurface: 0, metallic: 0.5, emissive: 0.7 },

    // Rock/Stone
    'rock': { roughness: 0.85, subsurface: 0, metallic: 0, emissive: 0 },
    'mountain': { roughness: 0.8, subsurface: 0, metallic: 0, emissive: 0 },

    // Default for unlisted classes
    '_default': { roughness: 0.5, subsurface: 0, metallic: 0, emissive: 0 }
};

export class SegmentationEstimator {
    constructor(app) {
        this.app = app;
        this.model = null;
        this.isLoading = false;
    }

    /**
     * Load SegFormer B0 model (ADE20K - 150 classes)
     */
    async loadModel(progressCallback) {
        if (this.model) return this.model;
        if (this.isLoading) return null;

        this.isLoading = true;

        try {
            const { pipeline, env } = await import('@huggingface/transformers');

            env.allowLocalModels = false;
            env.useBrowserCache = true;

            console.log('Loading SegFormer B0 model...');

            // Use WebGPU if available, fallback to WASM
            const devices = ['webgpu', 'wasm'];
            let lastError = null;

            for (const device of devices) {
                try {
                    console.log(`Trying ${device} backend for segmentation...`);

                    if (device === 'webgpu' && !navigator.gpu) {
                        console.log('WebGPU not supported, skipping...');
                        continue;
                    }

                    this.model = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512', {
                        device: device,
                        progress_callback: progressCallback,
                    });

                    this.isLoading = false;
                    console.log(`✅ Segmentation model loaded (${device})`);
                    return this.model;

                } catch (deviceError) {
                    console.warn(`${device} backend failed for segmentation:`, deviceError.message);
                    lastError = deviceError;
                }
            }

            this.isLoading = false;
            throw lastError || new Error('All backends failed for segmentation');

        } catch (error) {
            this.isLoading = false;
            console.error('Segmentation model loading failed:', error);
            throw error;
        }
    }

    /**
     * Run semantic segmentation on image
     * @param {HTMLImageElement|HTMLCanvasElement} image - Input image
     * @returns {Object} - Segmentation result with masks and labels
     */
    async segment(image) {
        const startTime = performance.now();

        try {
            // Load model if needed
            if (!this.model) {
                await this.loadModel((progress) => {
                    if (progress.status === 'progress') {
                        console.log(`Segmentation: ${Math.round(progress.progress)}%`);
                    }
                });
            }

            if (!this.model) {
                throw new Error('Segmentation model not available');
            }

            const originalWidth = image.naturalWidth || image.width;
            const originalHeight = image.naturalHeight || image.height;

            // Resize large images to prevent OOM during post-processing
            // SegFormer works well at 512-1024px, larger causes memory issues
            const MAX_DIM = 1024;
            let targetWidth = originalWidth;
            let targetHeight = originalHeight;

            if (originalWidth > MAX_DIM || originalHeight > MAX_DIM) {
                const scale = MAX_DIM / Math.max(originalWidth, originalHeight);
                targetWidth = Math.round(originalWidth * scale);
                targetHeight = Math.round(originalHeight * scale);
                console.log(`📐 Resizing for segmentation: ${originalWidth}×${originalHeight} → ${targetWidth}×${targetHeight}`);
            }

            // Create resized canvas for segmentation
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
            const imageInput = canvas.toDataURL('image/png');

            // Run segmentation on resized image
            const results = await this.model(imageInput);

            const elapsed = performance.now() - startTime;
            console.log(`✅ Segmentation complete: ${results.length} segments (${elapsed.toFixed(0)}ms)`);

            return {
                segments: results,
                width: originalWidth,  // Return original dimensions for scaling
                height: originalHeight,
                segmentWidth: targetWidth,
                segmentHeight: targetHeight,
                elapsed
            };

        } catch (error) {
            console.error('Segmentation failed:', error);
            throw error;
        }
    }

    /**
     * Convert segmentation results to a class ID map (canvas)
     * Each pixel contains the class ID (0-149)
     */
    segmentsToClassMap(segmentResult) {
        const { segments, width, height } = segmentResult;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Create ImageData to hold class IDs
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        // Initialize with default class (0 = wall)
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 0;     // Class ID in R channel
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 255;
        }

        // Process each segment
        for (const segment of segments) {
            const label = segment.label;
            const classId = ADE20K_CLASSES.indexOf(label);
            const mask = segment.mask;

            if (classId >= 0 && mask) {
                // Get mask data
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = mask.width;
                maskCanvas.height = mask.height;
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.drawImage(mask, 0, 0);
                const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height).data;

                // Scale mask to image size if needed
                const scaleX = width / mask.width;
                const scaleY = height / mask.height;

                for (let y = 0; y < mask.height; y++) {
                    for (let x = 0; x < mask.width; x++) {
                        const maskIdx = (y * mask.width + x) * 4;
                        if (maskData[maskIdx] > 127) { // Mask threshold
                            // Map to output coordinates
                            const outX = Math.floor(x * scaleX);
                            const outY = Math.floor(y * scaleY);
                            const outIdx = (outY * width + outX) * 4;

                            if (outIdx >= 0 && outIdx < data.length) {
                                data[outIdx] = classId; // Store class ID
                            }
                        }
                    }
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Generate material property map from segmentation
     * Returns a canvas where each pixel encodes material properties:
     * R = roughness (0-255 → 0-1)
     * G = metallic (0-255 → 0-1)
     * B = subsurface (0-255 → 0-1)
     * A = emissive (0-255 → 0-1)
     */
    generateMaterialMap(segmentResult) {
        const { segments, width, height } = segmentResult;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        // Initialize with default material
        const defaultMat = CLASS_MATERIALS['_default'];
        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.round(defaultMat.roughness * 255);
            data[i + 1] = Math.round(defaultMat.metallic * 255);
            data[i + 2] = Math.round(defaultMat.subsurface * 255);
            data[i + 3] = Math.round(defaultMat.emissive * 255);
        }

        // Apply material properties per segment
        for (const segment of segments) {
            const label = segment.label;
            const material = CLASS_MATERIALS[label] || CLASS_MATERIALS['_default'];
            const mask = segment.mask;

            if (mask) {
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
                            const outX = Math.floor(x * scaleX);
                            const outY = Math.floor(y * scaleY);
                            const outIdx = (outY * width + outX) * 4;

                            if (outIdx >= 0 && outIdx < data.length) {
                                data[outIdx] = Math.round(material.roughness * 255);
                                data[outIdx + 1] = Math.round(material.metallic * 255);
                                data[outIdx + 2] = Math.round(material.subsurface * 255);
                                data[outIdx + 3] = Math.round((material.emissive || 0) * 255);
                            }
                        }
                    }
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Get special depth handling for segment classes
     * Returns a map of depth overrides (e.g., sky = infinite depth)
     */
    getDepthOverrides(segmentResult) {
        const { segments, width, height } = segmentResult;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        // R channel: depth override (0 = no override, 255 = force far)
        // G channel: planar flag (255 = enforce planar)

        for (const segment of segments) {
            const label = segment.label;
            const material = CLASS_MATERIALS[label] || CLASS_MATERIALS['_default'];
            const mask = segment.mask;

            if (mask) {
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
                            const outX = Math.floor(x * scaleX);
                            const outY = Math.floor(y * scaleY);
                            const outIdx = (outY * width + outX) * 4;

                            if (outIdx >= 0 && outIdx < data.length) {
                                // Force depth for sky
                                if (material.forceDepth !== undefined) {
                                    data[outIdx] = Math.round(material.forceDepth * 255);
                                }
                                // Mark planar surfaces
                                if (material.planar) {
                                    data[outIdx + 1] = 255;
                                }
                            }
                        }
                    }
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Get class name from class ID
     */
    getClassName(classId) {
        return ADE20K_CLASSES[classId] || 'unknown';
    }

    /**
     * Get material properties for a class
     */
    getMaterial(className) {
        return CLASS_MATERIALS[className] || CLASS_MATERIALS['_default'];
    }

    /**
     * Dispose of model resources
     */
    dispose() {
        this.model = null;
    }
}

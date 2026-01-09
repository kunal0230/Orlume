/**
 * FaceMeshEstimator.js - Seamless Face Mesh Integration
 * 
 * v3.4 - FULLY FIXED:
 * - Uses convex hull of landmarks for natural face boundary
 * - Creates soft feathered mask (no rectangular artifacts)
 * - Returns face-only depth to be blended with AI depth
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class FaceMeshEstimator {
    constructor() {
        this.faceLandmarker = null;
        this.isReady = false;
        this.modelPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    }

    async init() {
        try {
            console.log('🔮 Initializing MediaPipe Face Mesh...');

            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );

            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: this.modelPath,
                    delegate: 'GPU'
                },
                runningMode: 'IMAGE',
                numFaces: 1,
                outputFaceBlendshapes: false,
                outputFacialTransformationMatrixes: false,
            });

            this.isReady = true;
            console.log('✅ MediaPipe Face Mesh ready');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Face Mesh:', error);
            return false;
        }
    }

    async detect(image) {
        if (!this.isReady) {
            console.warn('Face Mesh not initialized');
            return null;
        }

        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;

        console.log('🔍 Detecting face mesh...');

        const result = this.faceLandmarker.detect(image);

        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
            console.warn('No face detected');
            return null;
        }

        const landmarks = result.faceLandmarks[0];
        console.log(`  Found ${landmarks.length} landmarks`);

        // Create smooth face depth from landmarks
        const { depthMap, faceMask } = this._createFaceDepthWithMask(landmarks, width, height);

        return {
            landmarks,
            depthMap,
            faceMask,  // Soft mask for blending
            depthImageData: this._depthToImageData(depthMap, width, height),
            width,
            height,
        };
    }

    /**
     * Create face depth and soft mask from landmarks
     * The mask will have soft edges for seamless blending
     */
    _createFaceDepthWithMask(landmarks, width, height) {
        const depthBuffer = new Float32Array(width * height);
        const maskBuffer = new Float32Array(width * height);

        // Find Z range for normalization
        let minZ = Infinity, maxZ = -Infinity;
        for (const lm of landmarks) {
            minZ = Math.min(minZ, lm.z);
            maxZ = Math.max(maxZ, lm.z);
        }
        const zRange = maxZ - minZ || 1;

        // Convert landmarks to screen space
        const points = landmarks.map(lm => ({
            x: lm.x * width,
            y: lm.y * height,
            z: 1.0 - (lm.z - minZ) / zRange  // Closer = higher
        }));

        // Get face outline landmark indices (silhouette)
        const outlineIndices = [
            10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
            397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
            172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
        ];

        const outline = outlineIndices.map(idx => points[idx] || points[0]);

        // For each pixel, calculate face mask (1 inside face, 0 outside, with soft falloff)
        const featherRadius = 15;  // Soft edge width

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                // Check if inside face outline (ray casting)
                const inside = this._pointInPolygon(x, y, outline);

                if (inside) {
                    // Inside face - calculate depth from nearby landmarks
                    let weightSum = 0;
                    let depthSum = 0;

                    for (const p of points) {
                        const dx = x - p.x;
                        const dy = y - p.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const weight = 1 / Math.pow(dist + 1, 2.5);
                        weightSum += weight;
                        depthSum += p.z * weight;
                    }

                    depthBuffer[idx] = depthSum / weightSum;

                    // Calculate soft mask based on distance to edge
                    const distToEdge = this._distanceToPolygon(x, y, outline);
                    if (distToEdge < featherRadius) {
                        maskBuffer[idx] = distToEdge / featherRadius;
                    } else {
                        maskBuffer[idx] = 1.0;
                    }
                } else {
                    // Outside face - check if near edge for soft falloff
                    const distToEdge = this._distanceToPolygon(x, y, outline);
                    if (distToEdge < featherRadius) {
                        // Soft edge - partial mask
                        maskBuffer[idx] = 1.0 - (distToEdge / featherRadius);

                        // Interpolate depth from nearby landmarks
                        let weightSum = 0;
                        let depthSum = 0;
                        for (const p of points) {
                            const dx = x - p.x;
                            const dy = y - p.y;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            const weight = 1 / Math.pow(dist + 1, 2.5);
                            weightSum += weight;
                            depthSum += p.z * weight;
                        }
                        depthBuffer[idx] = depthSum / weightSum;
                    }
                }
            }
        }

        // Smooth the depth map
        this._gaussianBlur(depthBuffer, width, height, 8);
        this._gaussianBlur(maskBuffer, width, height, 5);

        return { depthMap: depthBuffer, faceMask: maskBuffer };
    }

    /**
     * Point in polygon test (ray casting)
     */
    _pointInPolygon(x, y, polygon) {
        let inside = false;
        const n = polygon.length;

        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;

            if (((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    }

    /**
     * Distance from point to polygon edge
     */
    _distanceToPolygon(x, y, polygon) {
        let minDist = Infinity;
        const n = polygon.length;

        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const dist = this._pointToSegmentDist(x, y,
                polygon[i].x, polygon[i].y,
                polygon[j].x, polygon[j].y);
            minDist = Math.min(minDist, dist);
        }

        return minDist;
    }

    /**
     * Distance from point to line segment
     */
    _pointToSegmentDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;

        if (len2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

        let t = ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));

        const nearestX = x1 + t * dx;
        const nearestY = y1 + t * dy;

        return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
    }

    /**
     * Gaussian blur
     */
    _gaussianBlur(buffer, width, height, radius) {
        const sigma = radius / 2;
        const kernelSize = radius * 2 + 1;
        const kernel = new Float32Array(kernelSize);
        let sum = 0;

        for (let i = 0; i < kernelSize; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }

        for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

        const temp = new Float32Array(buffer.length);

        // Horizontal
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = -radius; k <= radius; k++) {
                    const sx = Math.min(width - 1, Math.max(0, x + k));
                    val += buffer[y * width + sx] * kernel[k + radius];
                }
                temp[y * width + x] = val;
            }
        }

        // Vertical
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = -radius; k <= radius; k++) {
                    const sy = Math.min(height - 1, Math.max(0, y + k));
                    val += temp[sy * width + x] * kernel[k + radius];
                }
                buffer[y * width + x] = val;
            }
        }
    }

    _depthToImageData(depth, width, height) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const value = Math.floor(Math.max(0, Math.min(1, depth[i])) * 255);
            data[i * 4] = value;
            data[i * 4 + 1] = value;
            data[i * 4 + 2] = value;
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }

    dispose() {
        if (this.faceLandmarker) {
            this.faceLandmarker.close();
            this.faceLandmarker = null;
        }
        this.isReady = false;
    }
}

export default FaceMeshEstimator;

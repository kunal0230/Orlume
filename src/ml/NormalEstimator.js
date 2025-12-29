/**
 * NormalEstimator - High-Quality Surface Normal Estimation
 * 
 * Generates surface normals from depth maps using advanced gradient techniques.
 * Optimized for producing visible, useful normal maps from ML-generated depth.
 * 
 * Key Features:
 * - Adaptive strength based on actual depth contrast
 * - Scharr kernel for more accurate gradients
 * - Edge enhancement for sharp geometry
 * - Multi-scale with proper weighting
 */

export class NormalEstimator {
    constructor(app) {
        this.app = app;
    }

    /**
     * Generate high-quality normal map from depth map
     * 
     * @param {Object} depthMap - Depth map with canvas, width, height
     * @param {Object} options - Configuration options
     * @returns {HTMLCanvasElement} - Normal map (RGB = XYZ in [0,255])
     */
    generateNormals(depthMap, options = {}) {
        const {
            normalStrength = 'auto',  // 'auto' or number (10-100 typical)
            smoothKernel = 'scharr',  // 'sobel', 'scharr', 'prewitt'
            multiScale = true,
            enhanceEdges = true,
        } = options;

        console.log(`🗺️ Generating high-quality normals...`);
        const startTime = performance.now();

        // Get depth data
        const { canvas: depthCanvas, width, height } = depthMap;
        const ctx = depthCanvas.getContext('2d');
        const depthData = ctx.getImageData(0, 0, width, height);

        // Extract depth values
        const depth = new Float32Array(width * height);
        let minDepth = Infinity, maxDepth = -Infinity;

        for (let i = 0; i < width * height; i++) {
            const d = depthData.data[i * 4] / 255.0;
            depth[i] = d;
            if (d < minDepth) minDepth = d;
            if (d > maxDepth) maxDepth = d;
        }

        const depthRange = maxDepth - minDepth;
        console.log(`   Depth range: ${minDepth.toFixed(3)} - ${maxDepth.toFixed(3)} (range: ${depthRange.toFixed(3)})`);

        // Compute adaptive strength if auto
        // The smaller the depth range, the higher the strength needed
        let strength;
        if (normalStrength === 'auto') {
            // For typical depth maps with 0-1 range, we need high strength
            // Depth differences are often 0.001-0.1, so we need 50-500x amplification
            strength = Math.max(30, Math.min(200, 5.0 / (depthRange + 0.01)));
            console.log(`   Auto strength: ${strength.toFixed(1)}`);
        } else {
            strength = normalStrength;
        }

        // Compute gradients
        let gradX, gradY;

        if (multiScale) {
            // Multi-scale gradient fusion with detail weighting
            const scales = [1, 2, 3];
            const weights = [0.5, 0.35, 0.15]; // More weight to fine detail

            gradX = new Float32Array(width * height);
            gradY = new Float32Array(width * height);

            for (let s = 0; s < scales.length; s++) {
                const { gx, gy } = this._computeGradients(depth, width, height, smoothKernel, scales[s]);
                const w = weights[s];
                for (let i = 0; i < width * height; i++) {
                    gradX[i] += gx[i] * w;
                    gradY[i] += gy[i] * w;
                }
            }
        } else {
            const grads = this._computeGradients(depth, width, height, smoothKernel, 1);
            gradX = grads.gx;
            gradY = grads.gy;
        }

        // Edge enhancement: boost gradients at edges
        if (enhanceEdges) {
            this._enhanceEdgeGradients(gradX, gradY, depth, width, height);
        }

        // Create normal map canvas
        const normalCanvas = document.createElement('canvas');
        normalCanvas.width = width;
        normalCanvas.height = height;
        const normalCtx = normalCanvas.getContext('2d');
        const normalData = normalCtx.createImageData(width, height);

        // Statistics for debugging
        let maxGrad = 0;

        // Convert gradients to normals
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;

                // Scale gradients by strength
                const dzdx = gradX[idx] * strength;
                const dzdy = gradY[idx] * strength;

                const gradMag = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
                if (gradMag > maxGrad) maxGrad = gradMag;

                // Normal = normalize(-dzdx, -dzdy, 1)
                let nx = -dzdx;
                let ny = -dzdy;
                let nz = 1.0;

                // Normalize
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 0) {
                    nx /= len;
                    ny /= len;
                    nz /= len;
                }

                // Map from [-1, 1] to [0, 255]
                // R = X (left/right), G = Y (up/down), B = Z (toward camera)
                normalData.data[pixelIdx] = Math.round((nx * 0.5 + 0.5) * 255);
                normalData.data[pixelIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                normalData.data[pixelIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                normalData.data[pixelIdx + 3] = 255;
            }
        }

        console.log(`   Max gradient magnitude: ${maxGrad.toFixed(3)}`);

        normalCtx.putImageData(normalData, 0, 0);

        const elapsed = performance.now() - startTime;
        console.log(`✅ Normals generated in ${elapsed.toFixed(0)}ms`);

        return normalCanvas;
    }

    /**
     * Compute gradients using specified kernel
     */
    _computeGradients(depth, width, height, kernel, scale = 1) {
        const gx = new Float32Array(width * height);
        const gy = new Float32Array(width * height);

        // Kernel selection - Scharr is most accurate
        let kernelX, kernelY, divisor;

        if (kernel === 'scharr') {
            // Scharr operators - more accurate rotational symmetry
            kernelX = [
                [-3, 0, 3],
                [-10, 0, 10],
                [-3, 0, 3]
            ];
            kernelY = [
                [-3, -10, -3],
                [0, 0, 0],
                [3, 10, 3]
            ];
            divisor = 32; // Normalize kernel
        } else if (kernel === 'sobel') {
            kernelX = [
                [-1, 0, 1],
                [-2, 0, 2],
                [-1, 0, 1]
            ];
            kernelY = [
                [-1, -2, -1],
                [0, 0, 0],
                [1, 2, 1]
            ];
            divisor = 8;
        } else if (kernel === 'prewitt') {
            kernelX = [
                [-1, 0, 1],
                [-1, 0, 1],
                [-1, 0, 1]
            ];
            kernelY = [
                [-1, -1, -1],
                [0, 0, 0],
                [1, 1, 1]
            ];
            divisor = 6;
        } else {
            // Simple central differences
            kernelX = [
                [0, 0, 0],
                [-0.5, 0, 0.5],
                [0, 0, 0]
            ];
            kernelY = [
                [0, -0.5, 0],
                [0, 0, 0],
                [0, 0.5, 0]
            ];
            divisor = 1;
        }

        const step = scale;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                let sumX = 0, sumY = 0;

                // Apply 3x3 kernel with scale
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const sy = Math.min(height - 1, Math.max(0, y + ky * step));
                        const sx = Math.min(width - 1, Math.max(0, x + kx * step));
                        const sampleIdx = sy * width + sx;

                        sumX += depth[sampleIdx] * kernelX[ky + 1][kx + 1];
                        sumY += depth[sampleIdx] * kernelY[ky + 1][kx + 1];
                    }
                }

                // Normalize and scale by step size
                gx[idx] = (sumX / divisor) / step;
                gy[idx] = (sumY / divisor) / step;
            }
        }

        return { gx, gy };
    }

    /**
     * Enhance gradients at depth edges for sharper normals
     */
    _enhanceEdgeGradients(gradX, gradY, depth, width, height) {
        const threshold = 0.02; // Depth discontinuity threshold
        const boost = 2.0;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const centerDepth = depth[idx];

                // Check for depth discontinuity with neighbors
                let isEdge = false;
                for (let dy = -1; dy <= 1 && !isEdge; dy++) {
                    for (let dx = -1; dx <= 1 && !isEdge; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nIdx = (y + dy) * width + (x + dx);
                        if (Math.abs(depth[nIdx] - centerDepth) > threshold) {
                            isEdge = true;
                        }
                    }
                }

                if (isEdge) {
                    gradX[idx] *= boost;
                    gradY[idx] *= boost;
                }
            }
        }
    }

    /**
     * Generate segment-aware normals with sharp edges at object boundaries
     */
    generateSegmentAwareNormals(depthMap, segmentMask, options = {}) {
        const {
            normalStrength = 'auto',
            edgeSharpness = 1.5,
        } = options;

        console.log('🗺️ Generating segment-aware normals...');
        const startTime = performance.now();

        // First generate base normals
        const baseNormals = this.generateNormals(depthMap, {
            normalStrength,
            smoothKernel: 'scharr',
            multiScale: true,
            enhanceEdges: true
        });

        // Apply segment-edge refinement
        const { width, height } = depthMap.canvas;
        const ctx = baseNormals.getContext('2d');
        const normalData = ctx.getImageData(0, 0, width, height);
        const data = normalData.data;

        let edgePixels = 0;

        // Refine normals at segment boundaries
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;
                const currentSegment = segmentMask[idx];

                // Check if at segment boundary
                let isEdge = false;
                for (let dy = -1; dy <= 1 && !isEdge; dy++) {
                    for (let dx = -1; dx <= 1 && !isEdge; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nIdx = (y + dy) * width + (x + dx);
                        if (segmentMask[nIdx] !== currentSegment) {
                            isEdge = true;
                        }
                    }
                }

                if (isEdge) {
                    edgePixels++;

                    // Average normals only from same-segment neighbors
                    let sumNx = 0, sumNy = 0, sumNz = 0, count = 0;

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nIdx = (y + dy) * width + (x + dx);
                            if (segmentMask[nIdx] === currentSegment) {
                                const nPixelIdx = nIdx * 4;
                                const nx = (data[nPixelIdx] / 255.0) * 2 - 1;
                                const ny = (data[nPixelIdx + 1] / 255.0) * 2 - 1;
                                const nz = (data[nPixelIdx + 2] / 255.0) * 2 - 1;
                                sumNx += nx;
                                sumNy += ny;
                                sumNz += nz;
                                count++;
                            }
                        }
                    }

                    if (count > 0) {
                        let nx = sumNx / count;
                        let ny = sumNy / count;
                        let nz = sumNz / count;

                        // Boost the X/Y components at edges for sharper appearance
                        nx *= edgeSharpness;
                        ny *= edgeSharpness;

                        // Re-normalize
                        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                        if (len > 0) {
                            nx /= len;
                            ny /= len;
                            nz /= len;
                        }

                        data[pixelIdx] = Math.round((nx * 0.5 + 0.5) * 255);
                        data[pixelIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                        data[pixelIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                    }
                }
            }
        }

        ctx.putImageData(normalData, 0, 0);

        const elapsed = performance.now() - startTime;
        console.log(`✅ Segment-aware normals: ${edgePixels} edge pixels refined (${elapsed.toFixed(0)}ms)`);

        return baseNormals;
    }

    /**
     * Smooth normals while preserving edges (bilateral filter)
     */
    smoothNormals(normalCanvas, depthMap, sigma = 2) {
        const ctx = normalCanvas.getContext('2d');
        const { width, height } = normalCanvas;
        const normalData = ctx.getImageData(0, 0, width, height);

        const depthCtx = depthMap.canvas.getContext('2d');
        const depthData = depthCtx.getImageData(0, 0, width, height);

        const depth = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            depth[i] = depthData.data[i * 4] / 255.0;
        }

        const output = new Uint8ClampedArray(normalData.data);
        const radius = Math.ceil(sigma * 2);
        const depthSigma = 0.05;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const centerDepth = depth[idx];

                let sumR = 0, sumG = 0, sumB = 0;
                let totalWeight = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const ny = y + dy;
                        const nx = x + dx;

                        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;

                        const nidx = ny * width + nx;
                        const neighborDepth = depth[nidx];

                        const spatialDist = dx * dx + dy * dy;
                        const spatialWeight = Math.exp(-spatialDist / (2 * sigma * sigma));

                        const depthDiff = Math.abs(neighborDepth - centerDepth);
                        const depthWeight = Math.exp(-depthDiff * depthDiff / (2 * depthSigma * depthSigma));

                        const weight = spatialWeight * depthWeight;

                        sumR += normalData.data[nidx * 4] * weight;
                        sumG += normalData.data[nidx * 4 + 1] * weight;
                        sumB += normalData.data[nidx * 4 + 2] * weight;
                        totalWeight += weight;
                    }
                }

                if (totalWeight > 0) {
                    output[idx * 4] = sumR / totalWeight;
                    output[idx * 4 + 1] = sumG / totalWeight;
                    output[idx * 4 + 2] = sumB / totalWeight;
                }
            }
        }

        const outputData = new ImageData(output, width, height);
        ctx.putImageData(outputData, 0, 0);

        return normalCanvas;
    }

    /**
     * Legacy estimate method for compatibility
     */
    async estimate(imageData, depthMap) {
        if (!depthMap) {
            console.warn('NormalEstimator.estimate requires depthMap parameter');
            return null;
        }

        return this.generateNormals(depthMap, {
            normalStrength: 'auto',
            smoothKernel: 'scharr',
            multiScale: true,
            enhanceEdges: true
        });
    }

    isReady() {
        return true;
    }

    dispose() {
        // Nothing to dispose
    }
}

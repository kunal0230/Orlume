/**
 * SurfaceEstimator.js - Advanced Multi-Signal Surface Normal Estimation
 * 
 * Combines multiple signals for high-quality normal maps:
 * 1. Depth-derived normals (overall 3D structure)
 * 2. Luminance gradients (shading-based micro-details)
 * 3. Color channel analysis (texture-based details)
 * 4. Cross-bilateral filtering (edge-preserving smoothing)
 */

export class SurfaceEstimator {
    constructor() {
        this.width = 0;
        this.height = 0;

        // Cached maps
        this.depthMap = null;
        this.normalMap = null;
        this.luminanceMap = null;
    }

    /**
     * Compute surface map from depth + original image using multi-signal fusion
     */
    computeSurfaceMap(depthResult, originalImage, options = {}) {
        const {
            depthWeight = 0.6,         // Weight of depth-derived normals
            luminanceWeight = 0.25,    // Weight of luminance-derived details
            colorWeight = 0.15,        // Weight of color/texture details
            normalStrength = 2.5,      // Overall normal strength
            smoothRadius = 2,          // Bilateral filter radius
            detailScale = 1.5,         // Detail enhancement multiplier
        } = options;

        this.width = depthResult.width;
        this.height = depthResult.height;
        this.depthMap = depthResult.data;


        // Step 1: Extract luminance and prep original image
        this.luminanceMap = this._computeLuminanceMap(originalImage);

        // Step 2: Compute base normals from depth (multi-scale)
        const depthNormals = this._computeMultiScaleDepthNormals(normalStrength);

        // Step 3: Compute luminance-based surface details
        const luminanceNormals = this._computeLuminanceNormals(detailScale);

        // Step 4: Compute color/texture-based details
        const colorNormals = this._computeColorNormals(originalImage, detailScale * 0.5);

        // Step 5: Intelligent fusion of all signals
        const fusedNormals = this._fuseNormals(
            depthNormals, luminanceNormals, colorNormals,
            depthWeight, luminanceWeight, colorWeight
        );

        // Step 6: Cross-bilateral smoothing using original image as guide
        this.normalMap = this._crossBilateralSmooth(fusedNormals, originalImage, smoothRadius);


        return {
            normals: this.normalMap,
            depth: this.depthMap,
            width: this.width,
            height: this.height,
            normalImageData: this._normalsToImageData(this.normalMap),
            depthImageData: this._depthToImageData(this.depthMap),
        };
    }

    /**
     * Compute luminance map from original image
     */
    _computeLuminanceMap(imageData) {
        const { width, height } = this;
        const data = imageData.data;
        const luminance = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            // Perceptual luminance (ITU-R BT.709)
            luminance[i] = (
                data[idx] * 0.2126 +
                data[idx + 1] * 0.7152 +
                data[idx + 2] * 0.0722
            ) / 255.0;
        }

        return luminance;
    }

    /**
     * Multi-scale depth normal computation
     * Uses 3x3, 5x5, and 7x7 kernels for different detail levels
     */
    _computeMultiScaleDepthNormals(strength) {
        const { width, height, depthMap } = this;
        const normals = new Float32Array(width * height * 3);

        const getDepth = (x, y) => {
            x = Math.max(0, Math.min(width - 1, x));
            y = Math.max(0, Math.min(height - 1, y));
            return depthMap[(y * width + x) * 4] / 255.0;
        };

        // Detect discontinuities (silhouette edges)
        const discontinuityMap = this._detectDiscontinuities(getDepth, 0.12);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                const pixIdx = y * width + x;

                // Use flat normal at discontinuities
                if (discontinuityMap[pixIdx] > 0.5) {
                    normals[idx] = 0;
                    normals[idx + 1] = 0;
                    normals[idx + 2] = 1;
                    continue;
                }

                // 3x3 Sobel (fine details)
                let gx3 = (
                    getDepth(x + 1, y - 1) + 2 * getDepth(x + 1, y) + getDepth(x + 1, y + 1)
                ) - (
                        getDepth(x - 1, y - 1) + 2 * getDepth(x - 1, y) + getDepth(x - 1, y + 1)
                    );

                let gy3 = (
                    getDepth(x - 1, y + 1) + 2 * getDepth(x, y + 1) + getDepth(x + 1, y + 1)
                ) - (
                        getDepth(x - 1, y - 1) + 2 * getDepth(x, y - 1) + getDepth(x + 1, y - 1)
                    );

                // 5x5 Sobel (medium details) - weighted average with 3x3
                let gx5 = 0, gy5 = 0;
                for (let ky = -2; ky <= 2; ky++) {
                    for (let kx = -2; kx <= 2; kx++) {
                        const d = getDepth(x + kx, y + ky);
                        const wx = kx * (2.0 - Math.abs(ky) * 0.3);
                        const wy = ky * (2.0 - Math.abs(kx) * 0.3);
                        gx5 += d * wx;
                        gy5 += d * wy;
                    }
                }
                gx5 /= 25;
                gy5 /= 25;

                // Blend scales (fine + medium)
                const gx = gx3 * 0.7 + gx5 * 0.3;
                const gy = gy3 * 0.7 + gy5 * 0.3;

                // Construct normal
                const nx = -gx * strength;
                const ny = -gy * strength;
                const nz = 1.0;

                // Normalize
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                normals[idx] = nx / len;
                normals[idx + 1] = ny / len;
                normals[idx + 2] = nz / len;
            }
        }

        return normals;
    }

    /**
     * Compute surface details from luminance gradients
     * Captures shading information that indicates surface orientation
     */
    _computeLuminanceNormals(strength) {
        const { width, height, luminanceMap } = this;
        const normals = new Float32Array(width * height * 3);

        const getLum = (x, y) => {
            x = Math.max(0, Math.min(width - 1, x));
            y = Math.max(0, Math.min(height - 1, y));
            return luminanceMap[y * width + x];
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                // Scharr operator (more accurate than Sobel for gradients)
                const gx = (
                    3 * getLum(x + 1, y - 1) + 10 * getLum(x + 1, y) + 3 * getLum(x + 1, y + 1)
                ) - (
                        3 * getLum(x - 1, y - 1) + 10 * getLum(x - 1, y) + 3 * getLum(x - 1, y + 1)
                    );

                const gy = (
                    3 * getLum(x - 1, y + 1) + 10 * getLum(x, y + 1) + 3 * getLum(x + 1, y + 1)
                ) - (
                        3 * getLum(x - 1, y - 1) + 10 * getLum(x, y - 1) + 3 * getLum(x + 1, y - 1)
                    );

                // Construct normal from luminance gradient
                // Assumption: brighter = closer/facing light
                const nx = -gx * strength;
                const ny = -gy * strength;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                normals[idx] = nx / len;
                normals[idx + 1] = ny / len;
                normals[idx + 2] = nz / len;
            }
        }

        return normals;
    }

    /**
     * Compute surface details from color channel gradients
     * Different color channels can reveal different surface details
     */
    _computeColorNormals(imageData, strength) {
        const { width, height } = this;
        const data = imageData.data;
        const normals = new Float32Array(width * height * 3);

        const getChannel = (x, y, channel) => {
            x = Math.max(0, Math.min(width - 1, x));
            y = Math.max(0, Math.min(height - 1, y));
            return data[(y * width + x) * 4 + channel] / 255.0;
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                // Compute gradients for each channel
                let gxTotal = 0, gyTotal = 0;

                for (let c = 0; c < 3; c++) {
                    // Channel weight (green has more detail info usually)
                    const channelWeight = c === 1 ? 0.5 : 0.25;

                    const gx = (
                        getChannel(x + 1, y - 1, c) + 2 * getChannel(x + 1, y, c) + getChannel(x + 1, y + 1, c)
                    ) - (
                            getChannel(x - 1, y - 1, c) + 2 * getChannel(x - 1, y, c) + getChannel(x - 1, y + 1, c)
                        );

                    const gy = (
                        getChannel(x - 1, y + 1, c) + 2 * getChannel(x, y + 1, c) + getChannel(x + 1, y + 1, c)
                    ) - (
                            getChannel(x - 1, y - 1, c) + 2 * getChannel(x, y - 1, c) + getChannel(x + 1, y - 1, c)
                        );

                    gxTotal += gx * channelWeight;
                    gyTotal += gy * channelWeight;
                }

                const nx = -gxTotal * strength;
                const ny = -gyTotal * strength;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                normals[idx] = nx / len;
                normals[idx + 1] = ny / len;
                normals[idx + 2] = nz / len;
            }
        }

        return normals;
    }

    /**
     * Intelligently fuse multiple normal maps
     * Uses confidence-weighted blending
     */
    _fuseNormals(depthNormals, lumNormals, colorNormals, wDepth, wLum, wColor) {
        const { width, height } = this;
        const fused = new Float32Array(width * height * 3);

        for (let i = 0; i < width * height; i++) {
            const idx = i * 3;

            // Get normals from each source
            const dn = [depthNormals[idx], depthNormals[idx + 1], depthNormals[idx + 2]];
            const ln = [lumNormals[idx], lumNormals[idx + 1], lumNormals[idx + 2]];
            const cn = [colorNormals[idx], colorNormals[idx + 1], colorNormals[idx + 2]];

            // Compute confidence based on how "non-flat" each normal is
            // Flat normals (0,0,1) have low confidence for details
            const depthConf = Math.sqrt(dn[0] * dn[0] + dn[1] * dn[1]);
            const lumConf = Math.sqrt(ln[0] * ln[0] + ln[1] * ln[1]);
            const colorConf = Math.sqrt(cn[0] * cn[0] + cn[1] * cn[1]);

            // Adaptive weights based on confidence
            let w1 = wDepth * (0.5 + depthConf);
            let w2 = wLum * (0.5 + lumConf * 2);  // Boost luminance contribution
            let w3 = wColor * (0.5 + colorConf);

            const totalW = w1 + w2 + w3;
            w1 /= totalW;
            w2 /= totalW;
            w3 /= totalW;

            // Weighted average (spherical would be better but this is faster)
            let nx = dn[0] * w1 + ln[0] * w2 + cn[0] * w3;
            let ny = dn[1] * w1 + ln[1] * w2 + cn[1] * w3;
            let nz = dn[2] * w1 + ln[2] * w2 + cn[2] * w3;

            // Renormalize
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            fused[idx] = nx / len;
            fused[idx + 1] = ny / len;
            fused[idx + 2] = nz / len;
        }

        return fused;
    }

    /**
     * Cross-bilateral smoothing using original image as guide
     * This preserves edges in the image while smoothing the normal map
     */
    _crossBilateralSmooth(normals, guideImage, radius) {
        const { width, height } = this;
        const smoothed = new Float32Array(normals.length);
        const guideData = guideImage.data;

        const sigmaSpace = radius;
        const sigmaColor = 30; // Color similarity threshold

        // Pre-compute spatial weights
        const spatialWeights = new Map();
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                spatialWeights.set(`${dx},${dy}`, Math.exp(-(dist * dist) / (2 * sigmaSpace * sigmaSpace)));
            }
        }

        const getGuideColor = (x, y) => {
            x = Math.max(0, Math.min(width - 1, x));
            y = Math.max(0, Math.min(height - 1, y));
            const idx = (y * width + x) * 4;
            return [guideData[idx], guideData[idx + 1], guideData[idx + 2]];
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const centerIdx = (y * width + x) * 3;
                const centerColor = getGuideColor(x, y);

                let sumNx = 0, sumNy = 0, sumNz = 0;
                let weightSum = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;

                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                        const neighborIdx = (ny * width + nx) * 3;
                        const neighborColor = getGuideColor(nx, ny);

                        // Color difference in guide image
                        const colorDiff = Math.sqrt(
                            Math.pow(centerColor[0] - neighborColor[0], 2) +
                            Math.pow(centerColor[1] - neighborColor[1], 2) +
                            Math.pow(centerColor[2] - neighborColor[2], 2)
                        );

                        const colorWeight = Math.exp(-(colorDiff * colorDiff) / (2 * sigmaColor * sigmaColor));
                        const spatialWeight = spatialWeights.get(`${dx},${dy}`);
                        const weight = spatialWeight * colorWeight;

                        sumNx += normals[neighborIdx] * weight;
                        sumNy += normals[neighborIdx + 1] * weight;
                        sumNz += normals[neighborIdx + 2] * weight;
                        weightSum += weight;
                    }
                }

                if (weightSum > 0) {
                    let nx = sumNx / weightSum;
                    let ny = sumNy / weightSum;
                    let nz = sumNz / weightSum;

                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                    smoothed[centerIdx] = nx / len;
                    smoothed[centerIdx + 1] = ny / len;
                    smoothed[centerIdx + 2] = nz / len;
                } else {
                    smoothed[centerIdx] = normals[centerIdx];
                    smoothed[centerIdx + 1] = normals[centerIdx + 1];
                    smoothed[centerIdx + 2] = normals[centerIdx + 2];
                }
            }
        }

        return smoothed;
    }

    /**
     * Detect depth discontinuities (silhouette edges)
     */
    _detectDiscontinuities(getDepth, threshold) {
        const { width, height } = this;
        const discontinuityMap = new Float32Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const centerDepth = getDepth(x, y);

                let maxDiff = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const neighborDepth = getDepth(x + dx, y + dy);
                        maxDiff = Math.max(maxDiff, Math.abs(centerDepth - neighborDepth));
                    }
                }

                discontinuityMap[idx] = maxDiff > threshold ? 1.0 : 0.0;
            }
        }

        return discontinuityMap;
    }

    /**
     * Convert normal array to ImageData
     */
    _normalsToImageData(normals) {
        const { width, height } = this;
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const nIdx = i * 3;
            const pIdx = i * 4;

            // Convert from [-1, 1] to [0, 255]
            data[pIdx] = Math.floor((normals[nIdx] * 0.5 + 0.5) * 255);
            data[pIdx + 1] = Math.floor((normals[nIdx + 1] * 0.5 + 0.5) * 255);
            data[pIdx + 2] = Math.floor((normals[nIdx + 2] * 0.5 + 0.5) * 255);
            data[pIdx + 3] = 255;
        }

        return imageData;
    }

    /**
     * Convert depth array to ImageData
     */
    _depthToImageData(depth) {
        const { width, height } = this;
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const dIdx = i * 4;
            const value = depth[dIdx];

            data[dIdx] = value;
            data[dIdx + 1] = value;
            data[dIdx + 2] = value;
            data[dIdx + 3] = 255;
        }

        return imageData;
    }

    getNormalAt(x, y) {
        if (!this.normalMap) return { x: 0, y: 0, z: 1 };
        const { width } = this;
        const idx = (y * width + x) * 3;
        return {
            x: this.normalMap[idx],
            y: this.normalMap[idx + 1],
            z: this.normalMap[idx + 2]
        };
    }

    getDepthAt(x, y) {
        if (!this.depthMap) return 0;
        const { width } = this;
        const idx = (y * width + x) * 4;
        return this.depthMap[idx] / 255.0;
    }
}

export default SurfaceEstimator;

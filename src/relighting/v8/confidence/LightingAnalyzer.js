/**
 * LightingAnalyzer.js - v8 PRO Relighting
 * 
 * Analyzes the lighting complexity of an image to warn about
 * difficult relighting scenarios (multi-source, colored lights, etc.)
 */

export class LightingAnalyzer {
    constructor() {
        // Thresholds
        this.shadowHarshness = 0.3;
        this.colorVarianceThreshold = 0.15;
    }

    /**
     * Analyze lighting complexity from image data
     * @param {ImageData} imageData - Original image
     * @returns {Object} Lighting analysis
     */
    analyze(imageData) {
        const { data, width, height } = imageData;

        // Analyze color distribution
        const colorStats = this._analyzeColorDistribution(data, width, height);

        // Detect multi-source lighting
        const multiSource = this._detectMultiSourceLighting(data, width, height);

        // Detect harsh shadows
        const shadows = this._analyzeShadows(data, width, height);

        // Detect colored lighting
        const coloredLight = this._detectColoredLighting(colorStats);

        // Estimate dominant light direction for intrinsic decomposition
        const dominantLightDir = this._estimateDominantLightDirection(data, width, height);

        // Overall complexity score (0 = simple, 1 = complex)
        const complexity = this._calculateComplexity(multiSource, shadows, coloredLight);

        return {
            complexity,
            multiSource: multiSource.detected,
            coloredLighting: coloredLight.detected,
            harshShadows: shadows.harsh,
            dominantColor: colorStats.dominant,
            lightSources: multiSource.estimated,
            dominantLightDir,
            warnings: this._generateLightingWarnings(complexity, multiSource, shadows, coloredLight)
        };
    }

    /**
     * Analyze color distribution using histogram
     */
    _analyzeColorDistribution(data, width, height) {
        // Build color histogram
        const histogram = {
            r: new Array(256).fill(0),
            g: new Array(256).fill(0),
            b: new Array(256).fill(0)
        };

        let totalR = 0, totalG = 0, totalB = 0;
        const step = 2; // Sample every 2nd pixel
        let samples = 0;

        for (let i = 0; i < data.length; i += 4 * step) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            histogram.r[r]++;
            histogram.g[g]++;
            histogram.b[b]++;

            totalR += r;
            totalG += g;
            totalB += b;
            samples++;
        }

        // Average color
        const avgR = totalR / samples;
        const avgG = totalG / samples;
        const avgB = totalB / samples;

        // Find peaks (potential light sources)
        const peaks = this._findHistogramPeaks(histogram);

        // Calculate color variance
        let varianceR = 0, varianceG = 0, varianceB = 0;
        for (let i = 0; i < data.length; i += 4 * step) {
            varianceR += Math.pow(data[i] - avgR, 2);
            varianceG += Math.pow(data[i + 1] - avgG, 2);
            varianceB += Math.pow(data[i + 2] - avgB, 2);
        }
        varianceR = Math.sqrt(varianceR / samples) / 255;
        varianceG = Math.sqrt(varianceG / samples) / 255;
        varianceB = Math.sqrt(varianceB / samples) / 255;

        // Determine dominant color channel
        let dominant = 'neutral';
        const maxAvg = Math.max(avgR, avgG, avgB);
        const minAvg = Math.min(avgR, avgG, avgB);
        const colorDiff = (maxAvg - minAvg) / 255;

        if (colorDiff > 0.1) {
            if (avgR === maxAvg) dominant = 'warm';
            else if (avgB === maxAvg) dominant = 'cool';
            else dominant = 'green-tinted';
        }

        return {
            average: { r: avgR / 255, g: avgG / 255, b: avgB / 255 },
            variance: { r: varianceR, g: varianceG, b: varianceB },
            peaks,
            dominant
        };
    }

    /**
     * Find peaks in histogram (indicates distinct light sources/surfaces)
     */
    _findHistogramPeaks(histogram) {
        const peaks = [];
        const channels = ['r', 'g', 'b'];

        channels.forEach(ch => {
            const h = histogram[ch];
            const smoothed = this._smoothHistogram(h);

            for (let i = 5; i < 250; i++) {
                if (smoothed[i] > smoothed[i - 1] &&
                    smoothed[i] > smoothed[i + 1] &&
                    smoothed[i] > 100) { // Minimum count
                    peaks.push({ channel: ch, value: i, count: smoothed[i] });
                }
            }
        });

        return peaks.sort((a, b) => b.count - a.count).slice(0, 5);
    }

    /**
     * Smooth histogram with moving average
     */
    _smoothHistogram(h) {
        const smoothed = new Array(256).fill(0);
        const window = 5;

        for (let i = window; i < 256 - window; i++) {
            let sum = 0;
            for (let j = -window; j <= window; j++) {
                sum += h[i + j];
            }
            smoothed[i] = sum / (window * 2 + 1);
        }

        return smoothed;
    }

    /**
     * Detect multi-source lighting
     */
    _detectMultiSourceLighting(data, width, height) {
        // Analyze gradient directions
        let gradientAngles = [];
        const step = 8;

        for (let y = step; y < height - step; y += step) {
            for (let x = step; x < width - step; x += step) {
                const idx = (y * width + x) * 4;

                // Calculate luminance gradient
                const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                const lumR = (data[idx + 4] + data[idx + 5] + data[idx + 6]) / 3;
                const lumB = (data[(y + 1) * width * 4 + x * 4] +
                    data[(y + 1) * width * 4 + x * 4 + 1] +
                    data[(y + 1) * width * 4 + x * 4 + 2]) / 3;

                const gx = lumR - lum;
                const gy = lumB - lum;

                if (Math.abs(gx) > 5 || Math.abs(gy) > 5) {
                    const angle = Math.atan2(gy, gx) * 180 / Math.PI;
                    gradientAngles.push(angle);
                }
            }
        }

        // Cluster gradient angles
        const clusters = this._clusterAngles(gradientAngles);
        const estimatedSources = Math.min(clusters, 4);

        return {
            detected: clusters > 1,
            estimated: estimatedSources,
            confidence: clusters > 2 ? 0.8 : 0.5
        };
    }

    /**
     * Cluster angles to estimate light sources
     */
    _clusterAngles(angles) {
        if (angles.length < 100) return 1;

        // Simple clustering: count peaks in angle histogram
        const histogram = new Array(360).fill(0);

        angles.forEach(a => {
            const bin = Math.floor((a + 180) % 360);
            histogram[bin]++;
        });

        // Smooth and find peaks
        const smoothed = [];
        for (let i = 0; i < 360; i++) {
            let sum = 0;
            for (let j = -10; j <= 10; j++) {
                sum += histogram[(i + j + 360) % 360];
            }
            smoothed[i] = sum / 21;
        }

        // Count significant peaks
        let peaks = 0;
        const threshold = Math.max(...smoothed) * 0.3;

        for (let i = 0; i < 360; i++) {
            if (smoothed[i] > smoothed[(i - 1 + 360) % 360] &&
                smoothed[i] > smoothed[(i + 1) % 360] &&
                smoothed[i] > threshold) {
                peaks++;
                i += 30; // Skip nearby peaks
            }
        }

        return peaks;
    }

    /**
     * Analyze shadow characteristics
     */
    _analyzeShadows(data, width, height) {
        let darkPixels = 0;
        let midPixels = 0;
        let brightPixels = 0;
        let hardTransitions = 0;

        const step = 4;
        let samples = 0;

        for (let y = step; y < height - step; y += step) {
            for (let x = step; x < width - step; x += step) {
                const idx = (y * width + x) * 4;
                const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3 / 255;

                if (lum < 0.2) darkPixels++;
                else if (lum > 0.8) brightPixels++;
                else midPixels++;

                samples++;

                // Check for hard shadow edges
                const neighborIdx = ((y + step) * width + x) * 4;
                if (neighborIdx < data.length) {
                    const neighborLum = (data[neighborIdx] + data[neighborIdx + 1] + data[neighborIdx + 2]) / 3 / 255;
                    if (Math.abs(lum - neighborLum) > 0.4) {
                        hardTransitions++;
                    }
                }
            }
        }

        const darkRatio = darkPixels / samples;
        const brightRatio = brightPixels / samples;
        const transitionRatio = hardTransitions / samples;

        return {
            darkRatio,
            brightRatio,
            transitionRatio,
            harsh: transitionRatio > this.shadowHarshness,
            highContrast: (darkRatio > 0.2 && brightRatio > 0.2)
        };
    }

    /**
     * Detect colored lighting
     */
    _detectColoredLighting(colorStats) {
        const { variance, dominant } = colorStats;

        // High variance in one channel indicates colored lighting
        const maxVariance = Math.max(variance.r, variance.g, variance.b);
        const minVariance = Math.min(variance.r, variance.g, variance.b);
        const varianceDiff = maxVariance - minVariance;

        return {
            detected: varianceDiff > this.colorVarianceThreshold,
            dominantColor: dominant,
            intensity: varianceDiff / this.colorVarianceThreshold
        };
    }

    /**
     * Calculate overall complexity score
     */
    _calculateComplexity(multiSource, shadows, coloredLight) {
        let complexity = 0;

        if (multiSource.detected) complexity += 0.3;
        if (shadows.harsh) complexity += 0.25;
        if (shadows.highContrast) complexity += 0.2;
        if (coloredLight.detected) complexity += 0.25;

        return Math.min(1, complexity);
    }

    /**
     * Generate user-facing warnings
     */
    _generateLightingWarnings(complexity, multiSource, shadows, coloredLight) {
        const warnings = [];

        if (multiSource.detected && multiSource.estimated > 2) {
            warnings.push({
                level: 'warning',
                message: `Multiple light sources detected (${multiSource.estimated})`,
                details: 'Complex lighting may produce less realistic results'
            });
        }

        if (shadows.harsh) {
            warnings.push({
                level: 'info',
                message: 'Hard shadow edges detected',
                details: 'Shadow boundaries may not relight smoothly'
            });
        }

        if (coloredLight.detected) {
            warnings.push({
                level: 'info',
                message: 'Colored lighting detected',
                details: 'Original color cast will be preserved in relit result'
            });
        }

        return warnings;
    }

    /**
     * Estimate the dominant light direction from luminance gradients
     * Uses weighted gradient voting to find the most likely light source direction
     * @returns {{ x: number, y: number }} Normalized 2D light direction
     */
    _estimateDominantLightDirection(data, width, height) {
        let weightedX = 0;
        let weightedY = 0;
        let totalWeight = 0;
        const step = 4;

        for (let y = step; y < height - step; y += step) {
            for (let x = step; x < width - step; x += step) {
                const idx = (y * width + x) * 4;
                const idxR = (y * width + (x + step)) * 4;
                const idxB = ((y + step) * width + x) * 4;

                if (idxR + 2 >= data.length || idxB + 2 >= data.length) continue;

                // Luminance at center, right, below
                const lum = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
                const lumR = (data[idxR] * 0.299 + data[idxR + 1] * 0.587 + data[idxR + 2] * 0.114) / 255;
                const lumB = (data[idxB] * 0.299 + data[idxB + 1] * 0.587 + data[idxB + 2] * 0.114) / 255;

                const gx = lumR - lum;
                const gy = lumB - lum;
                const magnitude = Math.sqrt(gx * gx + gy * gy);

                if (magnitude > 0.02) {
                    const weight = magnitude * magnitude;
                    weightedX += gx * weight;
                    weightedY += gy * weight;
                    totalWeight += weight;
                }
            }
        }

        if (totalWeight > 0) {
            weightedX /= totalWeight;
            weightedY /= totalWeight;
        }

        // Normalize
        const len = Math.sqrt(weightedX * weightedX + weightedY * weightedY);
        if (len > 0.001) {
            weightedX /= len;
            weightedY /= len;
        } else {
            // Default: top-left light
            weightedX = 0.3;
            weightedY = -0.5;
        }

        return { x: weightedX, y: weightedY };
    }
}

export default LightingAnalyzer;

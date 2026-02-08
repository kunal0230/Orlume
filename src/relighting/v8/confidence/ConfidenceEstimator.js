/**
 * ConfidenceEstimator.js - v8 PRO Relighting
 * 
 * 3-tier confidence system that analyzes depth, normals, and materials
 * to provide quality estimates and warnings for problematic images.
 * 
 * Based on relighting_system_final_design.md Section 6.
 */

export class ConfidenceEstimator {
    constructor() {
        // Confidence weights (tunable)
        this.weights = {
            depth: 0.4,
            normal: 0.35,
            material: 0.25
        };

        // Thresholds for warnings
        this.thresholds = {
            low: 0.4,      // Show warning
            medium: 0.6,   // Show caution
            high: 0.8      // Good quality
        };
    }

    /**
     * Estimate confidence from G-Buffer data
     * @param {Object} gBuffer - Contains depth, normals, albedo
     * @returns {Object} Confidence breakdown
     */
    estimate(gBuffer) {
        const { depth, normals, albedo, width, height } = gBuffer;

        // Calculate individual confidence scores
        const depthConfidence = this._estimateDepthConfidence(depth, width, height);
        const normalConfidence = this._estimateNormalConfidence(normals, depth, width, height);
        const materialConfidence = this._estimateMaterialConfidence(albedo, width, height);

        // Weighted combination
        const overall =
            depthConfidence.score * this.weights.depth +
            normalConfidence.score * this.weights.normal +
            materialConfidence.score * this.weights.material;

        // Generate warnings
        const warnings = this._generateWarnings(
            depthConfidence,
            normalConfidence,
            materialConfidence,
            overall
        );

        // Quality tier
        const quality = this._getQualityTier(overall);

        return {
            overall,
            quality, // 'good' | 'fair' | 'poor'
            breakdown: {
                depth: depthConfidence,
                normal: normalConfidence,
                material: materialConfidence
            },
            warnings,
            canProceed: overall > this.thresholds.low
        };
    }

    /**
     * Depth confidence based on gradient magnitude
     * Low gradients = smooth surfaces = high confidence
     * High gradients = edges/noise = lower confidence
     */
    _estimateDepthConfidence(depth, width, height) {
        const { data } = depth;
        let totalGradient = 0;
        let edgePixels = 0;
        let flatRegions = 0;

        // Sample every 4th pixel for performance
        const step = 4;
        const samples = Math.floor((width * height) / (step * step));

        for (let y = step; y < height - step; y += step) {
            for (let x = step; x < width - step; x += step) {
                const idx = y * width + x;

                // Central differences
                const dL = data[(y) * width + (x - 1)] || 0;
                const dR = data[(y) * width + (x + 1)] || 0;
                const dT = data[(y - 1) * width + x] || 0;
                const dB = data[(y + 1) * width + x] || 0;

                const gradX = Math.abs(dR - dL);
                const gradY = Math.abs(dB - dT);
                const gradMag = Math.sqrt(gradX * gradX + gradY * gradY);

                totalGradient += gradMag;

                // Count edge pixels (high gradient)
                if (gradMag > 0.1) edgePixels++;

                // Count flat regions (very low gradient)
                if (gradMag < 0.01) flatRegions++;
            }
        }

        const avgGradient = totalGradient / samples;
        const edgeRatio = edgePixels / samples;
        const flatRatio = flatRegions / samples;

        // Confidence: inverse of gradient (smooth = confident)
        // But penalize extremely flat (textureless) regions
        let score = 1 / (1 + avgGradient * 5);

        // Penalize very flat images (likely bad depth estimation)
        if (flatRatio > 0.7) {
            score *= 0.7;
        }

        // Penalize very noisy images
        if (edgeRatio > 0.5) {
            score *= 0.8;
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            avgGradient,
            edgeRatio,
            flatRatio,
            issues: this._getDepthIssues(score, flatRatio, edgeRatio)
        };
    }

    /**
     * Normal confidence based on consistency
     * Consistent normals = high confidence
     */
    _estimateNormalConfidence(normals, depth, width, height) {
        const { data } = normals;
        let inconsistentCount = 0;
        let validNormals = 0;

        const step = 4;

        for (let y = step; y < height - step; y += step) {
            for (let x = step; x < width - step; x += step) {
                const idx = (y * width + x) * 3;

                const nx = data[idx];
                const ny = data[idx + 1];
                const nz = data[idx + 2];

                // Check if normal is valid (non-zero)
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len < 0.5) {
                    inconsistentCount++;
                    continue;
                }

                validNormals++;

                // Check consistency with neighbors
                const neighborIdx = ((y + 1) * width + x) * 3;
                if (neighborIdx < data.length) {
                    const nnx = data[neighborIdx];
                    const nny = data[neighborIdx + 1];
                    const nnz = data[neighborIdx + 2];

                    const dot = nx * nnx + ny * nny + nz * nnz;
                    if (dot < 0.8) { // Normals differ significantly
                        inconsistentCount++;
                    }
                }
            }
        }

        const total = validNormals + inconsistentCount;
        const consistencyRatio = validNormals / (total || 1);

        return {
            score: consistencyRatio,
            validNormals,
            inconsistentCount,
            issues: consistencyRatio < 0.7 ? ['Noisy surface normals'] : []
        };
    }

    /**
     * Material confidence based on texture variance
     * Uniform regions (like glass) are harder to relight
     */
    _estimateMaterialConfidence(albedo, width, height) {
        const { data } = albedo;

        let totalVariance = 0;
        let brightPixels = 0;
        let darkPixels = 0;
        let saturatedPixels = 0;

        const step = 4;
        const samples = Math.floor((width * height) / (step * step));

        for (let y = step; y < height - step; y += step) {
            for (let x = step; x < width - step; x += step) {
                const idx = (y * width + x) * 4;

                const r = data[idx] / 255;
                const g = data[idx + 1] / 255;
                const b = data[idx + 2] / 255;

                // Calculate luminance
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                // Check for problematic areas
                if (lum > 0.95) brightPixels++;  // Specular highlights
                if (lum < 0.05) darkPixels++;     // Deep shadows

                // Check saturation (low saturation = potentially reflective)
                const maxC = Math.max(r, g, b);
                const minC = Math.min(r, g, b);
                const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

                if (sat < 0.1 && lum > 0.7) saturatedPixels++; // Low saturation, bright = potentially glass/chrome

                // Local variance
                const neighborIdx = ((y + 1) * width + x) * 4;
                if (neighborIdx < data.length) {
                    const nr = data[neighborIdx] / 255;
                    const ng = data[neighborIdx + 1] / 255;
                    const nb = data[neighborIdx + 2] / 255;

                    const diff = Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb);
                    totalVariance += diff;
                }
            }
        }

        const avgVariance = totalVariance / samples;
        const brightRatio = brightPixels / samples;
        const darkRatio = darkPixels / samples;
        const reflectiveRatio = saturatedPixels / samples;

        // Good variance = textured surface = easier to relight
        let score = Math.min(1, avgVariance * 10 + 0.5);

        // Penalize extreme lighting conditions
        if (brightRatio > 0.3) score *= 0.7;
        if (darkRatio > 0.3) score *= 0.7;
        if (reflectiveRatio > 0.2) score *= 0.6;

        return {
            score: Math.max(0, Math.min(1, score)),
            avgVariance,
            brightRatio,
            darkRatio,
            reflectiveRatio,
            issues: this._getMaterialIssues(brightRatio, darkRatio, reflectiveRatio)
        };
    }

    /**
     * Get depth-related issues
     */
    _getDepthIssues(score, flatRatio, edgeRatio) {
        const issues = [];

        if (flatRatio > 0.7) {
            issues.push('Mostly flat/textureless surfaces');
        }
        if (edgeRatio > 0.5) {
            issues.push('High edge density (noisy depth)');
        }
        if (score < 0.5) {
            issues.push('Unreliable depth estimation');
        }

        return issues;
    }

    /**
     * Get material-related issues
     */
    _getMaterialIssues(brightRatio, darkRatio, reflectiveRatio) {
        const issues = [];

        if (brightRatio > 0.3) {
            issues.push('Overexposed highlights detected');
        }
        if (darkRatio > 0.3) {
            issues.push('Deep shadow regions detected');
        }
        if (reflectiveRatio > 0.2) {
            issues.push('Reflective surfaces detected');
        }

        return issues;
    }

    /**
     * Generate user-facing warnings
     */
    _generateWarnings(depthConf, normalConf, materialConf, overall) {
        const warnings = [];

        // Collect all issues
        const allIssues = [
            ...depthConf.issues,
            ...normalConf.issues,
            ...materialConf.issues
        ];

        // Add overall warning
        if (overall < this.thresholds.low) {
            warnings.push({
                level: 'error',
                message: 'Image may not produce good results',
                details: 'Consider using a different image with clearer subjects'
            });
        } else if (overall < this.thresholds.medium) {
            warnings.push({
                level: 'warning',
                message: 'Relighting quality may be limited',
                details: allIssues.join(', ') || 'Some areas may not relight correctly'
            });
        }

        // Add specific warnings for reflective surfaces
        if (materialConf.reflectiveRatio > 0.2) {
            warnings.push({
                level: 'info',
                message: 'Reflective surfaces detected',
                details: 'Glass, mirrors, and shiny surfaces may not relight realistically'
            });
        }

        return warnings;
    }

    /**
     * Get quality tier string
     */
    _getQualityTier(overall) {
        if (overall >= this.thresholds.high) return 'good';
        if (overall >= this.thresholds.medium) return 'fair';
        return 'poor';
    }
}

export default ConfidenceEstimator;

/**
 * HeightmapGenerator.js - Unified 3D Surface from Depth + Face Mesh
 * 
 * v3.4 - Seamless blending with NO rectangular artifacts
 * - Uses AI depth as base
 * - Adds face mesh detail using soft mask
 * - No hard edges or boundaries
 */

export class HeightmapGenerator {
    constructor() {
        this.width = 0;
        this.height = 0;
    }

    /**
     * Generate heightmap from Face Mesh + AI Depth fusion
     * Uses the soft faceMask for seamless blending
     */
    generateFromFaceMesh(faceMeshData, aiDepthData, options = {}) {
        const {
            faceMeshInfluence = 0.6,  // How much face mesh affects final depth
            detailBoost = 1.2,        // Enhance face mesh detail
        } = options;

        this.width = faceMeshData.width;
        this.height = faceMeshData.height;

        console.log('🗻 Generating seamless heightmap from Face Mesh...');

        // Extract AI depth as base
        const aiDepth = this._extractDepth(aiDepthData);

        // Get face mesh depth and soft mask
        const meshDepth = faceMeshData.depthMap;
        const faceMask = faceMeshData.faceMask;  // Already soft-feathered

        // Align depth scales
        const { alignedMesh, alignedAI } = this._alignDepthScales(meshDepth, aiDepth, faceMask);

        // Blend using the soft mask
        console.log('   Seamlessly blending depths...');
        const blendedHeight = this._seamlessBlend(alignedMesh, alignedAI, faceMask, faceMeshInfluence, detailBoost);

        // Compute normals
        console.log('   Computing normals...');
        const finalNormals = this._computeNormalsFromHeight(blendedHeight);

        console.log('✅ Seamless heightmap generated');

        return {
            heightmap: blendedHeight,
            normals: finalNormals,
            heightImageData: this._heightToImageData(blendedHeight),
            normalImageData: this._normalsToImageData(finalNormals),
            faceMask: faceMask,
            width: this.width,
            height: this.height,
        };
    }

    /**
     * Legacy generate method (fallback when no face mesh)
     */
    generate(depthData, originalImage, options = {}) {
        const {
            featureScale = 0.3,
            textureFilterSize = 9,
            integrationIterations = 30,
        } = options;

        this.width = originalImage.width;
        this.height = originalImage.height;

        console.log('🗻 Generating unified heightmap (legacy)...');

        const baseDepth = this._extractDepth(depthData);

        console.log('   Step 1/4: Extracting structural features...');
        const structuralNormals = this._computeStructuralNormals(originalImage, textureFilterSize);

        console.log('   Step 2/4: Integrating normals to height...');
        const heightDetail = this._integrateNormalsToHeight(structuralNormals, integrationIterations);

        console.log('   Step 3/4: Fusing depth + features...');
        const unifiedHeight = this._fuseDepthAndDetail(baseDepth, heightDetail, featureScale);

        console.log('   Step 4/4: Computing final normals...');
        const finalNormals = this._computeNormalsFromHeight(unifiedHeight);

        console.log('✅ Unified heightmap generated');

        return {
            heightmap: unifiedHeight,
            normals: finalNormals,
            heightImageData: this._heightToImageData(unifiedHeight),
            normalImageData: this._normalsToImageData(finalNormals),
            width: this.width,
            height: this.height,
        };
    }

    // === FACE MESH BLENDING ===

    _alignDepthScales(meshDepth, aiDepth, faceMask) {
        const { width, height } = this;

        let meshSum = 0, aiSum = 0, count = 0;
        for (let i = 0; i < width * height; i++) {
            if (faceMask[i] > 0.5) {
                meshSum += meshDepth[i];
                aiSum += aiDepth[i];
                count++;
            }
        }

        if (count === 0) {
            return { alignedMesh: meshDepth, alignedAI: aiDepth };
        }

        const meshMean = meshSum / count;
        const aiMean = aiSum / count;
        const offset = aiMean - meshMean;

        const alignedMesh = new Float32Array(meshDepth.length);
        for (let i = 0; i < meshDepth.length; i++) {
            alignedMesh[i] = meshDepth[i] + offset;
        }

        return { alignedMesh, alignedAI: aiDepth };
    }

    _seamlessBlend(meshDepth, aiDepth, faceMask, influence, detailBoost) {
        const { width, height } = this;
        const blended = new Float32Array(width * height);

        for (let i = 0; i < blended.length; i++) {
            const mask = faceMask[i];

            if (mask > 0.001) {
                const detail = (meshDepth[i] - 0.5) * detailBoost;
                blended[i] = aiDepth[i] + detail * mask * influence;
            } else {
                blended[i] = aiDepth[i];
            }
        }

        // Normalize
        let minD = Infinity, maxD = -Infinity;
        for (let i = 0; i < blended.length; i++) {
            minD = Math.min(minD, blended[i]);
            maxD = Math.max(maxD, blended[i]);
        }
        const range = maxD - minD || 1;
        for (let i = 0; i < blended.length; i++) {
            blended[i] = (blended[i] - minD) / range;
        }

        return blended;
    }

    // === DEPTH EXTRACTION ===

    _extractDepth(depthData) {
        const { width, height } = this;
        const depth = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            depth[i] = depthData[i * 4] / 255.0;
        }

        return depth;
    }

    // === STRUCTURAL NORMALS ===

    _computeStructuralNormals(imageData, filterSize) {
        const { width, height } = this;
        const data = imageData.data;

        // Convert to grayscale
        const gray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
        }

        // Blur to remove texture
        this._boxBlur(gray, width, height, filterSize);

        // Compute normals from gradients
        const normals = new Float32Array(width * height * 3);
        const strength = 2.0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                const getG = (px, py) => {
                    px = Math.max(0, Math.min(width - 1, px));
                    py = Math.max(0, Math.min(height - 1, py));
                    return gray[py * width + px];
                };

                const gx = (getG(x + 1, y) - getG(x - 1, y)) * 0.5;
                const gy = (getG(x, y + 1) - getG(x, y - 1)) * 0.5;

                const nx = -gx * strength;
                const ny = gy * strength;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                normals[idx] = nx / len;
                normals[idx + 1] = ny / len;
                normals[idx + 2] = nz / len;
            }
        }

        return normals;
    }

    _boxBlur(data, width, height, size) {
        const halfSize = Math.floor(size / 2);
        const temp = new Float32Array(data.length);

        // Horizontal
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0, count = 0;
                for (let k = -halfSize; k <= halfSize; k++) {
                    const sx = Math.min(width - 1, Math.max(0, x + k));
                    sum += data[y * width + sx];
                    count++;
                }
                temp[y * width + x] = sum / count;
            }
        }

        // Vertical
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0, count = 0;
                for (let k = -halfSize; k <= halfSize; k++) {
                    const sy = Math.min(height - 1, Math.max(0, y + k));
                    sum += temp[sy * width + x];
                    count++;
                }
                data[y * width + x] = sum / count;
            }
        }
    }

    // === HEIGHT INTEGRATION ===

    _integrateNormalsToHeight(normals, iterations) {
        const { width, height } = this;

        const gx = new Float32Array(width * height);
        const gy = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            const nx = normals[i * 3];
            const ny = normals[i * 3 + 1];
            const nz = normals[i * 3 + 2];

            if (nz > 0.01) {
                gx[i] = nx / nz;
                gy[i] = ny / nz;
            }
        }

        const heightMap = new Float32Array(width * height);
        heightMap.fill(0.5);

        for (let iter = 0; iter < iterations; iter++) {
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;

                    const left = heightMap[idx - 1];
                    const right = heightMap[idx + 1];
                    const up = heightMap[idx - width];
                    const down = heightMap[idx + width];

                    const gxVal = gx[idx] * 0.3;
                    const gyVal = gy[idx] * 0.3;

                    heightMap[idx] = 0.25 * (left + right + up + down + gxVal - gxVal + gyVal - gyVal);
                }
            }
        }

        // Normalize
        let minH = Infinity, maxH = -Infinity;
        for (let i = 0; i < heightMap.length; i++) {
            minH = Math.min(minH, heightMap[i]);
            maxH = Math.max(maxH, heightMap[i]);
        }
        const range = maxH - minH || 1;
        for (let i = 0; i < heightMap.length; i++) {
            heightMap[i] = (heightMap[i] - minH) / range;
        }

        return heightMap;
    }

    _fuseDepthAndDetail(baseDepth, heightDetail, featureScale) {
        const { width, height } = this;
        const unified = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            unified[i] = baseDepth[i] + (heightDetail[i] - 0.5) * featureScale;
        }

        // Normalize
        let minH = Infinity, maxH = -Infinity;
        for (let i = 0; i < unified.length; i++) {
            minH = Math.min(minH, unified[i]);
            maxH = Math.max(maxH, unified[i]);
        }

        const range = maxH - minH || 1;
        for (let i = 0; i < unified.length; i++) {
            unified[i] = (unified[i] - minH) / range;
        }

        return unified;
    }

    // === COMPUTE NORMALS FROM HEIGHT ===

    _computeNormalsFromHeight(heightmap) {
        const { width, height } = this;
        const normals = new Float32Array(width * height * 3);
        const strength = 1.5;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                const getH = (px, py) => {
                    px = Math.max(0, Math.min(width - 1, px));
                    py = Math.max(0, Math.min(height - 1, py));
                    return heightmap[py * width + px];
                };

                const gx = (getH(x + 1, y) - getH(x - 1, y)) * 0.5;
                const gy = (getH(x, y + 1) - getH(x, y - 1)) * 0.5;

                const nx = -gx * strength;
                const ny = gy * strength;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                normals[idx] = nx / len;
                normals[idx + 1] = ny / len;
                normals[idx + 2] = nz / len;
            }
        }

        return normals;
    }

    // === CONVERSION ===

    _heightToImageData(heightmap) {
        const { width, height } = this;
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const value = Math.floor(heightmap[i] * 255);
            data[i * 4] = value;
            data[i * 4 + 1] = value;
            data[i * 4 + 2] = value;
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }

    _normalsToImageData(normals) {
        const { width, height } = this;
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const nIdx = i * 3;
            data[i * 4] = Math.floor((normals[nIdx] * 0.5 + 0.5) * 255);
            data[i * 4 + 1] = Math.floor((normals[nIdx + 1] * 0.5 + 0.5) * 255);
            data[i * 4 + 2] = Math.floor((normals[nIdx + 2] * 0.5 + 0.5) * 255);
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }
}

export default HeightmapGenerator;

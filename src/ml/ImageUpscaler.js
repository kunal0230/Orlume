/**
 * ImageUpscaler - AI Image Enhancement & Restoration
 * 
 * Uses self-hosted Python server with:
 * - Real-ESRGAN for general image enhancement
 * - GFPGAN for face restoration
 * 
 * Falls back to local browser AI if server unavailable
 */

export class ImageUpscaler {
    constructor() {
        this.upscaler = null;
        this.isLoading = false;
        this.isProcessing = false;

        // Settings
        this.scaleFactor = 2;
        this.useAI = true;
        this.enhanceFace = false;
        this.sharpenEdges = true;
        this.processingMode = 'both'; // 'enhance', 'upscale', or 'both'
        this.modelType = 'slim'; // 'slim' (fast, local) or 'thick' (ultra quality)
        this.useRemoteServer = false; // By default use fast client-side WebGL
        this.serverUrl = 'http://localhost:8000';
        this.maxDimension = 4096; // Safe default matching hardware MAX_TEXTURE_SIZE
    }

    // Setters
    setScaleFactor(factor) {
        this.scaleFactor = Math.min(4, Math.max(1, factor));
    }

    setMaxDimension(maxDim) {
        if (typeof maxDim === 'number' && maxDim > 0) {
            this.maxDimension = maxDim;
        }
    }

    setUseAI(enabled) {
        this.useAI = enabled;
    }

    setModelType(type) {
        this.modelType = type === 'thick' ? 'thick' : 'slim';
    }

    setUseRemoteServer(enabled) {
        this.useRemoteServer = Boolean(enabled);
    }

    setEnhanceFace(enabled) {
        this.enhanceFace = enabled;
    }

    setSharpenEdges(enabled) {
        this.sharpenEdges = enabled;
    }

    setProcessingMode(mode) {
        this.processingMode = mode; // 'enhance', 'upscale', 'both'
    }

    setServerUrl(url) {
        this.serverUrl = url.replace(/\/$/, ''); // Remove trailing slash
    }

    getOutputDimensions(width, height, maxDimension = this.maxDimension) {
        const max = maxDimension || 4096;

        if (this.processingMode === 'enhance') {
            // Enhance only - same size, clamped to maxDimension if already exceeding
            if (width > max || height > max) {
                const ratio = Math.min(max / width, max / height);
                return {
                    width: Math.round(width * ratio),
                    height: Math.round(height * ratio),
                    clamped: true,
                    originalTargetWidth: width,
                    originalTargetHeight: height
                };
            }
            return { width, height, clamped: false };
        }

        const rawTargetWidth = Math.round(width * this.scaleFactor);
        const rawTargetHeight = Math.round(height * this.scaleFactor);

        if (rawTargetWidth > max || rawTargetHeight > max) {
            const ratio = Math.min(max / rawTargetWidth, max / rawTargetHeight);
            return {
                width: Math.round(rawTargetWidth * ratio),
                height: Math.round(rawTargetHeight * ratio),
                clamped: true,
                originalTargetWidth: rawTargetWidth,
                originalTargetHeight: rawTargetHeight
            };
        }

        return {
            width: rawTargetWidth,
            height: rawTargetHeight,
            clamped: false
        };
    }

    /**
     * Check if server is available
     */
    async checkServerHealth() {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Main processing function
     */
    async upscale(source, progressCallback = () => { }) {
        if (this.isProcessing) {
            throw new Error('Processing already in progress');
        }

        this.isProcessing = true;

        try {
            const srcWidth = source.width || source.naturalWidth;
            const srcHeight = source.height || source.naturalHeight;
            const dims = this.getOutputDimensions(srcWidth, srcHeight, this.maxDimension);
            const outWidth = dims.width;
            const outHeight = dims.height;

            // Direct high-fidelity multi-scale clarity & detail enhancement for "Enhance" mode
            if (this.processingMode === 'enhance') {
                progressCallback(15, 'Enhancing image clarity & micro-detail...');
                return await this._enhanceImage(source, outWidth, outHeight, progressCallback);
            }

            if (this.useAI) {
                // If remote server explicitly enabled, try server first
                if (this.useRemoteServer) {
                    const serverAvailable = await this.checkServerHealth();
                    if (serverAvailable) {
                        return await this._processWithServer(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
                    }
                    progressCallback(5, 'Remote server unavailable, using local WebGL AI...');
                }

                // Default: Fast, private, client-side WebGL Super Resolution
                return await this._processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
            } else {
                return await this._processClassic(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process with local Python server (Real-ESRGAN + GFPGAN)
     */
    async _processWithServer(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback) {
        progressCallback(5, 'Connecting to AI server...');

        // For large images, clamp input to max 2500px before base64 encoding to prevent huge payload
        let sWidth = srcWidth;
        let sHeight = srcHeight;
        if (srcWidth > 2500 || srcHeight > 2500) {
            const r = Math.min(2500 / srcWidth, 2500 / srcHeight);
            sWidth = Math.max(1, Math.floor(srcWidth * r));
            sHeight = Math.max(1, Math.floor(srcHeight * r));
        }

        // Convert source to base64
        const canvas = document.createElement('canvas');
        canvas.width = sWidth;
        canvas.height = sHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, sWidth, sHeight);
        const base64 = canvas.toDataURL('image/jpeg', 0.95);

        progressCallback(15, 'Sending to AI server...');

        try {
            // Determine which endpoint to call
            let endpoint = '/process'; // Default: combined
            if (this.processingMode === 'enhance') {
                endpoint = this.enhanceFace ? '/enhance-face' : '/enhance';
            } else if (this.processingMode === 'upscale') {
                endpoint = '/upscale';
            }

            const response = await fetch(`${this.serverUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image: base64,
                    scale: this.processingMode === 'enhance' ? 1 : this.scaleFactor,
                    enhance_face: this.enhanceFace
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Server error');
            }

            progressCallback(80, 'Receiving enhanced image...');

            const result = await response.json();

            // Convert result to canvas
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = result.image;
            });

            progressCallback(90, 'Finalizing...');

            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = img.width;
            outputCanvas.height = img.height;
            const outputCtx = outputCanvas.getContext('2d');
            outputCtx.drawImage(img, 0, 0);

            // Apply additional sharpening if enabled and image size is within CPU limits
            if (this.sharpenEdges && outputCanvas.width * outputCanvas.height <= 2000000) {
                progressCallback(95, 'Sharpening...');
                await this._enhanceDetails(outputCtx, outputCanvas.width, outputCanvas.height);
            }

            progressCallback(100, 'Complete!');
            return outputCanvas;

        } catch (error) {
            console.error('Server processing failed:', error);
            progressCallback(20, 'Server failed, using local AI...');
            return await this._processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
        }
    }

    /**
     * Process with local browser AI (Real-ESRGAN WebGL)
     */
    async _processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback) {
        progressCallback(10, 'Loading local neural super-resolution model...');

        try {
            const { default: Upscaler } = await import('upscaler');

            const scale = this.processingMode === 'enhance' ? 2 : this.scaleFactor;
            const clampedScale = scale <= 2 ? 2 : (scale <= 3 ? 3 : 4);
            let model;

            if (this.modelType === 'thick') {
                if (clampedScale <= 2) {
                    const { default: m } = await import('@upscalerjs/esrgan-thick/2x');
                    model = m;
                } else if (clampedScale <= 3) {
                    const { default: m } = await import('@upscalerjs/esrgan-thick/3x');
                    model = m;
                } else {
                    const { default: m } = await import('@upscalerjs/esrgan-thick/4x');
                    model = m;
                }
            } else {
                // Default: Fast, local ESRGAN-Slim served directly from /models/esrgan-slim/
                model = {
                    scale: clampedScale,
                    modelType: 'layers',
                    path: `/models/esrgan-slim/x${clampedScale}/model.json`,
                    inputRange: [0, 255],
                    outputRange: [0, 255],
                    _internals: {
                        path: `models/x${clampedScale}/model.json`,
                        name: '@upscalerjs/esrgan-slim',
                        version: '1.0.0-beta.12'
                    }
                };
            }

            progressCallback(25, 'Initializing WebGL GPU engine...');

            if (this.upscaler) {
                try {
                    await this.upscaler.dispose();
                } catch {
                    // Ignore disposal error
                }
                this.upscaler = null;
            }

            this.upscaler = new Upscaler({ model });
            await this.upscaler.ready;

            // Constrain source dimensions so neural output does not exceed this.maxDimension
            const maxAllowedInputW = Math.floor(this.maxDimension / clampedScale);
            const maxAllowedInputH = Math.floor(this.maxDimension / clampedScale);

            let sourceToProcess = source;
            let currentSrcW = srcWidth;
            let currentSrcH = srcHeight;

            if (srcWidth > maxAllowedInputW || srcHeight > maxAllowedInputH) {
                const ratio = Math.min(maxAllowedInputW / srcWidth, maxAllowedInputH / srcHeight);
                currentSrcW = Math.max(1, Math.floor(srcWidth * ratio));
                currentSrcH = Math.max(1, Math.floor(srcHeight * ratio));

                progressCallback(30, `Optimizing large input (${srcWidth}×${srcHeight} → ${currentSrcW}×${currentSrcH})...`);

                const preCanvas = document.createElement('canvas');
                preCanvas.width = currentSrcW;
                preCanvas.height = currentSrcH;
                const preCtx = preCanvas.getContext('2d');
                preCtx.imageSmoothingEnabled = true;
                preCtx.imageSmoothingQuality = 'high';
                preCtx.drawImage(source, 0, 0, currentSrcW, currentSrcH);
                sourceToProcess = preCanvas;
            }

            progressCallback(35, 'Processing neural super-resolution patches...');

            // Patch sizing: 128px offers optimal balance of speed, GPU memory, and boundary seam minimization.
            // awaitNextFrame: true yields execution to requestAnimationFrame between patches, keeping the UI
            // responsive and preventing browser watchdog hangs on multi-megapixel images.
            const patchSize = 128;
            const padding = 6;

            const upscaledTensor = await this.upscaler.upscale(sourceToProcess, {
                output: 'tensor',
                patchSize,
                padding,
                awaitNextFrame: true,
                progress: (progress) => {
                    const pct = Math.round(35 + progress * 50);
                    progressCallback(pct, `Upscaling image patches... ${Math.round(progress * 100)}%`);
                }
            });

            progressCallback(88, 'Finalizing enhanced resolution...');

            const tensorH = upscaledTensor.shape[0];
            const tensorW = upscaledTensor.shape[1];

            const rawCanvas = document.createElement('canvas');
            rawCanvas.width = tensorW;
            rawCanvas.height = tensorH;

            const tf = await import('@tensorflow/tfjs');
            const tensorToDraw = upscaledTensor.shape.length === 4 ? upscaledTensor.squeeze([0]) : upscaledTensor;

            // TensorFlow.js toPixels expects int32 for [0, 255] or float32 for [0, 1].
            // ESRGAN outputs float32 values in [0, 255] which may slightly exceed 1.0 or 255.
            const intTensor = tf.tidy(() => {
                return tensorToDraw.clipByValue(0, 255).cast('int32');
            });

            await tf.browser.toPixels(intTensor, rawCanvas);

            intTensor.dispose();
            upscaledTensor.dispose();
            if (tensorToDraw !== upscaledTensor) {
                tensorToDraw.dispose();
            }

            // Target dimensions
            const targetWidth = outWidth;
            const targetHeight = outHeight;

            let canvas = rawCanvas;
            if (rawCanvas.width !== targetWidth || rawCanvas.height !== targetHeight) {
                const finalCanvas = document.createElement('canvas');
                finalCanvas.width = targetWidth;
                finalCanvas.height = targetHeight;
                const finalCtx = finalCanvas.getContext('2d');
                finalCtx.imageSmoothingEnabled = true;
                finalCtx.imageSmoothingQuality = 'high';
                finalCtx.drawImage(rawCanvas, 0, 0, targetWidth, targetHeight);
                canvas = finalCanvas;
            }

            // Apply multi-scale edge and clarity refinement for "both" mode or when sharpenEdges is enabled
            if (this.sharpenEdges || this.processingMode === 'both') {
                progressCallback(95, 'Refining edge sharpness & micro-detail...');
                canvas = await this._enhanceImage(canvas, targetWidth, targetHeight, progressCallback);
            }

            progressCallback(100, 'Super-resolution complete!');
            return canvas;

        } catch (error) {
            console.error('Local AI failed, falling back to bicubic interpolation:', error);
            return await this._processClassic(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
        }
    }

    /**
     * Classic processing (no AI)
     */
    async _processClassic(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback) {
        progressCallback(20, 'Processing...');

        if (this.processingMode === 'enhance') {
            return await this._enhanceImage(source, outWidth, outHeight, progressCallback);
        }

        const canvas = document.createElement('canvas');
        canvas.width = outWidth;
        canvas.height = outHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, srcWidth, srcHeight, 0, 0, outWidth, outHeight);

        if (this.sharpenEdges || this.processingMode === 'both') {
            progressCallback(80, 'Sharpening & enhancing clarity...');
            return await this._enhanceImage(canvas, outWidth, outHeight, progressCallback);
        }

        progressCallback(100, 'Complete!');
        return canvas;
    }

    /**
     * Detail enhancement (backward-compatible adapter)
     */
    async _enhanceDetails(ctx, width, height) {
        const enhanced = await this._enhanceImage(ctx.canvas, width, height);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(enhanced, 0, 0);
    }

    /**
     * High-performance Multi-Scale Clarity & Detail Enhancement
     * Uses WebGL2 multi-scale frequency separation with adaptive tone protection
     * Falls back to high-quality 2D canvas convolution when WebGL is unavailable
     */
    async _enhanceImage(source, width, height, progressCallback = () => {}) {
        progressCallback(20, 'Initializing GPU clarity engine...');

        try {
            const glCanvas = document.createElement('canvas');
            glCanvas.width = width;
            glCanvas.height = height;
            const gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false, antialias: false });
            if (!gl) throw new Error('WebGL2 not available');

            const vsSource = `#version 300 es
            in vec2 a_pos;
            out vec2 v_uv;
            void main() {
                v_uv = (a_pos + 1.0) * 0.5;
                gl_Position = vec4(a_pos, 0.0, 1.0);
            }`;

            const fsSource = `#version 300 es
            precision highp float;
            in vec2 v_uv;
            out vec4 fragColor;
            uniform sampler2D u_image;
            uniform vec2 u_texel;

            const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

            // Detect human skin tones to protect portraits from harshness
            float getSkinWeight(vec3 rgb) {
                float r = rgb.r, g = rgb.g, b = rgb.b;
                bool isSkin = (r > 0.35 && g > 0.20 && b > 0.15 && r > g && g > b && (r - g) > 0.05);
                return isSkin ? 0.8 : 0.0;
            }

            void main() {
                vec4 center4 = texture(u_image, v_uv);
                vec3 center = center4.rgb;
                float cLuma = dot(center, LUMA);

                // 1. 9-tap Edge-Preserving Cross & Diagonal Samples
                vec3 n  = texture(u_image, v_uv + vec2(0.0, u_texel.y)).rgb;
                vec3 s  = texture(u_image, v_uv - vec2(0.0, u_texel.y)).rgb;
                vec3 e  = texture(u_image, v_uv + vec2(u_texel.x, 0.0)).rgb;
                vec3 w  = texture(u_image, v_uv - vec2(u_texel.x, 0.0)).rgb;
                vec3 ne = texture(u_image, v_uv + vec2(u_texel.x, u_texel.y)).rgb;
                vec3 nw = texture(u_image, v_uv + vec2(-u_texel.x, u_texel.y)).rgb;
                vec3 se = texture(u_image, v_uv + vec2(u_texel.x, -u_texel.y)).rgb;
                vec3 sw = texture(u_image, v_uv + vec2(-u_texel.x, -u_texel.y)).rgb;

                // 2. Compute local edge gradient magnitude (Sobel / central differences)
                float gx = dot(ne + 2.0 * e + se - (nw + 2.0 * w + sw), LUMA);
                float gy = dot(ne + 2.0 * n + nw - (se + 2.0 * s + sw), LUMA);
                float edgeMag = sqrt(gx * gx + gy * gy);

                // 3. Bilateral Edge-Preserving Denoising for smooth regions
                // When edgeMag is low (< 0.06), pixels get gentle bilateral noise cleanup
                float spatialWeight = 0.125;
                float bilateralSum = 1.0;
                vec3 bilateralAcc = center;

                #define ACC_BILATERAL(sampleColor) { \
                    float dL = abs(dot(sampleColor, LUMA) - cLuma); \
                    float rW = exp(-dL * dL / 0.008) * spatialWeight; \
                    bilateralAcc += sampleColor * rW; \
                    bilateralSum += rW; \
                }

                ACC_BILATERAL(n);
                ACC_BILATERAL(s);
                ACC_BILATERAL(e);
                ACC_BILATERAL(w);
                ACC_BILATERAL(ne);
                ACC_BILATERAL(nw);
                ACC_BILATERAL(se);
                ACC_BILATERAL(sw);

                vec3 denoised = bilateralAcc / bilateralSum;

                // 4. Subtle, Natural Edge Polish (ONLY on real edges, NEVER on noise or flat sky/skin)
                float edgeGate = smoothstep(0.04, 0.20, edgeMag);
                float skinProt = getSkinWeight(center);
                edgeGate *= (1.0 - skinProt * 0.75); // Damps sharpening on skin by 75% for creamy, flattering portraits

                // Unsharp high-frequency detail relative to bilateral base
                vec3 highFreq = center - denoised;
                // Gentle, natural edge sharpening (0.35, not harsh 1.25)
                vec3 edgePolish = highFreq * (0.35 * edgeGate);

                // Blend base between clean denoised and original
                vec3 baseClean = mix(denoised, center, clamp(edgeMag * 4.0, 0.0, 1.0));
                vec3 sharpResult = baseClean + edgePolish;

                // 5. Filmic Tonal Polish (Subtle dynamic range & shadow recovery)
                vec3 tonePolished;
                for (int c = 0; c < 3; c++) {
                    float v = sharpResult[c];
                    float shadowLift = 0.035 * exp(-v * 5.0);
                    float highlightSoft = 1.0 - exp(-v * 1.05) / (1.0 - exp(-1.05));
                    tonePolished[c] = mix(v + shadowLift, highlightSoft, 0.2);
                }

                // 6. Natural Color Richness (Subtle saturation polish on muted midtones)
                float toneLuma = dot(tonePolished, LUMA);
                float midtoneWeight = smoothstep(0.05, 0.35, toneLuma) * (1.0 - smoothstep(0.70, 0.95, toneLuma));
                vec3 finalRgb = mix(vec3(toneLuma), tonePolished, 1.0 + 0.05 * midtoneWeight);

                fragColor = vec4(clamp(finalRgb, 0.0, 1.0), center4.a);
            }`;

            const compileShader = (type, src) => {
                const s = gl.createShader(type);
                gl.shaderSource(s, src);
                gl.compileShader(s);
                if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                    throw new Error(gl.getShaderInfoLog(s));
                }
                return s;
            };

            const prog = gl.createProgram();
            gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSource));
            gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSource));
            gl.linkProgram(prog);
            gl.useProgram(prog);

            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
            const aPos = gl.getAttribLocation(prog, 'a_pos');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

            progressCallback(50, 'Enhancing textures & edge contrast...');

            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            gl.uniform2f(gl.getUniformLocation(prog, 'u_texel'), 1.0 / width, 1.0 / height);

            gl.viewport(0, 0, width, height);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            progressCallback(85, 'Finalizing enhanced output...');

            const outCanvas = document.createElement('canvas');
            outCanvas.width = width;
            outCanvas.height = height;
            const outCtx = outCanvas.getContext('2d');
            outCtx.drawImage(glCanvas, 0, 0);

            // Cleanup WebGL resources
            gl.deleteTexture(tex);
            gl.deleteBuffer(buf);
            gl.deleteProgram(prog);

            progressCallback(100, 'Enhancement complete!');
            return outCanvas;

        } catch (err) {
            console.warn('[ImageUpscaler] WebGL2 enhancement unavailable, using 2D canvas fallback:', err);
            return this._fallbackCanvas2D(source, width, height, progressCallback);
        }
    }

    /**
     * Fallback 2D canvas natural photographic polish
     */
    _fallbackCanvas2D(source, width, height, progressCallback = () => {}) {
        progressCallback(40, 'Refining details with CPU fallback...');
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const d = imgData.data;
        const orig = new Uint8ClampedArray(d);

        const amount = 0.35;
        for (let i = 0; i < d.length; i += 4) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            if (x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2) continue;

            for (let c = 0; c < 3; c++) {
                const idx = i + c;
                const cur = orig[idx];
                const n = orig[idx - width * 4];
                const s = orig[idx + width * 4];
                const w = orig[idx - 4];
                const e = orig[idx + 4];
                const avg = (n + s + w + e) * 0.25;
                const diff = cur - avg;
                if (Math.abs(diff) > 4 && Math.abs(diff) < 40) {
                    d[idx] = Math.min(255, Math.max(0, Math.round(cur + diff * amount)));
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    /**
     * Upscale from WebGL canvas
     */
    async upscaleFromWebGL(gl, width, height, progressCallback = () => { }) {
        progressCallback(0, 'Reading image...');

        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        const imageData = tempCtx.createImageData(width, height);

        // Flip Y axis (WebGL origin is bottom-left)
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            for (let x = 0; x < width * 4; x++) {
                imageData.data[dstRow + x] = pixels[srcRow + x];
            }
        }

        tempCtx.putImageData(imageData, 0, 0);
        progressCallback(5, 'Starting processing...');

        return this.upscale(tempCanvas, (percent, msg) => {
            progressCallback(5 + percent * 0.95, msg);
        });
    }

    cancel() {
        this.isProcessing = false;
    }

    dispose() {
        if (this.upscaler) {
            this.upscaler.dispose();
            this.upscaler = null;
        }
    }
}

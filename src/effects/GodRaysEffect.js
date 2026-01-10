/**
 * GodRaysEffect.js - Advanced Volumetric Lighting Effect
 * 
 * Professional-grade god rays with:
 * - Smart light source detection
 * - Chromatic aberration
 * - Noise-based variation
 * - Atmospheric scattering
 * - Bloom effect
 * - ACES tone mapping
 */

import { VERTEX_SHADER, ADVANCED_GODRAYS_SHADER } from './AdvancedGodRaysShader.js';

export class GodRaysEffect {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;

        // WebGL context
        this.gl = null;
        this.program = null;

        // Textures
        this.imageTexture = null;
        this.depthTexture = null;

        // Parameters (defaults)
        this.params = {
            sunPosition: { x: 0.5, y: 0.2 },  // Normalized 0-1
            intensity: 0.8,
            decay: 0.96,
            density: 0.6,
            weight: 0.5,
            lumThreshold: 0.5,
            depthThreshold: 0.6,
            rayColor: { r: 1.0, g: 0.96, b: 0.88 },  // Warm sunlight
            samples: 80,
            sunRadius: 0.12,
            exposure: 3.0,
            softness: 0.5,
            // Advanced parameters
            chromatic: 0.15,    // Chromatic aberration
            noise: 0.25,        // Noise variation
            bloom: 0.4,         // Bloom intensity
            scatter: 0.3,       // Atmospheric scatter
            toneMap: 0.6,       // Tone mapping strength
            // Shadow casting
            shadowIntensity: 0.6,   // How dark tree/object shadows are
            shadowSoftness: 0.4,    // Edge softness of shadows
            shadowLength: 0.5       // How far shadows extend
        };

        // State
        this.enabled = false;
        this.imageData = null;
        this.depthData = null;

        // Offscreen canvas for WebGL
        this.glCanvas = document.createElement('canvas');
    }

    /**
     * Initialize WebGL context and shaders
     */
    init(width, height) {
        this.glCanvas.width = width;
        this.glCanvas.height = height;

        // Get WebGL context
        this.gl = this.glCanvas.getContext('webgl', {
            antialias: false,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            console.error('❌ WebGL not supported for God Rays');
            return false;
        }

        // Compile shaders
        const vertexShader = this._compileShader(this.gl.VERTEX_SHADER, VERTEX_SHADER);
        const fragmentShader = this._compileShader(this.gl.FRAGMENT_SHADER, ADVANCED_GODRAYS_SHADER);

        if (!vertexShader || !fragmentShader) {
            console.error('❌ Failed to compile god rays shaders');
            return false;
        }

        // Create program
        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            console.error('❌ Shader program link error:', this.gl.getProgramInfoLog(this.program));
            return false;
        }

        // Setup geometry (full-screen quad)
        this._setupGeometry();

        // Get uniform locations
        this._getUniformLocations();

        this.enabled = true;
        return true;
    }

    /**
     * Compile a shader
     */
    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    /**
     * Setup full-screen quad geometry
     */
    _setupGeometry() {
        const gl = this.gl;

        // Vertex positions (full-screen quad)
        const positions = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        // Texture coordinates (flip Y to match canvas coordinate system)
        const texCoords = new Float32Array([
            0, 1,  // bottom-left in GL -> top-left in texture
            1, 1,  // bottom-right in GL -> top-right in texture
            0, 0,  // top-left in GL -> bottom-left in texture
            1, 0   // top-right in GL -> bottom-right in texture
        ]);

        // Position buffer
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        // Texture coordinate buffer
        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    }

    /**
     * Get uniform locations
     */
    _getUniformLocations() {
        const gl = this.gl;

        this.uniforms = {
            u_image: gl.getUniformLocation(this.program, 'u_image'),
            u_depth: gl.getUniformLocation(this.program, 'u_depth'),
            u_sunPosition: gl.getUniformLocation(this.program, 'u_sunPosition'),
            u_intensity: gl.getUniformLocation(this.program, 'u_intensity'),
            u_decay: gl.getUniformLocation(this.program, 'u_decay'),
            u_density: gl.getUniformLocation(this.program, 'u_density'),
            u_weight: gl.getUniformLocation(this.program, 'u_weight'),
            u_lumThreshold: gl.getUniformLocation(this.program, 'u_lumThreshold'),
            u_depthThreshold: gl.getUniformLocation(this.program, 'u_depthThreshold'),
            u_rayColor: gl.getUniformLocation(this.program, 'u_rayColor'),
            u_samples: gl.getUniformLocation(this.program, 'u_samples'),
            u_sunRadius: gl.getUniformLocation(this.program, 'u_sunRadius'),
            u_exposure: gl.getUniformLocation(this.program, 'u_exposure'),
            u_softness: gl.getUniformLocation(this.program, 'u_softness'),
            // Advanced uniforms
            u_chromatic: gl.getUniformLocation(this.program, 'u_chromatic'),
            u_noise: gl.getUniformLocation(this.program, 'u_noise'),
            u_bloom: gl.getUniformLocation(this.program, 'u_bloom'),
            u_scatter: gl.getUniformLocation(this.program, 'u_scatter'),
            u_toneMap: gl.getUniformLocation(this.program, 'u_toneMap'),
            u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            // Shadow uniforms
            u_shadowIntensity: gl.getUniformLocation(this.program, 'u_shadowIntensity'),
            u_shadowSoftness: gl.getUniformLocation(this.program, 'u_shadowSoftness'),
            u_shadowLength: gl.getUniformLocation(this.program, 'u_shadowLength')
        };

        this.attributes = {
            a_position: gl.getAttribLocation(this.program, 'a_position'),
            a_texCoord: gl.getAttribLocation(this.program, 'a_texCoord')
        };
    }

    /**
     * Upload image data as texture
     */
    uploadImage(imageData) {
        if (!this.gl) return;

        this.imageData = imageData;

        // Create image texture
        if (this.imageTexture) {
            this.gl.deleteTexture(this.imageTexture);
        }

        this.imageTexture = this._createTexture(imageData);
    }

    /**
     * Upload depth map as texture
     */
    uploadDepth(depthData) {
        if (!this.gl) return;

        this.depthData = depthData;

        // Create depth texture
        if (this.depthTexture) {
            this.gl.deleteTexture(this.depthTexture);
        }

        this.depthTexture = this._createTexture(depthData);
    }

    /**
     * Create a texture from ImageData
     */
    _createTexture(imageData) {
        const gl = this.gl;
        const texture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);

        // Clamp to edge and linear filtering
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        return texture;
    }

    /**
     * Set sun position (normalized 0-1)
     */
    setSunPosition(x, y) {
        this.params.sunPosition = { x, y };
    }

    /**
     * Set ray intensity
     */
    setIntensity(value) {
        this.params.intensity = Math.max(0, Math.min(2, value));
    }

    /**
     * Set decay factor
     */
    setDecay(value) {
        this.params.decay = Math.max(0.8, Math.min(0.99, value));
    }

    /**
     * Set density (blur distance)
     */
    setDensity(value) {
        this.params.density = Math.max(0.1, Math.min(1.0, value));
    }

    /**
     * Set sample count
     */
    setSamples(value) {
        this.params.samples = Math.max(16, Math.min(64, Math.floor(value)));
    }

    /**
     * Set luminance threshold
     */
    setLumThreshold(value) {
        this.params.lumThreshold = Math.max(0, Math.min(1, value));
    }

    /**
     * Set depth threshold
     */
    setDepthThreshold(value) {
        this.params.depthThreshold = Math.max(0, Math.min(1, value));
    }

    /**
     * Set ray color (hex string or {r,g,b})
     */
    setRayColor(color) {
        if (typeof color === 'string') {
            // Parse hex
            const hex = color.replace('#', '');
            this.params.rayColor = {
                r: parseInt(hex.substr(0, 2), 16) / 255,
                g: parseInt(hex.substr(2, 2), 16) / 255,
                b: parseInt(hex.substr(4, 2), 16) / 255
            };
        } else {
            this.params.rayColor = color;
        }
    }

    /**
     * Set sun radius (glow size)
     */
    setSunRadius(value) {
        this.params.sunRadius = Math.max(0.01, Math.min(0.5, value));
    }

    /**
     * Set exposure (brightness curve)
     */
    setExposure(value) {
        this.params.exposure = Math.max(0.5, Math.min(5.0, value));
    }

    /**
     * Set softness (edge softness)
     */
    setSoftness(value) {
        this.params.softness = Math.max(0, Math.min(1, value));
    }

    /**
     * Set chromatic aberration strength
     */
    setChromatic(value) {
        this.params.chromatic = Math.max(0, Math.min(1, value));
    }

    /**
     * Set noise variation
     */
    setNoise(value) {
        this.params.noise = Math.max(0, Math.min(1, value));
    }

    /**
     * Set bloom intensity
     */
    setBloom(value) {
        this.params.bloom = Math.max(0, Math.min(2, value));
    }

    /**
     * Set atmospheric scatter
     */
    setScatter(value) {
        this.params.scatter = Math.max(0, Math.min(1, value));
    }

    /**
     * Set tone mapping strength
     */
    setToneMap(value) {
        this.params.toneMap = Math.max(0, Math.min(1, value));
    }

    /**
     * Set shadow intensity (how dark tree/object shadows are)
     */
    setShadowIntensity(value) {
        this.params.shadowIntensity = Math.max(0, Math.min(1, value));
    }

    /**
     * Set shadow softness (edge softness)
     */
    setShadowSoftness(value) {
        this.params.shadowSoftness = Math.max(0, Math.min(1, value));
    }

    /**
     * Set shadow length (how far shadows extend)
     */
    setShadowLength(value) {
        this.params.shadowLength = Math.max(0.1, Math.min(1, value));
    }

    /**
     * Render the god rays effect
     */
    render() {
        if (!this.gl || !this.imageTexture) return null;

        const gl = this.gl;

        // Use program
        gl.useProgram(this.program);

        // Set viewport
        gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        gl.uniform1i(this.uniforms.u_image, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture || this.imageTexture);
        gl.uniform1i(this.uniforms.u_depth, 1);

        // Set uniforms
        // Note: Don't flip Y here - texture coords already corrected for canvas orientation
        gl.uniform2f(this.uniforms.u_sunPosition,
            this.params.sunPosition.x,
            this.params.sunPosition.y);
        gl.uniform1f(this.uniforms.u_intensity, this.params.intensity);
        gl.uniform1f(this.uniforms.u_decay, this.params.decay);
        gl.uniform1f(this.uniforms.u_density, this.params.density);
        gl.uniform1f(this.uniforms.u_weight, this.params.weight);
        gl.uniform1f(this.uniforms.u_lumThreshold, this.params.lumThreshold);
        gl.uniform1f(this.uniforms.u_depthThreshold, this.params.depthThreshold);
        gl.uniform3f(this.uniforms.u_rayColor,
            this.params.rayColor.r,
            this.params.rayColor.g,
            this.params.rayColor.b);
        gl.uniform1i(this.uniforms.u_samples, this.params.samples);

        // New uniforms
        gl.uniform1f(this.uniforms.u_sunRadius, this.params.sunRadius);
        gl.uniform1f(this.uniforms.u_exposure, this.params.exposure);
        gl.uniform1f(this.uniforms.u_softness, this.params.softness);

        // Advanced uniforms
        gl.uniform1f(this.uniforms.u_chromatic, this.params.chromatic);
        gl.uniform1f(this.uniforms.u_noise, this.params.noise);
        gl.uniform1f(this.uniforms.u_bloom, this.params.bloom);
        gl.uniform1f(this.uniforms.u_scatter, this.params.scatter);
        gl.uniform1f(this.uniforms.u_toneMap, this.params.toneMap);
        gl.uniform2f(this.uniforms.u_resolution, this.glCanvas.width, this.glCanvas.height);

        // Shadow uniforms
        gl.uniform1f(this.uniforms.u_shadowIntensity, this.params.shadowIntensity);
        gl.uniform1f(this.uniforms.u_shadowSoftness, this.params.shadowSoftness);
        gl.uniform1f(this.uniforms.u_shadowLength, this.params.shadowLength);

        // Bind position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.attributes.a_position);
        gl.vertexAttribPointer(this.attributes.a_position, 2, gl.FLOAT, false, 0, 0);

        // Bind texture coordinate buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(this.attributes.a_texCoord);
        gl.vertexAttribPointer(this.attributes.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        return this.glCanvas;
    }

    /**
     * Get the result canvas
     */
    getCanvas() {
        return this.glCanvas;
    }

    /**
     * Get ImageData from result
     */
    getImageData() {
        if (!this.gl) return null;

        const width = this.glCanvas.width;
        const height = this.glCanvas.height;
        const pixels = new Uint8Array(width * height * 4);

        this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);

        // Flip Y (WebGL is bottom-up)
        const flipped = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            flipped.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow);
        }

        return new ImageData(flipped, width, height);
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.gl) {
            if (this.imageTexture) this.gl.deleteTexture(this.imageTexture);
            if (this.depthTexture) this.gl.deleteTexture(this.depthTexture);
            if (this.program) this.gl.deleteProgram(this.program);
        }

        this.enabled = false;
    }
}

export default GodRaysEffect;

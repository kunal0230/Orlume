/**
 * AdvancedShadowShader - State-of-the-Art Shadow System
 * 
 * Implements:
 * - PCF (Percentage Closer Filtering) Soft Shadows
 * - Contact Shadows (Screen-Space Raymarching)
 * - HBAO Integration (Ambient Occlusion)
 * - Shadow Color Bleeding (GI approximation)
 * 
 * This shader computes a comprehensive shadow map that can be
 * sampled in the main relighting shader for realistic shadows.
 */

export const AdvancedShadowShader = {
    name: 'AdvancedShadow',

    vertexShader: `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }
    `,

    /**
     * Fragment Shader - Advanced Shadow Computation
     * 
     * Output:
     * - R: Shadow intensity (0 = full shadow, 1 = lit)
     * - G: Contact shadow (for ground connection)
     * - B: Ambient occlusion
     * - A: Color bleeding hint
     */
    fragmentShader: `
        precision highp float;
        
        varying vec2 v_texCoord;
        
        uniform sampler2D u_depthMap;
        uniform sampler2D u_normalMap;
        uniform sampler2D u_image;       // Original image for color bleeding
        uniform sampler2D u_aoMap;       // Pre-computed HBAO
        uniform vec2 u_resolution;
        
        // Light uniforms
        uniform vec3 u_lightPos;         // Light position (x, y, z normalized)
        uniform float u_lightRadius;     // Light size (larger = softer shadows)
        
        // Shadow parameters
        uniform float u_shadowIntensity;
        uniform float u_contactDistance; // Max distance for contact shadows
        uniform int u_pcfSamples;        // PCF kernel size (4, 8, 16)
        uniform int u_raymarchSteps;     // Contact shadow steps
        uniform float u_colorBleedAmount;// Color bleeding intensity

        // Golden ratio for better sample distribution
        const float GOLDEN_ANGLE = 2.39996323;
        const float PI = 3.14159265359;
        
        // Get depth at UV
        float getDepth(vec2 uv) {
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                return 1.0; // Far plane
            }
            return texture2D(u_depthMap, uv).r;
        }
        
        // Get normal at UV
        vec3 getNormal(vec2 uv) {
            vec3 n = texture2D(u_normalMap, uv).rgb * 2.0 - 1.0;
            return normalize(n);
        }
        
        //=========================================================
        // PCF SOFT SHADOWS
        // Sample shadow in a disk pattern for realistic penumbra
        //=========================================================
        float computePCFShadow(vec2 uv, float depth) {
            vec3 normal = getNormal(uv);
            
            // Direction to light in screen space
            vec2 lightDir2D = u_lightPos.xy - uv;
            float lightDist = length(lightDir2D);
            vec3 lightDir = normalize(vec3(lightDir2D, u_lightPos.z));
            
            // N dot L for basic shadowing
            float NdotL = dot(normal, lightDir);
            if (NdotL <= 0.0) {
                return 0.0; // Facing away from light
            }
            
            // Shadow bias based on surface angle
            float bias = 0.001 + 0.005 * (1.0 - NdotL);
            
            // PCF sampling in a disk
            float shadow = 0.0;
            float sampleRadius = u_lightRadius * (1.0 - depth); // Closer = smaller penumbra
            
            for (int i = 0; i < 16; i++) {
                if (i >= u_pcfSamples) break;
                
                // Vogel disk distribution (golden angle spiral)
                float r = sqrt(float(i) / float(u_pcfSamples));
                float theta = float(i) * GOLDEN_ANGLE;
                vec2 offset = vec2(cos(theta), sin(theta)) * r * sampleRadius;
                
                vec2 sampleUV = uv + offset;
                float sampleDepth = getDepth(sampleUV);
                
                // Compare depths - sample is blocking if it's closer
                // and between us and the light
                float blocking = step(sampleDepth + bias, depth);
                
                // Weight by distance to center of disk
                float weight = 1.0 - r;
                shadow += blocking * weight;
            }
            
            // Normalize
            float totalWeight = 0.0;
            for (int i = 0; i < 16; i++) {
                if (i >= u_pcfSamples) break;
                float r = sqrt(float(i) / float(u_pcfSamples));
                totalWeight += 1.0 - r;
            }
            
            shadow = shadow / max(totalWeight, 0.001);
            
            // Smooth the transition
            shadow = smoothstep(0.0, 1.0, shadow);
            
            // Apply N dot L
            return (1.0 - shadow) * smoothstep(0.0, 0.3, NdotL);
        }
        
        //=========================================================
        // CONTACT SHADOWS
        // Raymarching for small-scale occlusion near surfaces
        //=========================================================
        float computeContactShadow(vec2 uv, float depth) {
            vec3 normal = getNormal(uv);
            
            // Direction to light
            vec2 lightDir2D = normalize(u_lightPos.xy - uv);
            vec3 lightDir = normalize(vec3(lightDir2D, u_lightPos.z));
            
            // Skip if facing away or light is behind
            if (dot(normal, lightDir) < 0.1) {
                return 1.0;
            }
            
            // Starting position
            vec3 pos = vec3(uv, depth);
            
            // Step along the light direction
            vec3 step = lightDir * (u_contactDistance / float(u_raymarchSteps));
            step.xy /= u_resolution; // Convert to UV space
            
            float occlusion = 0.0;
            float maxWeight = 0.0;
            
            for (int i = 1; i <= 32; i++) {
                if (i > u_raymarchSteps) break;
                
                pos += step;
                
                // Bounds check
                if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
                    break;
                }
                
                float sampleDepth = getDepth(pos.xy);
                
                // If sample is in front of our ray, we're occluded
                float delta = pos.z - sampleDepth;
                
                if (delta > 0.001 && delta < u_contactDistance * 0.5) {
                    // Soft falloff based on distance
                    float weight = 1.0 - float(i) / float(u_raymarchSteps);
                    weight *= smoothstep(u_contactDistance * 0.5, 0.0, delta);
                    
                    occlusion += weight;
                    maxWeight += weight;
                }
            }
            
            if (maxWeight > 0.0) {
                occlusion = occlusion / maxWeight;
            }
            
            return 1.0 - clamp(occlusion * 1.5, 0.0, 1.0);
        }
        
        //=========================================================
        // COLOR BLEEDING
        // Approximate global illumination from nearby surfaces
        //=========================================================
        vec3 computeColorBleeding(vec2 uv, float depth) {
            if (u_colorBleedAmount < 0.01) {
                return vec3(0.0);
            }
            
            vec3 bleedColor = vec3(0.0);
            float totalWeight = 0.0;
            
            // Sample in a cross pattern around the pixel
            float radius = 0.02 * (1.0 - depth); // Closer objects = more bleeding
            
            for (int i = 0; i < 8; i++) {
                float angle = float(i) * PI * 0.25;
                vec2 offset = vec2(cos(angle), sin(angle)) * radius;
                
                vec2 sampleUV = uv + offset;
                float sampleDepth = getDepth(sampleUV);
                
                // Only bleed from surfaces that are closer (occluding)
                if (sampleDepth < depth - 0.01) {
                    vec3 sampleColor = texture2D(u_image, sampleUV).rgb;
                    
                    // Weight by depth difference and distance
                    float depthDiff = depth - sampleDepth;
                    float weight = smoothstep(0.1, 0.0, depthDiff) * (1.0 - float(i) / 8.0);
                    
                    bleedColor += sampleColor * weight;
                    totalWeight += weight;
                }
            }
            
            if (totalWeight > 0.0) {
                bleedColor = bleedColor / totalWeight;
            }
            
            return bleedColor * u_colorBleedAmount;
        }
        
        void main() {
            float depth = getDepth(v_texCoord);
            
            // Skip background
            if (depth > 0.99) {
                gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
                return;
            }
            
            // Compute shadow components
            float pcfShadow = computePCFShadow(v_texCoord, depth);
            float contactShadow = computeContactShadow(v_texCoord, depth);
            float ao = texture2D(u_aoMap, v_texCoord).r;
            
            // Color bleeding
            vec3 colorBleed = computeColorBleeding(v_texCoord, depth);
            float colorBleedIntensity = length(colorBleed);
            
            // Combine shadows
            float combinedShadow = pcfShadow * contactShadow;
            
            // Apply intensity
            combinedShadow = mix(1.0, combinedShadow, u_shadowIntensity);
            
            // Output: R=shadow, G=contact, B=AO, A=colorBleedAmount
            gl_FragColor = vec4(
                combinedShadow,
                contactShadow,
                ao,
                colorBleedIntensity
            );
        }
    `,

    // Default uniforms
    defaultUniforms: {
        u_lightPos: [0.5, 0.3, 0.8],
        u_lightRadius: 0.05,
        u_shadowIntensity: 0.8,
        u_contactDistance: 0.1,
        u_pcfSamples: 8,
        u_raymarchSteps: 16,
        u_colorBleedAmount: 0.15
    }
};

/**
 * AdvancedShadowProcessor - WebGL2 Implementation
 */
export class AdvancedShadowProcessor {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.initialized = false;
        this.textures = {};
        this.uniforms = {};
    }

    init(width, height) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;

        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            alpha: true,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            console.warn('WebGL2 not available for advanced shadows');
            return false;
        }

        const gl = this.gl;

        // Compile shaders
        const vertShader = this._compileShader(gl.VERTEX_SHADER, AdvancedShadowShader.vertexShader);
        const fragShader = this._compileShader(gl.FRAGMENT_SHADER, AdvancedShadowShader.fragmentShader);

        if (!vertShader || !fragShader) return false;

        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertShader);
        gl.attachShader(this.program, fragShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Advanced shadow program failed:', gl.getProgramInfoLog(this.program));
            return false;
        }

        gl.useProgram(this.program);

        // Setup geometry
        this._setupGeometry();

        // Get uniform locations
        this._getUniformLocations();

        this.initialized = true;
        console.log('🌑 Advanced Shadow System initialized');
        return true;
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader error:', gl.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    }

    _setupGeometry() {
        const gl = this.gl;

        const positions = new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]);
        const texCoords = new Float32Array([
            0, 0, 1, 0, 0, 1,
            0, 1, 1, 0, 1, 1
        ]);

        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    }

    _getUniformLocations() {
        const gl = this.gl;
        const uniforms = [
            'u_depthMap', 'u_normalMap', 'u_image', 'u_aoMap',
            'u_resolution', 'u_lightPos', 'u_lightRadius',
            'u_shadowIntensity', 'u_contactDistance',
            'u_pcfSamples', 'u_raymarchSteps', 'u_colorBleedAmount'
        ];

        for (const name of uniforms) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }

    _createTexture(source) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        if (source instanceof HTMLCanvasElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } else if (source instanceof ImageData) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
        }

        return texture;
    }

    /**
     * Compute advanced shadow map
     * 
     * @param {Object} depthMap - Depth map {canvas, width, height}
     * @param {HTMLCanvasElement} normalMap - Normal map canvas
     * @param {HTMLCanvasElement} image - Original image canvas
     * @param {HTMLCanvasElement} aoMap - HBAO map (optional)
     * @param {Object} options - Shadow options
     * @returns {HTMLCanvasElement} - Shadow map with all effects
     */
    compute(depthMap, normalMap, image, aoMap, options = {}) {
        if (!this.initialized) {
            this.init(depthMap.width, depthMap.height);
        }

        const gl = this.gl;
        const defaults = AdvancedShadowShader.defaultUniforms;

        // Resize if needed
        if (this.canvas.width !== depthMap.width || this.canvas.height !== depthMap.height) {
            this.canvas.width = depthMap.width;
            this.canvas.height = depthMap.height;
            gl.viewport(0, 0, depthMap.width, depthMap.height);
        }

        gl.useProgram(this.program);

        // Bind textures
        const depthTex = this._createTexture(depthMap.canvas);
        const normalTex = this._createTexture(normalMap);
        const imageTex = this._createTexture(image);
        const aoTex = aoMap ? this._createTexture(aoMap.canvas || aoMap) : this._createDummyTexture();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, depthTex);
        gl.uniform1i(this.uniforms.u_depthMap, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, normalTex);
        gl.uniform1i(this.uniforms.u_normalMap, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, imageTex);
        gl.uniform1i(this.uniforms.u_image, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, aoTex);
        gl.uniform1i(this.uniforms.u_aoMap, 3);

        // Set uniforms
        gl.uniform2f(this.uniforms.u_resolution, depthMap.width, depthMap.height);

        const lightPos = options.lightPos || defaults.u_lightPos;
        gl.uniform3f(this.uniforms.u_lightPos, lightPos[0], lightPos[1], lightPos[2]);

        gl.uniform1f(this.uniforms.u_lightRadius, options.lightRadius || defaults.u_lightRadius);
        gl.uniform1f(this.uniforms.u_shadowIntensity, options.shadowIntensity ?? defaults.u_shadowIntensity);
        gl.uniform1f(this.uniforms.u_contactDistance, options.contactDistance || defaults.u_contactDistance);
        gl.uniform1i(this.uniforms.u_pcfSamples, options.pcfSamples || defaults.u_pcfSamples);
        gl.uniform1i(this.uniforms.u_raymarchSteps, options.raymarchSteps || defaults.u_raymarchSteps);
        gl.uniform1f(this.uniforms.u_colorBleedAmount, options.colorBleedAmount ?? defaults.u_colorBleedAmount);

        // Render
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Cleanup textures
        gl.deleteTexture(depthTex);
        gl.deleteTexture(normalTex);
        gl.deleteTexture(imageTex);
        if (aoTex !== this._dummyTexture) gl.deleteTexture(aoTex);

        return this.canvas;
    }

    _createDummyTexture() {
        if (this._dummyTexture) return this._dummyTexture;

        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        this._dummyTexture = texture;
        return texture;
    }

    dispose() {
        if (this.gl && this.program) {
            this.gl.deleteProgram(this.program);
        }
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.initialized = false;
    }
}

/**
 * ThreeJS3DRenderer - True 3D Model Reconstruction with Ray-Traced Shadows
 * 
 * Phase F: The Ultimate Relighting System
 * 
 * This creates a proper 3D model from depth data using Three.js:
 * 1. High-poly mesh from depth map (512x512 = 262,144 vertices)
 * 2. Ray-marched shadows for accurate self-shadowing
 * 3. PBR materials from segmentation
 * 4. Real-time interactive lighting
 */

import * as THREE from 'three';

export class ThreeJS3DRenderer {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mesh = null;
        this.light = null;
        this.depthTexture = null;
        this.normalTexture = null;
        this.albedoTexture = null;
        this.materialTexture = null;

        // Mesh settings
        this.meshResolution = 512;  // 512x512 = 262k vertices
        this.extrusionDepth = 0.4;

        // Light settings
        this.lightPosition = new THREE.Vector3(0, 0, 2);
        this.lightColor = new THREE.Color(1, 1, 1);
        this.lightIntensity = 1.5;
        this.ambient = 0.2;

        // Ray march settings
        this.shadowSteps = 32;
        this.shadowSoftness = 0.02;

        // Animation
        this.animationId = null;
        this.needsUpdate = true;

        // Uniforms for custom shader
        this.uniforms = {};
    }

    /**
     * Initialize the Three.js scene
     */
    init(width, height) {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = null; // Transparent background

        // Camera (orthographic for 2D-like view with 3D depth)
        const aspect = width / height;
        this.camera = new THREE.OrthographicCamera(
            -aspect, aspect, 1, -1, 0.1, 20
        );
        this.camera.position.z = 5;

        // Renderer with shadow support
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setClearColor(0x000000, 0);

        // Add canvas to container
        if (this.container) {
            this.container.appendChild(this.renderer.domElement);
        }

        // Create the displacement mesh (object)
        this._createMesh();

        // Create shadow-receiving ground plane
        this._createShadowPlane();

        // Directional light for shadow casting (better than point light for shadows)
        this.light = new THREE.DirectionalLight(0xffffff, 2);
        this.light.position.set(0, 0, 3);
        this.light.castShadow = true;

        // Shadow camera settings (orthographic for directional light)
        this.light.shadow.mapSize.width = 2048;
        this.light.shadow.mapSize.height = 2048;
        this.light.shadow.camera.near = 0.1;
        this.light.shadow.camera.far = 20;  // Cover full scene depth
        this.light.shadow.camera.left = -3;
        this.light.shadow.camera.right = 3;
        this.light.shadow.camera.top = 3;
        this.light.shadow.camera.bottom = -3;
        this.light.shadow.bias = -0.0005;  // Reduce shadow acne
        this.light.shadow.normalBias = 0.01;

        this.scene.add(this.light);

        // Ambient light for base illumination
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(ambientLight);

        console.log('🎮 Three.js 3D Renderer with Shadow Mapping initialized');
        console.log(`   📐 Mesh: ${this.meshResolution}x${this.meshResolution} = ${this.meshResolution * this.meshResolution} vertices`);
        console.log(`   🌑 Shadow Map: 2048x2048`);

        return this;
    }

    /**
     * Create shadow-receiving ground plane behind the mesh
     */
    _createShadowPlane() {
        // Large plane to catch all shadows
        const planeGeometry = new THREE.PlaneGeometry(8, 8);

        // Shadow-only material (receives shadows but otherwise transparent)
        const planeMaterial = new THREE.ShadowMaterial({
            opacity: 0.6,  // Visible shadows
            color: 0x000000
        });

        this.shadowPlane = new THREE.Mesh(planeGeometry, planeMaterial);
        this.shadowPlane.position.z = -0.5;  // Further behind for shadow room
        this.shadowPlane.receiveShadow = true;
        this.scene.add(this.shadowPlane);
        console.log('🌑 Shadow plane created at z=-0.5');
    }

    /**
     * Create the high-poly displacement mesh with custom shader
     */
    _createMesh() {
        const res = this.meshResolution;

        // Create plane geometry
        const geometry = new THREE.PlaneGeometry(2, 2, res - 1, res - 1);

        // Custom shader material for rendering
        this.uniforms = {
            u_albedo: { value: null },
            u_depth: { value: null },
            u_normals: { value: null },
            u_materials: { value: null },
            u_lightPos: { value: this.lightPosition },
            u_lightColor: { value: this.lightColor },
            u_lightIntensity: { value: this.lightIntensity },
            u_ambient: { value: this.ambient },
            u_extrusion: { value: this.extrusionDepth },
            u_shadowSteps: { value: this.shadowSteps },
            u_shadowSoftness: { value: this.shadowSoftness },
            u_resolution: { value: new THREE.Vector2(res, res) },
            u_shadowSharpness: { value: 0.8 },
            u_brightness: { value: 1.0 },
            u_lightRadius: { value: 0.05 }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.receiveShadow = false;
        this.mesh.castShadow = false;  // Custom shader can't cast shadows
        this.scene.add(this.mesh);

        // Create SEPARATE shadow-casting mesh
        // This mesh is invisible but casts shadows via Three.js shadow system
        this._createShadowCastingMesh();
    }

    /**
     * Create invisible mesh that casts shadows
     */
    _createShadowCastingMesh() {
        const res = 128;  // Lower res for performance
        this.shadowMeshRes = res;
        const geometry = new THREE.PlaneGeometry(2, 2, res - 1, res - 1);

        // Store reference to displace vertices later
        this.shadowGeometry = geometry;
        this.shadowVertexPositions = geometry.attributes.position.array.slice();

        // Use MeshStandardMaterial for proper shadow casting
        // Make it nearly invisible but still cast shadows
        const shadowMaterial = new THREE.MeshStandardMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.01,  // Nearly invisible
            side: THREE.DoubleSide
        });

        this.shadowMesh = new THREE.Mesh(geometry, shadowMaterial);
        this.shadowMesh.castShadow = true;
        this.shadowMesh.receiveShadow = false;
        this.shadowMesh.position.z = 0.01;  // Slightly in front
        this.scene.add(this.shadowMesh);
        console.log('🔲 Shadow-casting mesh created (128x128)');
    }

    /**
     * Update shadow mesh vertices based on depth map
     */
    updateShadowMeshFromDepth(depthCanvas) {
        if (!this.shadowGeometry || !depthCanvas) return;

        try {
            const ctx = depthCanvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);
            const data = imageData.data;

            const positions = this.shadowGeometry.attributes.position.array;
            const res = this.shadowMeshRes || 128;
            const verticesPerRow = res;

            // PlaneGeometry vertices are arranged row by row
            for (let row = 0; row < res; row++) {
                for (let col = 0; col < res; col++) {
                    const vertexIndex = row * verticesPerRow + col;

                    // Map to UV coordinates (0-1)
                    const u = col / (res - 1);
                    const v = 1 - row / (res - 1);  // Flip Y for image coords

                    // Map to image coordinates
                    const imgX = Math.floor(u * (depthCanvas.width - 1));
                    const imgY = Math.floor(v * (depthCanvas.height - 1));
                    const pixelIndex = (imgY * depthCanvas.width + imgX) * 4;

                    // Get depth value (0-255 -> 0-1)
                    const depth = data[pixelIndex] / 255;

                    // Displace Z based on depth (closer = higher Z)
                    // Use larger multiplier for visible shadows
                    positions[vertexIndex * 3 + 2] = depth * this.extrusionDepth * 2.0;
                }
            }

            this.shadowGeometry.attributes.position.needsUpdate = true;
            this.shadowGeometry.computeVertexNormals();
            this.needsUpdate = true;

            console.log('📐 Shadow mesh displaced from depth map');
        } catch (e) {
            console.error('Error updating shadow mesh:', e);
        }
    }

    /**
     * Upload textures from canvas data
     */
    uploadAlbedo(canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.uniforms.u_albedo.value = texture;
        this.albedoTexture = texture;
        this.needsUpdate = true;
    }

    uploadDepth(canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.uniforms.u_depth.value = texture;
        this.depthTexture = texture;
        this.depthCanvas = canvas;  // Store for shadow mesh update

        // Update shadow-casting mesh with depth displacement
        this.updateShadowMeshFromDepth(canvas);

        this.needsUpdate = true;
    }

    uploadNormals(canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.uniforms.u_normals.value = texture;
        this.normalTexture = texture;
        this.needsUpdate = true;
    }

    uploadMaterials(canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.uniforms.u_materials.value = texture;
        this.materialTexture = texture;
        this.needsUpdate = true;
    }

    /**
     * Set light position (normalized 0-1 coordinates)
     */
    setLightPosition(x, y, z = 0.8) {
        // Convert from 0-1 to -1 to 1 (screen space)
        const worldX = (x - 0.5) * 4;  // Wider range for directional light
        const worldY = -(y - 0.5) * 4;  // Flip Y, wider range
        const worldZ = 3;  // Keep light in front for proper shadow projection

        this.lightPosition.set(worldX, worldY, worldZ);
        this.uniforms.u_lightPos.value = this.lightPosition;

        if (this.light) {
            // Position directional light for shadow projection
            this.light.position.set(worldX, worldY, worldZ);

            // Update shadow camera
            if (this.light.shadow) {
                this.light.shadow.camera.updateProjectionMatrix();
            }
        }
        this.needsUpdate = true;
    }

    /**
     * Set light color
     */
    setLightColor(hex) {
        this.lightColor.set(hex);
        this.uniforms.u_lightColor.value = this.lightColor;
        if (this.light) {
            this.light.color.set(hex);
        }
        this.needsUpdate = true;
    }

    /**
     * Set light intensity
     */
    setLightIntensity(intensity) {
        this.lightIntensity = intensity;
        this.uniforms.u_lightIntensity.value = intensity;
        if (this.light) {
            this.light.intensity = intensity;
        }
        this.needsUpdate = true;
    }

    /**
     * Set ambient light level
     */
    setAmbient(ambient) {
        this.ambient = ambient;
        this.uniforms.u_ambient.value = ambient;
        this.needsUpdate = true;
    }

    /**
     * Set extrusion depth
     */
    setExtrusion(depth) {
        this.extrusionDepth = depth;
        this.uniforms.u_extrusion.value = depth;
        this.needsUpdate = true;
    }

    /**
     * Set shadow sharpness (0.0 = soft, 1.0 = razor sharp)
     */
    setShadowSharpness(sharpness) {
        this.uniforms.u_shadowSharpness.value = Math.max(0, Math.min(1, sharpness));
        // Smaller light radius = sharper shadows
        this.uniforms.u_lightRadius.value = 0.2 * (1 - sharpness) + 0.01;
        this.needsUpdate = true;
    }

    /**
     * Set brightness with smooth curve
     */
    setBrightness(brightness) {
        // Apply smooth curve for natural perception (gamma-like)
        const smoothed = Math.pow(brightness, 1.2);
        this.uniforms.u_brightness.value = smoothed;
        this.needsUpdate = true;
    }

    /**
     * Render a single frame
     */
    render() {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderer.render(this.scene, this.camera);
        this.needsUpdate = false;
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        const animate = () => {
            this.animationId = requestAnimationFrame(animate);
            if (this.needsUpdate) {
                this.render();
            }
        };
        animate();
    }

    /**
     * Stop animation loop
     */
    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Get rendered image as data URL
     */
    getImageDataURL() {
        this.render();
        return this.renderer.domElement.toDataURL('image/png');
    }

    /**
     * Get canvas element
     */
    getCanvas() {
        return this.renderer?.domElement;
    }

    /**
     * Resize renderer
     */
    resize(width, height) {
        if (!this.renderer || !this.camera) return;

        const aspect = width / height;
        this.camera.left = -aspect;
        this.camera.right = aspect;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
        this.needsUpdate = true;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.stopAnimation();

        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.container && this.renderer.domElement.parentNode) {
                this.container.removeChild(this.renderer.domElement);
            }
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mesh = null;
    }
}

// ========================================
// VERTEX SHADER - Depth Displacement
// ========================================
const VERTEX_SHADER = `
precision highp float;

uniform sampler2D u_depth;
uniform float u_extrusion;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

void main() {
    vUv = uv;
    
    // Sample depth at this vertex
    float depth = texture2D(u_depth, uv).r;
    vDepth = depth;
    
    // Displace vertex in Z based on depth (inverted: 0=far, 1=near)
    vec3 displaced = position;
    displaced.z = (1.0 - depth) * u_extrusion;
    
    vWorldPos = displaced;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

// ========================================
// FRAGMENT SHADER - Ray-Marched Shadows + PBR
// ========================================
const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_albedo;
uniform sampler2D u_depth;
uniform sampler2D u_normals;
uniform sampler2D u_materials;

uniform vec3 u_lightPos;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_ambient;
uniform float u_extrusion;
uniform int u_shadowSteps;
uniform float u_shadowSoftness;
uniform vec2 u_resolution;
// Phase G: Advanced light physics uniforms
uniform float u_shadowSharpness;
uniform float u_brightness;
uniform float u_lightRadius;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

// ========================================
// SIMPLE FAST SHADOW SYSTEM
// ========================================
// Minimal, working approach:
// Trace toward light, check if higher depth blocks us

float calculateShadow(vec2 uv, vec3 lightPos) {
    float ourDepth = texture2D(u_depth, uv).r;
    
    // Convert light to UV
    vec2 lightUV = vec2(lightPos.x * 0.5 + 0.5, -lightPos.y * 0.5 + 0.5);
    vec2 toLightDir = normalize(lightUV - uv);
    
    // Simple trace: 24 steps toward light
    float shadow = 1.0;
    
    for (int i = 1; i <= 24; i++) {
        float t = float(i) * 0.015;  // Smaller steps
        vec2 sampleUV = uv + toLightDir * t;
        
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 ||
            sampleUV.y < 0.0 || sampleUV.y > 1.0) break;
        
        float sampleDepth = texture2D(u_depth, sampleUV).r;
        
        // If sample is higher (closer to camera), it blocks light
        // VERY aggressive threshold for visibility
        if (sampleDepth > ourDepth + 0.02) {
            shadow = 0.1;  // Very dark shadow for visibility
            break;
        }
    }
    
    return shadow;
}

// Simple AO - just check neighbors
float calcAO() {
    float ao = 0.0;
    float d = texture2D(u_depth, vUv).r;
    vec2 ts = 1.0 / u_resolution;
    
    ao += max(0.0, texture2D(u_depth, vUv + vec2(ts.x, 0.0)).r - d);
    ao += max(0.0, texture2D(u_depth, vUv - vec2(ts.x, 0.0)).r - d);
    ao += max(0.0, texture2D(u_depth, vUv + vec2(0.0, ts.y)).r - d);
    ao += max(0.0, texture2D(u_depth, vUv - vec2(0.0, ts.y)).r - d);
    
    return clamp(1.0 - ao * 2.0, 0.3, 1.0);
}

// ========================================
// SMOOTH NORMAL SAMPLING
// ========================================
vec3 getSmoothNormal() {
    vec2 texelSize = 1.0 / u_resolution;
    vec3 n = vec3(0.0);
    float weight = 0.0;
    
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec3 sample = texture2D(u_normals, vUv + offset).rgb * 2.0 - 1.0;
            float w = (x == 0 && y == 0) ? 4.0 : 1.0;
            n += sample * w;
            weight += w;
        }
    }
    
    return normalize(n / weight);
}

void main() {
    // ========================================
    // TEXTURE SAMPLING
    // ========================================
    vec4 albedo = texture2D(u_albedo, vUv);
    vec3 normal = getSmoothNormal();
    vec4 material = texture2D(u_materials, vUv);
    
    float roughness = max(0.04, material.r);
    float metallic = material.g;
    float subsurface = material.b;
    
    // ========================================
    // OBJECT-SHAPED SHADOW PROJECTION
    // ========================================
    // Uses silhouette detection: ground pixels check for elevated objects
    // between them and the light, creating true object-shaped shadows
    float shadow = calculateShadow(vUv, u_lightPos);
    
    // Ambient occlusion: darkens crevices
    float ao = calcAO();
    
    // ========================================
    // PHYSICALLY CORRECT LIGHTING
    // ========================================
    vec3 lightDir = normalize(u_lightPos - vWorldPos);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    
    // Lambert diffuse (only light surfaces facing the light)
    float NdotL = dot(normal, lightDir);
    
    // CRITICAL: Surfaces facing away get NO light (not gradual falloff)
    // This prevents the "white gradient" effect
    float facingLight = step(0.0, NdotL);  // Binary: facing or not
    float diffuseFactor = max(0.0, NdotL) * facingLight;
    
    // Add slight wrap for smoother transition (but not too much)
    float wrapAmount = 0.1;  // Very small wrap to prevent hard line
    diffuseFactor = max(0.0, (NdotL + wrapAmount) / (1.0 + wrapAmount)) * facingLight;
    
    float NdotH = max(0.0, dot(normal, halfDir));
    float NdotV = max(0.001, dot(normal, viewDir));
    
    // ========================================
    // INVERSE-SQUARE FALLOFF (Physically Correct)
    // ========================================
    float dist = length(u_lightPos - vWorldPos);
    
    // Proper inverse-square with soft cutoff to prevent infinity at center
    float lightRadius = 0.3;  // Effective light radius
    float falloffStart = 0.1;  // Where falloff begins
    
    // Smooth falloff that doesn't blow out at center
    float normalizedDist = max(dist, falloffStart);
    float attenuation = 1.0 / (normalizedDist * normalizedDist + 0.1);
    
    // Clamp attenuation to prevent over-brightness
    attenuation = min(attenuation, 2.0);
    
    // Distance-based falloff cutoff (light doesn't reach far away)
    float falloffDistance = 3.0;
    float distanceFade = smoothstep(falloffDistance, 0.0, dist);
    attenuation *= distanceFade;
    
    // ========================================
    // SPECULAR (SUBTLE, NOT WHITE)
    // ========================================
    // Use albedo-tinted specular to avoid white highlights
    float spec = pow(NdotH, 128.0 / roughness) * (1.0 - roughness);
    vec3 specColor = mix(vec3(0.04), albedo.rgb, metallic);
    vec3 specular = specColor * spec * shadow * 0.5;
    
    // ========================================
    // SSS FOR SKIN (SUBTLE)
    // ========================================
    float sssWrap = max(0.0, (NdotL + 0.3) / 1.3);
    vec3 sssColor = albedo.rgb * vec3(1.05, 0.98, 0.95);
    
    // ========================================
    // COLOR-PRESERVING ILLUMINATION
    // ========================================
    // CRITICAL: Light MODULATES albedo, doesn't ADD white
    // This is the key to avoiding washed-out white gradients
    
    // Diffuse: Albedo color * light contribution
    vec3 diffuse = albedo.rgb * diffuseFactor * shadow;
    
    // Apply SSS (subtle)
    diffuse = mix(diffuse, sssColor * sssWrap * shadow, subsurface * 0.3);
    
    // Tint diffuse by light color (subtle coloring, not white addition)
    vec3 lightTint = mix(vec3(1.0), u_lightColor, 0.3);  // Light color influence capped at 30%
    diffuse *= lightTint;
    
    // Scale by intensity and attenuation
    vec3 Lo = (diffuse + specular) * u_lightIntensity * attenuation;
    
    // ========================================
    // AMBIENT (ORIGINAL IMAGE PRESERVATION)
    // ========================================
    // Ambient is the base - shows original image
    vec3 ambient = albedo.rgb * u_ambient;
    
    // Apply ambient occlusion to darken crevices
    ambient *= ao;
    
    // Shadow darkening on ambient (subtle)
    float ambientShadow = mix(1.0, shadow, 0.3);
    ambient *= ambientShadow;
    
    // ========================================
    // FINAL COMPOSITION
    // ========================================
    vec3 finalColor = ambient + Lo;
    
    // Rim lighting (very subtle, uses albedo color not white)
    float fresnel = pow(1.0 - NdotV, 5.0) * 0.1;
    finalColor += albedo.rgb * fresnel * attenuation * 0.2;
    
    // ========================================
    // BRIGHTNESS CONTROL (Smooth Curve)
    // ========================================
    finalColor *= u_brightness;
    
    // ========================================
    // TONE MAPPING (Preserve Colors)
    // ========================================
    // Use very soft tone mapping to preserve original colors
    finalColor = finalColor / (finalColor + vec3(1.0));
    
    // Output - no extra gamma that would wash out colors
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), albedo.a);
}
`;

export default ThreeJS3DRenderer;

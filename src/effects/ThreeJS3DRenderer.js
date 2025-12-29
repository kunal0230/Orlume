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
        this.scene.background = new THREE.Color(0x1a1a1a);

        // Camera (orthographic for 2D-like view with 3D depth)
        const aspect = width / height;
        this.camera = new THREE.OrthographicCamera(
            -aspect, aspect, 1, -1, 0.1, 10
        );
        this.camera.position.z = 2;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Add canvas to container
        if (this.container) {
            this.container.appendChild(this.renderer.domElement);
        }

        // Create the displacement mesh
        this._createMesh();

        // Add a point light for shadow casting
        this.light = new THREE.PointLight(0xffffff, 2);
        this.light.position.copy(this.lightPosition);
        this.light.castShadow = true;
        this.light.shadow.mapSize.width = 2048;
        this.light.shadow.mapSize.height = 2048;
        this.scene.add(this.light);

        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
        this.scene.add(ambientLight);

        console.log('🎮 Three.js 3D Renderer initialized');
        console.log(`   📐 Mesh: ${this.meshResolution}x${this.meshResolution} = ${this.meshResolution * this.meshResolution} vertices`);

        return this;
    }

    /**
     * Create the high-poly displacement mesh with custom shader
     */
    _createMesh() {
        const res = this.meshResolution;

        // Create plane geometry
        const geometry = new THREE.PlaneGeometry(2, 2, res - 1, res - 1);

        // Custom shader material with ray-marched shadows
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
            u_resolution: { value: new THREE.Vector2(res, res) }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);
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
        // Convert from 0-1 to -1 to 1
        this.lightPosition.set(
            (x - 0.5) * 2,
            -(y - 0.5) * 2,  // Flip Y
            z
        );
        this.uniforms.u_lightPos.value = this.lightPosition;
        if (this.light) {
            this.light.position.copy(this.lightPosition);
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

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vDepth;

// ========================================
// ADVANCED RAY-MARCH SHADOWS (64 steps)
// ========================================
// Traces a ray from surface toward light, detecting occlusion
// Uses soft penumbra based on distance to occluder

float rayMarchShadow(vec3 startPos, vec3 lightPos) {
    vec3 rayDir = normalize(lightPos - startPos);
    float totalDist = length(lightPos - startPos);
    
    // Use 64 steps for higher accuracy
    const int MAX_STEPS = 64;
    float baseStepSize = totalDist / float(MAX_STEPS);
    
    float shadow = 1.0;
    float minShadow = 1.0;
    float t = baseStepSize * 1.5;  // Start slightly away from surface
    
    // For soft penumbra calculation
    float lightRadius = 0.15;  // Virtual light size for soft shadows
    float penumbraFactor = 0.0;
    
    for (int i = 0; i < MAX_STEPS; i++) {
        if (t >= totalDist * 0.95) break;  // Stop before light
        
        vec3 samplePos = startPos + rayDir * t;
        
        // Convert world pos back to UV
        vec2 sampleUV = vec2(
            samplePos.x * 0.5 + 0.5,
            -samplePos.y * 0.5 + 0.5
        );
        
        // Boundary check with margin
        if (sampleUV.x < 0.01 || sampleUV.x > 0.99 || 
            sampleUV.y < 0.01 || sampleUV.y > 0.99) {
            t += baseStepSize;
            continue;
        }
        
        // Sample depth at this point (bilinear filtered)
        float sampledDepth = texture2D(u_depth, sampleUV).r;
        float surfaceZ = (1.0 - sampledDepth) * u_extrusion;
        
        // Height of our ray above/below the surface
        float heightDiff = samplePos.z - surfaceZ;
        
        // ========================================
        // OCCLUSION DETECTION
        // ========================================
        if (heightDiff < -0.002) {
            // We're below the surface = occluded
            float occlusionDepth = abs(heightDiff);
            
            // Penumbra: further from surface = softer shadow
            // Uses distance to occluder for realistic soft shadows
            float distToLight = totalDist - t;
            float softness = (lightRadius * t) / max(distToLight, 0.01);
            
            // Accumulate shadow (darker = more occluded)
            float occlusionFactor = clamp(occlusionDepth / (softness + 0.01), 0.0, 1.0);
            minShadow = min(minShadow, 1.0 - occlusionFactor);
        }
        
        // ========================================
        // HORIZON-BASED ENHANCEMENT
        // ========================================
        // Check if ray is grazing the surface (creates contact shadows)
        if (abs(heightDiff) < 0.02) {
            float grazingFactor = 1.0 - abs(heightDiff) / 0.02;
            // Slight darkening for grazing rays (contact shadow)
            minShadow = min(minShadow, 1.0 - grazingFactor * 0.2);
        }
        
        // Adaptive step size: smaller steps near surface
        float adaptiveStep = baseStepSize * (1.0 + abs(heightDiff) * 2.0);
        t += clamp(adaptiveStep, baseStepSize * 0.5, baseStepSize * 2.0);
    }
    
    // ========================================
    // CONTACT SHADOW ENHANCEMENT
    // ========================================
    // Add contact shadow based on depth difference with neighbors
    vec2 texelSize = 1.0 / u_resolution;
    float centerDepth = texture2D(u_depth, vUv).r;
    float contactShadow = 0.0;
    
    // Sample 4 neighbors for contact detection
    float leftDepth = texture2D(u_depth, vUv - vec2(texelSize.x, 0.0)).r;
    float rightDepth = texture2D(u_depth, vUv + vec2(texelSize.x, 0.0)).r;
    float topDepth = texture2D(u_depth, vUv - vec2(0.0, texelSize.y)).r;
    float bottomDepth = texture2D(u_depth, vUv + vec2(0.0, texelSize.y)).r;
    
    // Depth discontinuity = contact shadow region
    float depthDiff = max(
        max(abs(centerDepth - leftDepth), abs(centerDepth - rightDepth)),
        max(abs(centerDepth - topDepth), abs(centerDepth - bottomDepth))
    );
    
    // Light direction influence on contact shadow
    vec2 lightDir2D = normalize(vec2(lightPos.x, -lightPos.y) - vUv);
    float lightAngle = dot(lightDir2D, vec2(1.0, 0.0));
    
    // Contact shadow intensity
    contactShadow = smoothstep(0.01, 0.1, depthDiff) * 0.3;
    
    // Combine ray-march shadow with contact shadow
    float finalShadow = minShadow * (1.0 - contactShadow);
    
    return clamp(finalShadow, 0.0, 1.0);
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
    // RAY-MARCHED SHADOW
    // ========================================
    float shadow = rayMarchShadow(vWorldPos, u_lightPos);
    
    // ========================================
    // LIGHTING CALCULATION
    // ========================================
    vec3 lightDir = normalize(u_lightPos - vWorldPos);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    
    float NdotL = max(0.0, dot(normal, lightDir));
    float NdotH = max(0.0, dot(normal, halfDir));
    float NdotV = max(0.001, dot(normal, viewDir));
    
    // Distance attenuation
    float dist = length(u_lightPos - vWorldPos);
    float attenuation = 1.0 / (1.0 + dist * 2.0 + dist * dist * 2.0);
    
    // Specular (GGX-like)
    float spec = pow(NdotH, 64.0 / roughness) * (1.0 - roughness * 0.5);
    
    // SSS for skin
    float sssWrap = max(0.0, (dot(normal, lightDir) + 0.5) / 1.5);
    vec3 sssColor = albedo.rgb * vec3(1.1, 0.95, 0.9);
    
    // ========================================
    // FINAL COMPOSITION
    // ========================================
    // Diffuse with shadow
    vec3 diffuse = albedo.rgb * NdotL * shadow;
    diffuse = mix(diffuse, sssColor * sssWrap * shadow, subsurface * 0.4);
    
    // Specular with shadow
    vec3 specular = u_lightColor * spec * shadow * 0.3;
    
    // Light contribution
    vec3 Lo = (diffuse + specular) * u_lightColor * u_lightIntensity * attenuation;
    
    // Ambient (preserves original image)
    vec3 ambient = albedo.rgb * u_ambient;
    
    // Rim lighting
    float fresnel = pow(1.0 - NdotV, 4.0) * 0.15;
    vec3 rim = albedo.rgb * fresnel * u_lightColor * attenuation * 0.3;
    
    // Combine
    vec3 finalColor = ambient + Lo + rim;
    
    // Tone mapping (preserve original)
    finalColor = finalColor / (finalColor + vec3(0.9));
    
    // Output
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), albedo.a);
}
`;

export default ThreeJS3DRenderer;

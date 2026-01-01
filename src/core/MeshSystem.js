/**
 * MeshSystem.js - 3D Mesh Generation and Viewing
 * 
 * Stage 2 of Relighting 2.0
 * 
 * Features:
 * - Generate 3D mesh from depth map
 * - Quality controls (resolution, displacement, smoothing)
 * - 3D viewer with orbit controls
 * - Depth map preview
 * 
 * Usage:
 *   const mesh = new MeshSystem(container);
 *   mesh.init(width, height);
 *   mesh.uploadDepth(depthCanvas);
 *   mesh.uploadTexture(imageCanvas);
 *   mesh.openViewer();
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export class MeshSystem {
    constructor() {
        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.mesh = null;

        // Textures
        this.depthTexture = null;
        this.albedoTexture = null;
        this.normalTexture = null;

        // Settings
        this.settings = {
            resolution: 128,        // Mesh vertices (64-512) - lower default for speed
            displacement: 0.3,      // Depth extrusion (0-1)
            smoothing: 2,           // Smooth passes (0-5)
            wireframe: false
        };

        // State
        this.isInitialized = false;
        this.isViewerOpen = false;
        this.isInlineMode = false;
        this.animationId = null;
        this.needsRender = true;
        this.isInteracting = false;

        // Viewer modal
        this.viewerModal = null;
        this.viewerContainer = null;

        // Inline mode references
        this.inlineCanvas = null;
        this.raycaster = null;
        this.mouse = new THREE.Vector2();
    }

    /**
     * Initialize the 3D system
     */
    init(width, height) {
        if (this.isInitialized) return;

        this.width = width;
        this.height = height;
        this.aspectRatio = width / height;

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(50, this.aspectRatio, 0.1, 100);
        this.camera.position.set(0, 0, 2);

        // Add ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);

        // Add directional light
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        this.directionalLight.position.set(0.5, 0.5, 1);
        this.scene.add(this.directionalLight);

        // Initialize raycaster for click detection
        this.raycaster = new THREE.Raycaster();

        this.isInitialized = true;
        console.log('✅ MeshSystem initialized');
    }

    /**
     * Create or update the displacement mesh
     */
    _createMesh() {
        // Remove existing mesh
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }

        // Create plane geometry with subdivisions
        const segments = this.settings.resolution;
        const geometry = new THREE.PlaneGeometry(
            this.aspectRatio,  // Width based on aspect ratio
            1,                  // Height = 1
            segments,
            Math.floor(segments / this.aspectRatio)
        );

        // Create shader material for displacement
        const material = new THREE.ShaderMaterial({
            uniforms: {
                u_albedo: { value: this.albedoTexture },
                u_depth: { value: this.depthTexture },
                u_normal: { value: this.normalTexture },
                u_displacement: { value: this.settings.displacement },
                u_lightPos: { value: new THREE.Vector3(0.5, 0.5, 1.0) },
                u_ambient: { value: 0.3 }
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            wireframe: this.settings.wireframe
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
    }

    /**
     * Upload depth map texture
     */
    uploadDepth(canvas) {
        if (this.depthTexture) {
            this.depthTexture.dispose();
        }

        this.depthTexture = new THREE.CanvasTexture(canvas);
        this.depthTexture.minFilter = THREE.LinearFilter;
        this.depthTexture.magFilter = THREE.LinearFilter;

        if (this.mesh) {
            this.mesh.material.uniforms.u_depth.value = this.depthTexture;
        }

        console.log('📐 Depth texture uploaded');
    }

    /**
     * Upload albedo (color) texture
     */
    uploadTexture(canvas) {
        if (this.albedoTexture) {
            this.albedoTexture.dispose();
        }

        this.albedoTexture = new THREE.CanvasTexture(canvas);
        this.albedoTexture.minFilter = THREE.LinearFilter;
        this.albedoTexture.magFilter = THREE.LinearFilter;

        if (this.mesh) {
            this.mesh.material.uniforms.u_albedo.value = this.albedoTexture;
        }

        console.log('🎨 Albedo texture uploaded');
    }

    /**
     * Upload normal map texture
     */
    uploadNormals(canvas) {
        if (this.normalTexture) {
            this.normalTexture.dispose();
        }

        this.normalTexture = new THREE.CanvasTexture(canvas);
        this.normalTexture.minFilter = THREE.LinearFilter;
        this.normalTexture.magFilter = THREE.LinearFilter;

        if (this.mesh) {
            this.mesh.material.uniforms.u_normal.value = this.normalTexture;
        }
    }

    /**
     * Update mesh resolution
     */
    setResolution(value) {
        this.settings.resolution = Math.max(64, Math.min(512, value));
        if (this.isInitialized && this.depthTexture) {
            this._createMesh();
        }
    }

    /**
     * Update displacement amount
     */
    setDisplacement(value) {
        this.settings.displacement = Math.max(0, Math.min(1, value));
        if (this.mesh) {
            this.mesh.material.uniforms.u_displacement.value = this.settings.displacement;
        }
    }

    /**
     * Toggle wireframe mode
     */
    setWireframe(enabled) {
        this.settings.wireframe = enabled;
        if (this.mesh) {
            this.mesh.material.wireframe = enabled;
        }
    }

    /**
     * Set light position (normalized 0-1)
     */
    setLightPosition(x, y, z = 0.8) {
        if (this.mesh) {
            // Convert to 3D coords (-1 to 1 range)
            const lx = (x - 0.5) * 2;
            const ly = (0.5 - y) * 2;  // Flip Y
            this.mesh.material.uniforms.u_lightPos.value.set(lx, ly, z);
        }

        if (this.directionalLight) {
            this.directionalLight.position.set(x - 0.5, 0.5 - y, 0.8);
        }
    }

    /**
     * Build mesh from current depth
     */
    buildMesh() {
        if (!this.depthTexture) {
            console.warn('No depth map - cannot build mesh');
            return false;
        }

        this._createMesh();
        this.needsRender = true;
        console.log(`🏗️ Mesh built (${this.settings.resolution} segments)`);
        return true;
    }

    /**
     * Setup inline rendering to an external canvas
     */
    setupInlineRenderer(canvas) {
        if (!this.isInitialized) {
            console.warn('MeshSystem not initialized');
            return false;
        }

        this.inlineCanvas = canvas;
        this.isInlineMode = true;

        // Create renderer with optimizations
        if (this.renderer) {
            this.renderer.dispose();
        }

        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
        });

        // Limit pixel ratio for performance
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(canvas.width, canvas.height, false);

        // Setup camera aspect ratio
        this.camera.aspect = canvas.width / canvas.height;
        this.camera.updateProjectionMatrix();

        console.log('✅ Inline renderer setup');
        return true;
    }

    /**
     * Setup orbit controls for inline canvas
     */
    setupControls(canvas) {
        if (this.controls) {
            this.controls.dispose();
        }

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.rotateSpeed = 0.5;
        this.controls.zoomSpeed = 0.8;
        this.controls.panSpeed = 0.8;
        this.controls.enablePan = true; // Enable panning for centering
        this.controls.minDistance = 0.3;
        this.controls.maxDistance = 5;
        this.controls.screenSpacePanning = true; // Pan in screen space

        // Track interaction for adaptive quality
        this.controls.addEventListener('start', () => {
            this.isInteracting = true;
        });

        this.controls.addEventListener('end', () => {
            this.isInteracting = false;
            this.needsRender = true;
        });

        this.controls.addEventListener('change', () => {
            this.needsRender = true;
        });

        // Auto-fit camera to mesh based on aspect ratio
        const distance = Math.max(1.2, 1.0 / Math.min(this.aspectRatio, 1));
        this.camera.position.set(0, 0, distance);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        return this.controls;
    }

    /**
     * Resize inline renderer
     */
    setSize(width, height) {
        if (!this.renderer || !this.isInlineMode) return;

        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.needsRender = true;
    }

    /**
     * Raycast to get UV coordinates from click
     * @returns {Object|null} { x, y } in 0-1 range or null
     */
    raycastClick(clientX, clientY, canvasRect) {
        if (!this.mesh || !this.camera) return null;

        // Calculate normalized device coordinates
        this.mouse.x = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        this.mouse.y = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.mesh);

        if (intersects.length > 0) {
            const uv = intersects[0].uv;
            return { x: uv.x, y: uv.y };
        }

        return null;
    }

    /**
     * Render single frame (render-on-demand)
     */
    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;

        if (this.controls) {
            this.controls.update();
        }

        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
    }

    /**
     * Start animation loop for inline mode
     */
    startAnimation() {
        if (this.animationId) return;

        const animate = () => {
            this.animationId = requestAnimationFrame(animate);

            if (this.controls) {
                this.controls.update();
            }

            // Render on demand or during interaction
            if (this.needsRender || this.isInteracting) {
                if (this.renderer && this.scene && this.camera) {
                    this.renderer.render(this.scene, this.camera);
                }
                this.needsRender = false;
            }
        };

        animate();
        console.log('🎬 Animation started');
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
     * Dispose inline mode resources
     */
    disposeInline() {
        this.stopAnimation();

        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        if (this.renderer && this.isInlineMode) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.isInlineMode = false;
        this.inlineCanvas = null;
        console.log('🗑️ Inline mode disposed');
    }

    /**
     * Open the 3D viewer modal
     */
    openViewer() {
        if (this.isViewerOpen) return;

        // Create modal
        this._createViewerModal();

        // Create renderer for modal
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(this.viewerContainer.clientWidth, this.viewerContainer.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.viewerContainer.appendChild(this.renderer.domElement);

        // Add orbit controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 0.5;
        this.controls.zoomSpeed = 0.8;

        // Reset camera
        this.camera.position.set(0, 0, 2);
        this.camera.lookAt(0, 0, 0);

        // Build mesh if needed
        if (!this.mesh) {
            this.buildMesh();
        }

        // Start animation
        this.isViewerOpen = true;
        this._animate();

        console.log('🔮 3D Viewer opened');
    }

    /**
     * Create viewer modal UI
     */
    _createViewerModal() {
        // Create modal overlay
        this.viewerModal = document.createElement('div');
        this.viewerModal.id = 'mesh-viewer-modal';
        this.viewerModal.innerHTML = `
            <div class="mesh-viewer-content">
                <div class="mesh-viewer-header">
                    <h3>🔮 3D Model Viewer</h3>
                    <button class="mesh-viewer-close" id="mesh-viewer-close">✕</button>
                </div>
                <div class="mesh-viewer-canvas" id="mesh-viewer-canvas"></div>
                <div class="mesh-viewer-controls">
                    <div class="mesh-control-group">
                        <label>Wireframe</label>
                        <input type="checkbox" id="mesh-wireframe" ${this.settings.wireframe ? 'checked' : ''}>
                    </div>
                    <div class="mesh-control-group">
                        <label>Displacement</label>
                        <input type="range" id="mesh-displacement" min="0" max="100" value="${this.settings.displacement * 100}">
                    </div>
                    <div class="mesh-control-group">
                        <label>Resolution</label>
                        <select id="mesh-resolution">
                            <option value="64" ${this.settings.resolution === 64 ? 'selected' : ''}>64 (Fast)</option>
                            <option value="128" ${this.settings.resolution === 128 ? 'selected' : ''}>128</option>
                            <option value="256" ${this.settings.resolution === 256 ? 'selected' : ''}>256 (Default)</option>
                            <option value="512" ${this.settings.resolution === 512 ? 'selected' : ''}>512 (High)</option>
                        </select>
                    </div>
                </div>
                <div class="mesh-viewer-hint">
                    🖱️ Drag to rotate • Scroll to zoom • Right-drag to pan
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #mesh-viewer-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.9);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .mesh-viewer-content {
                background: var(--surface, #1a1a2e);
                border-radius: 12px;
                width: 90vw;
                max-width: 1200px;
                height: 80vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .mesh-viewer-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border, #333);
            }
            .mesh-viewer-header h3 {
                margin: 0;
                color: white;
            }
            .mesh-viewer-close {
                background: none;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                opacity: 0.7;
            }
            .mesh-viewer-close:hover {
                opacity: 1;
            }
            .mesh-viewer-canvas {
                flex: 1;
                background: #0a0a1a;
            }
            .mesh-viewer-controls {
                display: flex;
                gap: 24px;
                padding: 16px 20px;
                border-top: 1px solid var(--border, #333);
                background: var(--surface, #1a1a2e);
            }
            .mesh-control-group {
                display: flex;
                align-items: center;
                gap: 8px;
                color: white;
            }
            .mesh-control-group input[type="range"] {
                width: 100px;
            }
            .mesh-control-group select {
                background: var(--bg, #0a0a1a);
                color: white;
                border: 1px solid var(--border, #333);
                padding: 4px 8px;
                border-radius: 4px;
            }
            .mesh-viewer-hint {
                text-align: center;
                padding: 8px;
                color: rgba(255,255,255,0.5);
                font-size: 12px;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(this.viewerModal);

        this.viewerContainer = document.getElementById('mesh-viewer-canvas');

        // Wire up controls
        document.getElementById('mesh-viewer-close').onclick = () => this.closeViewer();
        document.getElementById('mesh-wireframe').onchange = (e) => this.setWireframe(e.target.checked);
        document.getElementById('mesh-displacement').oninput = (e) => this.setDisplacement(e.target.value / 100);
        document.getElementById('mesh-resolution').onchange = (e) => {
            this.setResolution(parseInt(e.target.value));
        };

        // Close on escape
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.closeViewer();
        };
        document.addEventListener('keydown', this._escHandler);
    }

    /**
     * Close the viewer modal
     */
    closeViewer() {
        if (!this.isViewerOpen) return;

        // Stop animation
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        // Dispose controls
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        // Remove modal
        if (this.viewerModal) {
            this.viewerModal.remove();
            this.viewerModal = null;
            this.viewerContainer = null;
        }

        // Remove event listener
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
        }

        this.isViewerOpen = false;
        console.log('🔮 3D Viewer closed');
    }

    /**
     * Animation loop
     */
    _animate() {
        if (!this.isViewerOpen) return;

        this.animationId = requestAnimationFrame(() => this._animate());

        if (this.controls) {
            this.controls.update();
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Render single frame (for export)
     */
    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Get rendered image as data URL
     */
    getImageDataURL() {
        if (!this.renderer) return null;
        this.render();
        return this.renderer.domElement.toDataURL('image/png');
    }

    /**
     * Export the 3D mesh as GLB file with baked displacement
     * @param {string} filename - Name for the exported file (without extension)
     * @param {HTMLCanvasElement} litCanvas - Optional canvas with baked lighting to use as texture
     */
    exportGLB(filename = 'orlume-3d-model', litCanvas = null) {
        if (!this.mesh || !this.depthTexture) {
            console.warn('No mesh or depth map to export');
            return Promise.reject(new Error('No mesh or depth map to export'));
        }

        return new Promise((resolve, reject) => {
            try {
                // Create a new mesh with baked displacement for export
                const exportMesh = this._createExportMesh(litCanvas);

                const exporter = new GLTFExporter();

                // Export options
                const options = {
                    binary: true,  // Export as GLB (binary GLTF)
                    includeCustomExtensions: false
                };

                exporter.parse(
                    exportMesh,
                    (result) => {
                        // Create blob and trigger download
                        const blob = new Blob([result], { type: 'application/octet-stream' });
                        const url = URL.createObjectURL(blob);

                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `${filename}.glb`;
                        link.style.display = 'none';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);

                        URL.revokeObjectURL(url);

                        // Clean up export mesh
                        exportMesh.geometry.dispose();
                        exportMesh.material.dispose();

                        console.log('✅ 3D model exported as GLB with baked displacement');
                        resolve();
                    },
                    (error) => {
                        console.error('GLB export failed:', error);
                        reject(error);
                    },
                    options
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Create a mesh with baked vertex displacement for export
     * This reads the depth texture and applies displacement to actual vertex positions
     * @param {HTMLCanvasElement} litCanvas - Optional canvas with baked lighting to use as texture
     */
    _createExportMesh(litCanvas = null) {
        // Clone geometry from original mesh
        const originalGeometry = this.mesh.geometry;
        const geometry = originalGeometry.clone();

        // Get position and UV attributes
        const positions = geometry.attributes.position;
        const uvs = geometry.attributes.uv;

        // Read depth texture into a canvas to sample pixel values
        const depthCanvas = document.createElement('canvas');
        const depthImage = this.depthTexture.image;
        depthCanvas.width = depthImage.width;
        depthCanvas.height = depthImage.height;
        const depthCtx = depthCanvas.getContext('2d');
        depthCtx.drawImage(depthImage, 0, 0);
        const depthData = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);

        // Bake displacement into vertex positions
        for (let i = 0; i < positions.count; i++) {
            const u = uvs.getX(i);
            const v = uvs.getY(i);

            // Sample depth at UV coordinates
            const px = Math.floor(u * (depthCanvas.width - 1));
            const py = Math.floor((1 - v) * (depthCanvas.height - 1)); // Flip V
            const idx = (py * depthCanvas.width + px) * 4;
            const depth = depthData.data[idx] / 255; // Normalize to 0-1

            // Apply displacement to Z coordinate
            const currentZ = positions.getZ(i);
            positions.setZ(i, currentZ + depth * this.settings.displacement);
        }

        positions.needsUpdate = true;

        // Recompute normals for proper lighting in external viewers
        geometry.computeVertexNormals();

        // Create material with texture (use lit canvas if provided, otherwise albedo)
        let material;
        if (litCanvas) {
            // Use the baked lit canvas as texture
            const litTexture = new THREE.CanvasTexture(litCanvas);
            litTexture.flipY = false; // WebGL textures are flipped
            material = new THREE.MeshBasicMaterial({
                map: litTexture
            });
            console.log('Using baked lighting texture for export');
        } else if (this.albedoTexture) {
            material = new THREE.MeshStandardMaterial({
                map: this.albedoTexture.clone(),
                metalness: 0,
                roughness: 0.8
            });
        } else {
            material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                metalness: 0,
                roughness: 0.8
            });
        }

        return new THREE.Mesh(geometry, material);
    }

    /**
     * Export the 3D mesh as OBJ file (simpler format)
     * @param {string} filename - Name for the exported file (without extension)
     */
    exportOBJ(filename = 'orlume-3d-model') {
        if (!this.mesh) {
            console.warn('No mesh to export');
            return;
        }

        const geometry = this.mesh.geometry;
        const position = geometry.attributes.position;
        const uv = geometry.attributes.uv;
        const index = geometry.index;

        let objContent = '# Orlume 3D Model Export\n';
        objContent += `# Vertices: ${position.count}\n\n`;

        // Vertices
        for (let i = 0; i < position.count; i++) {
            objContent += `v ${position.getX(i).toFixed(6)} ${position.getY(i).toFixed(6)} ${position.getZ(i).toFixed(6)}\n`;
        }

        objContent += '\n';

        // UVs
        if (uv) {
            for (let i = 0; i < uv.count; i++) {
                objContent += `vt ${uv.getX(i).toFixed(6)} ${uv.getY(i).toFixed(6)}\n`;
            }
            objContent += '\n';
        }

        // Faces
        if (index) {
            for (let i = 0; i < index.count; i += 3) {
                const a = index.getX(i) + 1;
                const b = index.getX(i + 1) + 1;
                const c = index.getX(i + 2) + 1;
                if (uv) {
                    objContent += `f ${a}/${a} ${b}/${b} ${c}/${c}\n`;
                } else {
                    objContent += `f ${a} ${b} ${c}\n`;
                }
            }
        }

        // Download
        const blob = new Blob([objContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `${filename}.obj`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
        console.log('✅ 3D model exported as OBJ');
    }

    /**
     * Dispose all resources
     */
    dispose() {
        this.closeViewer();

        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.scene.remove(this.mesh);
            this.mesh = null;
        }

        if (this.depthTexture) {
            this.depthTexture.dispose();
            this.depthTexture = null;
        }

        if (this.albedoTexture) {
            this.albedoTexture.dispose();
            this.albedoTexture = null;
        }

        if (this.normalTexture) {
            this.normalTexture.dispose();
            this.normalTexture = null;
        }

        if (this.scene) {
            this.scene = null;
        }

        this.isInitialized = false;
    }
}

// ============================================
// VERTEX SHADER - Displacement from depth
// ============================================
const VERTEX_SHADER = `
precision highp float;

uniform sampler2D u_depth;
uniform float u_displacement;

varying vec2 vUv;
varying vec3 vNormal;
varying float vDepth;

void main() {
    vUv = uv;
    
    // Sample depth
    float depth = texture2D(u_depth, uv).r;
    vDepth = depth;
    
    // Displace along Z
    vec3 displaced = position;
    displaced.z += depth * u_displacement;
    
    // Pass normal
    vNormal = normalMatrix * normal;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

// ============================================
// FRAGMENT SHADER - Lit surface
// ============================================
const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_albedo;
uniform sampler2D u_normal;
uniform vec3 u_lightPos;
uniform float u_ambient;

varying vec2 vUv;
varying vec3 vNormal;
varying float vDepth;

void main() {
    // Sample albedo
    vec4 albedo = texture2D(u_albedo, vUv);
    
    // Simple diffuse lighting
    vec3 lightDir = normalize(u_lightPos);
    float diff = max(dot(normalize(vNormal), lightDir), 0.0);
    
    // Combine ambient + diffuse
    vec3 color = albedo.rgb * (u_ambient + diff * (1.0 - u_ambient));
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// Singleton
export const meshSystem = new MeshSystem();

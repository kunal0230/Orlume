/**
 * Scene Manager
 * Handles Three.js 3D rendering with depth-displaced mesh
 */

import * as THREE from 'three';

export class SceneManager {
    constructor(app) {
        this.app = app;
        this.canvas = document.getElementById('three-canvas');

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.mesh = null;

        this.enabled = false;
        this.depthScale = 1.0;
        this.meshQuality = 'medium';

        this.animationId = null;
    }

    async init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x12121a);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            50,
            this.canvas.clientWidth / this.canvas.clientHeight,
            0.1,
            1000
        );
        this.camera.position.z = 2;

        // Try WebGPU renderer first
        try {
            const WebGPURenderer = (await import('three/webgpu')).default;
            this.renderer = new WebGPURenderer({
                canvas: this.canvas,
                antialias: true,
                alpha: true,
            });
        } catch (e) {
            // Fallback to WebGL
            console.log('Falling back to WebGL renderer');
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true,
                alpha: true,
            });
        }

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.updateSize();

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(1, 1, 2);
        this.scene.add(directionalLight);

        // Add orbit controls
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxDistance = 5;
        this.controls.minDistance = 0.5;

        // Handle resize
        window.addEventListener('resize', () => this.updateSize());

        return this;
    }

    updateSize() {
        if (!this.renderer) return;

        const container = document.querySelector('.canvas-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    async enable() {
        if (!this.renderer) {
            await this.init();
        }

        this.enabled = true;
        this.updateSize();
        this.createMesh();
        this.animate();
    }

    disable() {
        this.enabled = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }
    }

    createMesh() {
        const { image, depthMap } = this.app.state;
        if (!image || !depthMap) return;

        // Remove existing mesh
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }

        // Calculate geometry resolution based on quality
        const qualitySettings = {
            low: 64,
            medium: 128,
            high: 256,
        };
        const segments = qualitySettings[this.meshQuality] || 128;

        // Create plane geometry
        const aspect = image.width / image.height;
        const geometry = new THREE.PlaneGeometry(aspect, 1, segments, segments);

        // Displace vertices based on depth
        const positions = geometry.attributes.position;
        const uvs = geometry.attributes.uv;

        for (let i = 0; i < positions.count; i++) {
            const u = uvs.getX(i);
            const v = uvs.getY(i);

            // Sample depth at UV coordinate
            const x = Math.floor(u * (depthMap.width - 1));
            const y = Math.floor((1 - v) * (depthMap.height - 1));
            const idx = (y * depthMap.width + x) * 4;
            const depth = depthMap.data[idx] / 255;

            // Displace Z position
            const displacement = (depth - 0.5) * 0.3 * this.depthScale;
            positions.setZ(i, displacement);
        }

        geometry.computeVertexNormals();

        // Create texture from image
        const texture = new THREE.CanvasTexture(image.canvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        // Create material
        const material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide,
            roughness: 0.8,
            metalness: 0.1,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);

        // Center camera on mesh
        this.resetCamera();
    }

    animate() {
        if (!this.enabled) return;

        this.animationId = requestAnimationFrame(() => this.animate());

        if (this.controls) {
            this.controls.update();
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    setDepthScale(scale) {
        this.depthScale = scale;
        if (this.enabled && this.mesh) {
            this.createMesh();
        }
    }

    setMeshQuality(quality) {
        this.meshQuality = quality;
        if (this.enabled && this.mesh) {
            this.createMesh();
        }
    }

    resetCamera() {
        if (this.camera) {
            this.camera.position.set(0, 0, 2);
            this.camera.lookAt(0, 0, 0);
        }

        if (this.controls) {
            this.controls.reset();
        }
    }
}

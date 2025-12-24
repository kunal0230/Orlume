/**
 * Control Panel Component
 * Manages context-sensitive controls for each tool
 */

export class ControlPanel {
    constructor(app) {
        this.app = app;
        this.init();
    }

    init() {
        // Depth controls
        document.getElementById('btn-estimate-depth').addEventListener('click', () => {
            this.app.estimateDepth();
        });

        document.getElementById('depth-opacity').addEventListener('input', (e) => {
            const opacity = e.target.value / 100;
            this.app.components.canvas.setDepthOpacity(opacity);
        });

        document.getElementById('depth-invert').addEventListener('change', (e) => {
            this.app.components.canvas.setDepthInvert(e.target.checked);
        });

        document.getElementById('depth-colorize').addEventListener('change', (e) => {
            this.app.components.canvas.setDepthColorize(e.target.checked);
        });

        // Relight controls
        document.getElementById('light-intensity').addEventListener('input', (e) => {
            this.app.components.relighting.setIntensity(e.target.value / 100);
        });

        document.getElementById('light-color').addEventListener('input', (e) => {
            this.app.components.relighting.setColor(e.target.value);
        });

        document.getElementById('ambient-intensity').addEventListener('input', (e) => {
            this.app.components.relighting.setAmbient(e.target.value / 100);
        });

        document.getElementById('btn-reset-lights').addEventListener('click', () => {
            this.app.components.relighting.resetLights();
        });

        // 3D View controls
        document.getElementById('depth-scale').addEventListener('input', (e) => {
            this.app.components.scene.setDepthScale(e.target.value / 100);
        });

        document.getElementById('mesh-quality').addEventListener('change', (e) => {
            this.app.components.scene.setMeshQuality(e.target.value);
        });

        document.getElementById('btn-reset-camera').addEventListener('click', () => {
            this.app.components.scene.resetCamera();
        });

        // Parallax controls
        document.getElementById('parallax-strength').addEventListener('input', (e) => {
            this.app.components.parallax.setStrength(e.target.value / 100);
        });

        document.getElementById('parallax-layers').addEventListener('input', (e) => {
            this.app.components.parallax.setLayers(parseInt(e.target.value));
        });

        // Zoom controls
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.app.components.canvas.zoom(1.25);
        });

        document.getElementById('zoom-out').addEventListener('click', () => {
            this.app.components.canvas.zoom(0.8);
        });

        document.getElementById('zoom-fit').addEventListener('click', () => {
            this.app.components.canvas.fitToView();
        });
    }
}

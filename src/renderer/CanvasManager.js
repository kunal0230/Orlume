/**
 * Canvas Manager
 * Handles 2D canvas rendering for image and depth visualization
 */

export class CanvasManager {
    constructor(app) {
        this.app = app;
        this.mainCanvas = document.getElementById('main-canvas');
        this.depthCanvas = document.getElementById('depth-canvas');
        this.mainCtx = this.mainCanvas.getContext('2d');
        this.depthCtx = this.depthCanvas.getContext('2d');

        this.zoomLevel = 1;
        this.pan = { x: 0, y: 0 };

        this.depthOpacity = 0.5;
        this.depthInvert = false;
        this.depthColorize = false;

        this.image = null;
        this.depthMap = null;
        this.originalDepthData = null;

        this.init();
    }

    init() {
        // Handle resize
        window.addEventListener('resize', () => this.updateCanvasSize());
    }

    updateCanvasSize() {
        if (!this.image) return;

        const container = document.querySelector('.canvas-container');
        const containerRect = container.getBoundingClientRect();

        // Calculate fit dimensions
        const scale = Math.min(
            (containerRect.width - 80) / this.image.width,
            (containerRect.height - 80) / this.image.height,
            1
        );

        const displayWidth = Math.floor(this.image.width * scale * this.zoomLevel);
        const displayHeight = Math.floor(this.image.height * scale * this.zoomLevel);

        // Update canvases
        this.mainCanvas.width = this.image.width;
        this.mainCanvas.height = this.image.height;
        this.mainCanvas.style.width = `${displayWidth}px`;
        this.mainCanvas.style.height = `${displayHeight}px`;

        this.depthCanvas.width = this.image.width;
        this.depthCanvas.height = this.image.height;
        this.depthCanvas.style.width = `${displayWidth}px`;
        this.depthCanvas.style.height = `${displayHeight}px`;

        // Redraw
        this.render();
    }

    requestRender() {
        requestAnimationFrame(() => this.render());
    }

    setImage(image) {
        this.image = image;
        this.updateCanvasSize();
        this.render();
    }

    setDepthMap(depthMap) {
        this.depthMap = depthMap;
        this.originalDepthData = depthMap.data.slice();
        this.renderDepth();
        // Visibility is now controlled by main.js via setDepthVisible
    }

    render() {
        if (!this.image) return;

        // Clear canvas
        this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);

        // Save context
        this.mainCtx.save();

        // Apply Transform Tool Visuals (Rotation/Flip)
        const transformTool = this.app.components.transformTool;
        if (transformTool && transformTool.active) {
            // Apply visual rotation/flip to the image drawing
            // We rotate around the center of the image
            const cx = this.mainCanvas.width / 2;
            const cy = this.mainCanvas.height / 2;

            this.mainCtx.translate(cx, cy);
            this.mainCtx.rotate(transformTool.rotation * Math.PI / 180);
            this.mainCtx.scale(transformTool.flipX ? -1 : 1, transformTool.flipY ? -1 : 1);
            this.mainCtx.translate(-cx, -cy);
        }

        // Draw main image
        this.mainCtx.drawImage(this.image.canvas, 0, 0);

        // Restore context (remove coordinate transforms for overlay)
        this.mainCtx.restore();

        // Apply any active effects
        if (this.depthMap) {
            this.renderDepth();
        }

        // Draw Transform Overlay (Handles, Crop Box)
        if (transformTool && transformTool.active) {
            // Pass scale=1 because context is 1:1 with image pixels
            transformTool.render(this.mainCtx, 1, 0, 0);
        }
    }

    renderDepth() {
        if (!this.depthMap || !this.originalDepthData) return;

        const { width, height } = this.depthMap;
        const imageData = new ImageData(width, height);
        const data = imageData.data;
        const depthData = this.originalDepthData;

        for (let i = 0; i < depthData.length; i += 4) {
            let depth = depthData[i];

            // Invert if needed
            if (this.depthInvert) {
                depth = 255 - depth;
            }

            if (this.depthColorize) {
                // Apply colorful gradient (plasma colormap)
                const { r, g, b } = this.plasmaColormap(depth / 255);
                data[i] = r;
                data[i + 1] = g;
                data[i + 2] = b;
            } else {
                // Grayscale
                data[i] = depth;
                data[i + 1] = depth;
                data[i + 2] = depth;
            }
            data[i + 3] = 255;
        }

        this.depthCtx.putImageData(imageData, 0, 0);
    }

    plasmaColormap(t) {
        // Approximate plasma colormap
        const r = Math.floor(255 * Math.min(1, 0.0416 + t * (1.0 + t * (-0.5 + t * 0.5))));
        const g = Math.floor(255 * Math.min(1, Math.max(0, t * 1.5 - 0.5)));
        const b = Math.floor(255 * Math.min(1, Math.max(0, 0.5 + Math.sin(t * Math.PI) * 0.5)));
        return { r, g, b };
    }

    setDepthOpacity(opacity) {
        this.depthOpacity = opacity;
        this.depthCanvas.style.opacity = opacity;
    }

    setDepthInvert(invert) {
        this.depthInvert = invert;
        this.renderDepth();
    }

    setDepthColorize(colorize) {
        this.depthColorize = colorize;
        this.renderDepth();
    }

    zoom(factor) {
        this.zoomLevel = Math.max(0.25, Math.min(4, this.zoomLevel * factor));
        document.getElementById('zoom-level').textContent = `${Math.round(this.zoomLevel * 100)}%`;
        this.updateCanvasSize();
        this.syncEffectCanvases();
    }

    fitToView() {
        this.zoomLevel = 1;
        document.getElementById('zoom-level').textContent = '100%';
        this.updateCanvasSize();
        this.syncEffectCanvases();
    }

    // Sync all effect canvases with main canvas size
    syncEffectCanvases() {
        const mainCanvas = this.mainCanvas;
        const displayWidth = mainCanvas.style.width;
        const displayHeight = mainCanvas.style.height;

        // Sync relighting canvas
        if (this.app.components.relighting?.enabled && this.app.components.relighting.canvas) {
            this.app.components.relighting.canvas.style.width = displayWidth;
            this.app.components.relighting.canvas.style.height = displayHeight;
        }

        // Sync parallax canvas if active
        if (this.app.components.parallax?.enabled && this.app.components.parallax.canvas) {
            this.app.components.parallax.canvas.style.width = displayWidth;
            this.app.components.parallax.canvas.style.height = displayHeight;
        }
    }

    clear() {
        this.image = null;
        this.depthMap = null;
        this.originalDepthData = null;
        this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
        this.depthCtx.clearRect(0, 0, this.depthCanvas.width, this.depthCanvas.height);
        this.depthCanvas.classList.remove('visible');
    }

    clearDepth() {
        this.depthMap = null;
        this.originalDepthData = null;
        this.depthCtx.clearRect(0, 0, this.depthCanvas.width, this.depthCanvas.height);
        this.depthCanvas.classList.remove('visible');
    }

    // Get image data for effects processing
    getImageData() {
        return this.mainCtx.getImageData(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    }

    // Get depth data for effects processing
    getDepthData() {
        return this.depthMap;
    }

    setDepthVisible(visible) {
        this.depthCanvas.style.display = visible ? 'block' : 'none';
        if (visible) {
            this.depthCanvas.classList.add('visible');
            this.depthCanvas.style.opacity = this.depthOpacity;
        } else {
            this.depthCanvas.classList.remove('visible');
        }
    }
}

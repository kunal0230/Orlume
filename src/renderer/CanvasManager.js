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

        this.zoom = 1;
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

        const displayWidth = Math.floor(this.image.width * scale * this.zoom);
        const displayHeight = Math.floor(this.image.height * scale * this.zoom);

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

    setImage(image) {
        this.image = image;
        this.updateCanvasSize();
        this.render();
    }

    setDepthMap(depthMap) {
        this.depthMap = depthMap;
        this.originalDepthData = depthMap.data.slice();
        this.renderDepth();
        this.depthCanvas.classList.add('visible');
        document.getElementById('depth-canvas').style.opacity = this.depthOpacity;
    }

    render() {
        if (!this.image) return;

        // Draw main image
        this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
        this.mainCtx.drawImage(this.image.canvas, 0, 0);

        // Apply any active effects
        if (this.depthMap) {
            this.renderDepth();
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
        this.zoom = Math.max(0.25, Math.min(4, this.zoom * factor));
        document.getElementById('zoom-level').textContent = `${Math.round(this.zoom * 100)}%`;
        this.updateCanvasSize();
    }

    fitToView() {
        this.zoom = 1;
        document.getElementById('zoom-level').textContent = '100%';
        this.updateCanvasSize();
    }

    clear() {
        this.image = null;
        this.depthMap = null;
        this.originalDepthData = null;
        this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
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
}

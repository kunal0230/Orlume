/**
 * Parallax Effect
 * Creates depth-based parallax motion on mouse movement
 */

export class ParallaxEffect {
    constructor(app) {
        this.app = app;
        this.enabled = false;
        this.strength = 0.5;
        this.numLayers = 5;

        this.layers = [];
        this.container = null;
        this.mouseX = 0;
        this.mouseY = 0;

        this.onMouseMove = this.onMouseMove.bind(this);
        this.animate = this.animate.bind(this);
    }

    enable() {
        if (this.enabled) return;

        const { depthMap, image } = this.app.state;
        if (!depthMap || !image) return;

        this.enabled = true;
        this.createLayers();

        document.addEventListener('mousemove', this.onMouseMove);
        this.animationId = requestAnimationFrame(this.animate);
    }

    disable() {
        this.enabled = false;
        document.removeEventListener('mousemove', this.onMouseMove);

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Remove layer elements
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        this.layers = [];
    }

    createLayers() {
        const { depthMap, image } = this.app.state;
        const canvasContainer = document.querySelector('.editor-canvas');
        const mainCanvas = document.getElementById('main-canvas');

        // Hide main canvas during parallax
        mainCanvas.style.opacity = '0';

        // Create container for layers
        this.container = document.createElement('div');
        this.container.className = 'parallax-container';
        this.container.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${mainCanvas.style.width};
      height: ${mainCanvas.style.height};
      perspective: 1000px;
      transform-style: preserve-3d;
    `;

        canvasContainer.appendChild(this.container);

        // Create depth layers
        for (let i = 0; i < this.numLayers; i++) {
            const layer = this.createLayer(i, image, depthMap);
            this.layers.push(layer);
            this.container.appendChild(layer.element);
        }
    }

    createLayer(index, image, depthMap) {
        const { width, height } = image;

        // Create canvas for this layer
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Draw image with depth-based masking
        ctx.drawImage(image.canvas, 0, 0);

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        // Determine depth range for this layer
        const layerMin = index / this.numLayers;
        const layerMax = (index + 1) / this.numLayers;
        const feather = 0.1;

        for (let i = 0; i < pixels.length; i += 4) {
            const pixelIndex = i / 4;
            const x = pixelIndex % width;
            const y = Math.floor(pixelIndex / width);

            const depthIdx = (y * width + x) * 4;
            const depth = depthMap.data[depthIdx] / 255;

            // Calculate alpha based on depth range
            let alpha = 0;
            if (depth >= layerMin && depth < layerMax) {
                alpha = 1;
            } else if (depth < layerMin && depth >= layerMin - feather) {
                alpha = (depth - (layerMin - feather)) / feather;
            } else if (depth >= layerMax && depth < layerMax + feather) {
                alpha = 1 - (depth - layerMax) / feather;
            }

            pixels[i + 3] = Math.floor(alpha * pixels[i + 3]);
        }

        ctx.putImageData(imageData, 0, 0);

        // Style the canvas
        canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      will-change: transform;
      pointer-events: none;
    `;

        return {
            element: canvas,
            depth: (layerMin + layerMax) / 2,
            currentX: 0,
            currentY: 0,
            targetX: 0,
            targetY: 0,
        };
    }

    onMouseMove(e) {
        const rect = this.container?.getBoundingClientRect();
        if (!rect) return;

        // Normalize mouse position to -1 to 1
        this.mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        this.mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    }

    animate() {
        if (!this.enabled) return;

        this.animationId = requestAnimationFrame(this.animate);

        const maxOffset = 30 * this.strength;

        for (const layer of this.layers) {
            // Calculate target offset based on depth (further = more movement)
            const depthFactor = (1 - layer.depth) * 2 - 1; // Invert so background moves more
            layer.targetX = this.mouseX * maxOffset * depthFactor;
            layer.targetY = this.mouseY * maxOffset * depthFactor;

            // Smooth interpolation
            layer.currentX += (layer.targetX - layer.currentX) * 0.1;
            layer.currentY += (layer.targetY - layer.currentY) * 0.1;

            // Apply transform
            layer.element.style.transform = `translate(${layer.currentX}px, ${layer.currentY}px)`;
        }
    }

    setStrength(strength) {
        this.strength = strength;
    }

    setLayers(numLayers) {
        if (numLayers === this.numLayers) return;

        this.numLayers = numLayers;

        if (this.enabled) {
            this.disable();
            this.enable();
        }
    }
}

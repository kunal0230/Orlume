/**
 * HealingTool - Spot healing brush for removing blemishes and objects
 * 
 * Features:
 * - Paint mask over areas to heal
 * - Send to LaMa API for inpainting
 * - Apply healed result to canvas
 */

export class HealingTool {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Mask canvas for drawing the healing area
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');

        // Preview canvas to show mask overlay
        this.previewCanvas = document.createElement('canvas');
        this.previewCtx = this.previewCanvas.getContext('2d');

        // Brush settings
        this.brushSize = 30;
        this.brushHardness = 0.8; // 0-1

        // State
        this.isActive = false;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.hasMask = false;

        // Source image
        this.sourceImage = null;
        this.imageWidth = 0;
        this.imageHeight = 0;
    }

    /**
     * Initialize with source image
     */
    setImage(imageOrCanvas) {
        this.sourceImage = imageOrCanvas;
        this.imageWidth = imageOrCanvas.width;
        this.imageHeight = imageOrCanvas.height;

        // Resize mask canvas
        this.maskCanvas.width = this.imageWidth;
        this.maskCanvas.height = this.imageHeight;

        // Clear mask (black = keep, white = heal)
        this.maskCtx.fillStyle = 'black';
        this.maskCtx.fillRect(0, 0, this.imageWidth, this.imageHeight);

        // Resize preview canvas
        this.previewCanvas.width = this.imageWidth;
        this.previewCanvas.height = this.imageHeight;

        this.hasMask = false;
        console.log(`🖌️ Healing tool initialized: ${this.imageWidth}×${this.imageHeight}`);
    }

    /**
     * Set brush size
     */
    setBrushSize(size) {
        this.brushSize = Math.max(5, Math.min(200, size));
    }

    /**
     * Set brush hardness
     */
    setBrushHardness(hardness) {
        this.brushHardness = Math.max(0, Math.min(1, hardness));
    }

    /**
     * Start drawing mask
     */
    onMouseDown(x, y) {
        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;
        this.drawBrushStroke(x, y);
    }

    /**
     * Continue drawing mask
     */
    onMouseMove(x, y) {
        if (!this.isDrawing) return;

        // Draw line from last position to current
        this.drawLine(this.lastX, this.lastY, x, y);

        this.lastX = x;
        this.lastY = y;
    }

    /**
     * Stop drawing mask
     */
    onMouseUp() {
        this.isDrawing = false;
    }

    /**
     * Draw a single brush stroke
     */
    drawBrushStroke(x, y) {
        const radius = this.brushSize / 2;

        // Create radial gradient for soft edges
        const gradient = this.maskCtx.createRadialGradient(x, y, 0, x, y, radius);

        // Hard center, soft edge based on hardness
        const innerRadius = this.brushHardness;
        gradient.addColorStop(0, 'white');
        gradient.addColorStop(innerRadius, 'white');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        this.maskCtx.fillStyle = gradient;
        this.maskCtx.beginPath();
        this.maskCtx.arc(x, y, radius, 0, Math.PI * 2);
        this.maskCtx.fill();

        this.hasMask = true;
    }

    /**
     * Draw line between two points (for smooth strokes)
     */
    drawLine(x1, y1, x2, y2) {
        const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const steps = Math.max(1, Math.floor(dist / (this.brushSize / 4)));

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            this.drawBrushStroke(x, y);
        }
    }

    /**
     * Get preview canvas with mask overlay
     */
    getPreviewCanvas() {
        // Draw source image
        this.previewCtx.drawImage(this.sourceImage, 0, 0);

        // Overlay mask in red with transparency
        this.previewCtx.save();
        this.previewCtx.globalCompositeOperation = 'source-over';
        this.previewCtx.globalAlpha = 0.5;

        // Create red version of mask
        const maskData = this.maskCtx.getImageData(0, 0, this.imageWidth, this.imageHeight);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.imageWidth;
        tempCanvas.height = this.imageHeight;
        const tempCtx = tempCanvas.getContext('2d');
        const tempData = tempCtx.createImageData(this.imageWidth, this.imageHeight);

        for (let i = 0; i < maskData.data.length; i += 4) {
            const maskValue = maskData.data[i]; // R channel (white = 255)
            tempData.data[i] = maskValue;     // R
            tempData.data[i + 1] = 0;         // G
            tempData.data[i + 2] = 0;         // B
            tempData.data[i + 3] = maskValue; // A
        }

        tempCtx.putImageData(tempData, 0, 0);
        this.previewCtx.drawImage(tempCanvas, 0, 0);
        this.previewCtx.restore();

        return this.previewCanvas;
    }

    /**
     * Get the source image as data URL
     */
    getImageDataUrl() {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.imageWidth;
        tempCanvas.height = this.imageHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(this.sourceImage, 0, 0);
        return tempCanvas.toDataURL('image/png');
    }

    /**
     * Get the mask as data URL
     */
    getMaskDataUrl() {
        return this.maskCanvas.toDataURL('image/png');
    }

    /**
     * Check if there's a mask drawn
     */
    hasMaskDrawn() {
        return this.hasMask;
    }

    /**
     * Clear the mask
     */
    clearMask() {
        this.maskCtx.fillStyle = 'black';
        this.maskCtx.fillRect(0, 0, this.imageWidth, this.imageHeight);
        this.hasMask = false;
    }

    /**
     * Reset the tool
     */
    reset() {
        this.clearMask();
        this.isDrawing = false;
    }

    /**
     * Get mask canvas for external access
     */
    getMaskCanvas() {
        return this.maskCanvas;
    }
}

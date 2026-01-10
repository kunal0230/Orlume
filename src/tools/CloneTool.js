/**
 * CloneTool - Native clone stamp tool for copying pixels from source to destination
 * 
 * Features:
 * - Alt+Click to set source sampling point
 * - Click+Drag to paint cloned pixels
 * - Aligned mode (source follows brush offset)
 * - Brush size, hardness, opacity controls
 * - Real-time preview with crosshair indicator
 */

export class CloneTool {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Working canvas for clone operations
        this.workCanvas = document.createElement('canvas');
        this.workCtx = this.workCanvas.getContext('2d');

        // Preview canvas for overlay
        this.previewCanvas = document.createElement('canvas');
        this.previewCtx = this.previewCanvas.getContext('2d');

        // Brush settings
        this.brushSize = 50;
        this.brushHardness = 0.8;  // 0-1
        this.brushOpacity = 1.0;   // 0-1
        this.aligned = true;       // Maintain source-dest offset

        // Source point
        this.sourceSet = false;
        this.sourceX = 0;
        this.sourceY = 0;

        // Initial offset (set on first clone stroke)
        this.offsetX = 0;
        this.offsetY = 0;
        this.offsetSet = false;

        // State
        this.isActive = false;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;

        // Source image data
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

        // Setup working canvas
        this.workCanvas.width = this.imageWidth;
        this.workCanvas.height = this.imageHeight;
        this.workCtx.drawImage(imageOrCanvas, 0, 0);

        // Setup preview canvas
        this.previewCanvas.width = this.imageWidth;
        this.previewCanvas.height = this.imageHeight;

        // Reset state
        this.sourceSet = false;
        this.offsetSet = false;

    }

    /**
     * Set brush size
     */
    setBrushSize(size) {
        this.brushSize = Math.max(5, Math.min(500, size));
    }

    /**
     * Set brush hardness
     */
    setBrushHardness(hardness) {
        this.brushHardness = Math.max(0, Math.min(1, hardness));
    }

    /**
     * Set brush opacity
     */
    setBrushOpacity(opacity) {
        this.brushOpacity = Math.max(0, Math.min(1, opacity));
    }

    /**
     * Set aligned mode
     */
    setAligned(aligned) {
        this.aligned = aligned;
        if (!aligned) {
            // Reset offset when switching to non-aligned
            this.offsetSet = false;
        }
    }

    /**
     * Set source point (Alt+Click)
     */
    setSource(x, y) {
        this.sourceX = x;
        this.sourceY = y;
        this.sourceSet = true;
        this.offsetSet = false;  // Reset offset for new source
    }

    /**
     * Check if source is set
     */
    hasSource() {
        return this.sourceSet;
    }

    /**
     * Get current source position (for drawing indicator)
     */
    getSourcePosition() {
        if (!this.sourceSet) return null;

        if (this.offsetSet) {
            // Return the dynamic source position based on last mouse position
            return {
                x: this.lastX + this.offsetX,
                y: this.lastY + this.offsetY
            };
        }

        return { x: this.sourceX, y: this.sourceY };
    }

    /**
     * Start cloning
     */
    onMouseDown(x, y) {
        if (!this.sourceSet) {
            console.warn('⚠️ Clone source not set. Alt+Click to set source.');
            return;
        }

        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;

        // Calculate offset on first stroke
        if (this.aligned && !this.offsetSet) {
            this.offsetX = this.sourceX - x;
            this.offsetY = this.sourceY - y;
            this.offsetSet = true;
        }

        this.cloneBrushStroke(x, y);
    }

    /**
     * Continue cloning
     */
    onMouseMove(x, y) {
        if (!this.isDrawing) return;

        // Draw line from last position to current for smooth strokes
        this.cloneLine(this.lastX, this.lastY, x, y);

        this.lastX = x;
        this.lastY = y;
    }

    /**
     * Stop cloning
     */
    onMouseUp() {
        this.isDrawing = false;

        // In non-aligned mode, don't reset offset between strokes
        // In aligned mode, offset persists
    }

    /**
     * Clone a single brush stroke at position
     */
    cloneBrushStroke(destX, destY) {
        // Calculate source position
        let srcX, srcY;
        if (this.aligned && this.offsetSet) {
            srcX = destX + this.offsetX;
            srcY = destY + this.offsetY;
        } else {
            srcX = this.sourceX + (destX - this.lastX);
            srcY = this.sourceY + (destY - this.lastY);
        }

        const radius = this.brushSize / 2;

        // Create a temporary canvas for the brush stroke
        const brushCanvas = document.createElement('canvas');
        brushCanvas.width = this.brushSize;
        brushCanvas.height = this.brushSize;
        const brushCtx = brushCanvas.getContext('2d');

        // Calculate source region bounds
        const srcLeft = Math.max(0, srcX - radius);
        const srcTop = Math.max(0, srcY - radius);
        const srcRight = Math.min(this.imageWidth, srcX + radius);
        const srcBottom = Math.min(this.imageHeight, srcY + radius);

        // Sample from source image (original, not work canvas)
        const sampleX = srcLeft;
        const sampleY = srcTop;
        const sampleW = srcRight - srcLeft;
        const sampleH = srcBottom - srcTop;

        if (sampleW <= 0 || sampleH <= 0) return;

        // Draw sampled pixels to brush canvas
        brushCtx.drawImage(
            this.sourceImage,
            sampleX, sampleY, sampleW, sampleH,
            srcLeft - (srcX - radius), srcTop - (srcY - radius), sampleW, sampleH
        );

        // Create circular mask with soft edges
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = this.brushSize;
        maskCanvas.height = this.brushSize;
        const maskCtx = maskCanvas.getContext('2d');

        // Create radial gradient for soft brush
        const gradient = maskCtx.createRadialGradient(
            radius, radius, 0,
            radius, radius, radius
        );
        const innerRadius = this.brushHardness;
        gradient.addColorStop(0, 'white');
        gradient.addColorStop(innerRadius, 'white');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        maskCtx.fillStyle = gradient;
        maskCtx.fillRect(0, 0, this.brushSize, this.brushSize);

        // Apply mask to brush canvas
        brushCtx.globalCompositeOperation = 'destination-in';
        brushCtx.drawImage(maskCanvas, 0, 0);

        // Draw to work canvas with opacity
        this.workCtx.globalAlpha = this.brushOpacity;
        this.workCtx.drawImage(
            brushCanvas,
            destX - radius,
            destY - radius
        );
        this.workCtx.globalAlpha = 1.0;
    }

    /**
     * Clone along a line between two points (smooth strokes)
     */
    cloneLine(x1, y1, x2, y2) {
        const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const steps = Math.max(1, Math.floor(dist / (this.brushSize / 4)));

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            this.cloneBrushStroke(x, y);
        }
    }

    /**
     * Get preview canvas with source indicator overlay
     */
    getPreviewCanvas() {
        // Draw current work state
        this.previewCtx.drawImage(this.workCanvas, 0, 0);

        // Draw source crosshair indicator if source is set
        if (this.sourceSet) {
            const pos = this.getSourcePosition();
            if (pos) {
                this.drawCrosshair(this.previewCtx, pos.x, pos.y);
            }
        }

        return this.previewCanvas;
    }

    /**
     * Draw crosshair indicator at position
     */
    drawCrosshair(ctx, x, y) {
        const size = 15;
        const innerRadius = 5;

        ctx.save();
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
        ctx.lineWidth = 2;

        // Outer circle
        ctx.beginPath();
        ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshair lines
        ctx.beginPath();
        ctx.moveTo(x - size, y);
        ctx.lineTo(x - innerRadius - 2, y);
        ctx.moveTo(x + innerRadius + 2, y);
        ctx.lineTo(x + size, y);
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y - innerRadius - 2);
        ctx.moveTo(x, y + innerRadius + 2);
        ctx.lineTo(x, y + size);
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Get the result canvas
     */
    getResultCanvas() {
        return this.workCanvas;
    }

    /**
     * Reset source point
     */
    resetSource() {
        this.sourceSet = false;
        this.offsetSet = false;
    }

    /**
     * Reset all changes (restore to original image)
     */
    reset() {
        this.workCtx.drawImage(this.sourceImage, 0, 0);
        this.resetSource();
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.sourceImage = null;
        this.workCanvas = null;
        this.previewCanvas = null;
    }
}

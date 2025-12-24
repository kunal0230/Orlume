/**
 * Transform Tool
 * Handles cropping, rotating, and flipping
 */
export class TransformTool {
    constructor(app, canvasManager) {
        this.app = app;
        this.canvasManager = canvasManager;

        this.active = false;

        // State
        this.cropRect = null; // {x, y, width, height} in image coordinates
        this.rotation = 0; // degrees
        this.flipX = false;
        this.flipY = false;

        this.aspectRatio = null; // null = free, number = ratio

        // Interaction
        this.dragMode = null; // 'move', 'nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'
        this.dragStart = null;
        this.rectStart = null;

        // Config
        this.handleSize = 10;
        this.gridColor = 'rgba(255, 255, 255, 0.5)';
        this.overlayColor = 'rgba(0, 0, 0, 0.5)';
    }

    activate() {
        this.active = true;
        this.image = this.canvasManager.image;

        if (!this.image) return;

        // Initialize full image crop
        this.cropRect = {
            x: 0,
            y: 0,
            width: this.image.width,
            height: this.image.height
        };

        this.rotation = 0;
        this.flipX = false;
        this.flipY = false;

        // Add listeners
        const canvas = this.canvasManager.mainCanvas;
        this.boundMouseDown = this.onMouseDown.bind(this);
        this.boundMouseMove = this.onMouseMove.bind(this);
        this.boundMouseUp = this.onMouseUp.bind(this);

        canvas.addEventListener('mousedown', this.boundMouseDown);
        window.addEventListener('mousemove', this.boundMouseMove);
        window.addEventListener('mouseup', this.boundMouseUp);

        // Update UI
        this.updateUI();
        this.canvasManager.requestRender();
    }

    deactivate() {
        this.active = false;

        // Remove listeners
        const canvas = this.canvasManager.mainCanvas;
        if (canvas) {
            canvas.removeEventListener('mousedown', this.boundMouseDown);
        }
        window.removeEventListener('mousemove', this.boundMouseMove);
        window.removeEventListener('mouseup', this.boundMouseUp);

        this.canvasManager.requestRender();
    }

    // Convert event to image coordinates
    getCoords(e) {
        const canvas = this.canvasManager.mainCanvas;
        const rect = canvas.getBoundingClientRect();

        // Canvas is displayed via CSS scaling, but context is 1:1 image pixels
        // So we need to map screen pixels -> image pixels

        // Scale factor: Image Width / Display Width
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        return { x, y };
    }

    onMouseDown(e) {
        const { x, y } = this.getCoords(e);
        this.handleMouseDown(x, y);
    }

    onMouseMove(e) {
        const { x, y } = this.getCoords(e);
        // Pass scale=1 because we are already in image coordinates
        this.handleMouseMove(x, y);
    }

    onMouseUp(e) {
        this.handleMouseUp();
    }

    setAspectRatio(ratio) {
        this.aspectRatio = ratio === 'free' || ratio === 'original' ? null : parseFloat(ratio);

        if (ratio === 'original') {
            this.aspectRatio = this.image.width / this.image.height;
        }

        if (this.aspectRatio) {
            // Adjust current rect to match aspect ratio
            // Keep center
            const cx = this.cropRect.x + this.cropRect.width / 2;
            const cy = this.cropRect.y + this.cropRect.height / 2;

            let newW = this.cropRect.width;
            let newH = this.cropRect.height;

            const currentRatio = newW / newH;

            if (currentRatio > this.aspectRatio) {
                // Too wide, reduce width
                newW = newH * this.aspectRatio;
            } else {
                // Too tall, reduce height
                newH = newW / this.aspectRatio;
            }

            this.cropRect.x = cx - newW / 2;
            this.cropRect.y = cy - newH / 2;
            this.cropRect.width = newW;
            this.cropRect.height = newH;

            this.canvasManager.requestRender();
        }
    }

    rotate(angle) {
        this.rotation = parseFloat(angle);
        this.canvasManager.requestRender();
    }

    rotateStep(step) {
        this.rotation = (this.rotation + step) % 360;
        const slider = document.getElementById('rotate-slider');
        if (slider) {
            // Slider is clamped -45 to 45. If rotation is outside, slider stays at bounds?
            // Or we treat slider as "fine tune" addition to base rotation?
            // Simple approach: Slider sets rotation directly. Buttons ADD 90 deg steps?
            // Problem: If I rotate 90, rotation is 90. Slider range is -45 to 45.
            // Let's make slider full 360? No, hard to straighten.
            // Let's ignore slider update for large rotations?
            // Or just update text value.
        }
        document.getElementById('rotate-value').textContent = `${Math.round(this.rotation)}°`;
        this.canvasManager.requestRender();
    }

    flip(axis) {
        if (axis === 'horizontal') this.flipX = !this.flipX;
        if (axis === 'vertical') this.flipY = !this.flipY;
        this.canvasManager.requestRender();
    }

    getHitTest(x, y) {
        const rect = this.cropRect;
        // In image coordinates
        // Handles need constant visual size, so we need "visual handle size" translated to image coordinates.
        // If image is huge (4000px) and displayed small (400px), a 10px handle on screen = 100px on image.

        const canvas = this.canvasManager.mainCanvas;
        const displayRect = canvas.getBoundingClientRect();
        const scale = canvas.width / displayRect.width;

        // Visual size 20px -> Image size
        const handleR = (this.handleSize || 20) * scale;

        // Helper to check distance
        const check = (hx, hy) => Math.abs(x - hx) < handleR && Math.abs(y - hy) < handleR;

        // Corners
        if (check(rect.x, rect.y)) return 'nw';
        if (check(rect.x + rect.width, rect.y)) return 'ne';
        if (check(rect.x, rect.y + rect.height)) return 'sw';
        if (check(rect.x + rect.width, rect.y + rect.height)) return 'se';

        // Edges
        if (check(rect.x + rect.width / 2, rect.y)) return 'n';
        if (check(rect.x + rect.width / 2, rect.y + rect.height)) return 's';
        if (check(rect.x, rect.y + rect.height / 2)) return 'w';
        if (check(rect.x + rect.width, rect.y + rect.height / 2)) return 'e';

        // Center
        if (x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height) return 'move';

        return null;
    }

    handleMouseDown(x, y) {
        this.dragMode = this.getHitTest(x, y);
        if (this.dragMode) {
            this.dragStart = { x, y };
            this.rectStart = { ...this.cropRect };

            // Set cursor
            document.body.style.cursor = this.dragMode === 'move' ? 'move' : `${this.dragMode}-resize`;
        }
    }

    handleMouseMove(x, y) {
        if (!this.dragMode) {
            // Hover cursor update
            const hoverMode = this.getHitTest(x, y);
            document.body.style.cursor = hoverMode ? (hoverMode === 'move' ? 'move' : `${hoverMode}-resize`) : 'default';
            return;
        }

        const dx = (x - this.dragStart.x);
        const dy = (y - this.dragStart.y);

        const r = { ...this.rectStart };

        let newX = r.x;
        let newY = r.y;
        let newW = r.width;
        let newH = r.height;

        // Logic for resizing
        if (this.dragMode === 'move') {
            newX += dx;
            newY += dy;
            // Clamp to bounds
            newX = Math.max(0, Math.min(this.image.width - newW, newX));
            newY = Math.max(0, Math.min(this.image.height - newH, newY));
        } else {
            if (this.dragMode.includes('w')) {
                newX += dx;
                newW -= dx;
            }
            if (this.dragMode.includes('e')) {
                newW += dx;
            }
            if (this.dragMode.includes('n')) {
                newY += dy;
                newH -= dy;
            }
            if (this.dragMode.includes('s')) {
                newH += dy;
            }

            // Fix negative width/height
            if (newW < 0) {
                newX += newW;
                newW = Math.abs(newW);
                // Flip mode? logic gets complex. Clamp for now.
            }
            if (newH < 0) {
                newY += newH;
                newH = Math.abs(newH);
            }

            // Constrain aspect ratio if set
            if (this.aspectRatio) {
                // Simple constraint: Width drives height for E/W corners, Height drives Width for N/S?
                // For corner dragging, use the larger delta?
                // Simplification: Allow free drag, then snap? No, feels bad.
                // Correct way: Project logic.

                // If dragging a corner
                if (this.dragMode.length === 2) {
                    if (newW / newH > this.aspectRatio) {
                        newW = newH * this.aspectRatio;
                    } else {
                        newH = newW / this.aspectRatio;
                    }
                }
            }
        }

        // Apply changes
        this.cropRect = {
            x: newX,
            y: newY,
            width: newW,
            height: newH
        };

        this.canvasManager.requestRender();
    }

    handleMouseUp() {
        this.dragMode = null;
        document.body.style.cursor = 'default';
    }

    render(ctx) {
        if (!this.active || !this.cropRect) return;

        // ctx is 1:1 image coords

        const r = this.cropRect;

        // Scale handles visually
        const canvas = this.canvasManager.mainCanvas;
        const displayRect = canvas.getBoundingClientRect();
        const viewScale = canvas.width / displayRect.width;
        const hs = (this.handleSize || 20) * viewScale;

        // Shadow outside
        ctx.fillStyle = this.overlayColor;
        ctx.beginPath();
        ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.rect(r.x, r.y, r.width, r.height);
        ctx.fill('evenodd');

        // Grid
        ctx.strokeStyle = this.gridColor;
        // Scale line width visually
        ctx.lineWidth = 1 * viewScale;
        ctx.beginPath();
        // Thirds
        ctx.moveTo(r.x + r.width / 3, r.y); ctx.lineTo(r.x + r.width / 3, r.y + r.height);
        ctx.moveTo(r.x + 2 * r.width / 3, r.y); ctx.lineTo(r.x + 2 * r.width / 3, r.y + r.height);
        ctx.moveTo(r.x, r.y + r.height / 3); ctx.lineTo(r.x + r.width, r.y + r.height / 3);
        ctx.moveTo(r.x, r.y + 2 * r.height / 3); ctx.lineTo(r.x + r.width, r.y + 2 * r.height / 3);
        ctx.stroke();

        // Handle visual helper
        const drawH = (cx, cy) => ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);

        ctx.fillStyle = '#fff';
        drawH(r.x, r.y); // NW
        drawH(r.x + r.width, r.y); // NE
        drawH(r.x, r.y + r.height); // SW
        drawH(r.x + r.width, r.y + r.height); // SE

        // Border
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * viewScale;
        ctx.strokeRect(r.x, r.y, r.width, r.height);
    }

    updateUI() {
        // Reset controls
        const aspectSelect = document.getElementById('crop-aspect');
        if (aspectSelect) aspectSelect.value = 'free';
        this.aspectRatio = null;

        const rotateSlider = document.getElementById('rotate-slider');
        if (rotateSlider) rotateSlider.value = 0;

        const rotateValue = document.getElementById('rotate-value');
        if (rotateValue) rotateValue.textContent = '0°';
    }

    async apply() {
        return this.app.imageProcessor.applyTransform(this.image, {
            crop: this.cropRect,
            rotation: this.rotation,
            flipX: this.flipX,
            flipY: this.flipY
        }, this.app.state.depthMap);
    }
}

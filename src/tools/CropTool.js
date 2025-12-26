/**
 * CropTool - Interactive Crop Tool with Canvas Overlay
 * 
 * Features:
 * - 8 resize handles (4 corners + 4 edges)
 * - Aspect ratio presets (Free, 1:1, 4:3, 3:2, 16:9)
 * - Rule of thirds grid overlay
 * - Drag to move crop region
 * - Dark overlay outside crop area
 */

export class CropTool {
    constructor(canvasContainer, canvas) {
        this.canvasContainer = canvasContainer;
        this.canvas = canvas;
        this.active = false;
        this.aspectRatio = null; // null = free, number = locked ratio (width/height)
        this.showGrid = true;

        // Crop region in normalized coordinates (0-1)
        this.region = {
            x: 0.1,
            y: 0.1,
            width: 0.8,
            height: 0.8
        };

        // Interaction state
        this.dragging = null; // 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
        this.startPos = null;
        this.startRegion = null;

        // Handle size in pixels
        this.handleSize = 12;
        this.handleTouchSize = 24; // Larger touch target

        // Rotation angle in degrees (synced with canvas CSS transform)
        this.rotation = 0;

        // Create overlay elements
        this._createOverlay();

        // Bind event handlers
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    /**
     * Create the overlay DOM structure
     */
    _createOverlay() {
        // Main overlay container
        this.overlay = document.createElement('div');
        this.overlay.className = 'crop-overlay';
        this.overlay.style.display = 'none';

        // Dark regions (top, right, bottom, left)
        this.darkTop = document.createElement('div');
        this.darkTop.className = 'crop-dark crop-dark-top';

        this.darkRight = document.createElement('div');
        this.darkRight.className = 'crop-dark crop-dark-right';

        this.darkBottom = document.createElement('div');
        this.darkBottom.className = 'crop-dark crop-dark-bottom';

        this.darkLeft = document.createElement('div');
        this.darkLeft.className = 'crop-dark crop-dark-left';

        // Crop region
        this.cropRegion = document.createElement('div');
        this.cropRegion.className = 'crop-region';

        // Rule of thirds grid
        this.grid = document.createElement('div');
        this.grid.className = 'crop-grid';
        this.grid.innerHTML = `
            <div class="crop-grid-line crop-grid-h1"></div>
            <div class="crop-grid-line crop-grid-h2"></div>
            <div class="crop-grid-line crop-grid-v1"></div>
            <div class="crop-grid-line crop-grid-v2"></div>
        `;
        this.cropRegion.appendChild(this.grid);

        // Border
        this.border = document.createElement('div');
        this.border.className = 'crop-border';
        this.cropRegion.appendChild(this.border);

        // Handles
        this.handles = {};
        const handlePositions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        handlePositions.forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `crop-handle crop-handle-${pos}`;
            handle.dataset.handle = pos;
            this.handles[pos] = handle;
            this.cropRegion.appendChild(handle);
        });

        // Dimension display
        this.dimensionDisplay = document.createElement('div');
        this.dimensionDisplay.className = 'crop-dimensions';
        this.cropRegion.appendChild(this.dimensionDisplay);

        // Assemble overlay
        this.overlay.appendChild(this.darkTop);
        this.overlay.appendChild(this.darkRight);
        this.overlay.appendChild(this.darkBottom);
        this.overlay.appendChild(this.darkLeft);
        this.overlay.appendChild(this.cropRegion);

        // Add to container
        this.canvasContainer.appendChild(this.overlay);
    }

    /**
     * Activate crop mode
     */
    activate() {
        if (this.active) return;
        this.active = true;

        // Reset to full image selection
        this.region = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };

        // Show overlay
        this.overlay.style.display = 'block';
        this.render();

        // Bind events
        this.overlay.addEventListener('mousedown', this._onMouseDown);
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);
        document.addEventListener('keydown', this._onKeyDown);

        // Touch events
        this.overlay.addEventListener('touchstart', this._onMouseDown, { passive: false });
        document.addEventListener('touchmove', this._onMouseMove, { passive: false });
        document.addEventListener('touchend', this._onMouseUp);
    }

    /**
     * Deactivate crop mode
     */
    deactivate() {
        if (!this.active) return;
        this.active = false;

        // Hide overlay
        this.overlay.style.display = 'none';

        // Unbind events
        this.overlay.removeEventListener('mousedown', this._onMouseDown);
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);
        document.removeEventListener('keydown', this._onKeyDown);

        this.overlay.removeEventListener('touchstart', this._onMouseDown);
        document.removeEventListener('touchmove', this._onMouseMove);
        document.removeEventListener('touchend', this._onMouseUp);
    }

    /**
     * Set aspect ratio
     * @param {number|null} ratio - Width/height ratio, or null for free
     */
    setAspectRatio(ratio) {
        this.aspectRatio = ratio;

        if (ratio !== null) {
            // Adjust current region to match new aspect ratio
            this._constrainToAspectRatio();
        }

        this.render();
    }

    /**
     * Toggle rule of thirds grid
     */
    toggleGrid(show) {
        this.showGrid = show !== undefined ? show : !this.showGrid;
        this.grid.style.display = this.showGrid ? 'block' : 'none';
    }

    /**
     * Set rotation angle (syncs overlay with canvas transform)
     * @param {number} angle - Rotation angle in degrees
     */
    setRotation(angle) {
        this.rotation = angle;
        // Apply same rotation to overlay so it matches the rotated canvas
        this.overlay.style.transform = angle ? `rotate(${angle}deg)` : '';
        this.overlay.style.transformOrigin = 'center center';
    }

    /**
     * Set custom dimensions in pixels
     * @param {number} widthPx - Target width in pixels
     * @param {number} heightPx - Target height in pixels
     */
    setCustomDimensions(widthPx, heightPx) {
        // Clamp to canvas dimensions
        const maxWidth = this.canvas.width;
        const maxHeight = this.canvas.height;

        widthPx = Math.min(widthPx, maxWidth);
        heightPx = Math.min(heightPx, maxHeight);

        // Convert to normalized coordinates
        const normalizedWidth = widthPx / maxWidth;
        const normalizedHeight = heightPx / maxHeight;

        // Center the crop region
        const centerX = this.region.x + this.region.width / 2;
        const centerY = this.region.y + this.region.height / 2;

        // Calculate new position (centered)
        let newX = centerX - normalizedWidth / 2;
        let newY = centerY - normalizedHeight / 2;

        // Ensure within bounds
        newX = Math.max(0, Math.min(1 - normalizedWidth, newX));
        newY = Math.max(0, Math.min(1 - normalizedHeight, newY));

        // Update region
        this.region = {
            x: newX,
            y: newY,
            width: normalizedWidth,
            height: normalizedHeight
        };

        // Clear aspect ratio lock since this is a custom size
        this.aspectRatio = null;
        document.querySelectorAll('.aspect-ratio-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.ratio === 'free');
        });

        this.render();
    }

    /**
     * Get the current crop region in pixel coordinates
     */
    getCropPixels() {
        const canvasRect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / canvasRect.width;
        const scaleY = this.canvas.height / canvasRect.height;

        return {
            x: Math.round(this.region.x * this.canvas.width),
            y: Math.round(this.region.y * this.canvas.height),
            width: Math.round(this.region.width * this.canvas.width),
            height: Math.round(this.region.height * this.canvas.height)
        };
    }

    /**
     * Get normalized crop region (0-1)
     */
    getCropNormalized() {
        return { ...this.region };
    }

    /**
     * Apply the crop (return the crop data for processing)
     */
    apply() {
        const cropData = this.getCropPixels();
        this.deactivate();
        return cropData;
    }

    /**
     * Cancel crop and reset
     */
    cancel() {
        this.region = { x: 0, y: 0, width: 1, height: 1 };
        this.deactivate();
    }

    /**
     * Render the overlay to match crop region
     */
    render() {
        if (!this.active) return;

        const rect = this.canvas.getBoundingClientRect();
        const containerRect = this.canvasContainer.getBoundingClientRect();

        // Calculate canvas position within container
        const offsetX = rect.left - containerRect.left;
        const offsetY = rect.top - containerRect.top;

        // Convert normalized coords to pixels
        const x = offsetX + this.region.x * rect.width;
        const y = offsetY + this.region.y * rect.height;
        const w = this.region.width * rect.width;
        const h = this.region.height * rect.height;

        // Position dark regions
        this.darkTop.style.cssText = `
            left: ${offsetX}px;
            top: ${offsetY}px;
            width: ${rect.width}px;
            height: ${y - offsetY}px;
        `;

        this.darkBottom.style.cssText = `
            left: ${offsetX}px;
            top: ${y + h}px;
            width: ${rect.width}px;
            height: ${rect.height - (y - offsetY + h)}px;
        `;

        this.darkLeft.style.cssText = `
            left: ${offsetX}px;
            top: ${y}px;
            width: ${x - offsetX}px;
            height: ${h}px;
        `;

        this.darkRight.style.cssText = `
            left: ${x + w}px;
            top: ${y}px;
            width: ${rect.width - (x - offsetX + w)}px;
            height: ${h}px;
        `;

        // Position crop region
        this.cropRegion.style.cssText = `
            left: ${x}px;
            top: ${y}px;
            width: ${w}px;
            height: ${h}px;
        `;

        // Update dimension display
        const pixels = this.getCropPixels();
        this.dimensionDisplay.textContent = `${pixels.width} × ${pixels.height}`;

        // Toggle grid visibility
        this.grid.style.display = this.showGrid ? 'block' : 'none';

        // Notify parent of update
        if (this.onUpdate) {
            this.onUpdate();
        }
    }

    /**
     * Constrain region to current aspect ratio
     */
    _constrainToAspectRatio() {
        if (this.aspectRatio === null) return;

        const canvasAspect = this.canvas.width / this.canvas.height;
        const targetRatio = this.aspectRatio;

        // Calculate normalized target ratio (accounting for canvas aspect)
        // If targetRatio is the desired pixel ratio (width/height of output),
        // we need to convert to normalized coords where x and y are both 0-1 on their respective axes
        const normalizedTargetRatio = targetRatio / canvasAspect;

        // Calculate new dimensions maintaining center
        const centerX = this.region.x + this.region.width / 2;
        const centerY = this.region.y + this.region.height / 2;

        let newWidth, newHeight;
        const currentRatio = this.region.width / this.region.height;

        if (currentRatio > normalizedTargetRatio) {
            // Currently too wide, reduce width
            newHeight = this.region.height;
            newWidth = newHeight * normalizedTargetRatio;
        } else {
            // Currently too tall, reduce height  
            newWidth = this.region.width;
            newHeight = newWidth / normalizedTargetRatio;
        }

        // Ensure we stay within bounds
        newWidth = Math.min(newWidth, 1);
        newHeight = Math.min(newHeight, 1);

        // Recalculate to fit in canvas
        if (centerX - newWidth / 2 < 0) {
            newWidth = centerX * 2;
            newHeight = newWidth / normalizedTargetRatio;
        }
        if (centerX + newWidth / 2 > 1) {
            newWidth = (1 - centerX) * 2;
            newHeight = newWidth / normalizedTargetRatio;
        }
        if (centerY - newHeight / 2 < 0) {
            newHeight = centerY * 2;
            newWidth = newHeight * normalizedTargetRatio;
        }
        if (centerY + newHeight / 2 > 1) {
            newHeight = (1 - centerY) * 2;
            newWidth = newHeight * normalizedTargetRatio;
        }

        // Apply new dimensions centered
        this.region.width = newWidth;
        this.region.height = newHeight;
        this.region.x = Math.max(0, Math.min(1 - newWidth, centerX - newWidth / 2));
        this.region.y = Math.max(0, Math.min(1 - newHeight, centerY - newHeight / 2));
    }

    /**
     * Get event position (mouse or touch)
     */
    _getEventPos(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    /**
     * Determine what was clicked
     */
    _getHitTarget(e) {
        const pos = this._getEventPos(e);
        const rect = this.canvas.getBoundingClientRect();
        const containerRect = this.canvasContainer.getBoundingClientRect();

        // Canvas position within container
        const offsetX = rect.left - containerRect.left;
        const offsetY = rect.top - containerRect.top;

        // Crop region in container coords
        const cropX = offsetX + this.region.x * rect.width;
        const cropY = offsetY + this.region.y * rect.height;
        const cropW = this.region.width * rect.width;
        const cropH = this.region.height * rect.height;

        // Mouse position relative to container
        const mx = pos.x - containerRect.left;
        const my = pos.y - containerRect.top;

        const hs = this.handleTouchSize / 2;

        // Check corner handles first (they overlap edges)
        if (Math.abs(mx - cropX) < hs && Math.abs(my - cropY) < hs) return 'nw';
        if (Math.abs(mx - (cropX + cropW)) < hs && Math.abs(my - cropY) < hs) return 'ne';
        if (Math.abs(mx - cropX) < hs && Math.abs(my - (cropY + cropH)) < hs) return 'sw';
        if (Math.abs(mx - (cropX + cropW)) < hs && Math.abs(my - (cropY + cropH)) < hs) return 'se';

        // Check edge handles
        if (Math.abs(mx - (cropX + cropW / 2)) < hs && Math.abs(my - cropY) < hs) return 'n';
        if (Math.abs(mx - (cropX + cropW / 2)) < hs && Math.abs(my - (cropY + cropH)) < hs) return 's';
        if (Math.abs(mx - cropX) < hs && Math.abs(my - (cropY + cropH / 2)) < hs) return 'w';
        if (Math.abs(mx - (cropX + cropW)) < hs && Math.abs(my - (cropY + cropH / 2)) < hs) return 'e';

        // Check if inside crop region (move)
        if (mx >= cropX && mx <= cropX + cropW && my >= cropY && my <= cropY + cropH) {
            return 'move';
        }

        return null;
    }

    /**
     * Mouse down handler
     */
    _onMouseDown(e) {
        e.preventDefault();

        const target = this._getHitTarget(e);
        if (!target) return;

        this.dragging = target;
        this.startPos = this._getEventPos(e);
        this.startRegion = { ...this.region };

        // Update cursor during drag
        document.body.style.cursor = this._getCursor(target);
    }

    /**
     * Mouse move handler
     */
    _onMouseMove(e) {
        if (!this.active) return;

        if (this.dragging) {
            e.preventDefault();
            this._handleDrag(e);
        } else {
            // Update cursor based on hover
            const target = this._getHitTarget(e);
            this.overlay.style.cursor = this._getCursor(target);
        }
    }

    /**
     * Mouse up handler
     */
    _onMouseUp(e) {
        if (this.dragging) {
            this.dragging = null;
            this.startPos = null;
            this.startRegion = null;
            document.body.style.cursor = '';
        }
    }

    /**
     * Handle dragging
     */
    _handleDrag(e) {
        const pos = this._getEventPos(e);
        const rect = this.canvas.getBoundingClientRect();

        // Delta in normalized coordinates
        const dx = (pos.x - this.startPos.x) / rect.width;
        const dy = (pos.y - this.startPos.y) / rect.height;

        const sr = this.startRegion;
        const minSize = 0.05; // Minimum 5% of canvas

        switch (this.dragging) {
            case 'move':
                this.region.x = Math.max(0, Math.min(1 - sr.width, sr.x + dx));
                this.region.y = Math.max(0, Math.min(1 - sr.height, sr.y + dy));
                break;

            case 'nw':
                this._resizeFromCorner(dx, dy, 'nw', sr, minSize);
                break;

            case 'ne':
                this._resizeFromCorner(dx, dy, 'ne', sr, minSize);
                break;

            case 'sw':
                this._resizeFromCorner(dx, dy, 'sw', sr, minSize);
                break;

            case 'se':
                this._resizeFromCorner(dx, dy, 'se', sr, minSize);
                break;

            case 'n':
                this._resizeFromEdge(dy, 'n', sr, minSize);
                break;

            case 's':
                this._resizeFromEdge(dy, 's', sr, minSize);
                break;

            case 'w':
                this._resizeFromEdge(dx, 'w', sr, minSize);
                break;

            case 'e':
                this._resizeFromEdge(dx, 'e', sr, minSize);
                break;
        }

        this.render();
    }

    /**
     * Resize from corner
     */
    _resizeFromCorner(dx, dy, corner, sr, minSize) {
        let newX = sr.x, newY = sr.y, newW = sr.width, newH = sr.height;

        if (corner.includes('w')) {
            newX = Math.max(0, Math.min(sr.x + sr.width - minSize, sr.x + dx));
            newW = sr.x + sr.width - newX;
        }
        if (corner.includes('e')) {
            newW = Math.max(minSize, Math.min(1 - sr.x, sr.width + dx));
        }
        if (corner.includes('n')) {
            newY = Math.max(0, Math.min(sr.y + sr.height - minSize, sr.y + dy));
            newH = sr.y + sr.height - newY;
        }
        if (corner.includes('s')) {
            newH = Math.max(minSize, Math.min(1 - sr.y, sr.height + dy));
        }

        // Apply aspect ratio constraint
        if (this.aspectRatio !== null) {
            const canvasAspect = this.canvas.width / this.canvas.height;
            const normalizedTargetRatio = this.aspectRatio / canvasAspect;
            const currentRatio = newW / newH;

            if (corner === 'nw' || corner === 'se') {
                // Adjust based on dominant movement
                if (currentRatio > normalizedTargetRatio) {
                    newW = newH * normalizedTargetRatio;
                    if (corner === 'nw') newX = sr.x + sr.width - newW;
                } else {
                    newH = newW / normalizedTargetRatio;
                    if (corner === 'nw') newY = sr.y + sr.height - newH;
                }
            } else {
                // ne, sw
                if (currentRatio > normalizedTargetRatio) {
                    newW = newH * normalizedTargetRatio;
                    if (corner === 'sw') newX = sr.x + sr.width - newW;
                } else {
                    newH = newW / normalizedTargetRatio;
                    if (corner === 'ne') newY = sr.y + sr.height - newH;
                }
            }
        }

        this.region = { x: newX, y: newY, width: newW, height: newH };
    }

    /**
     * Resize from edge
     */
    _resizeFromEdge(delta, edge, sr, minSize) {
        switch (edge) {
            case 'n':
                const newY = Math.max(0, Math.min(sr.y + sr.height - minSize, sr.y + delta));
                this.region.y = newY;
                this.region.height = sr.y + sr.height - newY;
                break;
            case 's':
                this.region.height = Math.max(minSize, Math.min(1 - sr.y, sr.height + delta));
                break;
            case 'w':
                const newX = Math.max(0, Math.min(sr.x + sr.width - minSize, sr.x + delta));
                this.region.x = newX;
                this.region.width = sr.x + sr.width - newX;
                break;
            case 'e':
                this.region.width = Math.max(minSize, Math.min(1 - sr.x, sr.width + delta));
                break;
        }

        // If aspect ratio is locked, disable edge-only resizing
        if (this.aspectRatio !== null) {
            this.region = { ...sr }; // Revert - can only resize from corners with aspect lock
        }
    }

    /**
     * Keyboard handler
     */
    _onKeyDown(e) {
        if (!this.active) return;

        const step = e.shiftKey ? 0.05 : 0.01;

        switch (e.code) {
            case 'ArrowLeft':
                e.preventDefault();
                this.region.x = Math.max(0, this.region.x - step);
                this.render();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.region.x = Math.min(1 - this.region.width, this.region.x + step);
                this.render();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.region.y = Math.max(0, this.region.y - step);
                this.render();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.region.y = Math.min(1 - this.region.height, this.region.y + step);
                this.render();
                break;
            case 'Enter':
                // Apply is handled by EditorUI
                break;
            case 'Escape':
                // Cancel is handled by EditorUI
                break;
        }
    }

    /**
     * Get appropriate cursor for target
     */
    _getCursor(target) {
        const cursors = {
            'nw': 'nwse-resize',
            'se': 'nwse-resize',
            'ne': 'nesw-resize',
            'sw': 'nesw-resize',
            'n': 'ns-resize',
            's': 'ns-resize',
            'e': 'ew-resize',
            'w': 'ew-resize',
            'move': 'move'
        };
        return cursors[target] || 'default';
    }

    /**
     * Update overlay position when canvas resizes
     */
    onResize() {
        if (this.active) {
            this.render();
        }
    }
}

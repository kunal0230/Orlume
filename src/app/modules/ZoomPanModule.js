/**
 * ZoomPanModule - Zoom and Pan functionality
 * 
 * Handles:
 * - Zoom controls UI
 * - Scroll wheel zoom (Ctrl/Cmd + scroll)
 * - Pan with Space + drag
 * - Zoom level management
 */

export class ZoomPanModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;

        // Zoom and Pan state
        this.isSpaceDown = false;
        this.zoom = {
            level: 1,
            min: 0.1,
            max: 5,
            step: 0.1,
            panX: 0,
            panY: 0,
            isPanning: false
        };
    }

    /**
     * Initialize all zoom and pan functionality
     */
    init() {
        this._initZoomControls();
        this._initZoomEvents();
        this._initPanEvents();
        this._initTouchEvents();
    }

    /**
     * Initialize zoom controls UI at bottom center of canvas
     */
    _initZoomControls() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        // Create zoom controls container
        const zoomControls = document.createElement('div');
        zoomControls.className = 'zoom-controls';
        zoomControls.id = 'zoom-controls';
        zoomControls.innerHTML = `
            <button class="zoom-btn" id="btn-zoom-out" title="Zoom Out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
            <span class="zoom-level" id="zoom-level">100%</span>
            <button class="zoom-btn" id="btn-zoom-in" title="Zoom In">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
            <button class="zoom-btn zoom-btn-text" id="btn-zoom-fit" title="Fit to View">Fit</button>
        `;

        canvasArea.appendChild(zoomControls);

        // Bind button events
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.zoomOut());
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.zoomIn());
        document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.resetZoom());
    }

    /**
     * Initialize zoom events (Ctrl/Cmd + scroll)
     */
    _initZoomEvents() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        canvasArea.addEventListener('wheel', (e) => {
            // Only trigger zoom when Ctrl (Windows/Linux) or Cmd (Mac) is held
            if (!e.ctrlKey && !e.metaKey) return;

            e.preventDefault();

            // Determine zoom direction based on scroll
            const delta = e.deltaY < 0 ? this.zoom.step : -this.zoom.step;
            const newLevel = Math.max(this.zoom.min, Math.min(this.zoom.max, this.zoom.level + delta));

            this.setZoom(newLevel);
        }, { passive: false });
    }

    /**
     * Set zoom level and apply transform
     */
    setZoom(level) {
        // Clamp zoom level
        this.zoom.level = Math.max(this.zoom.min, Math.min(this.zoom.max, level));
        this._applyCanvasTransform();

        // Update zoom level display
        const zoomLevelDisplay = document.getElementById('zoom-level');
        if (zoomLevelDisplay) {
            zoomLevelDisplay.textContent = `${Math.round(this.zoom.level * 100)}%`;
        }
        this.editor.updateBrushCursor?.();
    }

    /**
     * Apply combined zoom and pan transform to canvas
     */
    _applyCanvasTransform() {
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.style.transform = `translate(${this.zoom.panX}px, ${this.zoom.panY}px) scale(${this.zoom.level})`;
            canvasContainer.style.transformOrigin = 'center center';
        }
    }

    /**
     * Zoom in by one step
     */
    zoomIn() {
        this.setZoom(this.zoom.level + this.zoom.step);
    }

    /**
     * Zoom out by one step
     */
    zoomOut() {
        this.setZoom(this.zoom.level - this.zoom.step);
    }

    /**
     * Reset zoom to 100% and pan to center
     */
    resetZoom() {
        this.zoom.panX = 0;
        this.zoom.panY = 0;
        this.setZoom(1);
    }

    /**
     * Initialize pan events (Space + drag)
     */
    _initPanEvents() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        let startX = 0, startY = 0;
        let startPanX = 0, startPanY = 0;

        // Track Space key state
        document.addEventListener('keydown', (e) => {
            const isInput = e.target?.matches?.('input, textarea, [contenteditable]') ||
                            e.target?.tagName === 'INPUT' ||
                            e.target?.tagName === 'TEXTAREA' ||
                            e.target?.isContentEditable;
            if (e.code === 'Space' && !isInput) {
                this.isSpaceDown = true;
                if (!this.zoom.isPanning) {
                    canvasArea.style.cursor = 'grab';
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.isSpaceDown = false;
                if (!this.zoom.isPanning) {
                    canvasArea.style.cursor = '';
                }
            }
        });

        // Mouse down - start panning if Space is held
        canvasArea.addEventListener('mousedown', (e) => {
            // Check if Space is being held
            if (e.buttons === 1 && this.isSpaceDown) {
                e.preventDefault();
                this.zoom.isPanning = true;

                // When starting to pan, restore edited view if before-view was active
                if (this.state.showingBefore) {
                    this.state.showingBefore = false;
                    this.editor.elements?.beforeIndicator?.classList.remove('visible');
                    this.editor.gpu?.render();
                }

                startX = e.clientX;
                startY = e.clientY;
                startPanX = this.zoom.panX;
                startPanY = this.zoom.panY;
                canvasArea.style.cursor = 'grabbing';
            }
        });

        // Mouse move - pan if dragging
        document.addEventListener('mousemove', (e) => {
            if (this.zoom.isPanning) {
                if (this.state.showingBefore) {
                    this.state.showingBefore = false;
                    this.editor.elements?.beforeIndicator?.classList.remove('visible');
                    this.editor.gpu?.render();
                }
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                this.zoom.panX = startPanX + dx;
                this.zoom.panY = startPanY + dy;
                this._applyCanvasTransform();
            }
        });

        // Mouse up - stop panning
        document.addEventListener('mouseup', () => {
            if (this.zoom.isPanning) {
                this.zoom.isPanning = false;
                const canvasArea = document.querySelector('.canvas-area');
                if (canvasArea) {
                    canvasArea.style.cursor = this.isSpaceDown ? 'grab' : '';
                }
            }
        });
    }

    /**
     * Initialize mobile touch gestures:
     * - Two-finger pinch to zoom
     * - Two-finger pan
     * - Double-tap to toggle 100% / Fit
     * - Tap & hold for Before / After view
     */
    _initTouchEvents() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        let initialDist = 0;
        let initialZoom = 1;
        let initialMidX = 0;
        let initialMidY = 0;
        let initialPanX = 0;
        let initialPanY = 0;
        let isPinching = false;
        let lastTapTime = 0;
        let holdTimer = null;
        let touchStartX = 0;
        let touchStartY = 0;

        canvasArea.addEventListener('touchstart', (e) => {
            // Multi-touch: Pinch zoom & two-finger pan
            if (e.touches.length === 2) {
                if (holdTimer) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
                if (this.state.showingBefore) {
                    this.state.showingBefore = false;
                    this.editor.elements?.beforeIndicator?.classList.remove('visible');
                    this.editor.gpu?.render();
                }

                isPinching = true;
                this.zoom.isPanning = true;

                const t1 = e.touches[0];
                const t2 = e.touches[1];
                initialDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
                initialZoom = this.zoom.level;
                initialMidX = (t1.clientX + t2.clientX) * 0.5;
                initialMidY = (t1.clientY + t2.clientY) * 0.5;
                initialPanX = this.zoom.panX;
                initialPanY = this.zoom.panY;
                return;
            }

            // Single touch
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;

                // Double tap detection (within 300ms)
                const now = Date.now();
                if (now - lastTapTime < 300) {
                    if (holdTimer) {
                        clearTimeout(holdTimer);
                        holdTimer = null;
                    }
                    lastTapTime = 0;
                    // Double tap toggles between fit (1.0) and 2.5x zoom
                    if (this.zoom.level > 1.15) {
                        this.resetZoom();
                    } else {
                        this.setZoom(2.5);
                    }
                    return;
                }
                lastTapTime = now;

                // Tap & hold for Before/After view (when not in drawing/brush/healing tools)
                const tool = this.state.currentTool;
                const isDrawingTool = ['brush', 'healing', 'clone', 'liquify', 'crop'].includes(tool);
                if (!isDrawingTool && this.state.hasImage) {
                    holdTimer = setTimeout(() => {
                        holdTimer = null;
                        if (!isPinching && !this.zoom.isPanning) {
                            this.state.showingBefore = true;
                            this.editor.elements?.beforeIndicator?.classList.add('visible');
                            this.editor.gpu?.renderOriginal();
                            try {
                                navigator.vibrate?.(15);
                            } catch {
                                // Ignore vibration if unsupported
                            }
                        }
                    }, 300);
                }
            }
        }, { passive: true });

        canvasArea.addEventListener('touchmove', (e) => {
            // Handle 2-finger pinch and pan
            if (e.touches.length === 2 && isPinching) {
                if (e.cancelable) e.preventDefault();
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
                if (initialDist > 0) {
                    const scaleFactor = dist / initialDist;
                    const newLevel = Math.max(this.zoom.min, Math.min(this.zoom.max, initialZoom * scaleFactor));

                    const curMidX = (t1.clientX + t2.clientX) * 0.5;
                    const curMidY = (t1.clientY + t2.clientY) * 0.5;
                    const dx = curMidX - initialMidX;
                    const dy = curMidY - initialMidY;

                    this.zoom.panX = initialPanX + dx;
                    this.zoom.panY = initialPanY + dy;
                    this.setZoom(newLevel);
                }
                return;
            }

            // Cancel hold timer if single finger moves significantly (> 8px)
            if (holdTimer && e.touches.length === 1) {
                const touch = e.touches[0];
                if (Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY) > 8) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
            }
        }, { passive: false });

        const endTouch = () => {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            if (this.state.showingBefore) {
                this.state.showingBefore = false;
                this.editor.elements?.beforeIndicator?.classList.remove('visible');
                this.editor.gpu?.render();
            }
            isPinching = false;
            this.zoom.isPanning = false;
        };

        canvasArea.addEventListener('touchend', endTouch, { passive: true });
        canvasArea.addEventListener('touchcancel', endTouch, { passive: true });
    }
}

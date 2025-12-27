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
            if (e.code === 'Space' && !this.zoom.isPanning && !this.state.showingBefore) {
                canvasArea.style.cursor = 'grab';
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && !this.zoom.isPanning) {
                canvasArea.style.cursor = '';
            }
        });

        // Mouse down - start panning if Space is held
        canvasArea.addEventListener('mousedown', (e) => {
            // Check if Space is being held (we check via keyboard state)
            if (e.buttons === 1 && canvasArea.style.cursor === 'grab') {
                e.preventDefault();
                this.zoom.isPanning = true;
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
                    canvasArea.style.cursor = '';
                }
            }
        });
    }
}

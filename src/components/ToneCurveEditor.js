/**
 * ToneCurveEditor - Lightroom-quality interactive tone curve
 * 
 * Features:
 * - Canvas-based curve editor with draggable control points
 * - RGB composite + individual R/G/B channels
 * - Smooth cubic spline interpolation
 * - Real-time histogram background
 * - GPU-friendly 256-entry lookup table output
 */

export class ToneCurveEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            width: options.width || 256,
            height: options.height || 200,
            padding: options.padding || 12,
            pointRadius: options.pointRadius || 6,
            onChange: options.onChange || (() => { }),
            onInteractionEnd: options.onInteractionEnd || (() => { }),
            ...options
        };

        // Curve data for each channel
        // Format: array of {x, y} points normalized to 0-1
        this.curves = {
            rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
        };

        // Active channel
        this.activeChannel = 'rgb';

        // Interaction state
        this.selectedPointIndex = -1;
        this.isDragging = false;
        this.hoveredPointIndex = -1;

        // Histogram data
        this.histogramData = null;

        // LUT cache (256 entries per channel)
        this.lutCache = {
            rgb: null,
            red: null,
            green: null,
            blue: null
        };

        this._init();
    }

    _init() {
        // Create DOM structure
        this.element = document.createElement('div');
        this.element.className = 'tone-curve-editor';
        this.element.innerHTML = `
            <div class="tone-curve-header">
                <div class="tone-curve-channels">
                    <button class="curve-channel-btn active" data-channel="rgb" title="RGB Composite">
                        <span class="channel-icon rgb">●</span>
                    </button>
                    <button class="curve-channel-btn" data-channel="red" title="Red Channel">
                        <span class="channel-icon red">●</span>
                    </button>
                    <button class="curve-channel-btn" data-channel="green" title="Green Channel">
                        <span class="channel-icon green">●</span>
                    </button>
                    <button class="curve-channel-btn" data-channel="blue" title="Blue Channel">
                        <span class="channel-icon blue">●</span>
                    </button>
                </div>
                <button class="curve-reset-btn" title="Reset Curve">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                        <path d="M3 3v5h5"/>
                    </svg>
                </button>
            </div>
            <div class="tone-curve-canvas-container">
                <canvas class="tone-curve-canvas"></canvas>
            </div>
            <div class="tone-curve-footer">
                <span class="curve-io-label">Input: <span class="curve-input-val">--</span></span>
                <span class="curve-io-label">Output: <span class="curve-output-val">--</span></span>
            </div>
        `;

        this.container.appendChild(this.element);

        // Get canvas
        this.canvas = this.element.querySelector('.tone-curve-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Set canvas size with device pixel ratio
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.options.width * dpr;
        this.canvas.height = this.options.height * dpr;
        this.canvas.style.width = `${this.options.width}px`;
        this.canvas.style.height = `${this.options.height}px`;
        this.ctx.scale(dpr, dpr);

        // Bind events
        this._bindEvents();

        // Initial render
        this.render();
    }

    _bindEvents() {
        // Channel buttons
        const channelBtns = this.element.querySelectorAll('.curve-channel-btn');
        channelBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                channelBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeChannel = btn.dataset.channel;
                this.render();
            });
        });

        // Reset button
        const resetBtn = this.element.querySelector('.curve-reset-btn');
        resetBtn.addEventListener('click', () => this.resetCurrentCurve());

        // Canvas interactions
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this._onMouseUp());
        this.canvas.addEventListener('mouseleave', () => this._onMouseLeave());
        this.canvas.addEventListener('dblclick', (e) => this._onDoubleClick(e));

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', () => this._onMouseUp());
    }

    _getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        return { x, y };
    }

    _coordsToNormalized(x, y) {
        const { padding, width, height } = this.options;
        const graphWidth = width - padding * 2;
        const graphHeight = height - padding * 2;

        return {
            x: Math.max(0, Math.min(1, (x - padding) / graphWidth)),
            y: Math.max(0, Math.min(1, 1 - (y - padding) / graphHeight))
        };
    }

    _normalizedToCoords(nx, ny) {
        const { padding, width, height } = this.options;
        const graphWidth = width - padding * 2;
        const graphHeight = height - padding * 2;

        return {
            x: padding + nx * graphWidth,
            y: padding + (1 - ny) * graphHeight
        };
    }

    _findPointAt(x, y) {
        const points = this.curves[this.activeChannel];
        const { pointRadius } = this.options;

        for (let i = 0; i < points.length; i++) {
            const coords = this._normalizedToCoords(points[i].x, points[i].y);
            const dist = Math.sqrt((x - coords.x) ** 2 + (y - coords.y) ** 2);
            if (dist <= pointRadius + 4) {
                return i;
            }
        }
        return -1;
    }

    _onMouseDown(e) {
        const { x, y } = this._getCanvasCoords(e);
        const pointIndex = this._findPointAt(x, y);

        if (pointIndex >= 0) {
            this.selectedPointIndex = pointIndex;
            this.isDragging = true;
            this.canvas.style.cursor = 'grabbing';
        } else {
            // Add new point
            const normalized = this._coordsToNormalized(x, y);
            this._addPoint(normalized.x, normalized.y);
        }
    }

    _onMouseMove(e) {
        const { x, y } = this._getCanvasCoords(e);

        if (this.isDragging && this.selectedPointIndex >= 0) {
            const normalized = this._coordsToNormalized(x, y);
            this._movePoint(this.selectedPointIndex, normalized.x, normalized.y);
        } else {
            // Check hover
            const pointIndex = this._findPointAt(x, y);
            if (pointIndex !== this.hoveredPointIndex) {
                this.hoveredPointIndex = pointIndex;
                this.canvas.style.cursor = pointIndex >= 0 ? 'grab' : 'crosshair';
                this.render();
            }

            // Update I/O display
            const normalized = this._coordsToNormalized(x, y);
            this._updateIODisplay(normalized.x);
        }
    }

    _onMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            this.canvas.style.cursor = this.hoveredPointIndex >= 0 ? 'grab' : 'crosshair';
            this.options.onInteractionEnd();
        }
    }

    _onMouseLeave() {
        this.hoveredPointIndex = -1;
        this.isDragging = false;
        this.canvas.style.cursor = 'crosshair';
        this.render();

        // Clear I/O display
        this.element.querySelector('.curve-input-val').textContent = '--';
        this.element.querySelector('.curve-output-val').textContent = '--';
    }

    _onDoubleClick(e) {
        const { x, y } = this._getCanvasCoords(e);
        const pointIndex = this._findPointAt(x, y);

        // Delete point on double-click (except endpoints)
        if (pointIndex > 0 && pointIndex < this.curves[this.activeChannel].length - 1) {
            this._removePoint(pointIndex);
        }
    }

    _onTouchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this._onMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
    }

    _onTouchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this._onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    }

    _addPoint(x, y) {
        const points = this.curves[this.activeChannel];

        // Find insertion position (maintain x order)
        let insertIndex = 1;
        for (let i = 1; i < points.length; i++) {
            if (x < points[i].x) {
                insertIndex = i;
                break;
            } else if (i === points.length - 1) {
                insertIndex = points.length;
            }
        }

        // Don't add if too close to existing point
        const minDist = 0.03;
        for (const p of points) {
            if (Math.abs(p.x - x) < minDist) return;
        }

        points.splice(insertIndex, 0, { x, y });
        this.selectedPointIndex = insertIndex;
        this.isDragging = true;
        this.canvas.style.cursor = 'grabbing';

        this._onCurveChanged();
        this.render();
        this.options.onInteractionEnd();
    }

    _removePoint(index) {
        const points = this.curves[this.activeChannel];
        if (index > 0 && index < points.length - 1) {
            points.splice(index, 1);
            this.selectedPointIndex = -1;
            this._onCurveChanged();
            this.render();
            this.options.onInteractionEnd();
        }
    }

    _movePoint(index, x, y) {
        const points = this.curves[this.activeChannel];

        // Endpoints can only move vertically
        if (index === 0) {
            points[0].y = y;
        } else if (index === points.length - 1) {
            points[points.length - 1].y = y;
        } else {
            // Middle points: constrain x between neighbors
            const minX = points[index - 1].x + 0.01;
            const maxX = points[index + 1].x - 0.01;
            points[index].x = Math.max(minX, Math.min(maxX, x));
            points[index].y = y;
        }

        this._onCurveChanged();
        this.render();
    }

    _updateIODisplay(inputX) {
        const outputY = this._evaluateCurve(this.activeChannel, inputX);

        this.element.querySelector('.curve-input-val').textContent = Math.round(inputX * 255);
        this.element.querySelector('.curve-output-val').textContent = Math.round(outputY * 255);
    }

    _onCurveChanged() {
        // Invalidate LUT cache
        this.lutCache[this.activeChannel] = null;

        // Notify parent
        this.options.onChange(this.getLUTs());
    }

    /**
     * Cubic spline interpolation (Catmull-Rom)
     */
    _evaluateCurve(channel, x) {
        const points = this.curves[channel];

        // Find surrounding points
        let i1 = 0;
        for (let i = 0; i < points.length - 1; i++) {
            if (x >= points[i].x && x <= points[i + 1].x) {
                i1 = i;
                break;
            }
        }

        const i0 = Math.max(0, i1 - 1);
        const i2 = Math.min(points.length - 1, i1 + 1);
        const i3 = Math.min(points.length - 1, i1 + 2);

        const p0 = points[i0];
        const p1 = points[i1];
        const p2 = points[i2];
        const p3 = points[i3];

        // Local t parameter
        const t = p2.x !== p1.x ? (x - p1.x) / (p2.x - p1.x) : 0;

        // Catmull-Rom spline
        const t2 = t * t;
        const t3 = t2 * t;

        const a = -0.5 * p0.y + 1.5 * p1.y - 1.5 * p2.y + 0.5 * p3.y;
        const b = p0.y - 2.5 * p1.y + 2 * p2.y - 0.5 * p3.y;
        const c = -0.5 * p0.y + 0.5 * p2.y;
        const d = p1.y;

        const result = a * t3 + b * t2 + c * t + d;
        return Math.max(0, Math.min(1, result));
    }

    /**
     * Generate 256-entry lookup table for a channel
     */
    _generateLUT(channel) {
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            lut[i] = this._evaluateCurve(channel, i / 255);
        }
        return lut;
    }

    /**
     * Get all LUTs for shader use
     */
    getLUTs() {
        const result = {};

        for (const channel of ['rgb', 'red', 'green', 'blue']) {
            if (!this.lutCache[channel]) {
                this.lutCache[channel] = this._generateLUT(channel);
            }
            result[channel] = this.lutCache[channel];
        }

        return result;
    }

    /**
     * Check if curve has any adjustments
     */
    hasAdjustments() {
        for (const channel of ['rgb', 'red', 'green', 'blue']) {
            const points = this.curves[channel];
            // Check if any point is off the diagonal
            for (const p of points) {
                if (Math.abs(p.x - p.y) > 0.001) return true;
            }
            // Check if more than 2 points
            if (points.length > 2) return true;
        }
        return false;
    }

    /**
     * Set histogram data for background display
     */
    setHistogramData(data) {
        this.histogramData = data;
        this.render();
    }

    /**
     * Reset current channel curve
     */
    resetCurrentCurve() {
        this.curves[this.activeChannel] = [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ];
        this.selectedPointIndex = -1;
        this._onCurveChanged();
        this.render();
        this.options.onInteractionEnd();
    }

    /**
     * Reset all curves
     */
    resetAllCurves() {
        for (const channel of ['rgb', 'red', 'green', 'blue']) {
            this.curves[channel] = [
                { x: 0, y: 0 },
                { x: 1, y: 1 }
            ];
            this.lutCache[channel] = null;
        }
        this.selectedPointIndex = -1;
        this.options.onChange(this.getLUTs());
        this.render();
    }

    /**
     * Set curves from saved state
     */
    setCurves(curves) {
        for (const channel of ['rgb', 'red', 'green', 'blue']) {
            if (curves[channel]) {
                this.curves[channel] = curves[channel].map(p => ({ ...p }));
                this.lutCache[channel] = null;
            }
        }
        this.options.onChange(this.getLUTs());
        this.render();
    }

    /**
     * Get curves for saving
     */
    getCurves() {
        const result = {};
        for (const channel of ['rgb', 'red', 'green', 'blue']) {
            result[channel] = this.curves[channel].map(p => ({ ...p }));
        }
        return result;
    }

    /**
     * Render the curve editor
     */
    render() {
        const { width, height, padding } = this.options;
        const ctx = this.ctx;
        const graphWidth = width - padding * 2;
        const graphHeight = height - padding * 2;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Draw histogram background
        this._drawHistogram(ctx, padding, padding, graphWidth, graphHeight);

        // Draw grid
        this._drawGrid(ctx, padding, padding, graphWidth, graphHeight);

        // Draw diagonal reference line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(padding, padding + graphHeight);
        ctx.lineTo(padding + graphWidth, padding);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw inactive channels faintly
        for (const channel of ['rgb', 'red', 'green', 'blue']) {
            if (channel !== this.activeChannel) {
                this._drawCurveLine(ctx, channel, 0.3);
            }
        }

        // Draw active channel curve
        this._drawCurveLine(ctx, this.activeChannel, 1.0);

        // Draw control points for active channel
        this._drawControlPoints(ctx);
    }

    _drawHistogram(ctx, x, y, w, h) {
        if (!this.histogramData) return;

        const channel = this.activeChannel;
        let data;

        if (channel === 'rgb') {
            // Luminosity histogram
            data = this.histogramData.luminosity || this.histogramData.rgb;
        } else {
            data = this.histogramData[channel];
        }

        if (!data || data.length === 0) return;

        const maxVal = Math.max(...data) || 1;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(x, y + h);

        for (let i = 0; i < data.length; i++) {
            const barX = x + (i / data.length) * w;
            const barHeight = (data[i] / maxVal) * h * 0.8;
            ctx.lineTo(barX, y + h - barHeight);
        }

        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fill();
    }

    _drawGrid(ctx, x, y, w, h) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Vertical lines (quarters)
        for (let i = 1; i < 4; i++) {
            const px = x + (i / 4) * w;
            ctx.beginPath();
            ctx.moveTo(px, y);
            ctx.lineTo(px, y + h);
            ctx.stroke();
        }

        // Horizontal lines (quarters)
        for (let i = 1; i < 4; i++) {
            const py = y + (i / 4) * h;
            ctx.beginPath();
            ctx.moveTo(x, py);
            ctx.lineTo(x + w, py);
            ctx.stroke();
        }

        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.strokeRect(x, y, w, h);
    }

    _getChannelColor(channel, alpha = 1) {
        const colors = {
            rgb: `rgba(255, 255, 255, ${alpha})`,
            red: `rgba(255, 100, 100, ${alpha})`,
            green: `rgba(100, 255, 100, ${alpha})`,
            blue: `rgba(100, 150, 255, ${alpha})`
        };
        return colors[channel];
    }

    _drawCurveLine(ctx, channel, alpha) {
        const { width, padding } = this.options;
        const graphWidth = width - padding * 2;

        ctx.beginPath();
        ctx.strokeStyle = this._getChannelColor(channel, alpha);
        ctx.lineWidth = alpha === 1 ? 2 : 1;

        // Draw smooth curve using many evaluation points
        const steps = 100;
        for (let i = 0; i <= steps; i++) {
            const x = i / steps;
            const y = this._evaluateCurve(channel, x);
            const coords = this._normalizedToCoords(x, y);

            if (i === 0) {
                ctx.moveTo(coords.x, coords.y);
            } else {
                ctx.lineTo(coords.x, coords.y);
            }
        }

        ctx.stroke();
    }

    _drawControlPoints(ctx) {
        const points = this.curves[this.activeChannel];
        const { pointRadius } = this.options;

        for (let i = 0; i < points.length; i++) {
            const coords = this._normalizedToCoords(points[i].x, points[i].y);
            const isHovered = i === this.hoveredPointIndex;
            const isSelected = i === this.selectedPointIndex;
            const isEndpoint = i === 0 || i === points.length - 1;

            // Point background
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, pointRadius + 2, 0, Math.PI * 2);
            ctx.fillStyle = isSelected || isHovered ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.5)';
            ctx.fill();

            // Point
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, pointRadius, 0, Math.PI * 2);
            ctx.fillStyle = this._getChannelColor(this.activeChannel);
            ctx.fill();

            // Point border
            ctx.strokeStyle = isSelected ? '#fff' : 'rgba(0, 0, 0, 0.5)';
            ctx.lineWidth = isSelected ? 2 : 1;
            ctx.stroke();

            // Inner dot for endpoints
            if (isEndpoint) {
                ctx.beginPath();
                ctx.arc(coords.x, coords.y, 2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fill();
            }
        }
    }

    /**
     * Cleanup
     */
    dispose() {
        this.element.remove();
    }
}

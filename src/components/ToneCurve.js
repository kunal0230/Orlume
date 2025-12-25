/**
 * ToneCurve - Interactive curve editor with Point Curve and Region Curve
 * 
 * Point Curve: Cubic Hermite spline with control points
 * Region Curve: Parametric adjustments (Shadows, Darks, Lights, Highlights)
 * 
 * Processing order: Y₁ = PointCurve(Y) → Y₂ = RegionCurve(Y₁)
 */

export class ToneCurve {
    constructor(canvasId, histogramData = null) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas?.getContext('2d');

        // Curve dimensions
        this.width = 256;
        this.height = 256;
        this.padding = 8;

        // Channel curves (each has its own points)
        this.channels = {
            rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            b: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
        };

        this.activeChannel = 'rgb';

        // Region curve parameters
        this.regions = {
            shadows: 0,    // -100 to +100
            darks: 0,
            lights: 0,
            highlights: 0
        };

        // LUTs (256 samples each)
        this.pointLUTs = {
            rgb: new Float32Array(256),
            r: new Float32Array(256),
            g: new Float32Array(256),
            b: new Float32Array(256)
        };
        this.regionLUT = new Float32Array(256);
        this.combinedLUTs = {
            rgb: new Float32Array(256),
            r: new Float32Array(256),
            g: new Float32Array(256),
            b: new Float32Array(256)
        };

        // Interaction state
        this.draggingPoint = null;
        this.hoverPoint = null;
        this.histogramData = histogramData;

        // Callbacks
        this.onChange = null;

        this._buildAllLUTs();
        this._bindEvents();
        this.render();
    }

    /**
     * Get active channel points
     */
    get points() {
        return this.channels[this.activeChannel];
    }

    /**
     * Set active channel
     */
    setChannel(channel) {
        if (this.channels[channel]) {
            this.activeChannel = channel;
            this.render();
        }
    }

    /**
     * Set region slider value
     */
    setRegion(region, value) {
        if (region in this.regions) {
            this.regions[region] = Math.max(-100, Math.min(100, value));
            this._buildRegionLUT();
            // Rebuild combined LUTs for ALL channels since region affects all
            for (const channel of ['rgb', 'r', 'g', 'b']) {
                this._buildCombinedLUT(channel);
            }
            this.render();
            this._notifyChange();
        }
    }

    /**
     * Set histogram data for overlay
     */
    setHistogram(data) {
        this.histogramData = data;
        this.render();
    }

    /**
     * Add a control point
     */
    addPoint(x, y) {
        const points = this.points;

        // Don't add if too close to existing point
        for (const p of points) {
            if (Math.abs(p.x - x) < 0.03) return;
        }

        // Insert in sorted order
        const newPoint = { x, y };
        let inserted = false;
        for (let i = 0; i < points.length; i++) {
            if (x < points[i].x) {
                points.splice(i, 0, newPoint);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            points.push(newPoint);
        }

        this._rebuildCurrentChannel();
        this.render();
        this._notifyChange();
    }

    /**
     * Remove a control point (cannot remove endpoints)
     */
    removePoint(index) {
        const points = this.points;
        if (index > 0 && index < points.length - 1) {
            points.splice(index, 1);
            this._rebuildCurrentChannel();
            this.render();
            this._notifyChange();
        }
    }

    /**
     * Move a control point
     */
    movePoint(index, x, y) {
        const points = this.points;
        const point = points[index];

        // Endpoints can only move vertically
        if (index === 0) {
            point.y = Math.max(0, Math.min(1, y));
        } else if (index === points.length - 1) {
            point.y = Math.max(0, Math.min(1, y));
        } else {
            // Clamp x between neighbors
            const minX = points[index - 1].x + 0.01;
            const maxX = points[index + 1].x - 0.01;
            point.x = Math.max(minX, Math.min(maxX, x));
            point.y = Math.max(0, Math.min(1, y));
        }

        this._rebuildCurrentChannel();
        this.render();
        this._notifyChange();
    }

    /**
     * Reset current channel to linear
     */
    resetChannel() {
        this.channels[this.activeChannel] = [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ];
        this._rebuildCurrentChannel();
        this.render();
        this._notifyChange();
    }

    /**
     * Reset all curves and regions
     */
    resetAll() {
        for (const channel of ['rgb', 'r', 'g', 'b']) {
            this.channels[channel] = [
                { x: 0, y: 0 },
                { x: 1, y: 1 }
            ];
        }
        this.regions = { shadows: 0, darks: 0, lights: 0, highlights: 0 };
        this._buildAllLUTs();
        this.render();
        this._notifyChange();
    }

    /**
     * Get combined LUTs for image processing
     */
    getLUTs() {
        return this.combinedLUTs;
    }

    /**
     * Monotonic Cubic Hermite Spline Interpolation
     * Ensures smooth, monotonic curve without overshoots
     */
    _interpolateSpline(points, x) {
        const n = points.length;

        // Find segment
        let i = 0;
        for (i = 0; i < n - 1; i++) {
            if (x <= points[i + 1].x) break;
        }
        if (i >= n - 1) i = n - 2;

        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[Math.min(n - 1, i + 1)];
        const p3 = points[Math.min(n - 1, i + 2)];

        // Compute slopes (tangents)
        const h1 = p2.x - p1.x;
        const t = h1 > 0 ? (x - p1.x) / h1 : 0;

        // Catmull-Rom to Hermite conversion
        let m1 = 0, m2 = 0;

        if (i > 0) {
            m1 = (p2.y - p0.y) / (p2.x - p0.x) * h1;
        } else {
            m1 = (p2.y - p1.y);
        }

        if (i < n - 2) {
            m2 = (p3.y - p1.y) / (p3.x - p1.x) * h1;
        } else {
            m2 = (p2.y - p1.y);
        }

        // Monotonicity enforcement
        const slope = (p2.y - p1.y) / (h1 || 1);
        if (slope === 0) {
            m1 = m2 = 0;
        } else {
            const alpha = m1 / slope;
            const beta = m2 / slope;
            if (alpha < 0) m1 = 0;
            if (beta < 0) m2 = 0;

            const mag = Math.sqrt(alpha * alpha + beta * beta);
            if (mag > 3) {
                m1 = m1 * 3 / mag;
                m2 = m2 * 3 / mag;
            }
        }

        // Hermite basis
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        const y = h00 * p1.y + h10 * m1 + h01 * p2.y + h11 * m2;
        return Math.max(0, Math.min(1, y));
    }

    /**
     * Build Point Curve LUT for a channel
     */
    _buildPointLUT(channel) {
        const points = this.channels[channel];
        const lut = this.pointLUTs[channel];

        for (let i = 0; i < 256; i++) {
            const x = i / 255;
            lut[i] = this._interpolateSpline(points, x);
        }
    }

    /**
     * Build Region Curve LUT
     * Applies smoothstep-weighted adjustments for each region
     * Regions work like Lightroom's parametric curve: Shadows, Darks, Lights, Highlights
     * 
     * Key principle: Adjustments are gentle (max ~15% change) to preserve color fidelity
     */
    _buildRegionLUT() {
        const lut = this.regionLUT;
        const { shadows, darks, lights, highlights } = this.regions;

        for (let i = 0; i < 256; i++) {
            const y = i / 255;
            let adjustment = 0;

            // Shadows: affects 0.00 - 0.30 range (dark areas)
            // Gentle adjustment to prevent crushing blacks
            if (shadows !== 0) {
                const weight = Math.max(0, 1 - (y / 0.30));
                const smoothWeight = weight * weight * (3 - 2 * weight);
                adjustment += (shadows / 100) * smoothWeight * 0.18;
            }

            // Darks: affects 0.15 - 0.45 range (shadow-midtone transition)
            if (darks !== 0) {
                const center = 0.30;
                const width = 0.20;
                const dist = Math.abs(y - center) / width;
                const weight = Math.max(0, 1 - dist);
                const smoothWeight = weight * weight * (3 - 2 * weight);
                adjustment += (darks / 100) * smoothWeight * 0.15;
            }

            // Lights: affects 0.55 - 0.85 range (midtone-highlight transition)
            if (lights !== 0) {
                const center = 0.70;
                const width = 0.20;
                const dist = Math.abs(y - center) / width;
                const weight = Math.max(0, 1 - dist);
                const smoothWeight = weight * weight * (3 - 2 * weight);
                adjustment += (lights / 100) * smoothWeight * 0.15;
            }

            // Highlights: affects 0.70 - 1.00 range (bright areas)
            // Gentle adjustment to prevent clipping to white
            if (highlights !== 0) {
                const weight = Math.max(0, (y - 0.70) / 0.30);
                const smoothWeight = weight * weight * (3 - 2 * weight);
                adjustment += (highlights / 100) * smoothWeight * 0.18;
            }

            lut[i] = Math.max(0, Math.min(1, y + adjustment));
        }
    }

    /**
     * Build combined LUT (Point → Region)
     */
    _buildCombinedLUT(channel) {
        const pointLUT = this.pointLUTs[channel];
        const regionLUT = this.regionLUT;
        const combined = this.combinedLUTs[channel];

        for (let i = 0; i < 256; i++) {
            // Apply point curve first
            const afterPoint = pointLUT[i];
            // Then apply region curve
            const regionIdx = Math.round(afterPoint * 255);
            combined[i] = regionLUT[regionIdx];
        }
    }

    /**
     * Rebuild current channel LUTs
     */
    _rebuildCurrentChannel() {
        this._buildPointLUT(this.activeChannel);
        this._buildCombinedLUT(this.activeChannel);
    }

    /**
     * Build all LUTs
     */
    _buildAllLUTs() {
        for (const channel of ['rgb', 'r', 'g', 'b']) {
            this._buildPointLUT(channel);
        }
        this._buildRegionLUT();
        for (const channel of ['rgb', 'r', 'g', 'b']) {
            this._buildCombinedLUT(channel);
        }
    }

    /**
     * Smoothstep function
     */
    _smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    /**
     * Bind mouse/touch events
     */
    _bindEvents() {
        if (!this.canvas) return;

        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this._onMouseUp());
        this.canvas.addEventListener('mouseleave', () => this._onMouseUp());
        this.canvas.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    }

    /**
     * Convert canvas coords to curve coords
     */
    _canvasToCurve(canvasX, canvasY) {
        const w = this.canvas.width - this.padding * 2;
        const h = this.canvas.height - this.padding * 2;
        return {
            x: (canvasX - this.padding) / w,
            y: 1 - (canvasY - this.padding) / h
        };
    }

    /**
     * Convert curve coords to canvas coords
     */
    _curveToCanvas(curveX, curveY) {
        const w = this.canvas.width - this.padding * 2;
        const h = this.canvas.height - this.padding * 2;
        return {
            x: this.padding + curveX * w,
            y: this.padding + (1 - curveY) * h
        };
    }

    /**
     * Find point near cursor
     */
    _findPointAt(curveX, curveY) {
        const points = this.points;
        const threshold = 0.04;

        for (let i = 0; i < points.length; i++) {
            const dx = points[i].x - curveX;
            const dy = points[i].y - curveY;
            if (Math.sqrt(dx * dx + dy * dy) < threshold) {
                return i;
            }
        }
        return -1;
    }

    _onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
        const { x, y } = this._canvasToCurve(canvasX, canvasY);

        const pointIdx = this._findPointAt(x, y);

        if (pointIdx >= 0) {
            this.draggingPoint = pointIdx;
        } else if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            // Add new point
            this.addPoint(x, y);
            // Start dragging the new point
            this.draggingPoint = this._findPointAt(x, y);
        }
    }

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
        const { x, y } = this._canvasToCurve(canvasX, canvasY);

        if (this.draggingPoint !== null) {
            this.movePoint(this.draggingPoint, x, y);
        } else {
            // Update hover state
            const prevHover = this.hoverPoint;
            this.hoverPoint = this._findPointAt(x, y);
            if (prevHover !== this.hoverPoint) {
                this.render();
            }
        }
    }

    _onMouseUp() {
        this.draggingPoint = null;
    }

    _onDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
        const { x, y } = this._canvasToCurve(canvasX, canvasY);

        const pointIdx = this._findPointAt(x, y);
        if (pointIdx > 0 && pointIdx < this.points.length - 1) {
            this.removePoint(pointIdx);
        }
    }

    _notifyChange() {
        if (this.onChange) {
            this.onChange(this.getLUTs());
        }
    }

    /**
     * Render the curve editor
     */
    render() {
        if (!this.ctx) return;

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const p = this.padding;
        const graphW = w - p * 2;
        const graphH = h - p * 2;

        // Clear
        ctx.fillStyle = '#1a1a1e';
        ctx.fillRect(0, 0, w, h);

        // Draw histogram overlay
        if (this.histogramData) {
            this._drawHistogram(ctx, p, p, graphW, graphH);
        }

        // Draw grid
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const x = p + (graphW * i / 4);
            const y = p + (graphH * i / 4);

            ctx.beginPath();
            ctx.moveTo(x, p);
            ctx.lineTo(x, p + graphH);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(p, y);
            ctx.lineTo(p + graphW, y);
            ctx.stroke();
        }

        // Draw diagonal reference
        ctx.strokeStyle = '#444';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(p, p + graphH);
        ctx.lineTo(p + graphW, p);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw curve
        const channelColors = {
            rgb: '#ffffff',
            r: '#ff6b6b',
            g: '#69db7c',
            b: '#74c0fc'
        };

        ctx.strokeStyle = channelColors[this.activeChannel];
        ctx.lineWidth = 2;
        ctx.beginPath();

        const lut = this.combinedLUTs[this.activeChannel];
        for (let i = 0; i < 256; i++) {
            const x = p + (i / 255) * graphW;
            const y = p + (1 - lut[i]) * graphH;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Draw control points
        const points = this.points;
        for (let i = 0; i < points.length; i++) {
            const { x, y } = this._curveToCanvas(points[i].x, points[i].y);

            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);

            if (i === this.hoverPoint || i === this.draggingPoint) {
                ctx.fillStyle = channelColors[this.activeChannel];
            } else {
                ctx.fillStyle = '#1a1a1e';
            }
            ctx.fill();
            ctx.strokeStyle = channelColors[this.activeChannel];
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    /**
     * Draw histogram behind curve
     */
    _drawHistogram(ctx, x, y, width, height) {
        const data = this.histogramData;
        if (!data || !data.luminance) return;

        const lum = data.luminance;
        const max = Math.max(...lum) || 1;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';

        const barWidth = width / 256;
        for (let i = 0; i < 256; i++) {
            const barHeight = (lum[i] / max) * height * 0.8;
            ctx.fillRect(
                x + i * barWidth,
                y + height - barHeight,
                barWidth,
                barHeight
            );
        }
    }
}

export class ColorGradingWheel {
    constructor(container, label, onChange, onInteractionEnd) {
        this.container = container;
        this.label = label;
        this.onChange = onChange;
        this.onInteractionEnd = onInteractionEnd || null; // FIXED: color-grading-history

        // State
        this.hue = 0; // 0-1
        this.sat = 0; // 0-1
        this.lum = 0; // -100 to 100

        this.isDragging = false;
        this.dragMode = 'both'; // 'both', 'hue', 'sat'

        // Bound event listeners for clean attach/detach
        this._boundMouseMove = this._onMouseMove.bind(this);
        this._boundMouseUp = this._onMouseUp.bind(this);
        this._boundTouchMove = this._onTouchMove.bind(this);
        this._boundTouchEnd = this._onTouchEnd.bind(this);

        this._init();
    }

    _init() {
        // Container element
        this.element = document.createElement('div');
        this.element.className = 'color-grade-wheel';
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.element.style.alignItems = 'center';
        this.element.style.width = '100%';
        this.element.style.marginBottom = '14px';

        // Header with label and luminance readout
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.width = '130px';
        header.style.marginBottom = '6px';

        const labelEl = document.createElement('span');
        labelEl.textContent = this.label;
        labelEl.style.fontSize = '12px';
        labelEl.style.color = 'var(--text-primary, #ddd)';
        labelEl.style.fontWeight = '600';

        this.lumValEl = document.createElement('span');
        this.lumValEl.textContent = '0';
        this.lumValEl.style.fontSize = '11px';
        this.lumValEl.style.color = 'var(--text-secondary, #888)';

        header.appendChild(labelEl);
        header.appendChild(this.lumValEl);
        this.element.appendChild(header);

        // Canvas Container
        const canvasWrap = document.createElement('div');
        canvasWrap.style.position = 'relative';
        canvasWrap.style.width = '120px';
        canvasWrap.style.height = '120px';
        canvasWrap.style.cursor = 'crosshair';
        this.element.appendChild(canvasWrap);

        // Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = 120;
        this.canvas.height = 120;
        this.canvas.style.width = '120px';
        this.canvas.style.height = '120px';
        this.canvas.style.borderRadius = '50%';
        this.canvas.style.touchAction = 'none';
        canvasWrap.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        // Mouse Events
        this.canvas.addEventListener('mousedown', this._onMouseDown.bind(this));

        // Touch Events
        this.canvas.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });

        // Double click to reset wheel hue & sat
        this.canvas.addEventListener('dblclick', () => {
            this.hue = 0;
            this.sat = 0;
            this._draw();
            this.onChange(this.hue, this.sat, this.lum);
            this.onInteractionEnd?.();
        });

        // Luminance Slider Container
        const lumContainer = document.createElement('div');
        lumContainer.style.width = '120px';
        lumContainer.style.marginTop = '8px';
        lumContainer.style.display = 'flex';
        lumContainer.style.alignItems = 'center';

        this.lumSlider = document.createElement('input');
        this.lumSlider.type = 'range';
        this.lumSlider.min = '-100';
        this.lumSlider.max = '100';
        this.lumSlider.value = '0';
        this.lumSlider.style.width = '100%';
        this.lumSlider.style.height = '4px';
        this.lumSlider.style.accentColor = '#888';

        this.lumSlider.addEventListener('input', (e) => {
            this.lum = parseFloat(e.target.value);
            this._updateLumDisplay();
            this.onChange(this.hue, this.sat, this.lum);
        });
        this.lumSlider.addEventListener('change', () => {
            this.onInteractionEnd?.();
        });
        this.lumSlider.addEventListener('dblclick', () => {
            this.lum = 0;
            this.lumSlider.value = '0';
            this._updateLumDisplay();
            this.onChange(this.hue, this.sat, this.lum);
            this.onInteractionEnd?.();
        });

        lumContainer.appendChild(this.lumSlider);
        this.element.appendChild(lumContainer);

        this.container.appendChild(this.element);

        this._draw();
    }

    _updateLumDisplay() {
        if (!this.lumValEl) return;
        const val = Math.round(this.lum);
        this.lumValEl.textContent = val > 0 ? `+${val}` : `${val}`;
    }

    _onMouseDown(e) {
        if (e.button !== 0) return; // Only main button
        this.isDragging = true;
        this._updateFromEvent(e);

        window.addEventListener('mousemove', this._boundMouseMove);
        window.addEventListener('mouseup', this._boundMouseUp);
    }

    _onMouseMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this._updateFromEvent(e);
    }

    _onMouseUp(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        window.removeEventListener('mousemove', this._boundMouseMove);
        window.removeEventListener('mouseup', this._boundMouseUp);
        this.onInteractionEnd?.();
    }

    _onTouchStart(e) {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        this.isDragging = true;
        this._updateFromEvent(e.touches[0]);

        window.addEventListener('touchmove', this._boundTouchMove, { passive: false });
        window.addEventListener('touchend', this._boundTouchEnd);
        window.addEventListener('touchcancel', this._boundTouchEnd);
    }

    _onTouchMove(e) {
        if (!this.isDragging || e.touches.length !== 1) return;
        e.preventDefault();
        this._updateFromEvent(e.touches[0]);
    }

    _onTouchEnd() {
        if (!this.isDragging) return;
        this.isDragging = false;
        window.removeEventListener('touchmove', this._boundTouchMove);
        window.removeEventListener('touchend', this._boundTouchEnd);
        window.removeEventListener('touchcancel', this._boundTouchEnd);
        this.onInteractionEnd?.();
    }

    _updateFromEvent(e) {
        const rect = this.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const dx = (e.clientX - rect.left) - centerX;
        const dy = (e.clientY - rect.top) - centerY;

        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = rect.width / 2;
        const activeRadius = radius - 4;

        let newSat;
        let newHue;

        if (dist < 3) {
            // Snapping deadzone in center = neutral
            newSat = 0;
            newHue = this.hue;
        } else {
            newSat = Math.min(1.0, dist / activeRadius);
            const angle = Math.atan2(dy, dx);
            newHue = (angle / (Math.PI * 2)) + 0.5;
        }

        // Shift modifier locks Hue, changes only Saturation
        if (e.shiftKey) {
            newHue = this.hue;
        }

        this.hue = newHue;
        this.sat = newSat;

        this._draw();
        this.onChange(this.hue, this.sat, this.lum);
    }

    setValue(hue, sat, lum) {
        this.hue = hue !== undefined ? hue : 0;
        this.sat = sat !== undefined ? sat : 0;
        if (lum !== undefined) {
            this.lum = lum;
            this.lumSlider.value = `${lum}`;
            this._updateLumDisplay();
        }
        this._draw();
    }

    _draw() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = w / 2;
        const activeRadius = radius - 4;

        this.ctx.clearRect(0, 0, w, h);

        // 1. Draw Color Wheel
        if (!this._wheelImage) {
            this._createWheelImage(w, h);
        }
        this.ctx.drawImage(this._wheelImage, 0, 0);

        // 2. Draw Handle
        const angle = (this.hue - 0.5) * Math.PI * 2;
        const r = this.sat * activeRadius;

        const hx = cx + Math.cos(angle) * r;
        const hy = cy + Math.sin(angle) * r;

        // Draw guide line from center to handle when saturated
        if (this.sat > 0.05) {
            this.ctx.beginPath();
            this.ctx.moveTo(cx, cy);
            this.ctx.lineTo(hx, hy);
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }

        // Draw Handle Circle
        this.ctx.beginPath();
        this.ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.fillStyle = this.sat > 0
            ? `hsl(${Math.round(this.hue * 360)}, ${Math.round(this.sat * 100)}%, 50%)`
            : '#888888';
        this.ctx.fill();
        this.ctx.stroke();

        // Draw center crosshair
        this.ctx.beginPath();
        this.ctx.moveTo(cx - 3, cy);
        this.ctx.lineTo(cx + 3, cy);
        this.ctx.moveTo(cx, cy - 3);
        this.ctx.lineTo(cx, cy + 3);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    _createWheelImage(w, h) {
        const buffer = document.createElement('canvas');
        buffer.width = w;
        buffer.height = h;
        const ctx = buffer.getContext('2d');

        const cx = w / 2;
        const cy = h / 2;
        const radius = w / 2;

        const imageData = ctx.createImageData(w, h);
        const data = imageData.data;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const index = (y * w + x) * 4;
                const dx = x - cx;
                const dy = y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > radius) {
                    data[index + 3] = 0; // Transparent
                    continue;
                }

                // Angle
                const angle = Math.atan2(dy, dx);
                const hue = (angle / (Math.PI * 2)) + 0.5;

                // Saturation gradient (neutral center -> color edge)
                const sat = dist / radius;

                const rgb = this._hslToRgb(hue, sat, 0.5);

                data[index] = rgb[0];
                data[index + 1] = rgb[1];
                data[index + 2] = rgb[2];
                data[index + 3] = 255;

                // Antialias edge
                if (dist > radius - 1) {
                    data[index + 3] = 255 * (radius - dist);
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        this._wheelImage = buffer; // Cache it
    }

    _hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p, q, t) => {
                let tc = t;
                if (tc < 0) tc += 1;
                if (tc > 1) tc -= 1;
                if (tc < 1 / 6) return p + (q - p) * 6 * tc;
                if (tc < 1 / 2) return q;
                if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    destroy() {
        if (this._boundMouseMove) {
            window.removeEventListener('mousemove', this._boundMouseMove);
        }
        if (this._boundMouseUp) {
            window.removeEventListener('mouseup', this._boundMouseUp);
        }
        if (this._boundTouchMove) {
            window.removeEventListener('touchmove', this._boundTouchMove);
        }
        if (this._boundTouchEnd) {
            window.removeEventListener('touchend', this._boundTouchEnd);
            window.removeEventListener('touchcancel', this._boundTouchEnd);
        }
        this.element?.remove();
    }
}

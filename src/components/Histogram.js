/**
 * Histogram Component
 * Calculates and visualizes image tonal distribution
 */
export class Histogram {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.mode = 'rgb'; // rgb, red, green, blue, lum
        this.data = null;

        this.init();
    }

    init() {
        // Handle Channel Selection
        const buttons = document.querySelectorAll('.channel-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Update UI
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update Mode
                this.mode = btn.dataset.channel;
                if (this.data) this.draw();
            });
        });
    }

    /**
     * Update histogram data from an image source
     * @param {HTMLImageElement|HTMLCanvasElement|Object} sourceImage - Can be an element or proxy object
     */
    async update(sourceImage) {
        console.log('[Histogram] update called with:', sourceImage);
        if (!sourceImage) return;

        // Handle "Proxy" objects (plain objects with src/imageData/canvas)
        // Priority: 1. Use imageData directly (fastest), 2. Use canvas, 3. Load from src

        const isElement = sourceImage instanceof HTMLImageElement ||
            sourceImage instanceof HTMLCanvasElement ||
            sourceImage instanceof ImageBitmap;

        // If proxy has imageData, use it directly (most efficient)
        if (!isElement && sourceImage.imageData) {
            console.log('[Histogram] Using imageData directly from proxy');
            this.calculate(sourceImage.imageData.data);
            this.draw();
            console.log('[Histogram] Update complete (via imageData)');
            return;
        }

        // Determine what to draw from
        let drawable = sourceImage;

        if (!isElement) {
            console.log('[Histogram] Source is a proxy/object, converting...');

            // Check if proxy has a canvas we can draw from
            if (sourceImage.canvas) {
                drawable = sourceImage.canvas;
                console.log('[Histogram] Using canvas from proxy');
            } else if (sourceImage.src) {
                // It's a proxy with a src URL. We need to load it into an Image.
                drawable = await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        console.log('[Histogram] Proxy image loaded successfully');
                        resolve(img);
                    };
                    img.onerror = () => {
                        console.error('Histogram: Failed to load proxy image', sourceImage.src);
                        resolve(null);
                    };
                    img.setAttribute('crossOrigin', 'anonymous');
                    img.src = sourceImage.src;
                });
            }
        }

        if (!drawable) {
            console.error('[Histogram] No drawable source available');
            return;
        }

        // Use standard canvas for compatibility
        const sampleSize = 256; // Smaller is faster and sufficient for histogram
        const offscreen = document.createElement('canvas');
        offscreen.width = sampleSize;
        offscreen.height = sampleSize;
        const ctx = offscreen.getContext('2d');

        // Get dimensions from the drawable
        const srcWidth = drawable.width || drawable.naturalWidth || sampleSize;
        const srcHeight = drawable.height || drawable.naturalHeight || sampleSize;

        // Draw image resized (preserving aspect ratio to fit)
        const scale = Math.min(sampleSize / srcWidth, sampleSize / srcHeight);
        const w = Math.max(1, Math.floor(srcWidth * scale));
        const h = Math.max(1, Math.floor(srcHeight * scale));

        console.log(`[Histogram] Drawing to temp canvas ${w}x${h}`);

        try {
            ctx.drawImage(drawable, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            this.calculate(imageData.data);
            this.draw();
            console.log('[Histogram] Update complete');
        } catch (e) {
            console.warn('Cannot calculate histogram:', e);
        }
    }

    calculate(data) {
        // Initialize arrays
        const r = new Uint32Array(256);
        const g = new Uint32Array(256);
        const b = new Uint32Array(256);
        const l = new Uint32Array(256);

        // Loop through pixels (R, G, B, A)
        for (let i = 0; i < data.length; i += 4) {
            const red = data[i];
            const green = data[i + 1];
            const blue = data[i + 2];

            // Luminance (Rec. 709)
            const lum = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);

            r[red]++;
            g[green]++;
            b[blue]++;
            l[lum]++;
        }

        // Find max value for normalization
        // We clamp the max so single spikes don't flatten the rest of the graph
        // Taking the max of all channels
        const maxVal = Math.max(
            Math.max(...r),
            Math.max(...g),
            Math.max(...b)
        );

        const maxCount = maxVal > 0 ? maxVal : 1;

        this.data = { r, g, b, l, maxCount };
    }

    draw() {
        if (!this.data || !this.ctx) return;

        const { width, height } = this.canvas;
        const ctx = this.ctx;
        const { r, g, b, l, maxCount } = this.data;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Composite mode for additive mixing
        ctx.globalCompositeOperation = 'screen';

        // Draw Helper
        const drawChannel = (array, color, fill = true) => {
            ctx.beginPath();
            ctx.moveTo(0, height);

            for (let i = 0; i < 256; i++) {
                const x = (i / 255) * width;
                // Linear scaling
                const normalized = array[i] / maxCount;
                const h = normalized * height * 0.95;
                ctx.lineTo(x, height - h);
            }

            ctx.lineTo(width, height);
            ctx.closePath();

            ctx.fillStyle = color;
            if (fill) ctx.fill();
        };

        if (this.mode === 'rgb') {
            drawChannel(r, 'rgba(255, 0, 0, 0.6)');
            drawChannel(g, 'rgba(0, 255, 0, 0.6)');
            drawChannel(b, 'rgba(0, 50, 255, 0.6)');

            // Draw gray overlap lightly
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            drawChannel(l, 'transparent', false);
            ctx.stroke();

        } else if (this.mode === 'red') {
            ctx.globalCompositeOperation = 'source-over';
            drawChannel(r, '#ff4444');
        } else if (this.mode === 'green') {
            ctx.globalCompositeOperation = 'source-over';
            drawChannel(g, '#44ff44');
        } else if (this.mode === 'blue') {
            ctx.globalCompositeOperation = 'source-over';
            drawChannel(b, '#4488ff');
        } else if (this.mode === 'lum') {
            ctx.globalCompositeOperation = 'source-over';
            drawChannel(l, '#dddddd');
        }
    }
}

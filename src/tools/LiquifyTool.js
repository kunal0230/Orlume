/**
 * LiquifyTool - WebGL-based mesh warping tool
 * 
 * Provides Photoshop-like liquify functionality with 6 modes:
 * - Push: Move pixels in brush direction
 * - Enlarge: Bloat/expand area
 * - Shrink: Pucker/contract area
 * - Swirl Right: Clockwise rotation
 * - Swirl Left: Counter-clockwise rotation
 * - Reset: Restore to original
 */

export class LiquifyTool {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.isActive = false;
        this.isDragging = false;

        // Grid resolution
        this.gridWidth = 128;
        this.gridHeight = 128;

        // Brush settings
        this.brushSize = 100;      // pixels
        this.brushStrength = 0.5;  // 0-1
        this.brushDensity = 0.75;  // 0-1
        this.mode = 'push';        // push, enlarge, shrink, swirlRight, swirlLeft, reset

        // Vertex data
        this.originalPositions = null;
        this.currentPositions = null;
        this.texCoords = null;
        this.indices = null;

        // Mouse tracking
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // WebGL buffers
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.indexBuffer = null;
        this.texture = null;

        // Source image
        this.sourceImage = null;
        this.imageWidth = 0;
        this.imageHeight = 0;

        // High quality mode
        this.highQuality = false;
    }

    /**
     * Initialize WebGL context and shaders
     */
    init() {
        this.gl = this.canvas.getContext('webgl2', {
            preserveDrawingBuffer: true,
            antialias: true
        });

        if (!this.gl) {
            console.error('WebGL2 not supported');
            return false;
        }

        this._createShaders();
        return true;
    }

    /**
     * Create vertex and fragment shaders
     */
    _createShaders() {
        const gl = this.gl;

        // Vertex shader - handles mesh deformation
        const vertexSource = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            
            out vec2 v_texCoord;
            
            void main() {
                // Convert from pixel coords to clip space (-1 to 1)
                vec2 clipSpace = (a_position / vec2(${this.canvas.width}.0, ${this.canvas.height}.0)) * 2.0 - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord;
            }
        `;

        // Fragment shader - samples texture
        const fragmentSource = `#version 300 es
            precision highp float;
            
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform sampler2D u_texture;
            
            void main() {
                fragColor = texture(u_texture, v_texCoord);
            }
        `;

        // Compile shaders
        const vertexShader = this._compileShader(gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, fragmentSource);

        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader program failed:', gl.getProgramInfoLog(this.program));
        }
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    /**
     * Set the source image for liquify
     */
    setImage(imageOrCanvas) {
        const gl = this.gl;

        this.sourceImage = imageOrCanvas;
        this.imageWidth = imageOrCanvas.width;
        this.imageHeight = imageOrCanvas.height;

        // Resize canvas to match image
        this.canvas.width = this.imageWidth;
        this.canvas.height = this.imageHeight;
        gl.viewport(0, 0, this.imageWidth, this.imageHeight);

        // Recreate shaders with new dimensions
        this._createShaders();

        // Create texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageOrCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Initialize grid
        this._initGrid();

        // Initial render
        this.render();
    }

    /**
     * Initialize the deformation grid
     */
    _initGrid() {
        const width = this.imageWidth;
        const height = this.imageHeight;
        const gridW = this.highQuality ? 256 : this.gridWidth;
        const gridH = this.highQuality ? 256 : this.gridHeight;

        // Create position and texcoord arrays
        const positions = [];
        const texCoords = [];

        for (let y = 0; y <= gridH; y++) {
            for (let x = 0; x <= gridW; x++) {
                // Pixel position
                const px = (x / gridW) * width;
                const py = (y / gridH) * height;
                positions.push(px, py);

                // Texture coordinate (0-1)
                texCoords.push(x / gridW, y / gridH);
            }
        }

        // Create index array for triangles
        const indices = [];
        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                const topLeft = y * (gridW + 1) + x;
                const topRight = topLeft + 1;
                const bottomLeft = (y + 1) * (gridW + 1) + x;
                const bottomRight = bottomLeft + 1;

                // Two triangles per cell
                indices.push(topLeft, bottomLeft, topRight);
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }

        // Store arrays
        this.originalPositions = new Float32Array(positions);
        this.currentPositions = new Float32Array(positions);
        this.texCoords = new Float32Array(texCoords);
        this.indices = new Uint32Array(indices);

        // Create WebGL buffers
        this._createBuffers();
    }

    _createBuffers() {
        const gl = this.gl;

        // Position buffer
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.currentPositions, gl.DYNAMIC_DRAW);

        // TexCoord buffer
        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.texCoords, gl.STATIC_DRAW);

        // Index buffer
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);
    }

    /**
     * Render the deformed mesh
     */
    render() {
        const gl = this.gl;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind position attribute
        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.currentPositions, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Bind texcoord attribute
        const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

        // Bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(gl.getUniformLocation(this.program, 'u_texture'), 0);

        // Draw
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);
    }

    /**
     * Apply brush at position
     */
    applyBrush(x, y, deltaX = 0, deltaY = 0) {
        const gridW = this.highQuality ? 256 : this.gridWidth;
        const gridH = this.highQuality ? 256 : this.gridHeight;
        const verticesPerRow = gridW + 1;

        const radius = this.brushSize;
        const strength = this.brushStrength * this.brushDensity;  // Removed 0.1 multiplier for stronger effect

        // Calculate bounding box for optimization
        const minX = Math.max(0, Math.floor((x - radius) / this.imageWidth * gridW) - 1);
        const maxX = Math.min(gridW, Math.ceil((x + radius) / this.imageWidth * gridW) + 1);
        const minY = Math.max(0, Math.floor((y - radius) / this.imageHeight * gridH) - 1);
        const maxY = Math.min(gridH, Math.ceil((y + radius) / this.imageHeight * gridH) + 1);

        // Process vertices in bounding box
        for (let gy = minY; gy <= maxY; gy++) {
            for (let gx = minX; gx <= maxX; gx++) {
                const idx = (gy * verticesPerRow + gx) * 2;

                const vx = this.currentPositions[idx];
                const vy = this.currentPositions[idx + 1];

                // Distance from brush center
                const dx = vx - x;
                const dy = vy - y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < radius) {
                    // Smooth falloff (bell curve)
                    const falloff = Math.pow(1 - dist / radius, 2);
                    const effect = strength * falloff;

                    // Apply mode-specific deformation
                    switch (this.mode) {
                        case 'push':
                            this._applyPush(idx, deltaX, deltaY, effect);
                            break;
                        case 'enlarge':
                            this._applyEnlarge(idx, dx, dy, dist, effect);
                            break;
                        case 'shrink':
                            this._applyShrink(idx, dx, dy, dist, effect);
                            break;
                        case 'swirlRight':
                            this._applySwirl(idx, x, y, effect, 1);
                            break;
                        case 'swirlLeft':
                            this._applySwirl(idx, x, y, effect, -1);
                            break;
                        case 'reset':
                            this._applyReset(idx, effect);
                            break;
                    }
                }
            }
        }

        this.render();
    }

    _applyPush(idx, deltaX, deltaY, effect) {
        this.currentPositions[idx] += deltaX * effect * 5;  // Increased from 2 to 5
        this.currentPositions[idx + 1] += deltaY * effect * 5;
    }

    _applyEnlarge(idx, dx, dy, dist, effect) {
        if (dist > 0.001) {
            const nx = dx / dist;
            const ny = dy / dist;
            this.currentPositions[idx] += nx * effect * this.brushSize * 0.3;  // Increased from 0.1 to 0.3
            this.currentPositions[idx + 1] += ny * effect * this.brushSize * 0.3;
        }
    }

    _applyShrink(idx, dx, dy, dist, effect) {
        if (dist > 0.001) {
            const nx = dx / dist;
            const ny = dy / dist;
            this.currentPositions[idx] -= nx * effect * this.brushSize * 0.3;  // Increased from 0.1 to 0.3
            this.currentPositions[idx + 1] -= ny * effect * this.brushSize * 0.3;
        }
    }

    _applySwirl(idx, centerX, centerY, effect, direction) {
        const vx = this.currentPositions[idx];
        const vy = this.currentPositions[idx + 1];

        const dx = vx - centerX;
        const dy = vy - centerY;

        const angle = effect * 0.3 * direction;  // Increased from 0.1 to 0.3
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const newX = dx * cos - dy * sin;
        const newY = dx * sin + dy * cos;

        this.currentPositions[idx] = newX + centerX;
        this.currentPositions[idx + 1] = newY + centerY;
    }

    _applyReset(idx, effect) {
        const originalX = this.originalPositions[idx];
        const originalY = this.originalPositions[idx + 1];
        const currentX = this.currentPositions[idx];
        const currentY = this.currentPositions[idx + 1];

        // Lerp toward original
        this.currentPositions[idx] = currentX + (originalX - currentX) * effect * 2;  // Increased from 0.5 to 2
        this.currentPositions[idx + 1] = currentY + (originalY - currentY) * effect * 2;
    }

    /**
     * Reset entire mesh to original
     */
    resetAll() {
        if (this.originalPositions) {
            this.currentPositions = new Float32Array(this.originalPositions);
            this.render();
        }
    }

    /**
     * Get the result as a canvas
     */
    getResultCanvas() {
        // The WebGL canvas already contains the result
        return this.canvas;
    }

    /**
     * Export result to a new canvas (for applying to main editor)
     */
    exportToCanvas(targetCanvas) {
        const ctx = targetCanvas.getContext('2d');
        targetCanvas.width = this.imageWidth;
        targetCanvas.height = this.imageHeight;
        ctx.drawImage(this.canvas, 0, 0);
        return targetCanvas;
    }

    // Setters
    setMode(mode) {
        this.mode = mode;
    }

    setBrushSize(size) {
        this.brushSize = Math.max(10, Math.min(500, size));
    }

    setBrushStrength(strength) {
        this.brushStrength = Math.max(0, Math.min(1, strength));
    }

    setBrushDensity(density) {
        this.brushDensity = Math.max(0, Math.min(1, density));
    }

    setHighQuality(enabled) {
        this.highQuality = enabled;
        if (this.sourceImage) {
            this._initGrid();
            this.render();
        }
    }

    // Mouse handlers
    onMouseDown(x, y) {
        this.isDragging = true;
        this.lastMouseX = x;
        this.lastMouseY = y;

        // Apply initial brush (for non-push modes)
        if (this.mode !== 'push') {
            this.applyBrush(x, y, 0, 0);
        }
    }

    onMouseMove(x, y) {
        if (!this.isDragging) return;

        const deltaX = x - this.lastMouseX;
        const deltaY = y - this.lastMouseY;

        this.applyBrush(x, y, deltaX, deltaY);

        this.lastMouseX = x;
        this.lastMouseY = y;
    }

    onMouseUp() {
        this.isDragging = false;
    }

    dispose() {
        const gl = this.gl;
        if (gl) {
            if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
            if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
            if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
            if (this.texture) gl.deleteTexture(this.texture);
            if (this.program) gl.deleteProgram(this.program);
        }
    }
}

# Orlume - Practical Implementation Plan

**Purpose:** Step-by-step actionable guide for implementing the roadmap.  
**Created:** December 26, 2024

---

## Quick Navigation

1. [Immediate Tasks (This Week)](#1-immediate-tasks-this-week)
2. [Sprint 1: Core Editor Improvements](#2-sprint-1-core-editor-improvements)
3. [Sprint 2: Advanced Adjustments](#3-sprint-2-advanced-adjustments)
4. [Sprint 3: AI Features](#4-sprint-3-ai-features)
5. [Sprint 4: Cloud Backend](#5-sprint-4-cloud-backend)
6. [Sprint 5: Collaboration](#6-sprint-5-collaboration)
7. [Sprint 6: Pro Features](#7-sprint-6-pro-features)

---

## 1. Immediate Tasks (This Week)

### 1.1 Fix Export Quality
**Problem:** Export currently exports canvas directly, losing quality.

**Steps:**
```
1. Open: src/app/EditorUI.js
2. Find: exportImage() method (line ~712)
3. Modify to:
   - Create offscreen canvas at original resolution
   - Apply all GPU adjustments at full resolution
   - Export at full quality
```

**Code Pattern:**
```javascript
// In EditorUI.js
exportImage() {
  // Create full-resolution offscreen canvas
  const offscreen = new OffscreenCanvas(
    this.state.originalImage.width,
    this.state.originalImage.height
  );
  
  // Render at full resolution
  const fullResGpu = new GPUProcessor(offscreen);
  fullResGpu.loadImage(this.state.originalImage);
  
  // Copy current adjustments
  Object.entries(this.state.adjustments).forEach(([key, val]) => {
    fullResGpu.setParam(key, val);
  });
  
  // Export
  offscreen.convertToBlob({ type: 'image/png', quality: 1.0 })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'orlume-export.png';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    });
}
```

**Time:** 2 hours

---

### 1.2 Add JPEG Export with Quality Slider
**Steps:**
```
1. Add export format dropdown to UI (index.html)
2. Add quality slider (1-100) 
3. Modify exportImage() to accept format and quality
```

**UI Addition (index.html):**
```html
<!-- Add after btn-export -->
<div class="control-group" id="export-options" style="display: none;">
  <select id="export-format">
    <option value="png">PNG (Lossless)</option>
    <option value="jpeg">JPEG (Smaller)</option>
    <option value="webp">WebP (Best)</option>
  </select>
  <div class="control-label">
    <span>Quality</span>
    <span id="val-export-quality">95</span>
  </div>
  <input type="range" id="slider-export-quality" min="1" max="100" value="95">
</div>
```

**Time:** 1 hour

---

### 1.3 Add Keyboard Shortcuts Display
**Steps:**
```
1. Create keyboard-shortcuts.md documentation
2. Add "?" key to show shortcuts modal
3. Style modal
```

**Time:** 1 hour

---

## 2. Sprint 1: Core Editor Improvements

### 2.1 Undo/Redo System
**Priority:** HIGH  
**Files to modify:**
- `src/app/EditorState.js`
- `src/app/EditorUI.js`
- `index.html`

**Step 1: Add History Stack to State**
```javascript
// In EditorState.js - add to constructor
this.history = [];
this.historyIndex = -1;
this.maxHistory = 50;
```

**Step 2: Track Changes**
```javascript
// In EditorState.js
pushHistory(action) {
  // Remove any redo states
  this.history = this.history.slice(0, this.historyIndex + 1);
  
  // Add new state
  this.history.push({
    action,
    state: JSON.parse(JSON.stringify(this.adjustments)),
    timestamp: Date.now()
  });
  
  // Limit history size
  if (this.history.length > this.maxHistory) {
    this.history.shift();
  } else {
    this.historyIndex++;
  }
}

undo() {
  if (this.historyIndex < 0) return null;
  const state = this.history[this.historyIndex];
  this.historyIndex--;
  return state;
}

redo() {
  if (this.historyIndex >= this.history.length - 1) return null;
  this.historyIndex++;
  return this.history[this.historyIndex];
}
```

**Step 3: Add UI Buttons & Shortcuts**
```javascript
// In EditorUI.js - _initKeyboardShortcuts
if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
  if (e.shiftKey) {
    this.redo();
  } else {
    this.undo();
  }
  e.preventDefault();
}
```

**Time:** 4 hours

---

### 2.2 Zoom & Pan Controls
**Priority:** MEDIUM  
**Files:**
- `src/app/EditorUI.js`
- `src/styles/editor.css`

**Step 1: Add Zoom State**
```javascript
// In EditorState.js
this.view = {
  zoom: 1,
  panX: 0,
  panY: 0,
  minZoom: 0.1,
  maxZoom: 10
};
```

**Step 2: Implement Zoom**
```javascript
// In EditorUI.js
_initZoomPan() {
  const canvas = this.elements.canvas;
  
  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, this.state.view.zoom * delta));
    
    // Zoom toward cursor position
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    this.state.view.zoom = newZoom;
    this.updateCanvasTransform();
  });
  
  // Pan with space + drag
  let isPanning = false;
  let startPan = { x: 0, y: 0 };
  
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !this.state.showingBefore) {
      canvas.style.cursor = 'grab';
    }
  });
  
  canvas.addEventListener('mousedown', (e) => {
    if (e.spaceKey || this.state.currentTool === 'pan') {
      isPanning = true;
      startPan = { x: e.clientX - this.state.view.panX, y: e.clientY - this.state.view.panY };
      canvas.style.cursor = 'grabbing';
    }
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (isPanning) {
      this.state.view.panX = e.clientX - startPan.x;
      this.state.view.panY = e.clientY - startPan.y;
      this.updateCanvasTransform();
    }
  });
}

updateCanvasTransform() {
  const canvas = this.elements.canvas;
  canvas.style.transform = `translate(${this.state.view.panX}px, ${this.state.view.panY}px) scale(${this.state.view.zoom})`;
}
```

**Step 3: Add Zoom Indicator UI**
```html
<!-- Add to index.html -->
<div class="zoom-controls">
  <button id="btn-zoom-out">−</button>
  <span id="zoom-level">100%</span>
  <button id="btn-zoom-in">+</button>
  <button id="btn-zoom-fit">Fit</button>
</div>
```

**Time:** 3 hours

---

### 2.3 Before/After Comparison Slider
**Priority:** MEDIUM

**Step 1: Add Split View Canvas**
```javascript
// Create comparison slider UI
class ComparisonSlider {
  constructor(container) {
    this.container = container;
    this.slider = null;
    this.position = 50; // percent
    this.init();
  }
  
  init() {
    this.slider = document.createElement('div');
    this.slider.className = 'comparison-slider';
    this.slider.innerHTML = `
      <div class="slider-line"></div>
      <div class="slider-handle">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path d="M8 5v14l-5-7zM16 5v14l5-7z" fill="currentColor"/>
        </svg>
      </div>
    `;
    this.container.appendChild(this.slider);
    this.bindEvents();
  }
  
  bindEvents() {
    let isDragging = false;
    
    this.slider.addEventListener('mousedown', () => isDragging = true);
    document.addEventListener('mouseup', () => isDragging = false);
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = this.container.getBoundingClientRect();
      this.position = ((e.clientX - rect.left) / rect.width) * 100;
      this.position = Math.max(0, Math.min(100, this.position));
      this.update();
    });
  }
  
  update() {
    this.slider.style.left = `${this.position}%`;
    // Clip the "after" canvas
    const afterCanvas = document.getElementById('gpu-canvas');
    afterCanvas.style.clipPath = `inset(0 ${100 - this.position}% 0 0)`;
  }
}
```

**Time:** 2 hours

---

## 3. Sprint 2: Advanced Adjustments

### 3.1 Tone Curve
**Priority:** HIGH  
**Complexity:** Medium

**Files to create:**
- `src/components/ToneCurve.js` (new)
- Shader code in `src/gpu/GPUProcessor.js`

**Step 1: Create ToneCurve Component**
```javascript
// src/components/ToneCurve.js
export class ToneCurve {
  constructor(container, onChange) {
    this.container = container;
    this.onChange = onChange;
    this.canvas = null;
    this.ctx = null;
    this.points = [
      { x: 0, y: 0 },     // Black point
      { x: 255, y: 255 }  // White point
    ];
    this.activeChannel = 'rgb'; // rgb, r, g, b
    this.init();
  }
  
  init() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.canvas.className = 'tone-curve-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    
    this.bindEvents();
    this.render();
  }
  
  // Catmull-Rom spline interpolation
  interpolate() {
    const lut = new Uint8Array(256);
    
    for (let i = 0; i < 256; i++) {
      lut[i] = this.getValueAt(i);
    }
    
    return lut;
  }
  
  getValueAt(x) {
    // Find surrounding control points
    let p0, p1, p2, p3;
    for (let i = 0; i < this.points.length - 1; i++) {
      if (x >= this.points[i].x && x <= this.points[i + 1].x) {
        p0 = this.points[i - 1] || this.points[i];
        p1 = this.points[i];
        p2 = this.points[i + 1];
        p3 = this.points[i + 2] || this.points[i + 1];
        break;
      }
    }
    
    if (!p1) return x;
    
    // Catmull-Rom interpolation
    const t = (x - p1.x) / (p2.x - p1.x);
    const t2 = t * t;
    const t3 = t2 * t;
    
    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );
    
    return Math.max(0, Math.min(255, Math.round(y)));
  }
}
```

**Step 2: Add Shader for Curve Application**
```glsl
// Add to GPUProcessor.js fragment shader
uniform sampler2D u_toneCurveLUT;  // 256x1 texture

vec3 applyToneCurve(vec3 color) {
  return vec3(
    texture2D(u_toneCurveLUT, vec2(color.r, 0.5)).r,
    texture2D(u_toneCurveLUT, vec2(color.g, 0.5)).g,
    texture2D(u_toneCurveLUT, vec2(color.b, 0.5)).b
  );
}
```

**Step 3: Add UI Panel**
```html
<!-- Add to index.html in panel-develop -->
<div class="section" id="tone-curve-section">
  <div class="section-header">Tone Curve</div>
  <div class="tone-curve-channels">
    <button class="channel-btn active" data-channel="rgb">RGB</button>
    <button class="channel-btn" data-channel="r">R</button>
    <button class="channel-btn" data-channel="g">G</button>
    <button class="channel-btn" data-channel="b">B</button>
  </div>
  <div id="tone-curve-container"></div>
</div>
```

**Time:** 8 hours

---

### 3.2 HSL Color Mixer
**Priority:** HIGH

**GPU Shader Addition:**
```glsl
// HSL adjustment shader
uniform float u_hueShift[8];      // 8 color ranges
uniform float u_saturation[8];
uniform float u_luminance[8];

vec3 rgb2hsl(vec3 c) {
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float h, s, l = (maxc + minc) / 2.0;
  
  if (maxc == minc) {
    h = s = 0.0;
  } else {
    float d = maxc - minc;
    s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
    
    if (maxc == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    
    h /= 6.0;
  }
  return vec3(h, s, l);
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c / 2.0;
  
  vec3 rgb;
  if (h < 1.0/6.0) rgb = vec3(c, x, 0.0);
  else if (h < 2.0/6.0) rgb = vec3(x, c, 0.0);
  else if (h < 3.0/6.0) rgb = vec3(0.0, c, x);
  else if (h < 4.0/6.0) rgb = vec3(0.0, x, c);
  else if (h < 5.0/6.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  
  return rgb + m;
}

vec3 applyHSL(vec3 color) {
  vec3 hsl = rgb2hsl(color);
  
  // Determine which color range (Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta)
  int range = int(floor(hsl.x * 8.0));
  float blend = fract(hsl.x * 8.0);
  
  // Apply adjustments with smooth blending
  hsl.x += mix(u_hueShift[range], u_hueShift[(range + 1) % 8], blend) / 360.0;
  hsl.y *= 1.0 + mix(u_saturation[range], u_saturation[(range + 1) % 8], blend) / 100.0;
  hsl.z *= 1.0 + mix(u_luminance[range], u_luminance[(range + 1) % 8], blend) / 100.0;
  
  return hsl2rgb(clamp(hsl, 0.0, 1.0));
}
```

**UI: 8 color tabs + 3 sliders each**
```html
<div class="section" id="hsl-section">
  <div class="section-header">HSL / Color</div>
  <div class="hsl-tabs">
    <button data-color="red" style="background:#ff0000"></button>
    <button data-color="orange" style="background:#ff8000"></button>
    <button data-color="yellow" style="background:#ffff00"></button>
    <button data-color="green" style="background:#00ff00"></button>
    <button data-color="aqua" style="background:#00ffff"></button>
    <button data-color="blue" style="background:#0000ff"></button>
    <button data-color="purple" style="background:#8000ff"></button>
    <button data-color="magenta" style="background:#ff00ff"></button>
  </div>
  <div id="hsl-sliders">
    <!-- Hue, Saturation, Luminance sliders -->
  </div>
</div>
```

**Time:** 6 hours

---

### 3.3 Sharpening
**Priority:** HIGH

**Shader (Unsharp Mask):**
```glsl
uniform float u_sharpenAmount;    // 0-200
uniform float u_sharpenRadius;    // 0.5-3.0
uniform float u_sharpenThreshold; // 0-10

vec3 sharpen(sampler2D tex, vec2 uv, vec2 texelSize) {
  // Sample blur
  vec3 blur = vec3(0.0);
  float sigma = u_sharpenRadius;
  float total = 0.0;
  
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      float weight = exp(-float(x*x + y*y) / (2.0 * sigma * sigma));
      blur += texture2D(tex, uv + vec2(float(x), float(y)) * texelSize).rgb * weight;
      total += weight;
    }
  }
  blur /= total;
  
  // Original
  vec3 original = texture2D(tex, uv).rgb;
  
  // Difference (high-frequency detail)
  vec3 diff = original - blur;
  
  // Threshold
  float amt = length(diff);
  if (amt < u_sharpenThreshold / 255.0) {
    return original;
  }
  
  // Apply sharpening
  return original + diff * (u_sharpenAmount / 100.0);
}
```

**Time:** 3 hours

---

## 4. Sprint 3: AI Features

### 4.1 AI Subject Selection (SAM-lite)
**Priority:** HIGH  
**Complexity:** High

**Step 1: Install Dependencies**
```bash
npm install @xenova/transformers
```

**Step 2: Create AI Selector Module**
```javascript
// src/ml/AISelector.js
import { pipeline, env } from '@xenova/transformers';

export class AISelector {
  constructor() {
    this.segmenter = null;
    this.loading = false;
  }
  
  async init(onProgress) {
    if (this.segmenter) return;
    if (this.loading) return;
    
    this.loading = true;
    env.allowLocalModels = false;
    
    this.segmenter = await pipeline(
      'image-segmentation',
      'Xenova/segformer-b0-finetuned-ade-512-512',
      { progress_callback: onProgress }
    );
    
    this.loading = false;
  }
  
  async selectSubject(imageElement) {
    if (!this.segmenter) await this.init();
    
    // Create canvas from image
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageElement, 0, 0, 512, 512);
    
    // Run segmentation
    const result = await this.segmenter(canvas.toDataURL());
    
    // Find person/subject segment
    const subject = result.find(seg => 
      seg.label === 'person' || seg.label === 'animal'
    );
    
    if (!subject) return null;
    
    // Convert to full resolution mask
    return this.scaleMask(subject.mask, imageElement.width, imageElement.height);
  }
  
  scaleMask(mask, targetWidth, targetHeight) {
    // Bilinear interpolation to scale mask
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw mask image and scale
    ctx.drawImage(mask, 0, 0, targetWidth, targetHeight);
    
    return ctx.getImageData(0, 0, targetWidth, targetHeight);
  }
}
```

**Step 3: Add UI Button**
```html
<button class="btn" id="btn-ai-select-subject">
  <svg>...</svg> Select Subject
</button>
```

**Time:** 8 hours

---

### 4.2 Improved Depth Estimation
**Priority:** MEDIUM

**Upgrade to DPT-Large for better quality:**
```javascript
// src/ml/DepthEstimator.js - update model
const MODEL_ID = 'Xenova/dpt-large'; // Instead of dpt-hybrid
```

**Add depth refinement with edge-aware filtering:**
```javascript
refineDepth(depthMap, edgeImage) {
  // Guided filter to preserve edges
  const radius = 8;
  const epsilon = 0.01;
  
  // Apply guided filter
  return this.guidedFilter(depthMap, edgeImage, radius, epsilon);
}
```

**Time:** 4 hours

---

## 5. Sprint 4: Cloud Backend

### 5.1 Project Structure
```
backend/
├── src/
│   ├── index.ts           # Entry point
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── projects.ts
│   │   └── exports.ts
│   ├── services/
│   │   ├── AuthService.ts
│   │   ├── ProjectService.ts
│   │   └── StorageService.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── rateLimit.ts
│   └── db/
│       ├── schema.sql
│       └── migrations/
├── package.json
├── tsconfig.json
└── Dockerfile
```

### 5.2 Setup Commands
```bash
# Create backend project
mkdir backend && cd backend
npm init -y
npm install express typescript @types/express prisma @prisma/client
npm install jsonwebtoken bcrypt cors helmet express-rate-limit
npm install @aws-sdk/client-s3  # For R2 storage

# Initialize
npx prisma init
npx tsc --init
```

### 5.3 Database Setup (Prisma)
```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String?
  oauthProvider String?
  oauthId       String?
  displayName   String?
  avatarUrl     String?
  planType      String    @default("free")
  storageUsed   BigInt    @default(0)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  projects      Project[]
}

model Project {
  id              String   @id @default(cuid())
  ownerId         String
  owner           User     @relation(fields: [ownerId], references: [id])
  name            String
  thumbnailUrl    String?
  originalImageUrl String
  editsJson       Json     @default("{}")
  depthMapUrl     String?
  masksJson       Json     @default("[]")
  version         Int      @default(1)
  isPublic        Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

**Time:** 16 hours total

---

## 6. Sprint 5: Collaboration

### 6.1 WebSocket Server Setup
```javascript
// src/sync/WebSocketServer.ts
import { WebSocketServer } from 'ws';

export class SyncServer {
  private wss: WebSocketServer;
  private rooms: Map<string, Set<WebSocket>> = new Map();
  
  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/sync' });
    this.wss.on('connection', this.handleConnection.bind(this));
  }
  
  handleConnection(ws: WebSocket, req: http.IncomingMessage) {
    const projectId = new URL(req.url!, 'http://localhost').searchParams.get('project');
    const userId = this.authenticateConnection(req);
    
    if (!projectId || !userId) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    
    this.joinRoom(projectId, ws, userId);
    
    ws.on('message', (data) => this.handleMessage(projectId, userId, data));
    ws.on('close', () => this.leaveRoom(projectId, ws));
  }
  
  handleMessage(projectId: string, senderId: string, data: Buffer) {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'EDIT':
        this.broadcastToRoom(projectId, senderId, {
          type: 'EDIT',
          senderId,
          edit: message.edit,
          timestamp: Date.now()
        });
        break;
        
      case 'CURSOR':
        this.broadcastToRoom(projectId, senderId, {
          type: 'CURSOR',
          senderId,
          position: message.position
        });
        break;
    }
  }
}
```

### 6.2 Frontend Sync Client
```javascript
// src/sync/SyncClient.js
export class SyncClient {
  constructor(projectId, onEdit, onCursor) {
    this.projectId = projectId;
    this.onEdit = onEdit;
    this.onCursor = onCursor;
    this.ws = null;
    this.reconnectAttempts = 0;
  }
  
  connect() {
    const token = localStorage.getItem('authToken');
    this.ws = new WebSocket(
      `wss://sync.orlume.com/sync?project=${this.projectId}&token=${token}`
    );
    
    this.ws.onopen = () => {
      console.log('🔗 Connected to sync server');
      this.reconnectAttempts = 0;
    };
    
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'EDIT') this.onEdit(msg);
      if (msg.type === 'CURSOR') this.onCursor(msg);
    };
    
    this.ws.onclose = () => {
      if (this.reconnectAttempts < 5) {
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connect();
        }, 1000 * Math.pow(2, this.reconnectAttempts));
      }
    };
  }
  
  sendEdit(edit) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'EDIT', edit }));
    }
  }
}
```

**Time:** 12 hours total

---

## 7. Sprint 6: Pro Features

### 7.1 RAW File Support
**Install LibRaw WASM:**
```bash
npm install libraw.js
```

**Implementation:**
```javascript
// src/core/RawDecoder.js
import LibRaw from 'libraw.js';

export class RawDecoder {
  async decode(rawBuffer) {
    const libraw = await LibRaw.create();
    
    // Open RAW file
    await libraw.open(new Uint8Array(rawBuffer));
    
    // Unpack
    await libraw.unpack();
    
    // Process with default settings
    await libraw.dcraw_process();
    
    // Get image
    const image = await libraw.dcraw_make_mem_image();
    
    // Convert to ImageData
    const imageData = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height
    );
    
    await libraw.recycle();
    
    return imageData;
  }
}
```

**Time:** 8 hours

---

## Checklist Summary

### This Week
- [ ] Fix export quality (full resolution)
- [ ] Add JPEG/WebP export options
- [ ] Keyboard shortcuts modal

### Sprint 1 (Week 2-3)
- [ ] Undo/Redo system
- [ ] Zoom/Pan controls
- [ ] Before/After slider

### Sprint 2 (Week 4-5)
- [ ] Tone Curve
- [ ] HSL Color Mixer
- [ ] Sharpening

### Sprint 3 (Week 6-7)
- [ ] AI Subject Selection
- [ ] Improved depth estimation

### Sprint 4 (Week 8-10)
- [ ] Backend setup
- [ ] User authentication
- [ ] Project storage

### Sprint 5 (Week 11-12)
- [ ] Real-time collaboration
- [ ] WebSocket sync

### Sprint 6 (Week 13-14)
- [ ] RAW file support
- [ ] Batch processing

---

## Quick Reference

**Start dev server:**
```bash
npm run dev
```

**Build for production:**
```bash
npm run build
```

**Run tests:**
```bash
npm run test
```

**Deploy:**
```bash
npm run deploy
```

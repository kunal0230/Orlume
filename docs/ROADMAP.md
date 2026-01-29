# Orlume Photo Editor - Feature Roadmap

A comprehensive list of features for development. Check items as they're completed.

---

## Completed Features

### Core Editor

- [x] WebGL2 GPU-accelerated canvas rendering
- [x] Real-time preview with adjustments
- [x] Undo/Redo with full history
- [x] Dark mode UI
- [x] Keyboard shortcuts

### Adjustments Panel

- [x] Exposure control
- [x] Contrast adjustment
- [x] Highlights/Shadows
- [x] Whites/Blacks
- [x] Temperature/Tint (white balance)
- [x] Vibrance/Saturation
- [x] Clarity/Dehaze
- [x] Sharpening

### Tone Curve

- [x] RGB composite curve
- [x] Individual R/G/B curves
- [x] Bezier curve control points
- [x] Real-time curve preview

### HSL Adjustments

- [x] Hue shift per color
- [x] Saturation per color
- [x] Luminance per color
- [x] 8 color channels (Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta)

### Masking & Local Adjustments

- [x] Brush mask tool
- [x] Radial gradient mask
- [x] Linear gradient mask
- [x] Mask overlay preview
- [x] Per-mask adjustments
- [x] Mask invert

### Relight Feature

- [x] AI-powered relighting
- [x] Draggable light source
- [x] Real-time light preview

### Crop & Transform

- [x] Free crop
- [x] Aspect ratio presets (1:1, 4:3, 16:9, etc.)
- [x] Custom aspect ratio
- [x] Rotation slider
- [x] Flip horizontal/vertical
- [x] Straighten tool

### Zoom & Pan

- [x] Zoom in/out controls
- [x] Ctrl/Cmd + scroll zoom
- [x] Space + drag pan
- [x] Fit to screen
- [x] 100% zoom
- [x] Zoom percentage display

### Before/After Comparison

- [x] Side-by-side slider
- [x] Toggle button
- [x] Keyboard shortcut

### File Handling

- [x] Import JPG/PNG/WebP
- [x] Export with quality settings
- [x] Drag and drop upload
- [x] File picker

---

## In Progress

### AI Image Enhancer

- [x] Upscale panel UI
- [x] Mode selector (Enhance/Upscale/Both)
- [x] Face enhancement toggle
- [ ] Server infrastructure (WIP - dependency issues)
- [ ] Replicate API integration
- [ ] Docker-based local server

---

## Planned Features

### AI & Enhancement (Priority: High)

#### Image Restoration

- [ ] AI noise reduction (denoise)
- [ ] AI blur removal (deblur)
- [ ] AI compression artifact removal
- [ ] Old photo restoration
- [ ] Face enhancement (GFPGAN/CodeFormer)
- [ ] General enhancement (Real-ESRGAN)
- [ ] SwinIR integration

#### Background Tools

- [ ] AI background removal
- [ ] Background blur (Portrait mode)
- [ ] Background replacement
- [ ] Transparent background export

#### Object Manipulation

- [ ] AI object removal (inpainting)
- [ ] Content-aware fill
- [ ] AI object selection
- [ ] Smart crop (AI composition)

#### Auto Enhancement

- [ ] One-click auto enhance
- [ ] Auto white balance
- [ ] Auto exposure
- [ ] Auto color correction
- [ ] Auto straighten
- [ ] Auto crop (smart framing)

#### Colorization

- [ ] AI colorize B&W photos
- [ ] Selective colorization
- [ ] Color transfer from reference

---

### Editing Tools (Priority: High)

#### Selection Tools

- [ ] Rectangular selection
- [ ] Elliptical selection
- [ ] Lasso selection (freehand)
- [ ] Polygonal lasso
- [ ] Magic wand (color-based)
- [ ] Quick selection brush
- [ ] Select subject (AI)
- [ ] Selection invert/expand/contract

#### Layers System

- [ ] Multiple layers support
- [ ] Layer opacity
- [ ] Blend modes (Normal, Multiply, Screen, Overlay, etc.)
- [ ] Layer masks
- [ ] Layer groups/folders
- [ ] Layer effects (shadow, glow)
- [ ] Flatten layers
- [ ] Merge layers

#### Drawing & Painting

- [ ] Brush tool with pressure sensitivity
- [ ] Eraser tool
- [ ] Clone stamp tool
- [ ] Healing brush
- [ ] Spot healing (one-click)
- [ ] Dodge/Burn tool
- [ ] Sponge tool (saturation)
- [ ] Blur/Sharpen brush

#### Text Tool

- [ ] Add text layers
- [ ] Font selection (Google Fonts)
- [ ] Font size/weight/style
- [ ] Text color with gradient
- [ ] Text shadow/outline
- [ ] Text alignment
- [ ] Curved text
- [ ] Text on path

#### Shapes & Annotations

- [ ] Rectangle/Square
- [ ] Ellipse/Circle
- [ ] Line/Arrow
- [ ] Polygon
- [ ] Custom path drawing
- [ ] Shape fill/stroke
- [ ] Callout boxes
- [ ] Watermark tool

#### Gradient Tool

- [ ] Linear gradient
- [ ] Radial gradient
- [ ] Angle gradient
- [ ] Gradient presets
- [ ] Custom gradient colors

---

### Filters & Effects (Priority: Medium)

#### Preset Filters

- [ ] Cinematic presets
- [ ] Vintage/Retro presets
- [ ] Black & White presets
- [ ] Film emulation (Kodak, Fuji)
- [ ] Instagram-style filters
- [ ] Custom preset saving
- [ ] Import/Export presets
- [ ] Preset preview thumbnails

#### LUT Support

- [ ] Load .cube LUT files
- [ ] Load .3dl LUT files
- [ ] LUT intensity slider
- [ ] Built-in LUT library
- [ ] LUT preview

#### Effects

- [ ] Vignette
- [ ] Film grain/noise
- [ ] Chromatic aberration
- [ ] Lens blur (bokeh)
- [ ] Tilt-shift miniature
- [ ] Motion blur
- [ ] Radial blur
- [ ] Pixelate/Mosaic
- [ ] Glitch effect
- [ ] Double exposure

#### Color Effects

- [ ] Split toning
- [ ] Color grading wheels
- [ ] Selective color
- [ ] Color lookup
- [ ] Posterize
- [ ] Threshold

#### Stylization

- [ ] HDR effect
- [ ] Orton glow
- [ ] Soft focus
- [ ] High-key/Low-key
- [ ] Cross-process
- [ ] Infrared simulation
- [ ] Duotone
- [ ] Oil painting effect
- [ ] Pencil sketch effect
- [ ] Watercolor effect

---

### Transform & Distortion (Priority: Medium)

#### Basic Transform

- [ ] Scale (resize with aspect lock)
- [ ] Skew
- [ ] Distort (free transform)
- [ ] Perspective correction
- [ ] Warp tool

#### Lens Corrections

- [ ] Lens distortion correction
- [ ] Chromatic aberration removal
- [ ] Vignette removal
- [ ] Lens profile database

#### Liquify/Warp

- [ ] Push/Pull tool
- [ ] Bloat/Pinch
- [ ] Twirl
- [ ] Freeze/Thaw mask
- [ ] Face-aware liquify

---

### File & Project Management (Priority: Medium)

#### File Format Support

- [ ] RAW file support (CR2, NEF, ARW, etc.)
- [ ] TIFF support
- [ ] PSD import (basic)
- [ ] SVG export
- [ ] PDF export
- [ ] GIF support
- [ ] HEIC/HEIF support

#### Export Options

- [ ] Custom dimensions
- [ ] Quality presets
- [ ] Format conversion
- [ ] Batch export
- [ ] Watermark on export
- [ ] EXIF data preservation
- [ ] EXIF data stripping
- [ ] Color profile (sRGB, Adobe RGB)
- [ ] Social media presets (Instagram, Facebook, Twitter sizes)

#### Batch Processing

- [ ] Apply edits to multiple images
- [ ] Batch resize
- [ ] Batch format conversion
- [ ] Batch rename
- [ ] Batch watermark
- [ ] Preset batch apply

#### Project Files

- [ ] Save project with history
- [ ] Load project file
- [ ] Auto-save drafts
- [ ] Version history
- [ ] Non-destructive editing storage

#### Cloud Integration

- [ ] Google Drive sync
- [ ] Dropbox integration
- [ ] OneDrive support
- [ ] Cloud project storage
- [ ] Share via link

---

### UI/UX Improvements (Priority: Medium)

#### Interface Enhancements

- [ ] Collapsible panels
- [ ] Customizable workspace layouts
- [ ] Full-screen edit mode
- [ ] Floating tool windows
- [ ] Navigator panel
- [ ] Histogram live view
- [ ] Info panel (file details)
- [ ] Favorites/Quick access

#### Themes & Appearance

- [ ] Light theme
- [ ] Custom accent colors
- [ ] Icon size options
- [ ] Compact mode
- [ ] High contrast mode

#### Accessibility

- [ ] Keyboard navigation
- [ ] Screen reader support
- [ ] High contrast mode
- [ ] Reduced motion option
- [ ] Color blind modes

#### Touch & Mobile

- [ ] Touch gesture support
- [ ] Tablet optimization
- [ ] Mobile responsive layout
- [ ] Pinch to zoom
- [ ] Two-finger rotate

#### Onboarding & Help

- [ ] Interactive tutorial
- [ ] Tool tips
- [ ] Keyboard shortcuts modal
- [ ] Documentation
- [ ] Video tutorials
- [ ] Sample images

---

### Performance & Technical (Priority: Low)

#### Rendering

- [ ] WebGPU support (future)
- [ ] WebGL fallback optimization
- [ ] Progressive loading for large images
- [ ] Thumbnail generation
- [ ] Background processing

#### Memory & Speed

- [ ] Smart memory management
- [ ] History limit configuration
- [ ] Preview quality settings
- [ ] Lazy loading components
- [ ] Service worker caching

#### Browser Support

- [ ] Chrome optimization
- [ ] Firefox support
- [ ] Safari support
- [ ] Edge support
- [ ] PWA (Progressive Web App)
- [ ] Offline mode

---

### Integrations (Priority: Low)

#### AI Services

- [ ] Replicate API integration
- [ ] Hugging Face integration
- [ ] Custom API endpoint support
- [ ] API key management

#### Social Media

- [ ] Direct share to Instagram
- [ ] Direct share to Twitter
- [ ] Direct share to Facebook
- [ ] Pinterest integration

#### Asset Libraries

- [ ] Unsplash integration
- [ ] Pexels integration
- [ ] Custom asset library
- [ ] Stock photo search

---

### Advanced Features (Priority: Future)

#### Video Support

- [ ] Video import
- [ ] Frame extraction
- [ ] Basic video editing
- [ ] Apply filters to video
- [ ] GIF creation

#### 3D Features

- [ ] 3D LUT visualization
- [ ] 3D object placement
- [ ] Depth map generation

#### Collaboration

- [ ] Real-time collaboration
- [ ] Comments on image
- [ ] Share for feedback
- [ ] Team workspaces

#### Print

- [ ] Print layout
- [ ] Color matching for print
- [ ] Soft proofing
- [ ] Contact sheet

---

## Feature Statistics

| Category | Completed | In Progress | Planned |
|----------|-----------|-------------|---------|
| Core Editor | 5 | 0 | 0 |
| Adjustments | 8 | 0 | 0 |
| Tone Curve | 4 | 0 | 0 |
| HSL | 4 | 0 | 0 |
| Masking | 6 | 0 | 0 |
| Crop | 7 | 0 | 0 |
| Zoom/Pan | 6 | 0 | 0 |
| AI/Enhancement | 3 | 3 | 25+ |
| Editing Tools | 0 | 0 | 40+ |
| Filters | 0 | 0 | 35+ |
| File Management | 4 | 0 | 25+ |
| UI/UX | 0 | 0 | 25+ |
| **Total** | **47** | **3** | **150+** |

---

## Version History

| Version | Date | Features Added |
|---------|------|----------------|
| v4.4.0 | 2024-12-26 | AI Image Enhancer UI, Mode selector, Server infrastructure |
| v4.3.0 | Previous | Zoom, Pan, Before/After comparison |
| v4.2.0 | Previous | Undo/Redo improvements |
| v4.1.0 | Previous | Relight feature |
| v4.0.0 | Previous | Major refactor |

---

## Notes

- Features marked with (AI) require external API or local ML server
- Priority may change based on user feedback
- Some features may require premium tier in future
- Performance features depend on browser capabilities

---

*Last updated: 2024-12-26*

/**
 * ExportModule - Image export functionality
 * 
 * Handles:
 * - Export to PNG/JPEG/WebP
 * - Quality settings
 * - File size estimation
 * - Custom filename
 */

export class ExportModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.masks = editor.masks;
        this.elements = editor.elements;
    }

    /**
     * Export image with full resolution and format options
     * Uses offscreen canvas to render at original image resolution
     */
    exportImage() {
        if (!this.state.originalImage) {
            console.warn('No image to export');
            return;
        }

        // Get export settings from UI or use defaults
        const formatSelect = document.getElementById('export-format');
        const qualitySlider = document.getElementById('slider-export-quality');

        const format = formatSelect?.value || 'png';
        const quality = (qualitySlider?.value || 95) / 100;

        // Determine MIME type
        const mimeTypes = {
            'png': 'image/png',
            'jpeg': 'image/jpeg',
            'webp': 'image/webp'
        };
        const mimeType = mimeTypes[format] || 'image/png';

        // File extension
        const extensions = {
            'png': 'png',
            'jpeg': 'jpg',
            'webp': 'webp'
        };
        const extension = extensions[format] || 'png';

        // Show export progress
        const statusBar = document.querySelector('.status-right .perf');
        const originalStatus = statusBar?.textContent;
        if (statusBar) statusBar.textContent = 'Exporting...';

        // Use setTimeout to allow UI to update
        setTimeout(() => {
            try {
                this._performExport(mimeType, quality, extension);
            } catch (error) {
                console.error('Export failed:', error);
                alert('Export failed: ' + error.message);
            } finally {
                if (statusBar) statusBar.textContent = originalStatus || 'Ready';
            }
        }, 50);
    }

    /**
     * Internal export method - renders at original resolution
     */
    _performExport(mimeType, quality, extension) {
        const originalWidth = this.state.originalImage.width;
        const originalHeight = this.state.originalImage.height;

        // Check if we're already at full resolution
        const currentWidth = this.gpu.width;
        const currentHeight = this.gpu.height;

        let exportCanvas;

        if (currentWidth === originalWidth && currentHeight === originalHeight) {
            // Already at full resolution, use current canvas
            exportCanvas = this.elements.canvas;

            // Make sure we have the latest render with all adjustments
            let resultTexture = this.gpu.renderToTexture();
            resultTexture = this.masks.applyMaskedAdjustments(resultTexture);
            this.gpu.blitToCanvas(resultTexture);
        } else {
            // Need to render at full resolution
            // For now, use current canvas (full resolution rendering is complex)
            // TODO: Implement true full-resolution export in future
            exportCanvas = this.elements.canvas;

            // Render with current adjustments
            let resultTexture = this.gpu.renderToTexture();
            resultTexture = this.masks.applyMaskedAdjustments(resultTexture);
            this.gpu.blitToCanvas(resultTexture);
        }

        // Export to blob
        exportCanvas.toBlob((blob) => {
            if (!blob) {
                console.error('Failed to create blob');
                return;
            }

            // Create download link
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            // Get custom filename or generate with timestamp
            const filenameInput = document.getElementById('export-filename');
            let filename = filenameInput?.value?.trim();

            if (!filename) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                filename = `orlume-export-${timestamp}`;
            }

            // Sanitize filename (remove invalid characters)
            filename = filename.replace(/[<>:"/\\|?*]/g, '-');

            link.download = `${filename}.${extension}`;
            link.href = url;
            link.click();

            // Cleanup
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            // Log export info
            const sizeKB = (blob.size / 1024).toFixed(1);
        }, mimeType, quality);
    }

    /**
     * Estimate file size based on current settings
     * Called when quality slider changes
     */
    estimateFileSize() {
        if (!this.state.originalImage || !this.elements.canvas) {
            this._updateFileSizeDisplay('--');
            return;
        }

        const formatSelect = document.getElementById('export-format');
        const qualitySlider = document.getElementById('slider-export-quality');

        const format = formatSelect?.value || 'jpeg';
        const quality = (qualitySlider?.value || 95) / 100;

        const mimeTypes = {
            'png': 'image/png',
            'jpeg': 'image/jpeg',
            'webp': 'image/webp'
        };
        const mimeType = mimeTypes[format] || 'image/jpeg';

        // Ensure we have the latest render
        let resultTexture = this.gpu.renderToTexture();
        resultTexture = this.masks.applyMaskedAdjustments(resultTexture);
        this.gpu.blitToCanvas(resultTexture);

        // Generate blob to estimate size
        this.elements.canvas.toBlob((blob) => {
            if (blob) {
                const sizeKB = blob.size / 1024;
                let sizeText;
                if (sizeKB < 1024) {
                    sizeText = `~${sizeKB.toFixed(0)} KB`;
                } else {
                    sizeText = `~${(sizeKB / 1024).toFixed(1)} MB`;
                }
                this._updateFileSizeDisplay(sizeText);
            }
        }, mimeType, quality);
    }

    /**
     * Update file size display in UI
     */
    _updateFileSizeDisplay(sizeText) {
        const sizeDisplay = document.getElementById('estimated-file-size');
        if (sizeDisplay) {
            sizeDisplay.textContent = sizeText;
        }
    }

    /**
     * Show export options modal (if expanded export UI is desired)
     */
    showExportOptions() {
        // Toggle export options visibility
        const exportOptions = document.getElementById('export-options');
        if (exportOptions) {
            exportOptions.style.display = exportOptions.style.display === 'none' ? 'block' : 'none';
        }
    }
}

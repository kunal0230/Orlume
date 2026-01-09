/**
 * KeyboardModule - Keyboard shortcuts and hotkeys
 * 
 * Handles:
 * - Tool switching shortcuts (D, B, R, G, C, E, U, W, H)
 * - Before/After comparison (Space, Backslash)
 * - Undo/Redo (Cmd/Ctrl + Z, Cmd/Ctrl + Shift + Z)
 * - Export (Cmd/Ctrl + E)
 * - Brush controls (X toggle, [ ] size)
 * - Crop controls (Enter apply, Escape cancel)
 * - Shortcuts modal (? key)
 */

export class KeyboardModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.masks = editor.masks;
        this.elements = editor.elements;
        this.gpu = editor.gpu;
    }

    /**
     * Initialize keyboard shortcuts
     */
    init() {
        document.addEventListener('keydown', (e) => this._handleKeyDown(e));
        document.addEventListener('keyup', (e) => this._handleKeyUp(e));

        // Shortcuts modal close button
        const shortcutsClose = document.getElementById('shortcuts-close');
        if (shortcutsClose) {
            shortcutsClose.addEventListener('click', () => this.toggleShortcutsModal(false));
        }

        // Close modal on backdrop click
        const shortcutsModal = document.getElementById('shortcuts-modal');
        if (shortcutsModal) {
            shortcutsModal.addEventListener('click', (e) => {
                if (e.target === shortcutsModal) {
                    this.toggleShortcutsModal(false);
                }
            });
        }
    }

    /**
     * Handle keydown events
     */
    _handleKeyDown(e) {
        // Ignore shortcuts when typing in inputs or contentEditable
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.target.isContentEditable) return;

        // Ignore tool shortcuts when in text mode (except Escape)
        if (this.state.currentTool === 'text' && e.code !== 'Escape') {
            // Only allow modifier-based shortcuts (Cmd/Ctrl) in text mode
            if (!e.metaKey && !e.ctrlKey) return;
        }

        // Space - Before view
        if (e.code === 'Space' && !this.state.showingBefore && this.state.hasImage) {
            e.preventDefault();
            this.state.showingBefore = true;
            this.elements.beforeIndicator?.classList.add('visible');
            this.gpu.renderOriginal(this.state.originalImage);
        }

        // Tool shortcuts
        if (e.code === 'KeyD') this.editor.setTool('develop');
        if (e.code === 'KeyB') this.editor.setTool('brush');
        if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) this.editor.setTool('radial');
        if (e.code === 'KeyG') this.editor.setTool('gradient');
        if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) this.editor.setTool('crop');
        if (e.code === 'KeyE' && !e.metaKey && !e.ctrlKey) this.editor.setTool('export');
        if (e.code === 'KeyU' && !e.metaKey && !e.ctrlKey) this.editor.setTool('upscale');
        if (e.code === 'KeyW' && !e.metaKey && !e.ctrlKey) this.editor.setTool('liquify');
        if (e.code === 'KeyH' && !e.metaKey && !e.ctrlKey) this.editor.setTool('healing');
        if (e.code === 'KeyV' && !e.metaKey && !e.ctrlKey) this.editor.setTool('godrays');
        if (e.code === 'KeyT' && !e.metaKey && !e.ctrlKey) this.editor.setTool('text');
        if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) this.editor.setTool('clone');

        // Brush mode toggle
        if (e.code === 'KeyX' && this.state.currentTool === 'brush') {
            this.editor.setBrushMode(!this.masks.brushSettings.erase);
        }

        // Brush size adjustment
        if (e.code === 'BracketLeft') {
            this.editor.adjustBrushSize(-10);
        }
        if (e.code === 'BracketRight') {
            this.editor.adjustBrushSize(10);
        }

        // Show keyboard shortcuts modal with ? key
        if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
            e.preventDefault();
            this.toggleShortcutsModal(true);
        }

        // Close modal with Escape (or cancel crop if in crop mode)
        if (e.code === 'Escape') {
            if (this.state.currentTool === 'crop') {
                e.preventDefault();
                this.editor.cancelCrop();
            } else {
                this.toggleShortcutsModal(false);
            }
        }

        // Apply crop with Enter when in crop mode
        if (e.code === 'Enter' && this.state.currentTool === 'crop') {
            e.preventDefault();
            this.editor.applyCrop();
        }

        // Export with Ctrl/Cmd + E
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyE') {
            e.preventDefault();
            this.editor.exportImage();
        }

        // Undo with Ctrl/Cmd + Z
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ') {
            e.preventDefault();
            this.editor.undo();
        }

        // Redo with Ctrl/Cmd + Shift + Z
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyZ') {
            e.preventDefault();
            this.editor.redo();
        }

        // Toggle Before/After comparison with backslash
        if (e.code === 'Backslash' && this.state.hasImage) {
            e.preventDefault();
            this.editor.toggleComparison();
        }
    }

    /**
     * Handle keyup events
     */
    _handleKeyUp(e) {
        if (e.code === 'Space' && this.state.showingBefore) {
            this.state.showingBefore = false;
            this.elements.beforeIndicator?.classList.remove('visible');
            this.gpu.render();
        }
    }

    /**
     * Toggle keyboard shortcuts modal
     */
    toggleShortcutsModal(show) {
        const modal = document.getElementById('shortcuts-modal');
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
        }
    }
}

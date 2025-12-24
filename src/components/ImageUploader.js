/**
 * Image Uploader Component
 * Handles drag-drop and file input for image loading
 */

export class ImageUploader {
    constructor(app) {
        this.app = app;
        this.maxFileSize = 20 * 1024 * 1024; // 20MB
        this.allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

        this.init();
    }

    init() {
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('file-input');
        const browseBtn = document.getElementById('btn-browse');

        // Click to browse
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        dropzone.addEventListener('click', () => {
            fileInput.click();
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleFile(file);
        });

        // Drag events
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');

            const file = e.dataTransfer.files[0];
            if (file) this.handleFile(file);
        });

        // Prevent default drag behavior on document
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    }

    handleFile(file) {
        // Validate file type
        if (!this.allowedTypes.includes(file.type)) {
            this.app.setStatus('Invalid file type. Use JPG, PNG, or WebP.');
            return;
        }

        // Validate file size
        if (file.size > this.maxFileSize) {
            this.app.setStatus('File too large. Maximum size is 20MB.');
            return;
        }

        this.app.loadImage(file);
    }

    async processFile(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                // Create offscreen canvas for processing
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Limit max dimensions for performance
                const maxDim = 2048;
                let { width, height } = img;

                if (width > maxDim || height > maxDim) {
                    const scale = maxDim / Math.max(width, height);
                    width = Math.floor(width * scale);
                    height = Math.floor(height * scale);
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                resolve({
                    element: img,
                    width,
                    height,
                    canvas,
                    imageData: ctx.getImageData(0, 0, width, height),
                    dataURL: canvas.toDataURL('image/jpeg', 0.95),
                });
            };

            img.onerror = () => {
                reject(new Error('Failed to load image'));
            };

            img.src = URL.createObjectURL(file);
        });
    }
}

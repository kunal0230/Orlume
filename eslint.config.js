import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
    // Ignore patterns
    {
        ignores: ['dist/**', 'node_modules/**', 'public/assets/**', '*.min.js'],
    },
    // Base recommended config
    js.configs.recommended,
    // Prettier config (disables conflicting rules)
    prettierConfig,
    // Main configuration
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                fetch: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly', // FIXED: missing-browser-globals
                Blob: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                FormData: 'readonly',
                Image: 'readonly',
                ImageData: 'readonly',
                ImageBitmap: 'readonly', // FIXED: missing-browser-globals
                HTMLCanvasElement: 'readonly',
                HTMLImageElement: 'readonly',
                HTMLElement: 'readonly',
                CanvasRenderingContext2D: 'readonly',
                WebGLRenderingContext: 'readonly',
                WebGL2RenderingContext: 'readonly',
                WebGLTexture: 'readonly',
                GPUTexture: 'readonly',
                OffscreenCanvas: 'readonly',
                createImageBitmap: 'readonly',
                performance: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                localStorage: 'readonly',
                indexedDB: 'readonly',
                alert: 'readonly', // FIXED: missing-browser-globals
                confirm: 'readonly', // FIXED: missing-browser-globals
                prompt: 'readonly', // FIXED: missing-browser-globals
                caches: 'readonly', // FIXED: missing-browser-globals
                IntersectionObserver: 'readonly',
                ResizeObserver: 'readonly',
                AbortSignal: 'readonly',
                // WebGPU
                GPUTexture: 'readonly',
                GPUDevice: 'readonly',
                GPUShaderStage: 'readonly', // FIXED: missing-webgpu-globals
                GPUTextureUsage: 'readonly', // FIXED: missing-webgpu-globals
                GPUBufferUsage: 'readonly', // FIXED: missing-webgpu-globals
                GPUMapMode: 'readonly', // FIXED: missing-webgpu-globals
                // External libraries
                THREE: 'readonly',
            },
        },
        plugins: {
            prettier,
        },
        rules: {
            // Code quality
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
            'prefer-const': 'warn',
            'no-var': 'error',
            eqeqeq: ['warn', 'always'],
            curly: ['warn', 'multi-line'],
            'no-throw-literal': 'error',

            // Prettier integration
            'prettier/prettier': 'warn',
        },
    },
];

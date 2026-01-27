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
                Blob: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                FormData: 'readonly',
                Image: 'readonly',
                ImageData: 'readonly',
                HTMLCanvasElement: 'readonly',
                HTMLImageElement: 'readonly',
                CanvasRenderingContext2D: 'readonly',
                WebGLRenderingContext: 'readonly',
                WebGL2RenderingContext: 'readonly',
                OffscreenCanvas: 'readonly',
                createImageBitmap: 'readonly',
                performance: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                localStorage: 'readonly',
                indexedDB: 'readonly',
                // WebGPU
                GPUTexture: 'readonly',
                GPUDevice: 'readonly',
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

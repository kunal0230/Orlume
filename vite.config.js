import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

/**
 * Plugin to copy ONNX Runtime WASM files from @huggingface/transformers
 * This ensures WASM files are available at runtime for depth estimation
 */
const copyWasmPlugin = () => ({
  name: 'copy-onnx-wasm',
  buildStart() {
    const srcDir = 'node_modules/@huggingface/transformers/dist';
    const destDir = 'public/assets';

    try {
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      // Copy WASM and MJS files (ONNX Runtime needs both)
      if (existsSync(srcDir)) {
        const files = readdirSync(srcDir).filter(f =>
          f.endsWith('.wasm') || f.includes('ort-wasm') && f.endsWith('.mjs')
        );
        files.forEach(file => {
          const srcPath = resolve(srcDir, file);
          const destPath = resolve(destDir, file);
          copyFileSync(srcPath, destPath);
          console.log(`📦 Copied: ${file}`);
        });
      }
    } catch (e) {
      console.warn('⚠️ Could not copy WASM files:', e.message);
    }
  }
});

export default defineConfig({
  server: {
    port: 5174,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    proxy: {
      '/api/replicate': {
        target: 'https://api.replicate.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/replicate/, '/v1'),
        headers: {
          'Origin': 'https://api.replicate.com'
        }
      }
    }
  },

  // Include WASM and ONNX files as assets
  assetsInclude: ['**/*.wasm', '**/*.onnx'],

  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html')
      }
    }
  },

  // Note: Don't exclude @huggingface/transformers - let Vite pre-bundle it

  plugins: [
    copyWasmPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Orlume AI Photo Editor',
        short_name: 'Orlume',
        description: 'Professional AI-powered photo editing with WebGL2 GPU acceleration',
        theme_color: '#1a1a2e',
        background_color: '#0f0f1a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        categories: ['photo', 'design', 'productivity'],
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});

/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'OpenRoll',
        short_name: 'OpenRoll',
        description: 'Free, local-first music hub: MIDI, sheet music, audio and falling-notes videos.',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json,bin,mp3,ogg}'],
        // The high-precision piano mode (Transkun: ~57 MB model + 29 MB onnxruntime WebAssembly + its
        // worker) is never precached: only users who pick it download it, then it is cached at runtime.
        globIgnores: ['**/ort-wasm-*.wasm', '**/transkun.worker-*.js', 'models/transkun/**'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/(models\/transkun\/[^/]+\.onnx|assets\/ort-wasm-[^/]+\.wasm|assets\/transkun\.worker-[^/]+\.js)$/,
            handler: 'CacheFirst',
            options: {
              // Bump with the model revision in scripts/fetch-transkun.mjs: the model file name is not hashed.
              cacheName: 'openroll-transkun-b445981',
              cacheableResponse: { statuses: [200] },
              // Hashed worker / wasm names change between releases; old copies age out.
              expiration: { maxEntries: 8 },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  // onnxruntime-web resolves its .wasm next to its own module; pre-bundling it in dev breaks that.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/roundtrip/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});

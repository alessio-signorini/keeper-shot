import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const APP_NAME = 'KeeperShot';

export default defineConfig({
  base: process.env.GITHUB_REPOSITORY ? '/' + process.env.GITHUB_REPOSITORY.split('/')[1] + '/' : '/',
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 12000 },
  test: { include: ['tests/unit/**/*.test.ts'] },
  plugins: [
    preact(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@mediapipe/tasks-vision/wasm/*', dest: 'mediapipe-wasm', rename: { stripBase: true } },
        { src: 'node_modules/@techstark/opencv-js/dist/opencv.js', dest: 'opencv', rename: { stripBase: true } },
        {
          src: 'node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs',
          dest: 'libheif',
          rename: { stripBase: true },
        },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,task}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: 'Combine group photos so everyone looks good.',
        theme_color: '#f97316',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
});

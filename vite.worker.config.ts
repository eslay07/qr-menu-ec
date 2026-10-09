import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'worker-ui',
  envDir: resolve(import.meta.dirname, '.'),
  publicDir: '../public',
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  worker: { rolldownOptions: { output: { entryFileNames: 'firebase-messaging-sw.js' } } },
  build: { outDir: '../dist-worker', emptyOutDir: true, target: 'es2017' },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'worker-ui',
  publicDir: '../public',
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  build: { outDir: '../dist-worker', emptyOutDir: true, target: 'es2017' },
});

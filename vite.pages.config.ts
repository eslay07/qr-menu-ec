import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';
import { Catalog } from './lib/contracts';
import demo from './data/restaurants/restaurante-demo.json';

// Fail the build before publishing an invalid price, category or asset path.
Catalog.parse(demo);

export default defineConfig({
  root: 'pages-ui',
  envDir: resolve(import.meta.dirname, '.'),
  publicDir: 'public',
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  worker: { rolldownOptions: { output: { entryFileNames: 'firebase-messaging-sw.js' } } },
  build: { outDir: '../dist-pages', emptyOutDir: true, target: 'es2017' },
});

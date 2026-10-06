import { defineConfig } from 'vite';

// The app is entirely client-side, so the base is the deploy root and the
// bundle is self-contained. A Cloudflare Workers static-assets deployment
// serves `dist/` straight from the edge without invoking a Worker script.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
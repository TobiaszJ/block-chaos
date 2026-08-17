import { defineConfig } from 'vite';

// GitHub Pages-Deployment:  VITE_BASE=/block-chaos/ npm run build
// Lokal (dev/preview) bleibt der Base-Pfad '/', damit Tests & npm run dev
// unverändert funktionieren.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  build: {
    chunkSizeWarningLimit: 5000,
  },
});

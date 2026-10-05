import { defineConfig } from 'vite';

// Relative base so the built site works from the GitHub Pages sub-path
// (https://<user>.github.io/incised-lettering/) as well as locally.
export default defineConfig({
  base: './',
  // three.js (the 3D view) is one large piece, loaded only when the 3D view is opened.
  build: { chunkSizeWarningLimit: 700 },
});

import { defineConfig } from 'vite';

// Relative base so the built site works from the GitHub Pages sub-path
// (https://<user>.github.io/incised-lettering/) as well as locally.
export default defineConfig({
  base: './',
});

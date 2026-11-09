import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is built to dist-renderer/ and served by the main process over
// the app:// protocol, so asset URLs must be relative.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist-renderer',
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: false
  }
});

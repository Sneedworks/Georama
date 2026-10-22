import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  plugins: [preact()],
  base: '/',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    target: 'chrome152',
  },
});

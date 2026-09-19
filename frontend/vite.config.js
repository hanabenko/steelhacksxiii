import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    rollupOptions: {
      output: { manualChunks: { 'three-core': ['three'], 'three-controls': ['three/addons/controls/OrbitControls.js'] } },
    },
  },
});

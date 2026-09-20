import { defineConfig } from 'vite';
export default defineConfig({
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } } },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } } },
  build: {
    rollupOptions: {
      output: { manualChunks: { 'three-core': ['three'], 'three-controls': ['three/addons/controls/OrbitControls.js'] } },
    },
  },
});

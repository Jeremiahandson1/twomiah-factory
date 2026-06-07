import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The admin is served from /admin/ in production by the same Hono backend
// that serves the public site. base: '/admin/' makes Vite emit asset paths
// like /admin/assets/index-xxx.js so they resolve correctly when mounted
// at that prefix.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})

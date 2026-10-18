// The admin screens' build: one React app for the website and the CRM, served by the unified server under /crm.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config.ts'

export default defineConfig({
  root: path.resolve(import.meta.dirname, '.'),
  base: '/crm-assets/',
  plugins: [react()],
  // The shared client's session lives in httpOnly cookies here, not localStorage (packages/tenant-ui/src/api/client.ts).
  define: { 'import.meta.env.VITE_AUTH_MODE': JSON.stringify('cookie') },
  css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: tailwindConfig.content.map((p) => path.resolve(import.meta.dirname, '..', p)) }), autoprefixer()] } },
  resolve: {
    // One React for the app and the shared screens (packages/tenant-ui installs its own for its tests).
    dedupe: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
  },
  server: {
    port: 3000,
    proxy: { '/api': { target: process.env.API_URL || 'http://localhost:3001', changeOrigin: true } },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: { output: { manualChunks: { 'vendor-react': ['react', 'react-dom', 'react-router-dom'] } } },
  },
})

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@capacitor\/core$/, replacement: path.resolve(__dirname, 'src/capacitor-stub.js') },
      { find: /^@capacitor\/(.+)$/, replacement: path.resolve(__dirname, 'src/capacitor-stub.js') },
      { find: /^@capacitor-community\/(.+)$/, replacement: path.resolve(__dirname, 'src/capacitor-stub.js') },
    ],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'admin-scheduling': [
            './src/components/admin/SchedulingHub',
            './src/components/admin/DragDropScheduler',
            './src/components/admin/ScheduleCalendar',
          ],
          'admin-billing': [
            './src/components/admin/BillingDashboard',
            './src/components/admin/PayrollProcessing',
            './src/components/admin/ClaimsManagement',
          ],
          'admin-reports': [
            './src/components/admin/ReportsAnalytics',
            './src/components/admin/AuditLogs',
          ],
        },
      },
    },
  },
});

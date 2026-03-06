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
        target: process.env.VITE_API_URL || 'http://localhost:10000',
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
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          if (id.includes('/admin/SchedulingHub') || id.includes('/admin/DragDropScheduler') || id.includes('/admin/ScheduleCalendar')) {
            return 'admin-scheduling';
          }
          if (id.includes('/admin/BillingDashboard') || id.includes('/admin/PayrollProcessing') || id.includes('/admin/ClaimsManagement')) {
            return 'admin-billing';
          }
          if (id.includes('/admin/ReportsAnalytics') || id.includes('/admin/AuditLogs')) {
            return 'admin-reports';
          }
        },
      },
    },
  },
});

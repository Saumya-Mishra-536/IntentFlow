import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/')) {
            return 'vendor-react';
          }
          if (id.includes('@radix-ui') || id.includes('lucide-react')) {
            return 'vendor-ui';
          }
          if (id.includes('@xyflow') || id.includes('@dagrejs') || id.includes('/dagre/')) {
            return 'vendor-flow';
          }
          if (id.includes('/d3') || id.includes('/recharts') || id.includes('framer-motion')) {
            return 'vendor-charts';
          }
          return undefined;
        },
      },
    },
  },
})

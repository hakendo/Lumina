import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Bypass: browser navigations send Accept: text/html — let Vite serve the SPA.
// API calls send Accept: application/json — forward to Express.
const apiProxy = (target = 'http://localhost:3001') => ({
  target,
  bypass(req) {
    if (req.headers.accept?.includes('text/html')) return req.url;
  },
});

export default defineConfig({
  define: {
    'process.env.DRAGGABLE_DEBUG': 'undefined',
  },
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires function form for manualChunks
        manualChunks(id) {
          if (id.includes('react-dom') || id.includes('react-router')) return 'vendor-react';
          if (id.includes('react-grid-layout') || id.includes('react-resizable') || id.includes('react-draggable')) return 'vendor-grid';
          if (id.includes('/zustand/') || id.includes('/axios/') || id.includes('/nanoid/')) return 'vendor-state';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiProxy(),
    },
    allowedHosts: ['unmortified-corporally-eulalia.ngrok-free.dev'],
  },
})

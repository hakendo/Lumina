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
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/auth': apiProxy(),
      '/admin/users': apiProxy(),
      '/admin/orgs': apiProxy(),
      '/admin/reports': apiProxy(),
      '/areas': apiProxy(),
      '/datasets': apiProxy(),
      '/reports': apiProxy(),
      '/notifications': apiProxy(),
    },
    allowedHosts: ['unmortified-corporally-eulalia.ngrok-free.dev'],
  },
})

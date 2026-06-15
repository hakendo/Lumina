import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:3001',
      // Específico a propósito: '/admin' a secas capturaría también la
      // navegación SPA a la página /admin (refresh → 404 del backend)
      '/admin/users': 'http://localhost:3001',
      '/admin/orgs': 'http://localhost:3001',
      '/admin/reports': 'http://localhost:3001',
      '/areas': 'http://localhost:3001',
      '/datasets': 'http://localhost:3001',
      '/reports': 'http://localhost:3001',
      '/notifications': 'http://localhost:3001',
    },
    allowedHosts:["unmortified-corporally-eulalia.ngrok-free.dev"]

  },
})

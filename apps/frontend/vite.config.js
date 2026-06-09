import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:3001',
      '/datasets': 'http://localhost:3001',
      '/reports': 'http://localhost:3001',
    },
  },
})

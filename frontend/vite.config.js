import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Output to frontend/dist so server.py can find it at a known path
    outDir: 'dist',
  },
  server: {
    // During development, proxy all /orders, /products, /webhooks, /reports
    // requests to the Python backend running on port 8000
    proxy: {
      '/orders':   'http://127.0.0.1:8000',
      '/products': 'http://127.0.0.1:8000',
      '/webhooks': 'http://127.0.0.1:8000',
      '/reports':  'http://127.0.0.1:8000',
    },
  },
})

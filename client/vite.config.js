import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/verify': 'http://localhost:3000',
    }
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  }
})

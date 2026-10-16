import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Chạy dev: npm run dev -> http://localhost:5173/admin/ (API chuyển tiếp sang account server :8080 cùng nguồn, cookie dùng được).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/admin/api': 'http://127.0.0.1:8080' },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
})

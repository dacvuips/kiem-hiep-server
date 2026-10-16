import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Trang web người chơi, phục vụ tại "/" bởi account server (cùng nguồn với API).
// Chạy dev: npm run dev -> http://localhost:5174/ (API /v1 chuyển tiếp sang account server :8080).
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/v1': 'http://127.0.0.1:8080' },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
})

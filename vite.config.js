import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Per-page lazy-loaded chunks happen automatically with React.lazy(),
    // but we also extract heavy/shared deps into vendor chunks so the
    // user only re-downloads them when those packages actually change.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'qrcode-scan': ['html5-qrcode'],
          'http': ['axios'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})

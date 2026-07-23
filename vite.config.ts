import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' → relative asset URLs, so the same build works locally, on GitHub
// Pages under /<repo>/, and inside the Electron desktop shell (file://) unchanged.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      // Plotly is ~3 MB; split it so the app shell paints before it downloads.
      output: {
        manualChunks: (id: string) => (id.includes('plotly.js-dist-min') ? 'plotly' : undefined),
      },
    },
  },
})

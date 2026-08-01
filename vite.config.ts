import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// COOP/COEP give SharedArrayBuffer, which webR needs to run DESeq2. The dev and
// preview servers set them directly; on GitHub Pages, where headers cannot be
// configured, public/coi-serviceworker.min.js supplies them instead.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// base: './' → relative asset URLs, so the same build works locally, on GitHub
// Pages under /<repo>/, and inside the Electron desktop shell (file://) unchanged.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
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

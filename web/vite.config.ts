import { defineConfig } from 'vite'

// Cross-origin isolation, as served by server/signaling.py: only isolated
// pages get the fine timer (performance.now() at 5 µs instead of 100 µs).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  server: {
    headers: isolationHeaders,
    // The page always connects to ws://<its own host>/ws. In production the
    // signaling server serves page and WebSocket on one port; during
    // `npm run dev` Vite forwards /ws to it (start server/signaling.py too).
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})

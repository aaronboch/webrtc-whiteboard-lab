import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // The page always connects to ws://<its own host>/ws. In production the
    // signaling server serves page and WebSocket on one port; during
    // `npm run dev` Vite forwards /ws to it (start server/signaling.py too).
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})

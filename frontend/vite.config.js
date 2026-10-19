import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Reads frontend/.env, .env.production etc. VITE_BASE_PATH is the path prefix the app is
  // served under: "/" locally (default), "/knowledgegraphportal/" on the university server.
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '')
  // Vite expects a trailing slash; accept "/knowledgegraphportal" as well
  const base = (env.VITE_BASE_PATH || '/').replace(/\/*$/, '/')
  // Dev server only (npm run dev): forward API routes to the local backend
  const backend = { target: 'http://localhost:8000', changeOrigin: true }
  return {
    base,
    plugins: [react()],
    server: {
      proxy: {
        '/validation': backend,
        '/workspace': backend,
        '/auth': backend,
        '/users': backend,
      },
    },
  }
})

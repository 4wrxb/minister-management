import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
//
// `base: './'` (production only) makes Vite emit asset URLs as relative paths
// (e.g. <script src="./assets/index-abc.js">). The actual URL sub-path the
// app is hosted at is supplied at runtime by the Flask backend, which injects
// <base href> + <meta name="app-base"> into the served index.html (see
// backend/app.py `inject_base_tag`). Result: one bundle works under any
// URL_PREFIX without rebuilding.
//
// In dev mode we keep the default absolute base so Vite's HMR and module
// proxying work normally.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
}))

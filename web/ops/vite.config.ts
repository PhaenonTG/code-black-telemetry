import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
// The repo root, three levels up (web/ops -> web -> repo root). Reused OPS
// modules (map, services) are imported directly from ../../../src via
// relative path -- Vite needs explicit permission to serve files outside
// this package's own directory.
const repoRoot = path.resolve(dirname, '../..')

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [dirname, repoRoot],
    },
  },
  build: {
    outDir: 'dist',
  },
})

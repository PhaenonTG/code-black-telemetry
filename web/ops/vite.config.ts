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
  resolve: {
    // Reused modules under ../../../src resolve `react`/`react-dom` relative
    // to their own location, which would otherwise find the repo root's
    // separate copy and produce a second React instance (breaking hooks
    // with "Cannot read properties of null (reading 'useState')"). Force
    // every import in this build's module graph to this package's copy.
    alias: {
      react: path.resolve(dirname, 'node_modules/react'),
      'react-dom': path.resolve(dirname, 'node_modules/react-dom'),
    },
  },
  server: {
    fs: {
      allow: [dirname, repoRoot],
    },
  },
  build: {
    outDir: 'dist',
  },
})

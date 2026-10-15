import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as bundleWorker } from 'esbuild'
import { assertProductionEnv } from './scripts/productionEnv.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))
// The repo root, three levels up (web/ops -> web -> repo root). Reused OPS
// modules (map, services) are imported directly from ../../../src via
// relative path -- Vite needs explicit permission to serve files outside
// this package's own directory.
const repoRoot = path.resolve(dirname, '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, dirname, "")
  if (mode === 'production') assertProductionEnv(env)
  const coreProxyTarget = (env.CODEBLACK_CORE_PROXY_TARGET || "http://127.0.0.1:8000").replace(/\/+$/, "")
  return {
  // Pages production has previously served the SPA fallback for /api/core/*
  // when a deploy ran `vite build` directly and omitted the Advanced Mode worker.
  // Emit the worker as part of *every* Vite build, regardless of the build command.
  plugins: [react(), {
    name: 'ops-pages-worker',
    apply: 'build',
    async closeBundle() {
      await bundleWorker({
        entryPoints: [path.join(dirname, 'worker/entry.ts')],
        outfile: path.join(dirname, 'dist/_worker.js'),
        bundle: true,
        format: 'esm',
        platform: 'neutral',
        target: 'es2022',
        minify: true,
      })
    },
  }],
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
    proxy: {
      "/core-api": {
        target: coreProxyTarget,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/core-api/, ""),
      },
      "/core-ws": {
        target: coreProxyTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (requestPath) => requestPath.replace(/^\/core-ws/, ""),
      },
      "/api/kandrive/graphql": {
        target: "https://www.kandrive.gov",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/api/graphql",
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // mapbox-gl alone accounts for well over half the previous single ~3MB chunk -- splitting
        // it out means Settings/Fleet/System/etc (already route-split, see App.tsx) genuinely
        // don't pull in the map stack at all, and the map vendor code itself can cache separately
        // from the app's own code across deploys. This build uses rolldown-vite, which (unlike
        // stock Rollup) only accepts the function form of manualChunks, not an object map.
        manualChunks(id: string) {
          if (id.includes('node_modules/mapbox-gl')) return 'mapbox-gl'
        },
      },
    },
  },
  }
})

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()], server: { proxy: {
  "/api/hurricane": { target: "https://ops.codeblackwx.com", changeOrigin: true, rewrite: () => "/api/public/hurricane" },
  "/api/tropical-discovery": { target: "https://ops.codeblackwx.com", changeOrigin: true, rewrite: () => "/api/public/tropical-discovery" },
  "/api/tropical-systems": { target: "https://ops.codeblackwx.com", changeOrigin: true, rewrite: (path) => path.replace("/api/tropical-systems", "/api/public/tropical-systems") },
  "/api/mapbox-token": { target: "https://ops.codeblackwx.com", changeOrigin: true, rewrite: () => "/overlay-core/mapbox-token" },
} } });

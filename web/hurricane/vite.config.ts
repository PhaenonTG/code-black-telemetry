import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()], server: { proxy: {
  "/api/hurricane": { target: "https://ops.codeblackwx.com", changeOrigin: true, rewrite: () => "/api/public/hurricane" },
  "/api/mapbox-token": { target: "https://ops.codeblackwx.com", changeOrigin: true, rewrite: () => "/overlay-core/mapbox-token" },
} } });

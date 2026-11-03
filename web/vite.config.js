import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/media": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});

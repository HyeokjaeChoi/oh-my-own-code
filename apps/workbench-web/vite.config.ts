import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4200,
    strictPort: true,
    headers: {
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  },
  preview: {
    headers: {
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  resolve: { dedupe: ["react", "react-dom"] },
});

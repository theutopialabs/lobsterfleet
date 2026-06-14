import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server proxies API + terminal ws to the Node server so the UI talks to a
// real backend during development. Prod build is static, served by the server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: {
      "/api": { target: "http://localhost:8088", ws: true },
      "/healthz": "http://localhost:8088",
      "/docs": "http://localhost:8088",
    },
  },
  // dev-mode dep optimizer needs the same es2022 floor as the prod build,
  // noVNC's top-level await breaks the es2020 default
  optimizeDeps: {
    esbuildOptions: { target: "es2022" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // noVNC 1.7 ships top-level await, so target a baseline that allows it
    // (Chrome 89+, Safari 15+, Firefox 89+). Fine for this modern-only UI.
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@xterm")) return "terminal";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("react")) return "react";
          return "vendor";
        },
      },
    },
  },
});

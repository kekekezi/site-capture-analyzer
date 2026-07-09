import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/background.ts"),
        content: resolve(__dirname, "src/content/content.ts"),
        injected: resolve(__dirname, "src/injected/injected.ts"),
        popup: resolve(__dirname, "popup.html"),
        settings: resolve(__dirname, "settings.html"),
        viewer: resolve(__dirname, "viewer.html")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  test: {
    environment: "node"
  }
});

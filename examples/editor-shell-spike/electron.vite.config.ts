import { defineConfig } from "electron-vite";

// THROWAWAY spike S0.1. Same shape as the templates' electron.vite.config.ts: ESM main, CJS preload
// (a sandboxed preload cannot be an ES module), renderer served over ignifx:// from out/renderer.
export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      lib: { entry: "main/main.ts" },
      rollupOptions: { external: ["electron"], output: { format: "es", entryFileNames: "index.js" } },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      lib: { entry: "preload/preload.ts" },
      rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: "index.cjs" } },
    },
  },
  renderer: {
    root: ".",
    base: "./",
    build: { target: "esnext", outDir: "out/renderer", rollupOptions: { input: "index.html" } },
  },
});

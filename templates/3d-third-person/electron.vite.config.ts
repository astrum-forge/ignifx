import { ignifx } from "@ignifx/vite-plugin";
import { defineConfig } from "electron-vite";

/**
 * The desktop build (`docs/architecture/14-platform-electron.md` §3).
 *
 * `electron-vite` runs three Vite builds from one config — main, preload, renderer — and in `dev`
 * it starts the renderer's dev server, publishes its URL as `ELECTRON_RENDERER_URL`, and launches
 * Electron against `out/main`. `vite.config.ts` still drives the **browser** build; the `renderer`
 * section below repeats only what differs, so the two cannot drift on the plugin or the target.
 *
 * ## Two output formats, for two different reasons
 *
 * - **preload → CommonJS, named `index.cjs`.** A sandboxed preload script cannot be an ES module.
 *   Measured on Electron 44.2.0 / macOS arm64: with `sandbox: true` — which `CONSTITUTION.md` §9.2
 *   fixes — an `.mjs` preload left `window.ignifxHost` undefined and logged nothing at all, while
 *   the byte-identical CommonJS build worked. The `.cjs` extension is required because this
 *   package is `"type": "module"`.
 * - **main → ES module.** Electron 44 loads an ESM main entry, this project is `"type": "module"`,
 *   and `desktop/main.ts` uses `import.meta.dirname` to find the preload script and the renderer
 *   beside it.
 *
 * `external: ["electron"]` on both: Electron provides the module at runtime, and bundling it would
 * replace the real one with a copy that has no bindings.
 */
export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      lib: { entry: "desktop/main.ts" },
      rollupOptions: {
        external: ["electron"],
        output: { format: "es", entryFileNames: "index.js" },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      lib: { entry: "desktop/preload.ts" },
      rollupOptions: {
        external: ["electron"],
        // See the module comment: CommonJS, and `.cjs` because the package is `"type": "module"`.
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    // `electron-vite` defaults the renderer root to `src/renderer`; an ignifx template keeps
    // `index.html` and `src/` at the project root, exactly as the browser build does, so the root
    // is stated rather than inherited. `assetRoot` in the plugin is resolved against it, which is
    // what makes the desktop build read the same `assets/` directory as `vite build`.
    root: ".",
    // The same plugin, the same asset root, the same manifest as the browser build.
    plugins: [ignifx()],
    // A packaged renderer is loaded from `ignifx://app/index.html`, so every asset URL has to be
    // relative to the document rather than rooted at `/`.
    base: "./",
    build: {
      target: "esnext",
      outDir: "out/renderer",
      rollupOptions: { input: "index.html" },
    },
  },
});

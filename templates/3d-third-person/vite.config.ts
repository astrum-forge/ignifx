import { ignifx } from "@ignifx/vite-plugin";
import { defineConfig } from "vite";

// `assetRoot` defaults to `assets/`, which is where this template keeps its models, its textures
// and its documents. The plugin scans that directory, writes the manifest `app.assets` resolves
// addresses through, validates every `.material.json` / `.animator.json` / `.input.json` /
// `.audio.json` / `.i18n.json` header at build time, copies the WebAssembly that `@ignifx/physics`
// declares as a public asset, and injects `ignifx.config.ts` as `import.meta.env.IGNIFX_CONFIG`.
export default defineConfig({
  plugins: [ignifx()],
  build: { target: "esnext" },
});

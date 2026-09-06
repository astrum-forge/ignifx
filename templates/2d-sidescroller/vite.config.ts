import { ignifx } from "@ignifx/vite-plugin";
import { defineConfig } from "vite";

// `assetRoot` defaults to `assets/`, which is where this template keeps its art, its atlases and
// its documents. The plugin scans that directory, writes the manifest `app.assets` resolves
// addresses through, validates every `.atlas.json` / `.spriteanim.json` / `.tilemap.json` /
// `.input.json` / `.audio.json` header at build time, and injects `ignifx.config.ts` as
// `import.meta.env.IGNIFX_CONFIG`.
export default defineConfig({
  plugins: [ignifx()],
  build: { target: "esnext" },
});

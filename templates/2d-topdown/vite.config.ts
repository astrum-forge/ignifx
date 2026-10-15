import { editorHostPlugin } from "@ignifx/editor-host/vite";
import { ignifx } from "@ignifx/vite-plugin";
import { defineConfig, loadEnv } from "vite";

/**
 * The origin the scene view may be framed by when the editor does not pass one: the packaged ignifx
 * editor's. The editor sets `IGNIFX_EDITOR_ORIGIN` when it starts this dev server, which matters
 * while the editor itself runs from a dev server of its own.
 */
const PACKAGED_EDITOR_ORIGIN = "ignifx-editor://app";

// `assetRoot` defaults to `assets/`, which is where this template keeps its art, its atlases and
// its documents. The plugin scans that directory, writes the manifest `app.assets` resolves
// addresses through, validates every `.atlas.json` / `.spriteanim.json` / `.tilemap.json` /
// `.input.json` / `.audio.json` header at build time, and injects `ignifx.config.ts` as
// `import.meta.env.IGNIFX_CONFIG`.
//
// `editorHostPlugin` lets the ignifx editor open the project: under `vite dev` it serves the
// editor's scene view at `/__ignifx_editor__/`, which only `editorOrigin` may frame, and the play
// controls `main.ts` hands its app to. In `vite build` the play controls are an empty function and
// the scene view does not exist, so the game ships without editor code. `loadEnv` with no env
// directory reads only the process environment.
export default defineConfig(({ mode }) => ({
  plugins: [
    ignifx(),
    editorHostPlugin({
      editorOrigin: loadEnv(mode, false, "IGNIFX_EDITOR_ORIGIN")["IGNIFX_EDITOR_ORIGIN"] ?? PACKAGED_EDITOR_ORIGIN,
    }),
  ],
  build: { target: "esnext" },
}));

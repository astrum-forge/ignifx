// THROWAWAY spike S0.1 — not for merge. The dev-server half of the editor host: serves a second HTML
// entry at /__ignifx_editor__/ whose module is ./host.ts, and a virtual module that hands the host the
// project's extensions, its scene address and the installed @ignifx/core version.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const EDITOR_PATH = "/__ignifx_editor__/";
const PROJECT_MODULE_ID = "virtual:ignifx-editor-spike/project";
const RESOLVED_PROJECT_MODULE_ID = `\0${PROJECT_MODULE_ID}`;

export interface EditorHostSpikeOptions {
  /** Project module (root-relative) exporting `extensions(): Extension[]`. */
  readonly extensionsModule: string;
  /** Scene address to load, relative to the asset root. */
  readonly scene: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const hostModulePath = join(here, "host.ts");

export function editorHostSpike(options: EditorHostSpikeOptions): Plugin {
  let root = process.cwd();
  return {
    name: "ignifx-editor-host-spike",
    // Dev only: a production build must never contain the editor entry.
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    config() {
      // The dep optimizer only crawls the project's own HTML entries. Without this, the first visit
      // to /__ignifx_editor__/ discovers deps late and Vite answers with a full reload of the page.
      // Setting `entries` replaces Vite's default crawl of `**/*.html`, so the default is restated.
      // SPIKE_NO_OPTIMIZE_ENTRIES=1 turns this off to observe the failure it prevents.
      if (process.env["SPIKE_NO_OPTIMIZE_ENTRIES"] === "1") {
        return {};
      }
      return { optimizeDeps: { entries: ["**/*.html", hostModulePath] } };
    },
    resolveId(id) {
      return id === PROJECT_MODULE_ID ? RESOLVED_PROJECT_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_PROJECT_MODULE_ID) {
        return null;
      }
      // The version core reports (`VERSION`) is "0.0.0" until the release pipeline stamps it, so the
      // installed package.json is read from the *project's* resolution of @ignifx/core.
      const requireFromProject = createRequire(join(root, "package.json"));
      const corePackage = requireFromProject.resolve("@ignifx/core/package.json");
      const coreVersion = (JSON.parse(readFileSync(corePackage, "utf8")) as { version: string }).version;
      const extensionsPath = resolve(root, options.extensionsModule);
      return [
        `export { extensions } from ${JSON.stringify(extensionsPath)};`,
        `export const scene = ${JSON.stringify(options.scene)};`,
        `export const coreVersion = ${JSON.stringify(coreVersion)};`,
        `export const corePackagePath = ${JSON.stringify(corePackage)};`,
      ].join("\n");
    },
    configureServer(server) {
      // Registered directly (not returned as a post hook) so it runs before Vite's own HTML fallback.
      server.middlewares.use(async (request, response, next) => {
        const url = (request.url ?? "").split("?")[0] ?? "";
        if (url === "/__ignifx_editor__") {
          response.statusCode = 302;
          response.setHeader("Location", EDITOR_PATH);
          response.end();
          return;
        }
        if (url !== EDITOR_PATH && url !== `${EDITOR_PATH}index.html`) {
          next();
          return;
        }
        const html = [
          "<!doctype html>",
          '<html lang="en"><head><meta charset="utf-8" /><title>ignifx editor host (spike)</title>',
          "<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}body{position:relative}canvas{display:block;width:100%;height:100%}</style>",
          "</head><body>",
          '<canvas id="scene-view"></canvas>',
          `<script type="module" src="/@fs${hostModulePath.replaceAll("\\", "/")}"></script>`,
          "</body></html>",
        ].join("\n");
        try {
          const transformed = await server.transformIndexHtml(request.url ?? EDITOR_PATH, html);
          response.setHeader("Content-Type", "text/html");
          response.setHeader("Cache-Control", "no-store");
          // Only the editor may frame the host page (SPIKE_FRAME_ANCESTORS, e.g. "ignifx://app").
          const ancestors = process.env["SPIKE_FRAME_ANCESTORS"];
          if (ancestors !== undefined) {
            response.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors}`);
          }
          response.end(transformed);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

/**
 * The editor host's Vite plugin: the scene view's page on the project's own dev server, and
 * `virtual:ignifx/editor` for the play view (`docs/architecture/17-editor-host.md` §3).
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { EditorHostErrorCode, isEditorOrigin } from "../error-codes.js";
import { EditorHostPluginError } from "./errors.js";
import {
  DEFAULT_EXTENSIONS_MODULE,
  EDITOR_ENTRY_MODULE_ID,
  EDITOR_MODULE_ID,
  EDITOR_PAGE_PATH,
  editorEntryModuleSource,
  editorPageHtml,
  normalizeExtensionsModule,
  playControlsModuleSource,
  RESOLVED_EDITOR_ENTRY_MODULE_ID,
  RESOLVED_EDITOR_MODULE_ID,
} from "./modules.js";
import { createPrivateDirGuard, isPrivateRealPath, realPathOrSelf } from "./private-dir.js";
import type { ConfigEnv, Plugin, ViteDevServer } from "vite";

/**
 * Options accepted by {@link editorHostPlugin}.
 *
 * @beta
 */
export interface EditorHostPluginOptions {
  /**
   * The origin the editor is served from, for example `"ignifx://app"` when packaged or
   * `"http://localhost:5173"` while the editor itself runs from a dev server. Only this origin may
   * frame either view in `vite dev`, and only it can hand either view a port.
   */
  readonly editorOrigin: string;
  /**
   * The project's extensions module, relative to the Vite root. It exports `extensions()`, which
   * returns the list `main.ts` passes to `createApp`. When the file does not exist the scene view
   * runs with no extensions. Defaults to `"/src/extensions.ts"`.
   */
  readonly extensions?: string;
  /** A scene address the scene view loads before it starts. Defaults to none. */
  readonly bootScene?: string | null;
  /** Milliseconds between heartbeats in both views. Defaults to the host's `1000`. */
  readonly heartbeatIntervalMs?: number;
}

/** The plugin names, as they appear in Vite's logs. */
const PAGE_PLUGIN_NAME = "ignifx-editor-host";
const PLAY_PLUGIN_NAME = "ignifx-editor-host:play-controls";

/** What Vite crawls for dependencies when `optimizeDeps.entries` is not set. */
const DEFAULT_OPTIMIZE_ENTRIES = "**/*.html";

/**
 * Reads the version of the project's own `@ignifx/core`.
 *
 * @param root - The Vite root.
 * @returns The version, or `null` when the project does not resolve `@ignifx/core`.
 *
 * @beta
 */
export function readProjectEngineVersion(root: string): string | null {
  try {
    const requireFromProject = createRequire(join(root, "package.json"));
    const manifest: unknown = JSON.parse(readFileSync(requireFromProject.resolve("@ignifx/core/package.json"), "utf8"));
    if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
      return typeof manifest.version === "string" ? manifest.version : null;
    }
    return null;
  } catch {
    // An unresolvable core is reported by the host as core's own `VERSION`, not as a failure here.
    return null;
  }
}

/**
 * Checks the options and applies their defaults.
 *
 * @param options - The options as given.
 * @returns The extensions module path and the heartbeat period.
 * @throws EditorHostPluginError `IGX-1801` for a malformed origin, `IGX-1803` for a bad option.
 */
function checkOptions(options: EditorHostPluginOptions): { extensions: string; heartbeatIntervalMs: number | null } {
  if (!isEditorOrigin(options.editorOrigin)) {
    throw new EditorHostPluginError(
      EditorHostErrorCode.invalidEditorOrigin,
      `editorOrigin "${options.editorOrigin}" is not an origin; pass one such as "ignifx://app" or "http://localhost:5173".`,
    );
  }
  const interval = options.heartbeatIntervalMs;
  if (interval !== undefined && (!Number.isFinite(interval) || interval <= 0)) {
    throw new EditorHostPluginError(
      EditorHostErrorCode.invalidOption,
      `heartbeatIntervalMs must be a positive number of milliseconds; got ${String(interval)}.`,
    );
  }
  return {
    extensions: normalizeExtensionsModule(options.extensions ?? DEFAULT_EXTENSIONS_MODULE),
    heartbeatIntervalMs: interval ?? null,
  };
}

/**
 * The editor host's Vite plugin.
 *
 * @remarks
 * It is two plugins, because the two halves run under different commands:
 *
 * - `ignifx-editor-host` (`vite dev` only) serves the scene view at `/__ignifx_editor__/` with
 *   `Content-Security-Policy: frame-ancestors <editorOrigin>`, and adds the same header to every
 *   page a browser navigates to, so the game's own `index.html` (the play view) can be framed by the
 *   editor and by nothing else. A `Content-Security-Policy` in `server.headers` replaces it. The page's module imports the host,
 *   `virtual:ignifx/scripts`, `virtual:ignifx/manifest` and the project's extensions module from
 *   the project's own graph, and calls `startEditorHost`. It adds the extensions module to
 *   `optimizeDeps.entries` (keeping Vite's default crawl) and keeps `@ignifx/editor-host` out of
 *   pre-bundling, so the host reaches the same pre-bundled `@ignifx/core` as the game.
 * - `ignifx-editor-host:play-controls` (every command) serves `virtual:ignifx/editor`: the play
 *   controls under `vite dev`, an empty function under `vite build`. Under `vite dev` and
 *   `vite preview` it also answers 404 to any request into `.ignifx/`, the editor's private
 *   directory, by path or through a symbolic link, as `ignifx()` does; this covers a config that
 *   lists this plugin without `ignifx()`.
 *
 * List it after `ignifx()` from `@ignifx/vite-plugin`, which serves the two modules the scene
 * view imports.
 *
 * @param options - The editor's origin and the scene view's options.
 * @returns The plugins, to be listed in `vite.config.ts`.
 * @throws EditorHostPluginError `IGX-1801` for a malformed `editorOrigin`, `IGX-1803` for a bad
 * `extensions` path or `heartbeatIntervalMs`.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { ignifx } from "@ignifx/vite-plugin";
 * import { editorHostPlugin } from "@ignifx/editor-host/vite";
 * import { defineConfig } from "vite";
 *
 * export default defineConfig({
 *   plugins: [ignifx(), editorHostPlugin({ editorOrigin: "ignifx://app" })],
 * });
 * ```
 *
 * @beta
 */
export function editorHostPlugin(options: EditorHostPluginOptions): Plugin[] {
  const { extensions, heartbeatIntervalMs } = checkOptions(options);
  const { editorOrigin } = options;
  let root = process.cwd();
  let base = "/";
  let command: ConfigEnv["command"] = "serve";
  let engineVersion: string | null = null;

  const extensionsFile = (): string => resolve(root, `.${extensions}`);
  // Only the editor may put either view in a frame; any other page that tries is blocked. A tab the
  // developer opens on the dev server is not a frame, so the policy leaves it alone.
  const framePolicy = `frame-ancestors ${editorOrigin}`;

  /**
   * Sends the frame policy with every page a browser navigates to, the game's `index.html` (the
   * play view) included. Navigations and frames ask for `text/html`; module and asset requests do
   * not, and a policy on them would do nothing anyway.
   *
   * @param server - The dev server.
   */
  const installPlayViewPolicy = (server: ViteDevServer): void => {
    server.middlewares.use((request, response, next) => {
      const isRead = request.method === "GET" || request.method === "HEAD";
      if (isRead && (request.headers.accept ?? "").includes("text/html")) {
        response.setHeader("Content-Security-Policy", framePolicy);
      }
      next();
    });
  };

  /**
   * Serves the scene view's page and redirects the path without its trailing slash.
   *
   * @param server - The dev server.
   */
  const installPage = (server: ViteDevServer): void => {
    const pagePath = `${base.endsWith("/") ? base.slice(0, -1) : base}${EDITOR_PAGE_PATH}`;
    server.middlewares.use((request, response, next) => {
      const url = request.url ?? "";
      const path = url.split("?")[0] ?? "";
      if (path === pagePath.slice(0, -1)) {
        response.statusCode = 302;
        response.setHeader("Location", `${pagePath}${url.slice(path.length)}`);
        response.end();
        return;
      }
      if (path !== pagePath && path !== `${pagePath}index.html`) {
        next();
        return;
      }
      server.transformIndexHtml(EDITOR_PAGE_PATH, editorPageHtml(), request.originalUrl).then(
        (html) => {
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Security-Policy", framePolicy);
          response.end(html);
        },
        (error: unknown) => {
          next(error);
        },
      );
    });
  };

  const page: Plugin = {
    name: PAGE_PLUGIN_NAME,
    // A production build must never contain the scene view.
    apply: "serve",

    config(userConfig) {
      const projectRoot = resolve(process.cwd(), userConfig.root ?? ".");
      const scanExtensions = existsSync(resolve(projectRoot, `.${extensions}`));
      // Vite concatenates arrays when it merges this into the user's config, and setting `entries`
      // at all replaces its default crawl of every HTML file, so the default is restated only when
      // the user set nothing.
      const entries =
        userConfig.optimizeDeps?.entries === undefined
          ? [DEFAULT_OPTIMIZE_ENTRIES, extensions.slice(1)]
          : [extensions.slice(1)];
      return {
        optimizeDeps: {
          ...(scanExtensions ? { entries } : {}),
          // Served as it is, its `@ignifx/core` import resolves to the game's own pre-bundled core.
          exclude: ["@ignifx/editor-host"],
        },
      };
    },

    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      base = resolvedConfig.base;
      engineVersion = readProjectEngineVersion(root);
    },

    configureServer(server) {
      // Registered directly rather than returned as a post hook, so they run before Vite's own HTML
      // fallback and index middleware.
      installPlayViewPolicy(server);
      installPage(server);
    },

    resolveId(id) {
      return id === EDITOR_ENTRY_MODULE_ID ? RESOLVED_EDITOR_ENTRY_MODULE_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_EDITOR_ENTRY_MODULE_ID) {
        return null;
      }
      return editorEntryModuleSource({
        editorOrigin,
        extensionsModule: existsSync(extensionsFile()) ? extensions : null,
        bootScene: options.bootScene ?? null,
        engineVersion,
        heartbeatIntervalMs,
      });
    },
  };

  const play: Plugin = {
    name: PLAY_PLUGIN_NAME,

    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      command = resolvedConfig.command;
      engineVersion = readProjectEngineVersion(root);
    },

    // Defence in depth for a config without `ignifx()`, whose guard otherwise keeps `.ignifx/` (the
    // editor's MCP token) off the server; registered in the hook body, ahead of Vite's file serving.
    configureServer(server) {
      const realRoot = realPathOrSelf(server.config.root);
      const { publicDir } = server.config;
      server.middlewares.use(
        createPrivateDirGuard(() => ({
          realRoot,
          base: server.config.base,
          serveDirs: publicDir === "" ? [server.config.root] : [server.config.root, publicDir],
          alias: server.config.resolve.alias,
        })),
      );
    },

    configurePreviewServer(server) {
      const realRoot = realPathOrSelf(server.config.root);
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use(
        createPrivateDirGuard(() => ({ realRoot, base: server.config.base, serveDirs: [outDir], alias: [] })),
      );
    },

    resolveId(id) {
      return id === EDITOR_MODULE_ID ? RESOLVED_EDITOR_MODULE_ID : null;
    },

    load(id) {
      if (id === RESOLVED_EDITOR_MODULE_ID) {
        return playControlsModuleSource({ editorOrigin, engineVersion, heartbeatIntervalMs, hot: command === "serve" });
      }
      // Whatever resolved to it (an alias, `/@id/`, an import through a link), a module whose real
      // path is in `.ignifx/` is never loaded: in dev it would be served, in a build bundled.
      const file = id.split("?", 1)[0] ?? "";
      if (!id.startsWith("\0") && isAbsolute(file) && isPrivateRealPath(realPathOrSelf(root), file)) {
        this.error(
          `"${file}" is in the editor-private .ignifx/ directory, which holds the editor's MCP token; ` +
            "nothing may import or serve it. Remove the import or link.",
        );
      }
      return null;
    },
  };

  return [page, play];
}

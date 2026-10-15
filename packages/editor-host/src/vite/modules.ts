/**
 * The page and the two modules the plugin generates: the scene view's HTML entry, the module that
 * page runs, and `virtual:ignifx/editor`, the play view's controls.
 */

import { IGNIFX_CONFIG_DEFINE_KEY, MANIFEST_MODULE_ID, SCRIPTS_MODULE_ID } from "@ignifx/vite-plugin";
import { EditorHostErrorCode } from "../error-codes.js";
import { EditorHostPluginError } from "./errors.js";

/**
 * The path the scene view is served at, below the dev server's `base`.
 *
 * @beta
 */
export const EDITOR_PAGE_PATH = "/__ignifx_editor__/";

/**
 * The module a game imports to hand its app to the editor's play controls.
 *
 * @example
 * ```ts
 * import { attachEditorPlayControls } from "virtual:ignifx/editor";
 *
 * attachEditorPlayControls(app);
 * ```
 *
 * @beta
 */
export const EDITOR_MODULE_ID = "virtual:ignifx/editor";

/**
 * The resolved id of {@link EDITOR_MODULE_ID}. The `\0` prefix marks it as owned by a plugin.
 *
 * @beta
 */
export const RESOLVED_EDITOR_MODULE_ID: string = `\0${EDITOR_MODULE_ID}`;

/**
 * The module the scene view's page runs. Only the generated page imports it.
 *
 * @beta
 */
export const EDITOR_ENTRY_MODULE_ID = "virtual:ignifx/editor-host-entry";

/**
 * The resolved id of {@link EDITOR_ENTRY_MODULE_ID}.
 *
 * @beta
 */
export const RESOLVED_EDITOR_ENTRY_MODULE_ID: string = `\0${EDITOR_ENTRY_MODULE_ID}`;

/**
 * The function `virtual:ignifx/editor` exports. It takes the game's app and returns a function that
 * detaches the controls; in a production build it does nothing.
 *
 * @beta
 */
export const EDITOR_PLAY_CONTROLS_EXPORT = "attachEditorPlayControls";

/**
 * The module the scene view imports the project's extensions from, unless the plugin is told
 * otherwise. It exports `extensions()`, which returns the list `main.ts` passes to `createApp`.
 *
 * @beta
 */
export const DEFAULT_EXTENSIONS_MODULE = "/src/extensions.ts";

/**
 * The `id` of the scene view's canvas.
 *
 * @beta
 */
export const EDITOR_CANVAS_ID = "ignifx-editor-view";

/** The package the generated modules import the host from, resolved from the project's root. */
const HOST_PACKAGE = "@ignifx/editor-host";

/**
 * Options accepted by {@link editorEntryModuleSource}.
 *
 * @beta
 */
export interface EditorEntryModuleOptions {
  /** The origin the editor is served from. */
  readonly editorOrigin: string;
  /** The root-absolute path of the project's extensions module, or `null` when it has none. */
  readonly extensionsModule: string | null;
  /** A scene address to load before the app starts, or `null`. */
  readonly bootScene: string | null;
  /** The project's `@ignifx/core` version, or `null` when it could not be read. */
  readonly engineVersion: string | null;
  /** Milliseconds between heartbeats, or `null` for the host's default. */
  readonly heartbeatIntervalMs: number | null;
}

/**
 * Options accepted by {@link playControlsModuleSource}.
 *
 * @beta
 */
export interface PlayControlsModuleOptions {
  /** The origin the editor is served from. */
  readonly editorOrigin: string;
  /** The project's `@ignifx/core` version, or `null` when it could not be read. */
  readonly engineVersion: string | null;
  /** Milliseconds between heartbeats, or `null` for the host's default. */
  readonly heartbeatIntervalMs: number | null;
  /**
   * Emit the development module. `false` emits the production no-op, which imports nothing and has
   * no `import.meta.hot` reference.
   */
  readonly hot: boolean;
}

/**
 * Turns the `extensions` option into the root-absolute path the generated module imports.
 *
 * @param path - The path as configured, relative to the Vite root or already root-absolute.
 * @returns The root-absolute path, for example `"/src/extensions.ts"`.
 * @throws EditorHostPluginError `IGX-1803` when the path is empty or leaves the root with `..`.
 *
 * @beta
 */
export function normalizeExtensionsModule(path: string): string {
  const trimmed = path.startsWith("./") ? path.slice(2) : path;
  if (trimmed === "" || trimmed === "/" || trimmed.split("/").some((segment) => segment === "..")) {
    throw new EditorHostPluginError(
      EditorHostErrorCode.invalidOption,
      `The "extensions" option must name a module inside the Vite root, for example "src/extensions.ts"; got "${path}".`,
    );
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * The fields shared by both generated calls, as source text.
 *
 * @param engineVersion - The version to report, or `null`.
 * @param heartbeatIntervalMs - The heartbeat period, or `null`.
 * @returns Zero, one, or two `key: value,` lines.
 */
function reportingLines(engineVersion: string | null, heartbeatIntervalMs: number | null): readonly string[] {
  return [
    ...(engineVersion === null ? [] : [`  engineVersion: ${JSON.stringify(engineVersion)},`]),
    ...(heartbeatIntervalMs === null ? [] : [`  heartbeatIntervalMs: ${JSON.stringify(heartbeatIntervalMs)},`]),
  ];
}

/**
 * Generates the module the scene view's page runs.
 *
 * @remarks
 * The module is the only code with an import-time effect: it creates the host. The package itself
 * creates nothing when imported (`CONSTITUTION.md` §3.5). Every import is resolved from the
 * project's root, so the host, the scripts, and the extensions share the project's one copy of
 * `@ignifx/core`.
 *
 * @param options - The editor origin, the project's extensions module, and the reporting options.
 * @returns The ES module source.
 *
 * @beta
 */
export function editorEntryModuleSource(options: EditorEntryModuleOptions): string {
  const { extensionsModule } = options;
  return [
    `import { startEditorHost } from ${JSON.stringify(HOST_PACKAGE)};`,
    `import { manifest } from ${JSON.stringify(MANIFEST_MODULE_ID)};`,
    `import { acceptHotReload, scripts } from ${JSON.stringify(SCRIPTS_MODULE_ID)};`,
    ...(extensionsModule === null ? [] : [`import { extensions } from ${JSON.stringify(extensionsModule)};`]),
    "",
    "const host = await startEditorHost({",
    `  editorOrigin: ${JSON.stringify(options.editorOrigin)},`,
    '  hostKind: "scene",',
    `  canvas: document.getElementById(${JSON.stringify(EDITOR_CANVAS_ID)}),`,
    `  settings: ${IGNIFX_CONFIG_DEFINE_KEY},`,
    "  assets: { manifest },",
    `  extensions: ${extensionsModule === null ? "[]" : "extensions()"},`,
    "  scripts,",
    `  bootScene: ${JSON.stringify(options.bootScene)},`,
    ...reportingLines(options.engineVersion, options.heartbeatIntervalMs),
    "});",
    "acceptHotReload(host.app);",
    "",
  ].join("\n");
}

/**
 * Generates the scene view's HTML page, before Vite's own `transformIndexHtml` adds its client.
 *
 * @returns The HTML document.
 *
 * @beta
 */
export function editorPageHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>ignifx editor host</title>",
    "    <style>",
    "      html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }",
    `      #${EDITOR_CANVAS_ID} { display: block; width: 100%; height: 100%; }`,
    "    </style>",
    "  </head>",
    "  <body>",
    `    <canvas id="${EDITOR_CANVAS_ID}"></canvas>`,
    `    <script type="module" src="/@id/${EDITOR_ENTRY_MODULE_ID}"></script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Generates `virtual:ignifx/editor`.
 *
 * @remarks
 * In development, `attachEditorPlayControls(app)` starts the play controls and stops them again
 * when Vite replaces the module. The `import.meta.hot` calls are written out literally because Vite
 * finds them by reading the source, not by running it. In a production build the export is an empty
 * function, the same shape as `acceptHotReload` from `virtual:ignifx/scripts`, so the game's
 * `main.ts` builds either way and ships no editor code.
 *
 * @param options - The editor origin, the reporting options, and whether to emit the development module.
 * @returns The ES module source.
 *
 * @beta
 */
export function playControlsModuleSource(options: PlayControlsModuleOptions): string {
  if (!options.hot) {
    return [`export function ${EDITOR_PLAY_CONTROLS_EXPORT}() {`, "  return () => {};", "}", ""].join("\n");
  }
  return [
    `import { startEditorPlayControls } from ${JSON.stringify(HOST_PACKAGE)};`,
    "",
    "const options = {",
    `  editorOrigin: ${JSON.stringify(options.editorOrigin)},`,
    ...reportingLines(options.engineVersion, options.heartbeatIntervalMs),
    "};",
    "",
    `export function ${EDITOR_PLAY_CONTROLS_EXPORT}(app) {`,
    "  const controls = startEditorPlayControls(app, options);",
    "  if (import.meta.hot) {",
    "    import.meta.hot.dispose(() => {",
    "      controls.dispose();",
    "    });",
    "  }",
    "  return () => {",
    "    controls.dispose();",
    "  };",
    "}",
    "",
  ].join("\n");
}

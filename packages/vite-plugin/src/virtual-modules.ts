/**
 * The virtual modules and the HMR channel the plugin publishes
 * (`docs/architecture/05-assets-and-loading.md` §2/§7, `15-devtools-and-diagnostics.md` §5).
 *
 * Both modules are generated rather than written to disk: the manifest is different in development
 * and in a build, and the script registry is a projection of a glob that changes as files are added.
 */

import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import type { AssetManifest } from "./manifest.js";

/**
 * The module a game imports to read the asset manifest without fetching it.
 *
 * @example
 * ```ts
 * import { manifest } from "virtual:ignifx/manifest";
 * ```
 *
 * @public
 */
export const MANIFEST_MODULE_ID = "virtual:ignifx/manifest";

/**
 * The module a game imports to get every script and component class in its source tree
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * @example
 * ```ts
 * import { scripts } from "virtual:ignifx/scripts";
 * const app = await createApp({ canvas, components: scripts });
 * ```
 *
 * @public
 */
export const SCRIPTS_MODULE_ID = "virtual:ignifx/scripts";

/**
 * The HMR event the plugin sends when an asset under the asset root changes.
 *
 * @remarks
 * The assets service listens for it and reloads the affected handles, firing
 * `AssetHandle.onReplaced` (`docs/architecture/05-assets-and-loading.md` §7). The *policy* of a
 * script hot reload — patch or recreate — is Phase 10's; this package only ships the channel.
 *
 * @example
 * ```ts
 * import.meta.hot?.on("ignifx:asset-changed", (payload) => {
 *   console.log(payload.address, payload.kind);
 * });
 * ```
 *
 * @public
 */
export const ASSET_CHANGED_EVENT = "ignifx:asset-changed";

/**
 * The payload of an {@link ASSET_CHANGED_EVENT} message.
 *
 * @public
 */
export interface AssetChangedPayload {
  /** The address of the asset, relative to the asset root. */
  readonly address: string;
  /** What happened to it on disk. */
  readonly kind: "added" | "changed" | "removed";
  /** The development URL the asset is served from; still meaningful for `"removed"`. */
  readonly url: string;
}

/**
 * The default glob the script registry is built from, relative to the Vite root.
 *
 * @public
 */
export const DEFAULT_SCRIPTS_PATTERN = "src/scripts/**/*.ts";

/**
 * The prefix Rollup and Vite use to mark a module id as owned by a plugin, which keeps it out of
 * the file-system resolution path and out of source maps.
 */
const VIRTUAL_PREFIX = "\0";

/**
 * The resolved id of {@link MANIFEST_MODULE_ID}.
 *
 * @public
 */
export const RESOLVED_MANIFEST_MODULE_ID: string = `${VIRTUAL_PREFIX}${MANIFEST_MODULE_ID}`;

/**
 * The resolved id of {@link SCRIPTS_MODULE_ID}.
 *
 * @public
 */
export const RESOLVED_SCRIPTS_MODULE_ID: string = `${VIRTUAL_PREFIX}${SCRIPTS_MODULE_ID}`;

/**
 * Maps a bare virtual specifier to its resolved id.
 *
 * @param id - The specifier as written in the importing module.
 * @returns The resolved id, or `null` when the specifier belongs to another plugin.
 *
 * @public
 */
export function resolveVirtualModuleId(id: string): string | null {
  if (id === MANIFEST_MODULE_ID) {
    return RESOLVED_MANIFEST_MODULE_ID;
  }
  return id === SCRIPTS_MODULE_ID ? RESOLVED_SCRIPTS_MODULE_ID : null;
}

/**
 * Generates the source of `virtual:ignifx/manifest`.
 *
 * @param manifest - The manifest to embed.
 * @returns An ES module exporting the manifest as `manifest`.
 *
 * @public
 */
export function manifestModuleSource(manifest: AssetManifest): string {
  return `export const manifest = ${JSON.stringify(manifest, null, 2)};\n`;
}

/**
 * Turns a scripts glob into the root-relative form `import.meta.glob` needs.
 *
 * @remarks
 * `import.meta.glob` resolves a relative pattern against the importing file, and a virtual module
 * has no directory to be relative to, so the pattern is rewritten to start at the Vite root. Vite
 * documents a leading `/` as exactly that.
 *
 * @param pattern - The pattern as configured, relative to the Vite root or already root-absolute.
 * @returns The root-absolute pattern.
 * @throws A {@link VitePluginError} with code `IGX-0555` when the pattern is empty or escapes the
 * root with `..`.
 *
 * @example
 * ```ts
 * normalizeScriptsPattern("src/scripts/player.ts"); // "/src/scripts/player.ts"
 * ```
 *
 * @public
 */
export function normalizeScriptsPattern(pattern: string): string {
  const trimmed = pattern.startsWith("./") ? pattern.slice(2) : pattern;
  if (trimmed === "" || trimmed === "/") {
    throw new VitePluginError(
      VitePluginErrorCode.invalidOption,
      'The "scripts" option must be a glob relative to the Vite root, for example "src/scripts/**/*.ts".',
    );
  }
  if (trimmed.split("/").some((segment) => segment === "..")) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidOption,
      `The "scripts" option must stay inside the Vite root; "${pattern}" does not.`,
    );
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * The function `virtual:ignifx/scripts` exports for wiring an app to script hot reload
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * @remarks
 * The generated module cannot know which app — or how many apps — a page built, and a module-level
 * app reference is exactly what `CONSTITUTION.md` §3.5/§3.6 forbid. So the hand-off is explicit and
 * one line of game code: the game passes its app in, and the module calls `app.hotReload.apply`
 * whenever Vite replaces a script module. The export exists in a production build too, with an
 * empty body, so the same source builds either way.
 *
 * @example
 * ```ts
 * import { acceptHotReload, scripts } from "virtual:ignifx/scripts";
 *
 * const app = await createApp({ canvas });
 * app.registerComponents(scripts);
 * acceptHotReload(app);
 * ```
 *
 * @public
 */
export const SCRIPTS_HOT_RELOAD_EXPORT = "acceptHotReload";

/**
 * Options accepted by {@link scriptsModuleSource}.
 *
 * @public
 */
export interface ScriptsModuleOptions {
  /**
   * Emit the HMR client. `false` — the default, and what a build uses — leaves the module with no
   * `import.meta.hot` reference at all, so none of the client reaches production
   * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
   */
  readonly hot?: boolean;
}

/**
 * Generates the source of `virtual:ignifx/scripts`.
 *
 * @remarks
 * The registry keeps every exported class that declares a `typeId`, which is what makes a class a
 * registrable component (`docs/architecture/03-scripting-and-components.md`). Plain helper exports
 * from the same files are ignored, and the module keys are sorted so that the registration order is
 * the same on every machine. Because the imports are real static imports produced by
 * `import.meta.glob`'s eager form, Vite's HMR graph sees each script file and can push updates for
 * it.
 *
 * **The HMR half.** Script hot reload needs no channel of its own: unlike an asset, a script module
 * already sits in Vite's module graph, so the generated module self-accepts and Vite hands it the
 * replacement namespace. The handler diffs the old and new registries by `typeId` for the log line
 * and hands the whole new registry to `app.hotReload.apply`, which is the half that decides what a
 * change means — patch or recreate — and skips the classes that did not change. The set of
 * subscribed apps lives in `import.meta.hot.data`, which Vite carries from one instance of a module
 * to the next, so the module that handles the *second* update still knows about them.
 *
 * @param pattern - The root-absolute glob, from {@link normalizeScriptsPattern}.
 * @param options - Whether to emit the development-only HMR client.
 * @returns An ES module exporting the registry as `scripts` and the wiring as `acceptHotReload`.
 *
 * @public
 */
export function scriptsModuleSource(pattern: string, options?: ScriptsModuleOptions): string {
  return [
    `const modules = import.meta.glob(${JSON.stringify(pattern)}, { eager: true });`,
    "const registry = [];",
    "for (const key of Object.keys(modules).sort()) {",
    "  const module = modules[key];",
    "  for (const name of Object.keys(module)) {",
    "    const exported = module[name];",
    '    if (typeof exported === "function" && typeof exported.typeId === "string") {',
    "      registry.push(exported);",
    "    }",
    "  }",
    "}",
    "export const scripts = registry;",
    ...(options?.hot === true ? hotClientLines() : buildStubLines()),
    "",
  ].join("\n");
}

/**
 * The development-only HMR client, emitted only when `vite dev` is serving the module.
 *
 * @returns The lines of the client, in emission order.
 */
function hotClientLines(): readonly string[] {
  return [
    "const hot = import.meta.hot;",
    "const state = hot ? (hot.data.ignifxHotReload ??= { apps: new Set() }) : null;",
    "export function acceptHotReload(app) {",
    "  if (state === null) {",
    "    return () => {};",
    "  }",
    "  state.apps.add(app);",
    "  return () => {",
    "    state.apps.delete(app);",
    "  };",
    "}",
    "if (hot) {",
    "  hot.accept((next) => {",
    "    if (!next) {",
    "      return;",
    "    }",
    "    const before = new Set(scripts.map((type) => type.typeId));",
    "    const added = [];",
    "    for (const type of next.scripts) {",
    "      if (!before.delete(type.typeId)) {",
    "        added.push(type.typeId);",
    "      }",
    "    }",
    "    const removed = [...before];",
    "    for (const app of state.apps) {",
    "      const report = app.hotReload.apply([{ types: next.scripts }]);",
    '      console.info("[ignifx] script hot reload", {',
    "        kind: report.kind,",
    "        changed: report.typeIds,",
    "        added,",
    "        removed,",
    "        instances: report.instances,",
    "      });",
    "    }",
    "  });",
    "}",
  ];
}

/**
 * The production stand-in: the same export, an empty body, and no `import.meta.hot` reference.
 *
 * @returns The lines of the stub.
 */
function buildStubLines(): readonly string[] {
  return ["export function acceptHotReload() {", "  return () => {};", "}"];
}

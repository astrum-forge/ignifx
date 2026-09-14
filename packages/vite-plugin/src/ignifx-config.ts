/**
 * Resolving `ignifx.config.ts` and injecting it as `import.meta.env.IGNIFX_CONFIG`
 * (`docs/architecture/04-extensions.md` §5).
 *
 * The project config is a plain object exported by default from a TypeScript file at the Vite root.
 * The plugin loads it with Vite's own config loader, freezes it into JSON, and hands it to the
 * bundler as a `define` replacement, so the running game reads its settings without a fetch and
 * without a second module graph.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfigFromFile } from "vite";
import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import { isJsonObject, parseJsonValue } from "./json.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { ConfigEnv } from "vite";

/**
 * The `define` key the resolved project config is injected under
 * (`docs/architecture/04-extensions.md` §5).
 *
 * @public
 */
export const IGNIFX_CONFIG_DEFINE_KEY = "import.meta.env.IGNIFX_CONFIG";

/**
 * The file names auto-detected at the Vite root, in the order they are tried.
 *
 * @public
 */
export const IGNIFX_CONFIG_FILE_NAMES = [
  "ignifx.config.ts",
  "ignifx.config.mts",
  "ignifx.config.js",
  "ignifx.config.mjs",
] as const;

/**
 * Type a project config while preserving inferred literal types.
 * Also available as `defineConfig` from `ignifx/config`.
 *
 * @typeParam T - The shape of the project config, inferred from the argument.
 * @param config - The project config object.
 * @returns The same object, unchanged.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * import { defineConfig } from "@ignifx/vite-plugin";
 *
 * export default defineConfig({
 *   layers: ["Default", "Ground", "Player"],
 *   time: { fixedDeltaTime: 1 / 60 },
 *   assets: { root: "./assets", preload: ["boot"] },
 * });
 * ```
 *
 * @public
 */
export function defineConfig<T>(config: T): T {
  return config;
}

/**
 * The outcome of resolving the project config.
 *
 * @public
 */
export interface ResolvedIgnifxConfig {
  /** The absolute path of the file that was loaded, or `null` when no config exists. */
  readonly path: string | null;
  /** The config object, always JSON-safe; `{}` when no config exists. */
  readonly config: JsonObject;
  /** Files the loader read, so the dev server can watch them for a full reload. */
  readonly dependencies: readonly string[];
}

/**
 * Finds the project config file at a Vite root.
 *
 * @param root - The absolute Vite root directory.
 * @returns The absolute path of the first name in {@link IGNIFX_CONFIG_FILE_NAMES} that exists, or
 * `null` when the project has no config file.
 *
 * @public
 */
export async function findIgnifxConfigFile(root: string): Promise<string | null> {
  const candidates = IGNIFX_CONFIG_FILE_NAMES.map((name) => join(root, name));
  const exists = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return (await stat(candidate)).isFile();
      } catch {
        return false;
      }
    }),
  );
  // The names are probed together but resolved in declaration order, so the documented preference
  // holds however the file system answers.
  return candidates.find((_candidate, index) => exists[index] === true) ?? null;
}

/**
 * Converts a loaded module's default export into JSON, which is what `define` can inject.
 *
 * @param value - The default export of the config file.
 * @param path - The file it came from, for the error message.
 * @returns The value as a JSON object.
 * @throws A {@link VitePluginError} with code `IGX-0554` when the export is not a JSON-serializable
 * object.
 */
function toJsonObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidProjectConfig,
      `"${path}" must export an object by default, for example \`export default defineConfig({ … })\`.`,
    );
  }
  let json: JsonValue;
  try {
    json = parseJsonValue(JSON.stringify(value));
  } catch (error) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidProjectConfig,
      `"${path}" exports a value that cannot be serialized to JSON; project settings must be plain data.`,
      { cause: error },
    );
  }
  if (!isJsonObject(json)) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidProjectConfig,
      `"${path}" must export a JSON object by default; got ${JSON.stringify(json)}.`,
    );
  }
  return json;
}

/**
 * Loads `ignifx.config.ts` through Vite's own config loader.
 *
 * @remarks
 * Vite's `loadConfigFromFile` is used rather than a bare dynamic import because the config is
 * TypeScript: the loader bundles it with the same pipeline that loads `vite.config.ts`, so the game
 * needs no separate build step and the file may import helpers from its own source tree. The loader
 * types its result as a Vite `UserConfig`; it is in fact whatever the module exports by default,
 * which is the boundary assertion below (coding standards §5.2).
 *
 * @param configFile - Absolute path of the config file, or `null` to resolve to an empty config.
 * @param root - The absolute Vite root, used as the loader's config root.
 * @param env - The Vite command and mode the config is being loaded for.
 * @returns The resolved config, its path, and the files the loader depended on.
 * @throws A {@link VitePluginError} with code `IGX-0554` when the file cannot be loaded or does not
 * export a JSON object by default.
 *
 * @example
 * ```ts
 * const resolved = await loadIgnifxConfig("/project/ignifx.config.ts", "/project", {
 *   command: "build",
 *   mode: "production",
 * });
 * resolved.config; // { layers: [...], time: {...} }
 * ```
 *
 * @public
 */
export async function loadIgnifxConfig(
  configFile: string | null,
  root: string,
  env: ConfigEnv,
): Promise<ResolvedIgnifxConfig> {
  if (configFile === null) {
    return { path: null, config: {}, dependencies: [] };
  }

  let loaded: Awaited<ReturnType<typeof loadConfigFromFile>>;
  try {
    loaded = await loadConfigFromFile(env, configFile, root, "silent");
  } catch (error) {
    throw new VitePluginError(VitePluginErrorCode.invalidProjectConfig, `"${configFile}" could not be loaded.`, {
      cause: error,
    });
  }
  if (loaded === null) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidProjectConfig,
      `"${configFile}" could not be loaded; Vite's config loader returned nothing.`,
    );
  }

  // The loader is typed for Vite configs but returns the module's default export verbatim; an
  // ignifx project config is a plain settings object, so it is re-checked as JSON below.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
  const exported = loaded.config as unknown;
  return {
    path: loaded.path,
    config: toJsonObject(exported, loaded.path),
    dependencies: loaded.dependencies,
  };
}

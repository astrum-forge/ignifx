/**
 * Resolving the project settings and injecting them as `import.meta.env.IGNIFX_CONFIG`
 * (`docs/architecture/04-extensions.md` §5).
 *
 * Project settings come in two forms at the Vite root: data in `ignifx.settings.json`, which a tool
 * such as the ignifx editor writes, and code in `ignifx.config.ts`, a plain object exported by
 * default. The plugin loads the code form with Vite's own config loader, reads the data form as
 * JSON, merges them section by section with the code form winning, and hands the result to the
 * bundler as a `define` replacement, so the running game reads its settings without a fetch and
 * without a second module graph.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfigFromFile } from "vite";
import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import { validateJsonValue } from "./json-schema.js";
import { isJsonArray, isJsonObject, jsonProperty, parseJsonValue } from "./json.js";
import type { JsonSchemaObject } from "./json-schema.js";
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
 * The project settings data file auto-detected at the Vite root: the JSON form of what
 * `ignifx.config.ts` exports, one property per settings section.
 *
 * @public
 */
export const IGNIFX_SETTINGS_FILE_NAME = "ignifx.settings.json";

/**
 * Type a project config while preserving inferred literal types.
 * Also available as `defineConfig` from `ignifx/config`.
 *
 * @remarks
 * The argument may be any JSON object, including the parsed content of `ignifx.settings.json`
 * imported by the config file. A project that keeps its settings only as data needs no config file
 * at all: the plugin reads `ignifx.settings.json` itself ({@link loadIgnifxSettings}).
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
 * @example
 * ```ts
 * // ignifx.config.ts, keeping the data in ignifx.settings.json and adding one section in code
 * import { defineConfig } from "@ignifx/vite-plugin";
 * import settings from "./ignifx.settings.json";
 *
 * export default defineConfig({ ...settings, time: { fixedDeltaTime: 1 / 120 } });
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

/**
 * The outcome of reading the project settings data file.
 *
 * @public
 */
export interface ResolvedIgnifxSettings {
  /** The absolute path of the file that was read, or `null` when there is none. */
  readonly path: string | null;
  /** The settings object; `{}` when there is no file. */
  readonly settings: JsonObject;
}

/**
 * Finds `ignifx.settings.json` at a Vite root.
 *
 * @param root - The absolute Vite root directory.
 * @returns The file's absolute path, or `null` when the project has no settings data file.
 *
 * @public
 */
export async function findIgnifxSettingsFile(root: string): Promise<string | null> {
  const candidate = join(root, IGNIFX_SETTINGS_FILE_NAME);
  try {
    return (await stat(candidate)).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Reads `ignifx.settings.json`, the data form of the project settings.
 *
 * @param settingsFile - Absolute path of the file, or `null` to resolve to no settings.
 * @returns The settings object and the path it came from.
 * @throws A {@link VitePluginError} with code `IGX-0554` when the file cannot be read, is not JSON,
 * or does not hold a JSON object.
 *
 * @example
 * ```ts
 * const resolved = await loadIgnifxSettings("/project/ignifx.settings.json");
 * resolved.settings; // { layers: ["Default", "Player"], time: { fixedDeltaTime: 0.016667 } }
 * ```
 *
 * @public
 */
export async function loadIgnifxSettings(settingsFile: string | null): Promise<ResolvedIgnifxSettings> {
  if (settingsFile === null) {
    return { path: null, settings: {} };
  }
  let text: string;
  try {
    text = await readFile(settingsFile, "utf8");
  } catch (error) {
    throw new VitePluginError(VitePluginErrorCode.invalidProjectConfig, `"${settingsFile}" could not be read.`, {
      cause: error,
    });
  }
  let json: JsonValue;
  try {
    json = parseJsonValue(text);
  } catch (error) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidProjectConfig,
      `"${settingsFile}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!isJsonObject(json)) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidProjectConfig,
      `"${settingsFile}" must hold a JSON object with one property per settings section.`,
    );
  }
  return { path: settingsFile, settings: json };
}

/**
 * The project settings after both forms are merged.
 *
 * @public
 */
export interface MergedProjectSettings {
  /** The settings `createApp` receives, one property per section. */
  readonly config: JsonObject;
  /**
   * The sections both forms define with different values, which the code form decided; a tool that
   * edits the data form shows these as overridden by `ignifx.config.ts`. A section both define
   * identically, as when the config file spreads the JSON, is not listed.
   */
  readonly shadowed: readonly string[];
}

/**
 * Merges the data form of the project settings (`ignifx.settings.json`) with the code form
 * (`ignifx.config.ts`).
 *
 * @remarks
 * The rule is one line: **the config file wins, a whole section at a time.** A section only one form
 * defines is taken from that form; a section both define is taken from `ignifx.config.ts` entirely,
 * with nothing of the JSON section merged into it. Within a section, values the project omits take
 * the defaults the owning extension registered, as always.
 *
 * @param data - The parsed `ignifx.settings.json`.
 * @param code - The default export of `ignifx.config.ts`.
 * @returns The merged settings and the sections the config file shadowed.
 *
 * @example
 * ```ts
 * mergeProjectSettings({ layers: ["Default"], time: { timeScale: 2 } }, { time: { timeScale: 1 } });
 * // { config: { layers: ["Default"], time: { timeScale: 1 } }, shadowed: ["time"] }
 * ```
 *
 * @public
 */
export function mergeProjectSettings(data: JsonObject, code: JsonObject): MergedProjectSettings {
  const shadowed = Object.keys(code).filter((section) => {
    const fromData = jsonProperty(data, section);
    return fromData !== undefined && !jsonEqualAt(fromData, jsonProperty(code, section));
  });
  return { config: { ...data, ...code }, shadowed };
}

/**
 * Compares two JSON values structurally, ignoring object key order.
 *
 * @param a - One value.
 * @param b - The other.
 * @returns `true` when both hold the same data.
 */
function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (isJsonArray(a)) {
    return isJsonArray(b) && a.length === b.length && a.every((item, index) => jsonEqualAt(item, b[index]));
  }
  if (isJsonObject(a)) {
    if (!isJsonObject(b)) {
      return false;
    }
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => jsonEqualAt(jsonProperty(a, key), jsonProperty(b, key)))
    );
  }
  return a === b;
}

/**
 * {@link jsonEqual} for values read out of a container, which may be missing.
 *
 * @param a - One value, or `undefined` when absent.
 * @param b - The other, or `undefined` when absent.
 * @returns `true` when both are present and hold the same data.
 */
function jsonEqualAt(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return a !== undefined && b !== undefined && jsonEqual(a, b);
}

/**
 * Validates the merged project settings against the JSON Schema `@ignifx/core`'s
 * `settingsJsonSchema(app)` generates.
 *
 * @remarks
 * A section the schema does not list is returned rather than refused: the schema is a snapshot of
 * one app's extensions, and `createApp` itself only reports an unknown section (`IGX-0407`), so the
 * plugin warns about it instead of stopping the dev server.
 *
 * @param config - The merged settings.
 * @param schema - The settings schema.
 * @param sources - The files the settings came from, named in the error.
 * @returns The sections the schema does not list, in the settings' order.
 * @throws A {@link VitePluginError} with code `IGX-0554` listing every violation, each addressed by
 * a JSON pointer such as `/time/fixedDeltaTim`, when the settings do not validate.
 *
 * @internal
 */
export function validateProjectSettings(
  config: JsonObject,
  schema: JsonSchemaObject,
  sources: readonly string[],
): readonly string[] {
  const properties = jsonProperty(schema, "properties");
  const known = properties !== undefined && isJsonObject(properties) ? properties : {};
  const unknown = Object.keys(config).filter((section) => !Object.hasOwn(known, section));
  const violations = validateJsonValue(config, schema);
  if (violations.length === 0) {
    return unknown;
  }
  const detail = violations.map((entry) => `${entry.pointer === "" ? "/" : entry.pointer}: ${entry.message}`);
  const from = sources.length === 0 ? "The project settings" : `The project settings in ${sources.join(" and ")}`;
  throw new VitePluginError(
    VitePluginErrorCode.invalidProjectConfig,
    `${from} do not match the registered settings sections: ${detail.join("; ")}.`,
  );
}

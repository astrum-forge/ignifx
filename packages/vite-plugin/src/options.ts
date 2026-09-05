/**
 * The plugin's options and their documented defaults.
 *
 * Resolution is a pure function so that the defaults can be tested — and read — without starting a
 * Vite build, and so that a bad option fails at plugin construction rather than half-way through
 * `generateBundle`.
 */

import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import { DEFAULT_HASH_LENGTH } from "./manifest.js";
import { DEFAULT_SCRIPTS_PATTERN, normalizeScriptsPattern } from "./virtual-modules.js";
import type { JsonSchemaProvider } from "./validate.js";

/**
 * The asset root, relative to the Vite root, when the option is not given.
 *
 * @public
 */
export const DEFAULT_ASSET_ROOT = "assets";

/**
 * The directory inside `build.outDir` that assets are copied into, when the option is not given.
 *
 * @public
 */
export const DEFAULT_PUBLIC_PATH = "assets/";

/**
 * The manifest's file name inside `build.outDir`, when the option is not given.
 *
 * @public
 */
export const DEFAULT_MANIFEST_FILE_NAME = "assets.manifest.json";

/** The narrowest and widest useful truncated-hash lengths. */
const HASH_LENGTH_RANGE = { minimum: 4, maximum: 64 } as const;

/**
 * Options for {@link ignifx}.
 *
 * @public
 */
export interface IgnifxPluginOptions {
  /**
   * The directory scanned for assets, relative to the Vite root (or absolute).
   *
   * @defaultValue `"assets"`
   */
  readonly assetRoot?: string;
  /**
   * The directory inside `build.outDir` that hashed assets are written to, and the URL prefix they
   * are served under in a build. A trailing `/` is added when missing.
   *
   * @defaultValue `"assets/"`
   */
  readonly publicPath?: string;
  /**
   * The manifest's file name inside `build.outDir`. It is also the path the dev server serves the
   * development manifest from.
   *
   * @defaultValue `"assets.manifest.json"`
   */
  readonly manifestFileName?: string;
  /**
   * Path to the project config injected as `import.meta.env.IGNIFX_CONFIG`
   * (`docs/architecture/04-extensions.md` §5). Pass `false` to inject `{}` and load nothing.
   *
   * @defaultValue auto-detected at the Vite root: `ignifx.config.ts`, `.mts`, `.js`, then `.mjs`.
   */
  readonly config?: string | false;
  /**
   * Whether format-headed JSON under the asset root is validated. A failure fails the build.
   *
   * @defaultValue `true`
   */
  readonly validate?: boolean;
  /**
   * JSON Schemas to validate against, keyed by file `format`. Without them only the
   * `format`/`formatVersion` header is checked.
   *
   * @defaultValue no schemas — header validation only.
   */
  readonly schemas?: JsonSchemaProvider;
  /**
   * How many hex characters of each asset's sha256 to keep, in the manifest and in hashed file
   * names. Must be between 4 and 64.
   *
   * @defaultValue `8`
   */
  readonly hashLength?: number;
  /**
   * The glob, relative to the Vite root, that `virtual:ignifx/scripts` collects component and
   * script classes from.
   *
   * @defaultValue {@link DEFAULT_SCRIPTS_PATTERN}
   */
  readonly scripts?: string;
}

/**
 * {@link IgnifxPluginOptions} with every default applied and every value normalized.
 *
 * @public
 */
export interface ResolvedIgnifxPluginOptions {
  /** The asset root exactly as configured; the plugin resolves it against the Vite root later. */
  readonly assetRoot: string;
  /** The public path, without a leading `/` and with a trailing `/`. */
  readonly publicPath: string;
  /** The manifest file name, without a leading `/`. */
  readonly manifestFileName: string;
  /** The configured config path, `null` to auto-detect, or `false` to inject `{}`. */
  readonly configFile: string | null | false;
  /** Whether validation runs. */
  readonly validate: boolean;
  /** The supplied schemas, or `null`. */
  readonly schemas: JsonSchemaProvider | null;
  /** The truncated hash length. */
  readonly hashLength: number;
  /** The scripts glob, rewritten to be root-absolute. */
  readonly scriptsPattern: string;
}

/**
 * Normalizes a path that is used as a URL segment and as an output directory.
 *
 * @param value - The configured value.
 * @param optionName - The option's name, for the error message.
 * @param trailingSlash - Whether the result must end in `/`.
 * @returns The normalized value.
 * @throws A {@link VitePluginError} with code `IGX-0555` when the value is empty, absolute, or
 * escapes the output directory.
 */
function normalizeOutputPath(value: string, optionName: string, trailingSlash: boolean): string {
  const withoutLeadingSlash = value.replaceAll("\\", "/").replace(/^\/+/u, "");
  if (withoutLeadingSlash === "" || withoutLeadingSlash.split("/").some((segment) => segment === "..")) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidOption,
      `The "${optionName}" option must be a non-empty path inside the output directory; got "${value}".`,
    );
  }
  if (!trailingSlash) {
    return withoutLeadingSlash;
  }
  return withoutLeadingSlash.endsWith("/") ? withoutLeadingSlash : `${withoutLeadingSlash}/`;
}

/**
 * Applies the documented defaults and rejects options outside their domain.
 *
 * @param options - The options as given to {@link ignifx}.
 * @returns The resolved options.
 * @throws A {@link VitePluginError} with code `IGX-0555` when an option is outside its domain.
 *
 * @example
 * ```ts
 * resolvePluginOptions({}).publicPath; // "assets/"
 * resolvePluginOptions({ publicPath: "/static" }).publicPath; // "static/"
 * ```
 *
 * @public
 */
export function resolvePluginOptions(options: IgnifxPluginOptions): ResolvedIgnifxPluginOptions {
  const hashLength = options.hashLength ?? DEFAULT_HASH_LENGTH;
  if (
    !Number.isInteger(hashLength) ||
    hashLength < HASH_LENGTH_RANGE.minimum ||
    hashLength > HASH_LENGTH_RANGE.maximum
  ) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidOption,
      `The "hashLength" option must be an integer between ${String(HASH_LENGTH_RANGE.minimum)} and ` +
        `${String(HASH_LENGTH_RANGE.maximum)}; got ${String(hashLength)}.`,
    );
  }

  const assetRoot = options.assetRoot ?? DEFAULT_ASSET_ROOT;
  if (assetRoot === "") {
    throw new VitePluginError(
      VitePluginErrorCode.invalidOption,
      'The "assetRoot" option must be a non-empty path relative to the Vite root, for example "assets".',
    );
  }

  return {
    assetRoot,
    publicPath: normalizeOutputPath(options.publicPath ?? DEFAULT_PUBLIC_PATH, "publicPath", true),
    manifestFileName: normalizeOutputPath(
      options.manifestFileName ?? DEFAULT_MANIFEST_FILE_NAME,
      "manifestFileName",
      false,
    ),
    configFile: options.config ?? null,
    validate: options.validate ?? true,
    schemas: options.schemas ?? null,
    hashLength,
    scriptsPattern: normalizeScriptsPattern(options.scripts ?? DEFAULT_SCRIPTS_PATTERN),
  };
}

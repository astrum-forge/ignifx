import { CoreErrorCode } from "../../errors/error-codes.js";
import { IgnifxError } from "../../errors/ignifx-error.js";
import { loadSceneEnvironment } from "../../lite/gpu/environment.js";
import {
  ENVIRONMENT_ASSET_TYPE,
  ENVIRONMENT_FILE_EXTENSION,
  ENVIRONMENT_FILE_EXTENSIONS,
  ENVIRONMENT_FILE_FORMAT,
  ENVIRONMENT_FORMAT_VERSION,
  EnvironmentAsset,
  environmentDefinition,
} from "../environment-asset.js";
import { DEFAULT_BRDF_LUT_ADDRESS, RENDERING_SETTINGS_SECTION } from "../rendering-settings.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";
import type { EnvironmentDefinition } from "../environment-asset.js";
import type { RenderingSettings } from "../rendering-settings.js";

/**
 * The `environment` asset loader: `.env`, `.hdr`, `.dds`, and the `.environment.json` description
 * file (`docs/architecture/05-assets-and-loading.md` §5,
 * `06-serialization-and-scene-format.md` §6).
 *
 * ## The skybox is decided here, once
 *
 * Lite builds the background inside `loadEnvironment` and hands back no handle on it, so this is
 * the only place that can decide whether there is one: `Environment.skybox` can report a
 * disagreement (`IGX-0711`) but cannot change it. `skyboxEnabled: false` skips the background;
 * otherwise the declaration's `skybox` image is used, and when it names none the environment draws
 * **its own** prefiltered cube map (see {@link toLoadOptions}).
 *
 * ## Two addresses, one asset type
 *
 * A bare `.env` address is the common case: load this IBL, take the BRDF table and the skybox from
 * the project settings. An `.environment.json` is the same thing with the skybox, the blur, and the
 * rotation pinned next to the IBL so several scenes can share one description. Both produce an
 * {@link EnvironmentAsset}, and the loader tells them apart by the address suffix — the longest
 * registered extension wins the match, so `.environment.json` never falls through to the generic
 * `json` loader.
 *
 * ## The BRDF lookup table
 *
 * `loadEnvironment` takes a **required** `brdfUrl` (`index.d.ts` 6779). The address comes from the
 * file, then from `rendering.brdfLut`, then from the built-in default; it is resolved to a URL
 * through `app.assets.resolveUrl`, so a content-hashed production build works with no special
 * casing. Lite fetches it itself — it decodes the table with `createImageBitmap`, the same reason
 * the texture loader hands over a URL rather than bytes.
 *
 * ## Headless
 *
 * The load uploads cube maps, so a headless app skips it and produces an asset with no textures.
 * The declaration is still parsed, so a headless test still covers the file format.
 */

/**
 * Builds the loader for `.env`, `.hdr`, `.dds`, and `.environment.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createEnvironmentLoader());
 * ```
 *
 * @public
 */
export function createEnvironmentLoader(): AssetLoader<EnvironmentAsset> {
  return {
    type: ENVIRONMENT_ASSET_TYPE,
    extensions: [...ENVIRONMENT_FILE_EXTENSIONS, ENVIRONMENT_FILE_EXTENSION],
    async load(ctx: LoaderContext): Promise<EnvironmentAsset> {
      const definition = ctx.address.endsWith(ENVIRONMENT_FILE_EXTENSION)
        ? readDescription(await ctx.fetchJson(), ctx.address)
        : environmentDefinition({ environment: ctx.address });
      const brdfUrl = ctx.app.assets.resolveUrl(resolveBrdfAddress(ctx, definition));
      // The option mapping is plain address arithmetic, so it runs either way; only the load is
      // device-only. Under the null engine the asset reports `gpu: null` (§5).
      const options = toLoadOptions(ctx, definition, brdfUrl);
      if (ctx.app.isHeadless) {
        return new EnvironmentAsset(ctx.address, definition, "", null);
      }
      const textures = await loadSceneEnvironment(ctx.app.lite.scene, options);
      return new EnvironmentAsset(ctx.address, definition, brdfUrl, textures);
    },
  };
}

/**
 * Reads an `.environment.json` over the defaults.
 *
 * @param parsed - The parsed JSON.
 * @param address - The address, for diagnostics.
 * @returns The declaration.
 * @throws IgnifxError with code `IGX-0709` when the header is missing, or `IGX-0603` when the
 * format version is not readable.
 */
function readDescription(parsed: unknown, address: string): EnvironmentDefinition {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw notAnEnvironment(address);
  }
  // The array and `null` cases are gone.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const file = parsed as Record<string, unknown>;
  if (file["format"] !== ENVIRONMENT_FILE_FORMAT) {
    throw notAnEnvironment(address);
  }
  const version = file["formatVersion"];
  if (version !== ENVIRONMENT_FORMAT_VERSION) {
    throw new IgnifxError(
      CoreErrorCode.unsupportedFormatVersion,
      `${address} declares format version ${String(version)}, which this build cannot read.`,
      {
        context: { file: address, version: String(version) },
        hint: `This build reads ${ENVIRONMENT_FILE_FORMAT} version ${String(ENVIRONMENT_FORMAT_VERSION)}.`,
      },
    );
  }
  return environmentDefinition({
    environment: readString(file, "environment", ""),
    brdfLut: readString(file, "brdfLut", ""),
    skybox: readString(file, "skybox", ""),
    skyboxSize: readNumber(file, "skyboxSize", 20),
    skyboxEnabled: readBoolean(file, "skyboxEnabled", true),
    blur: readNumber(file, "blur", 0),
    rotation: readNumber(file, "rotation", 0),
  });
}

/**
 * Builds the "not an environment file" failure.
 *
 * @param address - The address that failed.
 * @returns The error to throw.
 */
function notAnEnvironment(address: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidAssetFile, `${address} is not an ${ENVIRONMENT_FILE_FORMAT} file.`, {
    context: { file: address, format: ENVIRONMENT_FILE_FORMAT },
    hint: `An environment description carries { "format": "${ENVIRONMENT_FILE_FORMAT}", "formatVersion": ${String(ENVIRONMENT_FORMAT_VERSION)} }.`,
  });
}

/**
 * Works out which BRDF lookup table this environment uses: the file's, then the project's, then
 * the built-in default.
 *
 * @param ctx - The loader context, for the settings.
 * @param definition - The declaration.
 * @returns The address.
 */
function resolveBrdfAddress(ctx: LoaderContext, definition: EnvironmentDefinition): string {
  if (definition.brdfLut !== "") {
    return definition.brdfLut;
  }
  const settings = ctx.app.settings.section<RenderingSettings>(RENDERING_SETTINGS_SECTION);
  return settings.brdfLut === "" ? DEFAULT_BRDF_LUT_ADDRESS : settings.brdfLut;
}

/**
 * Turns a declaration into the shape `loadEnvironment` takes, resolving every address to a URL.
 *
 * @param ctx - The loader context, for `resolveUrl`.
 * @param definition - The declaration.
 * @param brdfUrl - The already-resolved BRDF table URL.
 * @returns The adapter's options.
 */
function toLoadOptions(
  ctx: LoaderContext,
  definition: EnvironmentDefinition,
  brdfUrl: string,
): {
  url: string;
  brdfUrl: string;
  skyboxUrl?: string;
  skyboxSize?: number;
  skipSkybox?: boolean;
  skipGround: boolean;
} {
  const options: {
    url: string;
    brdfUrl: string;
    skyboxUrl?: string;
    skyboxSize?: number;
    skipSkybox?: boolean;
    skipGround: boolean;
  } = {
    url: ctx.app.assets.resolveUrl(definition.environment === "" ? ctx.address : definition.environment),
    brdfUrl,
    // ignifx never wants Lite's reflective ground plane: a world's ground is an entity with a
    // `MeshRenderer`, and a second one nothing owns would be invisible to every ignifx query.
    skipGround: true,
  };
  if (!definition.skyboxEnabled) {
    options.skipSkybox = true;
  } else if (definition.skybox === "") {
    // Naming the environment as its own skybox source is what selects Lite's HDR cube skybox:
    // `loadEnvironment` treats `skyboxUrl === url` (or any `.env` suffix) as "reuse the specular
    // cube map I just uploaded", the way Babylon.js's `createDefaultSkybox` does, and otherwise
    // draws a flat box painted in `scene.clearColor` — a background indistinguishable from no
    // background at all (`lib/_chunks/env-helpers-*.js`, `skyboxIsEnv` and
    // `buildSolidSkyboxRenderable`). So an environment that says "draw a skybox" and names no image
    // draws itself.
    options.skyboxUrl = options.url;
    options.skyboxSize = definition.skyboxSize;
  } else {
    options.skyboxUrl = ctx.app.assets.resolveUrl(definition.skybox);
    options.skyboxSize = definition.skyboxSize;
  }
  return options;
}

/**
 * Reads a string property.
 *
 * @param file - The file body.
 * @param key - The property name.
 * @param fallback - What to use when it is absent or not a string.
 * @returns The value.
 */
function readString(file: Record<string, unknown>, key: string, fallback: string): string {
  const value = file[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads a number property.
 *
 * @param file - The file body.
 * @param key - The property name.
 * @param fallback - What to use when it is absent or not a finite number.
 * @returns The value.
 */
function readNumber(file: Record<string, unknown>, key: string, fallback: number): number {
  const value = file[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads a boolean property.
 *
 * @param file - The file body.
 * @param key - The property name.
 * @param fallback - What to use when it is absent or not a boolean.
 * @returns The value.
 */
function readBoolean(file: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = file[key];
  return typeof value === "boolean" ? value : fallback;
}

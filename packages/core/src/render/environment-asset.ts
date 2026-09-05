import type { LiteEnvironmentTextures } from "../lite/gpu/environment.js";

/**
 * `EnvironmentAsset` (`docs/architecture/05-assets-and-loading.md` §5,
 * `07-rendering.md` §2.5): the image-based lighting a scene is lit by, and the skybox that shows
 * behind it.
 *
 * ## Why an environment is loaded against a scene
 *
 * Lite's `loadEnvironment(scene, url, { brdfUrl, … })` (`index.d.ts` 6779) does not return a
 * detached texture set: it installs the prefiltered cube map, its spherical harmonics, and the
 * skybox **onto a scene** and hands back the GPU handles as a receipt. So an `EnvironmentAsset` is
 * unusual among assets — it is bound to the world it was loaded for, and a second world would have
 * to load it again. That is Lite's shape, not a choice; the asset records the addresses so the
 * `Environment` component can say what it installed, and holds the receipt for materials that need
 * the textures explicitly.
 *
 * ## The BRDF lookup table is mandatory
 *
 * `brdfUrl` is a **required** parameter: Lite decodes the split-sum lookup table from a pre-baked
 * RGBD PNG rather than computing it, for pixel-perfect parity with Babylon.js
 * (`lib/_chunks/env-helpers-*.js`). Nothing in `07-rendering.md` says where a game gets that file,
 * so ignifx puts the address in the `rendering.brdfLut` setting and lets an `Environment` override
 * it. The repository ships one at `tests/fixtures/assets/brdf-lut.png` (Apache-2.0, decoded from
 * Babylon.js's own `_environmentBRDFBase64Texture`).
 *
 * ## Headless
 *
 * The load uploads cube maps, so a headless app produces an asset with `lite.textures === null` and
 * an `Environment` that holds it applies only the parts that are plain scene state — fog, the clear
 * colour, the rotation — and skips the rest (`07-rendering.md` §6).
 */

/**
 * The asset type environments are registered under.
 *
 * @public
 */
export const ENVIRONMENT_ASSET_TYPE = "environment";

/**
 * The address suffixes that select the environment loader.
 *
 * @public
 */
export const ENVIRONMENT_FILE_EXTENSIONS: readonly string[] = Object.freeze([".env", ".hdr", ".dds"]);

/**
 * The `format` header an `.environment.json` carries
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * @public
 */
export const ENVIRONMENT_FILE_FORMAT = "ignifx.environment";

/**
 * The only `.environment.json` `formatVersion` this build reads.
 *
 * @public
 */
export const ENVIRONMENT_FORMAT_VERSION = 1;

/**
 * The address suffix that selects the environment *description* file.
 *
 * @public
 */
export const ENVIRONMENT_FILE_EXTENSION = ".environment.json";

/**
 * What an `.environment.json` declares, or what an `.env` address implies
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * @remarks
 * The description file exists so a project can pin the skybox and the BRDF table next to the IBL
 * rather than repeating them on every `Environment` component. Loading a bare `.env` address
 * produces the same shape with everything but `environment` left at its default.
 *
 * @public
 */
export interface EnvironmentDefinition {
  /** The `.env` file holding the prefiltered specular cube map and its spherical harmonics. */
  readonly environment: string;
  /** The RGBD BRDF lookup table, or empty to take `rendering.brdfLut`. */
  readonly brdfLut: string;
  /** A `.dds` or `.env` skybox, or empty for none. */
  readonly skybox: string;
  /** The skybox cube's size, in metres. Lite defaults to 20. */
  readonly skyboxSize: number;
  /** Whether a skybox is drawn at all. */
  readonly skyboxEnabled: boolean;
  /** How blurred the specular reflection is, 0 to 1. */
  readonly blur: number;
  /** Rotation around the world Y axis, in degrees. */
  readonly rotation: number;
}

/**
 * The Babylon Lite objects an {@link EnvironmentAsset} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface EnvironmentAssetLiteHandles {
  /** The GPU-resident cube map, BRDF table, samplers, and harmonics, or `null` under a headless app. */
  readonly textures: LiteEnvironmentTextures | null;
}

/**
 * A loaded image-based lighting environment (`docs/architecture/07-rendering.md` §2.5).
 *
 * @example
 * ```ts
 * const studio = await app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
 * world.createEntity("Env").addComponent(Environment, { environment: studio.retain() });
 * ```
 *
 * @public
 */
export class EnvironmentAsset {
  /** The type name the asset service registers environments under. */
  static assetType: string = ENVIRONMENT_ASSET_TYPE;

  /** The address the environment was loaded from. */
  readonly address: string;

  /** What the file declared, with the defaults filled in. */
  readonly definition: EnvironmentDefinition;

  /** The URL Lite fetched the BRDF lookup table from, or empty when the load was headless. */
  readonly brdfUrl: string;

  readonly #textures: LiteEnvironmentTextures | null;

  /**
   * Wraps a loaded environment. The `environment` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param definition - The resolved declaration.
   * @param brdfUrl - The URL the BRDF table was fetched from.
   * @param textures - The GPU handles, or `null` when the app is headless.
   *
   * @internal
   */
  constructor(
    address: string,
    definition: EnvironmentDefinition,
    brdfUrl: string,
    textures: LiteEnvironmentTextures | null,
  ) {
    this.address = address;
    this.definition = definition;
    this.brdfUrl = brdfUrl;
    this.#textures = textures;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch.
   *
   * @returns The GPU handles, or `null` under a headless app.
   */
  get lite(): EnvironmentAssetLiteHandles {
    return { textures: this.#textures };
  }
}

/**
 * Fills in an environment declaration's defaults.
 *
 * @param overrides - The properties the file or the caller set.
 * @returns A complete declaration.
 *
 * @example
 * ```ts
 * environmentDefinition({ environment: "environments/studio.env", skyboxEnabled: false });
 * ```
 *
 * @public
 */
export function environmentDefinition(overrides: Partial<EnvironmentDefinition> = {}): EnvironmentDefinition {
  return {
    environment: overrides.environment ?? "",
    brdfLut: overrides.brdfLut ?? "",
    skybox: overrides.skybox ?? "",
    skyboxSize: overrides.skyboxSize ?? 20,
    skyboxEnabled: overrides.skyboxEnabled ?? true,
    blur: overrides.blur ?? 0,
    rotation: overrides.rotation ?? 0,
  };
}

import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import {
  createDefaultMaterial,
  createPbrMaterialFromProps,
  createStandardMaterialFromProps,
  markMaterialDirty,
  MATERIAL_ALPHA_MODES,
  setMaterialAlpha,
  setPbrBaseColor,
  setPbrMetallicRoughness,
} from "../lite/material.js";
import { Color } from "../math/color.js";
import type { TextureAsset } from "./texture-asset.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { LiteTexture2D } from "../lite/gpu/texture.js";
import type { LiteMaterial, LitePbrMaterial, LiteStandardMaterial, MaterialAlphaMode } from "../lite/material.js";
import type { ColorLike } from "../math/types.js";

/**
 * `MaterialAsset` and the `ignifx.material` file format
 * (`docs/architecture/07-rendering.md` §2.6, `06-serialization-and-scene-format.md` §6).
 *
 * ## Decisions the documents left open
 *
 * - **The file is flat.** §2.6 lists the PBR properties directly, so a `.material.json` carries the
 *   format header, a `type` discriminator, and the properties of that type at the top level. There
 *   is no per-type sub-object to reach through.
 * - **Colours in the file are sRGB.** `06-serialization-and-scene-format.md` §3 is explicit that
 *   colours are sRGB in memory and in files and that the conversion to linear "belongs to the
 *   renderer". This module is that boundary: `baseColor`, `emissive`, `diffuse`, and `specular` are
 *   decoded here and handed to the adapter linear. Factors that are not colours — `metallic`,
 *   `roughness`, `alpha` — are unitless and pass through.
 * - **`"type": "shader"` is not implemented.** §2.6 lists it, and Lite's `createShaderMaterial`
 *   exists, but its declaration takes a WGSL attribute/uniform/sampler layout whose shape is Lite's
 *   own (`ShaderMaterialOptions`, `index.d.ts`); publishing that verbatim would put a Lite type in
 *   the public API, which `CONSTITUTION.md` §3.4 forbids, and mirroring it is a design job of its
 *   own that no delivered phase took on. A file that declares it is rejected with `IGX-0708`.
 * - **PBR extensions (`clearcoat`, `sheen`, `transmission`, …) are not implemented** for the same
 *   reason: each is a sub-record with its own textures, and §2.6 wants them opt-in so unused shader
 *   code is tree-shaken. The loader reports an unknown top-level key rather than silently dropping
 *   it.
 *
 * ## Headless
 *
 * `createPbrMaterial` and `createStandardMaterial` are pure data plus one build-group function
 * (ADR-0002 Validation), so a material loads **completely** under the null engine; only the textures
 * it references come back empty. That is what makes the material half of a scene testable in Node.
 */

/**
 * The asset type materials are registered under.
 *
 * @public
 */
export const MATERIAL_ASSET_TYPE = "material";

/**
 * The `format` header every `.material.json` carries.
 *
 * @public
 */
export const MATERIAL_FILE_FORMAT = "ignifx.material";

/**
 * The only `.material.json` `formatVersion` this build reads.
 *
 * @public
 */
export const MATERIAL_FORMAT_VERSION = 1;

/**
 * The address suffix that selects the material loader.
 *
 * @public
 */
export const MATERIAL_FILE_EXTENSION = ".material.json";

/**
 * The material families `.material.json` can declare
 * (`docs/architecture/07-rendering.md` §2.6).
 *
 * @public
 */
export const MATERIAL_KINDS = ["pbr", "standard", "shader"] as const;

/**
 * The union of the material families.
 *
 * @public
 */
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/**
 * How a material interprets its alpha channel, in glTF's vocabulary.
 *
 * @public
 */
export type MaterialAlphaModeName = MaterialAlphaMode;

/**
 * The alpha modes a material may declare, in the order the inspector lists them.
 *
 * @public
 */
export const MATERIAL_ALPHA_MODE_NAMES: readonly MaterialAlphaModeName[] = MATERIAL_ALPHA_MODES;

/**
 * The properties a `"pbr"` material declares. Every colour is sRGB; every factor is unitless.
 *
 * @public
 */
export interface PbrMaterialDefinition {
  /** The family discriminator. */
  readonly kind: "pbr";
  /** A human-readable name; glTF material overrides match on it. */
  readonly name: string;
  /** sRGB base colour and alpha, multiplied with the base colour texture. */
  readonly baseColor: ColorLike;
  /** Metallic factor, 0 to 1. */
  readonly metallic: number;
  /** Roughness factor, 0 to 1. */
  readonly roughness: number;
  /** Normal map strength. */
  readonly normalScale: number;
  /** sRGB emissive colour. */
  readonly emissive: ColorLike;
  /** How strongly ambient occlusion darkens the surface, 0 to 1. */
  readonly occlusionStrength: number;
  /** How the alpha channel is interpreted. */
  readonly alphaMode: MaterialAlphaModeName;
  /** The cutoff below which a `"mask"` material discards a fragment. */
  readonly alphaCutoff: number;
  /** Overall material alpha, 0 to 1. */
  readonly alpha: number;
  /** Whether back faces are drawn. */
  readonly doubleSided: boolean;
  /** Whether lighting is skipped entirely. */
  readonly unlit: boolean;
  /** How strongly the environment map contributes. */
  readonly environmentIntensity: number;
  /** The addresses of the textures the material samples, by slot; absent slots are unset. */
  readonly textures: Readonly<Record<string, string>>;
}

/**
 * The properties a `"standard"` material declares — the cheap non-PBR path
 * (`docs/architecture/07-rendering.md` §2.6).
 *
 * @public
 */
export interface StandardMaterialDefinition {
  /** The family discriminator. */
  readonly kind: "standard";
  /** A human-readable name. */
  readonly name: string;
  /** sRGB diffuse colour. */
  readonly diffuse: ColorLike;
  /** sRGB specular colour. */
  readonly specular: ColorLike;
  /** Specular exponent; higher values give a tighter highlight. */
  readonly specularPower: number;
  /** sRGB emissive colour. */
  readonly emissive: ColorLike;
  /** Overall material alpha, 0 to 1. */
  readonly alpha: number;
  /** The cutoff below which a fragment is discarded. `0` disables the alpha test. */
  readonly alphaCutoff: number;
  /** Whether back faces are drawn. */
  readonly doubleSided: boolean;
  /** Whether lighting is skipped entirely. */
  readonly unlit: boolean;
  /** The addresses of the textures the material samples, by slot. */
  readonly textures: Readonly<Record<string, string>>;
}

/**
 * The parsed body of a `.material.json`, discriminated by `kind`.
 *
 * @public
 */
export type MaterialDefinition = PbrMaterialDefinition | StandardMaterialDefinition;

/**
 * The texture slots a `"pbr"` material may name, in the order the loader resolves them.
 *
 * @public
 */
export const PBR_TEXTURE_SLOTS: readonly string[] = Object.freeze([
  "baseColorTexture",
  "metallicRoughnessTexture",
  "normalTexture",
  "emissiveTexture",
  "occlusionTexture",
]);

/**
 * The texture slots a `"standard"` material may name.
 *
 * @public
 */
export const STANDARD_TEXTURE_SLOTS: readonly string[] = Object.freeze([
  "diffuseTexture",
  "specularTexture",
  "emissiveTexture",
  "normalTexture",
  "opacityTexture",
]);

/**
 * The Babylon Lite objects a {@link MaterialAsset} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface MaterialAssetLiteHandles {
  /** The Lite material. Present in headless mode too: a material is plain data. */
  readonly material: LiteMaterial;
}

/**
 * A material a `MeshRenderer` or a `Model` draws with
 * (`docs/architecture/07-rendering.md` §2.6).
 *
 * @remarks
 * Materials are shared: many renderers reference one asset, and editing it changes all of them.
 * {@link MaterialAsset.clone} is the per-renderer variation escape hatch — it rebuilds the Lite
 * material from the same declaration, so the copy starts identical and drifts on its own.
 *
 * @example
 * ```ts
 * const gold = await app.assets.loadAsync<MaterialAsset>("materials/gold.material.json");
 * using warm = gold.value.clone(app);
 * warm.value.setBaseColor({ r: 1, g: 0.6, b: 0.2, a: 1 });
 * ```
 *
 * @public
 */
export class MaterialAsset {
  /** The type name the asset service registers materials under. */
  static assetType: string = MATERIAL_ASSET_TYPE;

  /** The declaration this material was built from; {@link MaterialAsset.clone} replays it. */
  readonly definition: MaterialDefinition;

  /** The texture handles the material samples, in slot order. It does not own them. */
  readonly textures: readonly AssetHandle<TextureAsset>[];

  readonly #material: LitePbrMaterial | LiteStandardMaterial;

  readonly #pbr: LitePbrMaterial | null;

  readonly #standard: LiteStandardMaterial;

  /**
   * Wraps a built Lite material. Use {@link createMaterialAsset}; the loader constructs these.
   *
   * @param definition - The declaration it was built from.
   * @param material - The Lite material.
   * @param textures - The texture handles the material samples.
   *
   * @internal
   */
  constructor(
    definition: MaterialDefinition,
    material: LitePbrMaterial | LiteStandardMaterial,
    textures: readonly AssetHandle<TextureAsset>[],
  ) {
    this.definition = definition;
    this.textures = textures;
    this.#material = material;
    // The two Lite material shapes are structurally distinct, and `definition.kind` is what the
    // factory branched on a moment ago, so the narrowing is a restatement rather than a guess
    // (coding standards §5.2).
    if (definition.kind === "pbr") {
      this.#pbr = material;
      this.#standard = createStandardMaterialFromProps({});
    } else {
      this.#pbr = null;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      this.#standard = material as LiteStandardMaterial;
    }
  }

  /**
   * The material's human-readable name.
   *
   * @returns The declared name.
   */
  get name(): string {
    return this.definition.name;
  }

  /**
   * The material family.
   *
   * @returns `"pbr"` or `"standard"`.
   */
  get kind(): MaterialKind {
    return this.definition.kind;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch.
   *
   * @returns The Lite material.
   */
  get lite(): MaterialAssetLiteHandles {
    return { material: this.#material };
  }

  /**
   * Replaces the base colour — the PBR `baseColorFactor`, or a Standard material's `diffuseColor`.
   *
   * @remarks
   * The colour is sRGB, like every colour in ignifx's public API; the linear value the shader reads
   * is derived here. The change marks the material's uniform block dirty, which is the cheap path:
   * no pipeline is recompiled (`src/lite/material.ts`).
   *
   * @param color - The new sRGB colour. Alpha is used by PBR and ignored by Standard, which carries
   * its own `alpha`.
   */
  setBaseColor(color: ColorLike): void {
    const linear = toLinear(color);
    const pbr = this.#pbr;
    if (pbr !== null) {
      setPbrBaseColor(pbr, linear.r, linear.g, linear.b, color.a);
      return;
    }
    const standard = this.#standard;
    const diffuse = standard.diffuseColor;
    diffuse[0] = linear.r;
    diffuse[1] = linear.g;
    diffuse[2] = linear.b;
    markMaterialDirty(standard);
  }

  /**
   * Replaces the metallic and roughness factors of a `"pbr"` material. A Standard material has
   * neither, so the call is ignored.
   *
   * @param metallic - The metallic factor, 0 to 1.
   * @param roughness - The roughness factor, 0 to 1.
   */
  setMetallicRoughness(metallic: number, roughness: number): void {
    const pbr = this.#pbr;
    if (pbr !== null) {
      setPbrMetallicRoughness(pbr, metallic, roughness);
    }
  }

  /**
   * Replaces the material's overall alpha.
   *
   * @param alpha - The new alpha, 0 to 1.
   */
  setAlpha(alpha: number): void {
    setMaterialAlpha(this.#material, alpha);
  }

  /**
   * Builds an independent copy of this material from the same declaration — the per-renderer
   * variation path of `docs/architecture/07-rendering.md` §2.6.
   *
   * @remarks
   * The copy shares the original's *textures* (they are addressed assets, and the handles are
   * retained by whoever loaded them) and nothing else: it is a second Lite material in the same
   * family, so it costs no extra shader compilation.
   *
   * @param app - The app whose asset service publishes the copy.
   * @returns The copy's handle, with one holder — the caller.
   */
  clone(app: App): AssetHandle<MaterialAsset> {
    return createMaterialAsset(app, this.definition, this.textures);
  }
}

/**
 * Builds a Lite material from a declaration and publishes it as an in-memory asset.
 *
 * @param app - The app whose asset service publishes it.
 * @param definition - The declaration.
 * @param textures - The texture handles the declaration's slots resolved to, in slot order.
 * @returns The handle, with one holder — the caller.
 *
 * @example
 * ```ts
 * using red = createMaterialAsset(app, pbrMaterialDefinition({ name: "red", baseColor: { r: 1, g: 0, b: 0, a: 1 } }), []);
 * ```
 *
 * @public
 */
export function createMaterialAsset(
  app: App,
  definition: MaterialDefinition,
  textures: readonly AssetHandle<TextureAsset>[],
): AssetHandle<MaterialAsset> {
  return app.assets.register(buildMaterialAsset(definition, textures), { type: MATERIAL_ASSET_TYPE });
}

/**
 * Builds the Lite material a declaration describes and wraps it, **without** publishing it.
 *
 * @remarks
 * This is what the `.material.json` loader returns: the asset service is already about to create
 * the handle for that address, so registering a second, in-memory one would double the entry. Code
 * that builds a material out of nowhere wants {@link createMaterialAsset} instead.
 *
 * @param definition - The declaration.
 * @param textures - The texture handles the declaration's slots resolved to, in slot order.
 * @returns The asset.
 *
 * @internal
 */
export function buildMaterialAsset(
  definition: MaterialDefinition,
  textures: readonly AssetHandle<TextureAsset>[],
): MaterialAsset {
  const bySlot = indexTextures(definition, textures);
  const material =
    definition.kind === "pbr" ? buildPbrMaterial(definition, bySlot) : buildStandardMaterial(definition, bySlot);
  return new MaterialAsset(definition, material, textures);
}

/**
 * The material a `MeshRenderer` draws with when it declares none: a neutral, fully rough
 * dielectric (`docs/architecture/07-rendering.md` §2.3).
 *
 * @param app - The app whose asset service publishes it.
 * @returns The handle, with one holder — the caller, which is the renderer service.
 *
 * @internal
 */
export function createDefaultMaterialAsset(app: App): AssetHandle<MaterialAsset> {
  const definition = pbrMaterialDefinition({ name: "ignifx:default", metallic: 0, roughness: 0.9 });
  return app.assets.register(new MaterialAsset(definition, createDefaultMaterial(), []), {
    type: MATERIAL_ASSET_TYPE,
  });
}

/**
 * Fills in a PBR declaration's defaults, so callers name only what they mean to change.
 *
 * @param overrides - The properties to set.
 * @returns A complete declaration.
 *
 * @example
 * ```ts
 * pbrMaterialDefinition({ name: "gold", metallic: 1, roughness: 0.25 });
 * ```
 *
 * @public
 */
export function pbrMaterialDefinition(
  overrides: Partial<Omit<PbrMaterialDefinition, "kind">> = {},
): PbrMaterialDefinition {
  return {
    kind: "pbr",
    name: overrides.name ?? "",
    baseColor: overrides.baseColor ?? { r: 1, g: 1, b: 1, a: 1 },
    metallic: overrides.metallic ?? 1,
    roughness: overrides.roughness ?? 1,
    normalScale: overrides.normalScale ?? 1,
    emissive: overrides.emissive ?? { r: 0, g: 0, b: 0, a: 1 },
    occlusionStrength: overrides.occlusionStrength ?? 1,
    alphaMode: overrides.alphaMode ?? "opaque",
    alphaCutoff: overrides.alphaCutoff ?? 0.5,
    alpha: overrides.alpha ?? 1,
    doubleSided: overrides.doubleSided ?? false,
    unlit: overrides.unlit ?? false,
    environmentIntensity: overrides.environmentIntensity ?? 1,
    textures: overrides.textures ?? {},
  };
}

/**
 * Fills in a Standard declaration's defaults.
 *
 * @param overrides - The properties to set.
 * @returns A complete declaration.
 *
 * @public
 */
export function standardMaterialDefinition(
  overrides: Partial<Omit<StandardMaterialDefinition, "kind">> = {},
): StandardMaterialDefinition {
  return {
    kind: "standard",
    name: overrides.name ?? "",
    diffuse: overrides.diffuse ?? { r: 1, g: 1, b: 1, a: 1 },
    specular: overrides.specular ?? { r: 1, g: 1, b: 1, a: 1 },
    specularPower: overrides.specularPower ?? 64,
    emissive: overrides.emissive ?? { r: 0, g: 0, b: 0, a: 1 },
    alpha: overrides.alpha ?? 1,
    alphaCutoff: overrides.alphaCutoff ?? 0,
    doubleSided: overrides.doubleSided ?? false,
    unlit: overrides.unlit ?? false,
    textures: overrides.textures ?? {},
  };
}

/**
 * Refuses a material family this build cannot construct.
 *
 * @param kind - The `type` the file declared.
 * @param address - The address, for the message.
 * @throws IgnifxError with code `IGX-0708` for `"shader"`, which no build has implemented.
 *
 * @internal
 */
export function assertMaterialKindSupported(kind: MaterialKind, address: string): void {
  if (kind !== "shader") {
    return;
  }
  throw new IgnifxError(
    CoreErrorCode.unsupportedMaterialKind,
    `${address} declares a shader material, which this build cannot construct.`,
    {
      context: { asset: address, kind },
      hint: 'WGSL materials are not implemented; declare "pbr" or "standard".',
    },
  );
}

/**
 * Groups a declaration's resolved textures by slot name.
 *
 * @param definition - The declaration, whose `textures` map is slot to address.
 * @param textures - The handles, in the order the loader resolved the slots.
 * @returns Slot name to Lite texture, skipping slots whose asset is headless or missing.
 */
function indexTextures(
  definition: MaterialDefinition,
  textures: readonly AssetHandle<TextureAsset>[],
): ReadonlyMap<string, LiteTexture2D> {
  const bySlot = new Map<string, LiteTexture2D>();
  const slots = Object.keys(definition.textures);
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const handle = textures[index];
    if (slot === undefined || handle === undefined || handle.state !== "loaded") {
      continue;
    }
    const texture = handle.value.lite.texture;
    if (texture !== null) {
      bySlot.set(slot, texture);
    }
  }
  return bySlot;
}

/**
 * Builds the Lite PBR material a declaration describes, converting its sRGB colours to linear.
 *
 * @param definition - The declaration.
 * @param textures - Slot name to Lite texture.
 * @returns The Lite material.
 */
function buildPbrMaterial(
  definition: PbrMaterialDefinition,
  textures: ReadonlyMap<string, LiteTexture2D>,
): LitePbrMaterial {
  const base = toLinear(definition.baseColor);
  const emissive = toLinear(definition.emissive);
  const input: {
    name: string;
    baseColor: readonly [number, number, number, number];
    metallic: number;
    roughness: number;
    normalScale: number;
    emissive: readonly [number, number, number];
    occlusionStrength: number;
    alphaMode: MaterialAlphaMode;
    alphaCutoff: number;
    alpha: number;
    doubleSided: boolean;
    unlit: boolean;
    environmentIntensity: number;
    baseColorTexture?: LiteTexture2D;
    metallicRoughnessTexture?: LiteTexture2D;
    normalTexture?: LiteTexture2D;
    emissiveTexture?: LiteTexture2D;
    occlusionTexture?: LiteTexture2D;
  } = {
    name: definition.name,
    baseColor: [base.r, base.g, base.b, definition.baseColor.a],
    metallic: definition.metallic,
    roughness: definition.roughness,
    normalScale: definition.normalScale,
    emissive: [emissive.r, emissive.g, emissive.b],
    occlusionStrength: definition.occlusionStrength,
    alphaMode: definition.alphaMode,
    alphaCutoff: definition.alphaCutoff,
    alpha: definition.alpha,
    doubleSided: definition.doubleSided,
    unlit: definition.unlit,
    environmentIntensity: definition.environmentIntensity,
  };
  assignTexture(textures, "baseColorTexture", (texture) => {
    input.baseColorTexture = texture;
  });
  assignTexture(textures, "metallicRoughnessTexture", (texture) => {
    input.metallicRoughnessTexture = texture;
  });
  assignTexture(textures, "normalTexture", (texture) => {
    input.normalTexture = texture;
  });
  assignTexture(textures, "emissiveTexture", (texture) => {
    input.emissiveTexture = texture;
  });
  assignTexture(textures, "occlusionTexture", (texture) => {
    input.occlusionTexture = texture;
  });
  return createPbrMaterialFromProps(input);
}

/**
 * Builds the Lite Standard material a declaration describes.
 *
 * @param definition - The declaration.
 * @param textures - Slot name to Lite texture.
 * @returns The Lite material.
 */
function buildStandardMaterial(
  definition: StandardMaterialDefinition,
  textures: ReadonlyMap<string, LiteTexture2D>,
): LiteStandardMaterial {
  const diffuse = toLinear(definition.diffuse);
  const specular = toLinear(definition.specular);
  const emissive = toLinear(definition.emissive);
  const input: {
    name: string;
    diffuse: readonly [number, number, number];
    specular: readonly [number, number, number];
    specularPower: number;
    emissive: readonly [number, number, number];
    alpha: number;
    alphaCutoff: number;
    doubleSided: boolean;
    unlit: boolean;
    diffuseTexture?: LiteTexture2D;
    specularTexture?: LiteTexture2D;
    emissiveTexture?: LiteTexture2D;
    normalTexture?: LiteTexture2D;
    opacityTexture?: LiteTexture2D;
  } = {
    name: definition.name,
    diffuse: [diffuse.r, diffuse.g, diffuse.b],
    specular: [specular.r, specular.g, specular.b],
    specularPower: definition.specularPower,
    emissive: [emissive.r, emissive.g, emissive.b],
    alpha: definition.alpha,
    alphaCutoff: definition.alphaCutoff,
    doubleSided: definition.doubleSided,
    unlit: definition.unlit,
  };
  assignTexture(textures, "diffuseTexture", (texture) => {
    input.diffuseTexture = texture;
  });
  assignTexture(textures, "specularTexture", (texture) => {
    input.specularTexture = texture;
  });
  assignTexture(textures, "emissiveTexture", (texture) => {
    input.emissiveTexture = texture;
  });
  assignTexture(textures, "normalTexture", (texture) => {
    input.normalTexture = texture;
  });
  assignTexture(textures, "opacityTexture", (texture) => {
    input.opacityTexture = texture;
  });
  return createStandardMaterialFromProps(input);
}

/**
 * Calls `assign` with the texture bound to a slot, when one is.
 *
 * @param textures - Slot name to Lite texture.
 * @param slot - The slot to read.
 * @param assign - Writes the texture onto the adapter input.
 */
function assignTexture(
  textures: ReadonlyMap<string, LiteTexture2D>,
  slot: string,
  assign: (texture: LiteTexture2D) => void,
): void {
  const texture = textures.get(slot);
  if (texture !== undefined) {
    assign(texture);
  }
}

/**
 * Converts an sRGB colour's RGB channels to linear. Alpha is already linear and is not touched.
 *
 * @param color - The sRGB colour.
 * @returns The linear channels.
 */
function toLinear(color: ColorLike): { readonly r: number; readonly g: number; readonly b: number } {
  return {
    r: Color.srgbToLinear(color.r),
    g: Color.srgbToLinear(color.g),
    b: Color.srgbToLinear(color.b),
  };
}

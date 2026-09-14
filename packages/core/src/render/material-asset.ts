import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import {
  createDefaultMaterial,
  createPbrMaterialFromProps,
  createStandardMaterialFromProps,
  markMaterialDirty,
  setMaterialAlpha,
  setPbrBaseColor,
  setPbrMetallicRoughness,
} from "../lite/material.js";
import { Color } from "../math/color.js";
import { shaderSupport, surfaceShaderSupport } from "./shader-support.js";
import type { ShaderAsset } from "./shader-asset.js";
import type { ShaderMaterialDefinition } from "./shader-material-definition.js";
import type { ShaderMaterialState } from "./shader-material.js";
import type { StorageBufferAsset } from "./storage-buffer-asset.js";
import type { SurfaceShaderBinding, SurfaceShaderInit, SurfaceShaderReference } from "./surface-shader.js";
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
 * - **`"type": "shader"` is values applied to a `ShaderAsset`.** §2.6 lists the family, and the
 *   WGSL attribute, uniform, sampler, storage, define, and pipeline layout is declared by the
 *   `.wgsl` file's own `// @ignifx` pragmas rather than by the material file
 *   (`src/render/shader-pragma.ts`, `docs/plan/2026-09-terrain-particles-shaders.md` §3.1). So a
 *   shader `.material.json` names the shader, the values, the textures, and the defines, and
 *   nothing about Babylon Lite's `ShaderMaterialOptions` reaches the public API
 *   (`CONSTITUTION.md` §3.4). `IGX-0708` is still what an unknown `type` string produces.
 * - **A shader material casts PCF shadows, and must not cast ESM ones.** Measured on a device
 *   (2026-09-08): a mesh wearing a shader material casts into a PCF or CSM shadow map with no flag
 *   at all, because the depth-only target compiles no fragment stage. An **ESM** generator is
 *   different — Babylon Lite has no shader-family material view for it and writes the fragment
 *   colour's red channel into the exponential map
 *   (`lib/shadow/esm-directional-shadow-generator.js` 230–245), so a shader-material caster paints
 *   nonsense into an ESM map. The renderer keeps such meshes out of ESM caster lists (`IGX-0724`);
 *   a project that wants shadows from a custom shader picks `pcf` or `csm`.
 * - **The shader methods are the only kind-specific members.** `setUniform`, `getUniform`,
 *   `setTexture`, `setDefine`, and `setStorageBuffer` throw `IGX-0718` on a PBR or Standard
 *   material, and `setBaseColor`, `setMetallicRoughness`, and `setAlpha` throw it on a shader
 *   material: a shader material's "base colour" is whatever its file chose to call one, and
 *   silently writing a field nothing reads is worse than refusing.
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
  readonly alphaMode: MaterialAlphaMode;
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
  /**
   * The `.surface.wgsl` files layered onto this material, in the order they are applied
   * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.2). It needs
   * `rendering.features.materialPlugins`.
   */
  readonly surfaces: readonly SurfaceShaderReference[];
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
  /**
   * The `.surface.wgsl` files layered onto this material. **Refused on a Standard material**:
   * Babylon Lite 1.27.0 cannot bake a Standard host's plugins in time (`./surface-shader.ts`). The
   * field exists so the format is one shape for both families and so the refusal is a sentence
   * rather than a silently ignored list.
   */
  readonly surfaces: readonly SurfaceShaderReference[];
}

/**
 * The parsed body of a `.material.json`, discriminated by `kind`.
 *
 * @public
 */
export type MaterialDefinition = PbrMaterialDefinition | StandardMaterialDefinition | ShaderMaterialDefinition;

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

  readonly #shader: ShaderMaterialState | null;

  /**
   * Wraps a built Lite material. Use {@link createMaterialAsset}; the loader constructs these.
   *
   * @param definition - The declaration it was built from.
   * @param material - The Lite material. A shader material passes a throwaway Standard material and
   * its live state separately, because `setDefine` and a hot reload replace the Lite object.
   * @param textures - The texture handles the material samples.
   * @param shader - The live shader state, for a `"shader"` material; `null` otherwise.
   *
   * @internal
   */
  constructor(
    definition: MaterialDefinition,
    material: LitePbrMaterial | LiteStandardMaterial,
    textures: readonly AssetHandle<TextureAsset>[],
    shader: ShaderMaterialState | null = null,
  ) {
    this.definition = definition;
    this.textures = textures;
    this.#material = material;
    this.#shader = shader;
    // The two Lite material shapes are structurally distinct, and `definition.kind` is what the
    // factory branched on a moment ago, so the narrowing is a restatement rather than a guess
    // (coding standards §5.2).
    if (definition.kind === "pbr") {
      this.#pbr = material;
      this.#standard = createStandardMaterialFromProps({});
    } else if (definition.kind === "shader") {
      this.#pbr = null;
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
    const shader = this.#shader;
    return { material: shader === null ? this.#material : shader.material };
  }

  /**
   * The shader a `"shader"` material sets values on.
   *
   * @returns The shader asset, or `null` for a PBR or Standard material. A hot reload of the
   * `.wgsl` replaces it in place.
   */
  get shader(): ShaderAsset | null {
    return this.#shader?.shader ?? null;
  }

  /**
   * The surface shaders layered onto this material, in the order they were attached
   * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.2).
   *
   * @returns The bindings, or an empty array.
   */
  get surfaces(): readonly SurfaceShaderBinding[] {
    return surfaceShaderSupport()?.surfaceShaders(this) ?? [];
  }

  /**
   * One attached surface shader, by the name it answers to — the `.surface.wgsl` basename unless the
   * material renamed it.
   *
   * @param name - The shader's name.
   * @returns The binding a game writes values through.
   * @throws IgnifxError with code `IGX-0712` when the material carries no such surface shader.
   *
   * @example
   * ```ts
   * rock.value.surface("snow").set("amount", 0.8);
   * ```
   */
  surface(name: string): SurfaceShaderBinding {
    const support = surfaceShaderSupport();
    if (support === null) {
      throw new IgnifxError(
        CoreErrorCode.unknownShaderBinding,
        `${this.name} carries no surface shader named ${name}.`,
        {
          context: { material: this.name, name },
          hint: "Load the .surface.wgsl and declare it in the material's surfaces list first.",
        },
      );
    }
    return support.surfaceShaderBinding(this, name);
  }

  /**
   * Whether Babylon Lite can draw the material yet.
   *
   * @remarks
   * `false` only for a shader material whose file declares a `// @ignifx storage` binding that
   * nothing has filled in: Lite refuses to build a bind group with an unbound storage buffer, so
   * such a material must be given one before a mesh wears it. Everything else is always drawable.
   *
   * @returns `true` when every declared binding has something bound.
   */
  get isDrawable(): boolean {
    return this.#shader?.isDrawable ?? true;
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
   * @throws IgnifxError with code `IGX-0718` on a `"shader"` material, which has no base colour of
   * the engine's choosing.
   */
  setBaseColor(color: ColorLike): void {
    this.#assertNotShader("setBaseColor");
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
    this.#assertNotShader("setMetallicRoughness");
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
    this.#assertNotShader("setAlpha");
    setMaterialAlpha(this.#material, alpha);
  }

  /**
   * Writes one of the shader's declared uniforms.
   *
   * @remarks
   * The value is checked against the `// @ignifx uniform` declaration in the `.wgsl`: an undeclared
   * name is `IGX-0712` and a value of the wrong shape is `IGX-0713`, so a typo fails at the call
   * site rather than showing up as a black surface. A uniform declared `color(…)` takes a
   * {@link ColorLike} in **sRGB** and is uploaded linear, like every other colour in ignifx.
   *
   * @param name - The declared uniform's name.
   * @param value - A number, a numeric array of the declared length, or an sRGB colour.
   * @throws IgnifxError with code `IGX-0718` unless this is a `"shader"` material, `IGX-0712` when
   * the shader declares no such uniform or the engine writes it, or `IGX-0713` when the value's
   * shape does not match the declared type.
   *
   * @example
   * ```ts
   * dissolve.value.setUniform("progress", 0.4);
   * dissolve.value.setUniform("edgeColor", { r: 1, g: 0.45, b: 0.1, a: 1 });
   * ```
   */
  setUniform(name: string, value: number | readonly number[] | Float32Array | ColorLike): void {
    this.#requireShader("setUniform").setUniform(name, value);
  }

  /**
   * Reads the current value of one of the shader's declared uniforms.
   *
   * @param name - The declared uniform's name.
   * @param out - Receives a vector or matrix value; omit it to get a fresh array, or read a scalar
   * uniform's number directly.
   * @returns The number for `f32`, `u32`, and `i32`, and the filled array for everything else.
   * @throws IgnifxError with code `IGX-0718` unless this is a `"shader"` material, `IGX-0712` when
   * the shader declares no such uniform, or `IGX-0713` when `out` is too short.
   */
  getUniform(name: string, out?: Float32Array): number | Float32Array {
    const shader = this.#requireShader("getUniform");
    return out === undefined ? shader.getUniform(name) : shader.getUniform(name, out);
  }

  /**
   * Binds a texture to one of the shader's declared samplers.
   *
   * @param name - The declared sampler's name.
   * @param texture - The texture, or `null` to restore the declaration's 1x1 fallback. There is no
   * "unbound": Babylon Lite cannot build a bind group for a sampler with nothing in it, so a
   * declaration with no `default` falls back to white.
   * @throws IgnifxError with code `IGX-0718` unless this is a `"shader"` material, or `IGX-0712`
   * when the shader declares no such sampler.
   */
  setTexture(name: string, texture: AssetHandle<TextureAsset> | null): void {
    this.#requireShader("setTexture").setTexture(name, texture);
  }

  /**
   * Overrides one of the shader's declared `define` values.
   *
   * @remarks
   * A define is a WGSL `const` compiled into the pipeline, so this rebuilds the Babylon Lite
   * material and replays every value, texture, and storage binding onto the new one. `MeshRenderer`
   * picks the new material up on the next `PreRender`, and the frame after that draws with the new
   * pipeline — so treat it as a level-load or settings-screen operation, not a per-frame one.
   *
   * @param name - The declared define's name.
   * @param value - The new value; a boolean compiles to `bool`, a number to `f32`.
   * @throws IgnifxError with code `IGX-0718` unless this is a `"shader"` material, or `IGX-0712`
   * when the shader declares no such define.
   */
  setDefine(name: string, value: boolean | number): void {
    this.#requireShader("setDefine").setDefine(name, value);
  }

  /**
   * Binds a read-only storage buffer to one of the shader's declared bindings.
   *
   * @param name - The declared binding's name.
   * @param buffer - The buffer, or `null` to unbind. A shader material with an unbound declared
   * storage buffer is not drawable ({@link MaterialAsset.isDrawable}).
   * @throws IgnifxError with code `IGX-0718` unless this is a `"shader"` material, or `IGX-0712`
   * when the shader declares no such storage buffer.
   */
  setStorageBuffer(name: string, buffer: AssetHandle<StorageBufferAsset> | null): void {
    this.#requireShader("setStorageBuffer").setStorageBuffer(name, buffer);
  }

  /**
   * Releases what the material holds beyond its Babylon Lite object: a shader material's per-frame
   * uniform registration and its hot-reload hook.
   *
   * @remarks
   * The `material` asset type's `unload` runs it when the last holder releases the handle, so a
   * game that pairs `load`/`release` or uses `using` never has to. Calling it twice is a no-op, and
   * it is a no-op on a PBR or Standard material, which own nothing of the kind.
   */
  dispose(): void {
    surfaceShaderSupport()?.detachSurfaceShaders(this);
    this.#shader?.dispose();
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

  /**
   * The live shader state, for a method that needs one.
   *
   * @param member - The method being called, for the message.
   * @returns The state.
   * @throws IgnifxError with code `IGX-0718` on a PBR or Standard material.
   */
  #requireShader(member: string): ShaderMaterialState {
    const shader = this.#shader;
    if (shader !== null) {
      return shader;
    }
    throw new IgnifxError(
      CoreErrorCode.notAShaderMaterial,
      `${this.definition.name} is a ${this.definition.kind} material; ${member}() needs a shader material.`,
      {
        context: { material: this.definition.name, kind: this.definition.kind, method: member },
        hint: 'Build it from shaderMaterialDefinition({ shader }) or a .material.json with "type": "shader".',
      },
    );
  }

  /**
   * Refuses a PBR or Standard setter on a shader material.
   *
   * @param member - The method being called, for the message.
   * @throws IgnifxError with code `IGX-0718` on a `"shader"` material.
   */
  #assertNotShader(member: string): void {
    if (this.#shader === null) {
      return;
    }
    throw new IgnifxError(
      CoreErrorCode.notAShaderMaterial,
      `${this.definition.name} is a shader material; ${member}() has no meaning on one.`,
      {
        context: { material: this.definition.name, kind: this.definition.kind, method: member },
        hint: "Set the uniform its .wgsl declares with setUniform() instead.",
      },
    );
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
  const shader = definition.kind === "shader" ? resolveShaderAsset(app, definition.shader) : null;
  const surfaces = definition.kind === "shader" ? [] : resolveSurfaceShaders(app, definition.surfaces);
  return app.assets.register(buildMaterialAsset(definition, textures, { app, shader, surfaces }), {
    type: MATERIAL_ASSET_TYPE,
  });
}

/**
 * Turns a definition's serialized `surfaces` list into the handles the attach path takes.
 *
 * @remarks
 * A surface shader has to be loaded before a material can be built on it, exactly as a `"shader"`
 * material's program does. A texture it names that is not loaded is left unbound, which falls back
 * to the declaration's 1x1 default — the same rule a missing PBR texture slot follows.
 *
 * @param app - The app whose asset cache holds the shaders and their textures.
 * @param references - What the definition declared.
 * @returns One init per reference, in order.
 * @throws IgnifxError with code `IGX-0501` when a named shader is not loaded.
 */
function resolveSurfaceShaders(app: App, references: readonly SurfaceShaderReference[]): readonly SurfaceShaderInit[] {
  const inits: SurfaceShaderInit[] = [];
  for (const reference of references) {
    const shader = app.assets.get<ShaderAsset>(reference.shader);
    if (shader === null || shader.state !== "loaded") {
      throw new IgnifxError(CoreErrorCode.assetNotLoaded, `The surface shader ${reference.shader} is not loaded.`, {
        context: { asset: reference.shader },
        hint: "await app.assets.loadAsync(address) before building a material from it.",
      });
    }
    const textures: Record<string, AssetHandle<TextureAsset>> = {};
    for (const name of Object.keys(reference.textures)) {
      const handle = app.assets.get<TextureAsset>(reference.textures[name] ?? "");
      if (handle !== null && handle.state === "loaded") {
        textures[name] = handle;
      }
    }
    inits.push({
      shader,
      ...(reference.name === "" ? {} : { name: reference.name }),
      values: reference.values,
      textures,
      enabled: reference.enabled,
      priority: reference.priority,
    });
  }
  return inits;
}

/**
 * Finds the loaded `ShaderAsset` a shader declaration names.
 *
 * @remarks
 * A shader material is *values applied to a shader*, so the shader has to be loaded first. That is
 * always true in practice: {@link shaderMaterialDefinition} is normally given the handle, and the
 * `.material.json` loader resolves the address as a dependency.
 *
 * @param app - The app whose asset cache holds it.
 * @param address - The shader's address.
 * @returns The shader asset.
 * @throws IgnifxError with code `IGX-0501` when the shader is not loaded.
 */
function resolveShaderAsset(app: App, address: string): ShaderAsset {
  const handle = app.assets.get<ShaderAsset>(address);
  if (handle === null || handle.state !== "loaded") {
    throw new IgnifxError(CoreErrorCode.assetNotLoaded, `The shader ${address} is not loaded.`, {
      context: { asset: address },
      hint: "await app.assets.loadAsync(address) before building a material from it.",
    });
  }
  return handle.value;
}

/**
 * What a `"shader"` declaration needs beyond its textures: the app whose engine and registry the
 * live material hangs off, and the already-loaded shader it sets values on.
 *
 * @internal
 */
export interface MaterialBuildContext {
  /** The app. */
  readonly app: App;
  /** The shader asset, for a `"shader"` declaration. */
  readonly shader: ShaderAsset | null;
  /**
   * The surface shaders the definition's `surfaces` list resolved to, with their handles. Empty for
   * a material that declares none.
   */
  readonly surfaces?: readonly SurfaceShaderInit[];
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
 * @param textures - The texture handles the declaration's slots resolved to, in slot order. For a
 * `"shader"` declaration they are in the order its own `textures` record names them.
 * @param context - The app and the resolved shader; required for a `"shader"` declaration.
 * @returns The asset.
 * @throws IgnifxError with code `IGX-0501` when a `"shader"` declaration arrives without a loaded
 * shader.
 *
 * @internal
 */
export function buildMaterialAsset(
  definition: MaterialDefinition,
  textures: readonly AssetHandle<TextureAsset>[],
  context?: MaterialBuildContext,
): MaterialAsset {
  if (definition.kind === "shader") {
    const app = context?.app;
    const shader = context?.shader ?? null;
    const support = shaderSupport();
    if (app === undefined || shader === null || support === null) {
      throw new IgnifxError(CoreErrorCode.assetNotLoaded, `The shader ${definition.shader} is not loaded.`, {
        context: { asset: definition.shader },
        hint: "await app.assets.loadAsync(address) before building a material from it.",
      });
    }
    const state = support.buildShaderMaterialState(app, shader, definition, textures);
    return new MaterialAsset(definition, createStandardMaterialFromProps({}), textures, state);
  }
  const bySlot = indexTextures(definition, textures);
  const material =
    definition.kind === "pbr" ? buildPbrMaterial(definition, bySlot) : buildStandardMaterial(definition, bySlot);
  const asset = new MaterialAsset(definition, material, textures);
  const surfaces = context?.surfaces ?? [];
  if (surfaces.length > 0) {
    // Throws IGX-0716 without the materialPlugins opt-in, and IGX-0712/0713/0723/0726 for a
    // declaration the shader or the host cannot honour. The layer is loaded by the `.wgsl` loader
    // that produced the `ShaderAsset` these inits carry, so it is always here by now.
    surfaceShaderSupport()?.attachSurfaceShaders(asset, context?.app ?? null, surfaces);
  }
  return asset;
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
    surfaces: overrides.surfaces ?? [],
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
    surfaces: overrides.surfaces ?? [],
  };
}

/**
 * Groups a declaration's resolved textures by slot name.
 *
 * @param definition - The declaration, whose `textures` map is slot to address.
 * @param textures - The handles, in the order the loader resolved the slots.
 * @returns Slot name to Lite texture, skipping slots whose asset is headless or missing.
 */
function indexTextures(
  definition: PbrMaterialDefinition | StandardMaterialDefinition,
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

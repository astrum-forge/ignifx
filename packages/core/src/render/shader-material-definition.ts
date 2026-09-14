import type { ShaderAsset } from "./shader-asset.js";
import type { TextureAsset } from "./texture-asset.js";
import type { AssetHandle } from "../assets/types.js";
import type { ColorLike } from "../math/types.js";

/**
 * What a `"shader"` material declares — which `.wgsl`, and what to set on it
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1).
 *
 * Plain data with no dependencies, so the barrel can export it without pulling the live material
 * state or the pragma parser into every entry chunk (`./shader-support.ts`).
 */

/**
 * The properties a `"shader"` material declares: which shader, and what to set on it
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1).
 *
 * @public
 */
export interface ShaderMaterialDefinition {
  /** The family discriminator. */
  readonly kind: "shader";
  /** A human-readable name, used in GPU debug labels and diagnostics. */
  readonly name: string;
  /** The address of the `.wgsl` this material is values for. */
  readonly shader: string;
  /**
   * Overrides of the shader file's declared uniform defaults, by uniform name. A colour uniform's
   * value is sRGB, like every colour in ignifx's public API.
   */
  readonly values: Readonly<Record<string, number | readonly number[] | ColorLike>>;
  /** Texture asset addresses, by the declared sampler name. */
  readonly textures: Readonly<Record<string, string>>;
  /** Overrides of the shader file's declared `define` values, by name. */
  readonly defines: Readonly<Record<string, boolean | number>>;
}

/**
 * What {@link shaderMaterialDefinition} accepts.
 *
 * @public
 */
export interface ShaderMaterialDefinitionInput {
  /** The `.wgsl` asset, as a loaded handle or an address. */
  readonly shader: AssetHandle<ShaderAsset> | string;
  /** A human-readable name; defaults to the shader's address. */
  readonly name?: string;
  /** Overrides of the declared uniform defaults. Colours are sRGB. */
  readonly values?: Readonly<Record<string, number | readonly number[] | ColorLike>>;
  /** Textures for the declared samplers, as loaded handles or addresses. */
  readonly textures?: Readonly<Record<string, AssetHandle<TextureAsset> | string>>;
  /** Overrides of the declared `define` values. */
  readonly defines?: Readonly<Record<string, boolean | number>>;
}

/**
 * Builds a `"shader"` material declaration, recording the addresses of the handles it is given.
 *
 * @param input - The shader, and whatever this material sets on it.
 * @returns A complete declaration, ready for {@link createMaterialAsset}.
 *
 * @example
 * ```ts
 * const definition = shaderMaterialDefinition({
 *   shader: dissolveShader,
 *   values: { progress: 0.25, edgeColor: { r: 1, g: 0.6, b: 0.2, a: 1 } },
 *   textures: { noiseTexture: noise },
 *   defines: { SOFT_EDGE: true },
 * });
 * ```
 *
 * @public
 */
export function shaderMaterialDefinition(input: ShaderMaterialDefinitionInput): ShaderMaterialDefinition {
  const shader = typeof input.shader === "string" ? input.shader : input.shader.address;
  const textures: Record<string, string> = {};
  const declared = input.textures ?? {};
  for (const name of Object.keys(declared)) {
    const bound = declared[name];
    if (bound !== undefined) {
      textures[name] = typeof bound === "string" ? bound : bound.address;
    }
  }
  return {
    kind: "shader",
    name: input.name ?? shader,
    shader,
    values: input.values ?? {},
    textures,
    defines: input.defines ?? {},
  };
}

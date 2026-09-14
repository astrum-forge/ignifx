import { createMaterialAsset, SHADER_ASSET_TYPE, shaderMaterialDefinition } from "@ignifx/core";
import { FOLIAGE_SHADER_NAME, foliageShaderSource } from "./foliage.wgsl.js";
import { shaderSourceAddress } from "./shader-source.js";
import type {
  App,
  AssetHandle,
  ColorLike,
  MaterialAsset,
  ShaderAsset,
  ShaderMaterialDefinition,
  TextureAsset,
} from "@ignifx/core";

/**
 * Foliage materials (`docs/plan/2026-09-terrain-particles-shaders.md` §5.5): a lit, alpha-tested,
 * wind-blown shader material for grass cards, leaves, and every `TerrainScatter` mesh.
 *
 * `./foliage.wgsl.ts` says why this is a shader material rather than PBR plus a surface shader.
 */

/**
 * What {@link foliageMaterialDefinition} accepts.
 *
 * @public
 */
export interface FoliageMaterialInput {
  /** The albedo texture, with the alpha the cutoff tests. */
  readonly albedo: AssetHandle<TextureAsset>;
  /** The wind. Omit it for `strength: 0.25, frequency: 1.2, height: 1`; `null` switches it off. */
  readonly wind?: {
    /** Metres of lean at `height`. */
    readonly strength?: number;
    /** Sway cycles per second. */
    readonly frequency?: number;
    /** The height above the mesh origin at which the lean reaches `strength`. */
    readonly height?: number;
  } | null;
  /** The alpha below which a fragment is discarded. Defaults to `0.5`. */
  readonly alphaCutoff?: number;
  /**
   * Whether both faces draw. Defaults to `true`, and is the only option: the shader declares
   * `cull none` and lights two-sided, because a grass card seen from behind is still grass.
   */
  readonly doubleSided?: boolean;
  /** An sRGB tint multiplied with the albedo. Defaults to white. */
  readonly tint?: ColorLike;
  /**
   * Whether the material draws an `InstancedMeshRenderer`. Defaults to `true`, which is what a
   * `TerrainScatter` needs; a plain `MeshRenderer` needs `false`, because the instanced vertex
   * stage reads `world0..world3` and a mesh without thin instances has none.
   */
  readonly instanced?: boolean;
  /** A human-readable name. Defaults to `foliage`. */
  readonly name?: string;
}

/**
 * The address the foliage shader for a variant is loaded from: a `data:` URL of its source.
 *
 * @param instanced - Which variant.
 * @returns The address.
 *
 * @public
 */
export function foliageShaderAddress(instanced = true): string {
  return shaderSourceAddress(foliageShaderSource({ instanced }));
}

/**
 * Builds a foliage material declaration: the foliage shader plus the wind, cutoff, and tint values.
 *
 * @remarks
 * Pure data, like every other `*Definition` helper; the shader it names has to be **loaded**
 * before `createMaterialAsset` accepts the declaration, which is what
 * {@link createFoliageMaterial} does in one call. The wind's `strength`, `frequency`, and `height`
 * become the `windStrength`, `windFrequency`, and `windHeight` uniforms, so a game can change them
 * on the material at runtime with `setUniform`.
 *
 * @param input - The albedo, the wind, the cutoff, and the tint.
 * @returns A `"shader"` material declaration.
 *
 * @example
 * ```ts
 * const definition = foliageMaterialDefinition({ albedo: grassCard, wind: { strength: 0.3 } });
 * ```
 *
 * @public
 */
export function foliageMaterialDefinition(input: FoliageMaterialInput): ShaderMaterialDefinition {
  const wind = input.wind === undefined ? {} : input.wind;
  const tint = input.tint ?? { r: 1, g: 1, b: 1, a: 1 };
  return shaderMaterialDefinition({
    shader: foliageShaderAddress(input.instanced ?? true),
    name: input.name ?? FOLIAGE_SHADER_NAME,
    values: {
      windStrength: wind === null ? 0 : (wind.strength ?? 0.25),
      windFrequency: wind === null ? 0 : (wind.frequency ?? 1.2),
      windHeight: wind === null ? 1 : Math.max(0.01, wind.height ?? 1),
      cutoff: input.alphaCutoff ?? 0.5,
      tint,
    },
    textures: { albedo: input.albedo },
  });
}

/**
 * Loads the foliage shader and builds the material in one call.
 *
 * @remarks
 * The shader goes through the ordinary `.wgsl` loader — from a `data:` address, with the type given
 * because the address has no suffix — which is also what loads Babylon Lite's custom-WGSL adapter
 * the first time. Before `app.start()` the load settles at once; afterwards it settles in the next
 * frame's `PreUpdate`, so call this from setup code rather than a lifecycle callback.
 *
 * @param app - The app.
 * @param input - The albedo, the wind, the cutoff, and the tint.
 * @returns The material handle, with one holder — the caller.
 *
 * @example
 * ```ts
 * const grass = await createFoliageMaterial(app, { albedo: grassCard, wind: { strength: 0.3 } });
 * scatter.material = grass;
 * ```
 *
 * @public
 */
export async function createFoliageMaterial(
  app: App,
  input: FoliageMaterialInput,
): Promise<AssetHandle<MaterialAsset>> {
  const definition = foliageMaterialDefinition(input);
  await app.assets.loadAsync<ShaderAsset>(definition.shader, { type: SHADER_ASSET_TYPE });
  return createMaterialAsset(app, definition, [input.albedo]);
}

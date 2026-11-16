import { enableMaterialPlugins, enablePbrLightmap, isPbrMaterial, setPbrLightmap } from "@babylonjs/lite";
import { markMaterialDirty } from "../material.js";
import type { Material, MaterialPlugin, SceneContext, Texture2D } from "@babylonjs/lite";

/**
 * Lightmaps on the GPU (`docs/architecture/07-rendering.md` §2.15). Loaded with
 * `../../render/gpu/lightmaps.ts` as one chunk, only once a static `MeshRenderer` names a loaded
 * lightmap (`CONSTITUTION.md` §2.5). Every Lite claim was read from `@babylonjs/lite@1.34.0`.
 *
 * - **Late enable.** `enablePbrLightmap` (`index.d.ts` 5342) asks to be awaited before
 *   `registerScene`, but all it does is register the fragment extension in a process-wide map whose
 *   sorted cache it resets (`lib/material/pbr/pbr-flags.js`, `_registerPbrExt`). A material that has
 *   no `lightmapTexture` reports no lightmap feature bits (`lightmap-fragment.js`, `detect`), so
 *   pipelines built before the call keep their keys, and a material built after it sees the
 *   extension. The chunk therefore enables it on load; `rendering.features.lightmaps` only does it
 *   earlier.
 * - **Per-material.** `setPbrLightmap` (12635) writes the texture, level, UV set, blend mode and
 *   decode onto one material and claims TEXCOORD_1 for it, so a renderer gets its own material
 *   before the call. Only `level` is a uniform (`writeLightmapUBO`); the rest are feature bits, so a
 *   change of them needs a new material.
 * - **Atlas placement.** The fragment samples `input.uv2` raw (line 24) and ignores the texture's
 *   `uScale`/`uOffset`, so Lite has no lightmap UV transform. The PBR vertex template writes
 *   `out.uv2 = uv2;` just before the `CUSTOM_VERTEX_MAIN_END` slot
 *   (`lib/material/pbr/pbr-template.js` 133, `pbr-template-ext.js` 71), so a plugin there rewrites
 *   the varying the lightmap reads: {@link lightmapAtlasPlugin}. The scale and offset are WGSL
 *   constants rather than uniforms, because a vertex-visible plugin uniform needs
 *   `enablePbrMaterialPluginVertexData` (`index.d.ts` 5349), whose bridge maps
 *   `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION` to the `NI` slot only
 *   (`lib/material/plugin/pbr-plugin-vertex-data.js` versus `plugin-bridge-shared.js`, which also
 *   injects it at `AI`), and the light-probe, HDR-output and SSGI plugins count on the double
 *   injection. So each distinct placement is its own pipeline variant. The varying exists only when
 *   the lightmap samples TEXCOORD_1 and the mesh has a `uvs2` buffer (`pbr-compose.js` 42), so the
 *   plugin is only for that case. Lite's own V flip, when the texture asks for one, applies to the
 *   transformed coordinate, as it does to the raw one.
 */

/**
 * The options one material's lightmap is drawn with.
 *
 * @internal
 */
export interface LiteLightmapOptions {
  /** Intensity multiplier on the sample. */
  readonly level: number;
  /** `true` multiplies the shaded colour (Lite's `useAsShadowmap`); `false` adds to it. */
  readonly shadowmap: boolean;
  /** Decode the sample from sRGB to linear (`pow(x, 2.2)`). */
  readonly gamma: boolean;
  /** Sample with the second UV set (`TEXCOORD_1`) rather than the first. */
  readonly uv2: boolean;
  /**
   * Where the renderer's UV2 square sits in the texture (`uv2 · scale + offset`), or `null` for the
   * whole texture. Only honoured with `uv2` on a mesh that has a second UV set.
   */
  readonly atlas: LiteLightmapAtlas | null;
}

/**
 * One renderer's placement in a lightmap atlas, as plain numbers.
 *
 * @internal
 */
export interface LiteLightmapAtlas {
  /** The atlas-space size of the renderer's UV2 square. */
  readonly scale: { readonly x: number; readonly y: number };
  /** The atlas-space position of the square's `(0, 0)` corner. */
  readonly offset: { readonly x: number; readonly y: number };
}

/** The atlas plugins made so far, by WGSL; a plugin holds no state, so one per placement does. */
let atlasPlugins: Map<string, MaterialPlugin> | null = null;

/** The name every atlas plugin carries; the WGSL tells placements apart in Lite's cache key. */
export const LIGHTMAP_ATLAS_PLUGIN_NAME = "ignifx-lightmap-atlas";

/**
 * A WGSL float literal, always with a decimal point or an exponent.
 *
 * @param value - A finite number.
 * @returns The literal.
 */
function float(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/**
 * The vertex code that moves the lightmap's UV2 varying into the renderer's atlas square.
 *
 * @param atlas - The placement.
 * @returns WGSL for `CUSTOM_VERTEX_MAIN_END`.
 *
 * @internal
 */
export function lightmapAtlasWgsl(atlas: LiteLightmapAtlas): string {
  const { scale, offset } = atlas;
  return (
    `out.uv2=out.uv2*vec2<f32>(${float(scale.x)},${float(scale.y)})` +
    `+vec2<f32>(${float(offset.x)},${float(offset.y)});`
  );
}

/**
 * The plugin that applies one atlas placement, shared by every material with that placement.
 *
 * @remarks
 * Only valid on a material whose lightmap samples TEXCOORD_1 drawn on a mesh with a `uvs2` buffer:
 * anywhere else `out.uv2` does not exist and the pipeline fails to compile.
 *
 * @param atlas - The placement.
 * @returns The plugin; the same object for the same placement.
 *
 * @internal
 */
export function lightmapAtlasPlugin(atlas: LiteLightmapAtlas): MaterialPlugin {
  const code = lightmapAtlasWgsl(atlas);
  atlasPlugins ??= new Map();
  let plugin = atlasPlugins.get(code);
  if (plugin === undefined) {
    const vertex = { CUSTOM_VERTEX_MAIN_END: code };
    plugin = {
      name: LIGHTMAP_ATLAS_PLUGIN_NAME,
      getCustomCode: (stage) => (stage === "vertex" ? vertex : null),
    };
    atlasPlugins.set(code, plugin);
  }
  return plugin;
}

/**
 * Whether a plugin is an atlas plugin.
 *
 * @param plugin - Any plugin.
 * @returns `true` for one {@link lightmapAtlasPlugin} made.
 */
function isAtlasPlugin(plugin: MaterialPlugin): boolean {
  return plugin.name === LIGHTMAP_ATLAS_PLUGIN_NAME;
}

/**
 * Installs Lite's PBR lightmap extension. Idempotent.
 *
 * @returns A promise that settles once the extension is registered.
 *
 * @internal
 */
export function enableLightmaps(): Promise<void> {
  return enablePbrLightmap();
}

/**
 * Gives a PBR material a lightmap.
 *
 * @remarks
 * With an `atlas` placement (and `uv2`), the material also gets the {@link lightmapAtlasPlugin} for
 * it, replacing an earlier one, and the scene's material-plugin bridges are installed first
 * (idempotent; light probes install them after `registerScene` the same way). The caller rebuilds
 * the material's pipelines afterwards.
 *
 * @param scene - The registered scene.
 * @param material - A material no other mesh shares, not yet built with other lightmap options.
 * @param texture - The lightmap.
 * @param options - How it is drawn.
 * @returns `false` when the material is not PBR, so nothing was set.
 *
 * @internal
 */
export function applyLightmap(
  scene: SceneContext,
  material: Material,
  texture: Texture2D,
  options: LiteLightmapOptions,
): boolean {
  if (!isPbrMaterial(material)) {
    return false;
  }
  setPbrLightmap(material, texture, {
    level: options.level,
    coordIndex: options.uv2 ? 1 : 0,
    useAsShadowmap: options.shadowmap,
    gamma: options.gamma,
  });
  const current = material.plugins ?? [];
  const kept = current.some(isAtlasPlugin) ? current.filter((plugin) => !isAtlasPlugin(plugin)) : current;
  if (options.atlas !== null && options.uv2) {
    enableMaterialPlugins(scene);
    material.plugins = [...kept, lightmapAtlasPlugin(options.atlas)];
  } else if (kept !== current) {
    material.plugins = kept;
  }
  return true;
}

/**
 * Changes a lightmapped material's intensity; only its uniform block is rewritten.
 *
 * @param material - A material {@link applyLightmap} set up.
 * @param level - The new multiplier.
 *
 * @internal
 */
export function setLightmapLevel(material: Material, level: number): void {
  if (isPbrMaterial(material) && material.lightmapLevel !== level) {
    material.lightmapLevel = level;
    markMaterialDirty(material);
  }
}

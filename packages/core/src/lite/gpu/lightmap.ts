import { enablePbrLightmap, isPbrMaterial, setPbrLightmap } from "@babylonjs/lite";
import { markMaterialDirty } from "../material.js";
import type { Material, Texture2D } from "@babylonjs/lite";

/**
 * Lightmaps on the GPU (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B3). Loaded with
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
 * - **No UV transform.** The fragment samples `input.uv2` raw (line 24), so atlas scale and offset
 *   are not applied (GI plan §5, spike P2).
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
 * @param material - A material no other mesh shares, not yet built with other lightmap options.
 * @param texture - The lightmap.
 * @param options - How it is drawn.
 * @returns `false` when the material is not PBR, so nothing was set.
 *
 * @internal
 */
export function applyLightmap(material: Material, texture: Texture2D, options: LiteLightmapOptions): boolean {
  if (!isPbrMaterial(material)) {
    return false;
  }
  setPbrLightmap(material, texture, {
    level: options.level,
    coordIndex: options.uv2 ? 1 : 0,
    useAsShadowmap: options.shadowmap,
    gamma: options.gamma,
  });
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

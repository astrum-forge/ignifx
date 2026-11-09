import { applyLightmap, enableLightmaps, setLightmapLevel } from "../../lite/gpu/lightmap.js";
import { rebuildMaterialPipelines } from "../../lite/material.js";
import type { App } from "../../app/types.js";
import type { AssetHandle } from "../../assets/types.js";
import type { LiteLightmapOptions } from "../../lite/gpu/lightmap.js";
import type { LiteTexture2D } from "../../lite/gpu/texture.js";
import type { LiteMaterial } from "../../lite/material.js";
import type { LiteScene } from "../../lite/scene.js";
import type { LightmapAsset } from "../lightmap-asset.js";
import type { MaterialAsset } from "../material-asset.js";
import type { MeshRendererLightmap } from "../mesh-renderer.js";

/**
 * The render layer's half of lightmaps (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B3):
 * one material clone per lightmapped renderer. Loaded with `../../lite/gpu/lightmap.ts` as one
 * chunk, only once a static `MeshRenderer` names a loaded lightmap.
 *
 * `MaterialAsset`s are shared, and a lightmap is per renderer, so each renderer draws with
 * `MaterialAsset.clone` of its material carrying the lightmap. The clone is rebuilt when the
 * material, the lightmap, its texture or a compiled option (`mode`, `gamma`, `uv2`) changes; a
 * `level` change only rewrites the clone's uniform block. Edits made to the shared material after
 * the clone was built do not reach it.
 *
 * ## Two frames, because of how Lite plumbs `uv2`
 *
 * Lite decides whether its PBR group carries the `uv2` attribute and varying when it builds the
 * group, from the meshes' materials at that time (`lib/material/pbr/pbr-renderable.js`, `hasAnyUv2`).
 * A `mesh.material` swap reuses the group's single-mesh rebuild (`lib/scene/scene-material-swap.js`),
 * whose composer has no `uv2` then, and a lightmap that samples `input.uv2` fails to compile; the
 * pipeline keeps failing after a later group rebuild, because the broken composition was cached
 * under the same feature key (measured in `lightmap.browser.test.ts`). So the renderer first draws
 * with a plain clone, which compiles like its base material, and on the next
 * {@link LightmapRuntime.flush} the clone gets its lightmap and `rebuildMaterial`, which for a built
 * PBR scene rebuilds the whole PBR group (`lib/scene/scene-runtime-mesh-build.js`, `B`) and so
 * composes the lightmap with `uv2`. That costs one PBR group rebuild per frame that new lightmapped
 * renderers arrive in, and one frame without the lightmap.
 */

/** One renderer's clone and what it was built from. */
interface Entry {
  readonly base: MaterialAsset;
  readonly lightmap: LightmapAsset;
  readonly texture: LiteTexture2D;
  readonly key: string;
  readonly clone: AssetHandle<MaterialAsset>;
  /** The options the next flush applies; `level` follows the record every frame. */
  options: LiteLightmapOptions;
  /** Whether the lightmap is set on the clone yet. */
  isApplied: boolean;
  /** Whether the clone was given up, so a pending flush skips it. */
  isReleased: boolean;
}

/**
 * The lightmaps of a renderer.
 *
 * @internal
 */
export interface LightmapRuntime {
  /** How many renderers draw with a lightmapped clone. */
  readonly count: number;
  /**
   * The material a renderer draws with: its lightmapped clone, built or refreshed as needed.
   *
   * @param owner - The renderer, as a map key.
   * @param base - The material it declares.
   * @param lightmap - The loaded lightmap.
   * @param settings - Its `lightmap` record.
   * @returns The clone's Lite material, or `base`'s while the texture is not on the GPU.
   */
  materialFor(
    owner: object,
    base: MaterialAsset,
    lightmap: LightmapAsset,
    settings: MeshRendererLightmap,
  ): LiteMaterial;
  /**
   * Drops a renderer's clone, if it has one.
   *
   * @param owner - The renderer.
   */
  release(owner: object): void;
  /** Gives the clones handed out a frame ago their lightmap; the renderer calls it after every `MeshRenderer` synced. */
  flush(): void;
  /** Drops every clone. */
  dispose(): void;
}

/**
 * Installs Lite's lightmap extension and creates the runtime.
 *
 * @param app - The app whose asset service publishes the clones.
 * @param scene - The registered render scene.
 * @returns The runtime, once the extension is registered.
 *
 * @internal
 */
export async function createLightmapRuntime(app: App, scene: LiteScene): Promise<LightmapRuntime> {
  await enableLightmaps();
  const entries = new Map<object, Entry>();
  /** Clones handed out this frame, and those whose meshes have drawn them plain for a frame. */
  let fresh: Entry[] = [];
  let due: Entry[] = [];

  const release = (owner: object): void => {
    const entry = entries.get(owner);
    if (entry !== undefined) {
      entries.delete(owner);
      entry.isReleased = true;
      entry.clone.release();
    }
  };

  return {
    get count(): number {
      return entries.size;
    },
    materialFor(owner, base, lightmap, settings): LiteMaterial {
      const handle = lightmap.texture;
      const texture = handle.state === "loaded" ? handle.value.lite.texture : null;
      if (texture === null) {
        release(owner);
        return base.lite.material;
      }
      const key = `${settings.mode}|${String(settings.gamma)}|${String(settings.uv2)}`;
      const options: LiteLightmapOptions = {
        level: settings.level,
        shadowmap: settings.mode === "shadowmap",
        gamma: settings.gamma,
        uv2: settings.uv2,
      };
      const current = entries.get(owner);
      if (
        current !== undefined &&
        current.base === base &&
        current.lightmap === lightmap &&
        current.texture === texture &&
        current.key === key
      ) {
        const material = current.clone.value.lite.material;
        current.options = options;
        if (current.isApplied) {
          setLightmapLevel(material, settings.level);
        }
        return material;
      }
      release(owner);
      const clone = base.clone(app);
      const entry: Entry = { base, lightmap, texture, key, clone, options, isApplied: false, isReleased: false };
      entries.set(owner, entry);
      fresh.push(entry);
      return clone.value.lite.material;
    },
    release,
    flush(): void {
      for (const entry of due) {
        if (entry.isReleased) {
          continue;
        }
        const material = entry.clone.value.lite.material;
        if (applyLightmap(material, entry.texture, entry.options)) {
          entry.isApplied = true;
          rebuildMaterialPipelines(scene, material);
        }
      }
      due = fresh;
      fresh = [];
    },
    dispose(): void {
      fresh = [];
      due = [];
      for (const owner of entries.keys()) {
        release(owner);
      }
    },
  };
}

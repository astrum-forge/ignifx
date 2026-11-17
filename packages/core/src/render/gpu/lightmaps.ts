import { applyLightmap, enableLightmaps, lightmapAtlasWgsl, setLightmapLevel } from "../../lite/gpu/lightmap.js";
import { rebuildMaterialPipelines, syncPbrFactors } from "../../lite/material.js";
import type { App } from "../../app/types.js";
import type { AssetHandle } from "../../assets/types.js";
import type { LiteLightmapOptions } from "../../lite/gpu/lightmap.js";
import type { LiteTexture2D } from "../../lite/gpu/texture.js";
import type { LiteMaterial } from "../../lite/material.js";
import type { LiteScene } from "../../lite/scene.js";
import type { LightmapAsset, LightmapPlacement } from "../lightmap-asset.js";
import type { MaterialAsset } from "../material-asset.js";
import type { LightmapMode, MeshRendererLightmap } from "../mesh-renderer.js";

/**
 * The render layer's half of lightmaps (`docs/architecture/07-rendering.md` §2.15): one material
 * clone per lightmapped renderer. Loaded with `../../lite/gpu/lightmap.ts` as one chunk, only once
 * a static `MeshRenderer` names a loaded lightmap.
 *
 * `MaterialAsset`s are shared, and a lightmap is per renderer, so each renderer draws with
 * `MaterialAsset.clone` of its material carrying the lightmap. The clone is rebuilt when the
 * material, the lightmap, its texture, a compiled option (`mode`, `gamma`, `uv2`) or the atlas
 * placement changes; a `level` change only rewrites the clone's uniform block. A placement other
 * than the whole texture is a vertex plugin on the clone (`../../lite/gpu/lightmap.ts`), one
 * pipeline variant per distinct placement. Nothing here allocates on a frame where no clone changes. Edits made to the shared material through
 * its factor setters (`setBaseColor`, `setMetallicRoughness`, `setAlpha`) are copied onto the clone
 * the next frame it is asked for (a comparison of seven numbers per frame); a reloaded material is a
 * new asset, so it gets a new clone.
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

/**
 * How many distinct atlas placements may be alive before the runtime warns once: each compiles its
 * own pipeline variant per pass.
 *
 * @internal
 */
export const LIGHTMAP_PLACEMENT_WARNING_THRESHOLD = 64;

/** One renderer's clone and what it was built from. */
interface Entry {
  readonly base: MaterialAsset;
  readonly lightmap: LightmapAsset;
  readonly texture: LiteTexture2D;
  /** The compiled options: a change of any of them needs a new clone. */
  readonly mode: LightmapMode;
  readonly gamma: boolean;
  readonly uv2: boolean;
  /** The atlas placement applied, or `null` for the whole texture; compared by reference. */
  readonly atlas: LightmapPlacement | null;
  /** The placement's WGSL, which tells distinct placements apart, or `null` without one. */
  readonly atlasKey: string | null;
  readonly clone: AssetHandle<MaterialAsset>;
  /** The intensity the next flush applies; it follows the record every frame. */
  level: number;
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
   * @param atlas - The renderer's placement in the texture, or `null` to sample all of it. The host
   * passes one only for a UV2 lightmap on a mesh with a second UV set; a placement object from the
   * asset keeps its identity, so a new one rebuilds the clone.
   * @returns The clone's Lite material, or `base`'s while the texture is not on the GPU.
   */
  materialFor(
    owner: object,
    base: MaterialAsset,
    lightmap: LightmapAsset,
    settings: MeshRendererLightmap,
    atlas: LightmapPlacement | null,
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
  /** Live renderers per distinct placement, for the pipeline-count warning. */
  const placements = new Map<string, number>();
  let hasWarnedPlacements = false;

  const release = (owner: object): void => {
    const entry = entries.get(owner);
    if (entry !== undefined) {
      entries.delete(owner);
      entry.isReleased = true;
      if (entry.atlasKey !== null) {
        const left = (placements.get(entry.atlasKey) ?? 1) - 1;
        if (left > 0) {
          placements.set(entry.atlasKey, left);
        } else {
          placements.delete(entry.atlasKey);
        }
      }
      entry.clone.release();
    }
  };

  return {
    get count(): number {
      return entries.size;
    },
    materialFor(owner, base, lightmap, settings, atlas): LiteMaterial {
      const handle = lightmap.texture;
      const texture = handle.state === "loaded" ? handle.value.lite.texture : null;
      if (texture === null) {
        release(owner);
        return base.lite.material;
      }
      const current = entries.get(owner);
      if (
        current !== undefined &&
        current.base === base &&
        current.lightmap === lightmap &&
        current.texture === texture &&
        current.mode === settings.mode &&
        current.gamma === settings.gamma &&
        current.uv2 === settings.uv2 &&
        current.atlas === atlas
      ) {
        const material = current.clone.value.lite.material;
        syncPbrFactors(base.lite.material, material);
        current.level = settings.level;
        if (current.isApplied) {
          setLightmapLevel(material, settings.level);
        }
        return material;
      }
      release(owner);
      const clone = base.clone(app);
      // The clone replays the declaration, so it takes the edits made to the base since it loaded.
      syncPbrFactors(base.lite.material, clone.value.lite.material);
      const entry: Entry = {
        base,
        lightmap,
        texture,
        mode: settings.mode,
        gamma: settings.gamma,
        uv2: settings.uv2,
        atlas,
        atlasKey: atlas === null ? null : lightmapAtlasWgsl(atlas),
        clone,
        level: settings.level,
        isApplied: false,
        isReleased: false,
      };
      entries.set(owner, entry);
      if (entry.atlasKey !== null) {
        placements.set(entry.atlasKey, (placements.get(entry.atlasKey) ?? 0) + 1);
        if (!hasWarnedPlacements && placements.size > LIGHTMAP_PLACEMENT_WARNING_THRESHOLD) {
          hasWarnedPlacements = true;
          app.log.warn(
            `${String(placements.size)} distinct lightmap atlas placements are in use; each compiles its own ` +
              "shader pipeline per pass, which costs load time and memory. A shared-UV approach is planned; " +
              "until then, bake UV2 that already points into the atlas and leave the entries empty.",
          );
        }
      }
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
        const options: LiteLightmapOptions = {
          level: entry.level,
          shadowmap: entry.mode === "shadowmap",
          gamma: entry.gamma,
          uv2: entry.uv2,
          atlas: entry.atlas,
        };
        if (applyLightmap(scene, material, entry.texture, options)) {
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

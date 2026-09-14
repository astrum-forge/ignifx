/**
 * The level-of-detail readout you can see: one marker hovering over each chunk, coloured by the
 * level that chunk is currently drawing.
 *
 * A terrain draws through **one** PBR material shared by every chunk, so there is no per-chunk
 * colour to tint and no wireframe switch to flip — `Terrain.lodOf(chunkX, chunkZ)` is the whole of
 * the public answer. Markers are the honest way to show it: one `InstancedMeshRenderer` per level,
 * four draw calls, and the matrices rewritten only when a chunk changes level.
 */

import { createMaterialAsset, InstancedMeshRenderer, MeshAsset, pbrMaterialDefinition, Script } from "ignifx";
import type { App, ColorLike, ScriptCallbacks, Terrain, TerrainAsset } from "ignifx";

/** One colour per level, coarsening from green to red. A terrain may declare at most this many. */
const LEVEL_COLORS: readonly ColorLike[] = [
  { r: 0.29, g: 0.78, b: 0.42, a: 1 },
  { r: 0.95, g: 0.83, b: 0.28, a: 1 },
  { r: 0.96, g: 0.55, b: 0.19, a: 1 },
  { r: 0.9, g: 0.31, b: 0.31, a: 1 },
  { r: 0.72, g: 0.36, b: 0.85, a: 1 },
  { r: 0.4, g: 0.62, b: 0.95, a: 1 },
];

/** Floats in one column-major 4x4 matrix. */
const MATRIX_FLOATS = 16;

/** The marker cube's edge, in metres. Big enough to read from the far side of a 512 m island. */
const MARKER_SIZE = 7;

/** How far above the ground under a chunk's centre a marker floats, in metres. */
const MARKER_LIFT = 16;

/** The markers over one terrain. */
export interface LodOverlay {
  /**
   * Shows or hides the markers.
   *
   * @param visible - Whether to draw them.
   */
  setVisible(visible: boolean): void;
  /** Re-reads every chunk's level and moves the markers. Cheap: one pass over the chunk grid. */
  refresh(): void;
}

/**
 * Moves the markers every frame, because `TerrainLodSystem` may have changed a level.
 *
 * @remarks
 * A `Script` rather than a system: a system registry is an extension's business, and an example
 * that needs one frame callback writes the component every ignifx game already writes.
 */
class LodMarkerRefresh extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "terrain-example/LodMarkerRefresh";

  /** What to refresh. Assigned in code: an overlay is a closure, not something a scene can carry. */
  overlay: LodOverlay | null = null;

  /** Re-reads the levels. Cheap enough to do unconditionally; the overlay skips itself when hidden. */
  update(): void {
    this.overlay?.refresh();
  }
}

/**
 * Builds the markers for a loaded terrain.
 *
 * @remarks
 * Call it **before** `app.start()`: an `InstancedMeshRenderer`'s `capacity` sizes an instance
 * buffer Babylon Lite fixes when the scene is registered, so a renderer created later would have
 * nowhere to put its matrices. The asset is passed in rather than read off the component, because
 * `Terrain.asset` is `null` until `TerrainLodSystem` has built the chunks in the first `PreRender`.
 *
 * @param app - The running app.
 * @param ground - The terrain to describe.
 * @param asset - Its loaded document, for the chunk grid.
 * @returns The overlay, hidden until {@link LodOverlay.setVisible} is called.
 */
export function createLodOverlay(app: App, ground: Terrain, asset: TerrainAsset): LodOverlay {
  const chunks = asset.definition.chunksPerSide;
  const chunkSize = asset.definition.chunks.size;
  const levels = Math.min(LEVEL_COLORS.length, asset.definition.chunks.lodLevels);
  const spacing = (asset.definition.size.width / (asset.field.resolution - 1)) * chunkSize;
  const cube = MeshAsset.box(app, { size: MARKER_SIZE });

  const renderers: InstancedMeshRenderer[] = [];
  const slabs: Float32Array[] = [];
  for (let level = 0; level < levels; level += 1) {
    const material = createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: `terrain/lod-${String(level)}`,
        baseColor: { r: 0.06, g: 0.06, b: 0.07, a: 1 },
        // Emissive, not lit: a debug marker has to read the same on the shadowed side of a hill.
        emissive: LEVEL_COLORS[level] ?? { r: 1, g: 1, b: 1, a: 1 },
        roughness: 1,
        metallic: 0,
      }),
      [],
    );
    const entity = app.world.createEntity(`LOD ${String(level)} markers`);
    renderers.push(
      entity.addComponent(InstancedMeshRenderer, {
        mesh: cube.retain(),
        materials: [material],
        capacity: chunks * chunks,
        gpuCulling: false,
        castShadows: false,
        receiveShadows: false,
      }),
    );
    slabs.push(new Float32Array(chunks * chunks * MATRIX_FLOATS));
  }
  cube.release();

  app.registerComponents([LodMarkerRefresh]);
  const refresher = app.world.createEntity("LOD marker refresh").addComponent(LodMarkerRefresh);

  let visible = false;
  const counts = new Int32Array(levels);

  /**
   * Writes one marker's world matrix into a level's slab.
   *
   * @param slab - The level's matrices.
   * @param index - Which instance to write.
   * @param x - The marker's world X.
   * @param y - The marker's world Y.
   * @param z - The marker's world Z.
   */
  function writeMarker(slab: Float32Array, index: number, x: number, y: number, z: number): void {
    const at = index * MATRIX_FLOATS;
    slab.fill(0, at, at + MATRIX_FLOATS);
    slab[at] = 1;
    slab[at + 5] = 1;
    slab[at + 10] = 1;
    slab[at + 12] = x;
    slab[at + 13] = y;
    slab[at + 14] = z;
    slab[at + 15] = 1;
  }

  const overlay: LodOverlay = {
    setVisible(next: boolean): void {
      visible = next;
      if (!next) {
        for (let level = 0; level < renderers.length; level += 1) {
          renderers[level]?.setCount(0);
        }
        return;
      }
      this.refresh();
    },

    refresh(): void {
      if (!visible) {
        return;
      }
      counts.fill(0);
      const origin = ground.transform.position;
      const half = (chunks * spacing) / 2;
      for (let chunkZ = 0; chunkZ < chunks; chunkZ += 1) {
        for (let chunkX = 0; chunkX < chunks; chunkX += 1) {
          const level = Math.min(levels - 1, Math.max(0, ground.lodOf(chunkX, chunkZ)));
          const slab = slabs[level];
          if (slab === undefined) {
            continue;
          }
          const x = origin.x - half + (chunkX + 0.5) * spacing;
          const z = origin.z - half + (chunkZ + 0.5) * spacing;
          const index = counts[level] ?? 0;
          writeMarker(slab, index, x, ground.heightAt(x, z) + MARKER_LIFT, z);
          counts[level] = index + 1;
        }
      }
      for (let level = 0; level < renderers.length; level += 1) {
        const slab = slabs[level];
        if (slab !== undefined) {
          renderers[level]?.setMatrices(slab, counts[level] ?? 0);
        }
      }
    },
  };
  refresher.overlay = overlay;
  return overlay;
}

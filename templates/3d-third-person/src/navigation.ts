import { NavMeshSurface } from "@ignifx/3d";
import { BoxCollider } from "@ignifx/physics";
import type { App } from "@ignifx/core";

/**
 * Bakes the navmesh from the level's static colliders, after the scene has loaded.
 *
 * @remarks
 * From `addSource` triangles rather than from the scene's `MeshRenderer`s: the soup is world-space
 * and known before the first frame, so the bake does not depend on anything having been uploaded
 * to the GPU, and it is the same on a machine with no GPU at all. Babylon Lite has no navmesh
 * serialization, so every bake is a runtime bake; keeping the source geometry this small is what
 * keeps that cheap.
 *
 * The soup is every `BoxCollider` on the `Level` layer — the floor slab, the wall panels and the
 * two stubs — read off the loaded scene, so a wall added to `assets/scenes/main.scene.json` is
 * walked around without touching this file. The level's colliders are axis-aligned, so a box is
 * its entity's position, the collider's `center` and half its `size`; a rotated one would need its
 * corners rotated too.
 *
 * @param app - The app the level is loaded in.
 * @param agentHeight - The tallest agent the mesh must clear, in metres.
 * @returns A promise that settles once the crowd exists.
 */
export async function bakeNavigation(app: App, agentHeight: number): Promise<void> {
  const nav = new NavSource();
  const level = app.world.layers.requireIndex("Level");
  const colliders = app.world.components(BoxCollider);
  for (const collider of colliders) {
    if (collider.entity.layer !== level) {
      continue;
    }
    const position = collider.entity.transform.position;
    const { center, size } = collider;
    nav.box(position.x + center.x, position.y + center.y, position.z + center.z, size.x / 2, size.y / 2, size.z / 2);
  }
  const surface = app.world.createEntity("Navigation").addComponent(NavMeshSurface, {
    bakeOnAwake: false,
    agentRadius: 0.4,
    agentHeight,
    agentClimb: 0.4,
    cellSize: 0.2,
    cellHeight: 0.2,
    maxAgents: 8,
  });
  const soup = nav.build();
  surface.addSource(soup.positions, soup.indices, null);
  await surface.bake();
}

/** Accumulates world-space triangles for the navmesh bake. */
class NavSource {
  readonly #positions: number[] = [];

  readonly #indices: number[] = [];

  /**
   * Adds an axis-aligned box's twelve triangles, in the winding Recast reads as "outward".
   *
   * @param cx - The centre's x.
   * @param cy - The centre's y.
   * @param cz - The centre's z.
   * @param hx - Half the width.
   * @param hy - Half the height.
   * @param hz - Half the depth.
   */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
    const base = this.#positions.length / 3;
    for (let corner = 0; corner < 8; corner += 1) {
      this.#positions.push(
        cx + ((corner & 1) === 0 ? -hx : hx),
        cy + ((corner & 2) === 0 ? -hy : hy),
        cz + ((corner & 4) === 0 ? -hz : hz),
      );
    }
    for (let index = 0; index < BOX_TRIANGLES.length; index += 1) {
      this.#indices.push(base + (BOX_TRIANGLES[index] ?? 0));
    }
  }

  /**
   * Freezes the accumulated soup into the typed arrays Recast reads.
   *
   * @returns The positions and the indices.
   */
  build(): { readonly positions: Float32Array; readonly indices: Uint32Array } {
    return { positions: Float32Array.from(this.#positions), indices: Uint32Array.from(this.#indices) };
  }
}

/**
 * The twelve triangles of a box, indexing the eight corners {@link NavSource.box} emits: corner
 * `c` is `-x` unless bit 0 is set, `-y` unless bit 1 is set, `-z` unless bit 2 is set.
 *
 * The winding is **clockwise seen from outside**, which is what Babylon Lite's Recast bridge reads
 * as an outward normal — its own documented example, a floor quad wound
 * `(-x,-z) (+x,-z) (+x,+z) (-x,+z)` with indices `0 1 2 / 0 2 3`, has a cross product pointing at
 * `-y` and still bakes as walkable ground. A box wound the other way makes every face point inward,
 * Recast finds no walkable triangle at all, and `createNavMesh` fails outright rather than
 * returning an empty mesh. That is worth stating here because it is the one thing about
 * `addSource` that a caller cannot guess.
 */
const BOX_TRIANGLES: readonly number[] = Object.freeze([
  0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6, 0, 2, 4, 2, 6, 4, 1, 5, 3, 3, 5, 7,
]);

import { MESH_ASSET_TYPE, MeshAsset } from "@ignifx/core";
import type { App, AssetHandle } from "@ignifx/core";

/**
 * The primitive meshes `assets/scenes/main.scene.json` draws with, published at the addresses the
 * file names (`{ "$asset": "meshes/crate", "type": "mesh" }`).
 *
 * ## Why this is code and not a file
 *
 * ignifx has no mesh file format: a primitive is built by `MeshAsset.box` and friends, and the
 * handle they return lives at a `memory:` address that a scene file cannot name (the serializer
 * writes such a reference as `null`). Publishing each primitive a second time, at a plain address,
 * is what lets the scene refer to it. It has to happen **before** `app.world.loadScene`, because the
 * loader resolves every `$asset` in the file before it builds a single entity, and core's `mesh`
 * loader refuses any address that is not already in the cache.
 *
 * ## Why the walls are panels rather than four long boxes
 *
 * `MeshAsset.box` gives every face the unit UV square, so a single 24 by 3 metre wall would stretch
 * one 128-pixel texture over 24 metres. Six 4-metre panels share **one** mesh and one material
 * instead, so the texture reads at its authored density.
 */

/** A primitive to build, and the address the scene file names it by. */
interface LevelMesh {
  /** The address the scene file names. */
  readonly address: string;
  /** Builds the primitive. */
  readonly build: (app: App) => AssetHandle<MeshAsset>;
}

/** Half the courtyard, in metres: the floor spans `[-12, 12]` on both axes. */
const ARENA_HALF = 12;

/** How tall a wall panel is, in metres. */
const WALL_HEIGHT = 3;

/** How thick a wall panel is, in metres. */
const WALL_THICKNESS = 0.5;

/** How wide one wall panel is, in metres. */
const PANEL_WIDTH = 4;

/** How tall a beacon's column is, in metres. */
const BEACON_HEIGHT = 2.4;

/** Every primitive the scene uses. */
const LEVEL_MESHES: readonly LevelMesh[] = Object.freeze([
  // An inverted sphere with an unlit gradient: `Environment.skybox` wants a `.dds` or `.env` cube
  // map, which cannot be generated from arithmetic the way every other asset here is
  // (CONSTITUTION.md §11.3). Inside the camera's 200 m far plane.
  { address: "meshes/sky", build: (app: App) => MeshAsset.sphere(app, { diameter: 180, segments: 24 }) },
  // `uvScale` is why the 128-pixel slab texture is not smeared across 24 metres: one tile covers
  // about two and a half metres.
  {
    address: "meshes/floor",
    build: (app: App) =>
      MeshAsset.ground(app, { width: ARENA_HALF * 2, height: ARENA_HALF * 2, subdivisions: 1, uvScale: [10, 10] }),
  },
  {
    address: "meshes/wall-x",
    build: (app: App) => MeshAsset.box(app, { width: PANEL_WIDTH, height: WALL_HEIGHT, depth: WALL_THICKNESS }),
  },
  {
    address: "meshes/wall-z",
    build: (app: App) => MeshAsset.box(app, { width: WALL_THICKNESS, height: WALL_HEIGHT, depth: PANEL_WIDTH }),
  },
  { address: "meshes/crate", build: (app: App) => MeshAsset.box(app, { size: 1 }) },
  { address: "meshes/beacon-base", build: (app: App) => MeshAsset.box(app, { width: 0.8, height: 0.25, depth: 0.8 }) },
  {
    address: "meshes/beacon-column",
    build: (app: App) => MeshAsset.cylinder(app, { diameter: 0.28, height: BEACON_HEIGHT }),
  },
]);

/**
 * Builds every primitive the level draws with and publishes it at the address the scene file
 * names. Call it once, after `createApp` and before `app.world.loadScene`.
 *
 * @remarks
 * Both handles of each mesh — the factory's `memory:` one and the named one — keep their hold for
 * the life of the app, as the level's meshes always have: a component field takes no reference of
 * its own, and releasing either handle would let the collector dispose the shared mesh.
 *
 * @param app - The app whose asset service the meshes are published in.
 */
export function publishLevelMeshes(app: App): void {
  for (const mesh of LEVEL_MESHES) {
    const built = mesh.build(app);
    app.assets.register(built.value, { type: MESH_ASSET_TYPE, address: mesh.address });
  }
}

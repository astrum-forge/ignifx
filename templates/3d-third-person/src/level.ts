import { Light, MeshAsset, MeshRenderer } from "@ignifx/core";
import { BoxCollider, Rigidbody } from "@ignifx/physics";
import { Beacon } from "./scripts/beacon.js";
import type { App, AssetHandle, Entity, MaterialAsset } from "@ignifx/core";

/**
 * The courtyard: a floor, a ring of wall panels, two interior stubs for the camera to collide
 * with, and a handful of pushable crates.
 *
 * ## Why the walls are panels rather than four long boxes
 *
 * `MeshAsset.box` gives every face the unit UV square, so a single 24 by 3 metre wall would stretch
 * one 128-pixel texture over 24 metres. Six 4-metre panels share **one** mesh and one material
 * instead, so the texture reads at its authored density, the draw calls stay in the same range, and
 * each panel is its own collider — which is also what lets the navmesh bake carve the ring out.
 *
 * ## Why the crate placement is seeded
 *
 * `?static=1` has to produce the same picture on every run and on every machine. A seeded generator
 * is the cheapest way to have scattered-looking props that are nevertheless in exactly the same
 * place in the golden as they were when it was taken.
 */

/** Half the courtyard, in metres: the floor spans `[-12, 12]` on both axes. */
export const ARENA_HALF = 12;

/** How tall the perimeter is, in metres. */
const WALL_HEIGHT = 3;

/** How thick a wall panel is, in metres. */
const WALL_THICKNESS = 0.5;

/** How wide one wall panel is, in metres. `ARENA_HALF * 2` divided by this must be a whole number. */
const PANEL_WIDTH = 4;

/** The edge of a crate, in metres. */
const CRATE_SIZE = 1;

/** How many crates are scattered. */
const CRATE_COUNT = 6;

/** The seed the crate scatter uses, so the authored scene is the same on every run. */
const CRATE_SEED = 0x1f35_a7c1;

/**
 * Where the three beacons stand, in metres.
 *
 * Hand-placed at a radius of about ten, which is outside the 4.5-to-8.5 ring the crates scatter in
 * and inside the twelve-metre wall — so a beacon never lands on a crate, and all three are in front
 * of the `?static=1` camera, which looks down `+z` from `z = -10.5`.
 */
const BEACONS: readonly (readonly [number, number])[] = Object.freeze([
  [-9.5, 3],
  [9.5, 3],
  [0, 10],
]);

/** How wide a beacon's base is, in metres. */
const BEACON_BASE = 0.8;

/** How tall a lit beacon's column is, in metres. */
const BEACON_HEIGHT = 2.4;

/** How far away the sky sphere is, in metres. Inside the camera's 200 m far plane. */
const SKY_DIAMETER = 180;

/** The materials a level is built from. */
export interface LevelMaterials {
  /** The floor slab. */
  readonly floor: AssetHandle<MaterialAsset>;
  /** The perimeter and the interior stubs. */
  readonly wall: AssetHandle<MaterialAsset>;
  /** The pushable crates. */
  readonly crate: AssetHandle<MaterialAsset>;
  /** The unlit gradient drawn on the inside of the sky sphere. */
  readonly sky: AssetHandle<MaterialAsset>;
  /** The glowing column of a lit beacon. */
  readonly emissive: AssetHandle<MaterialAsset>;
}

/** What {@link buildLevel} produced. */
export interface Level {
  /** World-space triangle soup for `NavMeshSurface.addSource`, in Recast's flat layout. */
  readonly navPositions: Float32Array;
  /** The indices into {@link Level.navPositions}. */
  readonly navIndices: Uint32Array;
  /** The crates, so the HUD can count the ones still standing. */
  readonly crates: readonly Entity[];
  /** The sun, so the settings screen can turn its shadows off. */
  readonly sun: Light;
  /** The beacons, which are what the run's progress is counted in. */
  readonly beacons: readonly Beacon[];
}

/**
 * A tiny deterministic generator, so a regenerated scene is the scene the golden was taken of.
 *
 * @param seed - The starting state.
 * @returns A function returning the next value in `[0, 1)`.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
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

/** One shared wall mesh and the half-extents that go with it. */
interface Panel {
  /** The mesh every panel of this orientation shares. */
  readonly mesh: AssetHandle<MeshAsset>;
  /** Half the panel's width along x. */
  readonly halfX: number;
  /** Half the panel's depth along z. */
  readonly halfZ: number;
}

/**
 * Adds one wall panel: a mesh instance, a static collider, and a box in the navigation soup.
 *
 * @param app - The running app.
 * @param panel - The shared mesh and its half-extents.
 * @param material - The wall material.
 * @param nav - The navigation soup being accumulated.
 * @param name - The entity name.
 * @param x - The panel centre's x.
 * @param z - The panel centre's z.
 */
function addPanel(
  app: App,
  panel: Panel,
  material: AssetHandle<MaterialAsset>,
  nav: NavSource,
  name: string,
  x: number,
  z: number,
): void {
  const entity = app.world.createEntity(name, { position: { x, y: WALL_HEIGHT / 2, z } });
  entity.layer = app.world.layers.requireIndex("Level");
  entity.addComponent(MeshRenderer, {
    mesh: panel.mesh.retain(),
    materials: [material.retain()],
    castShadows: true,
    receiveShadows: true,
  });
  // No `Rigidbody`: a collider on its own is placed once as an implicit static body, which is
  // exactly right for scenery that never moves (`IGX-0901` is what a moving one would report).
  entity.addComponent(BoxCollider, { size: { x: panel.halfX * 2, y: WALL_HEIGHT, z: panel.halfZ * 2 } });
  nav.box(x, WALL_HEIGHT / 2, z, panel.halfX, WALL_HEIGHT / 2, panel.halfZ);
}

/**
 * Builds the whole level.
 *
 * @param app - The running app.
 * @param materials - The three materials the level is drawn with.
 * @returns The navigation geometry and the crates.
 */
export function buildLevel(app: App, materials: LevelMaterials): Level {
  const levelLayer = app.world.layers.requireIndex("Level");
  const propLayer = app.world.layers.requireIndex("Prop");
  const nav = new NavSource();

  // The sky: one inverted sphere with an unlit gradient. `Environment.skybox` wants a `.dds` or
  // `.env` cube map, which cannot be generated from arithmetic the way every other asset in this
  // repository is (CONSTITUTION.md §11.3) — a big sphere with `unlit` and `doubleSided` on gives
  // the same horizon for one draw call and one 2 KB PNG.
  const skyMesh = MeshAsset.sphere(app, { diameter: SKY_DIAMETER, segments: 24 });
  const sky = app.world.createEntity("Sky");
  sky.addComponent(MeshRenderer, {
    mesh: skyMesh.retain(),
    materials: [materials.sky.retain()],
    castShadows: false,
    receiveShadows: false,
  });
  skyMesh.release();

  const sun = app.world.createEntity("Sun", { position: { x: -8, y: 14, z: -6 } });
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, { type: "directional", intensity: 2.9 });
  light.shadows.enabled = true;
  // ESM, not PCF: Babylon Lite can rebuild ESM shadow maps after a lost device (`lib/shadow/shadow-recovery.js`
  // refuses every other technique), and a desktop build must survive a GPU reset (Phase 9).
  light.shadows.technique = "esm";
  light.shadows.mapSize = 1024;
  light.shadows.normalBias = 0.02;

  app.world.createEntity("Fill").addComponent(Light, {
    type: "hemispheric",
    intensity: 0.45,
    color: { r: 0.72, g: 0.79, b: 1, a: 1 },
  });

  const floor = app.world.createEntity("Floor");
  floor.layer = levelLayer;
  floor.addComponent(MeshRenderer, {
    // `uvScale` is why the 128-pixel slab texture is not smeared across 24 metres: the ground's
    // UVs are multiplied so one tile covers about two and a half metres.
    mesh: MeshAsset.ground(app, { width: ARENA_HALF * 2, height: ARENA_HALF * 2, subdivisions: 1, uvScale: [10, 10] }),
    materials: [materials.floor.retain()],
    castShadows: false,
    receiveShadows: true,
  });
  // A slab rather than an infinite plane: Havok has no plane shape in this build, and a thick box
  // is what stops a fast faller tunnelling through.
  floor.addComponent(BoxCollider, {
    size: { x: ARENA_HALF * 2, y: 1, z: ARENA_HALF * 2 },
    center: { x: 0, y: -0.5, z: 0 },
  });
  nav.box(0, -0.5, 0, ARENA_HALF, 0.5, ARENA_HALF);

  const alongX: Panel = {
    mesh: MeshAsset.box(app, { width: PANEL_WIDTH, height: WALL_HEIGHT, depth: WALL_THICKNESS }),
    halfX: PANEL_WIDTH / 2,
    halfZ: WALL_THICKNESS / 2,
  };
  const alongZ: Panel = {
    mesh: MeshAsset.box(app, { width: WALL_THICKNESS, height: WALL_HEIGHT, depth: PANEL_WIDTH }),
    halfX: WALL_THICKNESS / 2,
    halfZ: PANEL_WIDTH / 2,
  };
  const perSide = (ARENA_HALF * 2) / PANEL_WIDTH;
  for (let index = 0; index < perSide; index += 1) {
    const offset = -ARENA_HALF + PANEL_WIDTH / 2 + index * PANEL_WIDTH;
    addPanel(app, alongX, materials.wall, nav, `Wall N${String(index)}`, offset, -ARENA_HALF);
    addPanel(app, alongX, materials.wall, nav, `Wall S${String(index)}`, offset, ARENA_HALF);
    addPanel(app, alongZ, materials.wall, nav, `Wall W${String(index)}`, -ARENA_HALF, offset);
    addPanel(app, alongZ, materials.wall, nav, `Wall E${String(index)}`, ARENA_HALF, offset);
  }
  // The two interior stubs. They are what the third-person camera's boom collides with when the
  // player backs into the corner they make, and what the companion's path has to walk around.
  addPanel(app, alongX, materials.wall, nav, "Stub A", -2, 3);
  addPanel(app, alongZ, materials.wall, nav, "Stub B", -4, 5);
  // The handles the two shared meshes were created with; every panel took its own reference.
  alongX.mesh.release();
  alongZ.mesh.release();

  const crateMesh = MeshAsset.box(app, { size: CRATE_SIZE });
  const random = rng(CRATE_SEED);
  const crates: Entity[] = [];
  for (let index = 0; index < CRATE_COUNT; index += 1) {
    const angle = random() * Math.PI * 2;
    // The ring starts outside the player's spawn, so no crate ever lands on the character.
    const radius = 4.5 + random() * 4;
    const crate = app.world.createEntity(`Crate ${String(index)}`, {
      position: {
        x: Math.cos(angle) * radius,
        // Exactly half a crate above the slab, so nothing has to fall before the frame is honest:
        // that is what makes `?static=1` show a settled scene without a single fixed step.
        y: CRATE_SIZE / 2,
        z: Math.sin(angle) * radius,
      },
    });
    crate.layer = propLayer;
    crate.transform.localEulerAngles = { x: 0, y: random() * 90, z: 0 };
    crate.addComponent(MeshRenderer, {
      mesh: crateMesh.retain(),
      materials: [materials.crate.retain()],
      castShadows: true,
      receiveShadows: true,
    });
    crate.addComponent(BoxCollider, { size: { x: CRATE_SIZE, y: CRATE_SIZE, z: CRATE_SIZE } });
    crate.addComponent(Rigidbody, { mass: 12 });
    crates.push(crate);
  }
  crateMesh.release();

  // The beacons. Each is a dark base with an emissive column that is hidden until the player
  // reaches it; `src/scripts/beacon.ts` explains why the reach test is a distance and not a
  // trigger volume.
  const baseMesh = MeshAsset.box(app, { width: BEACON_BASE, height: 0.25, depth: BEACON_BASE });
  const columnMesh = MeshAsset.cylinder(app, { diameter: 0.28, height: BEACON_HEIGHT });
  const beacons: Beacon[] = [];
  for (let index = 0; index < BEACONS.length; index += 1) {
    const spot = BEACONS[index];
    if (spot === undefined) {
      continue;
    }
    const entity = app.world.createEntity(`Beacon ${String(index)}`, {
      position: { x: spot[0], y: 0.125, z: spot[1] },
    });
    entity.layer = propLayer;
    entity.addComponent(MeshRenderer, {
      mesh: baseMesh.retain(),
      materials: [materials.wall.retain()],
      castShadows: true,
      receiveShadows: true,
    });
    // Two columns in the same place, one dark and one emissive, and exactly one of them enabled.
    // A `MeshRenderer` has no tint, and swapping a material list at run time rebuilds the renderer;
    // two renderers and a boolean is the cheaper and clearer way to say "this one is lit".
    const dark = app.world.createEntity(`Beacon ${String(index)} Column`, { parent: entity });
    dark.transform.localPosition.set(0, BEACON_HEIGHT / 2 + 0.125, 0);
    const darkRenderer = dark.addComponent(MeshRenderer, {
      mesh: columnMesh.retain(),
      materials: [materials.wall.retain()],
      castShadows: true,
      receiveShadows: true,
    });
    const column = app.world.createEntity(`Beacon ${String(index)} Light`, { parent: entity });
    column.transform.localPosition.set(0, BEACON_HEIGHT / 2 + 0.125, 0);
    const renderer = column.addComponent(MeshRenderer, {
      mesh: columnMesh.retain(),
      materials: [materials.emissive.retain()],
      castShadows: false,
      receiveShadows: false,
    });
    const beacon = entity.addComponent(Beacon);
    beacon.column = renderer;
    beacon.unlitColumn = darkRenderer;
    beacon.setLit(false);
    beacons.push(beacon);
  }
  baseMesh.release();
  columnMesh.release();

  const soup = nav.build();
  return { navPositions: soup.positions, navIndices: soup.indices, crates, sun: light, beacons };
}

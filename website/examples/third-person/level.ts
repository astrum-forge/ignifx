import { BoxCollider, createMaterialAsset, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "ignifx";
import type { App, AssetHandle } from "ignifx";

/**
 * The little level the character walks in: a walled yard, a doorway through the wall across it, and
 * one interior corner.
 *
 * It is here rather than in `main.ts` because none of it is the lesson. Every wall is the same
 * four lines — a box mesh, the shared material, a `MeshRenderer` and a `BoxCollider` — and the only
 * thing that matters about them is that they are on the **`Level` layer**, because that is the
 * layer the camera's boom sweeps against in `main.ts`.
 *
 * ## Why the yard is closed and the doorway is interior
 *
 * The floor is finite, so the perimeter is solid: a doorway in the *outer* wall is a hole in the
 * world, and a character that walks through it falls for ever. The doorway is therefore in a wall
 * across the middle of the yard, which is also where a doorway is interesting — it is the thing the
 * camera's boom has to pass through behind you.
 *
 * ## Why a collider with no `Rigidbody`
 *
 * A collider on its own is placed once as an implicit **static** body, which is exactly right for
 * scenery that never moves. Moving one afterwards reports `IGX-0901`; anything that has to move
 * needs a kinematic `Rigidbody` as well.
 *
 * ## Why a mesh per wall rather than one scaled box
 *
 * The physics runtime multiplies a collider's size by its entity's scale, so a shared unit box
 * under a scaled transform needs a unit collider and reads as a puzzle. Eight `MeshAsset.box`
 * calls are cheaper to understand and cost one template each.
 */

/** How tall every wall is, in metres: over the character's head, so the camera cannot see past it. */
const WALL_HEIGHT = 2.6;

/** How thick every wall is, in metres. */
const WALL_THICKNESS = 0.4;

/**
 * The colour above the walls.
 *
 * @remarks
 * `rendering.clearColor` reaches a linear target, so a component lands on the frame at about
 * `255 * value ** 2.2` — measured on this scene at 1280x720, where `0.8` came back as byte 154 and
 * `0.1` as byte 3. These three therefore render as `#1B212A`, the site's dark `--sunk`
 * (`02-design-system.md` §2.3), which is what makes the sky read as dusk rather than as a hole.
 */
export const SKY = { r: 0.36, g: 0.395, b: 0.44, a: 1 } as const;

/** The yard's half-width, in metres: the perimeter stands at ±{@link YARD_HALF} on both axes. */
export const YARD_HALF = 11;

/**
 * The edge length of the plane the kit draws under everything, in metres.
 *
 * @remarks
 * Far larger than the yard, and deliberately: the camera looks over the perimeter from above, and a
 * ground plane that ended a few metres past the wall would show its own edge as a line in the sky.
 * Only {@link YARD_HALF}'s square is walkable — the perimeter is what keeps the character on it.
 */
export const GROUND_SIZE = 60;

/** Half the doorway's width, in metres. Narrow enough to have to aim at. */
const DOOR_HALF = 1.1;

/** How thick the floor slab is, in metres. Sunk, so its top face is exactly `y = 0`. */
const FLOOR_DEPTH = 1;

/** Where the wall across the yard stands, in metres along z. */
const DIVIDER_Z = 5;

/** How far the floor slab reaches past the perimeter, in metres. See {@link buildLevel}. */
const FLOOR_APRON = 2;

/** One wall: where its centre is and how big it is, both in metres. */
interface Wall {
  /** The centre's x. */
  readonly x: number;
  /** The centre's z. */
  readonly z: number;
  /** The size along x. */
  readonly width: number;
  /** The size along z. */
  readonly depth: number;
}

/**
 * Every wall in the yard, in metres.
 *
 * @remarks
 * Four make the perimeter, two more are the wall across the middle with the doorway between them,
 * and the last two meet at an interior corner behind the character's spawn — which is what there
 * is to back the camera into.
 */
const WALLS: readonly Wall[] = Object.freeze([
  // The perimeter: four solid sides, so the walkable square has no way out of it.
  { x: 0, z: -YARD_HALF, width: YARD_HALF * 2, depth: WALL_THICKNESS },
  { x: 0, z: YARD_HALF, width: YARD_HALF * 2, depth: WALL_THICKNESS },
  // The two returns stop short of the other pair rather than crossing them: two static boxes that
  // overlap give the corner between them two contact normals, and a capsule wedged into that corner
  // is depenetrated along their sum — which points out of the level.
  { x: -YARD_HALF, z: 0, width: WALL_THICKNESS, depth: YARD_HALF * 2 - WALL_THICKNESS * 2 },
  { x: YARD_HALF, z: 0, width: WALL_THICKNESS, depth: YARD_HALF * 2 - WALL_THICKNESS * 2 },
  // The wall across the yard, split by the doorway.
  { x: -(YARD_HALF + DOOR_HALF) / 2, z: DIVIDER_Z, width: YARD_HALF - DOOR_HALF, depth: WALL_THICKNESS },
  { x: (YARD_HALF + DOOR_HALF) / 2, z: DIVIDER_Z, width: YARD_HALF - DOOR_HALF, depth: WALL_THICKNESS },
  // The interior corner: two stubs that meet, and the thing the boom shortens against.
  { x: -3, z: -2.4, width: 5.2, depth: WALL_THICKNESS },
  { x: -5.4, z: -0.4, width: WALL_THICKNESS, depth: 4.4 },
]);

/**
 * Builds the walls, all of them on the `Level` layer.
 *
 * @remarks
 * The mesh and material handles stay held for the page's lifetime, which is what level geometry
 * wants: nothing here is ever swapped, so there is no release to call and no bookkeeping to read.
 *
 * @param app - The running app; needs `physics()` for the colliders.
 * @param layer - The layer index the floor and every wall is tagged with.
 *
 * @example
 * ```ts
 * buildLevel(app, app.world.layers.requireIndex("Level"));
 * ```
 */
export function buildLevel(app: App, layer: number): void {
  // The floor the kit drew is a `MeshRenderer` and nothing else, so the level owns what the
  // character stands on. A thick slab rather than a plane: Havok has no plane shape in this build,
  // and depth is what stops a fast faller tunnelling through. It reaches FLOOR_APRON metres *past*
  // the perimeter, because a capsule pressed into a wall is depenetrated by a few centimetres and a
  // floor that stopped at the wall would let it step off the edge of the world.
  const reach = YARD_HALF + FLOOR_APRON;
  const floor = app.world.createEntity("Floor Collider", { position: { x: 0, y: -FLOOR_DEPTH / 2, z: 0 } });
  floor.layer = layer;
  floor.addComponent(BoxCollider, { size: { x: reach * 2, y: FLOOR_DEPTH, z: reach * 2 } });

  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "third-person/wall",
      baseColor: { r: 0.36, g: 0.38, b: 0.44, a: 1 },
      metallic: 0,
      roughness: 0.85,
    }),
    [],
  );
  for (let index = 0; index < WALLS.length; index += 1) {
    const wall = WALLS[index];
    if (wall === undefined) {
      continue;
    }
    const mesh: AssetHandle<MeshAsset> = MeshAsset.box(app, {
      width: wall.width,
      height: WALL_HEIGHT,
      depth: wall.depth,
    });
    const entity = app.world.createEntity(`Wall ${String(index)}`, {
      position: { x: wall.x, y: WALL_HEIGHT / 2, z: wall.z },
    });
    entity.layer = layer;
    entity.addComponent(MeshRenderer, {
      mesh,
      materials: [material.retain()],
      castShadows: true,
      receiveShadows: true,
    });
    entity.addComponent(BoxCollider, { size: { x: wall.width, y: WALL_HEIGHT, z: wall.depth } });
  }
}

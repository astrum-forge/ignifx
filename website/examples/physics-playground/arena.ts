/**
 * The playground's staging: the pit the bodies fall into, and the pile they start settled in.
 *
 * It is next to `main.ts` rather than in it for the reason `pbr-model`'s `shot.ts` is: none of it
 * is a lesson about ignifx. The floor's half-extent, the height of the kerb and the exact centre of
 * every crate in the opening pyramid are composition, and `main.ts` is easier to read as physics
 * without them.
 *
 * ## Why the opening pile is a table of exact numbers
 *
 * `?static=1` stops the clock **before** `app.start()`, so no fixed step ever runs and no body ever
 * falls: the poster and the golden are exactly the transforms authored here. A 0.6 m crate resting
 * on the floor has its centre at 0.3 m, the row above it at 0.9 m, and the row above that at 1.5 m
 * — so the pyramid below is a settled pile by construction, not by simulation, and it is the same
 * pile whether or not the clock is running. Every body in it is created `startAsleep`, which is
 * what Havok would do to it a third of a second later anyway.
 */

import { BoxCollider, MeshAsset, MeshRenderer } from "ignifx";
import { createGridGround } from "../_kit/stage.ts";
import type { App, AssetHandle, ColorLike, Entity, MaterialAsset } from "ignifx";

/** Half the pit's inner width, in metres: the floor a body can land on spans `[-4.5, 4.5]`. */
export const ARENA_HALF = 4.5;

/** The visible ground plane's edge length, in metres. Wider than the pit, so it runs out of frame. */
const GROUND_SIZE = 80;

/** How high the kerb around the pit stands, in metres. */
const KERB_HEIGHT = 0.5;

/** How thick the kerb is, in metres. */
const KERB_THICKNESS = 0.4;

/** How deep the floor's collision box is, in metres. Its top face sits at `y = 0`. */
const FLOOR_DEPTH = 1;

/** The edge of a crate, in metres. */
export const BOX_SIZE = 0.6;

/** A ball's radius, in metres. */
export const SPHERE_RADIUS = 0.35;

/** A capsule's radius, in metres. */
export const CAPSULE_RADIUS = 0.28;

/**
 * A capsule's total height, caps included, in metres — the convention both the mesh factory and the
 * collider use, so one pair of numbers describes the drawing and the shape.
 */
export const CAPSULE_HEIGHT = 1.1;

/** The three shapes the playground drops, in the order the panel lists them. */
export const SHAPES = ["Box", "Sphere", "Capsule"] as const;

/** One of {@link SHAPES}. */
export type ShapeName = (typeof SHAPES)[number];

/** A three-component point, in metres or in degrees. */
export interface Triple {
  /** X. */
  readonly x: number;
  /** Y. */
  readonly y: number;
  /** Z. */
  readonly z: number;
}

/** One body of the opening pile. */
export interface PiledBody {
  /** Which shape to build. */
  readonly shape: ShapeName;
  /** Where its centre sits, in metres. */
  readonly at: Triple;
  /** Its Euler angles, in degrees. Omitted means axis-aligned. */
  readonly turn?: Triple;
}

/**
 * The opening pile: a three-two-one pyramid of crates, two balls, and a capsule on its side.
 *
 * @remarks
 * Every height is the shape's own resting height, so the pile is settled the instant it exists —
 * see the module comment. The horizontal placements are hand-picked rather than scattered, because
 * a poster is a composition and a seeded scatter is only reproducible, not good.
 */
export const PILE: readonly PiledBody[] = Object.freeze([
  { shape: "Box", at: { x: -BOX_SIZE, y: BOX_SIZE / 2, z: 0 } },
  { shape: "Box", at: { x: 0, y: BOX_SIZE / 2, z: 0 } },
  { shape: "Box", at: { x: BOX_SIZE, y: BOX_SIZE / 2, z: 0 } },
  { shape: "Box", at: { x: -BOX_SIZE / 2, y: BOX_SIZE * 1.5, z: 0 } },
  { shape: "Box", at: { x: BOX_SIZE / 2, y: BOX_SIZE * 1.5, z: 0 } },
  { shape: "Box", at: { x: 0, y: BOX_SIZE * 2.5, z: 0 } },
  // A second, lower stack, so the pit reads as a pile rather than as one tidy monument.
  { shape: "Box", at: { x: -2.1, y: BOX_SIZE / 2, z: -1.35 } },
  { shape: "Box", at: { x: -2.1, y: BOX_SIZE * 1.5, z: -1.35 }, turn: { x: 0, y: 18, z: 0 } },
  { shape: "Sphere", at: { x: -1.5, y: SPHERE_RADIUS, z: 0.95 } },
  { shape: "Sphere", at: { x: 1.35, y: SPHERE_RADIUS, z: -1.25 } },
  { shape: "Sphere", at: { x: 0.55, y: SPHERE_RADIUS, z: 1.75 } },
  // Rolled onto its side: the mesh and the collider both stand along Y, so turning the entity a
  // quarter turn about X lays the drawing and the shape down together.
  { shape: "Capsule", at: { x: 1.55, y: CAPSULE_RADIUS, z: 1.15 }, turn: { x: 90, y: 0, z: 0 } },
  { shape: "Capsule", at: { x: -0.95, y: CAPSULE_RADIUS, z: -1.9 }, turn: { x: 90, y: 55, z: 0 } },
  // One left standing on a cap: stable while it is asleep, and the first thing a landing crate
  // knocks over.
  { shape: "Capsule", at: { x: 2.15, y: CAPSULE_HEIGHT / 2, z: 0.55 } },
]);

/** The meshes and materials the arena is built from; `main.ts` owns their lifetimes. */
export interface ArenaLook {
  /** The kerb's material. */
  readonly kerb: AssetHandle<MaterialAsset>;
  /** The tint the grid floor is given. */
  readonly floor: ColorLike;
}

/** What {@link buildArena} produced. */
export interface Arena {
  /** The floor entity, which also carries the floor's static collider. */
  readonly ground: Entity;
  /** Releases every handle the arena holds. */
  release(): void;
}

/**
 * Builds the pit: a grid floor with a static box under it, and four kerbs to keep the bodies in.
 *
 * @remarks
 * A collider with no `Rigidbody` is placed once as a **static** body, which is exactly right for
 * scenery — and moving it afterwards would log `IGX-0901`. The floor's box is sunk by half its
 * depth through the collider's own `center`, so its top face is the `y = 0` the pile is authored
 * against and the entity's transform stays at the origin.
 *
 * @param app - The running app.
 * @param look - The kerb material and the floor's tint.
 * @returns The floor entity and the release for the handles this created.
 */
export async function buildArena(app: App, look: ArenaLook): Promise<Arena> {
  const ground = await createGridGround(app, { size: GROUND_SIZE, color: look.floor });
  ground.entity.addComponent(BoxCollider, {
    size: { x: GROUND_SIZE, y: FLOOR_DEPTH, z: GROUND_SIZE },
    center: { x: 0, y: -FLOOR_DEPTH / 2, z: 0 },
  });

  // One mesh for four kerbs: two of them are the same box turned a quarter turn about Y, and a
  // collider is authored in local units, so it turns with the entity and needs no second size.
  const span = ARENA_HALF * 2 + KERB_THICKNESS * 2;
  const kerbMesh = MeshAsset.box(app, { width: span, height: KERB_HEIGHT, depth: KERB_THICKNESS });
  const offset = ARENA_HALF + KERB_THICKNESS / 2;
  const kerbs: readonly { readonly x: number; readonly z: number; readonly turn: number }[] = [
    { x: 0, z: offset, turn: 0 },
    { x: 0, z: -offset, turn: 0 },
    { x: offset, z: 0, turn: 90 },
    { x: -offset, z: 0, turn: 90 },
  ];
  for (const [index, kerb] of kerbs.entries()) {
    const entity = app.world.createEntity(`Kerb ${String(index + 1)}`);
    entity.transform.localPosition.set(kerb.x, KERB_HEIGHT / 2, kerb.z);
    entity.transform.localEulerAngles = { x: 0, y: kerb.turn, z: 0 };
    entity.addComponent(MeshRenderer, { mesh: kerbMesh, materials: [look.kerb], castShadows: true });
    entity.addComponent(BoxCollider, { size: { x: span, y: KERB_HEIGHT, z: KERB_THICKNESS } });
  }

  return {
    ground: ground.entity,
    release(): void {
      kerbMesh.release();
      ground.release();
    },
  };
}

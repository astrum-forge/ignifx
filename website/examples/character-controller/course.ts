/**
 * The course the capsule is asked to walk: two ramps whose angles are exact by construction, and
 * the plateau one of them reaches.
 *
 * It is next to `main.ts` for the reason `pbr-model`'s `shot.ts` is: the character controller is the
 * lesson and the level is composition. But one thing in here *is* load-bearing, and it is why this
 * file exists at all: **the site says the ramps are 30° and 60°, so they have to be 30° and 60°.**
 *
 * ## How a ramp is placed
 *
 * A ramp is a box turned about X. Rather than guess a rotation and a centre, {@link addRamp} is
 * given the angle, the height to climb, and where the *high* edge of the walkable surface should
 * sit, and it solves for the rest:
 *
 * - the horizontal run is `rise / tan(angle)`, so the surface really does rise at `angle`;
 * - the box's length along the slope is `rise / sin(angle)`;
 * - the top surface's normal after a rotation of `-angle` about X is `(0, cos a, -sin a)`, so the
 *   box's centre is the surface's midpoint pushed half a thickness *down* that normal.
 *
 * A rotation of `-angle` — not `+angle` — because ignifx is left-handed with `+Z` forward: about X,
 * `y' = y·cos a - z·sin a`, so a positive angle tips `+Z` **down**.
 *
 * ## There is no kerb, and that is a finding rather than an omission
 *
 * A `CharacterController` cannot climb a step. Babylon Lite 1.27.0's
 * `PhysicsCharacterControllerOptions` is two numbers — `capsuleHeight` and `capsuleRadius` — and its
 * `PhysicsCharacterController` carries no step height and no auto-step at all (read off the pinned
 * `index.d.ts`, 2026-09-08). Collide-and-slide against a vertical face gives a capsule nothing to
 * climb with, and a 0.28 m kerb stopped this one dead: measured the same day, it walked to
 * `z = -3.99` — the kerb's face plus its radius and its skin width — and stayed there.
 *
 * A kerb built as a 20° hump instead of a step does not work either, at this capsule's size: the
 * crest is a ridge two 0.4 m slabs meet at, the 0.35 m capsule touches the far slab before its
 * lowest point crosses the ridge, and Havok resolves that contact as a wall. Measured the same day:
 * `Standing yes, slope 20°`, and the capsule sat on the ridge indefinitely.
 *
 * So the course has no kerb. The site's copy says so too.
 */

import { BoxCollider, degToRad, MeshAsset, MeshRenderer } from "ignifx";
import { createGridGround } from "../_kit/stage.ts";
import type { App, AssetHandle, ColorLike, MaterialAsset } from "ignifx";

/** The visible ground plane's edge length, in metres. Wide enough to run out of every frame. */
const GROUND_SIZE = 140;

/** How deep the floor's collision box is, in metres. Its top face sits at `y = 0`. */
const FLOOR_DEPTH = 1;

/** How thick a ramp is, in metres. */
const RAMP_THICKNESS = 0.4;

/** The gentle ramp's angle, in degrees. Inside the controller's opening 45° slope limit. */
export const GENTLE_DEGREES = 30;

/** The steep ramp's angle, in degrees. Outside it. */
export const STEEP_DEGREES = 60;

/** How high both ramps climb, in metres. */
export const RISE = 1.6;

/** How wide each ramp lane is, in metres. The two lanes very nearly touch. */
const LANE_WIDTH = 3;

/** Where the gentle ramp's centre line runs, in metres along X. */
export const GENTLE_X = -1.6;

/** Where the steep ramp's centre line runs, in metres along X. */
export const STEEP_X = 1.6;

/** Where the walkable surface of the plateau starts, in metres along Z. */
const PLATEAU_Z = 4.2;

/** How deep the plateau is, in metres. */
const PLATEAU_DEPTH = 5;

/**
 * How far each ramp's crest stands above the plateau it delivers the capsule onto, in metres.
 *
 * @remarks
 * Three centimetres, and it is not cosmetic. A ramp whose crest is exactly flush with the plateau
 * leaves the plateau's own vertical face buried under it with its top corner in the same place as
 * the walkable surface — and a capsule climbing the last few centimetres touches that corner, whose
 * contact normal is almost horizontal. Havok resolves that as a wall and the capsule stops a hand's
 * width from the top (measured 2026-09-08, before this lip existed). Carrying the ramp a little
 * **past** the surface it meets puts the corner below the ramp's own face. The slope is unchanged:
 * the run is derived from the rise, so 30° is still 30°.
 */
const CREST_LIP = 0.03;

/** Where the character starts, in metres: on the floor, in front of both ramps. */
export const SPAWN = { x: 0, y: 0, z: -4.6 } as const;

/** The materials the course is built from. */
export interface CourseLook {
  /** The plateau and the gentle ramp: the surfaces the capsule walks up. */
  readonly slab: AssetHandle<MaterialAsset>;
  /** The steep ramp, darker so the frame says which one is refused before you try it. */
  readonly steep: AssetHandle<MaterialAsset>;
  /** The grid floor's tint. */
  readonly floor: ColorLike;
}

/** What {@link buildCourse} produced. */
export interface Course {
  /** Releases every handle the course holds. */
  release(): void;
}

/** A point on a ramp's walkable surface, in metres. */
export interface RampPoint {
  /** Metres along X. */
  readonly x: number;
  /** Metres above the floor. */
  readonly y: number;
  /** Metres along Z. */
  readonly z: number;
}

/**
 * Where the gentle ramp's walkable surface is, a fraction of the way up.
 *
 * @remarks
 * `main.ts` uses it to pose the capsule for `?static=1`: the poster has to show the capsule *on* the
 * ramp, and no fixed step ever runs to put it there.
 *
 * @param fraction - `0` at the low edge, `1` at the crest.
 * @returns The point on the surface.
 */
export function gentleRampPoint(fraction: number): RampPoint {
  const rise = RISE + CREST_LIP;
  const run = rise / Math.tan(degToRad(GENTLE_DEGREES));
  return { x: GENTLE_X, y: rise * fraction, z: PLATEAU_Z - run * (1 - fraction) };
}

/** Where one ramp goes and how steep it is. */
interface RampPlacement {
  /** The angle of the walkable surface, in degrees. */
  readonly degrees: number;
  /** How high it climbs, in metres. */
  readonly rise: number;
  /** Where its centre line runs, in metres along X. */
  readonly x: number;
  /** Where the *high* edge of its walkable surface sits, in metres along Z. */
  readonly topZ: number;
}

/**
 * Adds one static ramp: a box turned about X, sized and placed from its angle and its climb.
 *
 * @param app - The running app.
 * @param material - The ramp's material.
 * @param place - The angle, the climb, and where the high edge sits.
 * @returns The mesh handle, so the caller can release it.
 */
function addRamp(app: App, material: AssetHandle<MaterialAsset>, place: RampPlacement): AssetHandle<MeshAsset> {
  const angle = degToRad(place.degrees);
  const run = place.rise / Math.tan(angle);
  const length = place.rise / Math.sin(angle);
  const mesh = MeshAsset.box(app, { width: LANE_WIDTH, height: RAMP_THICKNESS, depth: length });
  const entity = app.world.createEntity(`Ramp ${String(place.degrees)}`);
  entity.transform.localPosition.set(
    place.x,
    place.rise / 2 - (RAMP_THICKNESS / 2) * Math.cos(angle),
    place.topZ - run / 2 + (RAMP_THICKNESS / 2) * Math.sin(angle),
  );
  entity.transform.localEulerAngles = { x: -place.degrees, y: 0, z: 0 };
  entity.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: true });
  entity.addComponent(BoxCollider, { size: { x: LANE_WIDTH, y: RAMP_THICKNESS, z: length } });
  return mesh;
}

/** Where one block goes and how big it is. */
interface BlockPlacement {
  /** Where its centre runs, in metres along X. */
  readonly x: number;
  /** Where its centre runs, in metres along Z. */
  readonly z: number;
  /** How wide it is, in metres. */
  readonly width: number;
  /** How deep it is, in metres. */
  readonly depth: number;
  /** How high its top face sits above the floor, in metres. */
  readonly top: number;
}

/**
 * Adds one static block that stands on the floor, with its top face at `top`.
 *
 * @remarks
 * A solid block rather than a floating slab, so the plateau reads as something you step onto rather
 * than a sheet hanging in the air — and so a capsule that walks into its side meets a wall.
 *
 * @param app - The running app.
 * @param name - The entity's name.
 * @param material - The block's material.
 * @param box - Where it is, how big, and how high its top face sits.
 * @returns The mesh handle, so the caller can release it.
 */
function addBlock(
  app: App,
  name: string,
  material: AssetHandle<MaterialAsset>,
  box: BlockPlacement,
): AssetHandle<MeshAsset> {
  const mesh = MeshAsset.box(app, { width: box.width, height: box.top, depth: box.depth });
  const entity = app.world.createEntity(name);
  entity.transform.localPosition.set(box.x, box.top / 2, box.z);
  entity.addComponent(MeshRenderer, { mesh, materials: [material], castShadows: true });
  entity.addComponent(BoxCollider, { size: { x: box.width, y: box.top, z: box.depth } });
  return mesh;
}

/**
 * Builds the course: the floor, the two ramps, and the plateau they lead to.
 *
 * @remarks
 * Every piece is a collider with **no `Rigidbody`**, which is placed once as a static body. Moving
 * one afterwards would log `IGX-0901`; scenery never moves, so that is exactly what it wants.
 *
 * @param app - The running app.
 * @param look - The three materials.
 * @returns The release for the handles this created.
 */
export async function buildCourse(app: App, look: CourseLook): Promise<Course> {
  const ground = await createGridGround(app, { size: GROUND_SIZE, color: look.floor });
  ground.entity.addComponent(BoxCollider, {
    size: { x: GROUND_SIZE, y: FLOOR_DEPTH, z: GROUND_SIZE },
    center: { x: 0, y: -FLOOR_DEPTH / 2, z: 0 },
  });

  const meshes = [
    addBlock(app, "Plateau", look.slab, {
      x: 0,
      z: PLATEAU_Z + PLATEAU_DEPTH / 2,
      width: LANE_WIDTH * 2,
      depth: PLATEAU_DEPTH,
      top: RISE,
    }),
    addRamp(app, look.slab, { degrees: GENTLE_DEGREES, rise: RISE + CREST_LIP, x: GENTLE_X, topZ: PLATEAU_Z }),
    addRamp(app, look.steep, { degrees: STEEP_DEGREES, rise: RISE + CREST_LIP, x: STEEP_X, topZ: PLATEAU_Z }),
  ];

  return {
    release(): void {
      for (const mesh of meshes) {
        mesh.release();
      }
      ground.release();
    },
  };
}

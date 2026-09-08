/**
 * One dynamic body: a mesh, a collider, a `Rigidbody`, and the script that tints it when it stops.
 *
 * This is the physics lesson of the example, kept beside `main.ts` because `main.ts` is the world
 * and the panel. Three things in here are worth reading twice.
 *
 * **A body's entity must be a root entity.** Havok writes the scene node's *local* pose, so a
 * parented body would be simulated in its parent's space — `IGX-0907` says so out loud.
 *
 * **Bodies and shapes are built at the start of the next fixed step**, never mid-frame, so the
 * transform written at spawn time is the pose the simulation starts from and body creation order
 * follows entity creation order.
 *
 * **`inlineMaterial` is read when the shape is built.** `Collider.resolveMaterial` prefers a
 * `.physicsmaterial.json` asset, then these inline values, then the world's `defaultMaterial`. So a
 * change to the panel's sliders reaches the next body rather than the settled pile, which is what
 * Reset re-drops the pile for.
 */

import {
  assertNever,
  bool,
  BoxCollider,
  CapsuleCollider,
  createMaterialAsset,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  Rigidbody,
  Script,
  SphereCollider,
  Vec3,
} from "ignifx";
import { BOX_SIZE, CAPSULE_HEIGHT, CAPSULE_RADIUS, SPHERE_RADIUS } from "./arena.ts";
import type { ShapeName, Triple } from "./arena.ts";
import type {
  App,
  AssetHandle,
  ColorLike,
  Entity,
  MaterialAsset,
  PhysicsMaterialValues,
  ScriptCallbacks,
} from "ignifx";

/** A dropped body's mass, in kilograms. */
const BODY_MASS = 2;

/** Below this speed, in metres per second, a body counts as still. */
const REST_SPEED = 0.04;

/** Below this rate, in radians per second, a body counts as still. */
const REST_SPIN = 0.12;

/** How many consecutive still fixed steps mark a body at rest. Twenty is a third of a second. */
const REST_STEPS = 20;

/** The colour each shape is drawn in while it is moving. */
const SHAPE_COLORS: Readonly<Record<ShapeName, ColorLike>> = {
  Box: { r: 0.878, g: 0.412, b: 0.169, a: 1 },
  Sphere: { r: 0.247, g: 0.663, b: 0.627, a: 1 },
  Capsule: { r: 0.788, g: 0.635, b: 0.153, a: 1 },
};

/** How much of its colour a body keeps once it has come to rest. */
const ASLEEP_FACTOR = 0.45;

/**
 * Scales a colour towards black.
 *
 * @param color - The colour to dim.
 * @param factor - How much of it to keep.
 * @returns The dimmed colour, opaque.
 */
function dim(color: ColorLike, factor: number): ColorLike {
  return { r: color.r * factor, g: color.g * factor, b: color.b * factor, a: 1 };
}

/**
 * Tints its body when it stops moving, and reports whether it is at rest.
 *
 * @remarks
 * Havok puts a resting body to sleep and stops integrating it, which is why a pit of settled crates
 * costs almost nothing to keep on screen. `@babylonjs/lite@1.27.0` has no way to *ask* a body
 * whether it is asleep — it only accepts `startAsleep` when the body is created — so this measures
 * the thing a sleep test measures: a body whose linear and angular speeds have both stayed under a
 * threshold for {@link REST_STEPS} consecutive fixed steps is at rest, and is tinted.
 *
 * The velocities are read in `fixedUpdate` because that is where the authoritative pose and
 * velocity live; `update` and `PreRender` see the interpolated display pose.
 */
export class RestTint extends Script.define({ atRest: bool(false) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "physics-playground/RestTint";

  /** The material shown while the body is moving. Assigned by {@link spawnBody}. */
  moving: AssetHandle<MaterialAsset> | null = null;

  /** The material shown once the body is at rest. Assigned by {@link spawnBody}. */
  resting: AssetHandle<MaterialAsset> | null = null;

  /** The body this watches, found once. */
  #body: Rigidbody | null = null;

  /** The renderer whose first material is swapped. */
  #renderer: MeshRenderer | null = null;

  /** How many consecutive fixed steps the body has been still for. */
  #stillSteps = 0;

  /** Reused so the per-step path allocates nothing (coding standards §7). */
  readonly #velocity = new Vec3();

  /** Finds the body and the renderer, and seeds the counter from the authored state. */
  awake(): void {
    this.#body = this.entity.getComponent(Rigidbody);
    this.#renderer = this.entity.getComponent(MeshRenderer);
    this.#stillSteps = this.atRest ? REST_STEPS : 0;
  }

  /** Measures the body's speed and swaps its material when the verdict changes. */
  fixedUpdate(): void {
    const body = this.#body;
    if (body === null) {
      return;
    }
    body.linearVelocityToRef(this.#velocity);
    const speed = this.#velocity.length();
    body.angularVelocityToRef(this.#velocity);
    const still = speed < REST_SPEED && this.#velocity.length() < REST_SPIN;
    this.#stillSteps = still ? this.#stillSteps + 1 : 0;
    const atRest = this.#stillSteps >= REST_STEPS;
    if (atRest === this.atRest) {
      return;
    }
    this.atRest = atRest;
    const material = atRest ? this.resting : this.moving;
    // `MeshRenderer` re-reads `materials[0]` on every `PreRender` sync, so one assignment is the
    // whole swap: nothing is rebuilt and no pipeline is recompiled.
    if (this.#renderer !== null && material !== null) {
      this.#renderer.materials[0] = material;
    }
  }
}

/** The mesh and the two materials every body of one shape shares. */
export interface ShapeLook {
  /** The mesh, cloned per body by `MeshRenderer`. */
  readonly mesh: AssetHandle<MeshAsset>;
  /** The colour while the body moves. */
  readonly moving: AssetHandle<MaterialAsset>;
  /** The colour once the body is at rest. */
  readonly resting: AssetHandle<MaterialAsset>;
}

/** One live body, and the script that tints it. */
export interface Body {
  /** The body's entity. */
  readonly entity: Entity;
  /** Its tint script, which the "At rest" readout counts. */
  readonly tint: RestTint;
}

/** The look of every shape, by name. */
export type ShapeLooks = Readonly<Record<ShapeName, ShapeLook>>;

/**
 * Builds one mesh and two materials per shape, shared by every body of that shape.
 *
 * @remarks
 * Every shape comes from a `MeshAsset` factory — `box`, `sphere`, `capsule` — so the example fetches
 * nothing. A capsule's `height` is its **total** height, caps included, in both the mesh factory
 * and the collider, so one pair of numbers describes the drawing and the shape.
 *
 * @param app - The running app.
 * @returns The look of each shape. The caller owns the handles.
 */
export function buildLooks(app: App): ShapeLooks {
  const look = (shape: ShapeName, mesh: AssetHandle<MeshAsset>): ShapeLook => {
    const color = SHAPE_COLORS[shape];
    return {
      mesh,
      moving: createMaterialAsset(
        app,
        pbrMaterialDefinition({ name: `${shape}/moving`, baseColor: color, metallic: 0.05, roughness: 0.45 }),
        [],
      ),
      resting: createMaterialAsset(
        app,
        pbrMaterialDefinition({
          name: `${shape}/resting`,
          baseColor: dim(color, ASLEEP_FACTOR),
          metallic: 0.05,
          roughness: 0.7,
        }),
        [],
      ),
    };
  };
  return {
    Box: look("Box", MeshAsset.box(app, { size: BOX_SIZE })),
    Sphere: look("Sphere", MeshAsset.sphere(app, { diameter: SPHERE_RADIUS * 2, segments: 18 })),
    Capsule: look("Capsule", MeshAsset.capsule(app, { height: CAPSULE_HEIGHT, radius: CAPSULE_RADIUS })),
  };
}

/**
 * Adds one shape's collider, with the surface it presents to Havok.
 *
 * @param entity - The body's entity.
 * @param shape - Which collider to add.
 * @param material - The friction and bounce this body is built with; copied, not held.
 */
function addCollider(entity: Entity, shape: ShapeName, material: PhysicsMaterialValues): void {
  const inlineMaterial: PhysicsMaterialValues = { ...material };
  switch (shape) {
    case "Box": {
      entity.addComponent(BoxCollider, { size: { x: BOX_SIZE, y: BOX_SIZE, z: BOX_SIZE }, inlineMaterial });
      break;
    }
    case "Sphere": {
      entity.addComponent(SphereCollider, { radius: SPHERE_RADIUS, inlineMaterial });
      break;
    }
    case "Capsule": {
      entity.addComponent(CapsuleCollider, {
        radius: CAPSULE_RADIUS,
        height: CAPSULE_HEIGHT,
        direction: "y",
        inlineMaterial,
      });
      break;
    }
    default: {
      // Every shape is handled above; this branch makes adding one a type error rather than a
      // silently invisible body (coding standards §5.2).
      assertNever(shape, "body shape");
    }
  }
}

/** What {@link spawnBody} takes. */
export interface SpawnRequest {
  /** Which shape. */
  readonly shape: ShapeName;
  /** Where its centre starts, in metres. */
  readonly at: Triple;
  /** Its Euler angles, in degrees. Omitted means axis-aligned. */
  readonly turn?: Triple;
  /** Whether Havok starts it asleep, which the authored pile does because it is already resting. */
  readonly asleep: boolean;
}

/**
 * Builds one dynamic body.
 *
 * @param app - The running app.
 * @param looks - The shared meshes and materials.
 * @param material - The friction and bounce to build the collider with.
 * @param request - The shape, the pose, and whether it starts asleep.
 * @returns The body and its tint script.
 *
 * @example
 * ```ts
 * spawnBody(app, looks, { friction: 0.55, staticFriction: 0.55, restitution: 0.1 }, {
 *   shape: "Sphere",
 *   at: { x: 0, y: 4, z: 0 },
 *   asleep: false,
 * });
 * ```
 */
export function spawnBody(app: App, looks: ShapeLooks, material: PhysicsMaterialValues, request: SpawnRequest): Body {
  const look = looks[request.shape];
  const entity = app.world.createEntity(request.shape);
  entity.transform.localPosition.set(request.at.x, request.at.y, request.at.z);
  if (request.turn !== undefined) {
    entity.transform.localEulerAngles = request.turn;
  }
  entity.addComponent(MeshRenderer, {
    mesh: look.mesh,
    materials: [request.asleep ? look.resting : look.moving],
    castShadows: true,
  });
  addCollider(entity, request.shape, material);
  entity.addComponent(Rigidbody, { mass: BODY_MASS, startAsleep: request.asleep });
  const tint = entity.addComponent(RestTint, { atRest: request.asleep });
  tint.moving = look.moving;
  tint.resting = look.resting;
  return { entity, tint };
}

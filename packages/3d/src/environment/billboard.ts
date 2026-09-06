import { bool, Component, createDefaults, defineSchema, enumOf, Quat, Vec3 } from "@ignifx/core";
import { mainCamera } from "../camera/main-camera.js";
import type { MutableVec3, Schema, System, SystemContext, Vec3Like } from "@ignifx/core";

/**
 * `Billboard` (`docs/architecture/12-3d-toolkit.md` §6): an entity that turns to face the camera.
 *
 * It runs in `lateUpdate` order, from a system rather than a script, so that a billboard parented
 * to an animated bone faces the camera *after* the pose is written. Lite has billboard sprite
 * systems of its own for particles (`index.d.ts` — `addBillboardSprite` and friends); this is the
 * scene-graph version, for a health bar, a name plate, or an impostor quad.
 */

/**
 * Every way a billboard can be constrained.
 *
 * @public
 */
export const BILLBOARD_MODES = ["full", "yAxis"] as const;

/**
 * The union of {@link BILLBOARD_MODES}.
 *
 * @remarks
 * `"full"` faces the camera exactly. `"yAxis"` — the `lockY` of `12-3d-toolkit.md` §6 — turns only
 * around the world up axis, which is what a tree impostor or a name plate wants: it stays upright
 * however far the camera looks down.
 *
 * @public
 */
export type BillboardMode = (typeof BILLBOARD_MODES)[number];

/**
 * Builds the `Billboard` field declarations.
 *
 * @returns The schema.
 */
function billboardSchema(): Schema {
  return defineSchema({
    mode: enumOf(BILLBOARD_MODES, "full", { tooltip: "Whether the billboard is free or locked upright." }),
    faceCameraPlane: bool(false, { tooltip: "Whether to align with the view plane rather than aim at the eye." }),
  });
}

/**
 * An entity that faces the camera.
 *
 * @example
 * ```ts
 * nameplate.addComponent(Billboard, { mode: "yAxis" });
 * ```
 *
 * @public
 */
export class Billboard extends Component {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/Billboard";

  /** One billboard per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = billboardSchema();

  /** Whether the billboard is free or locked upright. */
  declare mode: BillboardMode;

  /** Whether to align with the view plane rather than aim at the eye. */
  declare faceCameraPlane: boolean;

  readonly #forward: MutableVec3 = new Vec3();

  readonly #rotation: Quat = new Quat();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Billboard.schema));
  }

  /**
   * Turns the entity to face a viewer.
   *
   * @param eye - The camera's world position.
   * @param cameraForward - The camera's forward vector, for the view-plane mode.
   *
   * @internal
   */
  face(eye: Vec3Like, cameraForward: Vec3Like): void {
    const transform = this.entity.transform;
    const position = transform.position;
    if (this.faceCameraPlane) {
      this.#forward.x = cameraForward.x;
      this.#forward.y = cameraForward.y;
      this.#forward.z = cameraForward.z;
    } else {
      this.#forward.x = position.x - eye.x;
      this.#forward.y = position.y - eye.y;
      this.#forward.z = position.z - eye.z;
    }
    if (this.mode === "yAxis") {
      this.#forward.y = 0;
    }
    const length = Math.hypot(this.#forward.x, this.#forward.y, this.#forward.z);
    if (length < 1e-6) {
      return;
    }
    this.#forward.x /= length;
    this.#forward.y /= length;
    this.#forward.z /= length;
    Quat.lookRotationToRef(this.#forward, UP, this.#rotation);
    transform.rotation = this.#rotation;
  }
}

/** World up, which a `yAxis` billboard keeps. */
const UP: Vec3Like = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * The `PostUpdate` order the billboard system runs at.
 *
 * @remarks
 * `20` is after the 3D animation system at `10`, so a billboard parented under an animated bone
 * faces the camera from the pose this frame rather than last frame's — which is the same reason
 * `ThirdPersonCamera` is a `lateUpdate` script.
 *
 * @public
 */
export const BILLBOARD_ORDER = 20;

/**
 * Turns every enabled `Billboard` towards the main camera.
 *
 * @public
 */
export class BillboardSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/3d-billboard";

  /**
   * Faces every billboard.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    const camera = mainCamera(ctx.world);
    if (camera === null) {
      return;
    }
    const eye = camera.entity.transform.position;
    const forward = camera.entity.transform.forward;
    const billboards = ctx.world.components(Billboard);
    for (let index = 0; index < billboards.length; index += 1) {
      const billboard = billboards[index];
      if (billboard !== undefined && billboard.isEnabledInHierarchy) {
        billboard.face(eye, forward);
      }
    }
  }
}

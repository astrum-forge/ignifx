import type { Physics2DHost } from "./host.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * The three systems `docs/architecture/01-lifecycle-and-time.md` §3 step 4 and `09-physics.md` §1
 * put physics in the frame with — identical in 2D, except that Rapier is stepped directly and there
 * is no Babylon Lite simulation scene:
 *
 * ```
 * Systems(FixedUpdate, -100)  restore the authoritative pose of interpolated bodies
 * scripts.fixedUpdate(dt)     forces, velocities, CharacterController2D.move()
 * Systems(FixedUpdate,  100)  step Rapier, snapshot poses, dispatch collision and trigger events
 * Systems(PreRender,  -500)   write lerp(prev, cur, time.fixedStepAlpha)
 * ```
 *
 * Everything here is `@internal`.
 */

/** The `FixedUpdate` order the restore system runs at. */
export const PHYSICS_2D_RESTORE_ORDER = -100;

/** The `FixedUpdate` order the step system runs at. */
export const PHYSICS_2D_STEP_ORDER = 100;

/** The `PreRender` order the interpolation system runs at. */
export const PHYSICS_2D_INTERPOLATE_ORDER = -500;

/**
 * Undoes the display pose the interpolation system wrote, so `fixedUpdate` and Rapier both see the
 * authoritative pose.
 *
 * @internal
 */
export class Physics2DRestoreSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "physics2d-restore";

  readonly #host: Physics2DHost;

  /**
   * Binds the system to the runtime holder.
   *
   * @param host - The holder the runtime lands in.
   */
  constructor(host: Physics2DHost) {
    this.#host = host;
  }

  /** Restores every interpolated body's authoritative pose. */
  update(): void {
    this.#host.runtime?.restorePoses();
  }
}

/**
 * Steps Rapier once, snapshots the poses, and dispatches the step's events.
 *
 * @internal
 */
export class Physics2DStepSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "physics2d-step";

  readonly #host: Physics2DHost;

  /**
   * Binds the system to the runtime holder.
   *
   * @param host - The holder the runtime lands in.
   */
  constructor(host: Physics2DHost) {
    this.#host = host;
  }

  /**
   * Runs one fixed step.
   *
   * @param ctx - The world, clock, phase, and fixed delta.
   */
  update(ctx: SystemContext): void {
    this.#host.runtime?.step(ctx.dt);
  }
}

/**
 * Writes the interpolated display pose once per frame.
 *
 * @internal
 */
export class Physics2DInterpolationSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "physics2d-interpolate";

  readonly #host: Physics2DHost;

  /**
   * Binds the system to the runtime holder.
   *
   * @param host - The holder the runtime lands in.
   */
  constructor(host: Physics2DHost) {
    this.#host = host;
  }

  /**
   * Writes `lerp(prev, cur, alpha)` into every interpolated body's transform.
   *
   * @param ctx - The world, clock, phase, and frame delta.
   */
  update(ctx: SystemContext): void {
    this.#host.runtime?.interpolate(ctx.time.fixedStepAlpha);
  }
}

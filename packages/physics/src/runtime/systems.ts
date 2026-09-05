import type { PhysicsHost } from "./host.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * The three systems `docs/architecture/01-lifecycle-and-time.md` §3 step 4 and `09-physics.md` §1
 * put physics in the frame with:
 *
 * ```
 * Systems(FixedUpdate, -100)  restore the authoritative pose of interpolated bodies
 * scripts.fixedUpdate(dt)     forces, velocities, CharacterController.move()
 * Systems(FixedUpdate,  100)  step Havok, snapshot poses, dispatch collision and trigger events
 * Systems(PreRender,  -500)   write lerp(prev, cur, time.fixedStepAlpha)
 * ```
 *
 * Everything here is `@internal`.
 */

/** The `FixedUpdate` order the restore system runs at. */
export const PHYSICS_RESTORE_ORDER = -100;

/** The `FixedUpdate` order the step system runs at. */
export const PHYSICS_STEP_ORDER = 100;

/** The `PreRender` order the interpolation system runs at. */
export const PHYSICS_INTERPOLATE_ORDER = -500;

/**
 * Undoes the display pose the interpolation system wrote, so `fixedUpdate` and Havok both see the
 * authoritative pose (spike S4.3).
 *
 * @internal
 */
export class PhysicsRestoreSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "physics-restore";

  readonly #host: PhysicsHost;

  /**
   * Binds the system to the runtime holder.
   *
   * @param host - The holder the runtime lands in.
   */
  constructor(host: PhysicsHost) {
    this.#host = host;
  }

  /** Restores every interpolated body's authoritative pose. */
  update(): void {
    this.#host.runtime?.restorePoses();
  }
}

/**
 * Steps Havok once, snapshots the poses, and dispatches the step's events.
 *
 * @internal
 */
export class PhysicsStepSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "physics-step";

  readonly #host: PhysicsHost;

  /**
   * Binds the system to the runtime holder.
   *
   * @param host - The holder the runtime lands in.
   */
  constructor(host: PhysicsHost) {
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
export class PhysicsInterpolationSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "physics-interpolate";

  readonly #host: PhysicsHost;

  /**
   * Binds the system to the runtime holder.
   *
   * @param host - The holder the runtime lands in.
   */
  constructor(host: PhysicsHost) {
    this.#host = host;
  }

  /**
   * Writes `lerp(prev, cur, alpha)` into every interpolated body's node.
   *
   * @param ctx - The world, clock, phase, and frame delta.
   */
  update(ctx: SystemContext): void {
    this.#host.runtime?.interpolate(ctx.time.fixedStepAlpha);
  }
}

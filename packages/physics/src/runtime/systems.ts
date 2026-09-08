import type { PhysicsHost } from "./host.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * The three systems `docs/architecture/01-lifecycle-and-time.md` §3 and `09-physics.md` §1 put
 * physics in the frame with:
 *
 * ```
 * Systems(FixedUpdate, -100)  restore the authoritative pose of interpolated bodies
 * scripts.fixedUpdate(dt)     forces, velocities, CharacterController.move()
 * Systems(FixedUpdate,  100)  step Havok, snapshot poses, dispatch collision and trigger events
 * ── the fixed loop ends; time.fixedStepAlpha is final ──
 * Systems(Update,     -900)   write lerp(prev, cur, time.fixedStepAlpha)
 * scripts.update / lateUpdate, animation, rendering  — all read the display pose
 * ```
 *
 * **Why the display pose is written at the top of `Update` and not in `PreRender`** (2026-09-08).
 * It used to be written in `PreRender`, after `lateUpdate`. Camera rigs run in `lateUpdate`, so they
 * framed the character where the last fixed step left it while the renderer drew it at
 * `lerp(prev, cur, alpha)`: up to one fixed step of motion of relative judder every frame, which is
 * exactly what a follow camera makes visible. Writing the pose before `scripts.update` means every
 * consumer of a transform outside the fixed loop — scripts, animation, camera rigs, the render sync
 * — sees the same pose the frame presents, which is Unity's model. The simulation is unaffected:
 * the restore system at `FixedUpdate −100` runs before `scripts.fixedUpdate`, so `fixedUpdate` and
 * Havok still see the authoritative pose.
 *
 * Everything here is `@internal`.
 */

/** The `FixedUpdate` order the restore system runs at. */
export const PHYSICS_RESTORE_ORDER = -100;

/** The `FixedUpdate` order the step system runs at. */
export const PHYSICS_STEP_ORDER = 100;

/**
 * The `Update` order the interpolation system runs at. Negative, so it lands in
 * `Systems(Update, order < 0)` — after the fixed loop and lifecycle flush B, before
 * `scripts.update` — and low enough that a game's own `Update` systems can still be ordered in
 * front of it if they must see the authoritative pose.
 */
export const PHYSICS_INTERPOLATE_ORDER = -900;

/**
 * Undoes the display pose the interpolation system wrote at the top of the previous `Update`, so
 * `fixedUpdate` and Havok both see the authoritative pose (spike S4.3).
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

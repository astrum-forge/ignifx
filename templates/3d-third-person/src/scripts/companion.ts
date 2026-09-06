import { Animator, NavMeshAgent } from "@ignifx/3d";
import { entityRef, f32, Script } from "@ignifx/core";
import type { Entity, ScriptCallbacks, Vec3Like } from "@ignifx/core";

/**
 * The companion: a second copy of the rig that walks to wherever the player is, around the
 * courtyard's walls, on a `NavMeshAgent`.
 *
 * ## Why the destination is re-issued on a timer
 *
 * `setDestination` starts a fresh path query in Recast. Calling it every fixed step for a target
 * that has moved four centimetres is pure waste, and it also makes the agent jitter, because a
 * newly issued path restarts the corner-following. Re-issuing it only when the player has actually
 * walked somewhere else — or when a fifth of a second has passed — is both cheaper and smoother.
 *
 * ## Why it stops rather than arriving
 *
 * `stoppingDistance` makes the agent brake near its destination, but the destination here is a
 * moving player, so the agent would still shuffle in place. Below {@link Companion.followDistance}
 * the script stops the agent outright, which is what makes the companion stand still next to a
 * standing player.
 */
export class Companion
  extends Script.define({
    /** The entity to follow. */
    target: entityRef<Entity>(),
    /** How close the companion is willing to stand, in metres. */
    followDistance: f32(2.5),
    /** How far the target has to move before the path is recomputed, in metres. */
    repathDistance: f32(0.75),
    /** How long a path is kept before it is recomputed anyway, in seconds. */
    repathSeconds: f32(0.2),
  })
  implements ScriptCallbacks
{
  static typeId = "third-person/Companion";

  /** The crowd agent this steers. */
  #agent: NavMeshAgent | null = null;

  /** The companion's own state machine, driven from the agent's velocity. */
  #animator: Animator | null = null;

  /** Where the last path was asked to end. */
  readonly #lastGoal = { x: Number.NaN, y: 0, z: 0 };

  /** Seconds since the last path request. */
  #sinceRepath = 0;

  awake(): void {
    this.#agent = this.entity.requireComponent(NavMeshAgent);
    this.#animator = this.entity.getComponent(Animator);
  }

  fixedUpdate(dt: number): void {
    const agent = this.#agent;
    const target = this.target;
    if (agent === null || target === null || target.isDestroyed) {
      return;
    }
    this.#sinceRepath += dt;

    const here = this.transform.position;
    const there = target.transform.position;
    const gap = distance(here, there);
    if (gap <= this.followDistance) {
      agent.stop();
      this.#lastGoal.x = Number.NaN;
      return;
    }
    const moved = Number.isNaN(this.#lastGoal.x) || distance(this.#lastGoal, there) > this.repathDistance;
    if (moved || this.#sinceRepath >= this.repathSeconds) {
      this.#sinceRepath = 0;
      this.#lastGoal.x = there.x;
      this.#lastGoal.y = there.y;
      this.#lastGoal.z = there.z;
      // `false` while the crowd has not been built yet — an agent joins on its first fixed step
      // after the surface bakes — so the next tick simply asks again.
      agent.setDestination(there);
    }
  }

  update(): void {
    const agent = this.#agent;
    const animator = this.#animator;
    if (agent === null || animator === null) {
      return;
    }
    const velocity = agent.velocity;
    animator.setFloat("speed", Math.hypot(velocity.x, velocity.z));
    animator.setBool("grounded", true);
  }

  /**
   * How far the companion still has to walk. The HUD reads it.
   *
   * @returns The straight-line distance to the target, in metres, or `0` without one.
   */
  distanceToTarget(): number {
    const target = this.target;
    return target === null || target.isDestroyed ? 0 : distance(this.transform.position, target.transform.position);
  }
}

/**
 * The straight-line distance between two points on the ground plane.
 *
 * @param a - The first point.
 * @param b - The second point.
 * @returns The distance, in metres.
 */
function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

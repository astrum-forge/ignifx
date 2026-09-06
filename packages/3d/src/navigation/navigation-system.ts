import { stepCrowd } from "../lite/navigation/plugin.js";
import { NavMeshAgent } from "./nav-mesh-agent.js";
import { NavMeshObstacle } from "./nav-mesh-obstacle.js";
import { NavMeshSurface } from "./nav-mesh-surface.js";
import type { NavigationService } from "./navigation-service.js";
import type { System, SystemContext, World } from "@ignifx/core";

/**
 * The `FixedUpdate` system that advances every crowd
 * (`docs/architecture/01-lifecycle-and-time.md` §3, `12-3d-toolkit.md` §5).
 *
 * The crowd runs on the **fixed** step, after physics, because Lite's own documentation makes
 * determinism the reason the crowd is manual in the first place (`index.d.ts` 2718-2721). Two runs
 * of the same seed, the same geometry, and the same fixed step therefore produce the same agent
 * positions — which is what the Phase 7 exit criteria ask for and what a replay needs.
 *
 * Transforms are written **after** `updateNavCrowd`, in the same step, so a `fixedUpdate` script
 * reading `agent.velocity` and the transform sees one consistent frame.
 */

/**
 * The `FixedUpdate` order the navigation system runs at.
 *
 * @remarks
 * `@ignifx/physics` steps the world from its own `FixedUpdate` system inside the `[1001, 9999]`
 * extension band; `200` is deliberately outside it and above the `[-1000, 1000]` core band's
 * midpoint, so navigation lands after `fixedUpdate` scripts and after the physics step. An agent
 * that also carries a `CharacterController` therefore sees this step's ground contact.
 *
 * @public
 */
export const NAVIGATION_ORDER = 200;

/**
 * Advances Recast crowds on the fixed step.
 *
 * @public
 */
export class NavigationSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/3d-navigation";

  readonly #service: NavigationService;

  /**
   * Builds the system.
   *
   * @param service - The service that owns the Recast plugin.
   */
  constructor(service: NavigationService) {
    this.#service = service;
  }

  /**
   * Bakes what has to be baked, steps every crowd, and writes the agents back.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    const surfaces = ctx.world.components(NavMeshSurface);
    this.#bakePending(surfaces);
    const primary = this.#service.primarySurface;
    this.#joinAgents(ctx.world, primary);
    this.#carveObstacles(ctx.world, primary);
    for (let index = 0; index < surfaces.length; index += 1) {
      const surface = surfaces[index];
      const crowd = surface?.crowd ?? null;
      if (surface !== undefined && crowd !== null && surface.isEnabledInHierarchy) {
        stepCrowd(crowd, ctx.dt);
      }
    }
    const agents = ctx.world.components(NavMeshAgent);
    for (let index = 0; index < agents.length; index += 1) {
      const agent = agents[index];
      if (agent !== undefined && agent.isEnabledInHierarchy) {
        agent.syncFromCrowd();
      }
    }
  }

  /**
   * Kicks off the bake of every surface that wants one and has not had it.
   *
   * @remarks
   * `bake()` is asynchronous — the Recast module has to load first — so the system starts it and
   * forgets it. Until a surface reports `isBaked`, its agents simply do not join, which is the
   * "not ready yet" state `12-3d-toolkit.md` §5 asks for. The failure lands on `app.onError`
   * through the service's own reporting rather than as an unhandled rejection.
   *
   * @param surfaces - Every surface in the world.
   */
  #bakePending(surfaces: readonly NavMeshSurface[]): void {
    for (let index = 0; index < surfaces.length; index += 1) {
      const surface = surfaces[index];
      if (surface === undefined || !surface.isEnabledInHierarchy) {
        continue;
      }
      if (!surface.bakeOnAwake || surface.isBaked || surface.isBaking) {
        continue;
      }
      void surface.bake().catch((error: unknown): void => {
        surface.app.onError.emit({
          error,
          source: "lifecycle",
          phase: null,
          entity: surface.entity,
          component: surface,
        });
      });
    }
  }

  /**
   * Lets every agent that has not joined a crowd try again.
   *
   * @param world - The world.
   * @param primary - The surface an agent that names none joins.
   */
  #joinAgents(world: World, primary: NavMeshSurface | null): void {
    const agents = world.components(NavMeshAgent);
    for (let index = 0; index < agents.length; index += 1) {
      const agent = agents[index];
      if (agent !== undefined && agent.isEnabledInHierarchy) {
        agent.ensureJoined(primary);
      }
    }
  }

  /**
   * Cuts every obstacle that has not been cut yet.
   *
   * @param world - The world.
   * @param primary - The surface an obstacle that names none cuts.
   */
  #carveObstacles(world: World, primary: NavMeshSurface | null): void {
    const obstacles = world.components(NavMeshObstacle);
    for (let index = 0; index < obstacles.length; index += 1) {
      const obstacle = obstacles[index];
      if (obstacle !== undefined && obstacle.isEnabledInHierarchy && !obstacle.isCarved) {
        obstacle.carve(primary);
      }
    }
  }
}

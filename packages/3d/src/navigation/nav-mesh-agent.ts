import { bool, Component, createDefaults, defineSchema, entityRef, f32, Signal, Vec3 } from "@ignifx/core";
import { threeDError, ThreeDErrorCode } from "../errors.js";
import { joinCrowd, readAgentPosition, readAgentVelocity, sendAgent } from "../lite/navigation/plugin.js";
import { NavMeshSurface } from "./nav-mesh-surface.js";
import type { ComponentHooks, Entity, MutableVec3, Schema, Vec3Like } from "@ignifx/core";

/**
 * `NavMeshAgent` (`docs/architecture/12-3d-toolkit.md` §5): one Recast crowd agent, written back
 * onto its entity's transform.
 *
 * Agents belong to exactly one `NavMeshSurface`'s crowd. The crowd is advanced once per **fixed**
 * step, in `FixedUpdate` after physics, because Lite says so in as many words: *"The crowd is NOT
 * auto-updated; call `updateNavCrowd(crowd, dt)` each frame for full determinism"*
 * (`index.d.ts` 2718-2721). Fixed steps are what makes two runs with one seed identical.
 *
 * ## The lifetime Lite does not give us
 *
 * There is no `removeAgent` in Babylon Lite 1.27.0. An agent index is handed out once and belongs
 * to the crowd for the crowd's life, so a destroyed `NavMeshAgent` parks its agent at its last
 * position and stops reading it, rather than freeing the slot. `NavMeshSurface.maxAgents` therefore
 * counts every agent that has *ever* joined; a level that spawns and kills agents forever should
 * re-bake its surface, which builds a fresh crowd.
 */

/** How close, in metres, an agent has to get before `onArrived` fires with the default settings. */
const DEFAULT_STOPPING_DISTANCE = 0.25;

/** Recast wants a collision query range; four radii is the usual recommendation. */
const COLLISION_QUERY_RADII = 4;

/** Recast wants a path optimization range; a dozen radii is the usual recommendation. */
const OPTIMIZATION_RADII = 12;

/**
 * Builds the `NavMeshAgent` field declarations.
 *
 * @returns The schema.
 */
function navMeshAgentSchema(): Schema {
  return defineSchema({
    surface: entityRef({ tooltip: "The entity carrying the NavMeshSurface to join; the first baked one when unset." }),
    speed: f32(3.5, { min: 0, tooltip: "The agent's top speed, in metres per second." }),
    acceleration: f32(8, { min: 0, tooltip: "How hard the agent accelerates, in metres per second squared." }),
    radius: f32(0.5, { min: 0.01, tooltip: "The agent's radius, in metres." }),
    height: f32(2, { min: 0.01, tooltip: "The agent's height, in metres." }),
    stoppingDistance: f32(DEFAULT_STOPPING_DISTANCE, { min: 0, tooltip: "How close counts as arrived, in metres." }),
    separationWeight: f32(0, { min: 0, tooltip: "How hard agents push apart; 0 disables separation." }),
    updateRotation: bool(true, { tooltip: "Whether the agent turns the entity to face the way it is moving." }),
    updatePosition: bool(true, { tooltip: "Whether the crowd's position is written onto the transform." }),
  });
}

/**
 * A crowd agent.
 *
 * @example
 * ```ts
 * const agent = companion.addComponent(NavMeshAgent, { speed: 4, stoppingDistance: 0.5 });
 * agent.onArrived.connect(() => animator.play("idle"), { owner: agent });
 * agent.setDestination(player.transform.position);
 * ```
 *
 * @public
 */
export class NavMeshAgent extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/NavMeshAgent";

  /** One agent per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = navMeshAgentSchema();

  /** The entity carrying the surface to join; the first baked surface when unset. */
  declare surface: Entity | null;

  /** The agent's top speed, in metres per second. */
  declare speed: number;

  /** How hard the agent accelerates. */
  declare acceleration: number;

  /** The agent's radius, in metres. */
  declare radius: number;

  /** The agent's height, in metres. */
  declare height: number;

  /** How close counts as arrived, in metres. */
  declare stoppingDistance: number;

  /** How hard agents push apart. */
  declare separationWeight: number;

  /** Whether the agent turns the entity to face the way it is moving. */
  declare updateRotation: boolean;

  /** Whether the crowd's position is written onto the transform. */
  declare updatePosition: boolean;

  #index = -1;

  #surface: NavMeshSurface | null = null;

  #isStopped = true;

  #hasArrived = true;

  readonly #destination: MutableVec3 = new Vec3();

  readonly #velocity: MutableVec3 = new Vec3();

  readonly #position: MutableVec3 = new Vec3();

  readonly #onArrived: Signal<NavMeshAgent> = new Signal<NavMeshAgent>();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(NavMeshAgent.schema));
  }

  /**
   * Fires once each time the agent reaches its destination.
   *
   * @returns Fires once each time the agent reaches its destination.
   */
  get onArrived(): Signal<NavMeshAgent> {
    return this.#onArrived;
  }

  /**
   * Whether the agent has joined a crowd and is being simulated.
   *
   * @returns Whether the agent has joined a crowd and is being simulated.
   */
  get isOnNavMesh(): boolean {
    return this.#index >= 0;
  }

  /**
   * Whether the agent is holding still rather than heading somewhere.
   *
   * @returns Whether the agent is holding still rather than heading somewhere.
   */
  get isStopped(): boolean {
    return this.#isStopped;
  }

  /**
   * The agent's current world velocity, as the crowd reports it. Reused each frame.
   *
   * @returns The agent's current world velocity, as the crowd reports it. Reused each frame.
   */
  get velocity(): Vec3Like {
    return this.#velocity;
  }

  /**
   * Where the agent was last told to go. Reused each frame.
   *
   * @returns Where the agent was last told to go. Reused each frame.
   */
  get destination(): Vec3Like {
    return this.#destination;
  }

  /**
   * How far the agent still has to travel, straight-line.
   *
   * @remarks
   * Recast's crowd exposes no remaining path length, so this is the distance from the agent to its
   * destination rather than the length of the corridor — the same approximation Unity's
   * `remainingDistance` makes for a partial path.
   *
   * @returns The distance in metres; `Infinity` when the agent is not on a navmesh.
   */
  get remainingDistance(): number {
    if (this.#index < 0 || this.#isStopped) {
      return Number.POSITIVE_INFINITY;
    }
    return Vec3.distance(this.#position, this.#destination);
  }

  /**
   * The agent's index in its crowd, or `-1`.
   *
   * @returns The agent's index in its crowd, or `-1`.
   */
  get agentIndex(): number {
    return this.#index;
  }

  /** Forgets the crowd slot, which Lite cannot free. */
  onDetach(): void {
    this.#index = -1;
    this.#surface = null;
    this.#isStopped = true;
  }

  /**
   * Sends the agent to a point.
   *
   * @param point - Where to go, in world space. It is snapped onto the navmesh first.
   * @returns `true` when the agent is on a navmesh and took the order.
   *
   * @example
   * ```ts
   * agent.setDestination({ x: 8, y: 0, z: -2 });
   * ```
   */
  setDestination(point: Vec3Like): boolean {
    const surface = this.#surface;
    const crowd = surface?.crowd ?? null;
    if (surface === null || crowd === null || this.#index < 0) {
      return false;
    }
    const snapped = surface.closestPoint(point, this.#destination);
    if (snapped === null) {
      return false;
    }
    sendAgent(crowd, this.#index, this.#destination);
    this.#isStopped = false;
    this.#hasArrived = false;
    return true;
  }

  /** Holds the agent where it is; `setDestination` starts it again. */
  stop(): void {
    const crowd = this.#surface?.crowd ?? null;
    if (crowd !== null && this.#index >= 0) {
      // Recast has no "halt" call: sending an agent to where it already stands is the stop.
      sendAgent(crowd, this.#index, this.#position);
    }
    this.#isStopped = true;
  }

  /**
   * Joins the agent's crowd if it has not joined one yet.
   *
   * @param fallback - The surface to use when the component names none.
   * @returns `true` when the agent is on a navmesh.
   *
   * @internal
   */
  ensureJoined(fallback: NavMeshSurface | null): boolean {
    if (this.#index >= 0) {
      return true;
    }
    const surface = this.surface?.getComponent(NavMeshSurface) ?? fallback;
    const crowd = surface?.crowd ?? null;
    if (surface === null || crowd === null || !surface.isBaked) {
      return false;
    }
    if (!surface.reserveAgent()) {
      this.app.onError.emit({
        error: threeDError(
          ThreeDErrorCode.crowdFull,
          `The crowd of ${surface.entity.name} is full at ${String(surface.maxAgents)} agents.`,
          { context: { surface: surface.entity.name, maxAgents: surface.maxAgents } },
        ),
        source: "lifecycle",
        phase: null,
        entity: this.entity,
        component: this,
      });
      return false;
    }
    const start =
      surface.closestPoint(this.entity.transform.position, surface.scratch) ?? this.entity.transform.position;
    this.#index = joinCrowd(crowd, start, {
      radius: this.radius,
      height: this.height,
      maxAcceleration: this.acceleration,
      maxSpeed: this.speed,
      collisionQueryRange: this.radius * COLLISION_QUERY_RADII,
      pathOptimizationRange: this.radius * OPTIMIZATION_RADII,
      separationWeight: this.separationWeight,
    });
    this.#surface = surface;
    this.#position.x = start.x;
    this.#position.y = start.y;
    this.#position.z = start.z;
    return true;
  }

  /**
   * Reads the crowd's answer and writes it onto the transform. The `FixedUpdate` system calls it
   * after `updateNavCrowd`.
   *
   * @internal
   */
  syncFromCrowd(): void {
    const crowd = this.#surface?.crowd ?? null;
    if (crowd === null || this.#index < 0) {
      return;
    }
    readAgentPosition(crowd, this.#index, this.#position);
    readAgentVelocity(crowd, this.#index, this.#velocity);
    const transform = this.entity.transform;
    if (this.updatePosition) {
      transform.position = this.#position;
    }
    if (this.updateRotation && Vec3.lengthSquared(this.#velocity) > 1e-6) {
      transform.lookAt(Vec3.add(this.#position, this.#velocity));
    }
    if (!this.#isStopped && !this.#hasArrived && this.remainingDistance <= this.stoppingDistance) {
      this.#hasArrived = true;
      this.#isStopped = true;
      this.#onArrived.emit(this);
    }
  }
}

import { Vec2 } from "@ignifx/core";
import { Physics2DErrorCode, physics2DError } from "./errors.js";
import { castRay, castRayAll, castShape, interactionGroups, overlapShape, toRadians } from "./lite/rapier/world.js";
import type { RapierShape2D, RapierWorld, RayResult2D, ShapeCastResult2D } from "./lite/rapier/world.js";
import type { QueryOptions2D, RaycastHit2D, ShapeCastHit2D } from "./queries.js";
import type { Physics2DHost } from "./runtime/host.js";
import type { Physics2DRuntime } from "./runtime/runtime.js";
import type { Physics2DSettings } from "./settings.js";
import type { Entity, Vec2Like } from "@ignifx/core";

/**
 * `app.physics2d` (`docs/architecture/11-2d-toolkit.md` §8, `09-physics.md` §5): gravity, the
 * queries, and the Rapier escape hatch.
 *
 * Every query is shape-accurate and reports the exact collider it hit, because Rapier's query
 * pipeline returns the `Collider` (`pipeline/world.d.ts`). The bounds-index approximations
 * `09-physics.md` §5 documents for Havok have no counterpart here.
 */

/** How far a ray travels when the caller names no distance, in metres. */
const DEFAULT_RAY_DISTANCE = 1e4;

/** Every layer bit Rapier can express. */
const ALL_LAYERS = 0xff_ff;

/**
 * The Rapier objects the 2D physics extension owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface Physics2DRapierHandles {
  /** Rapier's `World`. */
  readonly world: RapierWorld;
}

/**
 * The service behind `app.physics2d`.
 *
 * @example
 * ```ts
 * const hit = app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20);
 * if (hit !== null) {
 *   app.log.info("ray hit {name} at {y}", hit.entity.name, hit.point.y);
 * }
 * ```
 *
 * @public
 */
export class Physics2DService {
  readonly #host: Physics2DHost;

  readonly #gravity = new Vec2();

  readonly #point = new Vec2();

  readonly #normal = new Vec2();

  readonly #rayResult: RayResult2D = { hit: false, collider: null, distance: 0 };

  readonly #sweepResult: ShapeCastResult2D = { hit: false, collider: null, distance: 0 };

  readonly #hits: RaycastHit2D[] = [];

  readonly #overlaps: Entity[] = [];

  /**
   * Wraps the holder the extension fills in from `onStart`.
   *
   * @param host - The holder the runtime lands in.
   * @param settings - The resolved `physics2d` settings section.
   *
   * @internal
   */
  constructor(host: Physics2DHost, settings: Physics2DSettings) {
    this.#host = host;
    this.#gravity.set(settings.gravity.x, settings.gravity.y);
  }

  /**
   * World gravity in metres per second squared.
   *
   * @returns A live view; writing to it does nothing, assign the property instead.
   */
  get gravity(): Vec2 {
    return this.#gravity;
  }

  /**
   * Replaces world gravity, which every body feels from the next fixed step.
   *
   * @param value - The new acceleration vector.
   */
  set gravity(value: Vec2Like) {
    this.#gravity.set(value.x, value.y);
    this.#rt().setGravity(this.#gravity);
  }

  /**
   * The Rapier handles.
   *
   * @returns The world.
   */
  get rapier(): Physics2DRapierHandles {
    return { world: this.#rt().world };
  }

  /**
   * Casts a ray and returns the first entity it hits.
   *
   * @param origin - The world-space origin, in metres.
   * @param direction - The direction; it is normalised for you.
   * @param maxDistance - How far to travel; defaults to 10 km.
   * @param options - Layer mask and trigger behaviour.
   * @returns The hit, or `null` when the ray clears everything.
   * @throws IgnifxError with code `IGX-1153` when no fixed step has run yet.
   */
  raycast(
    origin: Vec2Like,
    direction: Vec2Like,
    maxDistance: number = DEFAULT_RAY_DISTANCE,
    options?: QueryOptions2D,
  ): RaycastHit2D | null {
    this.#requireStep("raycast");
    const unit = normalize(direction);
    if (unit === null) {
      return null;
    }
    castRay(
      this.#rt().world,
      origin,
      unit,
      maxDistance,
      groupsOf(options),
      options?.hitTriggers === true,
      this.#point,
      this.#normal,
      this.#rayResult,
    );
    return this.#toHit(this.#rayResult.collider, this.#rayResult.distance, this.#point, this.#normal);
  }

  /**
   * Casts a ray and returns every entity along it, nearest first.
   *
   * @param origin - The world-space origin.
   * @param direction - The direction; it is normalised for you.
   * @param maxDistance - How far to travel; defaults to 10 km.
   * @param options - Layer mask and trigger behaviour.
   * @returns The hits, in increasing distance. The array is reused between calls.
   * @throws IgnifxError with code `IGX-1153` when no fixed step has run yet.
   */
  raycastAll(
    origin: Vec2Like,
    direction: Vec2Like,
    maxDistance: number = DEFAULT_RAY_DISTANCE,
    options?: QueryOptions2D,
  ): readonly RaycastHit2D[] {
    this.#requireStep("raycastAll");
    this.#hits.length = 0;
    const unit = normalize(direction);
    if (unit === null) {
      return this.#hits;
    }
    const runtime = this.#rt();
    castRayAll(
      runtime.world,
      origin,
      unit,
      maxDistance,
      groupsOf(options),
      options?.hitTriggers === true,
      (collider, distance, normalX, normalY): void => {
        const binding = runtime.bindingOf(collider);
        if (binding === null) {
          return;
        }
        this.#hits.push({
          entity: binding.record.entity,
          collider: binding.owner,
          point: new Vec2(origin.x + unit.x * distance, origin.y + unit.y * distance),
          normal: new Vec2(normalX, normalY),
          distance,
        });
      },
    );
    this.#hits.sort(byDistance);
    return this.#hits;
  }

  /**
   * Lists the entities a circle overlaps.
   *
   * @param centre - The circle's world position.
   * @param radius - Its radius in metres.
   * @param options - Layer mask and trigger behaviour.
   * @returns The overlapping entities, in Rapier's order. The array is reused between calls.
   * @throws IgnifxError with code `IGX-1153` when no fixed step has run yet.
   */
  overlapCircle(centre: Vec2Like, radius: number, options?: QueryOptions2D): readonly Entity[] {
    return this.#overlap({ kind: "circle", radius }, centre, 0, options, "overlapCircle");
  }

  /**
   * Lists the entities a box overlaps.
   *
   * @param centre - The box's world position.
   * @param size - Its full width and height in metres.
   * @param rotation - Its rotation in degrees counter-clockwise; defaults to `0`.
   * @param options - Layer mask and trigger behaviour.
   * @returns The overlapping entities. The array is reused between calls.
   * @throws IgnifxError with code `IGX-1153` when no fixed step has run yet.
   */
  overlapBox(centre: Vec2Like, size: Vec2Like, rotation: number = 0, options?: QueryOptions2D): readonly Entity[] {
    return this.#overlap(
      { kind: "box", halfWidth: size.x / 2, halfHeight: size.y / 2 },
      centre,
      toRadians(rotation),
      options,
      "overlapBox",
    );
  }

  /**
   * Sweeps a circle and returns the first contact.
   *
   * @param centre - Where the sweep starts.
   * @param radius - The circle's radius in metres.
   * @param direction - The sweep direction; it is normalised for you.
   * @param maxDistance - How far to sweep.
   * @param options - Layer mask and trigger behaviour.
   * @returns The hit, or `null`.
   * @throws IgnifxError with code `IGX-1153` when no fixed step has run yet.
   */
  shapeCast(
    centre: Vec2Like,
    radius: number,
    direction: Vec2Like,
    maxDistance: number,
    options?: QueryOptions2D,
  ): ShapeCastHit2D | null {
    this.#requireStep("shapeCast");
    const unit = normalize(direction);
    if (unit === null) {
      return null;
    }
    castShape(
      this.#rt().world,
      { kind: "circle", radius },
      centre,
      0,
      unit,
      maxDistance,
      groupsOf(options),
      options?.hitTriggers === true,
      this.#point,
      this.#normal,
      this.#sweepResult,
    );
    const binding = this.#rt().bindingOf(this.#sweepResult.collider);
    if (!this.#sweepResult.hit || binding === null) {
      return null;
    }
    return {
      entity: binding.record.entity,
      collider: binding.owner,
      point: this.#point.clone(),
      normal: this.#normal.clone(),
      distance: this.#sweepResult.distance,
      fraction: maxDistance > 0 ? this.#sweepResult.distance / maxDistance : 0,
    };
  }

  /**
   * Runs one overlap query.
   *
   * @param shape - The query geometry.
   * @param centre - Its world position.
   * @param rotation - Its rotation in radians.
   * @param options - Layer mask and trigger behaviour.
   * @param name - The query name, for the diagnostic.
   * @returns The overlapping entities.
   */
  #overlap(
    shape: RapierShape2D,
    centre: Vec2Like,
    rotation: number,
    options: QueryOptions2D | undefined,
    name: string,
  ): readonly Entity[] {
    this.#requireStep(name);
    this.#overlaps.length = 0;
    const runtime = this.#rt();
    overlapShape(
      runtime.world,
      shape,
      centre,
      rotation,
      groupsOf(options),
      options?.hitTriggers === true,
      (collider): void => {
        const entity = runtime.bindingOf(collider)?.record.entity ?? null;
        if (entity !== null && !this.#overlaps.includes(entity)) {
          this.#overlaps.push(entity);
        }
      },
    );
    return this.#overlaps;
  }

  /**
   * Turns a Rapier collider and a distance into a public hit.
   *
   * @param collider - The collider that was hit, or `null`.
   * @param distance - How far away it was.
   * @param point - The contact point.
   * @param normal - The contact normal.
   * @returns The hit, or `null`.
   */
  #toHit(collider: RayResult2D["collider"], distance: number, point: Vec2, normal: Vec2): RaycastHit2D | null {
    const binding = this.#rt().bindingOf(collider);
    if (binding === null) {
      return null;
    }
    return {
      entity: binding.record.entity,
      collider: binding.owner,
      point: point.clone(),
      normal: normal.clone(),
      distance,
    };
  }

  /**
   * The runtime, once `onStart` has built it.
   *
   * @returns The runtime.
   * @throws IgnifxError with code `IGX-1150` when Rapier has not finished loading.
   */
  #rt(): Physics2DRuntime {
    const runtime = this.#host.runtime;
    if (runtime === null) {
      throw physics2DError(Physics2DErrorCode.rapierUnavailable, "The 2D physics world does not exist yet.", {
        hint: "app.physics2d is usable from the first frame onwards; await app.start() first.",
      });
    }
    return runtime;
  }

  /**
   * Refuses a query that ran before Rapier built its broadphase (spike S6.2).
   *
   * @param query - The query name, for the diagnostic.
   * @throws IgnifxError with code `IGX-1153` when no step has completed.
   */
  #requireStep(query: string): void {
    if (this.#rt().hasStepped) {
      return;
    }
    throw physics2DError(Physics2DErrorCode.queryBeforeStep, `${query}() ran before the first fixed step.`, {
      context: { query },
      hint: "Step the app at least once (app.step(1 / 60)) before querying; Rapier builds its broadphase in the first step.",
    });
  }
}

/**
 * The packed interaction word a query filters with: it belongs to every layer and collides with the
 * layers the caller named.
 *
 * @param options - The query options.
 * @returns The packed word.
 */
function groupsOf(options: QueryOptions2D | undefined): number {
  const mask = options?.layerMask?.bits ?? ALL_LAYERS;
  return interactionGroups(ALL_LAYERS, mask & ALL_LAYERS);
}

/**
 * Normalises a direction.
 *
 * @param direction - The direction.
 * @returns A fresh unit vector, or `null` when the direction is zero.
 */
function normalize(direction: Vec2Like): Vec2Like | null {
  const length = Math.hypot(direction.x, direction.y);
  return length === 0 ? null : { x: direction.x / length, y: direction.y / length };
}

/**
 * Orders two hits by distance.
 *
 * @param first - One hit.
 * @param second - The other.
 * @returns A negative number when `first` is nearer.
 */
function byDistance(first: RaycastHit2D, second: RaycastHit2D): number {
  return first.distance - second.distance;
}

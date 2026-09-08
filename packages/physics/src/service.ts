import { Quat, Vec3 } from "@ignifx/core";
import { PhysicsErrorCode, physicsError } from "./errors.js";
import { createViewer, destroyViewer, showBody } from "./lite/gpu/viewer.js";
import { createShape, destroyShape, ShapeGeometry } from "./lite/havok.js";
import { castRay, nearestDistance, sweepShape } from "./lite/queries.js";
import type { Collider } from "./components/collider.js";
import type { LitePhysicsViewer } from "./lite/gpu/viewer.js";
import type { LitePhysicsShape, LitePhysicsWorld } from "./lite/havok.js";
import type { RayQueryResult, SweepQueryResult } from "./lite/queries.js";
import type { QueryOptions, QueryShape, RaycastHit, ShapeCastHit, ShapeCastOptions } from "./queries.js";
import type { BodyRecord } from "./runtime/body-record.js";
import type { PhysicsHost } from "./runtime/host.js";
import type { PhysicsRuntime } from "./runtime/runtime.js";
import type { PhysicsSettings } from "./settings.js";
import type { App, Entity, LiteScene, Vec3Like } from "@ignifx/core";

/**
 * `app.physics` (`docs/architecture/09-physics.md` §5, §6, §9): gravity, the queries, the debug
 * viewer, and the Babylon Lite escape hatch.
 */

/** How far a ray travels when the caller names no distance, in metres. */
const DEFAULT_RAY_DISTANCE = 1e4;

/** How much slack the bounds index allows when it resolves a sweep contact to an entity. */
const BOUNDS_EPSILON = 1e-3;

/** Every bit set: the mask a query uses when the caller names no layers. */
const ALL_LAYERS = ~0;

/**
 * The Babylon Lite objects the physics extension owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface PhysicsLiteHandles {
  /** Lite's Havok world handle. */
  readonly world: LitePhysicsWorld;
  /** The null-engine scene the world is stepped on; also `world.lite.simulationScene`. */
  readonly simulationScene: LiteScene;
}

/**
 * The wireframe overlay `@ignifx/devtools` toggles (`09-physics.md` §9).
 *
 * @public
 */
export interface PhysicsDebugViewer {
  /**
   * Whether Lite's physics viewer is drawing the bodies into the **render** scene. It needs a GPU
   * device, so switching it on in a headless app is a no-op that logs a warning.
   */
  enabled: boolean;
}

/**
 * The service behind `app.physics`.
 *
 * @example
 * ```ts
 * const hit = app.physics.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
 * if (hit !== null) {
 *   app.log.info(`ray hit ${hit.entity.name} at ${String(hit.point.y)}`);
 * }
 * ```
 *
 * @public
 */
export class PhysicsService {
  readonly #app: App;

  readonly #host: PhysicsHost;

  readonly #gravity = new Vec3();

  readonly #rayResult: RayQueryResult = { hit: false, node: null, distance: 0, triangleIndex: -1 };

  readonly #sweepResult: SweepQueryResult = { hit: false, fraction: 0 };

  readonly #point = new Vec3();

  readonly #normal = new Vec3();

  readonly #overlapExtents = new Vec3();

  readonly #overlapResults: Entity[] = [];

  readonly #debugViewer: PhysicsDebugViewer;

  #viewer: LitePhysicsViewer | null = null;

  /**
   * Wraps the holder the extension fills in from `onStart`.
   *
   * @param app - The app the service belongs to.
   * @param host - The holder the runtime lands in.
   * @param settings - The resolved `physics` settings section.
   *
   * @internal
   */
  constructor(app: App, host: PhysicsHost, settings: PhysicsSettings) {
    this.#app = app;
    this.#host = host;
    const gravity = settings.gravity;
    this.#gravity.set(gravity.x, gravity.y, gravity.z);
    this.#debugViewer = new DebugViewerToggle(this);
  }

  /**
   * World gravity in metres per second squared.
   *
   * @returns A live view; writing to it does nothing, assign the property instead.
   */
  get gravity(): Vec3 {
    return this.#gravity;
  }

  /**
   * Replaces world gravity, which every body feels from the next fixed step.
   *
   * @param value - The new acceleration vector, in metres per second squared.
   */
  set gravity(value: Vec3Like) {
    this.#gravity.set(value.x, value.y, value.z);
    this.#rt().setGravity(this.#gravity);
  }

  /**
   * The wireframe overlay.
   *
   * @returns The viewer toggle.
   */
  get debugViewer(): PhysicsDebugViewer {
    return this.#debugViewer;
  }

  /**
   * The Babylon Lite handles.
   *
   * @returns The Havok world and the simulation scene.
   */
  get lite(): PhysicsLiteHandles {
    return { world: this.#rt().world, simulationScene: this.#app.world.lite.simulationScene ?? this.#app.lite.scene };
  }

  /**
   * Casts a ray and returns the first entity it hits (`09-physics.md` §5).
   *
   * @param origin - The world-space origin.
   * @param direction - The direction; it is normalised for you.
   * @param maxDistance - How far to travel; defaults to 10 km.
   * @param options - Layer mask and trigger behaviour.
   * @returns The hit, or `null` when the ray clears everything.
   * @throws IgnifxError with code `IGX-0902` in development when no fixed step has run yet.
   */
  raycast(
    origin: Vec3Like,
    direction: Vec3Like,
    maxDistance: number = DEFAULT_RAY_DISTANCE,
    options?: QueryOptions,
  ): RaycastHit | null {
    this.#requireStep("raycast");
    this.#rt().countQuery();
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (length === 0) {
      return null;
    }
    const scale = maxDistance / length;
    const to = {
      x: origin.x + direction.x * scale,
      y: origin.y + direction.y * scale,
      z: origin.z + direction.z * scale,
    };
    castRay(
      this.#rt().world,
      origin,
      to,
      ALL_LAYERS,
      maskOf(options),
      options?.hitTriggers === true,
      this.#point,
      this.#normal,
      this.#rayResult,
    );
    if (!this.#rayResult.hit) {
      return null;
    }
    const record = this.#rt().recordOfNode(this.#rayResult.node);
    if (record === null) {
      return null;
    }
    return {
      entity: record.entity,
      collider: record.colliders[0] ?? null,
      point: this.#point.clone(),
      normal: this.#normal.clone(),
      distance: this.#rayResult.distance,
      triangleIndex: this.#rayResult.triangleIndex,
    };
  }

  /**
   * Sweeps a shape and returns the first contact (`09-physics.md` §5).
   *
   * @remarks
   * Lite's `shapeCast` reports no body (`index.d.ts` 11497), so `entity` is resolved against the
   * extension's body-bounds index and is bounds-accurate rather than shape-accurate.
   *
   * The sweep itself cannot be filtered by layer — Lite's `ShapeCastQuery` carries no collision
   * masks — so a body outside `layerMask` still stops the sweep; it is merely reported with
   * `entity: null`. What the sweep *can* do is pass through one body, `options.ignore`, which is
   * how a camera boom leaves its target's capsule and a step probe leaves the character's own feet
   * without reporting them at fraction zero (2026-09-08).
   *
   * @param shape - The shape to sweep.
   * @param from - The start position.
   * @param to - The end position.
   * @param options - Layer mask, trigger behaviour, and the one entity to sweep through.
   * @returns The hit, or `null`.
   * @throws IgnifxError with code `IGX-0902` in development when no fixed step has run yet.
   */
  shapeCast(shape: QueryShape, from: Vec3Like, to: Vec3Like, options?: ShapeCastOptions): ShapeCastHit | null {
    this.#requireStep("shapeCast");
    this.#rt().countQuery();
    const ignored = options?.ignore ?? null;
    const ignoredBody = ignored === null ? null : this.#rt().bodyOf(ignored);
    const handle = this.#buildQueryShape(shape);
    try {
      sweepShape(
        this.#rt().world,
        handle,
        Quat.identity(),
        from,
        to,
        options?.hitTriggers === true,
        ignoredBody,
        this.#point,
        this.#normal,
        this.#sweepResult,
      );
    } finally {
      destroyShape(this.#rt().world, handle);
    }
    if (!this.#sweepResult.hit) {
      return null;
    }
    const record = this.#recordAt(this.#point, options, ignored);
    const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) * this.#sweepResult.fraction;
    return {
      entity: record?.entity ?? null,
      collider: record?.colliders[0] ?? null,
      point: this.#point.clone(),
      normal: this.#normal.clone(),
      fraction: this.#sweepResult.fraction,
      distance,
    };
  }

  /**
   * Lists the entities a positioned shape overlaps (`09-physics.md` §5).
   *
   * @remarks
   * Lite's `shapeProximity` reports one hit and no identity (`index.d.ts` 11540,
   * `lib/physics/havok-queries.js:7`), so this is answered from the extension's own bounds index:
   * every registered body whose world bounding box intersects the query shape's. It is conservative
   * — a body whose box overlaps but whose shape does not is listed.
   *
   * @param shape - The query shape.
   * @param position - Its world position.
   * @param rotation - Its world rotation; accepted for forward compatibility and currently unused,
   * because the bounds test is axis-aligned.
   * @param options - Layer mask and trigger behaviour.
   * @returns The overlapping entities, in body creation order. The array is reused between calls.
   * @throws IgnifxError with code `IGX-0902` in development when no fixed step has run yet.
   */
  overlap(shape: QueryShape, position: Vec3Like, rotation?: Quat, options?: QueryOptions): readonly Entity[] {
    void rotation;
    this.#requireStep("overlap");
    this.#rt().countQuery();
    queryHalfExtents(shape, this.#overlapExtents);
    this.#overlapResults.length = 0;
    const records = this.#rt().records;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === undefined || !this.#accepts(record, options)) {
        continue;
      }
      if (boxesOverlap(position, this.#overlapExtents, record.currentPosition, record.halfExtents)) {
        this.#overlapResults.push(record.entity);
      }
    }
    return this.#overlapResults;
  }

  /**
   * How far the nearest body is from a positioned shape, which is the one thing Lite's
   * `shapeProximity` answers exactly.
   *
   * @param shape - The query shape.
   * @param position - Its world position.
   * @param maxDistance - How far to search.
   * @param options - Trigger behaviour.
   * @returns The distance, or `Number.POSITIVE_INFINITY` when nothing is in range.
   * @throws IgnifxError with code `IGX-0902` in development when no fixed step has run yet.
   */
  distanceToNearest(shape: QueryShape, position: Vec3Like, maxDistance: number, options?: QueryOptions): number {
    this.#requireStep("distanceToNearest");
    this.#rt().countQuery();
    const handle = this.#buildQueryShape(shape);
    try {
      return nearestDistance(
        this.#rt().world,
        handle,
        position,
        Quat.identity(),
        maxDistance,
        options?.hitTriggers === true,
      );
    } finally {
      destroyShape(this.#rt().world, handle);
    }
  }

  /**
   * Shows or hides Lite's wireframe bodies.
   *
   * @param enabled - Whether the viewer draws.
   */
  setDebugViewerEnabled(enabled: boolean): void {
    if (enabled === (this.#viewer !== null) || (enabled && this.#host.runtime === null)) {
      return;
    }
    if (!enabled) {
      if (this.#viewer !== null) {
        destroyViewer(this.#viewer);
        this.#viewer = null;
      }
      return;
    }
    if (this.#app.isHeadless) {
      this.#app.log.warn("The physics debug viewer needs a GPU device; a headless app has none.");
      return;
    }
    const viewer = createViewer(this.#app.lite.scene, this.#rt().world);
    this.#viewer = viewer;
    const records = this.#rt().records;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record !== undefined) {
        showBody(viewer, record.body);
      }
    }
  }

  /**
   * Whether the viewer is currently drawing.
   *
   * @returns `true` when a viewer exists.
   */
  isDebugViewerEnabled(): boolean {
    return this.#viewer !== null;
  }

  /** Releases the viewer, if one is up. Called from the extension's `dispose`. */
  dispose(): void {
    this.setDebugViewerEnabled(false);
  }

  /**
   * The runtime, once `onStart` has built it.
   *
   * @returns The runtime.
   * @throws IgnifxError with code `IGX-0903` when Havok has not finished loading, which is only
   * reachable from an extension `onStart` that runs before this one.
   */
  #rt(): PhysicsRuntime {
    const runtime = this.#host.runtime;
    if (runtime === null) {
      throw physicsError(PhysicsErrorCode.havokUnavailable, "The physics world does not exist yet.", {
        hint: "app.physics is usable from the first frame onwards; await app.start() first.",
      });
    }
    return runtime;
  }

  /**
   * Whether at least one fixed step has completed, which is when Havok has built its broadphase and
   * queries become legal (`09-physics.md` §5). A script that queries from `lateUpdate` or `update`
   * checks this on the first frame, where the fixed loop may not have run yet, instead of catching
   * `IGX-0902`.
   *
   * @returns `true` once the first step has run.
   */
  get hasStepped(): boolean {
    return this.#rt().hasStepped;
  }

  /**
   * Refuses a query that ran before Havok built its broadphase (`09-physics.md` §5).
   *
   * @param query - The query name, for the diagnostic.
   * @throws IgnifxError with code `IGX-0902` when no step has completed.
   */
  #requireStep(query: string): void {
    if (this.#rt().hasStepped) {
      return;
    }
    throw physicsError(PhysicsErrorCode.queryBeforeStep, `${query}() ran before the first fixed step.`, {
      context: { query },
      hint: "Step the app at least once (app.step(1 / 60)) before querying; Havok builds its broadphase in the first step.",
    });
  }

  /**
   * Builds a temporary Havok shape for one query. Query shapes are not a per-frame path, so the
   * allocation is deliberate and the shape is released in a `finally`.
   *
   * @param shape - The description.
   * @returns The shape handle.
   */
  #buildQueryShape(shape: QueryShape): LitePhysicsShape {
    const world = this.#rt().world;
    if (shape.kind === "sphere") {
      return createShape(world, ShapeGeometry.sphere, { radius: shape.radius });
    }
    if (shape.kind === "box") {
      return createShape(world, ShapeGeometry.box, {
        extents: shape.size,
        center: { x: 0, y: 0, z: 0 },
        rotation: Quat.identity(),
      });
    }
    const half = Math.max(0, shape.height / 2 - shape.radius);
    return createShape(world, ShapeGeometry.capsule, {
      radius: shape.radius,
      pointA: { x: 0, y: -half, z: 0 },
      pointB: { x: 0, y: half, z: 0 },
    });
  }

  /**
   * Resolves a world-space point to the body whose bounds contain it.
   *
   * @param point - The point.
   * @param options - Layer mask and trigger behaviour.
   * @param ignored - The entity the sweep was told to pass through, which can therefore not be the
   * one it hit.
   * @returns The record, or `null`.
   */
  #recordAt(point: Vec3Like, options: QueryOptions | undefined, ignored: Entity | null = null): BodyRecord | null {
    const records = this.#rt().records;
    let best: BodyRecord | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === undefined || record.entity === ignored || !this.#accepts(record, options)) {
        continue;
      }
      const centre = record.currentPosition;
      const extents = record.halfExtents;
      if (
        Math.abs(point.x - centre.x) > extents.x + BOUNDS_EPSILON ||
        Math.abs(point.y - centre.y) > extents.y + BOUNDS_EPSILON ||
        Math.abs(point.z - centre.z) > extents.z + BOUNDS_EPSILON
      ) {
        continue;
      }
      const distance = Math.hypot(point.x - centre.x, point.y - centre.y, point.z - centre.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = record;
      }
    }
    return best;
  }

  /**
   * Whether a body passes a query's layer and trigger filters.
   *
   * @param record - The body.
   * @param options - The query options.
   * @returns `true` when the body may be reported.
   */
  #accepts(record: BodyRecord, options: QueryOptions | undefined): boolean {
    if ((maskOf(options) & (1 << record.layer)) === 0) {
      return false;
    }
    return options?.hitTriggers === true || !allTriggers(record.colliders);
  }
}

/**
 * The `{ enabled }` object `app.physics.debugViewer` hands out: a property pair rather than two
 * methods, because that is how `09-physics.md` §9 and `@ignifx/devtools` name it.
 */
class DebugViewerToggle implements PhysicsDebugViewer {
  readonly #service: PhysicsService;

  /**
   * Binds the toggle to its service.
   *
   * @param service - The service that owns the viewer.
   */
  constructor(service: PhysicsService) {
    this.#service = service;
  }

  /**
   * Whether the viewer is drawing.
   *
   * @returns `true` when a viewer is up.
   */
  get enabled(): boolean {
    return this.#service.isDebugViewerEnabled();
  }

  set enabled(value: boolean) {
    this.#service.setDebugViewerEnabled(value);
  }
}

/**
 * The 32-bit layer mask a query filters with.
 *
 * @param options - The query options.
 * @returns The mask; every bit when the caller named none.
 */
function maskOf(options: QueryOptions | undefined): number {
  return options?.layerMask?.bits ?? ALL_LAYERS;
}

/**
 * Whether every collider of a body is a trigger, which is what makes the body a trigger volume.
 *
 * @param colliders - The body's colliders.
 * @returns `true` when they are all triggers.
 */
function allTriggers(colliders: readonly Collider[]): boolean {
  if (colliders.length === 0) {
    return false;
  }
  for (let index = 0; index < colliders.length; index += 1) {
    if (colliders[index]?.isTrigger !== true) {
      return false;
    }
  }
  return true;
}

/**
 * The half-extents of a query shape's bounding box.
 *
 * @param shape - The description.
 * @param out - The vector to write.
 */
function queryHalfExtents(shape: QueryShape, out: Vec3): void {
  if (shape.kind === "sphere") {
    out.set(shape.radius, shape.radius, shape.radius);
    return;
  }
  if (shape.kind === "box") {
    out.set(shape.size.x / 2, shape.size.y / 2, shape.size.z / 2);
    return;
  }
  out.set(shape.radius, Math.max(shape.radius, shape.height / 2), shape.radius);
}

/**
 * Whether two axis-aligned boxes overlap.
 *
 * @param firstCentre - The first box's centre.
 * @param firstExtents - The first box's half-extents.
 * @param secondCentre - The second box's centre.
 * @param secondExtents - The second box's half-extents.
 * @returns `true` when they intersect.
 */
function boxesOverlap(
  firstCentre: Vec3Like,
  firstExtents: Vec3Like,
  secondCentre: Vec3Like,
  secondExtents: Vec3Like,
): boolean {
  return (
    Math.abs(firstCentre.x - secondCentre.x) <= firstExtents.x + secondExtents.x &&
    Math.abs(firstCentre.y - secondCentre.y) <= firstExtents.y + secondExtents.y &&
    Math.abs(firstCentre.z - secondCentre.z) <= firstExtents.z + secondExtents.z
  );
}

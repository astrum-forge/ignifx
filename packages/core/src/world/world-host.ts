import type { WorldInternals } from "./world-internals.js";
import type { World } from "./world.js";
import type { App, ErrorReport } from "../app/types.js";
import type { ComponentRegistry } from "../component/component-registry.js";
import type { ComponentStore } from "../component/component-store.js";
import type { Component } from "../component/component.js";
import type { ReferenceTracker } from "../component/reference-tracker.js";
import type { Entity } from "../entity/entity.js";
import type { ComponentHandle } from "../handles/handle.js";
import type { LayerTable } from "../layers/layer-table.js";
import type { FrameStateController } from "../lifecycle/frame-state.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { Signal } from "../signal/signal.js";

/**
 * What an `Entity` and the lifecycle queue need from the world that owns them.
 *
 * @remarks
 * `World` is the only implementation. The interface exists so that `Entity` and `LifecycleQueue`
 * depend on the world by *type* only: without it, `world.ts` would import `entity.ts` to create
 * entities while `entity.ts` imported `world.ts` to reach the registry, and the two modules would
 * form a runtime import cycle (coding standards §4).
 *
 * @internal
 */
export interface WorldHost {
  /** The world itself, as game code sees it. */
  readonly world: World;
  /** The app that owns the world. */
  readonly app: App;
  /** The component-class table. */
  readonly registry: ComponentRegistry;
  /** The live per-type component index behind `world.components(Type)`. */
  readonly store: ComponentStore;
  /** The tracked-reference table. */
  readonly references: ReferenceTracker;
  /** The project's resolved layer names. */
  readonly layers: LayerTable;
  /** Where in the frame the engine is. */
  readonly frameState: FrameStateController;
  /** The lifecycle queues and flushes. */
  readonly lifecycle: WorldInternals;

  /**
   * The next ULID for an entity or component.
   *
   * @returns A fresh identifier.
   */
  nextUid(): string;

  /**
   * The next creation serial — the tie-breaker for `start` and dispatch ordering.
   *
   * @returns A monotonically increasing integer.
   */
  nextSerial(): number;

  /**
   * Issues a dense handle for a component.
   *
   * @param component - The component being attached.
   * @returns Its handle.
   */
  allocateComponentHandle(component: Component): ComponentHandle;

  /**
   * Invalidates a component's handle.
   *
   * @param handle - The handle to release.
   */
  releaseComponentHandle(handle: ComponentHandle): void;

  /**
   * Removes an entity from the world's uid table and handle allocator, and from its scene's roots.
   *
   * @param entity - The entity the destroy flush has finished with.
   */
  releaseEntity(entity: Entity): void;

  /**
   * Creates a signal wired to the app's deferred queue and error reporter, so `{ deferred: true }`
   * works and a throwing handler is reported rather than swallowed.
   *
   * @typeParam T - The payload type.
   * @returns The signal.
   */
  createSignal<T>(): Signal<T>;

  /**
   * Keeps the world's `findByTag` index current.
   *
   * @param entity - The entity whose tags changed.
   * @param tag - The tag added or removed.
   * @param added - `true` for an add, `false` for a delete.
   */
  notifyTagChanged(entity: Entity, tag: string, added: boolean): void;

  /**
   * Moves an entity between scene instances when reparenting crosses a scene boundary
   * (`docs/architecture/02-scene-graph.md` §1).
   *
   * @param entity - The entity being moved, and its whole subtree.
   * @param scene - The instance that now owns it.
   */
  moveToScene(entity: Entity, scene: SceneInstance): void;

  /**
   * Emits `world.onEntityCreated`.
   *
   * @param entity - The new entity.
   */
  notifyEntityCreated(entity: Entity): void;

  /**
   * Emits `world.onEntityDestroyed`.
   *
   * @param entity - The entity the destroy flush has just released.
   */
  notifyEntityDestroyed(entity: Entity): void;

  /**
   * Reports a failure through `app.onError` instead of letting it escape
   * (`docs/architecture/01-lifecycle-and-time.md` §5).
   *
   * @param report - What failed, and where.
   */
  reportError(report: ErrorReport): void;
}

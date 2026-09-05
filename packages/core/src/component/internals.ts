import { toComponentHandle, type ComponentHandle } from "../handles/handle.js";
import type { ComponentClassInfo } from "./component-registry.js";
import type { Component } from "./component.js";
import type { Entity } from "../entity/entity.js";
import type { Signal } from "../signal/signal.js";

/**
 * The engine-owned state of a component, kept off the public type.
 *
 * @remarks
 * Components are constructed with `new Type()` and only *then* handed their entity, uid, and
 * handle, so the state cannot live in constructor parameters. It lives behind a module symbol
 * instead: the property is unreachable by name, invisible to `Object.keys`, and impossible to
 * collide with a schema field — while staying fully typed, with no `any` and no assertion
 * (coding standards §5.2).
 */

/**
 * The key the engine state hangs off. Exported so that `Entity`, the lifecycle queue, and the world
 * can reach it; unreachable from game code, which has no way to name the symbol.
 *
 * @internal
 */
export const COMPONENT_INTERNALS: unique symbol = Symbol("ignifx.component.internals");

/**
 * The engine-owned state of one component.
 *
 * @internal
 */
export interface ComponentInternals {
  /** The owning entity, or `null` between construction and attachment. */
  entity: Entity | null;
  /** The stable ULID, assigned at attachment. */
  uid: string;
  /** The dense runtime handle, assigned at attachment. */
  handle: ComponentHandle;
  /** What the registry worked out about this component's class, assigned at attachment. */
  info: ComponentClassInfo | null;
  /** Monotonic creation serial; the tie-breaker for `start` and dispatch ordering. */
  serial: number;
  /** The component's own enabled flag. */
  enabled: boolean;
  /** `true` between the `onEnable` that ran and the `onDisable` that has not yet. */
  isEnabledNow: boolean;
  /** `true` while an enable transition is waiting for lifecycle flush A. */
  isEnableQueued: boolean;
  /** `true` while a `start` is waiting for lifecycle flush B. */
  isStartQueued: boolean;
  /** `true` once `awake` has run. Never runs twice. */
  hasAwoken: boolean;
  /** `true` once `start` has run. Never runs twice, across any number of enable cycles. */
  hasStarted: boolean;
  /** `true` from the moment `destroy()` is called, long before the destroy flush. */
  isDestroyed: boolean;
  /** `true` once the destroy flush has finished with this component. */
  isReleased: boolean;
  /** `true` while the component sits in the destroy queue, so it is queued at most once. */
  isDestroyQueued: boolean;
  /** Index of this component in each of its class's per-type registry buckets. */
  storeSlots: number[];
  /** Lazily created; `null` until something connects to it. */
  onDestroyed: Signal<Component> | null;
}

/**
 * Reads a component's engine-owned state.
 *
 * @param component - The component.
 * @returns Its internal state.
 *
 * @internal
 */
export function componentInternals(component: Component): ComponentInternals {
  return component[COMPONENT_INTERNALS];
}

/**
 * Builds the initial engine state of a freshly constructed, not yet attached component.
 *
 * @returns The state, with no entity and no identity yet.
 *
 * @internal
 */
export function createComponentInternals(): ComponentInternals {
  return {
    entity: null,
    uid: "",
    handle: toComponentHandle(0),
    info: null,
    serial: 0,
    enabled: true,
    isEnabledNow: false,
    isEnableQueued: false,
    isStartQueued: false,
    hasAwoken: false,
    hasStarted: false,
    isDestroyed: false,
    isReleased: false,
    isDestroyQueued: false,
    storeSlots: [],
    onDestroyed: null,
  };
}

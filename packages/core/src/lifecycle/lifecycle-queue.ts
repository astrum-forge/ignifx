import { implementsCallback } from "../component/component-registry.js";
import { componentInternals } from "../component/internals.js";
import { Entity, applyEntityVisibility } from "../entity/entity.js";
import { entityInternals } from "../entity/internals.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { disposeNode } from "../lite/node.js";
import { Script } from "../script/script.js";
import {
  FIRST_DISPATCHED_CALLBACK,
  SCRIPT_CALLBACK_COUNT,
  SCRIPT_CALLBACK_NAMES,
  ScriptCallbackKind,
  readCallback,
} from "./callbacks.js";
import { ScriptList } from "./script-list.js";
import type { Phase } from "../app/types.js";
import type { ScriptClassInfo } from "../component/component-registry.js";
import type { Component } from "../component/component.js";
import type { ComponentInternals } from "../component/internals.js";
import type { WorldHost } from "../world/world-host.js";
import type { WorldInternals } from "../world/world-internals.js";

/**
 * Route callbacks through one guarded call site so errors are reported and other scripts continue.
 * `awake` waits until the component is effectively enabled. Outside callbacks, enables are queued
 * and disables are immediate; nested changes run synchronously.
 * Destroy children before parents and release each entity's components in attachment order.
 */

/** How many callbacks get a sorted dispatch list. */
const DISPATCH_LIST_COUNT = SCRIPT_CALLBACK_COUNT - FIRST_DISPATCHED_CALLBACK;

/**
 * The lifecycle state machine of one world.
 *
 * @internal
 */
export class LifecycleQueue implements WorldInternals {
  readonly #host: WorldHost;

  readonly #lists: ScriptList[] = [];

  /** Components waiting for `awake`/`onEnable` in flush A. */
  #pendingEnable: Component[] = [];

  /** Components waiting for `start` in flush B. */
  #pendingStart: Component[] = [];

  /** Entities whose subtrees are waiting for the destroy flush. */
  #doomedEntities: Entity[] = [];

  /** Components waiting for the destroy flush on their own. */
  #doomedComponents: Component[] = [];

  /** The phase the scheduler says is running, recorded in error reports. */
  #phase: Phase | null = null;

  /**
   * Creates the queue.
   *
   * @param host - The world that owns it.
   */
  constructor(host: WorldHost) {
    this.#host = host;
    for (let index = 0; index < DISPATCH_LIST_COUNT; index += 1) {
      this.#lists.push(new ScriptList());
    }
  }

  /**
   * Tells the queue which phase is running, so a failure reported through `app.onError` names it.
   *
   * @param phase - The phase, or `null` between phases.
   */
  setPhase(phase: Phase | null): void {
    this.#phase = phase;
  }

  /** Lifecycle flush A. */
  flushAwakeAndEnable(): void {
    while (this.#pendingEnable.length > 0) {
      const batch = this.#pendingEnable;
      this.#pendingEnable = [];
      for (let index = 0; index < batch.length; index += 1) {
        const component = batch[index];
        if (component === undefined) {
          continue;
        }
        const state = componentInternals(component);
        if (!state.isEnableQueued) {
          continue;
        }
        state.isEnableQueued = false;
        if (state.isDestroyed || state.isReleased) {
          continue;
        }
        this.#enable(component, state);
      }
    }
  }

  /** Lifecycle flush B. */
  flushStart(): void {
    const batch = this.#pendingStart;
    if (batch.length === 0) {
      return;
    }
    // The list is swapped before the walk so that a component created inside a `start` queues into
    // the *next* flush B, which is what §4 promises.
    this.#pendingStart = [];
    batch.sort(byExecutionOrderThenSerial);
    for (let index = 0; index < batch.length; index += 1) {
      const component = batch[index];
      if (component === undefined) {
        continue;
      }
      const state = componentInternals(component);
      if (state.hasStarted || state.isReleased || state.isDestroyed) {
        state.isStartQueued = false;
        continue;
      }
      if (!state.isEnabledNow) {
        // Not effectively enabled at this flush: keep the reservation so `start` still runs exactly
        // once, on the first flush B at which the component is enabled.
        this.#pendingStart.push(component);
        continue;
      }
      state.hasStarted = true;
      state.isStartQueued = false;
      this.invokeCallback(component, ScriptCallbackKind.start);
    }
  }

  /** The destroy flush. */
  flushDestroy(): void {
    while (this.#doomedEntities.length > 0 || this.#doomedComponents.length > 0) {
      const entities = this.#doomedEntities;
      const components = this.#doomedComponents;
      this.#doomedEntities = [];
      this.#doomedComponents = [];
      const doomed = new Set<unknown>();
      for (let index = 0; index < entities.length; index += 1) {
        const entity = entities[index];
        if (entity !== undefined) {
          collectSubtree(entity, doomed);
        }
      }
      for (let index = 0; index < components.length; index += 1) {
        const component = components[index];
        if (component !== undefined) {
          doomed.add(component);
        }
      }
      // Tracked references are nulled before any callback runs, so a holder's own `onDestroy`
      // already sees `null` (`docs/architecture/02-scene-graph.md` §4).
      this.#host.references.nullReferencesTo(doomed);
      for (let index = 0; index < components.length; index += 1) {
        const component = components[index];
        if (component !== undefined) {
          this.#releaseComponent(component);
        }
      }
      for (let index = 0; index < entities.length; index += 1) {
        const entity = entities[index];
        if (entity !== undefined) {
          this.#releaseEntity(entity);
        }
      }
    }
  }

  /**
   * Walks one callback's dispatch list.
   *
   * @param kind - Which callback.
   * @param visitor - Called with each script.
   */
  forEachScript(kind: ScriptCallbackKind, visitor: (script: Script) => void): void {
    this.#lists[kind - FIRST_DISPATCHED_CALLBACK]?.forEach(visitor);
  }

  /**
   * One callback's dispatch list.
   *
   * @param kind - Which callback.
   * @returns The sorted, live list.
   */
  scriptsWith(kind: ScriptCallbackKind): readonly Script[] {
    return this.#lists[kind - FIRST_DISPATCHED_CALLBACK]?.items ?? EMPTY_SCRIPTS;
  }

  /**
   * Delivers one callback to every effectively-enabled script on one entity, in component order.
   *
   * @param entity - The entity to deliver to.
   * @param kind - Which callback.
   * @param argument - The callback's single argument.
   */
  dispatchToEntity(entity: Entity, kind: ScriptCallbackKind, argument: unknown): void {
    const internals = entityInternals(entity);
    if (internals.isDestroyed || !internals.activeInHierarchy) {
      return;
    }
    const components = internals.components;
    // Measured once: a script attached by a handler joins the entity only after this dispatch, the
    // same rule `forEachScript` applies to the sorted lists.
    const count = components.length;
    for (let index = 0; index < count; index += 1) {
      const component = components[index];
      if (component !== undefined && canReceiveDispatch(component, kind)) {
        this.invokeCallback(component, kind, argument);
      }
    }
  }

  /**
   * Whether any script on an entity implements a callback, whatever its `enabled` state.
   *
   * @param entity - The entity to inspect.
   * @param kind - Which callback.
   * @returns `true` when at least one of the entity's live scripts implements it.
   */
  entityImplements(entity: Entity, kind: ScriptCallbackKind): boolean {
    const components = entityInternals(entity).components;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component !== undefined && declaresCallback(component, kind)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Invokes one callback on one component, guarded. This is the only place in the engine that calls
   * game code for a lifecycle or frame callback.
   *
   * @param component - The component to call.
   * @param kind - Which callback.
   * @param argument - The callback's single argument, when it takes one.
   */
  invokeCallback(component: Component, kind: ScriptCallbackKind, argument?: unknown): void {
    const state = componentInternals(component);
    const info = state.info;
    if (info === null || !implementsCallback(info.script, kind)) {
      return;
    }
    const name = SCRIPT_CALLBACK_NAMES[kind];
    if (name === undefined) {
      return;
    }
    const callback = readCallback(component, name);
    if (callback === null) {
      return;
    }
    const frameState = this.#host.frameState;
    frameState.beginCallback();
    try {
      callback.call(component, argument);
    } catch (error) {
      this.#host.reportError({
        error,
        source: "lifecycle",
        phase: this.#phase,
        entity: state.entity,
        component,
      });
    } finally {
      frameState.endCallback();
    }
  }

  /**
   * Re-files an effectively-enabled script in the sorted dispatch lists after a hot-reload class
   * swap. Nothing is invoked: this only moves the script between lists and re-sorts it under the
   * new `executionOrder`.
   *
   * @param component - The component whose class was replaced.
   * @param previous - The class info it was filed under.
   * @param next - The class info it is filed under now.
   */
  rebindDispatch(component: Component, previous: ScriptClassInfo | null, next: ScriptClassInfo | null): void {
    if (!(component instanceof Script) || !componentInternals(component).isEnabledNow) {
      return;
    }
    this.#removeFromDispatch(component, previous);
    this.#addToDispatch(component, next);
  }

  /**
   * Recomputes and applies a component's effective enabled state.
   *
   * @param component - The component.
   */
  refreshEnabled(component: Component): void {
    const state = componentInternals(component);
    if (state.isReleased) {
      return;
    }
    const entity = state.entity;
    const target =
      state.enabled && !state.isDestroyed && entity !== null && !entity.isDestroyed && entity.activeInHierarchy;
    const current = state.isEnabledNow || state.isEnableQueued;
    if (target === current) {
      return;
    }
    if (target) {
      if (this.#host.frameState.state.isInsideCallback) {
        this.#enable(component, state);
        return;
      }
      state.isEnableQueued = true;
      this.#pendingEnable.push(component);
      return;
    }
    state.isEnableQueued = false;
    if (state.isEnabledNow) {
      this.#disable(component, state);
    }
  }

  /**
   * Materialises `activeInHierarchy` over a subtree and applies the transitions it implies.
   *
   * @param entity - The subtree root.
   */
  refreshActivation(entity: Entity): void {
    const parent = entityInternals(entity).parent;
    this.#applyActivation(entity, parent === null || parent.activeInHierarchy);
  }

  /**
   * Queues an entity and its subtree for destruction.
   *
   * @param entity - The entity to destroy.
   */
  queueDestroyEntity(entity: Entity): void {
    const internals = entityInternals(entity);
    if (internals.isReleased || internals.isDestroyQueued) {
      return;
    }
    internals.isDestroyQueued = true;
    markSubtreeDestroyed(entity);
    this.#doomedEntities.push(entity);
  }

  /**
   * Queues one component for destruction.
   *
   * @param component - The component to destroy.
   */
  queueDestroyComponent(component: Component): void {
    const state = componentInternals(component);
    if (state.isReleased || state.isDestroyQueued) {
      state.isDestroyed = true;
      return;
    }
    state.isDestroyed = true;
    state.isDestroyQueued = true;
    this.#doomedComponents.push(component);
  }

  /**
   * Destroys an object right now.
   *
   * @param target - The entity or component.
   * @throws IgnifxError with code `IGX-0102` inside a lifecycle callback.
   */
  destroyImmediate(target: Entity | Component): void {
    if (this.#host.frameState.state.isInsideCallback) {
      throw new IgnifxError(
        CoreErrorCode.destroyImmediateInCallback,
        "destroyImmediate() cannot run inside a lifecycle callback; use destroy() instead.",
        {
          context: { phase: "callback" },
          hint: "destroy() queues the object for this frame's destroy flush, which is always safe.",
        },
      );
    }
    if (target instanceof Entity) {
      this.queueDestroyEntity(target);
    } else {
      this.queueDestroyComponent(target);
    }
    this.flushDestroy();
  }

  /** Destroys every entity in the world and releases every list. */
  disposeWorld(): void {
    const scenes = this.#host.world.scenes;
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      if (scene === undefined) {
        continue;
      }
      const roots = scene.roots;
      // A copy: releasing a root removes it from the live list.
      const snapshot = roots.slice();
      for (let root = 0; root < snapshot.length; root += 1) {
        const entity = snapshot[root];
        if (entity !== undefined) {
          this.queueDestroyEntity(entity);
        }
      }
    }
    this.flushDestroy();
    for (let index = 0; index < this.#lists.length; index += 1) {
      this.#lists[index]?.clear();
    }
    this.#pendingEnable.length = 0;
    this.#pendingStart.length = 0;
    this.#host.store.clear();
    this.#host.references.clear();
  }

  /**
   * Runs the enable transition: `awake` once, then `onEnable`, then coroutine resumption, then the
   * `start` reservation.
   *
   * @param component - The component.
   * @param state - Its engine state.
   */
  #enable(component: Component, state: ComponentInternals): void {
    if (state.isEnabledNow || isGone(state)) {
      return;
    }
    state.isEnableQueued = false;
    if (!state.hasAwoken) {
      state.hasAwoken = true;
      const entity = state.entity;
      if (entity !== null) {
        entityInternals(entity).hasAwoken = true;
      }
      this.invokeCallback(component, ScriptCallbackKind.awake);
      // `awake` is game code: it may have destroyed the very component it was called on. The read
      // goes through a helper so the narrowing from the guard above does not hide the fresh value.
      if (isGone(state)) {
        return;
      }
    }
    state.isEnabledNow = true;
    const scriptInfo = state.info?.script ?? null;
    if (component instanceof Script) {
      this.#addToDispatch(component, scriptInfo);
    }
    this.invokeCallback(component, ScriptCallbackKind.onEnable);
    if (component instanceof Script) {
      this.#host.app.coroutines.setPaused(component, false);
    }
    if (!state.hasStarted && !state.isStartQueued && implementsCallback(scriptInfo, ScriptCallbackKind.start)) {
      state.isStartQueued = true;
      this.#pendingStart.push(component);
    }
  }

  /**
   * Runs the disable transition: leave the dispatch lists, `onDisable`, then coroutine pausing.
   *
   * @param component - The component.
   * @param state - Its engine state.
   */
  #disable(component: Component, state: ComponentInternals): void {
    if (!state.isEnabledNow) {
      return;
    }
    state.isEnabledNow = false;
    if (component instanceof Script) {
      this.#removeFromDispatch(component, state.info?.script ?? null);
    }
    this.invokeCallback(component, ScriptCallbackKind.onDisable);
    if (component instanceof Script) {
      this.#host.app.coroutines.setPaused(component, true);
    }
  }

  /**
   * Files a script in the dispatch list of every callback its class implements.
   *
   * @param script - The script that just became effectively enabled.
   * @param info - Its class's callback mask and ordering, or `null` when it has none.
   */
  #addToDispatch(script: Script, info: ScriptClassInfo | null): void {
    if (info === null) {
      return;
    }
    for (let kind = FIRST_DISPATCHED_CALLBACK; kind < SCRIPT_CALLBACK_COUNT; kind += 1) {
      if ((info.callbacks & (1 << kind)) !== 0) {
        this.#lists[kind - FIRST_DISPATCHED_CALLBACK]?.insert(script, info);
      }
    }
  }

  /**
   * Removes a script from every dispatch list it was filed in.
   *
   * @param script - The script that stopped being effectively enabled.
   * @param info - Its class's callback mask, or `null` when it has none.
   */
  #removeFromDispatch(script: Script, info: ScriptClassInfo | null): void {
    if (info === null) {
      return;
    }
    for (let kind = FIRST_DISPATCHED_CALLBACK; kind < SCRIPT_CALLBACK_COUNT; kind += 1) {
      if ((info.callbacks & (1 << kind)) !== 0) {
        this.#lists[kind - FIRST_DISPATCHED_CALLBACK]?.remove(script);
      }
    }
  }

  /**
   * Applies an effective activation to an entity and recurses into its children.
   *
   * @param entity - The entity.
   * @param parentActive - Whether every ancestor is active.
   */
  #applyActivation(entity: Entity, parentActive: boolean): void {
    const internals = entityInternals(entity);
    const next = parentActive && internals.active && !internals.isDestroyed;
    internals.activeInHierarchy = next;
    // Written unconditionally rather than only on a change: Lite materialises visibility at write
    // time, so a node linked under a hidden parent does not inherit the state and has to be told
    // (ADR-0003 Validation).
    applyEntityVisibility(entity, next);
    const components = internals.components;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component !== undefined) {
        this.refreshEnabled(component);
      }
    }
    const children = internals.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child !== undefined) {
        this.#applyActivation(child, next);
      }
    }
  }

  /**
   * Releases one entity's subtree, children before parents.
   *
   * @param entity - The subtree root.
   */
  #releaseEntity(entity: Entity): void {
    const internals = entityInternals(entity);
    if (internals.isReleased) {
      return;
    }
    const children = internals.children.slice();
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child !== undefined) {
        this.#releaseEntity(child);
      }
    }
    const components = internals.components;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component !== undefined) {
        const state = componentInternals(component);
        if (state.isEnabledNow) {
          this.#disable(component, state);
        }
      }
    }
    // A copy: releasing a component splices it out of the live list.
    const snapshot = components.slice();
    for (let index = 0; index < snapshot.length; index += 1) {
      const component = snapshot[index];
      if (component !== undefined) {
        this.#releaseComponent(component);
      }
    }
    internals.isDestroyed = true;
    internals.isReleased = true;
    const parent = internals.parent;
    if (parent !== null && !entityInternals(parent).isReleased) {
      const siblings = entityInternals(parent).children;
      const at = siblings.indexOf(entity);
      if (at >= 0) {
        siblings.splice(at, 1);
      }
    }
    internals.children.length = 0;
    disposeNode(internals.node);
    this.#host.releaseEntity(entity);
    internals.onDestroyed?.emit(entity);
    this.#host.notifyEntityDestroyed(entity);
  }

  /**
   * Releases one component: `onDisable` if it is still enabled, `onDestroy`, coroutine
   * cancellation, `onDetach`, then every index that referred to it.
   *
   * @param component - The component.
   */
  #releaseComponent(component: Component): void {
    const state = componentInternals(component);
    if (state.isReleased) {
      return;
    }
    state.isDestroyed = true;
    if (state.isEnabledNow) {
      this.#disable(component, state);
    }
    this.invokeCallback(component, ScriptCallbackKind.onDestroy);
    if (component instanceof Script) {
      this.#host.app.coroutines.cancelAll(component);
    }
    state.isReleased = true;
    const info = state.info;
    if (info !== null) {
      this.#host.store.remove(component, info);
    }
    this.#host.references.unwatch(component);
    this.#host.releaseComponentHandle(state.handle);
    const entity = state.entity;
    if (entity !== null) {
      const entityState = entityInternals(entity);
      const siblings = entityState.components;
      const at = siblings.indexOf(component);
      if (at >= 0) {
        siblings.splice(at, 1);
      }
      entityState.onComponentRemoved?.emit(component);
    }
    try {
      readCallback(component, "onDetach")?.call(component);
    } catch (error) {
      this.#host.reportError({ error, source: "lifecycle", phase: this.#phase, entity, component });
    }
    state.onDestroyed?.emit(component);
  }
}

/**
 * Whether a component has been destroyed or already released.
 *
 * @param state - The component's engine state.
 * @returns `true` when the component must not receive further callbacks.
 */
function isGone(state: ComponentInternals): boolean {
  return state.isDestroyed || state.isReleased;
}

/**
 * Whether a component still on an entity implements a callback and is not on its way out.
 *
 * @param component - The component.
 * @param kind - The callback ordinal.
 * @returns `true` when the component's class implements the callback.
 */
function declaresCallback(component: Component, kind: ScriptCallbackKind): boolean {
  const state = componentInternals(component);
  const info = state.info;
  return info !== null && !isGone(state) && implementsCallback(info.script, kind);
}

/**
 * Whether a component should receive a per-entity dispatch: effectively enabled, not destroyed, and
 * implementing the callback.
 *
 * @param component - The component.
 * @param kind - The callback ordinal.
 * @returns `true` when the callback must be delivered to it.
 */
function canReceiveDispatch(component: Component, kind: ScriptCallbackKind): boolean {
  return componentInternals(component).isEnabledNow && declaresCallback(component, kind);
}

/** Shared empty dispatch list for a kind that has none. */
const EMPTY_SCRIPTS: readonly Script[] = Object.freeze([]);

/**
 * Marks an entity, its components, and its whole subtree as destroyed, immediately
 * (`docs/architecture/01-lifecycle-and-time.md` §6).
 *
 * @param entity - The subtree root.
 */
function markSubtreeDestroyed(entity: Entity): void {
  const internals = entityInternals(entity);
  internals.isDestroyed = true;
  internals.isDestroyQueued = true;
  const components = internals.components;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component !== undefined) {
      componentInternals(component).isDestroyed = true;
    }
  }
  const children = internals.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined) {
      markSubtreeDestroyed(child);
    }
  }
}

/**
 * Collects an entity, its components, and its subtree into the doomed set the reference tracker
 * scans.
 *
 * @param entity - The subtree root.
 * @param out - The set to fill.
 */
function collectSubtree(entity: Entity, out: Set<unknown>): void {
  out.add(entity);
  const internals = entityInternals(entity);
  const components = internals.components;
  for (let index = 0; index < components.length; index += 1) {
    out.add(components[index]);
  }
  const children = internals.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined) {
      collectSubtree(child, out);
    }
  }
}

/**
 * Orders the flush B queue by `(executionOrder, creation serial)`.
 *
 * @param a - The first component.
 * @param b - The second component.
 * @returns A negative number when `a` starts first.
 */
function byExecutionOrderThenSerial(a: Component, b: Component): number {
  const left = componentInternals(a);
  const right = componentInternals(b);
  const leftOrder = left.info?.script?.executionOrder ?? 0;
  const rightOrder = right.info?.script?.executionOrder ?? 0;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.serial - right.serial;
}

import type { Phase } from "../app/types.js";
import type { Component } from "../component/component.js";
import type { Entity } from "../entity/entity.js";
import type { ScriptCallbackKind } from "../lifecycle/callbacks.js";
import type { Script } from "../script/script.js";

/**
 * The lifecycle API the scheduler drives and the scene graph feeds, reached as `world.lifecycle`.
 *
 * @remarks
 * This is the seam between the two halves of the kernel: everything in
 * `docs/architecture/01-lifecycle-and-time.md` §3 that the frame function calls on the world is
 * declared here, and nothing else. Game code never touches it.
 *
 * @internal
 */
export interface WorldInternals {
  /**
   * Lifecycle flush A (`01-lifecycle-and-time.md` §3 step 3): `awake` for components that became
   * part of an active hierarchy since the last flush, then `onEnable` for components that became
   * effectively enabled. Drains until empty, so a component created inside an `awake` is handled in
   * the same flush.
   */
  flushAwakeAndEnable(): void;

  /**
   * Lifecycle flush B (`01-lifecycle-and-time.md` §3 step 5): `start` for effectively-enabled
   * scripts that have not started, in `(executionOrder, creation serial)` order. A script that was
   * disabled again before the flush keeps its place in the queue and starts on the first flush at
   * which it is effectively enabled.
   */
  flushStart(): void;

  /**
   * The destroy flush (`01-lifecycle-and-time.md` §3 step 9): tracked references are nulled, then
   * every queued entity's subtree is released children before parents, `onDisable` before
   * `onDestroy`, components in attach order, Lite nodes released last.
   */
  flushDestroy(): void;

  /**
   * Calls a visitor for every effectively-enabled script that implements a callback, in
   * `(executionOrder, creation serial)` order.
   *
   * @remarks
   * Safe against mutation during the walk: a script disabled or destroyed by the visitor is skipped
   * for the rest of this walk, and a script enabled by the visitor joins the list only after the
   * walk finishes — so it first receives the callback on the next frame, matching the rule that a
   * component created inside a callback has its `start` deferred to the next flush B
   * (`01-lifecycle-and-time.md` §4).
   *
   * @param kind - Which callback to dispatch.
   * @param visitor - Called with each script; it is the caller's job to invoke the callback.
   */
  forEachScript(kind: ScriptCallbackKind, visitor: (script: Script) => void): void;

  /**
   * The sorted dispatch list for a callback.
   *
   * @param kind - Which callback.
   * @returns The live list of effectively-enabled scripts implementing it, sorted by
   * `(executionOrder, creation serial)`. Prefer {@link WorldInternals.forEachScript}, which is safe
   * against mutation while iterating.
   */
  scriptsWith(kind: ScriptCallbackKind): readonly Script[];

  /**
   * Invokes one callback on one component through the engine's single guarded call site: the frame
   * state is set for the duration, and anything the callback throws is reported to `app.onError`
   * with the entity and component identified rather than escaping the frame
   * (`01-lifecycle-and-time.md` §5). The scheduler dispatches `fixedUpdate`, `update`,
   * `lateUpdate`, the collision and trigger family, and the application callbacks through it.
   *
   * @param component - The component to call.
   * @param kind - Which callback.
   * @param argument - The callback's single argument, when it takes one (`dt`, a collision, a
   * trigger, or a boolean).
   */
  invokeCallback(component: Component, kind: ScriptCallbackKind, argument?: unknown): void;

  /**
   * Delivers one callback to every effectively-enabled script on a single entity, in component
   * order, through {@link WorldInternals.invokeCallback}. This is what
   * `ExtensionContext.dispatchScriptCallback` routes through, so a physics extension never calls a
   * script callback itself (`docs/architecture/03-scripting-and-components.md` §6,
   * `04-extensions.md` §1).
   *
   * @remarks
   * A destroyed entity, or one that is not active in the hierarchy, receives nothing. The entity's
   * component list is measured once, so a script attached by a handler is not called during the
   * same dispatch — the rule {@link WorldInternals.forEachScript} follows for the sorted lists.
   * Nothing is allocated on the steady path.
   *
   * @param entity - The entity to deliver to.
   * @param kind - Which callback.
   * @param argument - The callback's single argument.
   */
  dispatchToEntity(entity: Entity, kind: ScriptCallbackKind, argument: unknown): void;

  /**
   * Whether any script on an entity implements a callback, whatever its `enabled` state.
   *
   * @remarks
   * Enable state is deliberately ignored: the physics extension recomputes `Rigidbody`
   * `collisionEvents` when a component is added or removed (`09-physics.md` §2.1), and that answer
   * must not flip every time a script is toggled. Components already queued for destruction do not
   * count, so the answer is correct inside an `Entity.onComponentRemoved` handler.
   *
   * @param entity - The entity to inspect.
   * @param kind - Which callback.
   * @returns `true` when at least one of the entity's scripts implements it.
   */
  entityImplements(entity: Entity, kind: ScriptCallbackKind): boolean;

  /**
   * Tells the world which phase is running, so a failure reported through `app.onError` names it.
   * The scheduler sets it on entering a phase and clears it on leaving.
   *
   * @param phase - The phase, or `null` between phases.
   */
  setPhase(phase: Phase | null): void;

  /**
   * Recomputes whether a component is effectively enabled and runs the resulting transition. Called
   * by the `enabled` setter, by entity activation, and at the end of `addComponent`.
   *
   * @param component - The component whose state may have changed.
   */
  refreshEnabled(component: Component): void;

  /**
   * Materialises `activeInHierarchy` over an entity's subtree and runs the enable and disable
   * transitions the change implies, plus the Lite visibility cascade
   * (`01-lifecycle-and-time.md` §6).
   *
   * @param entity - The subtree root whose own `active` flag or parent changed.
   */
  refreshActivation(entity: Entity): void;

  /**
   * Queues an entity and its whole subtree for the destroy flush.
   *
   * @param entity - The entity to destroy.
   */
  queueDestroyEntity(entity: Entity): void;

  /**
   * Queues one component for the destroy flush.
   *
   * @param component - The component to destroy.
   */
  queueDestroyComponent(component: Component): void;

  /**
   * Runs the destroy flush right now, for tooling and tests.
   *
   * @param target - The entity or component to destroy immediately.
   * @throws IgnifxError with code `IGX-0102` when called from inside a lifecycle callback.
   */
  destroyImmediate(target: Entity | Component): void;

  /**
   * Destroys every entity in the world, cancels every coroutine, and releases every Lite node, in
   * the same order the destroy flush uses.
   */
  disposeWorld(): void;
}

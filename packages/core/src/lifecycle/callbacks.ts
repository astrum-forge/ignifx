/**
 * The script callbacks the engine dispatches, as ordinals
 * (`docs/architecture/01-lifecycle-and-time.md` §4). Numbering them lets the registry record which
 * callbacks a class implements as one bit mask, and lets the world keep one sorted dispatch list
 * per callback — so a frame never inspects a prototype and never looks a callback up by name
 * (coding standards §7).
 */

/**
 * Every script callback, numbered. The first five are driven by the lifecycle flushes; the rest are
 * dispatched from a phase and therefore get a sorted dispatch list.
 *
 * @public
 */
export const ScriptCallbackKind = {
  /** `awake()` — once, when the script first becomes effectively enabled. */
  awake: 0,
  /** `onEnable()` — on every transition to effectively enabled. */
  onEnable: 1,
  /** `start()` — once, in flush B of the first frame the script is effectively enabled. */
  start: 2,
  /** `onDisable()` — on every transition off, including just before destruction. */
  onDisable: 3,
  /** `onDestroy()` — once, in the destroy flush. */
  onDestroy: 4,
  /** `fixedUpdate(dt)` — once per fixed step. */
  fixedUpdate: 5,
  /** `update(dt)` — once per frame. */
  update: 6,
  /** `lateUpdate(dt)` — once per frame, after animation. */
  lateUpdate: 7,
  /** `onCollisionEnter(collision)`. */
  onCollisionEnter: 8,
  /** `onCollisionStay(collision)`. */
  onCollisionStay: 9,
  /** `onCollisionExit(collision)`. */
  onCollisionExit: 10,
  /** `onTriggerEnter(trigger)`. */
  onTriggerEnter: 11,
  /** `onTriggerExit(trigger)`. */
  onTriggerExit: 12,
  /** `onApplicationPause(paused)`. */
  onApplicationPause: 13,
  /** `onApplicationFocus(focused)`. */
  onApplicationFocus: 14,
} as const;

/**
 * The union of script callback ordinals.
 *
 * @public
 */
export type ScriptCallbackKind = (typeof ScriptCallbackKind)[keyof typeof ScriptCallbackKind];

/**
 * How many callbacks `ScriptCallbackKind` declares.
 *
 * @public
 */
export const SCRIPT_CALLBACK_COUNT = 15;

/**
 * The first callback that is dispatched from a phase rather than from a lifecycle flush. Only these
 * get a sorted dispatch list on the world.
 *
 * @public
 */
export const FIRST_DISPATCHED_CALLBACK: ScriptCallbackKind = ScriptCallbackKind.fixedUpdate;

/**
 * The method name of each callback, indexed by its ordinal. The engine reads a callback off a
 * script's prototype exactly once, at registration; this table is what makes that possible without
 * hard-coding fifteen `if` branches.
 *
 * @public
 */
export const SCRIPT_CALLBACK_NAMES: readonly string[] = Object.freeze([
  "awake",
  "onEnable",
  "start",
  "onDisable",
  "onDestroy",
  "fixedUpdate",
  "update",
  "lateUpdate",
  "onCollisionEnter",
  "onCollisionStay",
  "onCollisionExit",
  "onTriggerEnter",
  "onTriggerExit",
  "onApplicationPause",
  "onApplicationFocus",
]);

/**
 * A lifecycle callback as the engine calls it. Every script callback takes at most one argument —
 * `dt`, a collision, a trigger, or a boolean — so one optional `unknown` covers all fifteen, and
 * the single call site that knows which callback it is supplies the right value.
 *
 * @internal
 */
export type CallbackFunction = (argument?: unknown) => void;

/**
 * Reads a callback off an object, if it implements one.
 *
 * @remarks
 * A script's callbacks are ordinary optional methods that the `Script` class deliberately does not
 * declare (see `ScriptCallbacks`), so the type system has nothing to index. This is the single
 * boundary where the engine looks a callback up by name, and it happens once per class at
 * registration — never per entity per frame (coding standards §7).
 *
 * @param target - The instance or prototype to read.
 * @param name - The callback name from {@link SCRIPT_CALLBACK_NAMES}.
 * @returns The function, or `null` when the object does not implement that callback.
 *
 * @internal
 */
export function readCallback(target: object, name: string): CallbackFunction | null {
  // The invariant is that a JavaScript object can be
  // read as a string-keyed bag; the `typeof` check below is what makes the result safe.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const bag = target as Record<string, unknown>;
  const value = bag[name];
  if (typeof value !== "function") {
    return null;
  }
  // The value is known to be callable; its parameters
  // are supplied by the single call site that knows which callback this is.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as CallbackFunction;
}

/**
 * The physics callbacks an extension may deliver through `ExtensionContext.dispatchScriptCallback`,
 * named rather than numbered (`docs/architecture/09-physics.md` §4). The ordinals in
 * `ScriptCallbackKind` are engine plumbing and may be renumbered; these five names are the
 * contract `@ignifx/physics` is written against.
 *
 * @example
 * ```ts
 * ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onTriggerEnter, event);
 * ```
 *
 * @beta
 */
export const PhysicsCallbackName = {
  /** `onCollisionEnter(collision)`. */
  onCollisionEnter: "onCollisionEnter",
  /** `onCollisionStay(collision)`. */
  onCollisionStay: "onCollisionStay",
  /** `onCollisionExit(collision)`. */
  onCollisionExit: "onCollisionExit",
  /** `onTriggerEnter(trigger)`. */
  onTriggerEnter: "onTriggerEnter",
  /** `onTriggerExit(trigger)`. */
  onTriggerExit: "onTriggerExit",
} as const;

/**
 * The union of the physics callback names.
 *
 * @beta
 */
export type PhysicsCallbackName = (typeof PhysicsCallbackName)[keyof typeof PhysicsCallbackName];

/**
 * The ordinal each physics callback name stands for, resolved from a frozen table so that a
 * dispatch never looks a callback up by string on a per-script path (coding standards §7).
 */
const PHYSICS_CALLBACK_KINDS: Readonly<Record<PhysicsCallbackName, ScriptCallbackKind>> = Object.freeze({
  onCollisionEnter: ScriptCallbackKind.onCollisionEnter,
  onCollisionStay: ScriptCallbackKind.onCollisionStay,
  onCollisionExit: ScriptCallbackKind.onCollisionExit,
  onTriggerEnter: ScriptCallbackKind.onTriggerEnter,
  onTriggerExit: ScriptCallbackKind.onTriggerExit,
});

/**
 * Resolves a physics callback name to its `ScriptCallbackKind` ordinal, once per dispatch.
 *
 * @param name - The callback name an extension asked for.
 * @returns The ordinal, which is also the bit index in `ScriptClassInfo.callbacks`.
 *
 * @internal
 */
export function physicsCallbackKind(name: PhysicsCallbackName): ScriptCallbackKind {
  return PHYSICS_CALLBACK_KINDS[name];
}

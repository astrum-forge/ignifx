import { Component } from "../component/component.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import type { Coroutine, CoroutineHandle } from "../app/types.js";
import type { FieldsOf, Schema } from "../schema/types.js";

/**
 * A component that receives the engine lifecycle (`docs/architecture/03-scripting-and-components.md`
 * §2). This is the Unity `MonoBehaviour` role and the primary way game code is written.
 *
 * @remarks
 * **Where the callbacks are declared.** `awake`, `update`, `onCollisionEnter` and the rest are
 * not* members of this class. Declaring them here would make every implementation an override, and
 * `noImplicitOverride` (coding standards §3) would then demand an `override` modifier on every
 * `update` in every game — which the documented examples do not carry, and which would be a tax on
 * the most-written method in the engine. They live in {@link ScriptCallbacks} instead; write
 * `implements ScriptCallbacks` to have their signatures checked. The engine detects which callbacks
 * a class implements once, by inspecting the prototype at registration, so an empty `update() {}`
 * costs a call per frame and not defining it costs nothing.
 *
 * **The statics work the same way.** `typeId`, `schema`, `requires`, `allowMultiple`,
 * `executionOrder`, and `updateWhenPaused` are not members of `Component` or `Script` either: a
 * static declared on the base class is an override too, so `static typeId = "mygame/Mover"` would
 * have needed an `override` modifier. Their shape lives on {@link ComponentStatics} and
 * {@link ScriptStatics}, which the class-token types intersect, so a plain `static` on a subclass
 * satisfies them structurally; `ComponentRegistry` reads each one once per class and applies the
 * defaults (`executionOrder` `0`, `updateWhenPaused` `false`).
 *
 * @example
 * ```ts
 * class Mover extends Script.define({ speed: f32(5) }) implements ScriptCallbacks {
 *   static typeId = "mygame/Mover";
 *   static executionOrder = -10;
 *
 *   update(dt: number): void {
 *     this.transform.translate({ x: 0, y: 0, z: this.speed * dt });
 *   }
 * }
 * ```
 *
 * @public
 */
export abstract class Script extends Component {
  /**
   * Declares a script's serialized fields and returns the base class to extend — the `Script`
   * counterpart of `Component.define`.
   *
   * @typeParam S - The schema being declared.
   * @param schema - The field definitions, keyed by the property name they become.
   * @returns An abstract class to extend.
   * @throws IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
   * with a `Component`/`Script` member.
   *
   * @example
   * ```ts
   * class Patrol extends Script.define({ waypoints: array(vec3()), speed: f32(3) }) {
   *   static typeId = "mygame/Patrol";
   * }
   * ```
   */
  static override define<const S extends Schema>(schema: S): ScriptDefinition<S> {
    const fields = defineSchema(schema);
    abstract class Defined extends Script {
      static schema: Schema = fields;

      constructor() {
        super();
        Object.assign(this, createDefaults(fields));
      }
    }
    // Boundary assertion (coding standards §5.2); the invariant is the one stated on
    // `Component.define`: the constructor assigns exactly the schema's keys.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Defined as unknown as ScriptDefinition<S>;
  }

  /**
   * Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
   * coroutine is paused while the script is not effectively enabled and cancelled when it is
   * destroyed.
   *
   * @param routine - The generator to drive. Call the generator function: `this.spawnLoop()`.
   * @returns A handle for stopping it or waiting on it.
   *
   * @example
   * ```ts
   * blink() {
   *   while (true) {
   *     this.renderer.enabled = !this.renderer.enabled;
   *     yield waitSeconds(0.2);
   *   }
   * }
   * onEnable(): void {
   *   this.startCoroutine(this.blink());
   * }
   * ```
   */
  startCoroutine(routine: Coroutine): CoroutineHandle {
    return this.app.coroutines.start(this, routine);
  }

  /**
   * Stops one coroutine this script started. Stopping a finished coroutine is a no-op.
   *
   * @param handle - The handle {@link Script.startCoroutine} returned.
   */
  stopCoroutine(handle: CoroutineHandle): void {
    this.app.coroutines.stop(handle);
  }

  /** Stops every coroutine this script started. */
  stopAllCoroutines(): void {
    this.app.coroutines.stopAll(this);
  }
}

/**
 * Every callback a script may implement, with the signature the engine calls it with
 * (`docs/architecture/01-lifecycle-and-time.md` §4). All of them are optional; implement only the
 * ones the script needs.
 *
 * @remarks
 * The interface is deliberately not merged into {@link Script} — see the note there. Adding
 * `implements ScriptCallbacks` to a script is free at run time and checks that every callback the
 * class does implement has the right name and signature.
 *
 * @example
 * ```ts
 * class Door extends Script implements ScriptCallbacks {
 *   awake(): void {
 *     this.body = this.requireComponent(Rigidbody);
 *   }
 *   fixedUpdate(dt: number): void {
 *     this.body.move(dt);
 *   }
 * }
 * ```
 *
 * @public
 */
export interface ScriptCallbacks {
  /**
   * Runs once, the first time the script becomes effectively enabled inside a loaded world. During
   * a scene load it runs after every entity and component of that scene instance exists, in tree
   * order, with `entityRef`/`componentRef` fields already resolved.
   */
  awake?(): void;
  /** Runs after `awake`, and on every later transition to effectively enabled. */
  onEnable?(): void;
  /** Runs once, in the first frame the script is effectively enabled, after the fixed loop. */
  start?(): void;
  /**
   * Runs once per fixed step, before physics.
   *
   * @param dt - The fixed step in seconds; always `time.fixedDeltaTime`.
   */
  fixedUpdate?(dt: number): void;
  /**
   * Runs once per frame.
   *
   * @param dt - Scaled seconds since the previous frame.
   */
  update?(dt: number): void;
  /**
   * Runs once per frame, after animation has posed the scene.
   *
   * @param dt - Scaled seconds since the previous frame.
   */
  lateUpdate?(dt: number): void;
  /** Runs on every transition off effectively enabled, including just before destruction. */
  onDisable?(): void;
  /** Runs once, in the destroy flush of the frame `destroy()` was called in. */
  onDestroy?(): void;
  /**
   * Runs when a contact begins, inside the fixed loop after the physics step.
   *
   * @param collision - The contact, supplied by the physics extension.
   */
  onCollisionEnter?(collision: unknown): void;
  /**
   * Runs while a contact persists.
   *
   * @param collision - The contact.
   */
  onCollisionStay?(collision: unknown): void;
  /**
   * Runs when a contact ends.
   *
   * @param collision - The contact.
   */
  onCollisionExit?(collision: unknown): void;
  /**
   * Runs when an overlap with a trigger shape begins.
   *
   * @param trigger - The overlap, supplied by the physics extension.
   */
  onTriggerEnter?(trigger: unknown): void;
  /**
   * Runs when an overlap with a trigger shape ends.
   *
   * @param trigger - The overlap.
   */
  onTriggerExit?(trigger: unknown): void;
  /**
   * Runs when the document is hidden or shown, or the Electron window is minimized or restored.
   *
   * @param paused - `true` when the app just became hidden.
   */
  onApplicationPause?(paused: boolean): void;
  /**
   * Runs on window focus changes.
   *
   * @param focused - `true` when the window just gained focus.
   */
  onApplicationFocus?(focused: boolean): void;
}

/**
 * The abstract base class {@link Script.define} returns: a `Script` that also carries every field
 * the schema declares, typed.
 *
 * @typeParam S - The schema the class was defined from.
 *
 * @public
 */
export type ScriptDefinition<S extends Schema> = (abstract new () => Script & FieldsOf<S>) & {
  /** The instance shape, so the class satisfies `ComponentType`. */
  readonly prototype: Script & FieldsOf<S>;
  /**
   * The schema the class was defined from, carried as a value on the returned class. The other
   * statics ({@link ScriptStatics}) are deliberately *not* declared here: a subclass must be able
   * to write a plain `static typeId` or `static executionOrder` without the `override` keyword.
   */
  readonly schema: S;
};

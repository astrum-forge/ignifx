import { Signal } from "@ignifx/core";
import { Binding } from "../bindings/binding.js";
import type { ActionMap } from "./action-map.js";
import type { ActionDefinition, InputActionType } from "../asset/definition.js";
import type { BindingContext, BindingResolver } from "../bindings/binding.js";
import type { ControlValue } from "../bindings/processors.js";
import type { DeviceKind } from "../devices/device.js";
import type { SignalLike, Vec2Like } from "@ignifx/core";

/**
 * An action (`docs/architecture/08-input.md` §2): the thing game code binds to. Its state is
 * resolved once per frame in `PreUpdate` and is then stable for the whole frame, including every
 * fixed step (`01-lifecycle-and-time.md` §3 step 2, §4).
 */

/**
 * The payload of {@link InputAction.onStarted}, {@link InputAction.onPerformed}, and
 * {@link InputAction.onCanceled}.
 *
 * @remarks
 * One event object is reused per action, so a handler that needs the values after its call returns
 * must copy them. Reusing it is what keeps the steady frame allocation-free (coding standards §7).
 *
 * @public
 */
export interface InputActionEvent {
  /** The action that changed. */
  readonly action: InputAction;
  /** Which signal is delivering: `started`, `performed`, or `canceled`. */
  readonly phase: "started" | "performed" | "canceled";
  /** The action's magnitude this frame, in `[0, 1]` for normalised controls. */
  readonly magnitude: number;
  /** The x component of the action's value. */
  readonly x: number;
  /** The y component of the action's value; `0` unless the action is a `vector2`. */
  readonly y: number;
}

/** The mutable half of {@link InputActionEvent}, which only the action itself writes. */
interface MutableActionEvent {
  action: InputAction;
  phase: "started" | "performed" | "canceled";
  magnitude: number;
  x: number;
  y: number;
}

/**
 * A live, allocation-free view of an action's `vector2` value.
 *
 * @public
 */
export class ActionVector implements Vec2Like {
  readonly #values: Float32Array;

  /**
   * Wraps the two slots an action keeps its value in.
   *
   * @param values - The action's value array.
   */
  constructor(values: Float32Array) {
    this.#values = values;
  }

  /**
   * The x component, read from the action's live value.
   *
   * @returns The current x.
   */
  get x(): number {
    return this.#values[0] ?? 0;
  }

  /**
   * The y component, read from the action's live value.
   *
   * @returns The current y.
   */
  get y(): number {
    return this.#values[1] ?? 0;
  }
}

/**
 * One input action (`docs/architecture/08-input.md` §2).
 *
 * @example
 * ```ts
 * class Player extends Script {
 *   update(dt: number): void {
 *     const move = this.app.input.actions.get("move");
 *     this.transform.translate({ x: move.vector.x * dt, y: 0, z: move.vector.y * dt });
 *     if (this.app.input.actions.get("jump").wasPressedThisFrame) {
 *       this.jump();
 *     }
 *   }
 * }
 * ```
 *
 * @public
 */
export class InputAction {
  /** The action name game code asks for. */
  readonly name: string;

  /** The map the action belongs to. */
  readonly map: ActionMap;

  /** What the action produces. */
  readonly type: InputActionType;

  /** Whether this action resolves at all. An action in a disabled map reads as released too. */
  enabled = true;

  /** Emitted the frame the action is first actuated. */
  readonly onStarted: Signal<InputActionEvent>;

  /** Emitted when the action is pressed and whenever its value changes while actuated. */
  readonly onPerformed: Signal<InputActionEvent>;

  /** Emitted the frame the action returns to rest. */
  readonly onCanceled: Signal<InputActionEvent>;

  readonly #bindings: readonly Binding[];

  readonly #values = new Float32Array(2);

  readonly #vector: ActionVector;

  readonly #scratch: ControlValue = { x: 0, y: 0 };

  readonly #event: MutableActionEvent;

  #magnitude = 0;

  #activeDevice: DeviceKind | null = null;

  #isPressed = false;

  #wasPressedThisFrame = false;

  #wasReleasedThisFrame = false;

  /**
   * Builds an action from its document form.
   *
   * @param definition - The action as it appears in an `ignifx.inputactions` document.
   * @param map - The map the action belongs to.
   * @param resolver - How binding paths become controls.
   * @param onHandlerError - Where a signal handler's exception is reported.
   * @throws IgnifxError with code `IGX-0802`, `IGX-0803`, or `IGX-0806` for an unusable binding.
   */
  constructor(
    definition: ActionDefinition,
    map: ActionMap,
    resolver: BindingResolver,
    onHandlerError: (error: unknown) => void,
  ) {
    this.name = definition.name;
    this.map = map;
    this.type = definition.type ?? "button";
    const bindings: Binding[] = [];
    for (const binding of definition.bindings) {
      bindings.push(new Binding(binding, resolver));
    }
    this.#bindings = bindings;
    this.#vector = new ActionVector(this.#values);
    const report = (error: unknown): void => {
      onHandlerError(error);
    };
    this.onStarted = new Signal<InputActionEvent>({ onHandlerError: report });
    this.onPerformed = new Signal<InputActionEvent>({ onHandlerError: report });
    this.onCanceled = new Signal<InputActionEvent>({ onHandlerError: report });
    this.#event = { action: this, phase: "performed", magnitude: 0, x: 0, y: 0 };
  }

  /**
   * The bindings that feed this action, in declaration order.
   *
   * @returns The bindings.
   */
  get bindings(): readonly Binding[] {
    return this.#bindings;
  }

  /**
   * Whether the action is actuated past the press point.
   *
   * @returns `true` while held.
   */
  get isPressed(): boolean {
    return this.#isPressed;
  }

  /**
   * Whether the action became pressed in this frame. Stable for the whole frame, every fixed step
   * included.
   *
   * @returns `true` in the one frame the press resolved.
   */
  get wasPressedThisFrame(): boolean {
    return this.#wasPressedThisFrame;
  }

  /**
   * Whether the action was released in this frame. Stable for the whole frame.
   *
   * @returns `true` in the one frame the release resolved.
   */
  get wasReleasedThisFrame(): boolean {
    return this.#wasReleasedThisFrame;
  }

  /**
   * The action's scalar value, for an `axis` action.
   *
   * @returns The signed value; for other types, the x component.
   */
  get axis(): number {
    return this.#values[0] ?? 0;
  }

  /**
   * The action's vector value, for a `vector2` action. The object is a live view: it always reads
   * the action's current value and is never reallocated.
   *
   * @returns The live vector.
   */
  get vector(): Vec2Like {
    return this.#vector;
  }

  /**
   * How far the action is actuated, in `[0, 1]` for normalised controls.
   *
   * @returns The magnitude the press point is compared against.
   */
  get magnitude(): number {
    return this.#magnitude;
  }

  /**
   * Which device family produced this frame's value: the device behind the binding whose magnitude
   * won the frame, or `null` when the action is at rest, disabled, or in a disabled map. Stable for
   * the whole frame, like every other reading on an action.
   *
   * @remarks
   * A composite binding answers with the device of its first part, because the four parts of a
   * `2DVector` are one device in every binding that makes sense. Use it to treat one action
   * differently per device — a mouse look that must be ignored until the pointer is locked, a stick
   * look that is a rate rather than a displacement — without splitting the action in two.
   *
   * @returns The winning binding's device family, or `null`.
   *
   * @example
   * ```ts
   * const look = app.input.actions.get("look");
   * const degrees = look.activeDevice === "Gamepad" ? look.vector.x * 180 * dt : look.vector.x * 0.1;
   * ```
   */
  get activeDevice(): DeviceKind | null {
    return this.#activeDevice;
  }

  /**
   * The action's value in the shape its `type` implies.
   *
   * @returns A boolean for `button`, a number for `axis`, a live `Vec2Like` for `vector2`.
   */
  get value(): boolean | number | Vec2Like {
    if (this.type === "button") {
      return this.#isPressed;
    }
    if (this.type === "axis") {
      return this.axis;
    }
    return this.#vector;
  }

  /**
   * Resolves the action's state for this frame and emits whichever signals the transition calls
   * for.
   *
   * @param context - Focus, scheme, and strictness for this frame.
   * @param pressPoint - The magnitude at which an analog value counts as pressed.
   *
   * @internal
   */
  resolve(context: BindingContext, pressPoint: number): void {
    const previousPressed = this.#isPressed;
    const previousX = this.#values[0] ?? 0;
    const previousY = this.#values[1] ?? 0;
    let bestX = 0;
    let bestY = 0;
    let best = -1;
    let bestDevice: DeviceKind | null = null;
    if (this.enabled && this.map.enabled) {
      const bindings = this.#bindings;
      for (let index = 0; index < bindings.length; index += 1) {
        const binding = bindings[index];
        if (binding === undefined) {
          continue;
        }
        binding.evaluate(this.#scratch, context);
        const magnitude = binding.isVector ? Math.hypot(this.#scratch.x, this.#scratch.y) : Math.abs(this.#scratch.x);
        if (magnitude > best) {
          best = magnitude;
          bestX = this.#scratch.x;
          bestY = this.#scratch.y;
          bestDevice = binding.deviceKind;
        }
      }
    }
    const magnitude = best < 0 ? 0 : best;
    this.#values[0] = bestX;
    this.#values[1] = this.type === "vector2" ? bestY : 0;
    this.#magnitude = magnitude;
    // An action at rest names no device: every binding read zero, so the first one "won" by
    // accident and reporting its device would make a released action look actuated by something.
    this.#activeDevice = magnitude > 0 ? bestDevice : null;
    const pressed = magnitude > 0 && magnitude >= pressPoint;
    this.#isPressed = pressed;
    this.#wasPressedThisFrame = pressed && !previousPressed;
    this.#wasReleasedThisFrame = !pressed && previousPressed;
    const changed = this.#values[0] !== previousX || this.#values[1] !== previousY;
    this.#emit(changed);
  }

  /**
   * Delivers this frame's signals, in the documented order: started, performed, canceled.
   *
   * @param changed - Whether the value differs from the previous frame's.
   */
  #emit(changed: boolean): void {
    if (this.#wasPressedThisFrame) {
      this.#dispatch(this.onStarted, "started");
    }
    if (this.#wasPressedThisFrame || (this.#isPressed && changed)) {
      this.#dispatch(this.onPerformed, "performed");
    }
    if (this.#wasReleasedThisFrame) {
      this.#dispatch(this.onCanceled, "canceled");
    }
  }

  /**
   * Fills the reused event object and emits it.
   *
   * @param signal - The signal to emit on.
   * @param phase - The phase to report.
   */
  #dispatch(signal: Signal<InputActionEvent>, phase: "started" | "performed" | "canceled"): void {
    if (signal.connectionCount === 0) {
      return;
    }
    this.#event.phase = phase;
    this.#event.magnitude = this.#magnitude;
    this.#event.x = this.#values[0] ?? 0;
    this.#event.y = this.#values[1] ?? 0;
    signal.emit(this.#event);
  }
}

/**
 * The read-only half of an action's signals, for public shapes that expose them.
 *
 * @public
 */
export type InputActionSignal = SignalLike<InputActionEvent>;

import { clamp01 } from "@ignifx/core";
import { threeDError, ThreeDErrorCode } from "../errors.js";
import { ANY_STATE, defaultStateOf } from "./definition.js";
import type {
  AnimatorDefinition,
  AnimatorLayerDefinition,
  AnimatorParameterKind,
  AnimatorStateDefinition,
  AnimatorTransitionDefinition,
} from "./definition.js";

/**
 * The `Animator` state machine (`docs/architecture/12-3d-toolkit.md` §3), as a pure module.
 *
 * Nothing here knows about Babylon Lite, about entities, or about the frame loop: it takes
 * parameters and a delta and produces the per-clip weights, speeds, and events that the Lite
 * adapter applies. That is the whole reason it is a separate file — a state machine that can be
 * driven a step at a time in a plain Node test is a state machine whose exit times, triggers, and
 * blend thresholds are actually verified (`12-3d-toolkit.md` §3, and the Phase 7 exit criteria).
 *
 * ## Time
 *
 * Each layer tracks a **cumulative** normalized cursor: `1.5` means "one and a half times through
 * the state's clip". Wrapping is done on the way out, in `normalizedTime`,
 * so that an event at `0.25` fires once per pass without the machine having to remember which pass
 * it is on.
 *
 * ## Clip lengths
 *
 * A clip's length in seconds comes from the model, which the pure module cannot see. The adapter
 * calls {@link AnimatorStateMachine.setClipLength} once per clip after the model loads; until then
 * every clip is {@link DEFAULT_CLIP_LENGTH} second long, which keeps a headless test honest and a
 * not-yet-loaded animator from dividing by zero.
 */

/**
 * How long a clip whose length nobody has declared is assumed to be, in seconds.
 *
 * @public
 */
export const DEFAULT_CLIP_LENGTH = 1;

/**
 * One clip's contribution to the pose this frame.
 *
 * @public
 */
export interface ClipWeight {
  /** The animation-group name. */
  readonly clip: string;
  /** How much of the pose it contributes, before Lite normalizes anything. */
  readonly weight: number;
  /** The playback rate to set on the group. */
  readonly speed: number;
  /** Whether the clip belongs to an additive layer. */
  readonly additive: boolean;
  /** The layer the clip came from, so the adapter can find the mask. */
  readonly layer: string;
}

/**
 * A state change, as {@link AnimatorStateMachine.drainStateChanges} reports it.
 *
 * @public
 */
export interface StateChange {
  /** The layer the change happened on. */
  readonly layer: string;
  /** The state's name. */
  readonly state: string;
  /** Whether the state was entered or left. */
  readonly entered: boolean;
}

/**
 * What {@link AnimatorStateMachine.play} and {@link Animator.play} accept. `Animator.play` forwards
 * the object through unchanged, so the two take one type.
 *
 * @public
 */
export interface AnimatorPlayOptions {
  /** Which layer to play on; the state's own layer when omitted. */
  readonly layer?: string;
  /** How long to crossfade for, in seconds. `0` — the default — cuts. */
  readonly transitionSeconds?: number;
}

/** The mutable per-layer runtime the machine keeps. */
interface LayerRuntime {
  /** The layer's declaration. */
  readonly definition: AnimatorLayerDefinition;
  /** The state being played. */
  current: AnimatorStateDefinition;
  /** Cumulative normalized time inside {@link current}. */
  cursor: number;
  /** The state being faded out, or `null`. */
  previous: AnimatorStateDefinition | null;
  /** Cumulative normalized time inside {@link previous}. */
  previousCursor: number;
  /** How far the crossfade has run, in `[0, 1]`. */
  blend: number;
  /** How long the crossfade takes, in seconds. */
  blendDuration: number;
}

/**
 * Builds the failure an unknown state name produces.
 *
 * @param state - The name that was asked for.
 * @returns The error to throw.
 */
function unknownState(state: string): Error {
  return threeDError(ThreeDErrorCode.unknownState, `The animator declares no state named ${state}.`, {
    context: { state },
    hint: "Check the state names in the .animator.json document.",
  });
}

/**
 * Builds the failure an unknown parameter name produces.
 *
 * @param parameter - The name that was asked for.
 * @returns The error to throw.
 */
function unknownParameter(parameter: string): Error {
  return threeDError(ThreeDErrorCode.unknownParameter, `The animator declares no parameter named ${parameter}.`, {
    context: { parameter },
    hint: "Check the parameter names in the .animator.json document.",
  });
}

/**
 * Builds the failure a parameter written with the wrong kind of value produces.
 *
 * @param parameter - The parameter's name.
 * @param kind - The kind it was declared with.
 * @param wanted - The kind the caller used.
 * @returns The error to throw.
 */
function kindMismatch(parameter: string, kind: AnimatorParameterKind, wanted: string): Error {
  return threeDError(
    ThreeDErrorCode.parameterKindMismatch,
    `The parameter ${parameter} is a ${kind}, and ${wanted} cannot write it.`,
    { context: { parameter, kind, wanted } },
  );
}

/**
 * The headless half of `Animator`: parameters in, clip weights out.
 *
 * @example
 * ```ts
 * const machine = new AnimatorStateMachine(definition);
 * machine.setFloat("speed", 4);
 * machine.advance(1 / 60);
 * for (const clip of machine.clips) {
 *   applyWeight(clip.clip, clip.weight);
 * }
 * ```
 *
 * @public
 */
export class AnimatorStateMachine {
  readonly #definition: AnimatorDefinition;

  readonly #states: ReadonlyMap<string, AnimatorStateDefinition>;

  readonly #layers: readonly LayerRuntime[];

  readonly #floats = new Map<string, number>();

  readonly #kinds: ReadonlyMap<string, AnimatorParameterKind>;

  readonly #triggers = new Set<string>();

  readonly #clipLengths = new Map<string, number>();

  readonly #clips: ClipWeight[] = [];

  readonly #events: string[] = [];

  readonly #changes: StateChange[] = [];

  /** A multiplier applied to every layer's rate; `Animator.speed` writes it. */
  speed = 1;

  /**
   * Builds a machine and puts every layer in its default state.
   *
   * @param definition - The parsed `.animator.json` document.
   */
  constructor(definition: AnimatorDefinition) {
    this.#definition = definition;
    const states = new Map<string, AnimatorStateDefinition>();
    for (const state of definition.states) {
      states.set(state.name, state);
    }
    this.#states = states;
    const kinds = new Map<string, AnimatorParameterKind>();
    for (const parameter of definition.parameters) {
      kinds.set(parameter.name, parameter.kind);
      if (parameter.kind !== "trigger") {
        this.#floats.set(parameter.name, parameter.value);
      }
    }
    this.#kinds = kinds;
    const layers: LayerRuntime[] = [];
    for (const layer of definition.layers) {
      const initial = states.get(defaultStateOf(definition, layer));
      if (initial === undefined) {
        throw unknownState(layer.defaultState);
      }
      layers.push({
        definition: layer,
        current: initial,
        cursor: 0,
        previous: null,
        previousCursor: 0,
        blend: 1,
        blendDuration: 0,
      });
      this.#changes.push({ layer: layer.name, state: initial.name, entered: true });
    }
    this.#layers = layers;
    this.#rebuildClips();
  }

  /**
   * The document this machine runs.
   *
   * @returns The document this machine runs.
   */
  get definition(): AnimatorDefinition {
    return this.#definition;
  }

  /**
   * The clip contributions of the last `advance`, rebuilt in place each frame.
   *
   * @returns The clip contributions of the last `advance`, rebuilt in place each frame.
   */
  get clips(): readonly ClipWeight[] {
    return this.#clips;
  }

  /**
   * Declares how long a clip is, in seconds. The adapter calls it once per animation group.
   *
   * @param clip - The animation-group name.
   * @param seconds - Its length; values at or below zero are ignored.
   */
  setClipLength(clip: string, seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) {
      this.#clipLengths.set(clip, seconds);
    }
  }

  /**
   * Writes a `float` parameter.
   *
   * @param name - The parameter's name.
   * @param value - The value.
   * @throws IgnifxError with code `IGX-1203` when the parameter is not declared, or `IGX-1204` when
   * it is not a `float`.
   */
  setFloat(name: string, value: number): void {
    this.#writeNumber(name, "float", value);
  }

  /**
   * Writes an `int` parameter, truncating towards zero.
   *
   * @param name - The parameter's name.
   * @param value - The value.
   * @throws IgnifxError with code `IGX-1203` or `IGX-1204`.
   */
  setInt(name: string, value: number): void {
    this.#writeNumber(name, "int", Math.trunc(value));
  }

  /**
   * Writes a `bool` parameter.
   *
   * @param name - The parameter's name.
   * @param value - The value.
   * @throws IgnifxError with code `IGX-1203` or `IGX-1204`.
   */
  setBool(name: string, value: boolean): void {
    this.#writeNumber(name, "bool", value ? 1 : 0);
  }

  /**
   * Sets a `trigger` parameter. The next transition that consumes it clears it.
   *
   * @param name - The parameter's name.
   * @throws IgnifxError with code `IGX-1203` or `IGX-1204`.
   */
  setTrigger(name: string): void {
    if (this.#kinds.get(name) === undefined) {
      throw unknownParameter(name);
    }
    if (this.#kinds.get(name) !== "trigger") {
      throw kindMismatch(name, this.#kinds.get(name) ?? "float", "setTrigger");
    }
    this.#triggers.add(name);
  }

  /**
   * Clears a `trigger` parameter without taking a transition.
   *
   * @param name - The parameter's name.
   */
  resetTrigger(name: string): void {
    this.#triggers.delete(name);
  }

  /**
   * Reads a numeric parameter.
   *
   * @param name - The parameter's name.
   * @returns The value; `0` for a set trigger's companion float, `1`/`0` for a bool.
   * @throws IgnifxError with code `IGX-1203` when the parameter is not declared.
   */
  getFloat(name: string): number {
    if (!this.#kinds.has(name)) {
      throw unknownParameter(name);
    }
    return this.#floats.get(name) ?? 0;
  }

  /**
   * Reads a `bool` parameter.
   *
   * @param name - The parameter's name.
   * @returns Whether it is set.
   * @throws IgnifxError with code `IGX-1203` when the parameter is not declared.
   */
  getBool(name: string): boolean {
    return this.getFloat(name) !== 0;
  }

  /**
   * Whether a trigger is currently set.
   *
   * @param name - The parameter's name.
   * @returns `true` while the trigger waits to be consumed.
   */
  isTriggerSet(name: string): boolean {
    return this.#triggers.has(name);
  }

  /**
   * Plays a state, optionally crossfading into it.
   *
   * @param state - The state's name.
   * @param options - The layer and the crossfade length.
   * @throws IgnifxError with code `IGX-1202` when the state is not declared.
   */
  play(state: string, options?: AnimatorPlayOptions): void {
    const target = this.#states.get(state);
    if (target === undefined) {
      throw unknownState(state);
    }
    const layer = this.#layerOf(options?.layer ?? target.layer);
    this.#begin(layer, target, options?.transitionSeconds ?? 0);
  }

  /**
   * Crossfades into a state.
   *
   * @param state - The state's name.
   * @param seconds - How long the fade takes.
   * @param layer - Which layer to play on; the state's own layer when omitted.
   * @throws IgnifxError with code `IGX-1202` when the state is not declared.
   */
  crossFade(state: string, seconds: number, layer?: string): void {
    this.play(state, { transitionSeconds: seconds, ...(layer === undefined ? {} : { layer }) });
  }

  /**
   * The state a layer is currently in.
   *
   * @param layer - The layer's name; the base layer when omitted.
   * @returns The state's name.
   */
  currentState(layer?: string): string {
    return this.#layerOf(layer ?? this.#layers[0]?.definition.name ?? "").current.name;
  }

  /**
   * How far into its state a layer is, in `[0, 1]`.
   *
   * @remarks
   * A looping state wraps; a one-shot state clamps at `1`.
   *
   * @param layer - The layer's name; the base layer when omitted.
   * @returns The normalized time.
   */
  normalizedTime(layer?: string): number {
    const runtime = this.#layerOf(layer ?? this.#layers[0]?.definition.name ?? "");
    return runtime.current.loop ? runtime.cursor - Math.floor(runtime.cursor) : clamp01(runtime.cursor);
  }

  /**
   * Whether a layer is mid-crossfade.
   *
   * @param layer - The layer's name; the base layer when omitted.
   * @returns `true` while a previous state still contributes.
   */
  isInTransition(layer?: string): boolean {
    return this.#layerOf(layer ?? this.#layers[0]?.definition.name ?? "").previous !== null;
  }

  /**
   * Advances every layer by one frame and recomputes the clip weights.
   *
   * @param deltaSeconds - The frame delta, already scaled by whatever clock the caller uses.
   */
  advance(deltaSeconds: number): void {
    for (const layer of this.#layers) {
      this.#advanceLayer(layer, deltaSeconds);
      this.#evaluateTransitions(layer);
    }
    this.#rebuildClips();
  }

  /**
   * Hands over the animation events that fired since the last call and clears the queue.
   *
   * @param out - The array to append names to.
   */
  drainEvents(out: string[]): void {
    for (const name of this.#events) {
      out.push(name);
    }
    this.#events.length = 0;
  }

  /**
   * Hands over the state entries and exits since the last call and clears the queue.
   *
   * @param out - The array to append changes to.
   */
  drainStateChanges(out: StateChange[]): void {
    for (const change of this.#changes) {
      out.push(change);
    }
    this.#changes.length = 0;
  }

  /**
   * Writes a numeric parameter after checking its declared kind.
   *
   * @param name - The parameter's name.
   * @param wanted - The kind the setter is for.
   * @param value - The value to store.
   */
  #writeNumber(name: string, wanted: AnimatorParameterKind, value: number): void {
    const kind = this.#kinds.get(name);
    if (kind === undefined) {
      throw unknownParameter(name);
    }
    if (kind !== wanted) {
      throw kindMismatch(name, kind, `set${wanted[0]?.toUpperCase() ?? ""}${wanted.slice(1)}`);
    }
    this.#floats.set(name, value);
  }

  /**
   * Finds a layer by name.
   *
   * @param name - The layer's name.
   * @returns Its runtime; the base layer when the name is not declared.
   */
  #layerOf(name: string): LayerRuntime {
    for (const layer of this.#layers) {
      if (layer.definition.name === name) {
        return layer;
      }
    }
    const base = this.#layers[0];
    if (base === undefined) {
      throw unknownState(name);
    }
    return base;
  }

  /**
   * How long one state's clip is, in seconds.
   *
   * @param state - The state.
   * @returns The length; {@link DEFAULT_CLIP_LENGTH} when nothing declared one.
   */
  #lengthOf(state: AnimatorStateDefinition): number {
    if (state.clip !== "") {
      return this.#clipLengths.get(state.clip) ?? DEFAULT_CLIP_LENGTH;
    }
    // A blend tree's length is its longest child, so the tree does not skip when the parameter
    // moves between clips of different lengths.
    const tree = this.#definition.blendTrees1D.find((candidate) => candidate.name === state.blendTree);
    let longest = 0;
    for (const child of tree?.children ?? []) {
      longest = Math.max(longest, this.#clipLengths.get(child.clip) ?? DEFAULT_CLIP_LENGTH);
    }
    return longest > 0 ? longest : DEFAULT_CLIP_LENGTH;
  }

  /**
   * Advances one layer's cursors, its crossfade, and its events.
   *
   * @param layer - The layer.
   * @param deltaSeconds - The frame delta.
   */
  #advanceLayer(layer: LayerRuntime, deltaSeconds: number): void {
    const state = layer.current;
    const before = layer.cursor;
    const step = (deltaSeconds * state.speed * this.speed) / this.#lengthOf(state);
    layer.cursor = state.loop ? layer.cursor + step : Math.min(layer.cursor + step, 1);
    this.#fireEvents(state, before, layer.cursor);
    const previous = layer.previous;
    if (previous !== null) {
      const previousStep = (deltaSeconds * previous.speed * this.speed) / this.#lengthOf(previous);
      layer.previousCursor = previous.loop
        ? layer.previousCursor + previousStep
        : Math.min(layer.previousCursor + previousStep, 1);
      layer.blend = layer.blendDuration <= 0 ? 1 : Math.min(1, layer.blend + deltaSeconds / layer.blendDuration);
      if (layer.blend >= 1) {
        this.#changes.push({ layer: layer.definition.name, state: previous.name, entered: false });
        layer.previous = null;
      }
    }
  }

  /**
   * Emits every event the cursor crossed.
   *
   * @remarks
   * The cursors are cumulative, so an event at `0.25` of a clip played four times over is crossed
   * at `0.25`, `1.25`, `2.25`, and `3.25` — once per pass, which is exactly what
   * `12-3d-toolkit.md` §3 asks for. Playing backwards fires nothing: Lite has no reverse event
   * semantics to match, and firing a footstep while rewinding is never what a game wants.
   *
   * @param state - The state being played.
   * @param from - The cursor before the step.
   * @param to - The cursor after it.
   */
  #fireEvents(state: AnimatorStateDefinition, from: number, to: number): void {
    if (to <= from || state.events.length === 0) {
      return;
    }
    const first = Math.floor(from);
    const last = Math.floor(to);
    for (let cycle = first; cycle <= last; cycle += 1) {
      for (const event of state.events) {
        const at = cycle + event.time;
        if (at > from && at <= to) {
          this.#events.push(event.name);
        }
      }
    }
  }

  /**
   * Takes the first transition of the layer whose conditions and exit time pass.
   *
   * @param layer - The layer.
   */
  #evaluateTransitions(layer: LayerRuntime): void {
    if (layer.previous !== null) {
      // A transition is already in flight; only an `interruptible` one may cut in.
      for (const transition of this.#definition.transitions) {
        if (transition.interruptible && this.#matches(layer, transition)) {
          this.#take(layer, transition);
          return;
        }
      }
      return;
    }
    for (const transition of this.#definition.transitions) {
      if (this.#matches(layer, transition)) {
        this.#take(layer, transition);
        return;
      }
    }
  }

  /**
   * Whether a transition can fire on a layer right now.
   *
   * @param layer - The layer.
   * @param transition - The transition.
   * @returns `true` when the source, the exit time, and every condition agree.
   */
  #matches(layer: LayerRuntime, transition: AnimatorTransitionDefinition): boolean {
    const target = this.#states.get(transition.to);
    if (target === undefined || target.layer !== layer.definition.name) {
      return false;
    }
    if (transition.from === ANY_STATE) {
      if (transition.to === layer.current.name) {
        return false;
      }
    } else if (transition.from !== layer.current.name) {
      return false;
    }
    if (transition.exitTime !== null && this.normalizedTime(layer.definition.name) < transition.exitTime) {
      return false;
    }
    for (const condition of transition.conditions) {
      if (!this.#passes(condition.param, condition.op, condition.value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluates one condition.
   *
   * @param param - The parameter's name.
   * @param op - The comparison.
   * @param value - What to compare against.
   * @returns Whether the condition passes.
   */
  #passes(param: string, op: string, value: number): boolean {
    if (op === "trigger") {
      return this.#triggers.has(param);
    }
    const current = this.#floats.get(param) ?? 0;
    switch (op) {
      case "gt": {
        return current > value;
      }
      case "gte": {
        return current >= value;
      }
      case "lt": {
        return current < value;
      }
      case "lte": {
        return current <= value;
      }
      case "neq": {
        return current !== value;
      }
      default: {
        return current === value;
      }
    }
  }

  /**
   * Fires a transition, consuming every trigger it read.
   *
   * @param layer - The layer.
   * @param transition - The transition.
   */
  #take(layer: LayerRuntime, transition: AnimatorTransitionDefinition): void {
    for (const condition of transition.conditions) {
      if (condition.op === "trigger") {
        this.#triggers.delete(condition.param);
      }
    }
    const target = this.#states.get(transition.to);
    if (target !== undefined) {
      this.#begin(layer, target, transition.duration);
    }
  }

  /**
   * Starts playing a state on a layer, crossfading out of the one it replaces.
   *
   * @param layer - The layer.
   * @param target - The state to enter.
   * @param seconds - How long the crossfade takes; `0` cuts.
   */
  #begin(layer: LayerRuntime, target: AnimatorStateDefinition, seconds: number): void {
    const leaving = layer.current;
    if (seconds > 0) {
      layer.previous = leaving;
      layer.previousCursor = layer.cursor;
      layer.blend = 0;
      layer.blendDuration = seconds;
    } else {
      layer.previous = null;
      layer.blend = 1;
      layer.blendDuration = 0;
      this.#changes.push({ layer: layer.definition.name, state: leaving.name, entered: false });
    }
    layer.current = target;
    layer.cursor = 0;
    this.#changes.push({ layer: layer.definition.name, state: target.name, entered: true });
  }

  /** Recomputes {@link clips} in place. */
  #rebuildClips(): void {
    this.#clips.length = 0;
    for (const layer of this.#layers) {
      const weight = layer.definition.weight;
      if (weight <= 0) {
        continue;
      }
      const previous = layer.previous;
      if (previous !== null) {
        this.#addState(layer, previous, weight * (1 - layer.blend));
      }
      this.#addState(layer, layer.current, weight * (previous === null ? 1 : layer.blend));
    }
  }

  /**
   * Adds one state's clips to the output at a weight.
   *
   * @param layer - The owning layer.
   * @param state - The state.
   * @param weight - The state's share of the layer.
   */
  #addState(layer: LayerRuntime, state: AnimatorStateDefinition, weight: number): void {
    if (weight <= 0) {
      return;
    }
    const speed = state.speed * this.speed;
    if (state.clip !== "") {
      this.#push(layer, state.clip, weight, speed);
      return;
    }
    const tree = this.#definition.blendTrees1D.find((candidate) => candidate.name === state.blendTree);
    if (tree === undefined || tree.children.length === 0) {
      return;
    }
    const value = this.#floats.get(tree.param) ?? 0;
    const children = tree.children;
    const first = children[0];
    const last = children[children.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (children.length === 1 || value <= first.threshold) {
      this.#push(layer, first.clip, weight, speed);
      return;
    }
    if (value >= last.threshold) {
      this.#push(layer, last.clip, weight, speed);
      return;
    }
    for (let index = 0; index < children.length - 1; index += 1) {
      const low = children[index];
      const high = children[index + 1];
      if (low === undefined || high === undefined || value < low.threshold || value > high.threshold) {
        continue;
      }
      const span = high.threshold - low.threshold;
      const alpha = span <= 0 ? 0 : (value - low.threshold) / span;
      this.#push(layer, low.clip, weight * (1 - alpha), speed);
      this.#push(layer, high.clip, weight * alpha, speed);
      return;
    }
  }

  /**
   * Appends one clip contribution, merging it with an existing entry for the same clip and layer.
   *
   * @param layer - The owning layer.
   * @param clip - The animation-group name.
   * @param weight - Its weight.
   * @param speed - Its rate.
   */
  #push(layer: LayerRuntime, clip: string, weight: number, speed: number): void {
    if (weight <= 0) {
      return;
    }
    for (let index = 0; index < this.#clips.length; index += 1) {
      const existing = this.#clips[index];
      if (existing !== undefined && existing.clip === clip && existing.layer === layer.definition.name) {
        this.#clips[index] = {
          clip,
          weight: existing.weight + weight,
          speed,
          additive: existing.additive,
          layer: existing.layer,
        };
        return;
      }
    }
    this.#clips.push({ clip, weight, speed, additive: layer.definition.additive, layer: layer.definition.name });
  }
}

import { asset, bool, Component, createDefaults, defineSchema, f32, Model, Signal, str } from "@ignifx/core";
import { AnimatorMixer } from "../lite/gpu/animation-mixer.js";
import { AnimatorAsset } from "./animator-asset.js";
import { AnimatorStateMachine } from "./state-machine.js";
import type { AnimatorDefinition } from "./definition.js";
import type { AnimatorPlayOptions, StateChange } from "./state-machine.js";
import type { LiteAnimationManager } from "../lite/types.js";
import type { AssetHandle, ComponentHooks, Schema } from "@ignifx/core";

/**
 * `Animator` (`docs/architecture/12-3d-toolkit.md` §3): the animation state machine that drives a
 * `Model`'s skeletal clips on ignifx's clock.
 *
 * The component is a thin shell around two halves that never talk to each other directly: the pure
 * {@link AnimatorStateMachine}, which turns parameters and a delta into per-clip weights, and the
 * `AnimatorMixer`, which is the only thing here that knows Babylon Lite exists. That split is what
 * makes exit times, triggers, blend thresholds, and animation events testable in a plain Node test
 * with no GPU and no model.
 *
 * A headless app therefore runs the *whole* state machine — transitions fire, events fire,
 * `currentState` moves — and simply poses nothing. A game's animation logic is testable in CI.
 */

/**
 * Builds the `Animator` field declarations.
 *
 * @returns The schema.
 */
function animatorSchema(): Schema {
  return defineSchema({
    animator: asset(AnimatorAsset, { tooltip: "The .animator.json document this state machine runs." }),
    defaultLayer: str("", { tooltip: "The layer play() and currentState() use when given no name." }),
    speed: f32(1, { tooltip: "A multiplier on every state's own rate." }),
    updateWhenPaused: bool(false, { tooltip: "Whether the animator keeps advancing while app.pause() holds." }),
    applyOnAwake: bool(true, { tooltip: "Whether the first pose is written before the first update." }),
  });
}

/**
 * An animation state machine bound to the `Model` on its entity.
 *
 * @example
 * ```ts
 * const animator = hero.addComponent(Animator);
 * animator.animator = app.assets.load<AnimatorAsset>("3d/hero.animator.json").retain();
 * animator.onEvent.connect((name) => { if (name === "landed") thud(); }, { owner: animator });
 * animator.setFloat("speed", 4.5);
 * animator.setTrigger("jump");
 * ```
 *
 * @public
 */
export class Animator extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/Animator";

  /** One animator per entity: a second state machine on one model would fight over the clips. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = animatorSchema();

  /** The document holding the state machine. */
  declare animator: AssetHandle<AnimatorAsset> | null;

  /** The layer `play` and `currentState` default to; empty means the document's base layer. */
  declare defaultLayer: string;

  /** A multiplier on every state's own rate. */
  declare speed: number;

  /** Whether the animator keeps advancing while `app.pause()` holds. */
  declare updateWhenPaused: boolean;

  /** Whether the first pose is written before the first update. */
  declare applyOnAwake: boolean;

  #machine: AnimatorStateMachine | null = null;

  #mixer: AnimatorMixer | null = null;

  #model: Model | null = null;

  #boundAsset: AnimatorAsset | null = null;

  #lengthsResolved = false;

  readonly #events: string[] = [];

  readonly #changes: StateChange[] = [];

  readonly #onEvent: Signal<string> = new Signal<string>();

  readonly #onStateEntered: Signal<string> = new Signal<string>();

  readonly #onStateExited: Signal<string> = new Signal<string>();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Animator.schema));
  }

  /**
   * Fires with the name of every animation event the playing states cross.
   *
   * @returns Fires with the name of every animation event the playing states cross.
   */
  get onEvent(): Signal<string> {
    return this.#onEvent;
  }

  /**
   * Fires with a state's name each time a layer enters it.
   *
   * @returns Fires with a state's name each time a layer enters it.
   */
  get onStateEntered(): Signal<string> {
    return this.#onStateEntered;
  }

  /**
   * Fires with a state's name each time a layer leaves it, after any crossfade has finished.
   *
   * @returns Fires with a state's name each time a layer leaves it, after any crossfade has finished.
   */
  get onStateExited(): Signal<string> {
    return this.#onStateExited;
  }

  /**
   * Whether the document has loaded and the state machine is running.
   *
   * @returns Whether the document has loaded and the state machine is running.
   */
  get isReady(): boolean {
    return this.#machine !== null;
  }

  /**
   * The Babylon Lite objects this animator owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The animation manager, or `null` under a headless app or before the model loaded.
   */
  get lite(): { readonly manager: LiteAnimationManager | null } {
    return { manager: this.#mixer?.manager ?? null };
  }

  /**
   * The state machine, for a game that wants to inspect it. `null` until the document loads.
   *
   * @returns The machine.
   */
  get stateMachine(): AnimatorStateMachine | null {
    return this.#machine;
  }

  /** Finds the `Model` this animator poses. */
  onAttach(): void {
    this.#model = this.entity.getComponent(Model);
  }

  /** Hands the clips back so another animator, or a reload, can claim them. */
  onDetach(): void {
    this.#mixer?.dispose();
    this.#mixer = null;
    this.#machine = null;
    this.#boundAsset = null;
    this.#model = null;
    this.#lengthsResolved = false;
  }

  /**
   * Writes a `float` parameter.
   *
   * @param name - The parameter's name.
   * @param value - The value.
   * @throws IgnifxError with code `IGX-1203` or `IGX-1204`.
   */
  setFloat(name: string, value: number): void {
    this.#machine?.setFloat(name, value);
  }

  /**
   * Writes an `int` parameter.
   *
   * @param name - The parameter's name.
   * @param value - The value.
   * @throws IgnifxError with code `IGX-1203` or `IGX-1204`.
   */
  setInt(name: string, value: number): void {
    this.#machine?.setInt(name, value);
  }

  /**
   * Writes a `bool` parameter.
   *
   * @param name - The parameter's name.
   * @param value - The value.
   * @throws IgnifxError with code `IGX-1203` or `IGX-1204`.
   */
  setBool(name: string, value: boolean): void {
    this.#machine?.setBool(name, value);
  }

  /**
   * Sets a `trigger` parameter; the next transition that reads it consumes it.
   *
   * @param name - The parameter's name.
   * @throws IgnifxError with code `IGX-1203` or `IGX-1204`.
   */
  setTrigger(name: string): void {
    this.#machine?.setTrigger(name);
  }

  /**
   * Reads a numeric parameter.
   *
   * @param name - The parameter's name.
   * @returns The value, or `0` before the document loads.
   */
  getFloat(name: string): number {
    return this.#machine?.getFloat(name) ?? 0;
  }

  /**
   * Reads a `bool` parameter.
   *
   * @param name - The parameter's name.
   * @returns Whether it is set.
   */
  getBool(name: string): boolean {
    return this.#machine?.getBool(name) ?? false;
  }

  /**
   * Plays a state, cutting to it unless `transitionSeconds` says otherwise.
   *
   * @param state - The state's name.
   * @param options - The layer and the crossfade length.
   * @throws IgnifxError with code `IGX-1202` when the state is not declared.
   */
  play(state: string, options?: AnimatorPlayOptions): void {
    const layer = options?.layer ?? (this.defaultLayer === "" ? undefined : this.defaultLayer);
    this.#machine?.play(state, {
      ...(layer === undefined ? {} : { layer }),
      transitionSeconds: options?.transitionSeconds ?? 0,
    });
  }

  /**
   * Crossfades into a state.
   *
   * @param state - The state's name.
   * @param seconds - How long the fade takes.
   * @param layer - Which layer to play on.
   * @throws IgnifxError with code `IGX-1202` when the state is not declared.
   */
  crossFade(state: string, seconds: number, layer?: string): void {
    this.play(state, { transitionSeconds: seconds, ...(layer === undefined ? {} : { layer }) });
  }

  /**
   * The state a layer is currently in.
   *
   * @param layer - The layer's name; `defaultLayer` or the base layer when omitted.
   * @returns The state's name, or the empty string before the document loads.
   */
  currentState(layer?: string): string {
    const name = layer ?? (this.defaultLayer === "" ? undefined : this.defaultLayer);
    return this.#machine?.currentState(name) ?? "";
  }

  /**
   * How far into its state a layer is, in `[0, 1]`.
   *
   * @param layer - The layer's name; `defaultLayer` or the base layer when omitted.
   * @returns The normalized time.
   */
  normalizedTime(layer?: string): number {
    const name = layer ?? (this.defaultLayer === "" ? undefined : this.defaultLayer);
    return this.#machine?.normalizedTime(name) ?? 0;
  }

  /**
   * Advances the state machine and writes the pose. The `PostUpdate` system calls it.
   *
   * @param deltaSeconds - The frame delta, already chosen for `updateWhenPaused`.
   *
   * @internal
   */
  advance(deltaSeconds: number): void {
    this.#syncAsset();
    const machine = this.#machine;
    if (machine === null) {
      return;
    }
    machine.speed = this.speed;
    this.#syncMixer();
    machine.advance(deltaSeconds);
    this.#writePose();
    this.#drain();
  }

  /** Builds or drops the state machine when the `animator` handle changes. */
  #syncAsset(): void {
    const value = this.animator?.value ?? null;
    if (value === this.#boundAsset) {
      return;
    }
    this.#mixer?.dispose();
    this.#mixer = null;
    this.#lengthsResolved = false;
    this.#boundAsset = value;
    this.#machine = value === null ? null : new AnimatorStateMachine(value.definition);
    if (this.#machine !== null && this.applyOnAwake) {
      this.#drain();
    }
  }

  /** Builds the Lite mixer once the model's clips exist, and feeds the machine their lengths. */
  #syncMixer(): void {
    const machine = this.#machine;
    if (machine === null || this.#lengthsResolved) {
      return;
    }
    const clips = this.#model?.animations ?? [];
    if (clips.length === 0) {
      return;
    }
    this.#mixer = new AnimatorMixer(clips, this.app.lite.engine, (clip: string, error: unknown): void => {
      this.app.onError.emit({
        error,
        source: "lifecycle",
        phase: null,
        entity: this.entity,
        component: this,
      });
      this.app.log.warn(`The clip ${clip} is already driven by another Animator; this one skips it.`);
    });
    for (const name of this.#mixer.clipNames) {
      machine.setClipLength(name, this.#mixer.lengthOf(name));
    }
    this.#applyLayerSettings();
    this.#lengthsResolved = true;
  }

  /** Installs each layer's mask and additive flag on the clips that layer can play. */
  #applyLayerSettings(): void {
    const mixer = this.#mixer;
    const definition = this.#boundAsset?.definition;
    if (mixer === null || definition === undefined) {
      return;
    }
    for (const layer of definition.layers) {
      for (const state of definition.states) {
        if (state.layer !== layer.name) {
          continue;
        }
        for (const clip of clipsOfState(definition, state.clip, state.blendTree)) {
          mixer.setMask(clip, layer.name, layer.mask, layer.maskMode === "exclude");
          if (layer.additive) {
            mixer.setAdditive(clip);
          }
        }
      }
    }
  }

  /** Pushes the machine's clip weights into Lite and ticks the manager. */
  #writePose(): void {
    const mixer = this.#mixer;
    const machine = this.#machine;
    if (mixer === null || machine === null) {
      return;
    }
    mixer.clearWeights();
    const clips = machine.clips;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      if (clip !== undefined) {
        mixer.apply(clip.clip, clip.weight, clip.speed, machine.normalizedTime(clip.layer));
      }
    }
    // Zero, because the playhead of every clip has already been written from the state machine's
    // own cursors; the tick is what makes Lite recompute and upload the blended pose.
    mixer.tick(0);
  }

  /** Emits the frame's events and state changes on the signals. */
  #drain(): void {
    const machine = this.#machine;
    if (machine === null) {
      return;
    }
    machine.drainEvents(this.#events);
    for (const name of this.#events) {
      this.#onEvent.emit(name);
    }
    this.#events.length = 0;
    machine.drainStateChanges(this.#changes);
    for (const change of this.#changes) {
      if (change.entered) {
        this.#onStateEntered.emit(change.state);
      } else {
        this.#onStateExited.emit(change.state);
      }
    }
    this.#changes.length = 0;
  }
}

/**
 * Every clip one state can play.
 *
 * @param definition - The document, for the blend-tree lookup.
 * @param clip - The state's single clip, or the empty string.
 * @param blendTree - The state's blend tree, or the empty string.
 * @returns The animation-group names.
 */
function clipsOfState(definition: AnimatorDefinition, clip: string, blendTree: string): readonly string[] {
  if (clip !== "") {
    return [clip];
  }
  const tree = definition.blendTrees1D.find((candidate) => candidate.name === blendTree);
  return tree?.children.map((child) => child.clip) ?? [];
}

import { asset, bool, Component, createDefaults, defineSchema, f32, Signal, str } from "@ignifx/core";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { SpriteRenderer } from "../sprite/sprite-renderer.js";
import { SpriteAnimationAsset } from "./sprite-animation-asset.js";
import type { SpriteClip } from "./sprite-animation-asset.js";
import type { SpriteAtlasAsset } from "../atlas/sprite-atlas-asset.js";
import type { AssetHandle, ComponentHooks, Schema } from "@ignifx/core";

/**
 * `SpriteAnimator` (`docs/architecture/11-2d-toolkit.md` §2.4): plays a clip of atlas frames on the
 * `SpriteRenderer` sharing its entity.
 *
 * The clock is **ignifx's**, advanced in `PostUpdate` (ADR-0003), not Lite's
 * `SpriteAnimationManager`. That is what makes `app.time.timeScale`, `app.pause()`, and frame
 * events behave for a 2D character exactly as they do for a 3D one — and what makes the whole
 * thing testable with `app.step` under a headless app, where no sprite is drawn at all.
 */

/**
 * What {@link SpriteAnimator.play} accepts.
 *
 * @public
 */
export interface PlayClipOptions {
  /** Whether to rewind a clip that is already playing. Defaults to `false`. */
  readonly restart?: boolean;
}

/**
 * A sprite animator.
 *
 * @example
 * ```ts
 * const animator = hero.addComponent(SpriteAnimator);
 * animator.animations = app.assets.load<SpriteAnimationAsset>("2d/hero.spriteanim.json").retain();
 * animator.onEvent.connect((name) => { if (name === "footstep") playStep(); }, { owner: animator });
 * animator.play("run");
 * ```
 *
 * @public
 */
export class SpriteAnimator extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/SpriteAnimator";

  /** One animator per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = spriteAnimatorSchema();

  /** The document holding the clips. */
  declare animations: AssetHandle<SpriteAnimationAsset> | null;

  /** Which clip to start on; empty plays the document's first. */
  declare defaultClip: string;

  /** Whether the default clip starts as soon as the document has loaded. */
  declare playOnAwake: boolean;

  /** A multiplier on the clip's own frame rate. */
  declare speed: number;

  /** The clip currently playing, or `null`. */
  #clip: SpriteClip | null = null;

  /** How far into the clip playback is, in seconds. */
  #elapsed = 0;

  /** The clip frame index the last advance settled on. */
  #cursor = 0;

  /** Whether playback is running. */
  #isPlaying = false;

  /** Whether the default clip has been started already. */
  #hasAutoPlayed = false;

  /** The renderer this animator writes frames to; found lazily. */
  #renderer: SpriteRenderer | null = null;

  readonly #onClipEnded: Signal<string> = new Signal<string>();

  readonly #onEvent: Signal<string> = new Signal<string>();

  /**
   * Builds an animator with the schema's defaults.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(SpriteAnimator.schema));
  }

  /**
   * Clears playback state, so a recycled component does not inherit the previous one's.
   */
  onAttach(): void {
    this.#clip = null;
    this.#elapsed = 0;
    this.#cursor = 0;
    this.#isPlaying = false;
    this.#hasAutoPlayed = false;
    this.#renderer = null;
  }

  /**
   * Releases the signals' handlers.
   */
  onDetach(): void {
    this.#isPlaying = false;
  }

  /**
   * Emitted with a clip's name when a non-looping clip reaches its last frame.
   *
   * @returns The signal.
   */
  get onClipEnded(): Signal<string> {
    return this.#onClipEnded;
  }

  /**
   * Emitted with an event's name when playback passes the frame that declares it.
   *
   * @remarks
   * A looping clip fires each event once per pass. A clip advanced by more than one frame in a
   * single step — a long frame, or a high `speed` — fires every event it skipped over, in order,
   * so a footstep is never silently dropped.
   *
   * @returns The signal.
   */
  get onEvent(): Signal<string> {
    return this.#onEvent;
  }

  /**
   * Whether a clip is currently advancing.
   *
   * @returns `true` while playing.
   */
  get isPlaying(): boolean {
    return this.#isPlaying;
  }

  /**
   * The clip currently playing, or `null`.
   *
   * @returns The clip.
   */
  get clip(): SpriteClip | null {
    return this.#clip;
  }

  /**
   * The atlas frame index the animator last wrote.
   *
   * @returns The frame index, or `-1` when no clip is playing.
   */
  get frame(): number {
    return this.#clip?.frames[this.#cursor] ?? -1;
  }

  /**
   * How far into the clip playback is, in seconds.
   *
   * @returns The elapsed time.
   */
  get time(): number {
    return this.#elapsed;
  }

  /**
   * The loaded animation document, or `null` while it is still loading.
   *
   * @returns The document.
   */
  get asset(): SpriteAnimationAsset | null {
    const handle = this.animations;
    return handle?.state === "loaded" ? handle.value : null;
  }

  /**
   * Starts a clip.
   *
   * @param name - The clip's name.
   * @param options - Whether to rewind a clip that is already playing.
   * @throws IgnifxError with code `IGX-1108` when the document declares no such clip.
   *
   * @example
   * ```ts
   * animator.play("run", { restart: true });
   * ```
   */
  play(name: string, options?: PlayClipOptions): void {
    const clips = this.asset;
    const atlas = this.#atlas();
    if (clips === null || atlas === null) {
      // Nothing loaded yet; remember the intent so `advance` starts it on arrival.
      this.defaultClip = name;
      this.playOnAwake = true;
      this.#hasAutoPlayed = false;
      return;
    }
    const clip = clips.requireClip(name, atlas);
    if (this.#clip === clip && this.#isPlaying && options?.restart !== true) {
      return;
    }
    this.#clip = clip;
    this.#elapsed = 0;
    this.#cursor = 0;
    this.#isPlaying = clip.frames.length > 0;
    this.#writeFrame();
  }

  /**
   * Stops playback and rewinds to the clip's first frame.
   */
  stop(): void {
    this.#isPlaying = false;
    this.#elapsed = 0;
    this.#cursor = 0;
    this.#writeFrame();
  }

  /**
   * Suspends playback where it is; {@link SpriteAnimator.resume} continues from there.
   */
  pause(): void {
    this.#isPlaying = false;
  }

  /**
   * Continues a paused clip.
   */
  resume(): void {
    if (this.#clip !== null && this.#clip.frames.length > 0) {
      this.#isPlaying = true;
    }
  }

  /**
   * Advances playback by one frame's worth of scaled time. The animation system calls this in
   * `PostUpdate`.
   *
   * @remarks
   * `deltaSeconds` is `ctx.dt` in the `PostUpdate` phase, which is `time.deltaTime` — already
   * multiplied by `time.timeScale`; the 2D animation system skips the call while the app is paused
   * (`docs/architecture/01-lifecycle-and-time.md` §2). The animator does not consult the clock
   * itself, which is what makes it deterministic under `app.step`.
   *
   * @param deltaSeconds - The scaled frame delta.
   *
   * @internal
   */
  advance(deltaSeconds: number): void {
    this.#autoPlay();
    const clip = this.#clip;
    if (clip === null || !this.#isPlaying || clip.frames.length === 0) {
      return;
    }
    const rate = clip.fps * this.speed;
    if (rate <= 0) {
      return;
    }
    const count = clip.frames.length;
    const previous = this.#cursor;
    this.#elapsed += deltaSeconds;
    const raw = Math.floor(this.#elapsed * rate);
    let next = raw;
    let ended = false;
    if (raw >= count) {
      if (clip.loop) {
        next = raw % count;
      } else {
        next = count - 1;
        ended = true;
      }
    }
    if (next !== previous) {
      this.#emitEventsBetween(clip, previous, raw, count);
      this.#cursor = next;
      this.#writeFrame();
    }
    if (ended) {
      this.#isPlaying = false;
      this.#onClipEnded.emit(clip.name);
    }
  }

  /**
   * Starts the default clip once the document and the atlas have both arrived.
   */
  #autoPlay(): void {
    if (this.#hasAutoPlayed || !this.playOnAwake) {
      return;
    }
    const clips = this.asset;
    const atlas = this.#atlas();
    if (clips === null || atlas === null) {
      return;
    }
    const name = this.defaultClip === "" ? clips.defaultClipName : this.defaultClip;
    if (name === "") {
      this.#hasAutoPlayed = true;
      return;
    }
    const clip = clips.resolve(atlas).get(name);
    if (clip === undefined) {
      this.#hasAutoPlayed = true;
      throw twoDError(TwoDErrorCode.unknownClip, `${clips.address} declares no clip named ${name}.`, {
        context: { asset: clips.address, clip: name },
        hint: `Known clips: ${clips.clipNames().join(", ")}.`,
      });
    }
    this.#hasAutoPlayed = true;
    this.#clip = clip;
    this.#elapsed = 0;
    this.#cursor = 0;
    this.#isPlaying = clip.frames.length > 0;
    this.#writeFrame();
  }

  /**
   * Fires every frame event between two clip positions, in order.
   *
   * @param clip - The playing clip.
   * @param from - The clip frame index playback was on.
   * @param toRaw - The unwrapped frame index playback reached.
   * @param count - How many frames the clip has.
   */
  #emitEventsBetween(clip: SpriteClip, from: number, toRaw: number, count: number): void {
    if (clip.events.length === 0) {
      return;
    }
    // A looping clip can pass every frame at most once per step's worth of wrapping; a
    // non-looping one stops at its last frame, and walking past it would fire that frame's events
    // again for every extra step the clamp swallowed.
    const reach = clip.loop ? count : count - 1 - from;
    const steps = Math.min(toRaw - from, reach);
    for (let step = 1; step <= steps; step += 1) {
      const frame = clip.loop ? (from + step) % count : from + step;
      for (let index = 0; index < clip.events.length; index += 1) {
        const event = clip.events[index];
        if (event !== undefined && event.frame === frame) {
          this.#onEvent.emit(event.name);
        }
      }
    }
  }

  /**
   * Writes the current clip frame onto the renderer.
   */
  #writeFrame(): void {
    const renderer = this.#findRenderer();
    const frame = this.#clip?.frames[this.#cursor];
    if (renderer !== null && frame !== undefined) {
      renderer.frame = frame;
    }
  }

  /**
   * The atlas the clips index into: the sibling renderer's.
   *
   * @returns The atlas, or `null`.
   */
  #atlas(): SpriteAtlasAsset | null {
    return this.#findRenderer()?.atlas ?? null;
  }

  /**
   * The `SpriteRenderer` on this entity, cached once found.
   *
   * @returns The renderer, or `null` when the entity has none.
   */
  #findRenderer(): SpriteRenderer | null {
    const cached = this.#renderer;
    if (cached !== null && !cached.isDestroyed) {
      return cached;
    }
    const found = this.entity.getComponent(SpriteRenderer);
    this.#renderer = found;
    return found;
  }
}

/**
 * The `SpriteAnimator` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function spriteAnimatorSchema(): Schema {
  return defineSchema({
    animations: asset(SpriteAnimationAsset, { tooltip: "The .spriteanim.json document holding the clips." }),
    defaultClip: str("", { tooltip: "Which clip to start on; empty plays the document's first." }),
    playOnAwake: bool(true, { tooltip: "Start the default clip as soon as the document has loaded." }),
    speed: f32(1, { min: 0, tooltip: "A multiplier on each clip's own frame rate." }),
  });
}

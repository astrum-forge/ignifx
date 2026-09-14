import { isIgnifxError } from "../../errors/ignifx-error.js";
import {
  appendPostProcessTask,
  createBloomTask,
  createChainColorTarget,
  createImageProcessingPass,
  createSmaaTask,
  disposePostProcessTask,
  setPostProcessTaskEnabled,
  surfaceRenderTarget,
  updateBloomTask,
  updateSmaaTask,
} from "../../lite/gpu/post-process.js";
import { effectTaskSupport, postEffectCompiler } from "../post-effect-support.js";
import { declaredTextureBinding } from "../post-effect.js";
import type { EffectChainLink, LiteEffect } from "../../lite/gpu/effect-task.js";
import type {
  LiteBloomTask,
  LitePostProcessTask,
  LiteRenderTarget,
  LiteSmaaTask,
} from "../../lite/gpu/post-process.js";
import type { ScenePresenter } from "../../lite/gpu/render-path.js";
import type { LiteTexture2D } from "../../lite/gpu/texture.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { EffectTaskSupport } from "../post-effect-support.js";
import type { CompiledPostEffect, CustomEffectSettings } from "../post-effect.js";
import type { BloomEffectSettings, SmaaEffectSettings } from "../post-process-stack.js";
import type { ShaderAsset } from "../shader-asset.js";

/**
 * The frame-graph half of `PostProcessStack` (`docs/architecture/07-rendering.md` §2.7).
 *
 * Device-only: a task cannot be created, recorded, enabled, or disposed without an engine and a
 * frame graph. `src/render/gpu/**` is excluded from the Node coverage floor for exactly that reason;
 * the browser project measures it.
 *
 * ## What the chain is plugged into
 *
 * With `rendering.features.postProcessing` on, the scene is not drawn into the swapchain at all. It
 * is drawn into an offscreen, single-sample colour target and a copy task composites that onto the
 * swapchain (`src/lite/gpu/render-path.ts`). The chain reads that target — the swapchain itself
 * carries no `TEXTURE_BINDING` and sampling it rejects the frame — ping-pongs through two links of
 * its own, and lands its last effect on the swapchain, at which point the compositing copy is
 * switched off:
 *
 * ```text
 * scene → sceneColor ─ bloom ─→ link A ─ smaa ─→ swapchain
 * ```
 *
 * Every target is sized by the surface and rebuilt by `frameGraph.build()`, so a canvas resize needs
 * nothing from this class.
 *
 * ## Image processing is always last
 *
 * `createImageProcessingTask` writes `engine.scRT` and takes no target
 * (`lib/frame-graph/image-processing-task.js`), so it cannot hand its output to another effect. The
 * chain moves it to the end whatever `order` the component declares, rather than silently producing
 * a frame in which the effects after it read a target nobody wrote.
 *
 * ## Tuning is live; topology is not
 *
 * A recorded task's tuning — bloom's `weight`, `kernel`, `threshold`, `exposure`; every SMAA field —
 * is written straight onto the Lite task and re-uploaded with `updateUniforms()` by
 * {@link PostProcessChain.applySettings}, which the stack calls every frame. It compares against
 * what it last uploaded, so a frame in which nothing moved uploads nothing. What a recorded task
 * cannot change is its shape: which effects exist, in which order, and bloom's `bloomScale`, which
 * sizes the blur targets at creation. Those are `PostProcessStack`'s to rebuild.
 */

/** What one custom `// @ignifx post` effect contributes to the chain. */
export interface CustomEffectRequest {
  /** The shader's address; part of the chain's identity. */
  readonly address: string;
  /** The compiled fragment module and uniform layout. */
  readonly compiled: CompiledPostEffect;
  /** The shader asset, for its declared uniform defaults. */
  readonly shader: ShaderAsset;
  /** The component's live record, read on every `applySettings`. */
  readonly settings: CustomEffectSettings;
  /** The Lite texture bound to each declared sampler, in declaration order. */
  readonly textures: readonly (LiteTexture2D | null)[];
}

/** What an effect entry contributes to the chain. */
export interface PostProcessEffectRequest {
  /** Which effect to build. */
  readonly name: "bloom" | "smaa" | "imageProcessing" | "custom";
  /** The bloom tuning, read only for the bloom entry. */
  readonly bloom: BloomEffectSettings;
  /** The SMAA tuning, read only for the SMAA entry. */
  readonly smaa: SmaaEffectSettings;
  /** Whether the chain's source is an sRGB view, which SMAA's edge detection needs to know. */
  readonly sourceIsSrgb: boolean;
  /** The custom effect, for a `"custom"` entry; `null` for the three built-ins. */
  readonly custom: CustomEffectRequest | null;
}

/** The three clocks a post effect can read, in seconds. */
interface FrameClock {
  /** Scaled seconds, frozen while the app is paused. */
  readonly time: number;
  /** Unscaled seconds. */
  readonly unscaledTime: number;
  /** This frame's scaled delta. */
  readonly deltaTime: number;
}

/** One recorded custom effect, and what it last uploaded. */
interface RecordedCustomEffect {
  /** The Lite effect wrapper. */
  readonly effect: LiteEffect;
  /** What it was recorded from. */
  readonly request: CustomEffectRequest;
  /** The uniform bytes, reused every frame so an upload allocates nothing. */
  readonly bytes: Float32Array;
  /** What was last uploaded, for the change comparison. */
  readonly uploaded: Float32Array;
  /** Whether anything has been uploaded yet. */
  hasUploaded: boolean;
  /** Set once its `values` were refused, so the failure is reported and skipped rather than repeated. */
  isRefused: boolean;
}

/** The bloom tuning a chain last uploaded, so an unchanged frame uploads nothing. */
interface AppliedBloom {
  weight: number;
  kernel: number;
  threshold: number;
  exposure: number;
}

/** The SMAA tuning a chain last uploaded. */
interface AppliedSmaa {
  threshold: number;
  maxSearchSteps: number;
  diagonalDetection: boolean;
  cornerDetection: boolean;
}

/** A recorded chain, and the handle that takes it down again. */
export class PostProcessChain {
  readonly #tasks: LitePostProcessTask[] = [];

  readonly #presenter: ScenePresenter;

  readonly #isFrameGraphBuilt: boolean;

  /** The sampled ping-pong links the custom effects read and write. */
  readonly #sampledLinks: EffectChainLink[] = [];

  /** The recorded custom effects, in chain order. */
  readonly #custom: RecordedCustomEffect[] = [];

  /** The bloom task, when the chain has one; the one task whose tuning is retuned live. */
  #bloom: LiteBloomTask | null = null;

  /** The SMAA task, when the chain has one. */
  #smaa: LiteSmaaTask | null = null;

  /** What the bloom task was created with, and then what it was last retuned to. */
  #appliedBloom: AppliedBloom | null = null;

  /** What the SMAA task was created with, and then what it was last retuned to. */
  #appliedSmaa: AppliedSmaa | null = null;

  /** Reports an effect whose `values` the compiler refused; called at most once per effect. */
  readonly #onValuesRefused: (address: string, message: string) => void;

  /**
   * Records the requested effects into a scene's frame graph.
   *
   * @param engine - The engine that owns the tasks' GPU resources; it is also the surface.
   * @param scene - The scene whose frame graph to extend.
   * @param presenter - The offscreen render path: the colour the chain reads, and the compositing
   * blit it takes over from.
   * @param effects - The enabled effects, first to last.
   * @param isFrameGraphBuilt - Whether the scene has been registered. A chain built **before**
   * registration only appends its tasks; `registerScene`'s own `frameGraph.build()` records them,
   * in array order, once the scene render task has allocated the colour they read. Recording them
   * there and then would raise Lite error 107 instead — see {@link appendPostProcessTask}.
   * @param onValuesRefused - Called once per effect whose `values` the compiler refuses.
   */
  constructor(
    engine: LiteEngine,
    scene: LiteScene,
    presenter: ScenePresenter,
    effects: readonly PostProcessEffectRequest[],
    isFrameGraphBuilt: boolean,
    onValuesRefused: (address: string, message: string) => void,
  ) {
    this.#presenter = presenter;
    this.#isFrameGraphBuilt = isFrameGraphBuilt;
    this.#onValuesRefused = onValuesRefused;
    const ordered = imageProcessingLast(effects);
    if (ordered.length === 0) {
      return;
    }
    const swapchain = surfaceRenderTarget(engine);
    // A chain that holds a custom effect ping-pongs through links that are *also* sampled textures,
    // because that is the only shape Lite's public fullscreen-effect path can read
    // (`src/lite/gpu/effect-task.ts`). They are eager and fixed-size, so they cost a chain rebuild
    // on a canvas resize — which is why `PostProcessStack` folds the surface size into its key.
    // Null unless the chain holds a custom effect, which cannot happen before a `.post.wgsl` has
    // loaded the Babylon Lite effect adapter.
    const effectTasks = ordered.some((effect) => effect.name === "custom") ? effectTaskSupport() : null;
    const plainLinks: LiteRenderTarget[] = [];
    let source: LiteRenderTarget = presenter.sceneColor;
    let sourceTexture: LiteTexture2D | null = null;
    for (let index = 0; index < ordered.length; index += 1) {
      const effect = ordered[index];
      if (effect === undefined) {
        continue;
      }
      const isLast = index === ordered.length - 1;
      if (effect.name === "imageProcessing") {
        // It writes the swapchain itself, so it needs no target and can only be last.
        this.#record(scene, createImageProcessingPass(engine, scene, source));
        continue;
      }
      if (effect.name === "custom" && effectTasks !== null) {
        if (sourceTexture === null) {
          // The scene colour carries no `Texture2D`, so one copy makes it samplable.
          const seed = this.#nextSampledLink(effectTasks, engine, source);
          this.#record(
            scene,
            effectTasks.createChainCopyTask(engine, scene, "ignifx:post-effect-copy", source, seed.target),
          );
          source = seed.target;
          sourceTexture = seed.texture;
        }
        const link = isLast ? null : this.#nextSampledLink(effectTasks, engine, source);
        const target = link?.target ?? swapchain;
        this.#record(scene, this.#recordCustom(effectTasks, engine, scene, effect, sourceTexture, target));
        source = target;
        sourceTexture = link?.texture ?? null;
        continue;
      }
      const link = isLast || effectTasks === null ? null : this.#nextSampledLink(effectTasks, engine, source);
      const target = isLast ? swapchain : (link?.target ?? nextLink(engine, plainLinks, source));
      this.#record(scene, this.#createEffect(engine, scene, effect, source, target));
      source = target;
      sourceTexture = link?.texture ?? null;
    }
    // The chain's last task now writes the swapchain, so the compositing blit would only be
    // overwritten. Turning it off is what keeps the extra full-screen pass off the frame budget.
    presenter.setPresentEnabled(false);
  }

  /**
   * How many frame-graph tasks the chain recorded.
   *
   * @returns The task count.
   */
  get taskCount(): number {
    return this.#tasks.length;
  }

  /**
   * Pushes the effects' current tuning to the recorded tasks, uploading only what changed since the
   * last call.
   *
   * @remarks
   * Nothing is uploaded until the scene's frame graph has been built: a task created before
   * `registerScene` has no uniform buffer yet, and it was created with the very settings it holds,
   * so there is nothing to catch up on. `scale` is not applied here — it is baked into the task and
   * a change to it is a rebuild, which `PostProcessStack` performs.
   *
   * @param bloom - The stack's bloom record.
   * @param smaa - The stack's SMAA record.
   * @param isFrameGraphBuilt - Whether the scene has been registered, so the tasks are recorded.
   */
  applySettings(bloom: BloomEffectSettings, smaa: SmaaEffectSettings, isFrameGraphBuilt: boolean): void {
    if (!isFrameGraphBuilt) {
      return;
    }
    const bloomTask = this.#bloom;
    const appliedBloom = this.#appliedBloom;
    if (
      bloomTask !== null &&
      appliedBloom !== null &&
      (appliedBloom.weight !== bloom.weight ||
        appliedBloom.kernel !== bloom.kernel ||
        appliedBloom.threshold !== bloom.threshold ||
        appliedBloom.exposure !== bloom.exposure)
    ) {
      appliedBloom.weight = bloom.weight;
      appliedBloom.kernel = bloom.kernel;
      appliedBloom.threshold = bloom.threshold;
      appliedBloom.exposure = bloom.exposure;
      updateBloomTask(bloomTask, appliedBloom);
    }
    const smaaTask = this.#smaa;
    const appliedSmaa = this.#appliedSmaa;
    if (
      smaaTask !== null &&
      appliedSmaa !== null &&
      (appliedSmaa.threshold !== smaa.threshold ||
        appliedSmaa.maxSearchSteps !== smaa.maxSearchSteps ||
        appliedSmaa.diagonalDetection !== smaa.diagonalDetection ||
        appliedSmaa.cornerDetection !== smaa.cornerDetection)
    ) {
      appliedSmaa.threshold = smaa.threshold;
      appliedSmaa.maxSearchSteps = smaa.maxSearchSteps;
      appliedSmaa.diagonalDetection = smaa.diagonalDetection;
      appliedSmaa.cornerDetection = smaa.cornerDetection;
      updateSmaaTask(smaaTask, appliedSmaa);
    }
  }

  /**
   * Switches every recorded task on or off. Lite offers no removal, so this is what "disable the
   * stack" means.
   *
   * @remarks
   * Switching the chain off switches the compositing blit back on, so the swapchain still receives
   * the frame — a disabled stack presents the plain scene rather than a stale one.
   *
   * @param enabled - `false` to skip every pass.
   */
  setEnabled(enabled: boolean): void {
    for (let index = 0; index < this.#tasks.length; index += 1) {
      const task = this.#tasks[index];
      if (task !== undefined) {
        setPostProcessTaskEnabled(task, enabled);
      }
    }
    if (this.#tasks.length > 0) {
      this.#presenter.setPresentEnabled(!enabled);
    }
  }

  /**
   * Uploads every custom effect's uniform bytes, and only the ones that changed.
   *
   * @remarks
   * `time` changes every frame, so a chain that holds a time-driven effect uploads its block every
   * frame — 32 bytes plus its declared uniforms, one `queue.writeBuffer`. An effect that declares
   * none of the clocks and whose values did not move uploads nothing.
   *
   * @param clock - The app's scaled time, unscaled time, and frame delta, in seconds.
   * @param width - The surface width in backing-store pixels.
   * @param height - The surface height in backing-store pixels.
   * @param isFrameGraphBuilt - Whether the tasks are recorded; before that there is nothing to
   * upload into.
   */
  applyCustomSettings(clock: FrameClock, width: number, height: number, isFrameGraphBuilt: boolean): void {
    const compiler = postEffectCompiler();
    const effects = effectTaskSupport();
    if (!isFrameGraphBuilt || compiler === null || effects === null) {
      return;
    }
    for (const recorded of this.#custom) {
      if (recorded.isRefused) {
        continue;
      }
      const bytes = recorded.bytes;
      bytes.fill(0);
      const compiled = recorded.request.compiled;
      writeBuiltins(compiled, bytes, clock, width, height);
      try {
        compiler.writePostEffectValues(compiled, recorded.request.shader, recorded.request.settings.values, bytes);
      } catch (failure: unknown) {
        // An undeclared or wrongly shaped `values` entry would otherwise throw out of `PreRender`
        // every frame; the effect stops uploading and the failure is reported once.
        recorded.isRefused = true;
        this.#onValuesRefused(recorded.request.address, isIgnifxError(failure) ? failure.message : String(failure));
        continue;
      }
      if (recorded.hasUploaded && equalFloats(bytes, recorded.uploaded)) {
        continue;
      }
      recorded.uploaded.set(bytes);
      recorded.hasUploaded = true;
      effects.writeCustomEffectUniforms(recorded.effect, bytes);
    }
  }

  /** Disables and disposes every recorded task, in the order Lite requires. */
  dispose(): void {
    for (let index = 0; index < this.#tasks.length; index += 1) {
      const task = this.#tasks[index];
      if (task !== undefined) {
        // Disable first: a disposed task that still executes is a use-after-free.
        setPostProcessTaskEnabled(task, false);
        disposePostProcessTask(task);
      }
    }
    if (this.#tasks.length > 0) {
      this.#presenter.setPresentEnabled(true);
    }
    const effects = effectTaskSupport();
    for (const recorded of this.#custom) {
      effects?.disposeCustomEffect(recorded.effect);
    }
    for (const link of this.#sampledLinks) {
      // Lite refuses to free an eager target, which is what stopped `EffectRenderTask.dispose` from
      // destroying a link two tasks share, so the texture is freed here instead.
      effects?.disposeEffectChainLink(link);
    }
    this.#custom.length = 0;
    this.#sampledLinks.length = 0;
    this.#tasks.length = 0;
    this.#bloom = null;
    this.#smaa = null;
    this.#appliedBloom = null;
    this.#appliedSmaa = null;
  }

  /**
   * Builds one custom effect's wrapper, binds its textures, and records its task.
   *
   * @param effects - The Babylon Lite effect adapter.
   * @param engine - The engine that owns the GPU resources.
   * @param scene - The scene it belongs to.
   * @param effect - The requested effect.
   * @param sourceTexture - The chain's current colour, as a sampled texture.
   * @param target - The colour target it writes.
   * @returns The task.
   */
  #recordCustom(
    effects: EffectTaskSupport,
    engine: LiteEngine,
    scene: LiteScene,
    effect: PostProcessEffectRequest,
    sourceTexture: LiteTexture2D,
    target: LiteRenderTarget,
  ): LitePostProcessTask {
    const request = effect.custom;
    if (request === null) {
      throw new Error("a custom post-process entry carries no compiled effect");
    }
    const compiled = request.compiled;
    const wrapper = effects.createCustomEffect(engine, {
      name: `ignifx:post-effect:${request.address}`,
      fragmentWGSL: compiled.fragmentWGSL,
      uniformByteLength: compiled.uniformByteLength,
      declaredTextures: compiled.textures.map((texture) => ({ array: texture.array })),
    });
    effects.bindCustomEffectTexture(wrapper, 1, sourceTexture);
    for (let index = 0; index < compiled.textures.length; index += 1) {
      const texture = request.textures[index];
      if (texture !== null && texture !== undefined) {
        effects.bindCustomEffectTexture(wrapper, declaredTextureBinding(index), texture);
      }
    }
    const floats = compiled.uniformByteLength / 4;
    this.#custom.push({
      effect: wrapper,
      request,
      bytes: new Float32Array(floats),
      uploaded: new Float32Array(floats),
      hasUploaded: false,
      isRefused: false,
    });
    return effects.createCustomEffectTask(engine, scene, `ignifx:post-effect:${request.address}`, wrapper, target);
  }

  /**
   * The next sampled ping-pong link that is not the one being read.
   *
   * @remarks
   * Created on demand, so a chain with one custom effect writing the swapchain allocates only the
   * link that seeds it.
   *
   * @param effects - The Babylon Lite effect adapter.
   * @param engine - The engine, which is also the surface the links are sized to.
   * @param source - What the next effect reads.
   * @returns A link whose target is not `source`.
   */
  #nextSampledLink(effects: EffectTaskSupport, engine: LiteEngine, source: LiteRenderTarget): EffectChainLink {
    for (const link of this.#sampledLinks) {
      if (link.target !== source) {
        return link;
      }
    }
    const created = effects.createEffectChainLink(
      engine,
      engine.format,
      engine.canvas.width,
      engine.canvas.height,
      `ignifx:post-effect-link-${String(this.#sampledLinks.length)}`,
    );
    this.#sampledLinks.push(created);
    return created;
  }

  /**
   * Appends one task to the scene's frame graph and remembers it.
   *
   * @param scene - The scene whose frame graph to extend.
   * @param task - The task.
   */
  #record(scene: LiteScene, task: LitePostProcessTask): void {
    appendPostProcessTask(scene, task, this.#isFrameGraphBuilt);
    this.#tasks.push(task);
  }

  /**
   * Builds one bloom or SMAA task.
   *
   * @param engine - The engine that owns its GPU resources.
   * @param scene - The scene it belongs to.
   * @param effect - The requested effect and its tuning.
   * @param source - The colour target it reads.
   * @param target - The colour target it writes.
   * @returns The task.
   */
  #createEffect(
    engine: LiteEngine,
    scene: LiteScene,
    effect: PostProcessEffectRequest,
    source: LiteRenderTarget,
    target: LiteRenderTarget,
  ): LitePostProcessTask {
    if (effect.name === "bloom") {
      const settings = effect.bloom;
      // Copied, not referenced: the record is the component's live state, and the point of the
      // copy is to know later what the task actually holds.
      this.#appliedBloom = {
        weight: settings.weight,
        kernel: settings.kernel,
        threshold: settings.threshold,
        exposure: settings.exposure,
      };
      const task = createBloomTask(engine, scene, source, target, { ...this.#appliedBloom, scale: settings.scale });
      this.#bloom = task;
      return task;
    }
    const settings = effect.smaa;
    this.#appliedSmaa = {
      threshold: settings.threshold,
      maxSearchSteps: settings.maxSearchSteps,
      diagonalDetection: settings.diagonalDetection,
      cornerDetection: settings.cornerDetection,
    };
    const task = createSmaaTask(engine, scene, source, target, {
      ...this.#appliedSmaa,
      sourceIsSrgb: effect.sourceIsSrgb,
    });
    this.#smaa = task;
    return task;
  }
}

/**
 * The requested effects with the image-processing pass moved to the end, where Lite's task can only
 * work.
 *
 * @param effects - The enabled effects, in the order the component declared.
 * @returns The order the chain records. The array is fresh, so the component's own list is untouched.
 *
 * @internal
 */
export function imageProcessingLast(effects: readonly PostProcessEffectRequest[]): readonly PostProcessEffectRequest[] {
  const ordered: PostProcessEffectRequest[] = [];
  let grading: PostProcessEffectRequest | null = null;
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index];
    if (effect === undefined) {
      continue;
    }
    if (effect.name === "imageProcessing") {
      grading = effect;
    } else {
      ordered.push(effect);
    }
  }
  if (grading !== null) {
    ordered.push(grading);
  }
  return ordered;
}

/**
 * Records a chain for the requested effects, when there is a device and anything to record.
 *
 * @param engine - The engine that owns the tasks' GPU resources.
 * @param scene - The scene whose frame graph to extend.
 * @param presenter - The offscreen render path, or `null` under a headless app.
 * @param isHeadless - Whether the app has a device.
 * @param effects - The enabled effects, first to last.
 * @param isFrameGraphBuilt - Whether the scene has been registered.
 * @param isEnabled - What the component's `enabled` currently says.
 * @param onValuesRefused - Called once per effect whose `values` the compiler refuses.
 * @returns The chain, or `null` when there was nothing to record.
 *
 * @internal
 */
export function recordPostProcessChain(
  engine: LiteEngine,
  scene: LiteScene,
  presenter: ScenePresenter | null,
  isHeadless: boolean,
  effects: readonly PostProcessEffectRequest[],
  isFrameGraphBuilt: boolean,
  isEnabled: boolean,
  onValuesRefused: (address: string, message: string) => void,
): PostProcessChain | null {
  if (isHeadless || presenter === null || effects.length === 0) {
    return null;
  }
  const chain = new PostProcessChain(engine, scene, presenter, effects, isFrameGraphBuilt, onValuesRefused);
  chain.setEnabled(isEnabled);
  return chain;
}

/**
 * Pushes this frame's tuning to a recorded chain, when there is one.
 *
 * @param chain - The chain, or `null`.
 * @param isEnabled - What the component's `enabled` currently says.
 * @param bloom - The bloom tuning.
 * @param smaa - The SMAA tuning.
 * @param clock - The app's three clocks.
 * @param width - The surface width in backing-store pixels, or `0` when there is no surface.
 * @param height - The surface height in backing-store pixels.
 * @param isSceneRegistered - Whether the frame graph has been built.
 *
 * @internal
 */
export function applyPostProcessSettings(
  chain: PostProcessChain | null,
  isEnabled: boolean,
  bloom: BloomEffectSettings,
  smaa: SmaaEffectSettings,
  clock: FrameClock,
  width: number,
  height: number,
  isSceneRegistered: boolean,
): void {
  if (chain === null) {
    return;
  }
  chain.setEnabled(isEnabled);
  chain.applySettings(bloom, smaa, isSceneRegistered);
  chain.applyCustomSettings(clock, width, height, isSceneRegistered);
}

/**
 * Writes the four uniforms every post effect gets for free into its uniform bytes.
 *
 * @param compiled - The compiled effect, for the members' byte offsets.
 * @param bytes - The uniform floats.
 * @param clock - The app's scaled time, unscaled time, and frame delta, in seconds.
 * @param width - The surface width in backing-store pixels.
 * @param height - The surface height in backing-store pixels.
 */
function writeBuiltins(
  compiled: CompiledPostEffect,
  bytes: Float32Array,
  clock: FrameClock,
  width: number,
  height: number,
): void {
  const screenSize = compiled.byName.get("screenSize");
  if (screenSize !== undefined) {
    const index = screenSize.byteOffset / 4;
    bytes[index] = width;
    bytes[index + 1] = height;
  }
  const time = compiled.byName.get("time");
  if (time !== undefined) {
    bytes[time.byteOffset / 4] = clock.time;
  }
  const unscaledTime = compiled.byName.get("unscaledTime");
  if (unscaledTime !== undefined) {
    bytes[unscaledTime.byteOffset / 4] = clock.unscaledTime;
  }
  const deltaTime = compiled.byName.get("deltaTime");
  if (deltaTime !== undefined) {
    bytes[deltaTime.byteOffset / 4] = clock.deltaTime;
  }
}

/**
 * Whether two equally long float arrays hold the same values.
 *
 * @param left - One array.
 * @param right - The other.
 * @returns `true` when every element matches.
 */
function equalFloats(left: Float32Array, right: Float32Array): boolean {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * The ping-pong target the next effect writes: never the one it is reading.
 *
 * @remarks
 * Two links are enough for any chain length, and they are created on demand so a chain of one
 * allocates none at all.
 *
 * @param engine - The engine, which is also the surface the links are sized to.
 * @param links - The links created so far; this appends to it.
 * @param source - What the next effect reads.
 * @returns A target that is not `source`.
 */
function nextLink(engine: LiteEngine, links: LiteRenderTarget[], source: LiteRenderTarget): LiteRenderTarget {
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    if (link !== undefined && link !== source) {
      return link;
    }
  }
  const created = createChainColorTarget(engine, `ignifx:post-process-${String(links.length)}`);
  links.push(created);
  return created;
}

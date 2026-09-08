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
import type {
  LiteBloomTask,
  LitePostProcessTask,
  LiteRenderTarget,
  LiteSmaaTask,
} from "../../lite/gpu/post-process.js";
import type { ScenePresenter } from "../../lite/gpu/render-path.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { BloomEffectSettings, SmaaEffectSettings } from "../post-process-stack.js";

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

/** What an effect entry contributes to the chain. */
export interface PostProcessEffectRequest {
  /** Which effect to build. */
  readonly name: "bloom" | "smaa" | "imageProcessing";
  /** The bloom tuning, read only for the bloom entry. */
  readonly bloom: BloomEffectSettings;
  /** The SMAA tuning, read only for the SMAA entry. */
  readonly smaa: SmaaEffectSettings;
  /** Whether the chain's source is an sRGB view, which SMAA's edge detection needs to know. */
  readonly sourceIsSrgb: boolean;
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

  /** The bloom task, when the chain has one; the one task whose tuning is retuned live. */
  #bloom: LiteBloomTask | null = null;

  /** The SMAA task, when the chain has one. */
  #smaa: LiteSmaaTask | null = null;

  /** What the bloom task was created with, and then what it was last retuned to. */
  #appliedBloom: AppliedBloom | null = null;

  /** What the SMAA task was created with, and then what it was last retuned to. */
  #appliedSmaa: AppliedSmaa | null = null;

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
   */
  constructor(
    engine: LiteEngine,
    scene: LiteScene,
    presenter: ScenePresenter,
    effects: readonly PostProcessEffectRequest[],
    isFrameGraphBuilt: boolean,
  ) {
    this.#presenter = presenter;
    this.#isFrameGraphBuilt = isFrameGraphBuilt;
    const ordered = imageProcessingLast(effects);
    if (ordered.length === 0) {
      return;
    }
    const swapchain = surfaceRenderTarget(engine);
    const links: LiteRenderTarget[] = [];
    let source: LiteRenderTarget = presenter.sceneColor;
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
      const target = isLast ? swapchain : nextLink(engine, links, source);
      this.#record(scene, this.#createEffect(engine, scene, effect, source, target));
      source = target;
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
    this.#tasks.length = 0;
    this.#bloom = null;
    this.#smaa = null;
    this.#appliedBloom = null;
    this.#appliedSmaa = null;
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

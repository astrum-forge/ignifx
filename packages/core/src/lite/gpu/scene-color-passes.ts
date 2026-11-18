import {
  addTaskAfter,
  buildFrameGraphTask,
  createCopyToTextureTask,
  createSurfaceRenderTargetTexture,
  disposeRenderTargetTexture,
  getFrameGraph,
} from "@babylonjs/lite";
import { frameGraphTasks } from "./scene-inputs.js";
import type { ScenePresenter } from "./render-path.js";
import type { EngineContext, RenderTarget, RenderTargetTextureResult, SceneContext, Task } from "@babylonjs/lite";

/**
 * Scene-colour passes (`docs/architecture/07-rendering.md` §2.7): Lite screen-space effects that
 * read the lit scene colour and the shared scene-input depth, and whose result replaces the scene
 * colour before anything else reads it. Its own chunk, loaded with the first such effect
 * (`CONSTITUTION.md` §2.5).
 *
 * ```text
 * scene ─→ S ─ pass 1 ─→ scratch ─ pass 2 ─→ S ─ … [─ copy ─→ S] ─→ present / output pass / chain
 * ```
 *
 * `S` is the presenter's {@link ScenePresenter.scenePass} target: `sceneColor` on the plain path,
 * the linear `rgba16float` target under `rendering.hdr`, so the passes see linear colour ahead of
 * the output pass there. Lite's composite cannot write its own source, so under HDR the passes
 * ping-pong between `S` and one scratch target of the same format, and a copy brings an odd count
 * back into `S`. On the plain path no pass may write `S` (`ScenePass.isTargetWritable` in `./render-path.ts`): the
 * passes ping-pong between two scratch targets and the copy always runs. Every task sits right after
 * the scene task, ahead of the present blit, the HDR output pass and a `PostProcessStack` chain
 * alike, which therefore need no change.
 *
 * A pass may instead add to the colour it reads through the blend unit
 * ({@link SceneColorPass.inPlace}, SSGI): it gets one target as both. Under HDR that is `S` itself,
 * or the scratch an earlier pass wrote. On the plain path, where `S` cannot be written, a copy
 * stages `S` into a scratch first:
 *
 * ```text
 * scene ─→ S ─ copy ─→ scratch ─ in-place pass ─→ scratch ─ copy ─→ S
 * ```
 *
 * The scratch targets are eager surface targets (`createSurfaceRenderTargetTexture`), the kind the
 * HDR target is: a task that writes one in `record()` does not reallocate it, so several tasks can
 * write the same scratch, and a resize is followed by the frame graph's rebuild.
 */

/**
 * One scene-colour effect, as the installer sees it.
 *
 * @internal
 */
export interface SceneColorPass {
  /**
   * `true` for a pass that blends its result onto the colour it reads instead of writing a second
   * target. Its {@link SceneColorPass.create} is then called with the same target twice, one an
   * effect task may write.
   */
  readonly inPlace?: boolean;
  /**
   * Creates the effect's tasks.
   *
   * @param source - The colour it reads.
   * @param target - The colour it writes: never `source`, unless the pass is
   * {@link SceneColorPass.inPlace}, when it is `source`.
   * @returns The task, or the tasks in the order they run.
   */
  create(source: RenderTarget, target: RenderTarget): Task | readonly Task[];
}

/**
 * The installed passes.
 *
 * @internal
 */
export interface InstalledSceneColorPasses {
  /** How many tasks were added, copy included. */
  readonly taskCount: number;
  /** Removes and disposes every task and the scratch target. Idempotent. */
  dispose(): void;
}

/**
 * Inserts the passes after the scene task, in order.
 *
 * @param engine - The engine; also the surface the scratch target is sized by.
 * @param scene - The scene.
 * @param presenter - The offscreen render path.
 * @param passes - The effects, first to last.
 * @param isFrameGraphBuilt - Whether the scene is registered, so each task is recorded now.
 * @returns The handle that takes them out again.
 *
 * @internal
 */
export function installSceneColorPasses(
  engine: EngineContext,
  scene: SceneContext,
  presenter: ScenePresenter,
  passes: readonly SceneColorPass[],
  isFrameGraphBuilt: boolean,
): InstalledSceneColorPasses {
  const { task: sceneTask, target: sceneTarget, format, isTargetWritable } = presenter.scenePass;
  const scratches: RenderTarget[] = [];
  const scratchTextures: RenderTargetTextureResult[] = [];
  const createScratch = (index: number): RenderTarget => {
    const scratch = createSurfaceRenderTargetTexture(engine, {
      lbl: index === 0 ? "ignifx:scene-color-scratch" : "ignifx:scene-color-scratch-2",
      format,
      samples: 1,
      size: engine,
    });
    scratchTextures.push(scratch);
    return scratch.rt;
  };
  const tasks: Task[] = [];
  let source = sceneTarget;
  for (const pass of passes) {
    if (pass.inPlace === true) {
      if (source === sceneTarget && !isTargetWritable) {
        const staged = sceneColorPassTarget(source, sceneTarget, isTargetWritable, scratches, createScratch);
        tasks.push(
          createCopyToTextureTask(
            { name: "ignifx:scene-color-stage", sourceTexture: source, targetTexture: staged },
            engine,
            scene,
          ),
        );
        source = staged;
      }
      appendTasks(tasks, pass.create(source, source));
      continue;
    }
    const target = sceneColorPassTarget(source, sceneTarget, isTargetWritable, scratches, createScratch);
    appendTasks(tasks, pass.create(source, target));
    source = target;
  }
  if (source !== sceneTarget) {
    tasks.push(
      createCopyToTextureTask(
        { name: "ignifx:scene-color-copy", sourceTexture: source, targetTexture: sceneTarget },
        engine,
        scene,
      ),
    );
  }
  let after = sceneTask;
  for (const task of tasks) {
    addTaskAfter(scene, task, after);
    after = task;
  }
  if (isFrameGraphBuilt) {
    const graph = getFrameGraph(scene);
    for (const task of tasks) {
      buildFrameGraphTask(graph, task);
    }
  }
  let isDisposed = false;
  return {
    taskCount: tasks.length,
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      const list = frameGraphTasks(scene);
      for (const task of tasks) {
        // Disable first: a disposed task that still executes is a use-after-free.
        task.executionEnabled = false;
        const index = list?.indexOf(task) ?? -1;
        if (list !== null && index >= 0) {
          list.splice(index, 1);
        }
        task.dispose();
      }
      for (const scratch of scratchTextures) {
        disposeRenderTargetTexture(scratch);
      }
    },
  };
}

/**
 * Appends what a pass created to the task list.
 *
 * @param tasks - The list.
 * @param created - One task or several.
 */
function appendTasks(tasks: Task[], created: Task | readonly Task[]): void {
  if (isTaskList(created)) {
    tasks.push(...created);
  } else {
    tasks.push(created);
  }
}

/**
 * Whether a pass returned several tasks.
 *
 * @param created - What `create` returned.
 * @returns `true` for a list.
 */
function isTaskList(created: Task | readonly Task[]): created is readonly Task[] {
  return Array.isArray(created);
}

/**
 * Picks where the next scene-colour pass writes: back into the scene target when that is allowed
 * and the pass does not read it, otherwise the scratch target the pass does not read.
 *
 * @param source - What the pass reads.
 * @param sceneTarget - The scene's colour target.
 * @param isTargetWritable - Whether a pass may write `sceneTarget` (`ScenePass.isTargetWritable` in `./render-path.ts`).
 * @param scratches - The scratch targets made so far; a new one is appended when needed.
 * @param createScratch - Makes the scratch target at an index, 0 or 1.
 * @returns The target, never `source`.
 *
 * @internal
 */
export function sceneColorPassTarget<T>(
  source: T,
  sceneTarget: T,
  isTargetWritable: boolean,
  scratches: T[],
  createScratch: (index: number) => T,
): T {
  if (source !== sceneTarget && isTargetWritable) {
    return sceneTarget;
  }
  const index = source === scratches[0] ? 1 : 0;
  let scratch = scratches[index];
  if (scratch === undefined) {
    scratch = createScratch(index);
    scratches[index] = scratch;
  }
  return scratch;
}

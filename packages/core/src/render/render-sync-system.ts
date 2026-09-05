import { setSceneCamera } from "../lite/camera.js";
import { rebuildRenderables } from "../lite/shadow.js";
import { Camera } from "./camera.js";
import { Environment } from "./environment.js";
import { Light } from "./light.js";
import { MeshRenderer } from "./mesh-renderer.js";
import { Model } from "./model.js";
import { PostProcessStack } from "./post-process-stack.js";
import type { RendererImpl } from "./renderer.js";
import type { System, SystemContext } from "../app/types.js";
import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { World } from "../world/world.js";

/**
 * The `PreRender` system that reconciles the render components with the Lite scene
 * (`docs/architecture/01-lifecycle-and-time.md` §3 step 6, `07-rendering.md` §2).
 *
 * ## What it does not do
 *
 * It does **not** copy transforms. A `Camera` is parented under its entity's node, a `Light` is
 * parented under its entity's node, and a `MeshRenderer`'s clone is parented under its entity's
 * node, so Lite composes `parentWorld × local` on every read and an entity that moved is already
 * where it should be (`src/lite/node.ts`). Copying would be work with no result.
 *
 * ## What it does
 *
 * 1. **Field reconciliation.** Every component compares each field with the value it last applied
 *    and writes only what changed. That is what makes a scene file's props — decoded *after*
 *    `addComponent` ran (`06-serialization-and-scene-format.md` §4 step 5) — reach Lite without the
 *    components needing a dirty API of their own, and it is what makes a script's edit take effect
 *    on the next frame with no bookkeeping at the call site.
 * 2. **Visibility.** `entity.activeInHierarchy && component.enabled` is materialised onto each
 *    clone's `visible`. Never removal: Lite disposes a mesh that leaves its last scene.
 * 3. **One `rebuildSceneRenderables` per frame.** Adding a mesh, adding a light, or giving a light
 *    a shadow generator all invalidate the per-mesh light index list and the compiled shader
 *    permutation that renderables bake in (`index.d.ts` 9465). The call is expensive, so every
 *    topology change in a frame is coalesced into one, fired at the end of the phase and not
 *    awaited — it resolves on its own, and the frame must not block on it.
 * 4. **Main-camera selection.** The enabled camera with the highest `priority` becomes
 *    `scene.camera` and `world.mainCamera`; ties break on creation order, so two cameras at the
 *    same priority resolve deterministically. A world with no enabled camera logs `IGX-0706` once.
 * 5. **Shadow caster lists.** Lite keys a generator's caster list by array identity and re-preloads
 *    the shadow pipeline whenever a **new** array arrives, so the list is rebuilt only in a frame
 *    where the caster set actually changed, and the same array is handed to every casting light.
 *    Both renderable components contribute: a `MeshRenderer` adds its one clone, a `Model` adds
 *    every mesh of its instantiated subtree, and each reports its own change through
 *    `consumeCasterChange`. A component destroyed between frames cannot report anything — it has
 *    left the world's list — so it raises `renderer.needsCasterRebuild` from `onDetach` instead.
 * 6. **One environment.** The enabled `Environment` with the highest creation order wins; a second
 *    one logs `IGX-0705` once per world.
 */

/**
 * Where render synchronisation sits inside `PreRender`.
 *
 * @remarks
 * Late in the phase, so that interpolation, animation, and any extension that moves a transform in
 * `PreRender` have already run: this system reads the world the frame ends with
 * (`docs/architecture/03-scripting-and-components.md` §6 — core systems use `[-1000, 1000]`).
 *
 * @internal
 */
export const RENDER_SYNC_ORDER = 900;

/**
 * Reconciles the render components with the Lite scene once per frame.
 *
 * @internal
 */
export class RenderSyncSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/render-sync";

  readonly #renderer: RendererImpl;

  readonly #casters: LiteMesh[] = [];

  #hasLoggedMultipleEnvironments = false;

  #isRebuildDue = false;

  #isRebuildInFlight = false;

  #areCastersDirty = false;

  /**
   * Creates the system.
   *
   * @param renderer - The rendering service, which holds the render layer's per-app state.
   */
  constructor(renderer: RendererImpl) {
    this.#renderer = renderer;
  }

  /**
   * Runs one frame of render synchronisation.
   *
   * @param ctx - The world, the clock, the phase, and the frame delta.
   */
  update(ctx: SystemContext): void {
    this.sync(ctx.world);
  }

  /**
   * Reconciles one world with its Lite scene.
   *
   * @remarks
   * Separated from {@link RenderSyncSystem.update} because `app.start()` runs it **once before**
   * `registerScene`, so a world whose scene was built before the app started registers with its
   * cameras, lights, and meshes already in the Lite scene — the fast path
   * (`docs/architecture/07-rendering.md` §1.1: entities added afterwards go through the runtime
   * material-swap path instead).
   *
   * @param world - The world to reconcile.
   *
   * @internal
   */
  sync(world: World): void {
    const renderer = this.#renderer;
    const meshes = world.components(MeshRenderer);
    const models = world.components(Model);
    const lights = world.components(Light);
    const cameras = world.components(Camera);

    let topologyChanged = false;
    // A component that was destroyed since the last frame is no longer in any of these lists, so
    // the flag it raised in `onDetach` is the only way its meshes leave the caster lists.
    let castersChanged = renderer.needsCasterRebuild;
    renderer.needsCasterRebuild = false;
    for (let index = 0; index < meshes.length; index += 1) {
      const renderable = meshes[index];
      if (renderable === undefined) {
        continue;
      }
      topologyChanged = renderable.sync(renderer) || topologyChanged;
      castersChanged = renderable.consumeCasterChange() || castersChanged;
    }
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (model !== undefined) {
        topologyChanged = model.sync(renderer) || topologyChanged;
        castersChanged = model.consumeCasterChange() || castersChanged;
      }
    }
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (light === undefined) {
        continue;
      }
      const changed = light.sync(renderer);
      topologyChanged = changed || topologyChanged;
      castersChanged = changed || castersChanged;
    }

    this.#selectCamera(world, cameras);
    this.#applyEnvironment(world);
    this.#applyStacks(world);
    this.#areCastersDirty = this.#areCastersDirty || castersChanged;
    // The rebuild is deferred by one frame on purpose; see `#rebuildRenderables`.
    if (this.#isRebuildDue && !topologyChanged) {
      this.#isRebuildDue = false;
      this.#rebuildRenderables();
    }
    this.#isRebuildDue = this.#isRebuildDue || topologyChanged;
    // Caster lists come **after** the renderable rebuild has settled; see `#rebuildCasters`.
    if (this.#areCastersDirty && !this.#isRebuildDue && !this.#isRebuildInFlight) {
      this.#areCastersDirty = false;
      this.#rebuildCasters(meshes, models, lights);
    }
    renderer.publishCounters(cameras.length, lights.length, meshes.length);
  }

  /**
   * Picks the enabled camera with the highest priority and installs it.
   *
   * @param world - The world being reconciled.
   * @param cameras - Every camera in the world, in creation order.
   */
  #selectCamera(world: World, cameras: readonly Camera[]): void {
    const renderer = this.#renderer;
    let best: Camera | null = null;
    for (let index = 0; index < cameras.length; index += 1) {
      const camera = cameras[index];
      if (camera === undefined || !camera.isEnabledInHierarchy) {
        continue;
      }
      camera.sync(renderer);
      if (best === null || camera.priority > best.priority) {
        best = camera;
      }
    }
    world.setMainCamera(best);
    setSceneCamera(renderer.scene, best?.lite.camera ?? null);
    if (best === null) {
      this.#warnAboutMissingCamera(world);
      return;
    }
    renderer.hasLoggedNoCamera = false;
    const override = best.clearColor;
    if (override !== null) {
      renderer.applyClearColor(override);
    }
  }

  /**
   * Says once, at warning level, that the world renders nothing because no camera is enabled.
   *
   * @param world - The world being reconciled.
   */
  #warnAboutMissingCamera(world: World): void {
    const renderer = this.#renderer;
    if (renderer.hasLoggedNoCamera) {
      return;
    }
    renderer.hasLoggedNoCamera = true;
    world.app.log.warn("IGX-0706: this world has no enabled camera, so nothing is drawn.");
  }

  /**
   * Applies the winning `Environment`, warning once when a world has more than one enabled.
   *
   * @param world - The world being reconciled.
   */
  #applyEnvironment(world: World): void {
    const environments = world.components(Environment);
    let winner: Environment | null = null;
    let enabledCount = 0;
    for (let index = 0; index < environments.length; index += 1) {
      const environment = environments[index];
      if (environment === undefined || !environment.isEnabledInHierarchy) {
        continue;
      }
      enabledCount += 1;
      // Later in the live component list means created later, which is what "most recently
      // enabled wins" resolves to for a list the store appends to.
      winner = environment;
    }
    if (enabledCount > 1 && !this.#hasLoggedMultipleEnvironments) {
      this.#hasLoggedMultipleEnvironments = true;
      world.app.log.warn(
        "IGX-0705: {count} Environment components are enabled in this world; the most recent one wins.",
        enabledCount,
      );
    }
    if (enabledCount <= 1) {
      this.#hasLoggedMultipleEnvironments = false;
    }
    winner?.sync(this.#renderer);
  }

  /**
   * Reconciles every post-process stack.
   *
   * @param world - The world being reconciled.
   */
  #applyStacks(world: World): void {
    const stacks = world.components(PostProcessStack);
    for (let index = 0; index < stacks.length; index += 1) {
      stacks[index]?.sync(this.#renderer);
    }
  }

  /**
   * Rebuilds the shadow caster list once and hands the same array to every casting light.
   *
   * @remarks
   * **Never in a frame that still owes a renderable rebuild.** Lite's shadow task builds a render
   * task out of the caster meshes and flushes its pending list by looking each caster material's
   * `_buildGroup` up in `scene._groups`; a group that is not there yet is `throw Error()` with no
   * message, inside the frame (`lib/frame-graph/render-task.js`). A caster added at runtime — the
   * ordinary case for a `Model`, whose component only exists once its glTF handle settled — has no
   * group until `rebuildSceneRenderables` has drained the material swap it queued. So the dirty
   * flag is held until the pending rebuild has been fired *and* resolved, which cost 3 uncaught
   * errors in 12 loads of the glTF viewer on SwiftShader before it was measured (2026-09-06).
   *
   * @param meshes - Every mesh renderer in the world.
   * @param models - Every model in the world; each contributes its whole instantiated subtree.
   * @param lights - Every light in the world.
   */
  #rebuildCasters(meshes: readonly MeshRenderer[], models: readonly Model[], lights: readonly Light[]): void {
    const casters = this.#casters;
    casters.length = 0;
    for (let index = 0; index < meshes.length; index += 1) {
      meshes[index]?.collectCasters(casters);
    }
    for (let index = 0; index < models.length; index += 1) {
      models[index]?.collectCasters(casters);
    }
    // Lite keys the list by array identity, so a fresh array is what tells it the set changed.
    const snapshot = casters.slice();
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (light?.isCastingShadows === true) {
        light.setShadowCasters(snapshot);
      }
    }
  }

  /**
   * Fires the one renderable rebuild the previous frame's topology changes earned.
   *
   * @remarks
   * **It is deliberately one frame late.** A mesh added inside the before-render callback is not in
   * a renderable group yet: `addToScene` queues a material swap that `processMaterialSwaps` drains
   * at the *start* of the next frame (`lib/scene/scene-material-swap.js`). Rebuilding in the same
   * frame therefore rebuilds the groups the mesh has not joined, the mesh joins afterwards with the
   * light list the group was built with, and nothing schedules a second rebuild — which on
   * SwiftShader leaves the scene's render pass presenting nothing at all when the warm-up probes
   * registered a group into a scene that had no lights yet (measured 2026-09-05; the same
   * combination is pinned in `test/render/warm-up.browser.test.ts`). Waiting one frame is the whole
   * fix, and it costs a frame of a stale light list on the frame a light was added.
   *
   * The counter is incremented before the headless gate: "one rebuild however many things changed"
   * is a property of the *coalescing*, not of the GPU, and counting it here is what lets a Node test
   * assert it without a device.
   */
  #rebuildRenderables(): void {
    const renderer = this.#renderer;
    renderer.renderableRebuilds += 1;
    // A rebuild bumps the scene's renderable version, and Lite's shadow task re-records itself
    // whenever that version moves (`lib/frame-graph/shadow-task.js`, `execute`). Recording a shadow
    // pass for a renderable whose shadow-variant pipeline has not been compiled throws inside the
    // frame — intermittently, because it depends on how far the rebuild got. Re-supplying the
    // caster list is what prevents it: `setShadowTaskCasterMeshes` parks the generator behind
    // `_preloadPending` until the pipelines for that array are built
    // (`lib/frame-graph/shadow-inputs.js`), so the task skips instead of throwing. Measured on
    // SwiftShader against the glTF viewer, 2026-09-06: 3 uncaught errors in 12 loads without this.
    renderer.needsCasterRebuild = true;
    if (renderer.isHeadless || !renderer.isSceneRegistered) {
      return;
    }
    this.#isRebuildInFlight = true;
    // Out of the frame callback as well as out of the frame: the whole ignifx frame runs inside
    // Lite's `onBeforeRender`, and rebuilding a scene's material groups from in there rebuilds them
    // against a frame that has not been recorded yet. A microtask runs once the rendered frame's
    // task has finished, which is the earliest point that is genuinely "between frames".
    queueMicrotask((): void => {
      void rebuildRenderables(renderer.scene)
        .catch((error: unknown): void => {
          renderer.app.onError.emit({ error, source: "system", phase: null, entity: null, component: null });
        })
        .finally((): void => {
          this.#isRebuildInFlight = false;
        });
    });
  }
}

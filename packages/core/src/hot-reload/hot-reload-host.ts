/**
 * `app.hotReload` (`docs/architecture/15-devtools-and-diagnostics.md` §5): the policy engine behind
 * script hot reload, and the scene half of it.
 *
 * Everything here works with no Vite and no browser. `@ignifx/vite-plugin` generates a client that
 * calls {@link HotReloadHostImpl.apply} with the classes a replaced module exports; a headless test
 * calls the same method with two hand-written classes. That is deliberate: the policy is the
 * engine's, and the bundler only supplies the channel.
 *
 * Decisions this file makes where `15` §5 leaves a choice, each with the sentence it follows:
 *
 * - **A reload is refused inside a lifecycle callback (`IGX-0208`).** §5 does not say when a swap
 *   runs, and `01-lifecycle-and-time.md` §3 has no step for one. Refusing is the rule
 *   `destroyImmediate` already follows (`IGX-0102`) for the same reason — a world half-way through
 *   a class swap must not be observable — and it costs nothing in practice: an HMR message arrives
 *   from a socket callback and a devtools button from a DOM event, neither of which is inside a
 *   lifecycle callback.
 * - **A `"patch"` class whose schema shape changed is re-created instead.** §5 says `"recreate"` is
 *   "required when field layouts change" but does not say what happens when a class changes its
 *   layout and forgets to ask. Patching it would hand the new code an instance missing its new
 *   fields, so the engine warns with `IGX-0207` and applies `"recreate"`, which is the outcome the
 *   author would have chosen.
 * - **One report per `apply` call.** {@link HotReloadReport} carries a single `kind`, so a call that
 *   both patched and re-created reports `"recreate"` — the stronger of the two, and the one whose
 *   consequences a reader needs to know about.
 * - **`onHotReload` is class-level, and runs on the replacement class with the class it replaced.**
 *   The reasoning is on `HotReloadStatics.onHotReload` in `contract.ts`.
 */

import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { Signal } from "../signal/signal.js";
import { patchInstances } from "./patch.js";
import { recreateInstances } from "./recreate.js";
import { schemaShapeKey } from "./schema-shape.js";
import { declaredPolicy, migrationHook } from "./statics.js";
import type { HotReloadHost, HotReloadKind, HotReloadModule, HotReloadPolicy, HotReloadReport } from "./contract.js";
import type { App, ErrorReport, FrameState } from "../app/types.js";
import type { ComponentClassInfo } from "../component/component-registry.js";
import type { ComponentType, ConcreteComponentType } from "../component/component-type.js";
import type { Component } from "../component/component.js";
import type { Logger } from "../log/logger.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { World } from "../world/world.js";

/**
 * What {@link HotReloadHostImpl} needs from the app that owns it.
 *
 * @internal
 */
export interface HotReloadHostOptions {
  /** The app, for its world, its assets, and its error signal. */
  readonly app: App;
  /** Where in the frame the engine is, so a reload inside a callback can be refused. */
  readonly frameState: FrameState;
  /** Where warnings about a reload go. */
  readonly log: Logger;
  /** The wall clock behind `durationMs`, in milliseconds. */
  readonly now: () => number;
  /** Whether a changed scene file rebuilds its live instances. */
  readonly reloadScenes: boolean;
}

/** One class the caller asked to reload, with the policy the engine settled on. */
interface PlannedSwap {
  /** The registered id both classes carry. */
  readonly typeId: string;
  /** The class that was registered. */
  readonly previous: ConcreteComponentType;
  /** Its cached info, captured before the registry forgets it. */
  readonly previousInfo: ComponentClassInfo;
  /** The replacement. */
  readonly next: ConcreteComponentType;
  /** What will be done to the live instances. */
  readonly policy: HotReloadPolicy;
  /** The live instances, snapshotted before the store buckets are rewritten. */
  readonly instances: readonly Component[];
}

/**
 * The app's hot-reload service.
 *
 * @internal
 */
export class HotReloadHostImpl implements HotReloadHost {
  /** Emitted once per completed reload. */
  readonly onApplied: Signal<HotReloadReport>;

  /** Whether a changed scene file rebuilds its live instances. */
  readonly reloadScenes: boolean;

  readonly #app: App;

  readonly #frameState: FrameState;

  readonly #log: Logger;

  readonly #now: () => number;

  #world: World | null = null;

  /**
   * Builds the service. `createApp` owns the only instance.
   *
   * @param options - The app, the clock, and the scene-reload toggle.
   */
  constructor(options: HotReloadHostOptions) {
    this.#app = options.app;
    this.#frameState = options.frameState;
    this.#log = options.log;
    this.#now = options.now;
    this.reloadScenes = options.reloadScenes;
    this.onApplied = new Signal<HotReloadReport>({
      onHandlerError: (error: unknown): void => {
        this.#log.error("An app.hotReload.onApplied handler threw.", error);
      },
    });
  }

  /**
   * Wires the service to the world `createApp` built, and subscribes to scene-asset replacement
   * when {@link HotReloadHostImpl.reloadScenes} is on.
   *
   * @param world - The world.
   */
  attachWorld(world: World): void {
    this.#world = world;
    if (!this.reloadScenes) {
      return;
    }
    world.onSceneLoaded.connect((instance: SceneInstance): void => {
      this.#watchScene(instance);
    });
    const scenes = world.scenes;
    for (let index = 0; index < scenes.length; index += 1) {
      const instance = scenes[index];
      if (instance !== undefined) {
        this.#watchScene(instance);
      }
    }
  }

  /**
   * Applies replaced component classes to the running app.
   *
   * @param modules - The replaced modules and the classes they export.
   * @returns What was reloaded.
   * @throws IgnifxError with code `IGX-0208` when called from inside a lifecycle callback.
   */
  apply(modules: readonly HotReloadModule[]): HotReloadReport {
    if (this.#frameState.isInsideCallback) {
      throw new IgnifxError(
        CoreErrorCode.hotReloadInsideCallback,
        "app.hotReload.apply() cannot run inside a lifecycle callback.",
        {
          context: { phase: "callback" },
          hint: "Hot reload is a flush-time operation; apply it between frames, as the HMR client does.",
        },
      );
    }
    const started = this.#now();
    const world = this.#requireWorld();
    const errors: unknown[] = [];
    const plans = this.#plan(modules, world, errors);
    const typeIds: string[] = [];
    let instances = 0;
    let kind: HotReloadKind = "patch";
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      if (plan === undefined) {
        continue;
      }
      const info = world.registry.replace(plan.next).info;
      instances +=
        plan.policy === "patch"
          ? patchInstances(world, plan.previousInfo, info, plan.instances)
          : recreateInstances(world, plan.previousInfo, plan.next, info, plan.instances, (message: string): void => {
              this.#log.warn(`hot reload: ${message}`);
            });
      if (plan.policy === "recreate") {
        kind = "recreate";
      }
      typeIds.push(plan.typeId);
      this.#migrate(plan, errors);
    }
    return this.#finish({ kind, typeIds, instances, durationMs: this.#now() - started, errors });
  }

  /**
   * Rebuilds one scene instance from its asset's current value.
   *
   * @param instance - The instance to rebuild.
   * @returns The instance that replaced it.
   * @throws IgnifxError with code `IGX-1506` when the instance was not built from a scene asset.
   */
  async reloadScene(instance: SceneInstance): Promise<SceneInstance> {
    const started = this.#now();
    const world = this.#requireWorld();
    const asset = instance.asset;
    if (asset === null) {
      throw new IgnifxError(
        CoreErrorCode.sceneNotReloadable,
        `The scene instance ${instance.name} was not built from a scene asset.`,
        {
          context: { scene: instance.name },
          hint: "Only an instance world.loadScene produced carries the asset a reload rebuilds it from.",
        },
      );
    }
    const address = asset.address;
    const wasActive = world.activeScene === instance;
    const wasPersistent = instance.persistent;
    // The handle is retained across the unload so that the asset service cannot collect the value
    // between the two halves of the reload.
    asset.retain();
    try {
      await world.unloadScene(instance);
      const rebuilt = await world.loadScene(address, { mode: "additive", setActive: wasActive });
      rebuilt.persistent = wasPersistent;
      this.#finish({
        kind: "scene",
        typeIds: [address],
        instances: countEntities(rebuilt),
        durationMs: this.#now() - started,
        errors: [],
      });
      return rebuilt;
    } finally {
      asset.release();
    }
  }

  /**
   * Works out what to do with each class the caller handed over, registering the ones the app has
   * never seen and skipping the ones that are already registered.
   *
   * @param modules - The replaced modules.
   * @param world - The world.
   * @param errors - Where a registration failure is collected.
   * @returns One plan per class that really changed, in the order the modules listed them.
   */
  #plan(modules: readonly HotReloadModule[], world: World, errors: unknown[]): readonly PlannedSwap[] {
    const registry = world.registry;
    const plans: PlannedSwap[] = [];
    for (let index = 0; index < modules.length; index += 1) {
      const types = modules[index]?.types ?? [];
      for (let inner = 0; inner < types.length; inner += 1) {
        const next = types[inner];
        if (next === undefined) {
          continue;
        }
        const typeId = next.typeId ?? null;
        if (typeId === null) {
          this.#log.debug("hot reload: a replaced class declares no typeId and cannot be matched.");
          continue;
        }
        const current = registry.get(typeId);
        if (current === next) {
          continue;
        }
        if (current === null) {
          try {
            registry.register(next);
          } catch (error) {
            errors.push(error);
            this.#report(error);
          }
          continue;
        }
        plans.push(this.#planSwap(world, typeId, current, next));
      }
    }
    return plans;
  }

  /**
   * Settles the policy for one class and snapshots its live instances.
   *
   * @param world - The world.
   * @param typeId - The registered id.
   * @param current - The class registered under it.
   * @param next - The replacement.
   * @returns The plan.
   */
  #planSwap(world: World, typeId: string, current: ComponentType, next: ConcreteComponentType): PlannedSwap {
    const previousInfo = world.registry.describe(current);
    let policy = declaredPolicy(next);
    if (policy === "patch" && schemaShapeKey(previousInfo.schema) !== schemaShapeKey(next.schema ?? null)) {
      policy = "recreate";
      this.#log.warn(
        `${CoreErrorCode.hotReloadSchemaChanged} ${typeId} changed its schema shape under the "patch" policy; its instances were re-created. Declare static hotReload = "recreate" to say so.`,
      );
    }
    return {
      typeId,
      // Boundary assertion (coding standards §5.2): only a concrete class reaches the registry's
      // type-id table, because `register` takes a `ConcreteComponentType`.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      previous: current as ConcreteComponentType,
      previousInfo,
      next,
      policy,
      // The bucket is live and both policies rewrite it, so the walk needs a copy.
      instances: world.components(current).slice(),
    };
  }

  /**
   * Runs a replacement class's `static onHotReload`, reporting whatever it throws rather than
   * abandoning the classes that come after it.
   *
   * @param plan - The class that was just swapped.
   * @param errors - Where the failure is collected.
   */
  #migrate(plan: PlannedSwap, errors: unknown[]): void {
    const hook = migrationHook(plan.next);
    if (hook === null) {
      return;
    }
    try {
      hook.call(plan.next, plan.previous);
    } catch (error) {
      errors.push(error);
      this.#report(error);
    }
  }

  /**
   * Announces a finished reload and hands the report back.
   *
   * @param report - What was reloaded.
   * @returns The same report.
   */
  #finish(report: HotReloadReport): HotReloadReport {
    if (report.typeIds.length > 0) {
      this.#log.info(
        `hot reload: ${report.kind} applied to ${String(report.typeIds.length)} type(s), ${String(report.instances)} instance(s).`,
      );
    }
    this.onApplied.emit(report);
    return report;
  }

  /**
   * Subscribes to one scene instance's asset so that a replaced file rebuilds it.
   *
   * @param instance - The instance to watch.
   */
  #watchScene(instance: SceneInstance): void {
    const asset = instance.asset;
    if (asset === null) {
      return;
    }
    asset.onReplaced.connect((): void => {
      this.reloadScene(instance).catch((error: unknown): void => {
        this.#report(error);
      });
    });
  }

  /**
   * Reports a failure through `app.onError`.
   *
   * @param error - What was caught.
   */
  #report(error: unknown): void {
    const report: ErrorReport = { error, source: "extension", phase: null, entity: null, component: null };
    this.#app.onError.emit(report);
  }

  /**
   * The world, once `createApp` has built it.
   *
   * @returns The world.
   * @throws IgnifxError with code `IGX-0107` before `createApp` resolves.
   */
  #requireWorld(): World {
    const world = this.#world;
    if (world === null) {
      throw new IgnifxError(CoreErrorCode.appNotReady, "app.hotReload is not available until createApp() resolves.", {
        context: { member: "app.hotReload" },
      });
    }
    return world;
  }
}

/**
 * Counts the entities a rebuilt scene instance produced, for the report.
 *
 * @param instance - The instance.
 * @returns How many entities it holds, roots and descendants.
 */
function countEntities(instance: SceneInstance): number {
  let total = 0;
  const pending = [...instance.roots];
  while (pending.length > 0) {
    const entity = pending.pop();
    if (entity === undefined) {
      continue;
    }
    total += 1;
    const children = entity.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return total;
}

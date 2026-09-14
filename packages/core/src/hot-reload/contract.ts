/**
 * Types shared by the hot-reload host, devtools, and the generated Vite client.
 * Keeping this module type-only lets each consumer use the contract without loading the host.
 */

import type { ConcreteComponentType } from "../component/component-type.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { SignalLike } from "../signal/signal.js";

/**
 * What a class asks the engine to do with its live instances when its module is replaced
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * @remarks
 * `"patch"` is the default and the one to reach for while iterating on logic: the live instances
 * keep their identity and every field value, and no lifecycle callback re-runs. `"recreate"` is
 * required when the *field layout* changes, because a patched instance keeps whatever properties
 * its constructor assigned and a renamed or added field would read `undefined`.
 *
 * @public
 */
export type HotReloadPolicy = "patch" | "recreate";

/**
 * What one {@link HotReloadReport} describes: a prototype swap, a destroy-and-rebuild of component
 * instances, or a scene instance rebuilt from its file.
 *
 * @public
 */
export type HotReloadKind = "patch" | "recreate" | "scene";

/**
 * The statics a component or script class may declare to steer its own hot reload
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5). Structural and optional, for the reason
 * given on `ComponentStatics`: a member declared on the `Component` base class would force the
 * `override` keyword on every `static hotReload = "recreate"` under `noImplicitOverride`.
 *
 * @example
 * ```ts
 * class Inventory extends Script.define({ slots: u32(4) }) {
 *   static typeId = "mygame/Inventory";
 *   static hotReload = "recreate" as const;
 * }
 * ```
 *
 * @public
 */
export interface HotReloadStatics {
  /** The policy for this class; defaults to `"patch"`. */
  readonly hotReload?: HotReloadPolicy;
  /**
   * Runs once on the **new** class after every live instance of it has been swapped or re-created,
   * with the class that was registered before as `previous`. It is the seam for class-level
   * transient state — a cache keyed off the old class, a static counter — and it is deliberately
   * not per instance: under `"patch"` the instances are the very same objects, so there is
   * nothing to copy across (PlayCanvas's `swap(old)` exists only because it re-instantiates), and
   * under `"recreate"` per-instance state is re-derived from the schema by design.
   *
   * @param previous - The class this one replaces.
   */
  onHotReload?(previous: ConcreteComponentType): void;
}

/**
 * One replaced module's worth of component classes, as the HMR client hands them over. Classes the
 * app has never seen are registered; classes whose `typeId` is already registered to a different
 * class are reloaded under their policy; classes that are already the registered ones are skipped.
 *
 * @public
 */
export interface HotReloadModule {
  /** Every component or script class the replaced module exports. */
  readonly types: readonly ConcreteComponentType[];
}

/**
 * What one hot reload did, for logs, tests, and the devtools overlay.
 *
 * @public
 */
export interface HotReloadReport {
  /** Which of the three operations this report describes. */
  readonly kind: HotReloadKind;
  /** The `typeId`s actually reloaded, in the order they were applied; empty when nothing changed. */
  readonly typeIds: readonly string[];
  /** How many live component instances were swapped or re-created, or entities rebuilt for a scene. */
  readonly instances: number;
  /** How long the operation took, in milliseconds. */
  readonly durationMs: number;
  /** Everything that threw on the way; the reload continues past each one. */
  readonly errors: readonly unknown[];
}

/**
 * The app's hot-reload service, reached as `app.hotReload`
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5). It works with no Vite and no browser:
 * `@ignifx/vite-plugin` generates a client that calls {@link HotReloadHost.apply}, and a headless
 * test calls it directly.
 *
 * @example
 * ```ts
 * const report = app.hotReload.apply([{ types: [NextMover] }]);
 * console.log(report.kind, report.typeIds, report.instances);
 * ```
 *
 * @public
 */
export interface HotReloadHost {
  /**
   * Emitted once per completed {@link HotReloadHost.apply} or
   * {@link HotReloadHost.reloadScene} with the report that call returns.
   */
  readonly onApplied: SignalLike<HotReloadReport>;
  /**
   * Whether a changed scene file re-instantiates the live scene instances built from it, set with
   * `createApp({ hotReload: { reloadScenes: true } })`. Off by default, because rebuilding a scene
   * throws away everything the running game has done to it.
   */
  readonly reloadScenes: boolean;
  /**
   * Applies replaced component classes to the running app.
   *
   * @param modules - The replaced modules and the classes they export.
   * @returns What was reloaded.
   * @throws IgnifxError with code `IGX-0208` when called from inside a lifecycle callback, where a
   * half-swapped world would be observable.
   */
  apply(modules: readonly HotReloadModule[]): HotReloadReport;
  /**
   * Rebuilds one scene instance from its asset's current value, honouring the file's instance
   * overrides wherever their paths still resolve.
   *
   * @param instance - The instance to rebuild. It is unloaded and a fresh one takes its place.
   * @returns The new instance.
   * @throws IgnifxError with code `IGX-0209` when the instance was not built from a scene asset.
   */
  reloadScene(instance: SceneInstance): Promise<SceneInstance>;
}

/**
 * The `hotReload` section of `createApp`'s options.
 *
 * @public
 */
export interface HotReloadOptions {
  /** Sets {@link HotReloadHost.reloadScenes}. Defaults to `false`. */
  readonly reloadScenes?: boolean;
}

import { Signal, Vec3 } from "@ignifx/core";
import { threeDError, ThreeDErrorCode } from "../errors.js";
import { createPlugin } from "../lite/navigation/plugin.js";
import { NavMeshSurface } from "./nav-mesh-surface.js";
import type { LiteNavigationPlugin } from "../lite/types.js";
import type { App, MutableVec3, Vec3Like } from "@ignifx/core";

/**
 * `app.navigation` (`docs/architecture/12-3d-toolkit.md` §5): the path queries, and the one place
 * that owns loading Recast.
 *
 * ## Loading is lazy and shared
 *
 * The Recast WebAssembly is not touched until the first `NavMeshSurface` asks for a plugin, because
 * a game with no navigation should not pay for a half-megabyte module it never calls
 * (`docs/adr/0017-navigation-wasm.md`). Every surface then awaits the same in-flight promise;
 * Lite's own module cache means only the first one actually compiles the wasm
 * (`lib/navigation/navigation.js` 4-29).
 *
 * ## Which surface a query runs against
 *
 * `findPath`, `raycast`, and `closestPoint` use the first **baked** `NavMeshSurface` in the world,
 * which is the only sensible default for the overwhelmingly common case of one navmesh. A world
 * with two of them calls the query on the surface it means: `NavMeshSurface` carries the same three
 * methods.
 */

/**
 * The `app.navigation` service.
 *
 * @example
 * ```ts
 * const corners = app.navigation.findPath(guard.transform.position, player.transform.position);
 * if (corners.length > 0) {
 *   agent.setDestination(corners[corners.length - 1]);
 * }
 * ```
 *
 * @public
 */
export class NavigationService {
  readonly #app: App;

  readonly #locateFile: ((url: string) => string) | null;

  readonly #onReady: Signal<NavigationService> = new Signal<NavigationService>();

  #pending: Promise<LiteNavigationPlugin> | null = null;

  #isLoaded = false;

  #isDisposed = false;

  /**
   * Builds the service.
   *
   * @param app - The app it belongs to.
   * @param locateFile - Where to fetch the Recast `.wasm` from, or `null` for the inlined copy.
   *
   * @internal
   */
  constructor(app: App, locateFile: ((url: string) => string) | null) {
    this.#app = app;
    this.#locateFile = locateFile;
  }

  /**
   * Fires the first time Recast has finished loading.
   *
   * @returns Fires the first time Recast has finished loading.
   */
  get onReady(): Signal<NavigationService> {
    return this.#onReady;
  }

  /**
   * Whether Recast has finished loading.
   *
   * @returns Whether Recast has finished loading.
   */
  get isLoaded(): boolean {
    return this.#isLoaded;
  }

  /**
   * Every `NavMeshSurface` in the world, in component order.
   *
   * @returns Every `NavMeshSurface` in the world, in component order.
   */
  get surfaces(): readonly NavMeshSurface[] {
    return this.#app.world.components(NavMeshSurface);
  }

  /**
   * The first surface with a navmesh on it.
   *
   * @returns The surface, or `null` when nothing has baked yet.
   */
  get primarySurface(): NavMeshSurface | null {
    const surfaces = this.surfaces;
    for (let index = 0; index < surfaces.length; index += 1) {
      const surface = surfaces[index];
      if (surface !== undefined && surface.isBaked) {
        return surface;
      }
    }
    return null;
  }

  /**
   * Loads Recast if it is not loaded yet and hands out a fresh plugin.
   *
   * @remarks
   * Each call returns a **new** plugin object sharing one compiled module, which is what lets two
   * surfaces hold two independent navmeshes.
   *
   * @returns The plugin.
   * @throws IgnifxError with code `IGX-1206` when the module cannot be loaded.
   *
   * @internal
   */
  async acquirePlugin(): Promise<LiteNavigationPlugin> {
    if (this.#isDisposed) {
      throw threeDError(ThreeDErrorCode.navigationUnavailable, "The app that owns navigation has been disposed.");
    }
    const pending = this.#pending ?? this.#load();
    this.#pending = pending;
    return pending;
  }

  /**
   * Computes a path across the primary surface.
   *
   * @param from - The start, in world space.
   * @param to - The end, in world space.
   * @returns The corner points, start first. Empty when nothing is baked or no path exists.
   */
  findPath(from: Vec3Like, to: Vec3Like): readonly Vec3[] {
    return this.primarySurface?.findPath(from, to) ?? [];
  }

  /**
   * Snaps a point onto the primary surface.
   *
   * @param point - The point, in world space.
   * @param out - Where to write the snapped point; a fresh `Vec3` when omitted.
   * @returns The snapped point, or `null` when nothing is baked.
   */
  closestPoint(point: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 | null {
    return this.primarySurface?.closestPoint(point, out) ?? null;
  }

  /**
   * Casts a walkability ray across the primary surface.
   *
   * @param from - The start, in world space.
   * @param to - The end, in world space.
   * @param out - Where to write the hit point; a fresh `Vec3` when omitted.
   * @returns The point where the walkable surface ends, or `null` when the segment is clear.
   */
  raycast(from: Vec3Like, to: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 | null {
    return this.primarySurface?.raycast(from, to, out) ?? null;
  }

  /** Stops handing out plugins; the surfaces dispose the ones they hold. */
  dispose(): void {
    this.#isDisposed = true;
    this.#pending = null;
  }

  /**
   * Loads the module and wraps any failure in this package's code.
   *
   * @returns The plugin.
   */
  async #load(): Promise<LiteNavigationPlugin> {
    try {
      const plugin = await createPlugin(this.#locateFile ?? undefined);
      this.#isLoaded = true;
      this.#onReady.emit(this);
      return plugin;
    } catch (error) {
      // A failed load leaves nothing cached, so the next surface tries again rather than
      // inheriting a rejected promise forever.
      this.#pending = null;
      this.#app.log.error("The Recast navigation module could not be loaded.", error);
      throw threeDError(ThreeDErrorCode.navigationUnavailable, "The Recast navigation module could not be loaded.", {
        cause: error,
        hint: "Check that @babylonjs/lite resolves, or pass threeD({ navigationWasmUrl }) to serve the wasm yourself.",
      });
    }
  }
}

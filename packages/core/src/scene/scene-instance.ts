import { Signal } from "../signal/signal.js";
import type { AssetHandle } from "../assets/types.js";
import type { Entity } from "../entity/entity.js";
import type { JsonObject } from "../schema/json.js";
import type { SceneAsset } from "../serialization/scene-asset.js";
import type { UidRemap } from "../serialization/uid-remap.js";

/**
 * One loaded scene file, or the implicit default scene
 * (`docs/architecture/02-scene-graph.md` §3). An entity belongs to exactly one instance: the scene
 * it was loaded from, or the world's active scene when it was created in code.
 *
 * @remarks
 * The implicit `"default"` instance every app starts with has no asset and is always loaded.
 * An instance created by `world.loadScene` carries the handle it was built from and reports
 * `isLoaded === false` only while its entities are being constructed — a window no game code can
 * observe, because construction is one synchronous block (`docs/architecture/02-scene-graph.md` §2).
 *
 * @example
 * ```ts
 * world.activeScene.persistent = true; // survives a "single" load, like DontDestroyOnLoad
 * ```
 *
 * @public
 */
export class SceneInstance {
  /** The instance id, distinct from the address of the asset it was loaded from. */
  readonly uid: string;

  /** The instance's name; the file's name, or `"default"` for the implicit scene. */
  readonly name: string;

  /**
   * Whether the instance survives a `"single"` scene load — Unity's `DontDestroyOnLoad`, at scene
   * granularity rather than per object.
   */
  persistent: boolean;

  /** The root entities, maintained as entities are created, reparented, and destroyed. */
  readonly #roots: Entity[] = [];

  /** Emitted just before the instance is unloaded and its roots destroyed. */
  readonly #onUnloading: Signal;

  /** The scene asset the instance was built from, or `null` for the implicit default scene. */
  #asset: AssetHandle<SceneAsset> | null = null;

  /** `false` only between the first entity being created and the whole scene being constructed. */
  #isLoaded = true;

  /** File-local uid to runtime object, kept for override addressing and cross-references. */
  #remap: UidRemap | null = null;

  /** The `settings` block of the file this instance was built from. */
  #settings: JsonObject | null = null;

  /**
   * Creates a scene instance. The world creates these; game code reaches them through
   * `world.scenes` and `world.activeScene`.
   *
   * @param uid - The instance id.
   * @param name - The instance name.
   * @param persistent - Whether the instance survives a `"single"` load.
   *
   * @internal
   */
  constructor(uid: string, name: string, persistent: boolean) {
    this.uid = uid;
    this.name = name;
    this.persistent = persistent;
    this.#onUnloading = new Signal();
  }

  /**
   * The asset this instance was loaded from.
   *
   * @returns The handle `world.loadScene` retained on the instance's behalf, or `null` for the
   * implicit default scene and for instances created in code.
   */
  get asset(): AssetHandle<SceneAsset> | null {
    return this.#asset;
  }

  /**
   * Whether every entity of the instance has been constructed and its references resolved.
   *
   * @returns `true` once construction has finished; `false` only during it.
   */
  get isLoaded(): boolean {
    return this.#isLoaded;
  }

  /**
   * The file-local uid to runtime object table of this instance
   * (`docs/architecture/02-scene-graph.md` §10). Two instances of one scene have two tables, which
   * is what keeps their `$entity`/`$component` references apart.
   *
   * @returns The table, or `null` for an instance that was not built from a file.
   */
  get remap(): UidRemap | null {
    return this.#remap;
  }

  /**
   * Records the asset the instance was built from.
   *
   * @param asset - The retained handle.
   *
   * @internal
   */
  setAsset(asset: AssetHandle<SceneAsset> | null): void {
    this.#asset = asset;
  }

  /**
   * Records whether construction has finished.
   *
   * @param isLoaded - `true` once every entity exists and every reference is resolved.
   *
   * @internal
   */
  setLoaded(isLoaded: boolean): void {
    this.#isLoaded = isLoaded;
  }

  /**
   * Records the uid table built while the scene was constructed.
   *
   * @param remap - The table.
   *
   * @internal
   */
  setRemap(remap: UidRemap | null): void {
    this.#remap = remap;
  }

  /**
   * The scene-level values the file carried — environment, clear colour, 2D mode flags, physics
   * overrides (`docs/architecture/06-serialization-and-scene-format.md` §2). The core keeps them as
   * plain JSON; the systems that understand a key read it from here.
   *
   * @returns The block, or `null` for an instance that was not built from a file.
   */
  get settings(): JsonObject | null {
    return this.#settings;
  }

  /**
   * Records the file's `settings` block.
   *
   * @param settings - The block, or `null`.
   *
   * @internal
   */
  setSettings(settings: JsonObject | null): void {
    this.#settings = settings;
  }

  /**
   * The instance's root entities — the ones with no parent — in creation order.
   *
   * @returns The live root list. Its identity is stable for the instance's lifetime.
   */
  get roots(): readonly Entity[] {
    return this.#roots;
  }

  /**
   * Emitted just before the instance is unloaded, while its entities are still valid.
   *
   * @returns The signal.
   */
  get onUnloading(): Signal {
    return this.#onUnloading;
  }

  /**
   * Records an entity as a root of this instance.
   *
   * @param entity - The now-parentless entity.
   *
   * @internal
   */
  addRoot(entity: Entity): void {
    if (!this.#roots.includes(entity)) {
      this.#roots.push(entity);
    }
  }

  /**
   * Removes an entity from the root list.
   *
   * @param entity - The entity that gained a parent or was destroyed.
   *
   * @internal
   */
  removeRoot(entity: Entity): void {
    const index = this.#roots.indexOf(entity);
    if (index >= 0) {
      this.#roots.splice(index, 1);
    }
  }
}

import { Signal } from "../signal/signal.js";
import type { Entity } from "../entity/entity.js";

/**
 * One loaded scene file, or the implicit default scene
 * (`docs/architecture/02-scene-graph.md` §3). An entity belongs to exactly one instance: the scene
 * it was loaded from, or the world's active scene when it was created in code.
 *
 * @remarks
 * Phase 1 ships the implicit `"default"` instance only. `asset` is therefore always `null` and
 * `isLoaded` always `true`; scene loading, additive loads, and unloading arrive in Phase 2
 * (`docs/plan/engineering-plan.md`).
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
   * @returns Always `null` in Phase 1: the implicit default scene has no asset, and scene loading
   * has not landed yet.
   */
  get asset(): null {
    return null;
  }

  /**
   * Whether every entity of the instance has been constructed.
   *
   * @returns Always `true` in Phase 1.
   */
  get isLoaded(): boolean {
    return true;
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

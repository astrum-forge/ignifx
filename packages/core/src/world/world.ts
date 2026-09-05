import { ComponentRegistry } from "../component/component-registry.js";
import { ComponentStore } from "../component/component-store.js";
import { ReferenceTracker } from "../component/reference-tracker.js";
import { Entity } from "../entity/entity.js";
import { entityInternals } from "../entity/internals.js";
import { HandleAllocator } from "../handles/handle-allocator.js";
import { toComponentHandle, toEntityHandle } from "../handles/handle.js";
import { createUlidFactory } from "../ids/ulid.js";
import { createLayerTable } from "../layers/layer-table.js";
import { LifecycleQueue } from "../lifecycle/lifecycle-queue.js";
import { createNode } from "../lite/node.js";
import { SceneInstance } from "../scene/scene-instance.js";
import { Signal } from "../signal/signal.js";
import type { WorldHost } from "./world-host.js";
import type { WorldInternals } from "./world-internals.js";
import type { App, ErrorReport, FrameState } from "../app/types.js";
import type { ComponentType } from "../component/component-type.js";
import type { Component } from "../component/component.js";
import type { ComponentHandle, EntityHandle } from "../handles/handle.js";
import type { LayerTable } from "../layers/layer-table.js";
import type { FrameStateController } from "../lifecycle/frame-state.js";
import type { LiteScene } from "../lite/scene.js";
import type { QuatLike, Vec3Like } from "../math/types.js";
import type { DeferredQueue } from "../signal/signal.js";

/**
 * The running simulation: the entity registry, the scene instances, and the lifecycle queues
 * (`docs/architecture/02-scene-graph.md` §2). One world per app in the MVP.
 *
 * @remarks
 * Phase 1 ships the subset that needs no asset system: entity creation, queries, the implicit
 * `"default"` scene, and the lifecycle. `loadScene`, `unloadScene`, `instantiate`,
 * `instantiateAsync`, and `moveEntityToScene` arrive in Phase 2, and `onSceneLoaded`/
 * `onSceneUnloaded` exist here but never fire until then.
 *
 * @example
 * ```ts
 * const player = app.world.createEntity("Player");
 * for (const script of app.world.components(Script)) {
 *   script.enabled = false;
 * }
 * ```
 *
 * @public
 */
export class World implements WorldHost {
  readonly #app: App;

  readonly #scene: LiteScene;

  readonly #frameState: FrameStateController;

  readonly #layers: LayerTable;

  readonly #registry: ComponentRegistry;

  readonly #store = new ComponentStore();

  readonly #references = new ReferenceTracker();

  readonly #lifecycle: LifecycleQueue;

  readonly #entities = new HandleAllocator<Entity>();

  readonly #components = new HandleAllocator<Component>();

  readonly #byUid = new Map<string, Entity>();

  readonly #byTag = new Map<string, Entity[]>();

  readonly #scenes: SceneInstance[] = [];

  readonly #nextUid: () => string;

  readonly #deferredQueue: DeferredQueue | null;

  readonly #onEntityCreated: Signal<Entity>;

  readonly #onEntityDestroyed: Signal<Entity>;

  readonly #onSceneLoaded: Signal<SceneInstance>;

  readonly #onSceneUnloaded: Signal<SceneInstance>;

  #activeScene: SceneInstance;

  #serial = 0;

  #isDisposed = false;

  /**
   * Builds a world. Call `createWorld` instead; the runtime owns this.
   *
   * @param options - The app, the Lite scene, the frame state, and the resolved settings.
   *
   * @internal
   */
  constructor(options: CreateWorldOptions) {
    this.#app = options.app;
    this.#scene = options.scene;
    this.#frameState = options.frameState;
    this.#layers = options.layers ?? createLayerTable();
    this.#registry = options.registry ?? new ComponentRegistry();
    this.#nextUid = options.ulid ?? createUlidFactory();
    this.#deferredQueue = options.deferredQueue ?? null;
    this.#lifecycle = new LifecycleQueue(this);
    this.#onEntityCreated = this.createSignal<Entity>();
    this.#onEntityDestroyed = this.createSignal<Entity>();
    this.#onSceneLoaded = this.createSignal<SceneInstance>();
    this.#onSceneUnloaded = this.createSignal<SceneInstance>();
    const initial = new SceneInstance(this.#nextUid(), "default", true);
    this.#scenes.push(initial);
    this.#activeScene = initial;
  }

  /**
   * The app that owns the world.
   *
   * @returns The app.
   */
  get app(): App {
    return this.#app;
  }

  /**
   * The world itself; `WorldHost` names it so entities can reach it.
   *
   * @returns This world.
   */
  get world(): World {
    return this;
  }

  /**
   * The project's resolved layer names. `world.layers.mask("Player", "Enemy")` builds a mask.
   *
   * @returns The layer table.
   */
  get layers(): LayerTable {
    return this.#layers;
  }

  /**
   * The component-class table.
   *
   * @returns The registry.
   */
  get registry(): ComponentRegistry {
    return this.#registry;
  }

  /**
   * The live per-type component index.
   *
   * @returns The store.
   *
   * @internal
   */
  get store(): ComponentStore {
    return this.#store;
  }

  /**
   * The tracked-reference table.
   *
   * @returns The tracker.
   *
   * @internal
   */
  get references(): ReferenceTracker {
    return this.#references;
  }

  /**
   * Where in the frame the engine is.
   *
   * @returns The frame-state controller.
   *
   * @internal
   */
  get frameState(): FrameStateController {
    return this.#frameState;
  }

  /**
   * The lifecycle queues and flushes the scheduler drives.
   *
   * @returns The lifecycle API.
   *
   * @internal
   */
  get lifecycle(): WorldInternals {
    return this.#lifecycle;
  }

  /**
   * Every loaded scene instance, in load order; the implicit `"default"` scene is always first.
   *
   * @returns The live scene list.
   */
  get scenes(): readonly SceneInstance[] {
    return this.#scenes;
  }

  /**
   * The scene that owns entities created in code without an explicit `scene` option. Assigning to
   * it makes another instance the default owner.
   *
   * @returns The active instance.
   */
  get activeScene(): SceneInstance {
    return this.#activeScene;
  }

  // The accessor pair is documented on the getter only: API Extractor rejects a doc comment on the
  // setter of a documented property (`ae-setter-with-docs`).
  // eslint-disable-next-line jsdoc/require-jsdoc -- see the comment above
  set activeScene(scene: SceneInstance) {
    this.#activeScene = scene;
  }

  /**
   * `true` once {@link World.dispose} has run.
   *
   * @returns `true` when the world has been disposed.
   */
  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /**
   * Emitted for every entity the world creates.
   *
   * @returns The signal.
   */
  get onEntityCreated(): Signal<Entity> {
    return this.#onEntityCreated;
  }

  /**
   * Emitted for every entity the destroy flush releases.
   *
   * @returns The signal.
   */
  get onEntityDestroyed(): Signal<Entity> {
    return this.#onEntityDestroyed;
  }

  /**
   * Emitted when a scene instance finishes loading. Never fires before Phase 2.
   *
   * @returns The signal.
   */
  get onSceneLoaded(): Signal<SceneInstance> {
    return this.#onSceneLoaded;
  }

  /**
   * Emitted when a scene instance is unloaded. Never fires before Phase 2.
   *
   * @returns The signal.
   */
  get onSceneUnloaded(): Signal<SceneInstance> {
    return this.#onSceneUnloaded;
  }

  /**
   * Babylon Lite objects the world owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The render scene, and the physics simulation scene once `@ignifx/physics` creates one.
   */
  get lite(): { readonly scene: LiteScene; readonly simulationScene: null } {
    return { scene: this.#scene, simulationScene: null };
  }

  /**
   * Creates an entity with a transform and a Lite node.
   *
   * @param name - The display name; defaults to `"Entity"`.
   * @param options - The parent, the owning scene, and an initial world position and rotation.
   * @returns The new entity, already active and registered.
   *
   * @example
   * ```ts
   * const hand = world.createEntity("Hand", { parent: player, position: { x: 0.3, y: 1.2, z: 0 } });
   * ```
   */
  createEntity(name: string = "Entity", options?: CreateEntityOptions): Entity {
    const parent = options?.parent ?? null;
    const scene = options?.scene ?? (parent === null ? this.#activeScene : parent.scene);
    const node = createNode(name);
    const uid = this.#nextUid();
    // Reserved first, bound second: the entity's constructor writes its own handle into the Lite
    // node's metadata, so the handle has to exist before the entity does.
    const handle = toEntityHandle(this.#entities.reserve());
    const entity = new Entity(this, handle, uid, node, name, scene);
    this.#entities.bind(handle, entity);
    this.#byUid.set(uid, entity);
    if (parent === null) {
      scene.addRoot(entity);
    } else {
      entity.setParent(parent, { worldPositionStays: false });
    }
    const position = options?.position;
    if (position !== undefined) {
      entity.transform.position = position;
    }
    const rotation = options?.rotation;
    if (rotation !== undefined) {
      entity.transform.rotation = rotation;
    }
    this.notifyEntityCreated(entity);
    this.#lifecycle.refreshActivation(entity);
    return entity;
  }

  /**
   * Looks an entity up by its stable identifier.
   *
   * @param uid - The ULID.
   * @returns The entity, or `null` when nothing in this world carries that uid.
   */
  getEntity(uid: string): Entity | null {
    return this.#byUid.get(uid) ?? null;
  }

  /**
   * Resolves a dense runtime handle.
   *
   * @param handle - The handle.
   * @returns The entity, or `null` when the handle is stale — a handle kept across a destroy never
   * resolves to whatever entity recycled the slot.
   */
  getEntityByHandle(handle: EntityHandle): Entity | null {
    return this.#entities.get(handle);
  }

  /**
   * The first entity with a name, depth-first from the roots of every scene.
   *
   * @remarks
   * Linear in the number of entities, and names are not unique: this is a prototyping and tooling
   * convenience, not a lookup the engine itself uses
   * (`docs/architecture/02-scene-graph.md` §4).
   *
   * @param name - The name to match exactly.
   * @returns The first match, or `null`.
   */
  findByName(name: string): Entity | null {
    for (let index = 0; index < this.#scenes.length; index += 1) {
      const roots = this.#scenes[index]?.roots ?? [];
      for (let root = 0; root < roots.length; root += 1) {
        const entity = roots[root];
        if (entity === undefined) {
          continue;
        }
        const found = findNamed(entity, name);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Every entity with a name, depth-first from the roots of every scene.
   *
   * @param name - The name to match exactly.
   * @returns A freshly allocated array; empty when nothing matches.
   */
  findAllByName(name: string): Entity[] {
    const found: Entity[] = [];
    for (let index = 0; index < this.#scenes.length; index += 1) {
      const roots = this.#scenes[index]?.roots ?? [];
      for (let root = 0; root < roots.length; root += 1) {
        const entity = roots[root];
        if (entity !== undefined) {
          collectNamed(entity, name, found);
        }
      }
    }
    return found;
  }

  /**
   * Every entity carrying a tag.
   *
   * @remarks
   * Indexed, not searched: the world maintains one array per tag as `tags.add`/`tags.delete` run
   * and as entities are destroyed, so this is O(1) to obtain and allocates nothing. The array is
   * **live** and its identity is stable for the tag's lifetime in this world, so it can be cached
   * in `awake`; treat it as read-only.
   *
   * @param tag - The tag.
   * @returns The live list of tagged entities. A tag nothing carries yields a shared frozen empty
   * array.
   */
  findByTag(tag: string): readonly Entity[] {
    return this.#byTag.get(tag) ?? EMPTY_ENTITIES;
  }

  /**
   * Every component of a class, by identity **and** inheritance — the primary iteration API for
   * systems (`docs/architecture/02-scene-graph.md` §9).
   *
   * @typeParam T - The component type.
   * @param type - The component class, abstract or concrete; `components(Script)` returns every
   * script.
   * @returns The live list. O(1) to obtain, stable within a phase, and never allocated per call.
   */
  components<T extends Component>(type: ComponentType<T>): readonly T[] {
    return this.#store.components(type);
  }

  /**
   * Destroys every entity, cancels every coroutine, releases every Lite node, and clears every
   * index. The Lite scene itself belongs to the app and is left alone.
   */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#lifecycle.disposeWorld();
    this.#byUid.clear();
    this.#byTag.clear();
    this.#entities.clear();
    this.#components.clear();
  }

  /**
   * The next ULID.
   *
   * @returns A fresh identifier.
   *
   * @internal
   */
  nextUid(): string {
    return this.#nextUid();
  }

  /**
   * The next creation serial.
   *
   * @returns A monotonically increasing integer.
   *
   * @internal
   */
  nextSerial(): number {
    this.#serial += 1;
    return this.#serial;
  }

  /**
   * Issues a component handle.
   *
   * @param component - The component being attached.
   * @returns Its handle.
   *
   * @internal
   */
  allocateComponentHandle(component: Component): ComponentHandle {
    return toComponentHandle(this.#components.allocate(component));
  }

  /**
   * Invalidates a component handle.
   *
   * @param handle - The handle.
   *
   * @internal
   */
  releaseComponentHandle(handle: ComponentHandle): void {
    this.#components.release(handle);
  }

  /**
   * Removes a released entity from every index.
   *
   * @param entity - The entity the destroy flush has finished with.
   *
   * @internal
   */
  releaseEntity(entity: Entity): void {
    const internals = entityInternals(entity);
    this.#byUid.delete(internals.uid);
    this.#entities.release(internals.handle);
    if (internals.parent === null) {
      internals.scene.removeRoot(entity);
    }
    const tags = internals.tags;
    for (const tag of tags.values()) {
      this.#removeTag(entity, tag);
    }
  }

  /**
   * Creates a signal wired to the app's deferred queue.
   *
   * @typeParam T - The payload type.
   * @returns The signal.
   *
   * @internal
   */
  createSignal<T>(): Signal<T> {
    const queue = this.#deferredQueue;
    return queue === null ? new Signal<T>() : new Signal<T>({ deferredQueue: queue });
  }

  /**
   * Keeps the `findByTag` index current.
   *
   * @param entity - The entity whose tags changed.
   * @param tag - The tag.
   * @param added - `true` for an add.
   *
   * @internal
   */
  notifyTagChanged(entity: Entity, tag: string, added: boolean): void {
    if (added) {
      let bucket = this.#byTag.get(tag);
      if (bucket === undefined) {
        bucket = [];
        this.#byTag.set(tag, bucket);
      }
      if (!bucket.includes(entity)) {
        bucket.push(entity);
      }
      return;
    }
    this.#removeTag(entity, tag);
  }

  /**
   * Moves an entity and its subtree to another scene instance.
   *
   * @param entity - The entity that crossed a scene boundary.
   * @param scene - Its new owner.
   *
   * @internal
   */
  moveToScene(entity: Entity, scene: SceneInstance): void {
    const internals = entityInternals(entity);
    if (internals.scene === scene) {
      return;
    }
    if (internals.parent === null) {
      internals.scene.removeRoot(entity);
      scene.addRoot(entity);
    }
    internals.scene = scene;
    const children = internals.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child !== undefined) {
        this.moveToScene(child, scene);
      }
    }
  }

  /**
   * Emits `onEntityCreated`.
   *
   * @param entity - The new entity.
   *
   * @internal
   */
  notifyEntityCreated(entity: Entity): void {
    this.#onEntityCreated.emit(entity);
  }

  /**
   * Emits `onEntityDestroyed`.
   *
   * @param entity - The released entity.
   *
   * @internal
   */
  notifyEntityDestroyed(entity: Entity): void {
    this.#onEntityDestroyed.emit(entity);
  }

  /**
   * Reports a caught failure through `app.onError`.
   *
   * @param report - What failed, and where.
   *
   * @internal
   */
  reportError(report: ErrorReport): void {
    this.#app.onError.emit(report);
  }

  /**
   * Removes an entity from one tag bucket.
   *
   * @param entity - The entity.
   * @param tag - The tag.
   */
  #removeTag(entity: Entity, tag: string): void {
    const bucket = this.#byTag.get(tag);
    if (bucket === undefined) {
      return;
    }
    const index = bucket.indexOf(entity);
    if (index >= 0) {
      // Swap-remove: `findByTag` promises a stable array identity, not a stable order.
      const last = bucket.length - 1;
      const moved = bucket[last];
      if (index !== last && moved !== undefined) {
        bucket[index] = moved;
      }
      bucket.pop();
    }
  }
}

/** Shared empty result for a tag nothing carries, so `findByTag` never allocates. */
const EMPTY_ENTITIES: readonly Entity[] = Object.freeze([]);

/**
 * Options accepted by {@link World.createEntity}.
 *
 * @public
 */
export interface CreateEntityOptions {
  /** The parent to attach the new entity to; `undefined` makes it a root of its scene. */
  readonly parent?: Entity;
  /** The owning scene instance; defaults to the parent's scene, or `world.activeScene`. */
  readonly scene?: SceneInstance;
  /** The initial world position, in metres. */
  readonly position?: Vec3Like;
  /** The initial world rotation. */
  readonly rotation?: QuatLike;
}

/**
 * Options accepted by `createWorld`.
 *
 * @internal
 */
export interface CreateWorldOptions {
  /** The app that owns the world. */
  readonly app: App;
  /** The Lite scene the world renders into. */
  readonly scene: LiteScene;
  /** The frame-state controller the scheduler owns. */
  readonly frameState: FrameStateController;
  /** The project's resolved layer names; an empty table when omitted. */
  readonly layers?: LayerTable;
  /** The component-class table; a fresh one when omitted. */
  readonly registry?: ComponentRegistry;
  /** The identifier factory; a crypto-seeded ULID factory when omitted. */
  readonly ulid?: () => string;
  /** The scheduler's `EndOfFrame` queue, so `{ deferred: true }` signal connections work. */
  readonly deferredQueue?: DeferredQueue;
}

/**
 * Creates the world of one app.
 *
 * @param options - The app, the Lite scene, the frame state, and the resolved settings.
 * @returns The world, with its implicit `"default"` scene instance already present.
 *
 * @example
 * ```ts
 * const frameState = createFrameState();
 * const world = createWorld({ app, scene, frameState, layers: createLayerTable(config.layers) });
 * ```
 *
 * @internal
 */
export function createWorld(options: CreateWorldOptions): World {
  return new World(options);
}

/**
 * The world's internal lifecycle API, for the scheduler.
 *
 * @param world - The world.
 * @returns The queues and flushes the frame function drives.
 *
 * @internal
 */
export function getWorldInternals(world: World): WorldInternals {
  return world.lifecycle;
}

/**
 * The frame state a world was built with, for the scheduler and for tests.
 *
 * @param world - The world.
 * @returns The read-only frame state.
 *
 * @internal
 */
export function getFrameState(world: World): FrameState {
  return world.frameState.state;
}

/**
 * Depth-first search for a named entity.
 *
 * @param entity - Where to start.
 * @param name - The name to match.
 * @returns The first match, or `null`.
 */
function findNamed(entity: Entity, name: string): Entity | null {
  if (entity.name === name) {
    return entity;
  }
  const children = entityInternals(entity).children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      continue;
    }
    const found = findNamed(child, name);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Depth-first collection of named entities.
 *
 * @param entity - Where to start.
 * @param name - The name to match.
 * @param out - Where matches are appended.
 */
function collectNamed(entity: Entity, name: string, out: Entity[]): void {
  if (entity.name === name) {
    out.push(entity);
  }
  const children = entityInternals(entity).children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined) {
      collectNamed(child, name, out);
    }
  }
}

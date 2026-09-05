import { ComponentRegistry } from "../component/component-registry.js";
import { ComponentStore } from "../component/component-store.js";
import { ReferenceTracker } from "../component/reference-tracker.js";
import { Entity } from "../entity/entity.js";
import { entityInternals } from "../entity/internals.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { HandleAllocator } from "../handles/handle-allocator.js";
import { toComponentHandle, toEntityHandle } from "../handles/handle.js";
import { createUlidFactory } from "../ids/ulid.js";
import { createLayerTable } from "../layers/layer-table.js";
import { LifecycleQueue } from "../lifecycle/lifecycle-queue.js";
import { createNode } from "../lite/node.js";
import { raycastRenderScene } from "../render/raycast.js";
import { SceneInstance } from "../scene/scene-instance.js";
import { assertSceneDependenciesLoaded, instantiateScene } from "../serialization/load.js";
import { Signal } from "../signal/signal.js";
import type { WorldHost } from "./world-host.js";
import type { WorldInternals } from "./world-internals.js";
import type { App, ErrorReport, FrameState } from "../app/types.js";
import type { AssetHandle, AssetRef, Assets } from "../assets/types.js";
import type { ComponentType } from "../component/component-type.js";
import type { Component } from "../component/component.js";
import type { ComponentHandle, EntityHandle } from "../handles/handle.js";
import type { LayerTable } from "../layers/layer-table.js";
import type { FrameStateController } from "../lifecycle/frame-state.js";
import type { LiteScene } from "../lite/scene.js";
import type { QuatLike, Vec3Like } from "../math/types.js";
import type { Camera, Ray } from "../render/camera.js";
import type { RenderPick, RenderPickOptions } from "../render/renderer.js";
import type { SceneLoadIssue } from "../serialization/load.js";
import type { SceneAsset } from "../serialization/scene-asset.js";
import type { SceneFile } from "../serialization/scene-file.js";
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

  /**
   * The object `world.lite` hands out. It is allocated once and updated in place, so reading the
   * escape hatch every frame allocates nothing (coding standards §7).
   */
  readonly #lite: { scene: LiteScene; simulationScene: LiteScene | null };

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

  #mainCamera: Camera | null = null;

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
    this.#lite = { scene: options.scene, simulationScene: null };
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
   * @returns The render scene, and the physics simulation scene once an extension has set one. The
   * object is the same one on every read and is updated in place; do not retain a copy of its
   * fields.
   */
  get lite(): WorldLiteHandles {
    return this.#lite;
  }

  /**
   * Points `world.lite.simulationScene` at the scene an extension simulates in, or clears it
   * (`docs/architecture/09-physics.md` §1, `02-scene-graph.md` §2). Reached by extension authors
   * through `ExtensionContext.setSimulationScene`.
   *
   * @param scene - The simulation scene, or `null` to clear it in the extension's `dispose`.
   * @throws IgnifxError with code `IGX-0410` when a different simulation scene is already set.
   *
   * @internal
   */
  setSimulationScene(scene: LiteScene | null): void {
    const current = this.#lite.simulationScene;
    if (scene !== null && current !== null && current !== scene) {
      throw new IgnifxError(
        CoreErrorCode.simulationSceneAlreadySet,
        "This world already has a different simulation scene; a world has one simulation scene.",
        { hint: "Clear it with setSimulationScene(null) before handing the world another one." },
      );
    }
    this.#lite.simulationScene = scene;
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
    const requested = options?.uid;
    const uid = requested === undefined || this.#byUid.has(requested) ? this.#nextUid() : requested;
    // Reserved first, bound second: the entity's constructor writes its own handle into the Lite
    // node's metadata, so the handle has to exist before the entity does.
    const handle = toEntityHandle(this.#entities.reserve());
    const entity = new Entity(this, handle, uid, node, name, scene);
    this.#entities.bind(handle, entity);
    this.#byUid.set(uid, entity);
    if (options?.active === false) {
      entityInternals(entity).active = false;
    }
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
   * Resolves a dense component handle.
   *
   * @param handle - The handle, as a Lite node's `metadata.ignifx` tag carries it.
   * @returns The component, or `null` when the handle is stale.
   */
  getComponentByHandle(handle: ComponentHandle): Component | null {
    return this.#components.get(handle);
  }

  /**
   * The camera this world renders through: the enabled {@link Camera} with the highest `priority`
   * (`docs/architecture/07-rendering.md` §2.1).
   *
   * @remarks
   * The `PreRender` render-sync system chooses it and assigns it to the Lite scene, so the value is
   * the one the **last rendered frame** used, not a live query. A world with no enabled camera
   * renders nothing and logs `IGX-0706` once.
   *
   * @returns The main camera, or `null` when the world has none.
   *
   * @example
   * ```ts
   * const ray = world.mainCamera?.screenToRay(event.offsetX, event.offsetY) ?? null;
   * ```
   */
  get mainCamera(): Camera | null {
    return this.#mainCamera;
  }

  /**
   * Records the camera the render-sync system chose.
   *
   * @param camera - The new main camera, or `null`.
   *
   * @internal
   */
  setMainCamera(camera: Camera | null): void {
    this.#mainCamera = camera;
  }

  /**
   * Casts a ray against every renderable mesh in the world, on the CPU
   * (`docs/architecture/07-rendering.md` §3).
   *
   * @remarks
   * Distinct from a physics raycast (`09-physics.md` §5): this hits **render** geometry, including
   * meshes that carry no collider, and it ignores visibility — a hidden mesh still occludes, which
   * is Lite's documented behaviour (`src/lite/picking.ts`). It reads each mesh's CPU vertex copy, so
   * a mesh built from a GPU-only path is silently skipped and `app.renderer.pickAsync` is the exact
   * answer.
   *
   * @param ray - The ray to cast.
   * @param options - An entity filter.
   * @returns What was hit, or `null` for a miss.
   *
   * @example
   * ```ts
   * const hit = world.raycastRender(camera.screenToRay(x, y) ?? createRay());
   * ```
   */
  raycastRender(ray: Ray, options?: RenderPickOptions): RenderPick | null {
    return raycastRenderScene(this, this.#scene, ray, options);
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
   * Loads a scene file and builds its entities (`docs/architecture/02-scene-graph.md` §2).
   *
   * @remarks
   * `"single"` (the default) unloads every instance that is not `persistent` first — the implicit
   * `"default"` scene is persistent, so entities created in code survive. The asset and everything
   * it references are loaded before a single entity is created, which is what lets `asset()` fields
   * be usable in `awake` (`06-serialization-and-scene-format.md` §4 step 2).
   *
   * Construction happens in one synchronous block once the asset is in memory, so nothing observes
   * a half-built scene; `awake` and `onEnable` then run in tree order, through the world's own
   * lifecycle flush, before the returned promise settles. A component queued for `awake` by
   * something else earlier in the frame is flushed with it — the flush drains the whole queue, as
   * it does in the frame.
   *
   * @param scene - The scene address, or a reference carrying one.
   * @param options - The mode, cancellation, progress, and whether to make the result active.
   * @returns The instance, once every entity exists, every reference is resolved, and `awake` has
   * run.
   * @throws IgnifxError with code `IGX-0502` when `options.signal` aborts, and whatever the asset
   * system throws for a missing or malformed file.
   *
   * @example
   * ```ts
   * const level = await world.loadScene("levels/level01.scene.json", { mode: "additive" });
   * ```
   */
  async loadScene(scene: AssetRef<SceneAsset> | string, options?: LoadSceneOptions): Promise<SceneInstance> {
    const mode = options?.mode ?? "single";
    if (mode === "single") {
      await this.#unloadNonPersistent();
    }
    const address = typeof scene === "string" ? scene : scene.address;
    const onProgress = options?.onProgress;
    const handle = this.#assets().load<SceneAsset>(scene, {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(onProgress === undefined
        ? {}
        : {
            onProgress: (fraction: number): void => {
              onProgress({ address, fraction });
            },
          }),
    });
    await handle.promise;
    if (options?.signal?.aborted === true) {
      handle.release();
      throw new IgnifxError(CoreErrorCode.assetLoadAborted, `Loading ${address} was aborted.`, {
        context: { asset: address },
      });
    }
    const asset = handle.value;
    const instance = new SceneInstance(this.#nextUid(), asset.file.name, false);
    instance.setAsset(handle);
    instance.setLoaded(false);
    this.#scenes.push(instance);
    const built = instantiateScene(this, asset, {
      scene: instance,
      ...(options?.strictInstanceHashes === undefined ? {} : { strictInstanceHashes: options.strictInstanceHashes }),
    });
    instance.setRemap(built.remap);
    instance.setSettings(asset.file.settings ?? null);
    instance.setLoaded(true);
    this.#reportSceneIssues(address, built.issues);
    if (options?.setActive ?? mode === "single") {
      this.#activeScene = instance;
    }
    this.#lifecycle.flushAwakeAndEnable();
    this.#onSceneLoaded.emit(instance);
    return instance;
  }

  /**
   * Unloads a scene instance: `onUnloading` fires while its entities are still valid, its roots are
   * destroyed through the normal destroy path (children before parents, `onDisable` then
   * `onDestroy`), and the assets it held are released
   * (`docs/architecture/02-scene-graph.md` §3).
   *
   * @param instance - The instance to unload. Unloading the implicit `"default"` scene, or an
   * instance this world does not own, does nothing.
   * @returns A promise that settles once the destroy flush has run.
   *
   * @example
   * ```ts
   * await world.unloadScene(level);
   * ```
   */
  async unloadScene(instance: SceneInstance): Promise<void> {
    const at = this.#scenes.indexOf(instance);
    if (at <= 0) {
      return;
    }
    instance.onUnloading.emit();
    const roots = [...instance.roots];
    for (let index = 0; index < roots.length; index += 1) {
      roots[index]?.destroy();
    }
    this.#lifecycle.flushDestroy();
    this.#scenes.splice(at, 1);
    if (this.#activeScene === instance) {
      this.#activeScene = this.#scenes[0] ?? instance;
    }
    instance.setLoaded(false);
    instance.remap?.clear();
    instance.setRemap(null);
    const asset = instance.asset;
    instance.setAsset(null);
    asset?.release();
    this.#onSceneUnloaded.emit(instance);
    await Promise.resolve();
  }

  /**
   * Instantiates a loaded scene asset as a prefab (ADR-0005) and answers with its root.
   *
   * @remarks
   * Synchronous, because a `SceneAsset` carries its dependencies already loaded. Every entity gets
   * a fresh uid and an `Entity.prefab` link (`02-scene-graph.md` §6, §10). A file with exactly one
   * root answers with that root; a file with several gets a container entity named after the scene,
   * so the call always answers with one entity.
   *
   * `awake` follows the same rule as `addComponent`: queued for the frame's lifecycle flush, or run
   * nested and synchronously when `instantiate` is called from inside a callback
   * (`01-lifecycle-and-time.md` §4).
   *
   * @param scene - The loaded scene asset.
   * @param options - Parent, owning instance, name, and initial placement.
   * @returns The instance root.
   * @throws IgnifxError with code `IGX-0301` when a scene the file instances is not loaded, and
   * `IGX-0302` when instancing would nest a scene inside itself.
   *
   * @example
   * ```ts
   * const enemy = world.instantiate(enemyPrefab, { position: { x: 4, y: 0, z: 2 } });
   * ```
   */
  instantiate(scene: SceneAsset, options?: InstantiateOptions): Entity {
    assertSceneDependenciesLoaded(scene);
    const parent = options?.parent ?? null;
    const owner = options?.scene ?? (parent === null ? this.#activeScene : parent.scene);
    const handle = this.#sceneHandle(scene.address);
    const rootCount = countRoots(scene.file);
    const container =
      rootCount === 1
        ? null
        : this.createEntity(options?.name ?? scene.file.name, {
            ...(parent === null ? {} : { parent }),
            scene: owner,
            active: false,
          });
    const built = instantiateScene(this, scene, {
      parent: container ?? parent,
      scene: owner,
      asInstance: true,
      assetHandle: handle,
      rootEntity: container,
      ...(options?.strictInstanceHashes === undefined ? {} : { strictInstanceHashes: options.strictInstanceHashes }),
    });
    this.#reportSceneIssues(scene.address, built.issues);
    const root = container ?? onlyRoot(built.roots);
    if (container === null && options?.name !== undefined) {
      root.name = options.name;
    }
    placeRoot(root, options);
    if (container !== null) {
      container.active = true;
    }
    return root;
  }

  /**
   * Loads a scene asset and instantiates it (`docs/architecture/02-scene-graph.md` §2).
   *
   * @param scene - The scene address, or a reference carrying one.
   * @param options - Parent, owning instance, name, and initial placement.
   * @returns The instance root, once the asset and its dependencies have loaded.
   *
   * @example
   * ```ts
   * const enemy = await world.instantiateAsync("prefabs/enemy.prefab.json");
   * ```
   */
  async instantiateAsync(scene: AssetRef<SceneAsset> | string, options?: InstantiateOptions): Promise<Entity> {
    const handle = await this.#assets().loadAsync<SceneAsset>(scene);
    return this.instantiate(handle.value, options);
  }

  /**
   * Moves a root entity and its subtree to another scene instance
   * (`docs/architecture/02-scene-graph.md` §6). This is the per-object equivalent of marking a
   * whole instance `persistent`.
   *
   * @param entity - The entity to move; it must be a root.
   * @param scene - The instance that will own it.
   * @throws IgnifxError with code `IGX-0309` when the entity has a parent — a child follows its
   * parent's instance, so reparent it first — and `IGX-0101` when it has been destroyed.
   *
   * @example
   * ```ts
   * world.moveEntityToScene(player, world.scenes[0]);
   * ```
   */
  moveEntityToScene(entity: Entity, scene: SceneInstance): void {
    if (entity.isDestroyed) {
      throw new IgnifxError(CoreErrorCode.mutationAfterDestroy, "This entity has been destroyed.", {
        context: { target: "entity", entity: entity.uid, operation: "moveEntityToScene" },
      });
    }
    if (entity.parent !== null) {
      throw new IgnifxError(
        CoreErrorCode.entityIsNotSceneRoot,
        `${entity.name} has a parent, so it cannot move between scene instances on its own.`,
        {
          context: { entity: entity.uid, scene: scene.name },
          hint: "Call entity.setParent(null) first, or move the root of its subtree.",
        },
      );
    }
    this.moveToScene(entity, scene);
  }

  /**
   * Unloads every instance that is not `persistent`, oldest first.
   *
   * @returns A promise that settles once every unload has run.
   */
  async #unloadNonPersistent(): Promise<void> {
    const doomed: SceneInstance[] = [];
    for (let index = 1; index < this.#scenes.length; index += 1) {
      const instance = this.#scenes[index];
      if (instance !== undefined && !instance.persistent) {
        doomed.push(instance);
      }
    }
    // Each unload runs its destroy flush synchronously before it yields, so awaiting them together
    // still releases the scenes in the order they were loaded.
    await Promise.all(doomed.map(async (instance) => this.unloadScene(instance)));
  }

  /**
   * The asset service, which every scene operation needs.
   *
   * @returns The service.
   */
  #assets(): Assets {
    return this.#app.assets;
  }

  /**
   * The handle a loaded scene asset stands behind, when the asset service knows one.
   *
   * @param address - The scene's address.
   * @returns The handle, or `null` when there is no asset service or no cached handle.
   */
  #sceneHandle(address: string): AssetHandle<SceneAsset> | null {
    return this.#app.assets.get<SceneAsset>(address);
  }

  /**
   * Writes a load's recoverable problems to the app log, one record each.
   *
   * @param address - The scene being built.
   * @param issues - What the build found.
   */
  #reportSceneIssues(address: string, issues: readonly SceneLoadIssue[]): void {
    for (let index = 0; index < issues.length; index += 1) {
      const issue = issues[index];
      if (issue !== undefined) {
        this.#app.log.warn(`${issue.code}: ${address}: ${issue.message}`);
      }
    }
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
    this.#lite.simulationScene = null;
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
 * Babylon Lite objects a world owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3, `02-scene-graph.md` §2); excluded from the stability
 * guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export interface WorldLiteHandles {
  /** The Lite scene the world's entities are rendered from. */
  readonly scene: LiteScene;
  /**
   * The scene a physics extension steps its simulation in (`docs/architecture/09-physics.md` §1),
   * or `null` when no extension has set one.
   */
  readonly simulationScene: LiteScene | null;
}

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
  /**
   * The entity's own `active` flag at creation. Defaults to `true`.
   *
   * @remarks
   * Scene loading passes `false` so that no component can `awake` before the whole scene exists and
   * its references are resolved (`docs/architecture/01-lifecycle-and-time.md` §4), then sets the
   * file's value in tree order once construction is complete.
   */
  readonly active?: boolean;
  /**
   * The uid to adopt instead of a freshly minted ULID.
   *
   * @remarks
   * Scene loading passes the uid the file carries, which is what makes save → load → save
   * byte-identical (`docs/architecture/06-serialization-and-scene-format.md` §1). A uid another
   * entity of this world already holds is ignored and a fresh one minted, so two instances of one
   * scene never collide (`02-scene-graph.md` §10).
   */
  readonly uid?: string;
}

/**
 * How far a scene load has got, as `world.loadScene`'s `onProgress` reports it.
 *
 * @public
 */
export interface LoadProgress {
  /** The address being loaded. */
  readonly address: string;
  /** How far along, in `[0, 1]`, counting every dependency the scene pulls in. */
  readonly fraction: number;
}

/**
 * Options accepted by {@link World.loadScene} (`docs/architecture/02-scene-graph.md` §2).
 *
 * @public
 */
export interface LoadSceneOptions {
  /**
   * `"single"` (the default) unloads every instance that is not `persistent` first; `"additive"`
   * keeps them.
   */
  readonly mode?: "single" | "additive";
  /** Cancels the load; an abort after the asset arrived still rejects with `IGX-0502`. */
  readonly signal?: AbortSignal;
  /** Called as the scene and its dependencies load. */
  readonly onProgress?: (progress: LoadProgress) => void;
  /**
   * Makes the loaded instance `world.activeScene`. Defaults to `true` for a `"single"` load and
   * `false` for an additive one, which is what "the level you just loaded owns new entities" means.
   */
  readonly setActive?: boolean;
  /** `true` turns an `IGX-0604` instance hash mismatch from a logged warning into a throw. */
  readonly strictInstanceHashes?: boolean;
}

/**
 * Options accepted by {@link World.instantiate} and {@link World.instantiateAsync}
 * (`docs/architecture/02-scene-graph.md` §2).
 *
 * @public
 */
export interface InstantiateOptions {
  /** The parent to attach the instance root to; `null` or omitted makes it a root. */
  readonly parent?: Entity | null;
  /** The instance that owns the new entities; defaults to the parent's, else `world.activeScene`. */
  readonly scene?: SceneInstance;
  /** Renames the instance root. */
  readonly name?: string;
  /** Places the instance root. */
  readonly position?: Vec3Like;
  /** Rotates the instance root. */
  readonly rotation?: QuatLike;
  /** `true` reads `position`/`rotation` as world values; `false` (the default) as local ones. */
  readonly worldSpace?: boolean;
  /** `true` turns an `IGX-0604` instance hash mismatch from a logged warning into a throw. */
  readonly strictInstanceHashes?: boolean;
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

/**
 * How many roots a scene file declares.
 *
 * @param file - The file.
 * @returns The count of entities with no parent.
 */
function countRoots(file: SceneFile): number {
  let count = 0;
  for (let index = 0; index < file.entities.length; index += 1) {
    if (file.entities[index]?.parent === null) {
      count += 1;
    }
  }
  return count;
}

/**
 * Applies an instantiate call's placement options to the instance root.
 *
 * @param root - The instance root.
 * @param options - The placement options.
 */
function placeRoot(root: Entity, options?: InstantiateOptions): void {
  const worldSpace = options?.worldSpace === true;
  const position = options?.position;
  if (position !== undefined) {
    if (worldSpace) {
      root.transform.position = position;
    } else {
      root.transform.localPosition.set(position.x, position.y, position.z);
    }
  }
  const rotation = options?.rotation;
  if (rotation !== undefined) {
    if (worldSpace) {
      root.transform.rotation = rotation;
    } else {
      root.transform.localRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }
}

/**
 * The single root of an instance built from a file that declares exactly one.
 *
 * @param roots - What the builder produced.
 * @returns The root.
 */
function onlyRoot(roots: readonly Entity[]): Entity {
  // Boundary assertion (coding standards §5.2). The invariant: `instantiate` takes this path only
  // when `countRoots` said the file declares exactly one root, and the builder creates one entity
  // per file entity, so index 0 is always present. A container covers every other shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return roots[0] as Entity;
}

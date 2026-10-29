import { componentInternals } from "../component/internals.js";
import { entityInternals } from "../entity/internals.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { DEFAULT_LAYER } from "../layers/layer-table.js";
import { decodeProps } from "../schema/encode.js";
import { expandScene, singleRoot } from "./expand.js";
import { findSceneDependency } from "./scene-asset.js";
import { UidRemap, remapDecoder } from "./uid-remap.js";
import type { ExpandedEntity, ExpandedInstance } from "./expand.js";
import type { MutableSceneEntity } from "./overrides.js";
import type { SceneAsset } from "./scene-asset.js";
import type { SceneFileComponent } from "./scene-file.js";
import type { AssetResolver } from "./uid-remap.js";
import type { AssetHandle } from "../assets/types.js";
import type { ConcreteComponentType } from "../component/component-type.js";
import type { Component } from "../component/component.js";
import type { Entity } from "../entity/entity.js";
import type { EntityInstanceLink, EntityOrigin, InstancedRoot } from "../entity/internals.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { ReferenceDecoder } from "../schema/encode.js";
import type { JsonObject } from "../schema/json.js";
import type { Schema } from "../schema/types.js";
import type { World } from "../world/world.js";

/**
 * One recoverable problem found while a scene was being built. Nothing here stops the load: a file
 * degrades one field, one reference, or one layer rather than failing whole
 * (`docs/architecture/06-serialization-and-scene-format.md` §4).
 *
 * @public
 */
export interface SceneLoadIssue {
  /** The diagnostic code, for example `IGX-0602` or `IGX-0303`. */
  readonly code: string;
  /** The actionable sentence. */
  readonly message: string;
}

/**
 * Options accepted by {@link instantiateScene}.
 *
 * @public
 */
export interface InstantiateSceneOptions {
  /** The entity the scene's roots attach to; `null` or omitted makes them roots of `scene`. */
  readonly parent?: Entity | null;
  /** The instance that owns the new entities; defaults to the parent's, else `world.activeScene`. */
  readonly scene?: SceneInstance;
  /**
   * `true` treats the whole file as one instance: every entity gets a fresh uid and an
   * `Entity.prefab` link. This is what `world.instantiate` does; `world.loadScene` leaves it off so
   * that the scene's own entities keep the uids the file gave them
   * (`docs/architecture/02-scene-graph.md` §10).
   */
  readonly asInstance?: boolean;
  /** The handle the scene was loaded through, recorded on `Entity.prefab` when `asInstance`. */
  readonly assetHandle?: AssetHandle<SceneAsset> | null;
  /**
   * The entity that stands for the instance when `asInstance` is set and the file has more or fewer
   * than one root. `world.instantiate` creates it and passes it as both `parent` and `rootEntity`,
   * so that the call still answers with one entity.
   */
  readonly rootEntity?: Entity | null;
  /** `true` turns an `IGX-0604` hash mismatch from a diagnostic into a throw. */
  readonly strictInstanceHashes?: boolean;
  /**
   * How an `entityRef` or `componentRef` to a uid the file does not declare resolves. A tool that
   * builds part of a larger document, such as an editor rebuilding one prefab instance, resolves
   * the rest of the document here, so the part decodes as the whole file would; this includes a
   * reference an instance's overrides hold. The file's own uids come first, and `asset()` fields
   * never use it. Omitted, such a reference is `null` with an `IGX-0602` issue.
   */
  readonly outsideReferences?: Pick<ReferenceDecoder, "entity" | "component">;
}

/**
 * What {@link instantiateScene} produced.
 *
 * @public
 */
export interface SceneBuildResult {
  /** The entities that ended up parentless within the built subtree, in file order. */
  readonly roots: readonly Entity[];
  /** The file-local uid to runtime object table (`docs/architecture/02-scene-graph.md` §10). */
  readonly remap: UidRemap;
  /** Every recoverable problem, in discovery order. */
  readonly issues: readonly SceneLoadIssue[];
}

/**
 * Builds the entities of a scene asset into a world — steps 3 to 6 of the loading algorithm
 * (`docs/architecture/06-serialization-and-scene-format.md` §4). It is synchronous and does no I/O:
 * every asset the file references is already loaded, which is what a `SceneAsset` guarantees.
 *
 * @remarks
 * The mechanism that keeps `awake` honest is worth stating, because §4 step 6 and
 * `01-lifecycle-and-time.md` §4 state only the outcome. Entities are created with `active: false`,
 * so the enable transition computes "not effectively enabled" and queues nothing. Components are
 * attached with their schema defaults, then every component's props are decoded — that is where
 * `entityRef` and `componentRef` resolve, through a table that by then holds the whole scene. Only
 * then does a last pass write each entity's file `active` value in tree order, which is what queues
 * `awake` and `onEnable`, parents before children. Nothing observes the half-built scene, because
 * all of this runs in one synchronous block.
 *
 * @param world - The world to build into.
 * @param asset - The scene to build.
 * @param options - Where to attach the result, and how to treat instance hashes.
 * @returns The roots, the uid table, and every recoverable problem.
 * @throws IgnifxError with code `IGX-0302` on an instance cycle, `IGX-0307` when the file names an
 * unregistered component type, and `IGX-0604` when `strictInstanceHashes` is set and a recorded
 * instance hash does not match.
 *
 * @example
 * ```ts
 * const built = instantiateScene(world, sceneAsset, { scene: world.activeScene });
 * const player = built.remap.entity("01J9Z6M7E5S3A0V2Q4R8T1Y6WX");
 * ```
 *
 * @public
 */
export function instantiateScene(world: World, asset: SceneAsset, options?: InstantiateSceneOptions): SceneBuildResult {
  const issues: SceneLoadIssue[] = [];
  const report = (code: string, message: string): void => {
    issues.push({ code, message });
  };
  const asInstance = options?.asInstance === true;
  const expanded = expandScene(asset, {
    nextUid: () => world.nextUid(),
    report,
    ...(options?.strictInstanceHashes === undefined ? {} : { strictInstanceHashes: options.strictInstanceHashes }),
    asInstance,
  });
  const parent = options?.parent ?? null;
  const context: BuildContext = {
    world,
    scene: options?.scene ?? (parent === null ? world.activeScene : parent.scene),
    remap: new UidRemap(),
    report,
    instances: indexInstances(expanded.instances),
    merged: expanded.merged,
    roots: [],
    built: [],
  };
  createEntities(context, expanded.entities, parent);
  attachComponents(context);
  linkInstances(context, options?.assetHandle ?? null, options?.rootEntity ?? null);
  decodeAllProps(context, sceneAssetResolver(world, asset), options?.outsideReferences);
  activate(context);
  return { roots: context.roots, remap: context.remap, issues };
}

/** Everything the build passes share. */
interface BuildContext {
  /** The world being built into. */
  readonly world: World;
  /** The instance that owns the new entities. */
  readonly scene: SceneInstance;
  /** The file-local uid table being filled. */
  readonly remap: UidRemap;
  /** Where recoverable problems go. */
  readonly report: (code: string, message: string) => void;
  /** The expansion's instances, by key, in expansion order. */
  readonly instances: ReadonlyMap<string, ExpandedInstance>;
  /** Expanded entity uid to the components an instanced root merged into it. */
  readonly merged: ReadonlyMap<string, ReadonlySet<string>>;
  /** The parentless entities produced, in file order. */
  readonly roots: Entity[];
  /** Every entity produced, in file order, with the record that produced it. */
  readonly built: BuiltEntity[];
}

/** One entity created by the first pass, with the file record that produced it. */
interface BuiltEntity {
  /** The entity. */
  readonly entity: Entity;
  /** Its expanded file record. */
  readonly source: ExpandedEntity;
  /** Its components, in the order the file listed them. */
  readonly components: Component[];
}

/**
 * Indexes the expansion's instances by key.
 *
 * @param instances - The instances the expansion produced.
 * @returns The lookup table.
 */
function indexInstances(instances: readonly ExpandedInstance[]): ReadonlyMap<string, ExpandedInstance> {
  const table = new Map<string, ExpandedInstance>();
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    if (instance !== undefined) {
      table.set(instance.key, instance);
    }
  }
  return table;
}

/**
 * Pass 1: creates every entity, inactive, in tree order, and applies its plain properties.
 *
 * @param context - The build state.
 * @param entities - The expanded entity list.
 * @param parent - What the file's roots attach to.
 */
function createEntities(context: BuildContext, entities: readonly ExpandedEntity[], parent: Entity | null): void {
  for (let index = 0; index < entities.length; index += 1) {
    const source = entities[index];
    if (source === undefined) {
      continue;
    }
    const data = source.data;
    const owner = data.parent === null ? parent : context.remap.entity(data.parent);
    if (data.parent !== null && owner === null) {
      context.report(
        CoreErrorCode.unresolvedReference,
        `The entity ${data.uid} names parent ${data.parent}, which the file does not declare; it becomes a root.`,
      );
    }
    const entity = context.world.createEntity(data.name, {
      ...(owner === null ? {} : { parent: owner }),
      scene: context.scene,
      active: false,
      uid: data.uid,
    });
    applyTransform(entity, data);
    applyLayer(context, entity, data);
    applyTags(entity, data);
    entity.isStatic = data.static === true;
    context.remap.addEntity(data.uid, entity);
    if (data.parent === null) {
      context.roots.push(entity);
    }
    context.built.push({ entity, source, components: [] });
  }
}

/**
 * Pass 2: attaches every component with its schema defaults, so the reference table is complete
 * before any prop is decoded.
 *
 * @remarks
 * A file may list a component before one its class `requires` (an editor reorder does that).
 * `addComponent` would then add a second, fresh instance of the required class, or throw `IGX-0202`
 * when the file's own record comes. So a record that a class requires is attached first, and the
 * entity's components are put back in file order afterwards.
 *
 * @param context - The build state.
 * @throws IgnifxError with code `IGX-0307` when the file names an unregistered component type: the
 * file cannot be honoured with a component missing, so this one is not recoverable.
 */
function attachComponents(context: BuildContext): void {
  for (let index = 0; index < context.built.length; index += 1) {
    const built = context.built[index];
    if (built !== undefined) {
      attachEntityComponents(context, built);
    }
  }
}

/**
 * Attaches one entity's component records, each record's required records first.
 *
 * @param context - The build state.
 * @param built - The entity and its file record.
 */
function attachEntityComponents(context: BuildContext, built: BuiltEntity): void {
  const registry = context.world.registry;
  const records = built.source.data.components;
  const types = records.map((record) => registeredType(context, record, built.source.data.uid));
  const attached: (Component | undefined)[] = [];
  const started = new Set<number>();
  const order: number[] = [];
  const attach = (at: number): void => {
    const record = records[at];
    const type = types[at];
    if (record === undefined || type === undefined || started.has(at)) {
      return;
    }
    started.add(at);
    const requires = registry.describe(type).requires;
    for (let inner = 0; inner < requires.length; inner += 1) {
      const required = requires[inner];
      if (required === undefined || built.entity.getComponent(required) !== null) {
        continue;
      }
      const supplier = types.findIndex(
        (candidate, other) => !started.has(other) && registry.describe(candidate).ancestors.includes(required),
      );
      if (supplier >= 0) {
        attach(supplier);
      }
    }
    const component = built.entity.addComponent(type);
    componentInternals(component).uid = record.uid;
    if (record.enabled === false) {
      component.enabled = false;
    }
    context.remap.addComponent(record.uid, component);
    attached[at] = component;
    order.push(at);
  };
  for (let at = 0; at < records.length; at += 1) {
    attach(at);
  }
  for (let at = 0; at < attached.length; at += 1) {
    const component = attached[at];
    if (component !== undefined) {
      built.components.push(component);
    }
  }
  if (order.some((at, position) => at !== position)) {
    restoreFileOrder(built.entity, built.components);
  }
}

/**
 * Looks up a record's component class.
 *
 * @param context - The build state.
 * @param record - The component record.
 * @param entityUid - The owning entity's file uid, for the error.
 * @returns The registered class.
 * @throws IgnifxError with code `IGX-0307` when the type is not registered.
 */
function registeredType(context: BuildContext, record: SceneFileComponent, entityUid: string): ConcreteComponentType {
  const type = context.world.registry.get(record.type);
  if (type === null) {
    throw new IgnifxError(CoreErrorCode.unknownComponentTypeId, `${record.type} is not a registered component type.`, {
      context: { typeId: record.type, entity: entityUid },
      hint: "Register the class with app.registerComponents before loading a scene that uses it.",
    });
  }
  // Only a concrete class reaches the registry's
  // type-id table, because `ComponentRegistry.register` takes a `ConcreteComponentType`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return type as ConcreteComponentType;
}

/**
 * Puts the file's components back in file order within the slots they occupy on the entity, so
 * `getComponent`, `awake` and a later save see the order the file wrote. Other components (the
 * transform, any auto-added one) keep their places.
 *
 * @param entity - The entity.
 * @param inFileOrder - The components the file listed, in file order.
 */
function restoreFileOrder(entity: Entity, inFileOrder: readonly Component[]): void {
  const list = entityInternals(entity).components;
  const slots = inFileOrder.map((component) => list.indexOf(component)).toSorted((a, b) => a - b);
  for (let at = 0; at < slots.length; at += 1) {
    const slot = slots[at];
    const component = inFileOrder[at];
    if (slot !== undefined && component !== undefined) {
      list[slot] = component;
    }
  }
}

/**
 * Pass 3: records where each entity came from, so `Entity.prefab` answers and the serializer can
 * re-emit the subtree as an `instance` entry with recomputed overrides.
 *
 * @param context - The build state.
 * @param handle - The handle the whole file was loaded through, for `asInstance` builds.
 * @param rootEntity - The entity that stands for the outermost instance, when the caller made one.
 */
function linkInstances(context: BuildContext, handle: AssetHandle<SceneAsset> | null, rootEntity: Entity | null): void {
  const firstMember = new Map<string, Entity>();
  for (let index = 0; index < context.built.length; index += 1) {
    const built = context.built[index];
    const key = built?.source.instanceKey ?? null;
    if (built !== undefined && key !== null && !firstMember.has(key)) {
      firstMember.set(key, built.entity);
    }
  }
  // In expansion order, so an entity that roots several instances — a variant merged with the
  // scene it instances — links the outermost one. A nested `instance` entry names the entity it
  // sat on; the outermost instance of a `world.instantiate` has no such entity, so the caller's
  // container — or, when the file has a single root, that root — stands for it.
  const rootOfInstance = new Map<string, Entity>();
  for (const instance of context.instances.values()) {
    const declared = instance.rootUid;
    const resolved =
      declared === null ? (rootEntity ?? firstMember.get(instance.key) ?? null) : context.remap.entity(declared);
    if (resolved !== null) {
      rootOfInstance.set(instance.key, resolved);
    }
  }
  const insideOf = new Map<Entity, Entity>();
  for (let index = 0; index < context.built.length; index += 1) {
    const built = context.built[index];
    const key = built?.source.instanceKey ?? null;
    if (built === undefined || key === null) {
      continue;
    }
    const root = rootOfInstance.get(key);
    if (root !== undefined && root !== built.entity) {
      insideOf.set(built.entity, root);
    }
  }
  if (rootEntity !== null) {
    const own = ownedInstance(context, rootEntity, null, rootOfInstance, handle);
    if (own !== null) {
      entityInternals(rootEntity).origin = {
        sourceUid: "",
        instanceRoot: null,
        instanced: own,
        componentSourceUids: new Map<string, string>(),
      };
    }
  }
  for (let index = 0; index < context.built.length; index += 1) {
    const built = context.built[index];
    if (built === undefined) {
      continue;
    }
    const own = ownedInstance(context, built.entity, built.source, rootOfInstance, handle);
    const inside = insideOf.get(built.entity) ?? null;
    if (own === null && inside === null) {
      continue;
    }
    const origin: EntityOrigin = {
      sourceUid: built.source.sourceUid,
      instanceRoot: inside,
      instanced: own,
      componentSourceUids: built.source.componentSourceUids,
    };
    entityInternals(built.entity).origin = origin;
  }
}

/**
 * The instance an entity is the root of, if any.
 *
 * @param context - The build state.
 * @param entity - The candidate root.
 * @param source - The expanded record that produced it, or `null` for a caller's container.
 * @param rootOfInstance - Instance key to its root entity.
 * @param handle - The handle the whole file was loaded through, for `asInstance` builds.
 * @returns The link, or `null` when the entity roots no instance.
 */
function ownedInstance(
  context: BuildContext,
  entity: Entity,
  source: ExpandedEntity | null,
  rootOfInstance: ReadonlyMap<string, Entity>,
  handle: AssetHandle<SceneAsset> | null,
): EntityInstanceLink | null {
  for (const [key, root] of rootOfInstance) {
    if (root !== entity) {
      continue;
    }
    const instance = context.instances.get(key);
    if (instance === undefined) {
      continue;
    }
    return {
      address: instance.address,
      asset: instance.rootUid === null ? handle : instance.asset,
      scene: instance.scene,
      root: instancedRoot(context, instance, source),
    };
  }
  return null;
}

/**
 * What an instance root took from its scene's single root, when it stands for that root rather
 * than for a container (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @param context - The build state.
 * @param instance - The instance the entity roots.
 * @param source - The expanded record that produced the entity, or `null` for a caller's container.
 * @returns The root's record uid and the components it brought, or `null` for a container.
 */
function instancedRoot(
  context: BuildContext,
  instance: ExpandedInstance,
  source: ExpandedEntity | null,
): InstancedRoot | null {
  if (source === null) {
    return null;
  }
  const merged = context.merged.get(source.data.uid) ?? new Set<string>();
  if (instance.root !== null) {
    return {
      sourceUid: instance.root.sourceUid,
      componentSourceUids: instance.root.componentSourceUids,
      components: merged,
    };
  }
  if (instance.rootUid !== null || singleRoot(instance.scene)?.uid !== source.sourceUid) {
    return null;
  }
  // `world.instantiate` of a single-root file: the root is a member of the instance it roots, so
  // every component its record declared came from the instancing too.
  return {
    sourceUid: source.sourceUid,
    componentSourceUids: source.componentSourceUids,
    components: new Set([...source.componentSourceUids.keys(), ...merged]),
  };
}

/**
 * Pass 4: decodes every component's props, resolving `entityRef`/`componentRef` through the now
 * complete uid table (`docs/architecture/06-serialization-and-scene-format.md` §4 step 5).
 *
 * @param context - The build state.
 * @param assets - How an `asset()` field's address becomes the handle the scene already retains.
 * @param outside - How a uid the file does not declare resolves, if at all.
 */
function decodeAllProps(
  context: BuildContext,
  assets: AssetResolver,
  outside: Pick<ReferenceDecoder, "entity" | "component"> | undefined,
): void {
  const decoder = remapDecoder(context.remap, assets, outside);
  for (let index = 0; index < context.built.length; index += 1) {
    const built = context.built[index];
    if (built === undefined) {
      continue;
    }
    const records = built.source.data.components;
    for (let inner = 0; inner < built.components.length; inner += 1) {
      const component = built.components[inner];
      const record = records[inner];
      if (component === undefined || record === undefined) {
        continue;
      }
      const schema = context.world.registry.describe(component.constructor).schema;
      if (schema !== null) {
        applyProps(context, decoder, component, schema, record.props ?? {}, record.uid);
      }
    }
  }
}

/**
 * Decodes one component's props and writes them onto the instance.
 *
 * @param context - The build state.
 * @param decoder - How uids resolve to entities and components.
 * @param component - The component to fill.
 * @param schema - Its declared fields.
 * @param props - The JSON from the file.
 * @param uid - The component's file uid, for diagnostics.
 */
function applyProps(
  context: Pick<BuildContext, "report">,
  decoder: ReferenceDecoder,
  component: Component,
  schema: Schema,
  props: JsonObject,
  uid: string,
): void {
  const decoded = decodeProps(schema, props, decoder);
  for (let index = 0; index < decoded.issues.length; index += 1) {
    const issue = decoded.issues[index];
    if (issue !== undefined) {
      context.report(issue.code, `${uid}.${issue.path === "" ? "<value>" : issue.path}: ${issue.message}`);
    }
  }
  // The schema declares exactly these property names on
  // the component's generated base class, and `decodeProps` produced one value per declared field.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const target = component as unknown as Record<string, unknown>;
  // The same invariant, read side.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const values = decoded.value as Record<string, unknown>;
  for (const name of Object.keys(schema)) {
    target[name] = values[name];
  }
}

/**
 * Pass 5: writes each entity's file `active` value in tree order, which is what queues `awake` and
 * `onEnable` parents before children.
 *
 * @param context - The build state.
 */
function activate(context: BuildContext): void {
  for (let index = 0; index < context.built.length; index += 1) {
    const built = context.built[index];
    if (built !== undefined && built.source.data.active !== false) {
      built.entity.active = true;
    }
  }
}

/**
 * Writes the file's local transform onto a freshly created entity.
 *
 * @param entity - The entity.
 * @param data - Its file record.
 */
function applyTransform(entity: Entity, data: MutableSceneEntity): void {
  const { position, rotation, scale } = data.transform;
  entity.transform.localPosition.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
  entity.transform.localRotation.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1);
  entity.transform.localScale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
}

/**
 * Resolves the file's layer name against the project settings, falling back to `Default` with
 * `IGX-0303` rather than failing the load (`docs/architecture/02-scene-graph.md` §7).
 *
 * @param context - The build state.
 * @param entity - The entity.
 * @param data - Its file record.
 */
function applyLayer(context: BuildContext, entity: Entity, data: MutableSceneEntity): void {
  const name = data.layer;
  if (name === undefined) {
    return;
  }
  const slot = context.world.layers.indexOf(name);
  if (slot < 0) {
    context.report(CoreErrorCode.unknownLayer, `${name} is not a layer declared in the project settings.`);
    entity.layer = DEFAULT_LAYER;
    return;
  }
  entity.layer = slot;
}

/**
 * Copies the file's tags onto an entity.
 *
 * @param entity - The entity.
 * @param data - Its file record.
 */
function applyTags(entity: Entity, data: MutableSceneEntity): void {
  const tags = data.tags;
  if (tags === undefined) {
    return;
  }
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag !== undefined && tag !== "") {
      entity.tags.add(tag);
    }
  }
}

/**
 * Builds the resolver `asset()` fields decode through: the scene's own retained dependency handles
 * first, then the app's cache (`docs/architecture/05-assets-and-loading.md` §3).
 *
 * @remarks
 * The dependency list is searched first, and by address rather than by identity, because that is
 * the set the file itself declared: an address the file references is loaded and retained by the
 * `SceneAsset`, so the handle it yields is the one whose lifetime matches the scene instance. The
 * cache fallback covers an address a component's props name but the loader's `$asset` walk did not
 * reach — an override written by hand, say — and an in-code `memory:` asset a script registered
 * before instantiating a prefab that names it.
 *
 * @param world - The world being built into, for its app's asset service.
 * @param asset - The scene being built.
 * @returns The resolver, or one that resolves nothing when the app has no asset service yet.
 */
function sceneAssetResolver(world: World, asset: SceneAsset): AssetResolver {
  const dependencies = asset.dependencies;
  return (address: string, type: string | null): AssetHandle | null => {
    for (let index = 0; index < dependencies.length; index += 1) {
      const handle = dependencies[index];
      if (handle !== undefined && handle.address === address && handle.state === "loaded") {
        if (type === null || handle.type === type) {
          return handle;
        }
      }
    }
    const cached = world.app.assets.get(address);
    return cached !== null && cached.state === "loaded" ? cached : null;
  };
}

/** A decoder that resolves nothing, for a record built without one. */
const NO_REFERENCES: ReferenceDecoder = Object.freeze({
  entity: (): null => null,
  component: (): null => null,
  asset: (): null => null,
});

/**
 * Options accepted by {@link addComponentFromRecord}.
 *
 * @public
 */
export interface AddComponentFromRecordOptions {
  /**
   * The component's index among the entity's components as a scene file lists them (the transform
   * and the components an instanced scene put on the entity do not count). Defaults to the end; a
   * value past the end is clamped to it.
   */
  readonly index?: number;
  /**
   * How `$entity`, `$component` and `$asset` values in the record's `props` resolve. Without one
   * every reference decodes as `null` and is reported (`IGX-0602`). An asset must already be loaded:
   * decoding never starts a load.
   */
  readonly references?: ReferenceDecoder;
}

/**
 * What {@link addComponentFromRecord} built.
 *
 * @public
 */
export interface ComponentBuildResult {
  /** The attached component, carrying the record's uid. */
  readonly component: Component;
  /** Every recoverable problem found while decoding `props`, in discovery order. */
  readonly issues: readonly SceneLoadIssue[];
}

/**
 * Attaches one component to a live entity from its scene file record, the way the scene loader
 * builds it: the record's registered type, its uid, its `enabled` flag, and its `props` decoded
 * against the schema (`docs/architecture/06-serialization-and-scene-format.md` §4).
 *
 * @remarks
 * This is the per-component step of {@link instantiateScene} for a world that already exists, which
 * is what an editor mirroring a document into a live world needs. The component is attached with
 * `entity.addComponent`, so `awake` follows that method's rules. The record's uid is adopted as is;
 * keeping it unique within the scene is the caller's job. Decoding never throws: a value that does
 * not match its field takes the field's default and is reported in `issues`.
 *
 * @param entity - The entity to attach to.
 * @param record - The component record, as a scene file writes it.
 * @param options - Where it goes among the entity's components, and how references resolve.
 * @returns The component and the decoding problems.
 * @throws IgnifxError with code `IGX-0307` when the record's type is not registered, and whatever
 * `entity.addComponent` throws (`IGX-0202` for a second instance of a single-instance class,
 * `IGX-0101` for a destroyed entity).
 *
 * @example
 * ```ts
 * const { component } = addComponentFromRecord(player, { uid: "01J9Z6M7E5S3A0V2Q4R8T1Y6WY", type: "game/Health", props: { max: 120 } });
 * ```
 *
 * @public
 */
export function addComponentFromRecord(
  entity: Entity,
  record: SceneFileComponent,
  options?: AddComponentFromRecordOptions,
): ComponentBuildResult {
  const registry = entity.world.registry;
  const type = registry.get(record.type);
  if (type === null) {
    throw new IgnifxError(
      CoreErrorCode.unknownComponentTypeId,
      `The component type "${record.type}" is not registered; register it with app.registerComponents or check its typeId.`,
      { context: { typeId: record.type, entity: entity.uid } },
    );
  }
  // Only a concrete class reaches the registry's type-id table, because `ComponentRegistry.register`
  // takes a `ConcreteComponentType`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const component = entity.addComponent(type as ConcreteComponentType);
  componentInternals(component).uid = record.uid;
  if (record.enabled === false) {
    component.enabled = false;
  }
  if (options?.index !== undefined) {
    moveToFileIndex(entity, component, options.index);
  }
  const issues: SceneLoadIssue[] = [];
  const schema = registry.describe(component.constructor).schema;
  if (schema !== null) {
    const context: Pick<BuildContext, "report"> = {
      report: (code: string, message: string): void => {
        issues.push({ code, message });
      },
    };
    applyProps(context, options?.references ?? NO_REFERENCES, component, schema, record.props ?? {}, record.uid);
  }
  return { component, issues };
}

/**
 * Moves a component to an index of the entity's component list as a scene file counts it: the
 * transform, destroyed components, and the components an instanced scene merged in do not count.
 *
 * @param entity - The owner.
 * @param component - One of its components.
 * @param index - The index in file order; past the end means the end.
 */
function moveToFileIndex(entity: Entity, component: Component, index: number): void {
  const internals = entityInternals(entity);
  const list = internals.components;
  const from = list.indexOf(component);
  if (from < 0) {
    return;
  }
  list.splice(from, 1);
  const merged = internals.origin?.instanced?.root?.components ?? null;
  let counted = 0;
  for (let at = 0; at < list.length; at += 1) {
    const other = list[at];
    if (other === undefined || other === internals.transform || other.isDestroyed || merged?.has(other.uid) === true) {
      continue;
    }
    if (counted >= index) {
      list.splice(at, 0, component);
      return;
    }
    counted += 1;
  }
  list.push(component);
}

/**
 * Checks that every scene a file instances — at any depth — is among the loaded dependencies, which
 * is what makes `world.instantiate` safe to be synchronous
 * (`docs/architecture/02-scene-graph.md` §2).
 *
 * @param asset - The scene to check.
 * @throws IgnifxError with code `IGX-0301` naming the first instanced scene that is not loaded.
 *
 * @public
 */
export function assertSceneDependenciesLoaded(asset: SceneAsset): void {
  const seen = new Set<string>();
  const pending: SceneAsset[] = [asset];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current.address)) {
      continue;
    }
    seen.add(current.address);
    const entities = current.file.entities;
    for (let index = 0; index < entities.length; index += 1) {
      const instance = entities[index]?.instance;
      if (instance === undefined) {
        continue;
      }
      const address = instance.scene.$asset;
      const resolved = findSceneDependency(current, address);
      if (resolved === null) {
        throw new IgnifxError(CoreErrorCode.sceneNotLoaded, `The scene ${address} is not loaded yet.`, {
          context: { scene: address, entity: current.address },
          hint: "Load it through the asset system first; world.instantiateAsync does that for you.",
        });
      }
      pending.push(resolved.value);
    }
  }
}

import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { asJsonArray, asJsonObject } from "./json-view.js";
import { applyOverrides } from "./overrides.js";
import { findSceneDependency } from "./scene-asset.js";
import type { MutableSceneEntity, OverrideTarget } from "./overrides.js";
import type { SceneAsset } from "./scene-asset.js";
import type { SceneFileComponent, SceneFileEntity } from "./scene-file.js";
import type { AssetHandle } from "../assets/types.js";
import type { JsonObject, JsonValue } from "../schema/json.js";

/**
 * One entity of a fully expanded scene: every `instance` entry has been replaced by the entities of
 * the scene it named, with a fresh uid per copy and its overrides already applied
 * (`docs/architecture/06-serialization-and-scene-format.md` §4 step 3).
 *
 * @internal
 */
export interface ExpandedEntity {
  /** The entity record, with `uid` and `parent` in expanded (unique) uid space. */
  readonly data: MutableSceneEntity;
  /** The uid the entity carries in the file that declared it, which overrides address. */
  readonly sourceUid: string;
  /** The instance this entity belongs to, or `null` when the scene itself declared it. */
  readonly instanceKey: string | null;
  /** Expanded component uid to the uid that component carries in its own file. */
  readonly componentSourceUids: ReadonlyMap<string, string>;
}

/**
 * One expanded `instance` entry.
 *
 * @internal
 */
export interface ExpandedInstance {
  /** The key {@link ExpandedEntity.instanceKey} refers to. */
  readonly key: string;
  /** The address of the instanced scene. */
  readonly address: string;
  /** The handle the scene asset was resolved through, when one exists. */
  readonly asset: AssetHandle<SceneAsset> | null;
  /** The instanced scene itself, so the serializer can diff current state against it. */
  readonly scene: SceneAsset;
  /** The expanded uid of the entity carrying the entry, or `null` when the builder decides. */
  readonly rootUid: string | null;
}

/**
 * A whole expanded scene.
 *
 * @internal
 */
export interface ExpandedScene {
  /** Every entity, in tree order: parents before children, instanced children before file children. */
  readonly entities: readonly ExpandedEntity[];
  /** Every instance the expansion produced, in expansion order. */
  readonly instances: readonly ExpandedInstance[];
}

/**
 * How {@link expandScene} mints uids, reports problems, and treats hashes.
 *
 * @internal
 */
export interface ExpandOptions {
  /** Mints a fresh uid for an instanced copy. */
  readonly nextUid: () => string;
  /** Receives every recoverable problem; the loader turns these into log records. */
  readonly report: (code: string, message: string) => void;
  /** `true` turns an `IGX-0604` hash mismatch from a diagnostic into a throw. */
  readonly strictInstanceHashes?: boolean;
  /**
   * Treats the whole file as one instance — what `world.instantiate` does. The expansion then mints
   * fresh uids for every entity and every entity carries the resulting instance key.
   */
  readonly asInstance?: boolean;
}

/**
 * Expands a scene into the flat entity list the builder creates objects from.
 *
 * @param asset - The scene to expand.
 * @param options - Uid minting, diagnostics, and the hash policy.
 * @returns The expanded entities in tree order and the instances they came from.
 * @throws IgnifxError with code `IGX-0302` when a scene instances itself, directly or through
 * another scene, and `IGX-0604` when `strictInstanceHashes` is set and a recorded hash does not
 * match the instanced scene.
 *
 * @internal
 */
export function expandScene(asset: SceneAsset, options: ExpandOptions): ExpandedScene {
  const entities: ExpandedEntity[] = [];
  const instances: ExpandedInstance[] = [];
  const state: ExpandState = { entities, instances, options, counter: 0 };
  if (options.asInstance === true) {
    const key = nextInstanceKey(state);
    instances.push({ key, address: asset.address, asset: null, scene: asset, rootUid: null });
    expandFile(asset, null, key, true, [asset.address], state);
    return { entities, instances };
  }
  expandFile(asset, null, null, false, [asset.address], state);
  return { entities, instances };
}

/** Everything the recursive expansion threads through. */
interface ExpandState {
  readonly entities: ExpandedEntity[];
  readonly instances: ExpandedInstance[];
  readonly options: ExpandOptions;
  counter: number;
}

/**
 * Expands one file's entities into the output list.
 *
 * @param asset - The scene being expanded.
 * @param parentUid - The expanded uid the file's roots attach to, or `null` for real roots.
 * @param instanceKey - The instance the entities belong to, or `null` for the outermost file.
 * @param freshUids - `true` mints a new uid per entity and component; `false` keeps the file's own.
 * @param chain - The addresses of the scenes currently being expanded, for the cycle check.
 * @param state - The accumulating output.
 * @returns The override targets produced, keyed by the uid each entity carries in `asset`'s own
 * file.
 */
function expandFile(
  asset: SceneAsset,
  parentUid: string | null,
  instanceKey: string | null,
  freshUids: boolean,
  chain: readonly string[],
  state: ExpandState,
): Map<string, OverrideTarget> {
  const source = asset.file.entities;
  const keys = new Map<string, string>();
  if (freshUids) {
    for (let index = 0; index < source.length; index += 1) {
      const entity = source[index];
      if (entity === undefined) {
        continue;
      }
      keys.set(entity.uid, state.options.nextUid());
      const components = entity.components ?? [];
      for (let inner = 0; inner < components.length; inner += 1) {
        const component = components[inner];
        if (component !== undefined) {
          keys.set(component.uid, state.options.nextUid());
        }
      }
    }
  }
  const produced = new Map<string, OverrideTarget>();
  for (let index = 0; index < source.length; index += 1) {
    const entity = source[index];
    if (entity === undefined) {
      continue;
    }
    const uid = keys.get(entity.uid) ?? entity.uid;
    const componentSourceUids = new Map<string, string>();
    const data: MutableSceneEntity = {
      uid,
      name: entity.name,
      parent: entity.parent === null ? parentUid : (keys.get(entity.parent) ?? entity.parent),
      ...(entity.active === undefined ? {} : { active: entity.active }),
      ...(entity.static === undefined ? {} : { static: entity.static }),
      ...(entity.layer === undefined ? {} : { layer: entity.layer }),
      ...(entity.tags === undefined ? {} : { tags: [...entity.tags] }),
      transform: {
        position: [...entity.transform.position],
        rotation: [...entity.transform.rotation],
        scale: [...entity.transform.scale],
      },
      components: cloneComponents(entity, keys, componentSourceUids),
    };
    produced.set(entity.uid, { data, components: reverse(componentSourceUids) });
    state.entities.push({ data, sourceUid: entity.uid, instanceKey, componentSourceUids });
    const nested = entity.instance;
    if (nested !== undefined) {
      expandInstance(asset, nested, uid, chain, state);
    }
  }
  return produced;
}

/**
 * Expands one `instance` entry under the entity that carries it.
 *
 * @param asset - The scene the entry was declared in, whose dependencies resolve the reference.
 * @param instance - The entry.
 * @param rootUid - The expanded uid of the entity carrying it.
 * @param chain - The addresses currently being expanded.
 * @param state - The accumulating output.
 */
function expandInstance(
  asset: SceneAsset,
  instance: NonNullable<SceneFileEntity["instance"]>,
  rootUid: string,
  chain: readonly string[],
  state: ExpandState,
): void {
  const address = instance.scene.$asset;
  if (chain.includes(address)) {
    throw new IgnifxError(
      CoreErrorCode.sceneInstanceCycle,
      `Instantiating ${address} would nest the scene inside itself.`,
      {
        context: { scene: address, entity: rootUid, chain: chain.join(" > ") },
        hint: "A scene cannot instance itself, directly or through another scene.",
      },
    );
  }
  const resolved = findSceneDependency(asset, address);
  if (resolved === null) {
    state.options.report(
      CoreErrorCode.sceneNotLoaded,
      `The instanced scene ${address} is not among the dependencies of ${asset.address}.`,
    );
    return;
  }
  const recorded = instance.hash;
  if (recorded !== undefined && recorded !== resolved.value.hash) {
    reportHashMismatch(address, recorded, resolved.value.hash, state.options);
  }
  const key = nextInstanceKey(state);
  state.instances.push({ key, address, asset: resolved.handle, scene: resolved.value, rootUid });
  const produced = expandFile(resolved.value, rootUid, key, true, [...chain, address], state);
  const overrides = instance.overrides;
  if (overrides !== undefined && overrides.length > 0) {
    applyOverrides(overrides, produced, (message) => {
      state.options.report(CoreErrorCode.instanceHashMismatch, `${asset.address}: ${message}`);
    });
  }
}

/**
 * Reports, or throws, an `IGX-0604` hash mismatch.
 *
 * @param address - The instanced scene.
 * @param recorded - The hash the file recorded.
 * @param actual - The hash the loaded scene has.
 * @param options - The expansion options, for the policy and the reporter.
 */
function reportHashMismatch(address: string, recorded: string, actual: string, options: ExpandOptions): void {
  const message = `The overrides recorded for ${address} were saved against ${recorded}, but the scene now hashes to ${actual}.`;
  if (options.strictInstanceHashes === true) {
    throw new IgnifxError(CoreErrorCode.instanceHashMismatch, message, {
      context: { scene: address, recorded, actual },
      hint: "Re-save the scene that instances it, or clear strictInstanceHashes to load anyway.",
    });
  }
  options.report(CoreErrorCode.instanceHashMismatch, message);
}

/**
 * Mints the next instance key.
 *
 * @param state - The expansion state.
 * @returns A key unique within this expansion.
 */
function nextInstanceKey(state: ExpandState): string {
  state.counter += 1;
  return `i${String(state.counter)}`;
}

/**
 * Clones an entity's components, remapping uids and the `$entity`/`$component` references inside
 * their props.
 *
 * @param entity - The source entity.
 * @param keys - Source uid to expanded uid; empty when the file's own uids are kept.
 * @param sourceUids - Filled with expanded component uid to source component uid.
 * @returns The cloned component list.
 */
function cloneComponents(
  entity: SceneFileEntity,
  keys: ReadonlyMap<string, string>,
  sourceUids: Map<string, string>,
): SceneFileComponent[] {
  const source = entity.components ?? [];
  const cloned: SceneFileComponent[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const component = source[index];
    if (component === undefined) {
      continue;
    }
    const uid = keys.get(component.uid) ?? component.uid;
    sourceUids.set(uid, component.uid);
    const props = component.props;
    cloned.push({
      ...component,
      uid,
      ...(props === undefined ? {} : { props: remapReferences(props, keys) }),
    });
  }
  return cloned;
}

/**
 * Rewrites every `{ "$entity": … }` and `{ "$component": … }` inside a props object so that a
 * reference declared in a prefab points at *this* copy of it.
 *
 * @param props - The props object.
 * @param keys - Source uid to expanded uid; an empty map returns the object unchanged.
 * @returns The rewritten props, with key order preserved.
 */
function remapReferences(props: JsonObject, keys: ReadonlyMap<string, string>): JsonObject {
  if (keys.size === 0) {
    return props;
  }
  return asJsonObject(remapValue(props, keys)) ?? props;
}

/**
 * The recursive half of {@link remapReferences}.
 *
 * @param value - The JSON to rewrite.
 * @param keys - Source uid to expanded uid.
 * @returns The rewritten JSON.
 */
function remapValue(value: JsonValue, keys: ReadonlyMap<string, string>): JsonValue {
  const source = asJsonArray(value);
  if (source !== null) {
    const items: JsonValue[] = [];
    for (let index = 0; index < source.length; index += 1) {
      items.push(remapValue(source[index] ?? null, keys));
    }
    return items;
  }
  const object = asJsonObject(value);
  if (object === null) {
    return value;
  }
  const rewritten: Record<string, JsonValue> = {};
  for (const key of Object.keys(object)) {
    const entry = object[key] ?? null;
    if ((key === "$entity" || key === "$component") && typeof entry === "string") {
      rewritten[key] = keys.get(entry) ?? entry;
      continue;
    }
    rewritten[key] = remapValue(entry, keys);
  }
  return rewritten;
}

/**
 * Inverts the expanded-to-source component uid map, so an override path — which names source
 * uids — can find this copy's component.
 *
 * @param sourceUids - Expanded component uid to source component uid.
 * @returns Source component uid to expanded component uid.
 */
function reverse(sourceUids: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const inverted = new Map<string, string>();
  for (const [expanded, source] of sourceUids) {
    inverted.set(source, expanded);
  }
  return inverted;
}

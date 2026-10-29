/**
 * The open scene document's live mirror: the scene instance the editor's file is built into, the
 * scene settings the host keeps for it, and the lookups every scene method shares. Only the
 * document's own entities and components are reachable through it: an instanced scene's members and
 * the editor's objects never are (protocol 0.3, "Document uids only").
 */

import {
  canonicalizeNumber,
  CoreErrorCode,
  decodeProps,
  parseOverridePath,
  SCENE_ASSET_TYPE,
  serializeScene,
} from "@ignifx/core";
import { countEntities } from "../play-stats.js";
import type { OpenSceneResult, ReadBackParams, ReadBackResult, SceneIssue } from "../protocol/index.js";
import type {
  App,
  AssetHandle,
  Component,
  Entity,
  JsonObject,
  JsonValue,
  ReferenceDecoder,
  SceneAsset,
  SceneFile,
  SceneFileComponent,
  SceneFileEntity,
  SceneFileInstance,
  SceneFileOverride,
  SceneInstance,
  UidRemap,
} from "@ignifx/core";

/** Where a document that was never saved is published in the asset cache. */
export const UNSAVED_SCENE_ADDRESS = "memory:scene/unsaved";

/** The document as the live world holds it now, written by `serializeScene`. */
export interface DocumentIndex {
  /** The serialized document, with `engineVersion` omitted. */
  readonly file: SceneFile;
  /** What the serializer reported. */
  readonly issues: readonly SceneIssue[];
  /** Each document entity, by uid. */
  readonly entities: ReadonlyMap<string, Entity>;
  /** Each document entity's record, by uid. */
  readonly records: ReadonlyMap<string, SceneFileEntity>;
  /** Each document component, by uid. */
  readonly components: ReadonlyMap<string, Component>;
  /**
   * Each component an instance root's `add` override gives a member, by uid: not a document
   * component (no op edits it), but a reference in the document may name it, as one in a file may.
   */
  readonly added: ReadonlyMap<string, Component>;
}

/**
 * Copies a JSON value, so the host's settings never share an object with the editor's message.
 *
 * @param value - The value.
 * @returns A deep copy.
 */
export function copyJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

/**
 * Assigns a component's props decoded from JSON, the way the scene loader does: every schema field
 * the JSON leaves out takes its default.
 *
 * @param component - The component.
 * @param props - The `props` object.
 * @param references - How references resolve.
 * @param only - The fields to assign, if not every one; only their problems are returned.
 * @returns The decoding problems, as `{ code, message }`.
 */
export function assignProps(
  component: Component,
  props: JsonObject,
  references: ReferenceDecoder,
  only?: ReadonlySet<string>,
): SceneIssue[] {
  const decoded = decodeComponentProps(component, props, references, only);
  for (const [name, value] of decoded.values) {
    Reflect.set(component, name, value);
  }
  return decoded.issues;
}

/**
 * The problems {@link assignProps} would return, without assigning anything.
 *
 * @param component - The component.
 * @param props - The `props` object.
 * @param references - How references resolve.
 * @param only - The fields to decode, if not every one.
 * @returns The decoding problems, as `{ code, message }`.
 */
export function propIssues(
  component: Component,
  props: JsonObject,
  references: ReferenceDecoder,
  only?: ReadonlySet<string>,
): SceneIssue[] {
  return decodeComponentProps(component, props, references, only).issues;
}

/**
 * Decodes a component's props from JSON, every schema field the JSON leaves out taking its default.
 *
 * @param component - The component.
 * @param props - The `props` object.
 * @param references - How references resolve.
 * @param only - The fields to keep, if not every one.
 * @returns The kept fields' values, and their problems as `{ code, message }`.
 */
function decodeComponentProps(
  component: Component,
  props: JsonObject,
  references: ReferenceDecoder,
  only: ReadonlySet<string> | undefined,
): { readonly values: ReadonlyMap<string, unknown>; readonly issues: SceneIssue[] } {
  const schema = component.world.registry.describe(component.constructor).schema;
  if (schema === null) {
    return { values: new Map(), issues: [] };
  }
  const decoded = decodeProps(schema, props, references);
  const all = new Map<string, unknown>(Object.entries(decoded.value));
  const values = new Map<string, unknown>();
  for (const name of Object.keys(schema)) {
    if (only === undefined || only.has(name)) {
      values.set(name, all.get(name));
    }
  }
  // An issue's path starts with its field's name, then `.` or `[` for a deeper step.
  const issues = decoded.issues
    .filter((issue) => only === undefined || only.has(issue.path.split(/[.[]/u, 1)[0] ?? ""))
    .map((issue) => ({ code: issue.code, message: `${component.uid}.${issue.path}: ${issue.message}` }));
  return { values, issues };
}

/**
 * Tells a component that the host changed some of its fields, through its `onValidate` hook
 * (`ComponentHooks`), so one that builds something from them (a physics body) rebuilds it.
 *
 * @param component - The component.
 * @param fields - The fields that changed; nothing is called when the list is empty.
 */
export function validateFields(component: Component, fields: readonly string[]): void {
  const hook: unknown = Reflect.get(component, "onValidate");
  if (fields.length > 0 && typeof hook === "function") {
    Reflect.apply(hook, component, [fields]);
  }
}

/**
 * An override in the form the scene file writes it, which editor-core's document holds: an op
 * sent as `{ op: "replace" }` or a transform value with more than six decimals still reads back
 * as the document has it.
 *
 * @param override - The override as an op or a file carried it.
 * @returns The canonical override.
 */
function canonicalOverride(override: SceneFileOverride): SceneFileOverride {
  const op = override.op ?? "replace";
  const value = op === "remove" ? undefined : canonicalOverrideValue(override.path, override.value);
  return {
    ...(op === "replace" ? {} : { op }),
    path: override.path,
    ...(value === undefined ? {} : { value }),
  };
}

/**
 * A transform override's value with each number canonical; any other value as it is.
 *
 * @param path - The override's path.
 * @param value - Its value.
 * @returns The value to keep.
 */
function canonicalOverrideValue(path: string, value: JsonValue | undefined): JsonValue | undefined {
  const list: unknown = value;
  if (!Array.isArray(list) || !isTransformPath(path)) {
    return value;
  }
  const items: readonly unknown[] = list;
  const numbers: number[] = [];
  for (const item of items) {
    if (typeof item !== "number") {
      return value;
    }
    numbers.push(canonicalizeNumber(item));
  }
  return numbers;
}

/**
 * Whether an override path names a transform field.
 *
 * @param path - The path.
 * @returns `false` too for a path the engine's grammar refuses.
 */
function isTransformPath(path: string): boolean {
  try {
    return parseOverridePath(path).kind === "transform";
  } catch {
    return false;
  }
}

/** The live mirror of the editor's open scene document. */
export class DocumentMirror {
  readonly #app: App;

  #scene: SceneInstance | null = null;

  #address: string | null = null;

  #name = "";

  #settings: JsonObject | null = null;

  #index: DocumentIndex | null = null;

  /**
   * The fields each document component's record sets, by component uid: the keys of its `props` as
   * the file and the ops since have written them. A field left out takes the schema's default.
   */
  readonly #explicit = new Map<string, Set<string>>();

  /**
   * Each instance root's override list as the document holds it, by root uid. The serializer
   * recomputes overrides by diffing the live members with their scene, which after a hot reload
   * that changed a default reads every stale member value as an override.
   */
  readonly #overrides = new Map<string, readonly SceneFileOverride[]>();

  /**
   * Each instance root's overrides as the serializer read them right after the host built the root,
   * as JSON text, by root uid. While the serializer still reads the same, the members are as the
   * document's list built them, and `readBack` writes that list.
   */
  readonly #builtAs = new Map<string, string>();

  /** Assets loaded for ops, held until the document closes. */
  readonly #handles: AssetHandle[] = [];

  /**
   * Creates the mirror for one app.
   *
   * @param app - The scene view's app.
   */
  constructor(app: App) {
    this.#app = app;
  }

  /**
   * The open document's scene instance.
   *
   * @returns The instance, or `null` while no document is open.
   */
  get scene(): SceneInstance | null {
    return this.#scene;
  }

  /**
   * The address the open document was given, or `null` for one never saved.
   *
   * @returns The address.
   */
  get address(): string | null {
    return this.#address;
  }

  /**
   * The open document's file name.
   *
   * @returns The name, or `""` while no document is open.
   */
  get name(): string {
    return this.#name;
  }

  /**
   * The document's `settings`, as the host keeps them. `readBack` writes these, because ops edit
   * them; systems that read scene settings read them once, when a scene opens.
   *
   * @returns The settings, or `null` when the document has none.
   */
  get settings(): JsonObject | null {
    return this.#settings;
  }

  // The accessor pair is documented on the getter only (API Extractor's `ae-setter-with-docs`).
  // eslint-disable-next-line jsdoc/require-jsdoc -- see the comment above
  set settings(value: JsonObject | null) {
    this.#settings = value;
    this.#index = null;
  }

  /**
   * Replaces the open document with a file: unloads the previous one, then builds this one into a
   * new scene instance with the file's uids, loading its assets.
   *
   * @param file - The document's file, already validated.
   * @param address - Where it is saved, or `null`.
   * @returns The entity count and the build's warnings.
   * @throws Whatever `world.loadSceneFile` throws; no document is open afterwards.
   */
  async open(file: SceneFile, address: string | null): Promise<OpenSceneResult> {
    await this.close();
    const where = address ?? UNSAVED_SCENE_ADDRESS;
    const warnings: SceneIssue[] = [];
    const held = await this.#loadDoubledScenes(file.entities);
    let scene: SceneInstance;
    let entities: SceneFileEntity[];
    try {
      entities = withoutDoubleAdds(this.#app, file.entities, where, warnings);
      scene = await this.#app.world.loadSceneFile(
        { ...file, entities },
        {
          address: where,
          onIssue: (issue) => {
            warnings.push({ code: issue.code, message: issue.message });
          },
        },
      );
    } finally {
      for (const handle of held) {
        handle.release();
      }
    }
    this.#scene = scene;
    this.#address = address;
    this.#name = file.name;
    this.#settings = file.settings === undefined ? null : copyJson(file.settings);
    this.recordComponents(entities.flatMap((record) => record.components ?? []));
    this.recordInstances(entities);
    // That index was read before the first frame; the next lookup reads the world again.
    this.invalidate();
    return { entityCount: countEntities(scene), warnings };
  }

  /**
   * Loads the scenes of the instance roots whose records may hold the old double form of an added
   * component, so {@link withoutDoubleAdds} can tell where each scene's root is.
   *
   * @param records - The file's entity records.
   * @returns The handles, each with one holder the caller releases.
   */
  async #loadDoubledScenes(records: readonly SceneFileEntity[]): Promise<AssetHandle[]> {
    const handles: AssetHandle[] = [];
    for (const record of records) {
      const instance = record.instance;
      const own = new Set((record.components ?? []).map((component) => component.uid));
      const adds = (instance?.overrides ?? []).flatMap((override) => addedUids(override));
      if (instance === undefined || !adds.some((uid) => own.has(uid))) {
        continue;
      }
      handles.push(
        this.#app.assets.load<SceneAsset>(instance.scene.$asset, { type: instance.scene.type ?? SCENE_ASSET_TYPE }),
      );
    }
    // A load that fails is the build's to report, as it loads the scene again.
    await Promise.allSettled(handles.map(async (handle) => handle.promise));
    return handles;
  }

  /** Unloads the open document, if any, and releases the assets its ops loaded. */
  async close(): Promise<void> {
    const scene = this.#scene;
    this.#scene = null;
    this.#address = null;
    this.#name = "";
    this.#settings = null;
    this.#index = null;
    this.#explicit.clear();
    this.#overrides.clear();
    this.#builtAs.clear();
    if (scene !== null) {
      await this.#app.world.unloadScene(scene);
    }
    for (const handle of this.#handles.splice(0)) {
      handle.release();
    }
  }

  /**
   * Keeps asset handles alive until the document closes.
   *
   * @param handles - Handles loaded for an op, each with one holder the mirror now owns.
   */
  retain(handles: readonly AssetHandle[]): void {
    this.#handles.push(...handles);
  }

  /**
   * Records which fields document components' records set, replacing what was known of each uid.
   *
   * @param components - The component records, as a file or an op carries them.
   */
  recordComponents(components: readonly SceneFileComponent[]): void {
    for (const component of components) {
      this.recordProps(component.uid, Object.keys(component.props ?? {}));
    }
  }

  /**
   * Records the whole set of fields a component's record sets.
   *
   * @param uid - The component's uid.
   * @param fields - The fields.
   */
  recordProps(uid: string, fields: Iterable<string>): void {
    this.#explicit.set(uid, new Set(fields));
  }

  /**
   * Records that a component's record now sets a field, or leaves it out.
   *
   * @param uid - The component's uid.
   * @param field - The field.
   * @param isSet - Whether the record sets it.
   */
  recordProp(uid: string, field: string, isSet: boolean): void {
    let fields = this.#explicit.get(uid);
    if (fields === undefined) {
      fields = new Set();
      this.#explicit.set(uid, fields);
    }
    if (isSet) {
      fields.add(field);
    } else {
      fields.delete(field);
    }
  }

  /**
   * The fields a document component's record sets.
   *
   * @param uid - The component's uid.
   * @returns The field names, or `null` when the mirror has no record of the component.
   */
  propsSetBy(uid: string): ReadonlySet<string> | null {
    return this.#explicit.get(uid) ?? null;
  }

  /**
   * Records the override lists of the instance roots among some entity records the host has just
   * built, and what the serializer reads from those roots now, before anything else can change
   * their members.
   *
   * @param records - The records, as a file or an op carries them.
   */
  recordInstances(records: readonly SceneFileEntity[]): void {
    const roots = records.filter((record) => record.instance !== undefined);
    for (const record of roots) {
      this.recordOverrides(record.uid, record.instance?.overrides ?? []);
    }
    if (roots.length === 0) {
      return;
    }
    this.#index = null;
    const index = this.index();
    for (const record of roots) {
      const read = index?.records.get(record.uid)?.instance;
      if (read === undefined) {
        this.#builtAs.delete(record.uid);
      } else {
        this.#builtAs.set(record.uid, JSON.stringify(read.overrides ?? []));
      }
    }
  }

  /**
   * Records an instance root's override list, each override in the form the scene file writes and
   * editor-core's document holds: no `op` for a `replace`, no value for a `remove`, and a
   * transform's numbers canonical.
   *
   * @param uid - The root's uid.
   * @param overrides - The list.
   */
  recordOverrides(uid: string, overrides: readonly SceneFileOverride[]): void {
    // A copy, so the list never shares an object with the editor's message.
    this.#overrides.set(uid, structuredClone(overrides).map(canonicalOverride));
  }

  /**
   * An instance root's override list as the document holds it.
   *
   * @param uid - The root's uid.
   * @returns The list, or `null` when the mirror has no record of the root.
   */
  overridesOf(uid: string): readonly SceneFileOverride[] | null {
    return this.#overrides.get(uid) ?? null;
  }

  /** Forgets the cached index; call it after anything changed the document's structure. */
  invalidate(): void {
    this.#index = null;
  }

  /**
   * The document as the live world holds it, serialized once and cached until an op, `open` or
   * `readBack` drops it; the next call serializes the world again. Every lookup (selection, picks,
   * the ops' references) reads this cache, so a lookup after a `readBack` sees the world as that
   * `readBack` did.
   *
   * @returns The index, or `null` while no document is open.
   */
  index(): DocumentIndex | null {
    const scene = this.#scene;
    if (scene === null) {
      return null;
    }
    this.#index ??= this.#buildIndex(scene);
    return this.#index;
  }

  /**
   * Serializes the requested entities as the live world has them (protocol `readBack`).
   *
   * @remarks
   * The world is serialized again on every call, not read from the cache, because a `"run"`
   * system or a `runInEditMode` script can change it outside an op.
   *
   * An instance root's overrides are the list the document holds, in its order, while the
   * serializer still reads its members as they were built from that list. The serializer's own
   * list is a diff in file order that writes an added component whole and leaves out an override
   * equal to the instanced scene's value, so it never equals the document's; it is written instead
   * once the members read differently, so a change the document did not make still shows.
   *
   * @param params - The uids to read, or none for all.
   * @returns The records in file order, the uids not found, the settings, and the serializer's issues.
   */
  readBack(params: ReadBackParams): ReadBackResult | null {
    this.invalidate();
    const index = this.index();
    if (index === null) {
      return null;
    }
    const requested = params.entities;
    const wanted = requested === undefined ? null : new Set(requested);
    return {
      entities: index.file.entities
        .filter((record) => wanted === null || wanted.has(record.uid))
        .map((record) => this.#withDocumentOverrides(record)),
      missing: requested === undefined ? [] : [...new Set(requested)].filter((uid) => !index.records.has(uid)),
      settings: index.file.settings ?? null,
      issues: index.issues,
    };
  }

  /**
   * The nearest document entity at or above an entity: itself, or the instance root it was
   * expanded from (protocol 0.3, "Document uids only").
   *
   * @param entity - Any entity.
   * @returns The document entity, or `null` when the entity is not in the document.
   */
  documentEntityOf(entity: Entity | null): Entity | null {
    const index = this.index();
    if (index === null || entity === null || entity.scene !== this.#scene) {
      return null;
    }
    for (let current: Entity | null = entity; current !== null; current = current.parent) {
      if (index.entities.get(current.uid) === current) {
        return current;
      }
    }
    return null;
  }

  /**
   * How references in props resolve: document uids first, then the uids of a subtree just built,
   * then the components instances' `add` overrides gave their members, as a reopen resolves them;
   * and assets already loaded in the app's cache.
   *
   * @param built - The uid table of a subtree an op just built, if any.
   * @returns The decoder.
   */
  decoder(built?: UidRemap): ReferenceDecoder {
    const index = this.index();
    const assets = this.#app.assets;
    return {
      entity: (uid: string): Entity | null => index?.entities.get(uid) ?? built?.entity(uid) ?? null,
      component: (uid: string): Component | null =>
        index?.components.get(uid) ?? built?.component(uid) ?? index?.added.get(uid) ?? null,
      asset: (address: string, type: string | null): AssetHandle | null => {
        const handle = assets.get(address);
        return handle !== null && handle.state === "loaded" && (type === null || handle.type === type) ? handle : null;
      },
    };
  }

  /**
   * An entity's record with the document's override list, when it is an instance root whose
   * members still read as they were built from that list.
   *
   * @param record - The record as the serializer wrote it.
   * @returns The record to read back.
   */
  #withDocumentOverrides(record: SceneFileEntity): SceneFileEntity {
    const read = record.instance;
    const listed = this.#overrides.get(record.uid);
    const built = this.#builtAs.get(record.uid);
    if (read === undefined || listed === undefined || JSON.stringify(read.overrides ?? []) !== built) {
      return record;
    }
    const instance: SceneFileInstance = {
      scene: read.scene,
      ...(read.hash === undefined ? {} : { hash: read.hash }),
      ...(listed.length === 0 ? {} : { overrides: structuredClone(listed) }),
    };
    return withOverrideList(this.#app, record, instance);
  }

  /**
   * Serializes the document and indexes its entities and components.
   *
   * @param scene - The document's scene instance.
   * @returns The index.
   */
  #buildIndex(scene: SceneInstance): DocumentIndex {
    const issues: SceneIssue[] = [];
    const file = serializeScene(scene, {
      engineVersion: null,
      settings: this.#settings,
      onIssue: (issue) => {
        issues.push({ code: issue.code, message: issue.message });
      },
    });
    const world = this.#app.world;
    const entities = new Map<string, Entity>();
    const records = new Map<string, SceneFileEntity>();
    const components = new Map<string, Component>();
    const added = new Map<string, Component>();
    for (const record of file.entities) {
      const entity = world.getEntity(record.uid);
      if (entity === null) {
        continue;
      }
      entities.set(record.uid, entity);
      records.set(record.uid, record);
      const uids = new Set((record.components ?? []).map((component) => component.uid));
      for (const component of entity.components) {
        if (uids.has(component.uid) && !component.isDestroyed) {
          components.set(component.uid, component);
        }
      }
      const adds = new Set((record.instance?.overrides ?? []).flatMap((override) => addedUids(override)));
      if (adds.size > 0) {
        collectComponents(entity, adds, added);
      }
    }
    return { file, issues, entities, records, components, added };
  }
}

/**
 * A file's entity records without the old double form of an added component: before `readBack`
 * wrote each `add` override once, it also wrote one that adds to the root of a one-root scene as
 * the root's own component, with the same uid, so a reopen built it twice. Each is kept once, as the
 * override list adds it, so `readBack` reads the same from the first frame. Only an `add` to the
 * root's component list counts: one on another member that reuses a uid of the root's own
 * components is not the old form, so both are built, with a warning of its own.
 *
 * @param app - The scene view's app, whose cache holds the instanced scenes.
 * @param records - The file's entity records.
 * @param address - The document's address, for the warnings.
 * @param warnings - Gets one `IGX-0608` warning when a record had the double form, and one when a
 * record's list adds to a member with a uid of the root's own components.
 * @returns The records, each collapsed one replaced.
 */
function withoutDoubleAdds(
  app: App,
  records: readonly SceneFileEntity[],
  address: string,
  warnings: SceneIssue[],
): SceneFileEntity[] {
  const doubled: string[] = [];
  const reused: string[] = [];
  const collapsed = records.map((record) => {
    const instance = record.instance;
    if (instance === undefined || record.components === undefined) {
      return record;
    }
    const single = withOverrideList(app, record, instance);
    const kept = new Set((single.components ?? []).map((component) => component.uid));
    const adds = new Set((instance.overrides ?? []).flatMap((override) => addedUids(override)));
    for (const component of record.components) {
      if (!kept.has(component.uid)) {
        doubled.push(`${record.uid}/${component.uid}`);
      } else if (adds.has(component.uid)) {
        reused.push(`${record.uid}/${component.uid}`);
      }
    }
    return single;
  });
  if (reused.length > 0) {
    warnings.push({
      code: CoreErrorCode.sceneFileInvalid,
      message:
        `${address}: ${reused.join(", ")}: each of these uids names both an instance root's own component and ` +
        "one an add override in its list gives a member; both are built.",
    });
  }
  if (doubled.length > 0) {
    warnings.push({
      code: CoreErrorCode.sceneFileInvalid,
      message:
        `${address}: ${doubled.join(", ")}: an older editor wrote each of these components both as an ` +
        "instance root's own and in its override list, with one uid; each is kept once, as the list adds it.",
    });
  }
  return collapsed;
}

/**
 * An instance root's record with an instance entry whose override list replaces the serializer's.
 * The serializer writes a component that an `add` override gives the root of a one-root scene as
 * the root's own, so the record leaves out each component the list adds there; a rebuild or a
 * reopen would otherwise add it twice.
 *
 * @param app - The scene view's app, whose cache holds the instanced scene.
 * @param record - The record as the serializer wrote it.
 * @param instance - The instance entry, with the document's list.
 * @returns The record.
 */
export function withOverrideList(app: App, record: SceneFileEntity, instance: SceneFileInstance): SceneFileEntity {
  const path = rootComponentsPath(app, instance);
  const adds = new Set(
    (instance.overrides ?? []).filter((override) => override.path === path).flatMap((override) => addedUids(override)),
  );
  const own = record.components ?? [];
  const components = own.filter((component) => !adds.has(component.uid));
  if (components.length === own.length) {
    return { ...record, instance };
  }
  const { components: _written, ...rest } = record;
  return { ...rest, instance, ...(components.length === 0 ? {} : { components }) };
}

/**
 * The override path of the component list of an instanced scene's root, when the scene has one
 * root: the members an `add` there joins are the instance root's own.
 *
 * @param app - The scene view's app.
 * @param instance - The instance entry.
 * @returns `<root uid>/components`, or `null` for a scene with several roots or none, or one the
 * cache does not hold loaded as a scene.
 */
function rootComponentsPath(app: App, instance: SceneFileInstance): string | null {
  const handle = app.assets.get<SceneAsset>(instance.scene.$asset);
  if (handle === null || handle.state !== "loaded" || handle.type !== SCENE_ASSET_TYPE) {
    return null;
  }
  const roots = handle.value.file.entities.filter((entity) => entity.parent === null);
  const root = roots.length === 1 ? roots[0] : undefined;
  return root === undefined ? null : `${root.uid}/components`;
}

/**
 * The uid of the component an `add` override of a component list adds, as a list.
 *
 * @param override - The override.
 * @returns The uid, or nothing.
 */
function addedUids(override: SceneFileOverride): string[] {
  const value = override.value;
  const uid: unknown =
    override.op === "add" && typeof value === "object" && value !== null ? Reflect.get(value, "uid") : null;
  return typeof uid === "string" ? [uid] : [];
}

/**
 * Finds the live components with some uids in a subtree.
 *
 * @param entity - The subtree's root.
 * @param uids - The uids.
 * @param into - Filled with each one found, by uid.
 */
function collectComponents(entity: Entity, uids: ReadonlySet<string>, into: Map<string, Component>): void {
  for (const component of entity.components) {
    if (uids.has(component.uid) && !component.isDestroyed) {
      into.set(component.uid, component);
    }
  }
  for (const child of entity.children) {
    collectComponents(child, uids, into);
  }
}

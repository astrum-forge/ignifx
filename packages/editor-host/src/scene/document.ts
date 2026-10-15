/**
 * The open scene document's live mirror: the scene instance the editor's file is built into, the
 * scene settings the host keeps for it, and the lookups every scene method shares. Only the
 * document's own entities and components are reachable through it: an instanced scene's members and
 * the editor's objects never are (protocol 0.3, "Document uids only").
 */

import { decodeProps, serializeScene } from "@ignifx/core";
import type { OpenSceneResult, ReadBackParams, ReadBackResult, SceneIssue } from "../protocol/index.js";
import type {
  App,
  AssetHandle,
  Component,
  Entity,
  JsonObject,
  JsonValue,
  ReferenceDecoder,
  SceneFile,
  SceneFileEntity,
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
}

/**
 * Counts the entities of a scene instance, members of instanced scenes included.
 *
 * @param scene - The instance.
 * @returns How many entities it holds.
 */
function countEntities(scene: SceneInstance): number {
  let count = 0;
  const pending: Entity[] = [...scene.roots];
  for (let entity = pending.pop(); entity !== undefined; entity = pending.pop()) {
    if (!entity.isDestroyed) {
      count += 1;
      pending.push(...entity.children);
    }
  }
  return count;
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
 * @returns The decoding problems, as `{ code, message }`.
 */
export function assignProps(component: Component, props: JsonObject, references: ReferenceDecoder): SceneIssue[] {
  const schema = component.world.registry.describe(component.constructor).schema;
  if (schema === null) {
    return [];
  }
  const decoded = decodeProps(schema, props, references);
  const values = new Map<string, unknown>(Object.entries(decoded.value));
  for (const name of Object.keys(schema)) {
    Reflect.set(component, name, values.get(name));
  }
  return decoded.issues.map((issue) => ({
    code: issue.code,
    message: `${component.uid}.${issue.path}: ${issue.message}`,
  }));
}

/** The live mirror of the editor's open scene document. */
export class DocumentMirror {
  readonly #app: App;

  #scene: SceneInstance | null = null;

  #address: string | null = null;

  #name = "";

  #settings: JsonObject | null = null;

  #index: DocumentIndex | null = null;

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
    const warnings: SceneIssue[] = [];
    const scene = await this.#app.world.loadSceneFile(file, {
      address: address ?? UNSAVED_SCENE_ADDRESS,
      onIssue: (issue) => {
        warnings.push({ code: issue.code, message: issue.message });
      },
    });
    this.#scene = scene;
    this.#address = address;
    this.#name = file.name;
    this.#settings = file.settings === undefined ? null : copyJson(file.settings);
    return { entityCount: countEntities(scene), warnings };
  }

  /** Unloads the open document, if any, and releases the assets its ops loaded. */
  async close(): Promise<void> {
    const scene = this.#scene;
    this.#scene = null;
    this.#address = null;
    this.#name = "";
    this.#settings = null;
    this.#index = null;
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

  /** Forgets the cached index; call it after anything changed the document's structure. */
  invalidate(): void {
    this.#index = null;
  }

  /**
   * The document as the live world holds it, serialized once and cached until the next change.
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
   * @param params - The uids to read, or none for all.
   * @returns The records in file order, the uids not found, the settings, and the serializer's issues.
   */
  readBack(params: ReadBackParams): ReadBackResult | null {
    const index = this.index();
    if (index === null) {
      return null;
    }
    const requested = params.entities;
    const wanted = requested === undefined ? null : new Set(requested);
    return {
      entities: index.file.entities.filter((record) => wanted === null || wanted.has(record.uid)),
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
      component: (uid: string): Component | null => index?.components.get(uid) ?? built?.component(uid) ?? null,
      asset: (address: string, type: string | null): AssetHandle | null => {
        const handle = assets.get(address);
        return handle !== null && handle.state === "loaded" && (type === null || handle.type === type) ? handle : null;
      },
    };
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
    }
    return { file, issues, entities, records, components };
  }
}

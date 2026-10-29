/**
 * Defaults that a script's hot reload changes (engine ask E25): which fields of which component
 * types took a new default, and the live world brought in line with the document for them. A field
 * a document component's record leaves out takes the new default; a field it sets keeps its value;
 * a prefab instance whose members hold such a field is rebuilt from its prefab, with its overrides
 * (`docs/architecture/17-editor-host.md` §6.1).
 */

import { encodeProps } from "@ignifx/core";
import { validateFields } from "./document.js";
import type { DocumentIndex, DocumentMirror } from "./document.js";
import type { App, Component, ComponentType, Entity, ReferenceEncoder } from "@ignifx/core";

/** The fields whose default changed, by component type id. */
export type ChangedDefaults = ReadonlyMap<string, readonly string[]>;

/** Each field's default as JSON text, by field name. */
type FieldDefaults = ReadonlyMap<string, string>;

/** Defaults hold no reference to anything in a file. */
const NO_REFERENCES: ReferenceEncoder = {
  entityUid: (): null => null,
  componentUid: (): null => null,
};

/**
 * Reads a component type's field defaults as the file format writes them; `transient` fields,
 * which no file holds, are left out.
 *
 * @param app - The scene view's app.
 * @param type - The registered type.
 * @returns The defaults, or `null` for a type without a schema.
 */
function defaultsOf(app: App, type: ComponentType): FieldDefaults | null {
  const schema = app.world.registry.describe(type).schema;
  if (schema === null) {
    return null;
  }
  const encoded = encodeProps(schema, {}, NO_REFERENCES);
  return new Map(Object.entries(encoded).map(([name, value]) => [name, JSON.stringify(value)]));
}

/** The field defaults of every registered type, as the host last saw them. */
export class DefaultsTracker {
  readonly #app: App;

  readonly #known = new Map<string, FieldDefaults | null>();

  /**
   * Reads the defaults of every type registered now.
   *
   * @param app - The scene view's app, started.
   */
  constructor(app: App) {
    this.#app = app;
    for (const [typeId, type] of app.world.registry.registrations()) {
      this.#known.set(typeId, defaultsOf(app, type));
    }
  }

  /**
   * Compares the defaults of reloaded types with the ones seen before, and keeps the new ones.
   *
   * @param typeIds - The type ids a hot reload replaced; any other id is ignored.
   * @returns The fields whose default changed or which are new, by type id. A type seen for the
   * first time has no change: no document component was built from it.
   */
  changed(typeIds: readonly string[]): ChangedDefaults {
    const changed = new Map<string, readonly string[]>();
    const registry = this.#app.world.registry;
    for (const typeId of typeIds) {
      const type = registry.get(typeId);
      if (type === null) {
        continue;
      }
      const next = defaultsOf(this.#app, type);
      const previous = this.#known.get(typeId);
      this.#known.set(typeId, next);
      if (previous === undefined || next === null) {
        continue;
      }
      const fields = [...next].filter(([name, value]) => previous?.get(name) !== value).map(([name]) => name);
      if (fields.length > 0) {
        changed.set(typeId, fields);
      }
    }
    return changed;
  }
}

/**
 * The type id of a live component.
 *
 * @param app - The scene view's app.
 * @param component - The component.
 * @returns Its registered type id, or `null`.
 */
function typeIdOf(app: App, component: Component): string | null {
  return app.world.registry.describe(component.constructor).typeId;
}

/**
 * Gives every document component the new default of each changed field its record leaves out. A
 * component the mirror has no record of is left alone. A component whose setter or `onValidate`
 * throws is handed to `failed`, and the others still get their defaults.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @param index - Its index.
 * @param changed - The changed fields, by type id.
 * @param failed - Called with each component that threw, its type id, and what it threw.
 */
export function applyDefaults(
  app: App,
  mirror: DocumentMirror,
  index: DocumentIndex,
  changed: ChangedDefaults,
  failed: (component: Component, typeId: string, error: unknown) => void,
): void {
  for (const [uid, component] of index.components) {
    const typeId = typeIdOf(app, component) ?? "";
    const fields = changed.get(typeId);
    const set = mirror.propsSetBy(uid);
    const schema = app.world.registry.describe(component.constructor).schema;
    if (fields === undefined || set === null || schema === null) {
      continue;
    }
    const assigned: string[] = [];
    try {
      for (const name of fields) {
        const field = Object.hasOwn(schema, name) ? schema[name] : undefined;
        if (field !== undefined && !set.has(name)) {
          Reflect.set(component, name, field.createDefault());
          assigned.push(name);
        }
      }
      validateFields(component, assigned);
    } catch (error) {
      failed(component, typeId, error);
    }
  }
}

/**
 * The document's instance roots whose members (not the document's own components) include a
 * component of a changed type, in document order. A component the index lists but the mirror has
 * no record of is a member too: one an `add` override gives the root of a one-root prefab, which
 * the serializer writes as the root's own. So every component under a root either takes its new
 * defaults from {@link applyDefaults} or is rebuilt.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @param index - Its index.
 * @param changed - The changed fields, by type id.
 * @returns The roots' uids.
 */
export function instancesHolding(
  app: App,
  mirror: DocumentMirror,
  index: DocumentIndex,
  changed: ChangedDefaults,
): ReadonlySet<string> {
  const isMember = (component: Component): boolean =>
    !index.components.has(component.uid) || mirror.propsSetBy(component.uid) === null;
  const roots = new Set<string>();
  for (const record of index.file.entities) {
    const root = index.entities.get(record.uid);
    if (record.instance === undefined || root === undefined) {
      continue;
    }
    const pending: Entity[] = [root];
    for (let entity = pending.pop(); entity !== undefined; entity = pending.pop()) {
      const holds = entity.components.some(
        (component) => isMember(component) && changed.has(typeIdOf(app, component) ?? ""),
      );
      if (holds) {
        roots.add(record.uid);
        break;
      }
      pending.push(...entity.children);
    }
  }
  return roots;
}

/**
 * What instance members outside a subtree that is about to be rebuilt hold in it: the reference
 * fields another instance's overrides aimed at the subtree, read from the live world before the
 * subtree is destroyed, so the rebuild can point them at the new objects.
 */

import { encodeValue } from "@ignifx/core";
import { pointsInto, uidOf } from "./json.js";
import type { DocumentIndex, DocumentMirror } from "./document.js";
import type { App, Component, Entity, FieldDefinition, JsonObject, JsonValue } from "@ignifx/core";

/** What {@link heldByMembers} read from the live world before a subtree was destroyed. */
export interface HeldReferences {
  /** Each member component with a field that points into the subtree, and those fields as JSON. */
  readonly fields: ReadonlyMap<Component, JsonObject>;
  /** The entities those fields held, by uid. */
  readonly entities: ReadonlyMap<string, unknown>;
  /** The components those fields held, by uid. */
  readonly components: ReadonlyMap<string, unknown>;
}

/**
 * The reference fields of instance members outside a subtree that point into it, read from the live
 * world as JSON: what another instance's overrides aimed at the subtree's document entities, or at
 * the components its `add` overrides give. A member is not in the document, so only its live
 * component knows the field; a document component and an added one are read from the document. Only
 * the instances whose override lists point into the subtree are read.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @param index - The document, read before the subtree is destroyed.
 * @param subtree - The subtree's root.
 * @param entities - The subtree's document entity uids.
 * @param components - The uids of its document components and the components its overrides add.
 * @returns The fields, and the objects they held.
 */
export function heldByMembers(
  app: App,
  mirror: DocumentMirror,
  index: DocumentIndex,
  subtree: Entity,
  entities: ReadonlySet<string>,
  components: ReadonlySet<string>,
): HeldReferences {
  const fields = new Map<Component, JsonObject>();
  const heldEntities = new Map<string, unknown>();
  const heldComponents = new Map<string, unknown>();
  const registry = app.world.registry;
  const visit = (entity: Entity): void => {
    if (entity === subtree) {
      return;
    }
    for (const component of entity.components) {
      const uid = component.uid;
      if (index.components.get(uid) === component || index.added.get(uid) === component) {
        continue;
      }
      const props: Record<string, JsonValue> = {};
      for (const [name, field] of Object.entries(registry.describe(component.constructor).schema ?? {})) {
        if (!holdsReferences(field)) {
          continue;
        }
        const targets: [Map<string, unknown>, string, unknown][] = [];
        const json = encodeValue(field, Reflect.get(component, name), {
          entityUid: (value) => remember(targets, heldEntities, value),
          componentUid: (value) => remember(targets, heldComponents, value),
        });
        if (pointsInto(json, entities, components)) {
          props[name] = json;
          for (const [into, target, value] of targets) {
            into.set(target, value);
          }
        }
      }
      if (Object.keys(props).length > 0) {
        fields.set(component, props);
      }
    }
    for (const child of entity.children) {
      visit(child);
    }
  };
  for (const record of index.file.entities) {
    const root = index.entities.get(record.uid);
    const aims = (mirror.overridesOf(record.uid) ?? []).some(
      (override) => (override.op ?? "replace") === "replace" && pointsInto(override.value, entities, components),
    );
    if (root !== undefined && !entities.has(record.uid) && aims) {
      visit(root);
    }
  }
  return { fields, entities: heldEntities, components: heldComponents };
}

/**
 * Notes a referenced object by its uid, to keep if its field turns out to point into a subtree.
 *
 * @param targets - The field's notes.
 * @param into - Where the note goes if it is kept.
 * @param value - The referenced object.
 * @returns Its uid, or `null` for anything without one.
 */
function remember(
  targets: [Map<string, unknown>, string, unknown][],
  into: Map<string, unknown>,
  value: unknown,
): string | null {
  const uid = uidOf(value);
  if (uid !== null) {
    targets.push([into, uid, value]);
  }
  return uid;
}

/**
 * Tells whether a field's value can hold an entity or component reference.
 *
 * @param field - The field.
 * @returns True for a reference, or a list, record, map or optional of one.
 */
function holdsReferences(field: FieldDefinition<unknown>): boolean {
  const spec = field.spec;
  if (spec.kind === "entityRef" || spec.kind === "componentRef") {
    return true;
  }
  if (spec.kind === "array") {
    return holdsReferences(spec.item);
  }
  if (spec.kind === "record") {
    return Object.values(spec.fields).some((inner) => holdsReferences(inner));
  }
  if (spec.kind === "map") {
    return holdsReferences(spec.value);
  }
  return spec.kind === "optional" && holdsReferences(spec.inner);
}

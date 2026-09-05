import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { asJsonArray, asJsonObject } from "./json-view.js";
import type { SceneFileComponent, SceneFileEntity, SceneFileOverride, SceneFileTransform } from "./scene-file.js";
import type { JsonObject, JsonValue } from "../schema/json.js";

/**
 * The parsed form of an instance override `path`
 * (`docs/architecture/06-serialization-and-scene-format.md` §2). Every path starts with the uid of
 * an entity **of the instanced file**, so a path survives the per-instance uid remap
 * (`02-scene-graph.md` §10).
 *
 * The grammar, in the order the parser tries it:
 *
 * ```text
 * <uid>                                              → entity      (whole entity, "remove" only)
 * <uid>/name | active | static | layer | tags        → entityField
 * <uid>/transform/position | rotation | scale        → transform
 * <uid>/components                                   → componentList ("add" only)
 * <uid>/components/<uid>                             → component   ("remove" only)
 * <uid>/components/<uid>/enabled                     → componentField
 * <uid>/components/<uid>/props/<field>[/<key>…]      → prop
 * ```
 *
 * @public
 */
export type OverridePath =
  | { readonly kind: "entity"; readonly entity: string }
  | { readonly kind: "entityField"; readonly entity: string; readonly field: EntityOverrideField }
  | { readonly kind: "transform"; readonly entity: string; readonly channel: keyof SceneFileTransform }
  | { readonly kind: "componentList"; readonly entity: string }
  | { readonly kind: "component"; readonly entity: string; readonly component: string }
  | { readonly kind: "componentField"; readonly entity: string; readonly component: string }
  | {
      readonly kind: "prop";
      readonly entity: string;
      readonly component: string;
      readonly steps: readonly string[];
    };

/**
 * The entity properties an override may patch directly.
 *
 * @public
 */
export type EntityOverrideField = "name" | "active" | "static" | "layer" | "tags";

/** The entity fields the grammar accepts, as an `as const` table so the union derives from it. */
const ENTITY_FIELDS: readonly EntityOverrideField[] = Object.freeze(["name", "active", "static", "layer", "tags"]);

/** The transform channels the grammar accepts. */
const TRANSFORM_CHANNELS: readonly (keyof SceneFileTransform)[] = Object.freeze(["position", "rotation", "scale"]);

/**
 * Parses an override path.
 *
 * @param path - The `path` string from the file.
 * @returns The parsed path.
 * @throws IgnifxError with code `IGX-0609` when the path does not match the grammar.
 *
 * @example
 * ```ts
 * parseOverridePath("01J…ROOT/components/01J…AI/props/aggression");
 * // { kind: "prop", entity: "01J…ROOT", component: "01J…AI", steps: ["aggression"] }
 * ```
 *
 * @public
 */
export function parseOverridePath(path: string): OverridePath {
  const segments = path.split("/");
  const entity = segments[0];
  if (entity === undefined || entity === "") {
    throw invalidPath(path, "an override path starts with the uid of an entity in the instanced file.");
  }
  if (segments.length === 1) {
    return { kind: "entity", entity };
  }
  const second = segments[1] ?? "";
  if (segments.length === 2) {
    if (second === "components") {
      return { kind: "componentList", entity };
    }
    const field = ENTITY_FIELDS.find((candidate) => candidate === second);
    if (field !== undefined) {
      return { kind: "entityField", entity, field };
    }
    throw invalidPath(path, `"${second}" is not an entity property an override may patch.`);
  }
  if (second === "transform") {
    const channel = TRANSFORM_CHANNELS.find((candidate) => candidate === segments[2]);
    if (channel === undefined || segments.length !== 3) {
      throw invalidPath(path, "a transform override is <uid>/transform/position, /rotation, or /scale.");
    }
    return { kind: "transform", entity, channel };
  }
  if (second !== "components") {
    throw invalidPath(path, `"${second}" is not "components", "transform", or an entity property.`);
  }
  const component = segments[2] ?? "";
  if (component === "") {
    throw invalidPath(path, "a component override names the component's uid after /components/.");
  }
  if (segments.length === 3) {
    return { kind: "component", entity, component };
  }
  const fourth = segments[3] ?? "";
  if (fourth === "enabled" && segments.length === 4) {
    return { kind: "componentField", entity, component };
  }
  if (fourth !== "props" || segments.length < 5) {
    throw invalidPath(path, "a property override is <uid>/components/<uid>/props/<field>.");
  }
  return { kind: "prop", entity, component, steps: segments.slice(4) };
}

/**
 * The `op` an override declares, defaulting to `"replace"` as the format document's two-key
 * examples imply.
 *
 * @param override - The override entry.
 * @returns The operation.
 *
 * @internal
 */
export function overrideOp(override: SceneFileOverride): "replace" | "remove" | "add" {
  return override.op ?? "replace";
}

/**
 * Applies every override to an expanded entity list, in order
 * (`docs/architecture/06-serialization-and-scene-format.md` §4 step 3).
 *
 * @remarks
 * The patches run on the *file* representation, before any entity exists, so `add`, `remove`, and
 * `replace` all reduce to editing plain JSON. Entities are addressed by the uid they carry in the
 * instanced file; `lookup` maps that uid to the entity object in the expanded list.
 *
 * @param overrides - The patches, in file order.
 * @param lookup - Source uid to the mutable entity record it expanded into.
 * @param report - Called for a patch that names something the instanced file does not contain.
 *
 * @internal
 */
export function applyOverrides(
  overrides: readonly SceneFileOverride[],
  lookup: ReadonlyMap<string, OverrideTarget>,
  report: (message: string) => void,
): void {
  for (let index = 0; index < overrides.length; index += 1) {
    const override = overrides[index];
    if (override === undefined) {
      continue;
    }
    const parsed = parseOverridePath(override.path);
    const target = lookup.get(parsed.entity);
    if (target === undefined) {
      report(`the override path "${override.path}" names no entity of the instanced scene.`);
      continue;
    }
    applyOne(overrideOp(override), parsed, override, target, report);
  }
}

/**
 * One entity an override may address: the record to patch, plus the mapping from the component uids
 * the *instanced file* carries — which is what override paths name — to the fresh uids this copy of
 * the prefab got (`docs/architecture/02-scene-graph.md` §10).
 *
 * @internal
 */
export interface OverrideTarget {
  /** The entity record to patch. */
  readonly data: MutableSceneEntity;
  /** Instanced-file component uid to this copy's component uid. */
  readonly components: ReadonlyMap<string, string>;
}

/**
 * A scene-file entity being built by the expander: the same shape as {@link SceneFileEntity} with
 * the read-only markers dropped, because overrides patch it in place.
 *
 * @internal
 */
export interface MutableSceneEntity {
  uid: string;
  name: string;
  parent: string | null;
  active?: boolean;
  static?: boolean;
  layer?: string;
  tags?: string[];
  transform: { position: number[]; rotation: number[]; scale: number[] };
  instance?: SceneFileEntity["instance"];
  components: SceneFileComponent[];
}

/**
 * Applies one parsed override.
 *
 * @param op - The operation.
 * @param parsed - The parsed path.
 * @param override - The raw entry, for its `value`.
 * @param target - The entity the path resolved to, with its component uid mapping.
 * @param report - Called when the patch cannot be applied.
 */
function applyOne(
  op: "replace" | "remove" | "add",
  parsed: OverridePath,
  override: SceneFileOverride,
  target: OverrideTarget,
  report: (message: string) => void,
): void {
  const entity = target.data;
  switch (parsed.kind) {
    case "entity": {
      report(`"${override.path}" addresses a whole entity; overrides patch properties and components.`);
      return;
    }
    case "entityField": {
      applyEntityField(parsed.field, override.value ?? null, entity);
      return;
    }
    case "transform": {
      const numbers = asJsonArray(override.value);
      if (numbers === null) {
        report(`"${override.path}" needs an array of numbers.`);
        return;
      }
      entity.transform[parsed.channel] = numberArray(numbers);
      return;
    }
    case "componentList": {
      if (op !== "add") {
        report(`"${override.path}" is only valid with { "op": "add" }.`);
        return;
      }
      const added = asComponentEntry(override.value);
      if (added === null) {
        report(`"${override.path}" needs a component object with a uid and a type.`);
        return;
      }
      entity.components.push(added);
      return;
    }
    case "component": {
      if (op !== "remove") {
        report(`"${override.path}" addresses a whole component; only { "op": "remove" } may patch it.`);
        return;
      }
      const at = indexOfComponent(entity, resolve(target, parsed.component));
      if (at < 0) {
        report(`"${override.path}" names no component of that entity.`);
        return;
      }
      entity.components.splice(at, 1);
      return;
    }
    case "componentField": {
      const uid = resolve(target, parsed.component);
      const component = componentOf(entity, uid);
      if (component === null) {
        report(`"${override.path}" names no component of that entity.`);
        return;
      }
      replaceComponent(entity, uid, { ...component, enabled: override.value === true });
      return;
    }
    case "prop": {
      const uid = resolve(target, parsed.component);
      const component = componentOf(entity, uid);
      if (component === null) {
        report(`"${override.path}" names no component of that entity.`);
        return;
      }
      const props = writeStep(
        component.props ?? {},
        parsed.steps,
        0,
        op,
        override.value ?? null,
        override.path,
        report,
      );
      replaceComponent(entity, uid, { ...component, props });
      return;
    }
    default: {
      return;
    }
  }
}

/**
 * Patches one plain entity property.
 *
 * @param field - Which property.
 * @param value - The new JSON value.
 * @param entity - The entity to patch.
 */
function applyEntityField(field: EntityOverrideField, value: JsonValue, entity: MutableSceneEntity): void {
  switch (field) {
    case "name": {
      entity.name = typeof value === "string" ? value : entity.name;
      return;
    }
    case "active": {
      entity.active = value === true;
      return;
    }
    case "static": {
      entity.static = value === true;
      return;
    }
    case "layer": {
      if (typeof value === "string") {
        entity.layer = value;
      }
      return;
    }
    case "tags": {
      const list = asJsonArray(value);
      if (list !== null) {
        entity.tags = list.filter((tag): tag is string => typeof tag === "string");
      }
      return;
    }
    default: {
      return;
    }
  }
}

/**
 * Writes one step of a `props/<field>[/<key>…]` path, rebuilding the containers on the way so the
 * instanced file's own JSON is never mutated (two instances of one prefab must not share objects).
 *
 * @param container - The object or array being descended into.
 * @param steps - The remaining path segments.
 * @param at - The index of the segment to apply.
 * @param op - The operation.
 * @param value - The new value.
 * @param path - The whole path, for diagnostics.
 * @param report - Called when the step cannot be applied.
 * @returns The rebuilt container.
 */
function writeStep(
  container: JsonObject,
  steps: readonly string[],
  at: number,
  op: "replace" | "remove" | "add",
  value: JsonValue,
  path: string,
  report: (message: string) => void,
): JsonObject {
  const key = steps[at];
  if (key === undefined) {
    return container;
  }
  const copy: Record<string, JsonValue> = { ...container };
  if (at === steps.length - 1) {
    if (op === "remove") {
      // `delete` on a fresh copy: the container was cloned one line above, so nothing shared is
      // mutated and the key order of the surviving keys is preserved.
      const { [key]: _removed, ...rest } = copy;
      return rest;
    }
    copy[key] = value;
    return copy;
  }
  const next = copy[key];
  const nextArray = asJsonArray(next);
  if (nextArray !== null) {
    copy[key] = writeArrayStep(nextArray, steps, at + 1, op, value, path, report);
    return copy;
  }
  const nextObject = asJsonObject(next);
  if (nextObject !== null) {
    copy[key] = writeStep(nextObject, steps, at + 1, op, value, path, report);
    return copy;
  }
  report(`"${path}" descends into ${key}, which is not an object or an array.`);
  return container;
}

/**
 * The array form of {@link writeStep}.
 *
 * @param container - The array being descended into.
 * @param steps - The remaining path segments.
 * @param at - The index of the segment to apply.
 * @param op - The operation.
 * @param value - The new value.
 * @param path - The whole path, for diagnostics.
 * @param report - Called when the step cannot be applied.
 * @returns The rebuilt array.
 */
function writeArrayStep(
  container: readonly JsonValue[],
  steps: readonly string[],
  at: number,
  op: "replace" | "remove" | "add",
  value: JsonValue,
  path: string,
  report: (message: string) => void,
): readonly JsonValue[] {
  const key = steps[at];
  if (key === undefined) {
    return container;
  }
  const index = Number.parseInt(key, 10);
  if (!Number.isInteger(index) || index < 0) {
    report(`"${path}" indexes an array with "${key}", which is not a whole number.`);
    return container;
  }
  const copy = [...container];
  if (at === steps.length - 1) {
    if (op === "remove") {
      copy.splice(index, 1);
      return copy;
    }
    if (op === "add") {
      copy.splice(index, 0, value);
      return copy;
    }
    copy[index] = value;
    return copy;
  }
  const next = copy[index];
  const nextArray = asJsonArray(next);
  if (nextArray !== null) {
    copy[index] = writeArrayStep(nextArray, steps, at + 1, op, value, path, report);
    return copy;
  }
  const nextObject = asJsonObject(next);
  if (nextObject !== null) {
    copy[index] = writeStep(nextObject, steps, at + 1, op, value, path, report);
    return copy;
  }
  report(`"${path}" descends into [${key}], which is not an object or an array.`);
  return container;
}

/**
 * Resolves the uid an override path names — a uid of the instanced file — to the uid this copy of
 * the prefab gave the same component.
 *
 * @param target - The entity the path resolved to.
 * @param sourceUid - The uid the path names.
 * @returns This copy's uid, or the name itself when the mapping does not know it.
 */
function resolve(target: OverrideTarget, sourceUid: string): string {
  return target.components.get(sourceUid) ?? sourceUid;
}

/**
 * Finds a component of an entity by uid.
 *
 * @param entity - The entity.
 * @param uid - The component uid.
 * @returns Its index, or `-1`.
 */
function indexOfComponent(entity: MutableSceneEntity, uid: string): number {
  for (let index = 0; index < entity.components.length; index += 1) {
    if (entity.components[index]?.uid === uid) {
      return index;
    }
  }
  return -1;
}

/**
 * Reads a component of an entity by uid.
 *
 * @param entity - The entity.
 * @param uid - The component uid.
 * @returns The component, or `null`.
 */
function componentOf(entity: MutableSceneEntity, uid: string): SceneFileComponent | null {
  const at = indexOfComponent(entity, uid);
  return at < 0 ? null : (entity.components[at] ?? null);
}

/**
 * Replaces a component entry in place, keeping its position in the list.
 *
 * @param entity - The entity.
 * @param uid - The component uid.
 * @param replacement - The new entry.
 */
function replaceComponent(entity: MutableSceneEntity, uid: string, replacement: SceneFileComponent): void {
  const at = indexOfComponent(entity, uid);
  if (at >= 0) {
    entity.components[at] = replacement;
  }
}

/**
 * Reads a JSON value as a component entry.
 *
 * @param value - The candidate.
 * @returns The entry, or `null` when it carries no string `uid` and `type`.
 */
function asComponentEntry(value: JsonValue | undefined): SceneFileComponent | null {
  const object = asJsonObject(value);
  if (object === null || typeof object["uid"] !== "string" || typeof object["type"] !== "string") {
    return null;
  }
  const enabled = object["enabled"];
  const version = object["schemaVersion"];
  return {
    uid: object["uid"],
    type: object["type"],
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(typeof version === "number" ? { schemaVersion: version } : {}),
    ...(asJsonObject(object["props"]) === null ? {} : { props: asJsonObject(object["props"]) ?? {} }),
  };
}

/**
 * Coerces a JSON array to numbers, dropping anything else.
 *
 * @param value - The JSON array.
 * @returns The numbers it holds.
 */
function numberArray(value: readonly JsonValue[]): number[] {
  const numbers: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry === "number" && Number.isFinite(entry)) {
      numbers.push(entry);
    }
  }
  return numbers;
}

/**
 * Builds the `IGX-0609` error.
 *
 * @param path - The offending path.
 * @param reason - What the grammar expected.
 * @returns The error to throw.
 */
function invalidPath(path: string, reason: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidOverridePath, `${path} is not a valid override path: ${reason}`, {
    context: { path },
    hint: 'Override paths read "<entityUid>/components/<componentUid>/props/<field>".',
  });
}

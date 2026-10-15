// A copy of `packages/editor-protocol/src/scene-ops.ts` from `astrum-forge/ignifx-editor` (protocol 0.3).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The scene op vocabulary on the wire: the thirteen ops of plan §3.4, exactly as
 * `@ignifx/editor-core` defines them (`packages/editor-core/src/ops.ts`), so a command the editor
 * applied to its document is sent to the host unchanged and MCP's `apply_ops` accepts the same JSON.
 *
 * @remarks
 * The types are restated here because this package has no dependencies. Every op, field name and
 * literal string is editor-core's; the package's tests check that editor-core's `SceneOp` and this
 * one are assignable both ways. Whether an op makes sense for a document (does the entity exist, is
 * the index in range) is not the wire's question: editor-core answers it before the op is sent, and
 * the host answers it again when it applies the op to the live world.
 */
import { isRecord } from "./rpc.js";
import {
  isArrayOf,
  isBoolean,
  isJsonValue,
  isOverrideOp,
  isSceneFileEntity,
  isSceneFileComponent,
  isSceneFileInstance,
  isSceneFileOverride,
  isSceneFileTransform,
  isString,
  isUidString,
  optionalField,
} from "./scene-file.js";
import type {
  JsonValue,
  SceneFileComponent,
  SceneFileEntity,
  SceneFileInstance,
  SceneFileOverride,
  SceneFileTransform,
} from "./scene-file.js";

/**
 * The `op` discriminant of every scene op.
 *
 * @remarks
 * `as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).
 *
 * @public
 */
export const SceneOpKind = {
  /** Creates an entity, optionally with a subtree. */
  createEntity: "createEntity",
  /** Destroys an entity and its subtree. */
  destroyEntity: "destroyEntity",
  /** Moves an entity under another parent, keeping its local transform. */
  reparent: "reparent",
  /** Moves an entity among its siblings. */
  reorder: "reorder",
  /** Sets `name`, `active`, `static`, `layer` or `tags`. */
  setEntityField: "setEntityField",
  /** Sets an entity's local transform. */
  setTransform: "setTransform",
  /** Adds a component. */
  addComponent: "addComponent",
  /** Removes a component. */
  removeComponent: "removeComponent",
  /** Sets or removes a value inside a component's `props`. */
  setProp: "setProp",
  /** Sets or removes a value inside the scene's `settings`. */
  setSceneSetting: "setSceneSetting",
  /** Creates an instance root (a prefab instance). */
  instantiate: "instantiate",
  /** Sets an override on an instance root. */
  setOverride: "setOverride",
  /** Removes an override from an instance root. */
  removeOverride: "removeOverride",
} as const;

/**
 * The union of the names in `SceneOpKind`.
 *
 * @public
 */
export type SceneOpKind = (typeof SceneOpKind)[keyof typeof SceneOpKind];

/**
 * The entity properties {@link SetEntityFieldOp} writes, and their value types.
 *
 * @public
 */
export interface EntityFieldValues {
  /** The display name. */
  readonly name: string;
  /** `false` deactivates the entity and its subtree. */
  readonly active: boolean;
  /** The static flag. */
  readonly static: boolean;
  /** The layer name; `"Default"` is the default. */
  readonly layer: string;
  /** The tags; stored deduplicated and sorted, as the serializer writes them. */
  readonly tags: readonly string[];
}

/**
 * The name of an entity property {@link SetEntityFieldOp} writes.
 *
 * @public
 */
export type EntityField = keyof EntityFieldValues;

/**
 * A path into a JSON object: object keys as strings, array indices as whole numbers.
 *
 * @public
 */
export type JsonPath = readonly (string | number)[];

/**
 * Creates an entity, optionally with a whole subtree below it. `entity.parent` places it; `index`
 * is its place among the parent's children (default: last); `descendants` are further records,
 * parents first.
 *
 * @public
 */
export interface CreateEntityOp {
  /** The discriminant. */
  readonly op: "createEntity";
  /** The new entity's record, including its components and, for an instance root, its `instance`. */
  readonly entity: SceneFileEntity;
  /** The entity's index among its siblings; defaults to the end. */
  readonly index?: number;
  /** The rest of the subtree, parents first. */
  readonly descendants?: readonly SceneFileEntity[];
}

/**
 * Destroys an entity and its whole subtree.
 *
 * @public
 */
export interface DestroyEntityOp {
  /** The discriminant. */
  readonly op: "destroyEntity";
  /** The entity's uid. */
  readonly entity: string;
}

/**
 * Moves an entity under another parent, keeping its local transform.
 *
 * @public
 */
export interface ReparentOp {
  /** The discriminant. */
  readonly op: "reparent";
  /** The entity's uid. */
  readonly entity: string;
  /** The new parent's uid, or `null` to make the entity a root. */
  readonly parent: string | null;
  /** The entity's index among its new siblings; defaults to the end. */
  readonly index?: number;
}

/**
 * Moves an entity among its siblings; `index` is its place after the move.
 *
 * @public
 */
export interface ReorderOp {
  /** The discriminant. */
  readonly op: "reorder";
  /** The entity's uid. */
  readonly entity: string;
  /** The new index among its siblings. */
  readonly index: number;
}

/**
 * Sets one entity property.
 *
 * @public
 */
export type SetEntityFieldOp = {
  readonly [F in EntityField]: {
    /** The discriminant. */
    readonly op: "setEntityField";
    /** The entity's uid. */
    readonly entity: string;
    /** Which property. */
    readonly field: F;
    /** The new value. */
    readonly value: EntityFieldValues[F];
  };
}[EntityField];

/**
 * Sets an entity's local transform. `before` is informational and ignored when applying.
 *
 * @public
 */
export interface SetTransformOp {
  /** The discriminant. */
  readonly op: "setTransform";
  /** The entity's uid. */
  readonly entity: string;
  /** The new local transform. */
  readonly after: SceneFileTransform;
  /** The local transform the emitter saw before the change; ignored when applying. */
  readonly before?: SceneFileTransform;
}

/**
 * Adds a component to an entity.
 *
 * @public
 */
export interface AddComponentOp {
  /** The discriminant. */
  readonly op: "addComponent";
  /** The entity's uid. */
  readonly entity: string;
  /** The component's record; its uid must be new to the document. */
  readonly component: SceneFileComponent;
  /** The component's index on the entity; defaults to the end. */
  readonly index?: number;
}

/**
 * Removes a component.
 *
 * @public
 */
export interface RemoveComponentOp {
  /** The discriminant. */
  readonly op: "removeComponent";
  /** The component's uid. */
  readonly component: string;
}

/**
 * Sets, or removes, a value inside a component's `props`. `path[0]` is the field name; an absent
 * `value` removes the key; the empty path addresses `props` itself.
 *
 * @public
 */
export interface SetPropOp {
  /** The discriminant. */
  readonly op: "setProp";
  /** The component's uid. */
  readonly component: string;
  /** The path into `props`. */
  readonly path: JsonPath;
  /** The new value; absent removes the key. */
  readonly value?: JsonValue;
}

/**
 * Sets, or removes, a value inside the scene's `settings`, with {@link SetPropOp}'s path rules.
 *
 * @public
 */
export interface SetSceneSettingOp {
  /** The discriminant. */
  readonly op: "setSceneSetting";
  /** The path into `settings`; `path[0]` is the setting's key. */
  readonly path: JsonPath;
  /** The new value; absent removes the key. */
  readonly value?: JsonValue;
}

/**
 * Creates an instance root: an entity carrying an `instance` entry.
 *
 * @public
 */
export interface InstantiateOp {
  /** The discriminant. */
  readonly op: "instantiate";
  /** The new entity's uid. */
  readonly entity: string;
  /** Its name; usually the prefab root's name. */
  readonly name: string;
  /** Its parent's uid, or `null` for a root. */
  readonly parent: string | null;
  /** Its index among its siblings; defaults to the end. */
  readonly index?: number;
  /** Its local transform. */
  readonly transform: SceneFileTransform;
  /** The instance entry: the scene asset, its hash, and any overrides. */
  readonly instance: SceneFileInstance;
}

/**
 * Sets an override on an instance root's entry, replacing the override with the same identity or
 * inserting a new one at `index` (default: last).
 *
 * @public
 */
export interface SetOverrideOp {
  /** The discriminant. */
  readonly op: "setOverride";
  /** The instance root's uid. */
  readonly entity: string;
  /** The override. */
  readonly override: SceneFileOverride;
  /** Where a new override goes; defaults to the end. */
  readonly index?: number;
}

/**
 * Removes an override from an instance root's entry.
 *
 * @public
 */
export interface RemoveOverrideOp {
  /** The discriminant. */
  readonly op: "removeOverride";
  /** The instance root's uid. */
  readonly entity: string;
  /** The override's path. */
  readonly path: string;
  /** The override's `op`; defaults to what the path implies. */
  readonly overrideOp?: "replace" | "remove" | "add";
  /** For a component `add`, the uid of the component it adds. */
  readonly added?: string;
}

/**
 * One scene op: the closed vocabulary of plan §3.4, identical to `@ignifx/editor-core`'s `SceneOp`.
 *
 * @public
 */
export type SceneOp =
  | CreateEntityOp
  | DestroyEntityOp
  | ReparentOp
  | ReorderOp
  | SetEntityFieldOp
  | SetTransformOp
  | AddComponentOp
  | RemoveComponentOp
  | SetPropOp
  | SetSceneSettingOp
  | InstantiateOp
  | SetOverrideOp
  | RemoveOverrideOp;

/**
 * Tells whether a value is an insertion index: a non-negative safe integer. Whether it is in range
 * is the applier's question.
 *
 * @param value - The value to test.
 * @returns True for a non-negative safe integer.
 */
function isIndex(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/**
 * Tells whether a value is a JSON path.
 *
 * @param value - The value to test.
 * @returns True for an array of strings and non-negative safe integers.
 */
function isJsonPath(value: unknown): value is JsonPath {
  return isArrayOf(value, (step): step is string | number => isString(step) || isIndex(step));
}

/**
 * Tells whether a value is a parent: a uid or `null`.
 *
 * @param value - The value to test.
 * @returns True for `null` or a uid.
 */
function isParent(value: unknown): value is string | null {
  return value === null || isUidString(value);
}

/** The value test for each field {@link SetEntityFieldOp} writes. */
const ENTITY_FIELD_TESTS: Readonly<Record<EntityField, (value: unknown) => boolean>> = {
  name: isString,
  active: isBoolean,
  static: isBoolean,
  layer: isString,
  tags: (value) => isArrayOf(value, isString),
};

/** The structural test of each op's fields beyond `op`. */
const OP_TESTS: Readonly<Record<SceneOpKind, (op: Record<string, unknown>) => boolean>> = {
  createEntity: (op) =>
    isSceneFileEntity(op["entity"]) &&
    optionalField(op, "index", isIndex) &&
    optionalField(op, "descendants", (descendants) => isArrayOf(descendants, isSceneFileEntity)),
  destroyEntity: (op) => isUidString(op["entity"]),
  reparent: (op) => isUidString(op["entity"]) && isParent(op["parent"]) && optionalField(op, "index", isIndex),
  reorder: (op) => isUidString(op["entity"]) && isIndex(op["index"]),
  setEntityField: (op) => {
    const field = op["field"];
    const test = Object.entries(ENTITY_FIELD_TESTS).find(([name]) => name === field)?.[1];
    return isUidString(op["entity"]) && test !== undefined && test(op["value"]);
  },
  setTransform: (op) =>
    isUidString(op["entity"]) && isSceneFileTransform(op["after"]) && optionalField(op, "before", isSceneFileTransform),
  addComponent: (op) =>
    isUidString(op["entity"]) && isSceneFileComponent(op["component"]) && optionalField(op, "index", isIndex),
  removeComponent: (op) => isUidString(op["component"]),
  setProp: (op) =>
    isUidString(op["component"]) && isJsonPath(op["path"]) && optionalField(op, "value", (value) => isJsonValue(value)),
  setSceneSetting: (op) => isJsonPath(op["path"]) && optionalField(op, "value", (value) => isJsonValue(value)),
  instantiate: (op) =>
    isUidString(op["entity"]) &&
    isString(op["name"]) &&
    isParent(op["parent"]) &&
    optionalField(op, "index", isIndex) &&
    isSceneFileTransform(op["transform"]) &&
    isSceneFileInstance(op["instance"]),
  setOverride: (op) =>
    isUidString(op["entity"]) && isSceneFileOverride(op["override"]) && optionalField(op, "index", isIndex),
  removeOverride: (op) =>
    isUidString(op["entity"]) &&
    isString(op["path"]) &&
    optionalField(op, "overrideOp", isOverrideOp) &&
    optionalField(op, "added", isUidString),
};

/**
 * Checks the structure of one scene op: a known `op` and fields of the right types.
 *
 * @remarks
 * It answers "is this an op of the vocabulary", not "does it apply": uids are checked to be
 * non-empty strings, indices to be non-negative integers, values to be JSON, and records to have the
 * scene format's shape. Unknown extra fields are ignored. A `setProp` or `setSceneSetting` value may
 * be any JSON; that the empty path receives an object is the applier's check.
 *
 * @param value - A received op.
 * @returns True when `value` is a structurally valid {@link SceneOp}.
 *
 * @example
 * ```ts
 * isSceneOp({ op: "setEntityField", entity: "01J9Z6M7E5S3A0V2Q4R8T1Y6WX", field: "name", value: "Player" }); // true
 * isSceneOp({ op: "setEntityField", entity: "01J9Z6M7E5S3A0V2Q4R8T1Y6WX", field: "name", value: 3 }); // false
 * ```
 *
 * @public
 */
export function isSceneOp(value: unknown): value is SceneOp {
  if (!isRecord(value)) {
    return false;
  }
  const kind = value["op"];
  const test = Object.entries(OP_TESTS).find(([name]) => name === kind)?.[1];
  return test !== undefined && test(value);
}

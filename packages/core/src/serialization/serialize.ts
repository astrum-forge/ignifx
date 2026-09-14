import { VERSION } from "../app/version.js";
import { entityInternals } from "../entity/internals.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { canonicalizeNumber, encodeProps, encodeValue } from "../schema/encode.js";
import { SCENE_FILE_FORMAT, SCENE_FORMAT_VERSION } from "./scene-file.js";
import { membershipEncoder } from "./uid-remap.js";
import type { SceneAsset } from "./scene-asset.js";
import type {
  SceneFile,
  SceneFileComponent,
  SceneFileEntity,
  SceneFileInstance,
  SceneFileOverride,
  SceneFileTransform,
} from "./scene-file.js";
import type { Component } from "../component/component.js";
import type { Entity } from "../entity/entity.js";
import type { EntityOrigin } from "../entity/internals.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { ReferenceEncoder } from "../schema/encode.js";
import type { SchemaIssue } from "../schema/issues.js";
import type { JsonObject, JsonValue } from "../schema/json.js";
import type { Schema } from "../schema/types.js";
import type { Transform } from "../transform/transform.js";

/**
 * One problem found while writing a file. Serialization is total — it always produces valid JSON —
 * so a problem means one value was written as `null` or one link was dropped, never that the save
 * failed (`docs/architecture/06-serialization-and-scene-format.md` §3).
 *
 * @public
 */
export interface SerializeIssue {
  /** The diagnostic code, for example `IGX-0602`. */
  readonly code: string;
  /** The actionable sentence. */
  readonly message: string;
}

/**
 * Options accepted by {@link serializeScene}.
 *
 * @public
 */
export interface SerializeSceneOptions {
  /**
   * `true` writes every entity of an instanced subtree as a plain entity instead of one `instance`
   * entry with computed overrides (`docs/architecture/06-serialization-and-scene-format.md` §5).
   * Flattened files no longer track the prefab and their uids are the runtime ones, which differ
   * per load.
   */
  readonly flatten?: boolean;
  /** Overrides the file's `name`; defaults to the instance's name, or `"scene"`. */
  readonly name?: string;
  /** Overrides the file's `settings` block; defaults to the instance's. */
  readonly settings?: JsonObject | null;
  /** Overrides the recorded `engineVersion`; `null` omits it, which is what byte-stable tests use. */
  readonly engineVersion?: string | null;
  /** Receives every problem found, in discovery order. */
  readonly onIssue?: (issue: SerializeIssue) => void;
}

/**
 * Writes a scene instance, or a set of entities, as a scene file object
 * (`docs/architecture/06-serialization-and-scene-format.md` §5).
 *
 * @remarks
 * Everything about the output is fixed so that two saves of the same state are byte-identical:
 * entities appear in tree order, object keys in the canonical order of §1, numbers rounded by
 * {@link canonicalizeNumber}, props in their schema's declaration order, and properties equal to
 * their default (`active`, `static`, `layer`, `tags`, `enabled`) omitted. Pass the result to
 * `stringifySceneFile` for the canonical text.
 *
 * An entity that came from an `instance` entry is re-emitted as one — with overrides recomputed by
 * diffing its current state against the instanced scene — unless `flatten` is set.
 *
 * @param source - The instance to write, or the entities to write as a file's roots.
 * @param options - Flattening, naming, and the issue collector.
 * @returns The file object.
 *
 * @example
 * ```ts
 * const text = stringifySceneFile(serializeScene(world.activeScene));
 * ```
 *
 * @public
 */
export function serializeScene(source: SceneInstance | readonly Entity[], options?: SerializeSceneOptions): SceneFile {
  const instance = isEntityList(source) ? null : source;
  const roots = instance === null ? [...(isEntityList(source) ? source : [])] : [...instance.roots];
  const issues: SerializeIssue[] = [];
  const report = (code: string, message: string): void => {
    const issue = { code, message };
    issues.push(issue);
    options?.onIssue?.(issue);
  };
  const flatten = options?.flatten === true;
  const plan = planEntities(roots, flatten, report);
  const references = membershipEncoder(plan.entities, plan.components);
  const entities: SceneFileEntity[] = [];
  for (let index = 0; index < plan.order.length; index += 1) {
    const planned = plan.order[index];
    if (planned !== undefined) {
      entities.push(writeEntity(planned, references, report));
    }
  }
  const engineVersion = options?.engineVersion === undefined ? VERSION : options.engineVersion;
  const settings = options?.settings === undefined ? (instance?.settings ?? null) : options.settings;
  return {
    format: SCENE_FILE_FORMAT,
    formatVersion: SCENE_FORMAT_VERSION,
    ...(engineVersion === null ? {} : { engineVersion }),
    name: options?.name ?? instance?.name ?? "scene",
    ...(settings === null ? {} : { settings }),
    entities,
  };
}

/**
 * Writes one entity as a file record, for tooling and tests
 * (`docs/architecture/06-serialization-and-scene-format.md` §5).
 *
 * @remarks
 * The entity is written on its own: its `parent` is whatever its runtime parent's uid is, its
 * instanced subtree is not consulted, and references to objects outside it become `null`.
 *
 * @param entity - The entity to write.
 * @param references - How entity and component references resolve to uids; by default every
 * reference resolves to the target's own uid, which is what an inspector wants.
 * @returns The entity record.
 *
 * @example
 * ```ts
 * expect(serializeEntity(player).transform.position).toEqual([0, 1, 0]);
 * ```
 *
 * @public
 */
export function serializeEntity(entity: Entity, references: ReferenceEncoder = ownUidEncoder()): SceneFileEntity {
  const planned: PlannedEntity = { entity, parentUid: entity.parent?.uid ?? null, origin: null };
  return writeEntity(planned, references, ignoreIssue);
}

/**
 * Drops a reported problem, for the standalone writers that have no collector.
 */
function ignoreIssue(): void {
  // The standalone writers are for tooling and tests; their caller has no issue collector.
}

/**
 * Writes one component as a file record, for tooling and tests.
 *
 * @param component - The component to write.
 * @param references - How entity and component references resolve to uids.
 * @param onIssue - Receives problems found while encoding props.
 * @returns The component record.
 * @throws IgnifxError with code `IGX-0204` when the component's class declares no `typeId`.
 *
 * @example
 * ```ts
 * expect(serializeComponent(mover).props).toEqual({ speed: 5 });
 * ```
 *
 * @public
 */
export function serializeComponent(
  component: Component,
  references: ReferenceEncoder = ownUidEncoder(),
  onIssue?: (issue: SerializeIssue) => void,
): SceneFileComponent {
  const info = component.world.registry.describe(component.constructor);
  const typeId = component.world.registry.requireTypeId(component.constructor);
  const schema = info.schema;
  const record: SceneFileComponent = {
    uid: component.uid,
    type: typeId,
    ...(component.enabled ? {} : { enabled: false }),
    ...(schemaVersionOf(component) === 1 ? {} : { schemaVersion: schemaVersionOf(component) }),
    ...(schema === null ? {} : { props: encodeComponentProps(component, references, onIssue) }),
  };
  return record;
}

/**
 * Splits {@link serializeScene}'s union. `Array.isArray` narrows to `any[]`, which does not remove
 * `readonly Entity[]` from a union, so the predicate states the discrimination once.
 *
 * @param source - What the caller passed.
 * @returns `true` when it is a list of entities rather than a scene instance.
 */
function isEntityList(source: SceneInstance | readonly Entity[]): source is readonly Entity[] {
  return Array.isArray(source);
}

/** One entity that will be written, with the parent uid the file records for it. */
interface PlannedEntity {
  /** The entity. */
  readonly entity: Entity;
  /** The uid written as `parent`. */
  readonly parentUid: string | null;
  /** Its origin, when it is an instance root that will be written as an `instance` entry. */
  readonly origin: EntityOrigin | null;
}

/** What {@link planEntities} worked out. */
interface EntityPlan {
  /** The entities to write, in tree order. */
  readonly order: readonly PlannedEntity[];
  /** The membership set references are resolved against. */
  readonly entities: ReadonlySet<Entity>;
  /** The membership set component references are resolved against. */
  readonly components: ReadonlySet<Component>;
}

/**
 * Walks the roots in tree order and decides which entities the file contains: everything, except
 * the entities an `instance` entry stands for when `flatten` is off.
 *
 * @param roots - The roots to walk.
 * @param flatten - `true` writes instanced entities as plain entities.
 * @param report - Receives problems.
 * @returns The plan.
 */
function planEntities(
  roots: readonly Entity[],
  flatten: boolean,
  report: (code: string, message: string) => void,
): EntityPlan {
  const order: PlannedEntity[] = [];
  const entities = new Set<Entity>();
  const components = new Set<Component>();
  const visit = (entity: Entity, parentUid: string | null): void => {
    if (entity.isDestroyed) {
      return;
    }
    const origin = entityInternals(entity).origin;
    const asInstance = !flatten && origin !== null && origin.instanced !== null;
    order.push({ entity, parentUid, origin: asInstance ? origin : null });
    entities.add(entity);
    const own = entity.components;
    for (let index = 0; index < own.length; index += 1) {
      const component = own[index];
      if (component !== undefined) {
        components.add(component);
      }
    }
    const children = entity.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child === undefined) {
        continue;
      }
      if (asInstance && belongsToInstance(child, entity)) {
        continue;
      }
      if (asInstance) {
        report(
          CoreErrorCode.unresolvedReference,
          `${child.name} was added under the instance ${entity.name} at run time; it is written as a plain entity.`,
        );
      }
      visit(child, entity.uid);
    }
  };
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    if (root !== undefined) {
      visit(root, null);
    }
  }
  return { order, entities, components };
}

/**
 * Reports whether an entity is part of the instance a root stands for, at any depth.
 *
 * @param entity - The candidate.
 * @param root - The instance root.
 * @returns `true` when the entity came from that instance.
 */
function belongsToInstance(entity: Entity, root: Entity): boolean {
  let origin = entityInternals(entity).origin;
  let guard = 0;
  const limit = 64;
  while (origin !== null && guard < limit) {
    const inside = origin.instanceRoot;
    if (inside === null) {
      return false;
    }
    if (inside === root) {
      return true;
    }
    origin = entityInternals(inside).origin;
    guard += 1;
  }
  return false;
}

/**
 * Writes one planned entity.
 *
 * @param planned - The entity and its file parent.
 * @param references - How references resolve.
 * @param report - Receives problems.
 * @returns The record.
 */
function writeEntity(
  planned: PlannedEntity,
  references: ReferenceEncoder,
  report: (code: string, message: string) => void,
): SceneFileEntity {
  const entity = planned.entity;
  const tags = [...entity.tags.values()].toSorted();
  const layerName = entity.world.layers.nameOf(entity.layer);
  const origin = planned.origin;
  const instance = origin === null ? null : writeInstance(entity, origin, references, report);
  const components = writeComponents(entity, references, report);
  return {
    uid: entity.uid,
    name: entity.name,
    parent: planned.parentUid,
    ...(entity.active ? {} : { active: false }),
    ...(entity.isStatic ? { static: true } : {}),
    ...(layerName === null || layerName === "Default" ? {} : { layer: layerName }),
    ...(tags.length === 0 ? {} : { tags }),
    transform: writeTransform(entity.transform),
    ...(instance === null ? {} : { instance }),
    ...(components.length === 0 ? {} : { components }),
  };
}

/**
 * Writes an entity's own components, skipping the transform, which the file records separately.
 *
 * @param entity - The entity.
 * @param references - How references resolve.
 * @param report - Receives problems.
 * @returns The records, in attach order.
 */
function writeComponents(
  entity: Entity,
  references: ReferenceEncoder,
  report: (code: string, message: string) => void,
): SceneFileComponent[] {
  const records: SceneFileComponent[] = [];
  const components = entity.components;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined || component === entity.transform || component.isDestroyed) {
      continue;
    }
    const info = component.world.registry.describe(component.constructor);
    if (info.typeId === null) {
      report(
        CoreErrorCode.componentTypeIdMissing,
        `${component.constructor.name} on ${entity.name} has no typeId and cannot be written.`,
      );
      continue;
    }
    records.push(
      serializeComponent(component, references, (issue) => {
        report(issue.code, issue.message);
      }),
    );
  }
  return records;
}

/**
 * Writes an entity's local transform.
 *
 * @param transform - The transform.
 * @returns The record.
 */
function writeTransform(transform: Transform): SceneFileTransform {
  const position = transform.localPosition;
  const rotation = transform.localRotation;
  const scale = transform.localScale;
  return {
    position: [canonicalizeNumber(position.x), canonicalizeNumber(position.y), canonicalizeNumber(position.z)],
    rotation: [
      canonicalizeNumber(rotation.x),
      canonicalizeNumber(rotation.y),
      canonicalizeNumber(rotation.z),
      canonicalizeNumber(rotation.w),
    ],
    scale: [canonicalizeNumber(scale.x), canonicalizeNumber(scale.y), canonicalizeNumber(scale.z)],
  };
}

/**
 * Writes the `instance` entry of an instance root, recomputing its overrides by diffing the
 * instanced scene's entities against what they are now
 * (`docs/architecture/06-serialization-and-scene-format.md` §5).
 *
 * @param root - The instance root.
 * @param origin - Its origin, whose `instanced` link names the scene.
 * @param references - How references resolve.
 * @param report - Receives problems.
 * @returns The entry.
 */
function writeInstance(
  root: Entity,
  origin: EntityOrigin,
  references: ReferenceEncoder,
  report: (code: string, message: string) => void,
): SceneFileInstance | null {
  const link = origin.instanced;
  if (link === null) {
    return null;
  }
  const overrides = computeOverrides(root, link.scene, references, report);
  return {
    scene: { $asset: link.address },
    hash: link.scene.hash,
    ...(overrides.length === 0 ? {} : { overrides }),
  };
}

/**
 * Diffs every direct member of an instance against the record the instanced file holds for it.
 *
 * @remarks
 * Only entities the instanced file itself declares are diffed. An entity that came from a scene
 * the instanced scene itself instanced is not addressable by the §2 path grammar — its uid lives in
 * a third file — so deep edits inside a nested prefab are not written back; `flatten: true` is the
 * escape hatch.
 *
 * @param root - The instance root.
 * @param scene - The instanced scene.
 * @param references - How references resolve.
 * @param report - Receives problems.
 * @returns The overrides, in a stable order: entity records in file order, then per entity its
 * plain properties, then its components.
 */
function computeOverrides(
  root: Entity,
  scene: SceneAsset,
  references: ReferenceEncoder,
  report: (code: string, message: string) => void,
): SceneFileOverride[] {
  const current = new Map<string, Entity>();
  collectDirectMembers(root, root, current);
  const overrides: SceneFileOverride[] = [];
  const source = scene.file.entities;
  for (let index = 0; index < source.length; index += 1) {
    const record = source[index];
    if (record === undefined) {
      continue;
    }
    const entity = current.get(record.uid);
    if (entity === undefined) {
      continue;
    }
    diffEntity(entity, record, overrides, references, report);
  }
  return overrides;
}

/**
 * Collects the entities of an instance that the instanced file itself declared, keyed by the uid it
 * gave them.
 *
 * @param entity - Where to walk from.
 * @param root - The instance root.
 * @param out - Filled with source uid to entity.
 */
function collectDirectMembers(entity: Entity, root: Entity, out: Map<string, Entity>): void {
  const children = entity.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined || child.isDestroyed) {
      continue;
    }
    const origin = entityInternals(child).origin;
    if (origin !== null && origin.instanceRoot === root) {
      out.set(origin.sourceUid, child);
    }
    collectDirectMembers(child, root, out);
  }
}

/**
 * Diffs one instanced entity against its file record.
 *
 * @param entity - The runtime entity.
 * @param record - What the instanced file says it should be.
 * @param overrides - Where patches are appended.
 * @param references - How references resolve.
 * @param report - Receives problems.
 */
function diffEntity(
  entity: Entity,
  record: SceneFileEntity,
  overrides: SceneFileOverride[],
  references: ReferenceEncoder,
  report: (code: string, message: string) => void,
): void {
  const uid = record.uid;
  if (entity.name !== record.name) {
    overrides.push({ path: `${uid}/name`, value: entity.name });
  }
  if (entity.active !== (record.active ?? true)) {
    overrides.push({ path: `${uid}/active`, value: entity.active });
  }
  if (entity.isStatic !== (record.static ?? false)) {
    overrides.push({ path: `${uid}/static`, value: entity.isStatic });
  }
  const layerName = entity.world.layers.nameOf(entity.layer) ?? "Default";
  if (layerName !== (record.layer ?? "Default")) {
    overrides.push({ path: `${uid}/layer`, value: layerName });
  }
  const tags = [...entity.tags.values()].toSorted();
  if (!sameStrings(tags, record.tags ?? [])) {
    overrides.push({ path: `${uid}/tags`, value: tags });
  }
  diffTransform(entity, record, uid, overrides);
  diffComponents(entity, record, uid, overrides, references, report);
}

/**
 * Diffs an instanced entity's transform against its file record.
 *
 * @param entity - The runtime entity.
 * @param record - Its file record.
 * @param uid - The record's uid, for paths.
 * @param overrides - Where patches are appended.
 */
function diffTransform(entity: Entity, record: SceneFileEntity, uid: string, overrides: SceneFileOverride[]): void {
  const current = writeTransform(entity.transform);
  if (!sameNumbers(current.position, record.transform.position)) {
    overrides.push({ path: `${uid}/transform/position`, value: [...current.position] });
  }
  if (!sameNumbers(current.rotation, record.transform.rotation)) {
    overrides.push({ path: `${uid}/transform/rotation`, value: [...current.rotation] });
  }
  if (!sameNumbers(current.scale, record.transform.scale)) {
    overrides.push({ path: `${uid}/transform/scale`, value: [...current.scale] });
  }
}

/**
 * Diffs an instanced entity's components: added ones become `add`, removed ones `remove`, and each
 * differing prop or `enabled` flag becomes a `replace`.
 *
 * @param entity - The runtime entity.
 * @param record - Its file record.
 * @param uid - The record's uid, for paths.
 * @param overrides - Where patches are appended.
 * @param references - How references resolve.
 * @param report - Receives problems.
 */
function diffComponents(
  entity: Entity,
  record: SceneFileEntity,
  uid: string,
  overrides: SceneFileOverride[],
  references: ReferenceEncoder,
  report: (code: string, message: string) => void,
): void {
  const origin = entityInternals(entity).origin;
  const sourceUids = origin?.componentSourceUids ?? new Map<string, string>();
  const declared = record.components ?? [];
  const seen = new Set<string>();
  const components = entity.components;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined || component === entity.transform || component.isDestroyed) {
      continue;
    }
    if (component.world.registry.describe(component.constructor).typeId === null) {
      continue;
    }
    const sourceUid = sourceUids.get(component.uid);
    const written = serializeComponent(component, references, (issue) => {
      report(issue.code, issue.message);
    });
    if (sourceUid === undefined) {
      overrides.push({ op: "add", path: `${uid}/components`, value: toJson(written) });
      continue;
    }
    seen.add(sourceUid);
    const before = declared.find((candidate) => candidate.uid === sourceUid);
    if (before === undefined) {
      overrides.push({ op: "add", path: `${uid}/components`, value: toJson(written) });
      continue;
    }
    const schema = component.world.registry.describe(component.constructor).schema;
    diffProps(uid, sourceUid, before, written, schema, overrides);
  }
  for (let index = 0; index < declared.length; index += 1) {
    const before = declared[index];
    if (before !== undefined && !seen.has(before.uid)) {
      overrides.push({ op: "remove", path: `${uid}/components/${before.uid}` });
    }
  }
}

/**
 * Diffs one component's `enabled` flag and props.
 *
 * @param entityUid - The instanced entity's uid.
 * @param componentUid - The instanced component's uid.
 * @param before - What the instanced file says.
 * @param after - What the component is now.
 * @param schema - The component's declared fields, so an omitted prop compares against its default.
 * @param overrides - Where patches are appended.
 */
function diffProps(
  entityUid: string,
  componentUid: string,
  before: SceneFileComponent,
  after: SceneFileComponent,
  schema: Schema | null,
  overrides: SceneFileOverride[],
): void {
  if ((before.enabled ?? true) !== (after.enabled ?? true)) {
    overrides.push({ path: `${entityUid}/components/${componentUid}/enabled`, value: after.enabled ?? true });
  }
  const beforeProps = before.props ?? {};
  const afterProps = after.props ?? {};
  const references = ownUidEncoder();
  for (const name of Object.keys(afterProps)) {
    const next = afterProps[name] ?? null;
    // A prop the instanced file omits means "the schema default" (§2), so the comparison is against
    // the encoded default rather than against `undefined` — otherwise every terse prefab would
    // re-save with an override per field.
    const field = schema?.[name];
    const previous =
      beforeProps[name] ?? (field === undefined ? null : encodeValue(field, field.createDefault(), references));
    if (!sameJson(previous, next)) {
      overrides.push({ path: `${entityUid}/components/${componentUid}/props/${name}`, value: next });
    }
  }
}

/**
 * Encodes a component's props against its schema.
 *
 * @param component - The component.
 * @param references - How references resolve.
 * @param onIssue - Receives encoding problems.
 * @returns The props object, in schema declaration order.
 */
function encodeComponentProps(
  component: Component,
  references: ReferenceEncoder,
  onIssue?: (issue: SerializeIssue) => void,
): JsonObject {
  const schema = component.world.registry.describe(component.constructor).schema;
  if (schema === null) {
    return {};
  }
  // A schema-defined class carries exactly the schema's
  // field names as own properties, assigned by the generated base class's constructor.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const values = component as unknown as Record<string, unknown>;
  const props: Record<string, unknown> = {};
  for (const name of Object.keys(schema)) {
    props[name] = values[name];
  }
  const issues: SchemaIssue[] = [];
  // Boundary assertion (coding standards §5.2): `encodeProps` reads the bag by the schema's own
  // field names, which is exactly what was just collected.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const encoded = encodeProps(schema, props as never, references, issues);
  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index];
    if (issue !== undefined) {
      onIssue?.({ code: issue.code, message: `${component.uid}.${issue.path}: ${issue.message}` });
    }
  }
  return encoded;
}

/**
 * The `schemaVersion` a component's class declares, defaulting to `1`
 * (`docs/architecture/06-serialization-and-scene-format.md` §7).
 *
 * @param component - The component.
 * @returns The version.
 */
function schemaVersionOf(component: Component): number {
  const declared: unknown = Reflect.get(component.constructor, "schemaVersion");
  return typeof declared === "number" && Number.isInteger(declared) && declared > 0 ? declared : 1;
}

/**
 * The reference encoder standalone `serializeEntity`/`serializeComponent` use: every target
 * resolves to its own uid, because there is no file membership to test against.
 *
 * @returns The encoder.
 */
function ownUidEncoder(): ReferenceEncoder {
  return { entityUid: readUid, componentUid: readUid };
}

/**
 * Reads a reference target's own uid.
 *
 * @param value - The field value.
 * @returns Its uid, or `null` when the value is not an object carrying one.
 */
function readUid(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const uid: unknown = Reflect.get(value, "uid");
  return typeof uid === "string" ? uid : null;
}

/**
 * Views a component record as plain JSON, for an `add` override's `value`.
 *
 * @param record - The record.
 * @returns The same object, typed as JSON.
 */
function toJson(record: SceneFileComponent): JsonValue {
  // Every field of a component record is already JSON;
  // the interface exists to name the shape, not to add anything to it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return record as unknown as JsonValue;
}

/**
 * Compares two string lists.
 *
 * @param left - The first.
 * @param right - The second.
 * @returns `true` when they hold the same strings in the same order.
 */
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Compares two number lists.
 *
 * @param left - The first.
 * @param right - The second.
 * @returns `true` when they hold the same numbers in the same order.
 */
function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Compares two JSON values structurally. Both sides come out of the same canonical encoder, so
 * comparing their canonical text is exact and cheap.
 *
 * @param left - The first.
 * @param right - The second.
 * @returns `true` when they encode identically.
 */
function sameJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

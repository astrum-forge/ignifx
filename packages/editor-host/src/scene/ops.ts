/**
 * `applyOps`: the thirteen scene ops of protocol 0.3, applied to the open document's live world.
 *
 * Each op changes the world the way the editor's `applyOp` changes the document, so that a mirror
 * that started exact stays exact: `readBack` then returns the document's own records. An op that
 * the world disagrees with fails with one of editor-core's codes; the host does not roll back,
 * because the editor reopens the scene after any failure.
 */

import {
  addComponentFromRecord,
  createSceneAsset,
  decodeValue,
  encodeValue,
  instantiateScene,
  isIgnifxError,
  loadSceneDependencies,
  parseOverridePath,
  SCENE_FILE_FORMAT,
  SCENE_FORMAT_VERSION,
} from "@ignifx/core";
import { ApplyOpFailureCode } from "../protocol/index.js";
import { assignProps, copyJson, validateFields } from "./document.js";
import type { DocumentIndex, DocumentMirror } from "./document.js";
import type {
  AddComponentOp,
  ApplyOpFailure,
  ApplyOpsParams,
  ApplyOpsResult,
  CreateEntityOp,
  InstantiateOp,
  JsonPath,
  RemoveOverrideOp,
  ReparentOp,
  SceneOp,
  SetEntityFieldOp,
  SetOverrideOp,
  SetPropOp,
  SetSceneSettingOp,
  SetTransformOp,
} from "../protocol/index.js";
import type {
  App,
  Component,
  Entity,
  FieldDefinition,
  JsonObject,
  JsonValue,
  ReferenceEncoder,
  SceneFile,
  SceneFileComponent,
  SceneFileEntity,
  SceneFileInstance,
  SceneFileOverride,
} from "@ignifx/core";

/** The address the subtrees ops build are named by, in the engine's diagnostics. */
const SUBTREE_ADDRESS = "memory:scene/editor-op";

/** Why one op failed, as `applyOps` reports it. */
export class OpFailure extends Error {
  /** The failure code. */
  readonly code: ApplyOpFailureCode;

  /** The engine's diagnostic code, when there is one. */
  readonly diagnostic: string | null;

  /**
   * Creates the failure.
   *
   * @param code - The failure code.
   * @param message - An actionable sentence.
   * @param diagnostic - The engine's `IGX-` code, if any.
   */
  constructor(code: ApplyOpFailureCode, message: string, diagnostic: string | null = null) {
    super(message);
    this.name = "OpFailure";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

/** What applying ops needs: the app and the open document. */
interface OpContext {
  /** The scene view's app. */
  readonly app: App;
  /** The open document. */
  readonly mirror: DocumentMirror;
}

/**
 * Applies one command's ops in order, never stopping at a failure.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @param params - The ops and the command they belong to.
 * @returns How many applied, and the failures in order.
 */
export async function applyOps(app: App, mirror: DocumentMirror, params: ApplyOpsParams): Promise<ApplyOpsResult> {
  const context: OpContext = { app, mirror };
  const failures: ApplyOpFailure[] = [];
  let applied = 0;
  for (const [index, op] of params.ops.entries()) {
    try {
      // Ops apply in order, each against the world the previous one left.
      // oxlint-disable-next-line no-await-in-loop -- see above
      await applyOp(context, op);
      applied += 1;
    } catch (error) {
      const failure = toFailure(index, error);
      failures.push(failure);
      app.log.warn(
        `applyOps ${params.commandId} (${params.commandName}): op ${String(index)} (${op.op}) failed: ${failure.code}: ${failure.message}`,
      );
    } finally {
      mirror.invalidate();
    }
  }
  return { applied, failures };
}

/**
 * Turns whatever an op threw into its failure record.
 *
 * @param index - The op's index.
 * @param error - What it threw.
 * @returns The failure.
 */
function toFailure(index: number, error: unknown): ApplyOpFailure {
  if (error instanceof OpFailure) {
    return {
      index,
      code: error.code,
      message: error.message,
      ...(error.diagnostic === null ? {} : { diagnostic: error.diagnostic }),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    index,
    code: ApplyOpFailureCode.engineError,
    message,
    ...(isIgnifxError(error) ? { diagnostic: error.code } : {}),
  };
}

/**
 * Applies one op.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
async function applyOp(context: OpContext, op: SceneOp): Promise<void> {
  switch (op.op) {
    case "createEntity": {
      await createEntity(context, op);
      return;
    }
    case "destroyEntity": {
      requireEntity(context, op.entity).destroyImmediate();
      return;
    }
    case "reparent": {
      reparent(context, op);
      return;
    }
    case "reorder": {
      const entity = requireEntity(context, op.entity);
      placeAmongSiblings(context, entity, op.index);
      return;
    }
    case "setEntityField": {
      setEntityField(context, op);
      return;
    }
    case "setTransform": {
      setTransform(requireEntity(context, op.entity), op);
      return;
    }
    case "addComponent": {
      await addComponent(context, op);
      return;
    }
    case "removeComponent": {
      const component = requireComponent(context, op.component);
      component.entity.removeComponent(component);
      return;
    }
    case "setProp": {
      await setProp(context, op);
      return;
    }
    case "setSceneSetting": {
      setSceneSetting(context, op);
      return;
    }
    case "instantiate": {
      await instantiate(context, op);
      return;
    }
    case "setOverride": {
      await setOverride(context, op);
      return;
    }
    case "removeOverride": {
      await removeOverride(context, op);
      return;
    }
    default: {
      throw new OpFailure(ApplyOpFailureCode.invalidOp, "Not an op of the scene op vocabulary.");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

/**
 * The document's index; the scene methods only call `applyOps` with a document open.
 *
 * @param context - The app and the document.
 * @returns The index.
 */
function indexOf(context: OpContext): DocumentIndex {
  const index = context.mirror.index();
  if (index === null) {
    throw new OpFailure(ApplyOpFailureCode.unknownEntity, "No scene is open.");
  }
  return index;
}

/**
 * A document entity by uid.
 *
 * @param context - The app and the document.
 * @param uid - The uid.
 * @returns The entity.
 */
function requireEntity(context: OpContext, uid: string): Entity {
  const entity = indexOf(context).entities.get(uid);
  if (entity === undefined || entity.isDestroyed) {
    throw new OpFailure(ApplyOpFailureCode.unknownEntity, `No entity ${uid} is in the open scene.`);
  }
  return entity;
}

/**
 * A document component by uid.
 *
 * @param context - The app and the document.
 * @param uid - The uid.
 * @returns The component.
 */
function requireComponent(context: OpContext, uid: string): Component {
  const component = indexOf(context).components.get(uid);
  if (component === undefined || component.isDestroyed) {
    throw new OpFailure(ApplyOpFailureCode.unknownComponent, `No component ${uid} is in the open scene.`);
  }
  return component;
}

/**
 * A parent named by an op: a document entity, or `null` for the scene's roots.
 *
 * @param context - The app and the document.
 * @param uid - The parent's uid, or `null`.
 * @returns The parent entity, or `null`.
 */
function requireParent(context: OpContext, uid: string | null): Entity | null {
  if (uid === null) {
    return null;
  }
  const parent = indexOf(context).entities.get(uid);
  if (parent === undefined || parent.isDestroyed) {
    throw new OpFailure(ApplyOpFailureCode.invalidParent, `The parent ${uid} is not in the open scene.`);
  }
  return parent;
}

/**
 * The document entities among a parent's children, or among the scene's roots.
 *
 * @param context - The app and the document.
 * @param parent - The parent, or `null` for the roots.
 * @param except - An entity to leave out, the one being moved.
 * @returns The document siblings, in order.
 */
function documentSiblings(context: OpContext, parent: Entity | null, except: Entity | null): Entity[] {
  const index = indexOf(context);
  const siblings = parent === null ? (context.mirror.scene?.roots ?? []) : parent.children;
  return siblings.filter((sibling) => sibling !== except && index.entities.get(sibling.uid) === sibling);
}

/**
 * Checks an insertion index against the document siblings it positions among.
 *
 * @param index - The index, or `undefined` for the end.
 * @param count - How many document siblings there are, the moved entity left out.
 * @returns The index to use.
 */
function checkIndex(index: number | undefined, count: number): number {
  if (index === undefined) {
    return count;
  }
  if (index > count) {
    throw new OpFailure(
      ApplyOpFailureCode.invalidIndex,
      `Index ${String(index)} is past the end of a list of ${String(count)}.`,
    );
  }
  return index;
}

/**
 * Moves an entity to an index among its document siblings. Members of an instanced scene under the
 * same parent keep their places; the document does not list them.
 *
 * @param context - The app and the document.
 * @param entity - The entity, already under its final parent.
 * @param index - Its index among the document siblings, or `undefined` for the end.
 */
function placeAmongSiblings(context: OpContext, entity: Entity, index: number | undefined): void {
  const others = documentSiblings(context, entity.parent, entity);
  const at = checkIndex(index, others.length);
  const all = (entity.parent === null ? (context.mirror.scene?.roots ?? []) : entity.parent.children).filter(
    (sibling) => sibling !== entity,
  );
  const before = others[at];
  const last = others.at(-1);
  const target = before === undefined ? (last === undefined ? all.length : all.indexOf(last) + 1) : all.indexOf(before);
  entity.setSiblingIndex(target);
}

// ---------------------------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------------------------

/**
 * Checks that every component type a set of records names is registered, before anything is built.
 *
 * @param context - The app and the document.
 * @param components - The component records.
 */
function requireTypes(context: OpContext, components: readonly SceneFileComponent[]): void {
  for (const component of components) {
    if (context.app.world.registry.get(component.type) === null) {
      throw new OpFailure(
        ApplyOpFailureCode.engineError,
        `The component type "${component.type}" is not registered; register it with app.registerComponents or check its typeId.`,
        "IGX-0307",
      );
    }
  }
}

/**
 * Checks that new entity and component uids are free in the world and in the document.
 *
 * @param context - The app and the document.
 * @param records - The new entity records.
 */
function requireFreeUids(context: OpContext, records: readonly SceneFileEntity[]): void {
  const index = indexOf(context);
  const seen = new Set<string>();
  const claim = (uid: string, taken: boolean): void => {
    if (taken || seen.has(uid)) {
      throw new OpFailure(ApplyOpFailureCode.duplicateUid, `The uid ${uid} is already in use.`);
    }
    seen.add(uid);
  };
  for (const record of records) {
    claim(record.uid, context.app.world.getEntity(record.uid) !== null);
    for (const component of record.components ?? []) {
      claim(component.uid, index.components.has(component.uid));
    }
  }
}

/**
 * Tells whether JSON holds an entity or component reference anywhere.
 *
 * @param value - The JSON.
 * @returns True when a `$entity` or `$component` object is in it.
 */
function hasReferences(value: JsonValue | undefined): boolean {
  const array = asJsonArray(value);
  if (array !== null) {
    return array.some((item) => hasReferences(item));
  }
  const object = asJsonObject(value);
  return (
    object !== null &&
    ("$entity" in object || "$component" in object || Object.values(object).some((item) => hasReferences(item)))
  );
}

/**
 * Builds a subtree from entity records under a live parent, with the records' uids, loading the
 * assets they reference first; then resolves references to the rest of the document, which a
 * subtree built on its own cannot see.
 *
 * @param context - The app and the document.
 * @param records - The subtree's records, parents first; the first is its root.
 * @param parent - The live parent, or `null` for a root of the scene.
 * @param index - The root's index among its document siblings, or `undefined` for the end.
 * @returns The subtree's root.
 */
async function buildSubtree(
  context: OpContext,
  records: readonly SceneFileEntity[],
  parent: Entity | null,
  index: number | undefined,
): Promise<Entity> {
  const [top, ...rest] = records;
  const scene = context.mirror.scene;
  if (top === undefined || scene === null) {
    throw new OpFailure(ApplyOpFailureCode.invalidOp, "There is nothing to build.");
  }
  const file: SceneFile = {
    format: SCENE_FILE_FORMAT,
    formatVersion: SCENE_FORMAT_VERSION,
    name: top.name,
    entities: [{ ...top, parent: null }, ...rest],
  };
  const dependencies = await loadSceneDependencies(context.app.assets, file);
  context.mirror.retain(dependencies);
  const asset = await createSceneAsset(SUBTREE_ADDRESS, file, dependencies);
  const built = instantiateScene(context.app.world, asset, { scene, ...(parent === null ? {} : { parent }) });
  context.mirror.invalidate();
  const references = context.mirror.decoder(built.remap);
  for (const record of file.entities) {
    for (const component of record.components ?? []) {
      const live = built.remap.component(component.uid);
      if (live !== null && hasReferences(component.props)) {
        assignProps(live, component.props ?? {}, references);
      }
    }
  }
  const root = built.roots[0] ?? built.remap.entity(top.uid);
  if (root === null) {
    throw new OpFailure(ApplyOpFailureCode.engineError, `The engine built no entity for ${top.uid}.`);
  }
  placeAmongSiblings(context, root, index);
  return root;
}

/**
 * Applies `createEntity`: the entity and its descendants, with their uids and components.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
async function createEntity(context: OpContext, op: CreateEntityOp): Promise<void> {
  const records = [op.entity, ...(op.descendants ?? [])];
  const parent = requireParent(context, op.entity.parent);
  checkIndex(op.index, documentSiblings(context, parent, null).length);
  requireFreeUids(context, records);
  const inside = new Set([op.entity.uid]);
  for (const record of op.descendants ?? []) {
    if (record.parent === null || !inside.has(record.parent)) {
      throw new OpFailure(
        ApplyOpFailureCode.invalidParent,
        `${record.uid} must be the child of an entity created before it in the same op.`,
      );
    }
    inside.add(record.uid);
  }
  const components = records.flatMap((record) => record.components ?? []);
  requireTypes(context, components);
  await buildSubtree(context, records, parent, op.index);
  context.mirror.recordComponents(components);
  context.mirror.recordInstances(records);
}

/**
 * Applies `reparent`: the new parent, keeping the local transform, at an index.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
function reparent(context: OpContext, op: ReparentOp): void {
  const entity = requireEntity(context, op.entity);
  const parent = requireParent(context, op.parent);
  if (parent !== null && (parent === entity || parent.isDescendantOf(entity))) {
    throw new OpFailure(ApplyOpFailureCode.invalidParent, `${entity.name} cannot move under its own subtree.`);
  }
  checkIndex(op.index, documentSiblings(context, parent, entity).length);
  entity.setParent(parent, { worldPositionStays: false });
  placeAmongSiblings(context, entity, op.index);
}

/**
 * Applies `setEntityField`.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
function setEntityField(context: OpContext, op: SetEntityFieldOp): void {
  const entity = requireEntity(context, op.entity);
  switch (op.field) {
    case "name": {
      entity.name = op.value;
      return;
    }
    case "active": {
      entity.active = op.value;
      return;
    }
    case "static": {
      entity.isStatic = op.value;
      return;
    }
    case "layer": {
      const layer = context.app.world.layers.indexOf(op.value);
      if (layer < 0) {
        throw new OpFailure(
          ApplyOpFailureCode.invalidValue,
          `"${op.value}" is not a layer of this project.`,
          "IGX-0303",
        );
      }
      entity.layer = layer;
      return;
    }
    case "tags": {
      entity.tags.clear();
      for (const tag of op.value) {
        entity.tags.add(tag);
      }
      return;
    }
    default: {
      throw new OpFailure(ApplyOpFailureCode.invalidOp, "Not an entity field.");
    }
  }
}

/**
 * Applies `setTransform`: the local position, rotation and scale. `before` is ignored.
 *
 * @param entity - The entity.
 * @param op - The op.
 */
function setTransform(entity: Entity, op: SetTransformOp): void {
  const { position, rotation, scale } = op.after;
  const transform = entity.transform;
  transform.localPosition.set(position[0], position[1], position[2]);
  transform.localRotation.set(rotation[0], rotation[1], rotation[2], rotation[3]);
  transform.localScale.set(scale[0], scale[1], scale[2]);
}

/**
 * The number of components an entity lists in the document.
 *
 * @param context - The app and the document.
 * @param entity - The entity.
 * @returns The length of its record's `components`.
 */
function documentComponentCount(context: OpContext, entity: Entity): number {
  return indexOf(context).records.get(entity.uid)?.components?.length ?? 0;
}

/**
 * Loads the assets a value references, and keeps them for the document.
 *
 * @param context - The app and the document.
 * @param props - The JSON that may name assets.
 */
async function loadAssets(context: OpContext, props: JsonValue | undefined): Promise<void> {
  if (props === undefined) {
    return;
  }
  // The scene loader's own walk, over a one-entity file that carries the value as props.
  const file: SceneFile = {
    format: SCENE_FILE_FORMAT,
    formatVersion: SCENE_FORMAT_VERSION,
    name: "props",
    entities: [
      {
        uid: "props",
        name: "props",
        parent: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: [{ uid: "props", type: "props", props: { value: props } }],
      },
    ],
  };
  context.mirror.retain(await loadSceneDependencies(context.app.assets, file));
}

/**
 * Applies `addComponent`: the registered type, with its uid, `enabled` and decoded props, at an index.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
async function addComponent(context: OpContext, op: AddComponentOp): Promise<void> {
  const entity = requireEntity(context, op.entity);
  if (indexOf(context).components.has(op.component.uid)) {
    throw new OpFailure(ApplyOpFailureCode.duplicateUid, `The uid ${op.component.uid} is already in use.`);
  }
  checkIndex(op.index, documentComponentCount(context, entity));
  requireTypes(context, [op.component]);
  await loadAssets(context, op.component.props);
  const { issues } = addComponentFromRecord(entity, op.component, {
    ...(op.index === undefined ? {} : { index: op.index }),
    references: context.mirror.decoder(),
  });
  context.mirror.recordComponents([op.component]);
  const first = issues[0];
  if (first !== undefined) {
    throw new OpFailure(ApplyOpFailureCode.invalidValue, first.message, first.code);
  }
}

/**
 * Applies `instantiate`: an instance root, built from its scene asset.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
async function instantiate(context: OpContext, op: InstantiateOp): Promise<void> {
  const parent = requireParent(context, op.parent);
  checkIndex(op.index, documentSiblings(context, parent, null).length);
  const record: SceneFileEntity = {
    uid: op.entity,
    name: op.name,
    parent: op.parent,
    transform: op.transform,
    instance: op.instance,
  };
  requireFreeUids(context, [record]);
  await buildSubtree(context, [record], parent, op.index);
  context.mirror.recordInstances([record]);
}

// ---------------------------------------------------------------------------------------------
// Props and settings
// ---------------------------------------------------------------------------------------------

/**
 * The uid of a referenced entity or component.
 *
 * @param target - The field's value.
 * @returns Its uid, or `null` for anything without one.
 */
function uidOf(target: unknown): string | null {
  const uid: unknown = typeof target === "object" && target !== null ? Reflect.get(target, "uid") : null;
  return typeof uid === "string" ? uid : null;
}

/**
 * Reads a schema field's current value as JSON, references written as the uids they point at.
 *
 * @param field - The field.
 * @param value - The live value.
 * @returns The JSON.
 */
function encodeLive(field: FieldDefinition<unknown>, value: unknown): JsonValue {
  const references: ReferenceEncoder = { entityUid: uidOf, componentUid: uidOf };
  return encodeValue(field, value, references);
}

/**
 * Narrows JSON to an object. `Array.isArray` does not remove a readonly array from the union, so the
 * discrimination lives here once.
 *
 * @param value - The JSON.
 * @returns The object, or `null` for anything else.
 */
function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // The guard above leaves exactly `JsonObject` of the `JsonValue` union.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as JsonObject;
}

/**
 * Narrows JSON to an array.
 *
 * @param value - The JSON.
 * @returns The array, or `null`.
 */
function asJsonArray(value: JsonValue | undefined): readonly JsonValue[] | null {
  return Array.isArray(value) ? value : null;
}

/**
 * Returns JSON with the value at a path set, or removed, leaving the input unchanged.
 *
 * @param container - The JSON the path starts in.
 * @param path - The steps, at least one: object keys and array indices.
 * @param value - The new value, or `undefined` to remove the key or the array item.
 * @returns The new JSON.
 */
function withValueAt(container: JsonValue, path: JsonPath, value: JsonValue | undefined): JsonValue {
  const [step, ...rest] = path;
  const array = asJsonArray(container);
  if (array !== null && typeof step === "number" && step <= array.length) {
    const copy = [...array];
    if (rest.length > 0) {
      const next = copy[step];
      if (next === undefined) {
        throw invalidPath(path);
      }
      copy[step] = withValueAt(next, rest, value);
    } else if (value === undefined) {
      copy.splice(step, 1);
    } else {
      copy[step] = value;
    }
    return copy;
  }
  const object = asJsonObject(container);
  if (object !== null && typeof step === "string") {
    if (rest.length > 0) {
      // Own keys only: an inherited one, such as `__proto__`, is not in the document.
      const next = Object.hasOwn(object, step) ? object[step] : undefined;
      if (next === undefined) {
        throw invalidPath(path);
      }
      return { ...object, [step]: withValueAt(next, rest, value) };
    }
    const others = Object.entries(object).filter(([key]) => key !== step);
    return Object.fromEntries(value === undefined ? others : [...others, [step, value]]);
  }
  throw invalidPath(path);
}

/**
 * The failure for a path that does not resolve.
 *
 * @param path - The path.
 * @returns The failure.
 */
function invalidPath(path: JsonPath): OpFailure {
  return new OpFailure(ApplyOpFailureCode.invalidPath, `The path ${JSON.stringify(path)} does not resolve.`);
}

/**
 * Applies `setProp`: the value at a path of a component's props, decoded with the field's schema
 * and assigned, the way the inspector writes a field.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
async function setProp(context: OpContext, op: SetPropOp): Promise<void> {
  const component = requireComponent(context, op.component);
  const schema = context.app.world.registry.describe(component.constructor).schema;
  if (schema === null) {
    throw new OpFailure(ApplyOpFailureCode.invalidPath, `${op.component} has no props.`);
  }
  await loadAssets(context, op.value);
  const references = context.mirror.decoder();
  const [name, ...rest] = op.path;
  if (name === undefined) {
    const props = op.value === undefined ? {} : asJsonObject(op.value);
    if (props === null) {
      throw new OpFailure(ApplyOpFailureCode.invalidValue, "props must be an object.");
    }
    rejectIssues(assignProps(component, props, references));
    context.mirror.recordProps(op.component, Object.keys(props));
    validateFields(component, Object.keys(schema));
    return;
  }
  const field = typeof name === "string" && Object.hasOwn(schema, name) ? schema[name] : undefined;
  if (typeof name !== "string" || field === undefined) {
    throw new OpFailure(ApplyOpFailureCode.invalidPath, `${String(name)} is not a field of ${op.component}.`);
  }
  if (rest.length === 0 && op.value === undefined) {
    Reflect.set(component, name, field.createDefault());
    context.mirror.recordProp(op.component, name, false);
    validateFields(component, [name]);
    return;
  }
  const json =
    rest.length > 0 ? withValueAt(encodeLive(field, Reflect.get(component, name)), rest, op.value) : op.value;
  const decoded = decodeValue(field, json ?? null, references);
  rejectIssues(
    decoded.issues.map((issue) => ({
      code: issue.code,
      message: `${op.component}.${name}${issue.path === "" ? "" : `.${issue.path}`}: ${issue.message}`,
    })),
  );
  Reflect.set(component, name, decoded.value);
  context.mirror.recordProp(op.component, name, true);
  validateFields(component, [name]);
}

/**
 * Fails the op on the first decoding problem: the value the field got is not the document's.
 *
 * @param issues - The problems.
 */
function rejectIssues(issues: readonly { readonly code: string; readonly message: string }[]): void {
  const first = issues[0];
  if (first !== undefined) {
    throw new OpFailure(ApplyOpFailureCode.invalidValue, first.message, first.code);
  }
}

/**
 * Applies `setSceneSetting`: the value at a path of the scene's settings.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
function setSceneSetting(context: OpContext, op: SetSceneSettingOp): void {
  const mirror = context.mirror;
  const next = op.path.length === 0 ? (op.value ?? null) : withValueAt(mirror.settings ?? {}, op.path, op.value);
  const settings = next === null ? null : asJsonObject(next);
  if (next !== null && settings === null) {
    throw new OpFailure(ApplyOpFailureCode.invalidValue, "settings must be an object.");
  }
  mirror.settings = settings === null ? null : copyJson(settings);
}

// ---------------------------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------------------------

/** The op of an override. */
type OverrideOp = "replace" | "remove" | "add";

/**
 * The kind an override path parses to.
 *
 * @param path - The path.
 * @returns The kind, or `null` when the engine's grammar refuses it.
 */
function overrideKind(path: string): string | null {
  try {
    return parseOverridePath(path).kind;
  } catch {
    return null;
  }
}

/**
 * The op an override path implies when none is given, as editor-core reads it.
 *
 * @param path - The path.
 * @returns `"add"` for a component list, `"remove"` for a whole component, else `"replace"`.
 */
function impliedOp(path: string): OverrideOp {
  const kind = overrideKind(path);
  return kind === "componentList" ? "add" : kind === "component" ? "remove" : "replace";
}

/**
 * The uid of the component an `add` override adds.
 *
 * @param override - The override.
 * @returns The uid, or `null`.
 */
function addedUid(override: SceneFileOverride): string | null {
  const uid = asJsonObject(override.value)?.["uid"];
  return (override.op ?? "replace") === "add" && typeof uid === "string" ? uid : null;
}

/**
 * Finds an override by editor-core's identity: its path and op, and for a component `add` the
 * added uid.
 *
 * @param overrides - The list.
 * @param path - The path.
 * @param op - The op.
 * @param added - The added uid, for a component `add`.
 * @returns The index, or `-1`.
 */
function findOverride(
  overrides: readonly SceneFileOverride[],
  path: string,
  op: OverrideOp,
  added: string | null,
): number {
  return overrides.findIndex(
    (candidate) =>
      candidate.path === path &&
      (candidate.op ?? "replace") === op &&
      (overrideKind(path) !== "componentList" || addedUid(candidate) === added),
  );
}

/**
 * Rebuilds an instance root's subtree with an edited override list: the live world has no way to
 * re-apply one override, so the root and its document children are serialized, destroyed and built
 * again from the instanced scene with the new list. References from the rest of the document into
 * the rebuilt subtree are resolved again.
 *
 * The root and the instance roots under it are built with the override lists the document holds, and
 * the edit applies to the root's: the serializer recomputes a list by diffing the live members with
 * their scene, which writes an added component as its whole record and drops an override that
 * matches the scene, so a list read from it no longer follows a default or a prefab the document
 * leaves to them.
 *
 * @param context - The app and the document.
 * @param uid - The instance root.
 * @param edit - Returns the new override list from the document's current one.
 */
async function rebuildInstance(
  context: OpContext,
  uid: string,
  edit: (overrides: readonly SceneFileOverride[]) => readonly SceneFileOverride[],
): Promise<void> {
  const index = indexOf(context);
  const root = requireEntity(context, uid);
  const mirror = context.mirror;
  const withDocumentOverrides = (record: SceneFileEntity): SceneFileEntity => {
    const listed = record.instance === undefined ? null : mirror.overridesOf(record.uid);
    if (listed === null || record.instance === undefined) {
      return record;
    }
    const { scene, hash } = record.instance;
    const instance: SceneFileInstance = {
      scene,
      ...(hash === undefined ? {} : { hash }),
      ...(listed.length === 0 ? {} : { overrides: listed }),
    };
    return { ...record, instance };
  };
  const found = index.records.get(uid);
  const record = found === undefined ? undefined : withDocumentOverrides(found);
  const instance = record?.instance;
  if (record === undefined || instance === undefined) {
    throw new OpFailure(ApplyOpFailureCode.notAnInstance, `${root.name} (${uid}) has no instance entry.`);
  }
  const overrides = edit(instance.overrides ?? []);
  const top: SceneFileEntity = {
    ...record,
    instance: {
      scene: instance.scene,
      ...(instance.hash === undefined ? {} : { hash: instance.hash }),
      ...(overrides.length === 0 ? {} : { overrides }),
    },
  };
  const inside = new Set([uid]);
  const records: SceneFileEntity[] = [top];
  for (const candidate of index.file.entities) {
    if (candidate.parent !== null && inside.has(candidate.parent)) {
      inside.add(candidate.uid);
      records.push(withDocumentOverrides(candidate));
    }
  }
  const insideComponents = new Set(
    records.flatMap((entry_) => (entry_.components ?? []).map((component) => component.uid)),
  );
  const parent = root.parent;
  const at = documentSiblings(context, parent, null).indexOf(root);
  root.destroyImmediate();
  context.mirror.invalidate();
  await buildSubtree(context, records, parent, at);
  mirror.recordInstances(records);
  const references = context.mirror.decoder();
  const rebuilt = indexOf(context);
  for (const outside of index.file.entities) {
    if (inside.has(outside.uid)) {
      continue;
    }
    for (const component of outside.components ?? []) {
      const live = rebuilt.components.get(component.uid);
      if (live !== undefined && pointsInto(component.props, inside, insideComponents)) {
        assignProps(live, component.props ?? {}, references);
      }
    }
  }
}

/**
 * Rebuilds one instance root from its scene asset's current value, keeping its uid, its record
 * (transform, overrides, components) and its document children, as `setOverride` does: what the
 * host does after a hot reload replaced the scene the root instances, or changed a default its
 * members leave out.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @param uid - The instance root.
 * @throws OpFailure when the uid names no document entity or one without an instance entry.
 */
export async function reloadInstance(app: App, mirror: DocumentMirror, uid: string): Promise<void> {
  try {
    await rebuildInstance({ app, mirror }, uid, (overrides) => overrides);
  } finally {
    mirror.invalidate();
  }
}

/**
 * Tells whether JSON references an entity or component of a set.
 *
 * @param value - The JSON.
 * @param entities - The entity uids.
 * @param components - The component uids.
 * @returns True when a `$entity` or `$component` names one of them.
 */
function pointsInto(
  value: JsonValue | undefined,
  entities: ReadonlySet<string>,
  components: ReadonlySet<string>,
): boolean {
  const array = asJsonArray(value);
  if (array !== null) {
    return array.some((item) => pointsInto(item, entities, components));
  }
  const object = asJsonObject(value);
  if (object === null) {
    return false;
  }
  const entity = object["$entity"];
  const component = object["$component"];
  return (
    (typeof entity === "string" && entities.has(entity)) ||
    (typeof component === "string" && components.has(component)) ||
    Object.values(object).some((item) => pointsInto(item, entities, components))
  );
}

/**
 * Applies `setOverride`: replaces the override with the same identity, or inserts it.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
async function setOverride(context: OpContext, op: SetOverrideOp): Promise<void> {
  const override = op.override;
  if (overrideKind(override.path) === null) {
    throw new OpFailure(
      ApplyOpFailureCode.invalidPath,
      `"${override.path}" is not an override path the engine can apply.`,
      "IGX-0609",
    );
  }
  await loadAssets(context, override.value);
  await rebuildInstance(context, op.entity, (overrides) => {
    const next = [...overrides];
    const existing = findOverride(next, override.path, override.op ?? "replace", addedUid(override));
    if (existing >= 0) {
      if (op.index !== undefined && op.index !== existing) {
        throw new OpFailure(
          ApplyOpFailureCode.invalidIndex,
          `The override already exists at index ${String(existing)}.`,
        );
      }
      next[existing] = override;
      return next;
    }
    next.splice(checkIndex(op.index, next.length), 0, override);
    return next;
  });
}

/**
 * Applies `removeOverride`.
 *
 * @param context - The app and the document.
 * @param op - The op.
 */
async function removeOverride(context: OpContext, op: RemoveOverrideOp): Promise<void> {
  await rebuildInstance(context, op.entity, (overrides) => {
    const next = [...overrides];
    const at = findOverride(next, op.path, op.overrideOp ?? impliedOp(op.path), op.added ?? null);
    if (at < 0) {
      throw new OpFailure(ApplyOpFailureCode.unknownOverride, `The instance has no override at "${op.path}".`);
    }
    next.splice(at, 1);
    return next;
  });
}

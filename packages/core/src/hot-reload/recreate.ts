/**
 * The `"recreate"` policy: `static hotReload = "recreate"`
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * Every live instance is serialized through its schema, destroyed through the ordinary destroy
 * flush (`onDisable`, then `onDestroy`, then `onDetach`, and every coroutine it started cancelled),
 * and rebuilt from the replacement class on the same entity, at the same position in
 * `entity.components`, carrying the same uid — so `awake`, `onEnable`, and `start` run again in the
 * usual frames, and the file the scene was loaded from still addresses the component it did before.
 *
 * Two deliberate decisions this file makes:
 *
 * - **`asset()` fields carry their live handle across rather than their address.** An asset handle
 *   is a runtime object with a reference count, and the round trip through the file form cannot
 *   improve on its identity — it can only lose it, because an in-code `memory:` asset
 *   (`MeshAsset.box`, `MaterialAsset.pbr`) has no address a reader could resolve
 *   (`06-serialization-and-scene-format.md` §5). Everything else goes through
 *   `encodeProps`/`decodeProps`, which is what drops `transient` fields and fields the replacement
 *   no longer declares.
 * - **Inbound tracked references are re-pointed.** The destroy flush nulls every `entityRef` and
 *   `componentRef` aimed at a component it releases (`02-scene-graph.md` §4), so the holders are
 *   recorded before the flush and pointed at the replacement afterwards. Plain, untracked class
 *   fields holding the old instance are *not* fixed up — the engine does not know about them, which
 *   is the same rule that applies to an ordinary destroy.
 */

import { Component } from "../component/component.js";
import { componentInternals } from "../component/internals.js";
import { entityInternals } from "../entity/internals.js";
import { decodeProps, encodeProps } from "../schema/encode.js";
import type { ComponentClassInfo } from "../component/component-registry.js";
import type { ConcreteComponentType } from "../component/component-type.js";
import type { Entity } from "../entity/entity.js";
import type { ReferenceDecoder, ReferenceEncoder } from "../schema/encode.js";
import type { SchemaIssue } from "../schema/issues.js";
import type { JsonObject } from "../schema/json.js";
import type { Schema } from "../schema/types.js";
import type { World } from "../world/world.js";

/** One holder field that pointed at a component about to be destroyed. */
interface InboundReference {
  /** The component whose tracked field held the reference. */
  readonly holder: Component;
  /** The field name. */
  readonly field: string;
}

/** Everything remembered about one instance between its destruction and its replacement. */
interface Snapshot {
  /** The entity it lived on. */
  readonly entity: Entity;
  /** Where it sat in `entity.components`. */
  readonly index: number;
  /** Its stable uid, reused so that files and tracked references still address it. */
  readonly uid: string;
  /** Its own `enabled` flag. */
  readonly enabled: boolean;
  /** The schema round trip of its fields, minus the `asset()` ones. */
  readonly props: JsonObject;
  /** The live handles of its `asset()` fields, by field name. */
  readonly assets: ReadonlyMap<string, unknown>;
  /** Every tracked field that pointed at it. */
  readonly inbound: readonly InboundReference[];
}

/**
 * Destroys every live instance of a class and rebuilds it from the replacement.
 *
 * @param world - The world the instances live in.
 * @param previous - The class info they were filed under.
 * @param nextType - The replacement class.
 * @param next - The replacement's class info, already registered.
 * @param instances - The instances to rebuild; a snapshot, because the store buckets are rewritten.
 * @param onIssue - Receives every schema problem found on the way, one message per problem.
 * @returns How many instances were rebuilt.
 *
 * @internal
 */
export function recreateInstances(
  world: World,
  previous: ComponentClassInfo,
  nextType: ConcreteComponentType,
  next: ComponentClassInfo,
  instances: readonly Component[],
  onIssue: (message: string) => void,
): number {
  const snapshots: Snapshot[] = [];
  for (let index = 0; index < instances.length; index += 1) {
    const component = instances[index];
    if (component === undefined || componentInternals(component).isReleased) {
      continue;
    }
    const snapshot = capture(world, component, previous.schema, onIssue);
    if (snapshot !== null) {
      snapshots.push(snapshot);
      component.entity.removeComponent(component);
    }
  }
  if (snapshots.length === 0) {
    return 0;
  }
  // One flush for the whole class: `onDisable`, `onDestroy`, `onDetach`, coroutine cancellation,
  // and the tracked-reference nulling all happen here, before anything is rebuilt.
  world.lifecycle.flushDestroy();

  const created: Component[] = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (snapshot === undefined || snapshot.entity.isDestroyed) {
      continue;
    }
    const component = snapshot.entity.addComponent(nextType);
    componentInternals(component).uid = snapshot.uid;
    moveToIndex(snapshot.entity, component, snapshot.index);
    created.push(component);
  }
  // Props are applied only once every replacement exists, so two instances of the class that
  // reference each other both resolve.
  const decoder = worldDecoder(world);
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    const component = created[index];
    if (snapshot === undefined || component === undefined) {
      continue;
    }
    restore(component, next.schema, snapshot, decoder, onIssue);
    for (let inbound = 0; inbound < snapshot.inbound.length; inbound += 1) {
      repoint(snapshot.inbound[inbound], component);
    }
    if (!snapshot.enabled) {
      component.enabled = false;
    }
  }
  return created.length;
}

/**
 * Records everything needed to rebuild one instance.
 *
 * @param world - The world.
 * @param component - The instance about to be destroyed.
 * @param schema - Its class's schema, or `null` when it declares none.
 * @param onIssue - Receives encoding problems.
 * @returns The snapshot, or `null` when the component is not attached to an entity.
 */
function capture(
  world: World,
  component: Component,
  schema: Schema | null,
  onIssue: (message: string) => void,
): Snapshot | null {
  const state = componentInternals(component);
  const entity = state.entity;
  if (entity === null) {
    return null;
  }
  const values = fieldBag(component);
  const assets = new Map<string, unknown>();
  const encoded: Record<string, unknown> = {};
  if (schema !== null) {
    for (const [name, field] of Object.entries(schema)) {
      if (field.spec.kind === "asset") {
        assets.set(name, values[name] ?? null);
        continue;
      }
      encoded[name] = values[name];
    }
  }
  const issues: SchemaIssue[] = [];
  // Boundary assertion (coding standards §5.2): `encodeProps` reads the bag by the schema's own
  // field names, which is exactly what was just collected — the same invariant `serializeComponent`
  // relies on.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const bag = encoded as never;
  const props = schema === null ? EMPTY_PROPS : encodeProps(withoutAssets(schema), bag, OWN_UID_ENCODER, issues);
  report(issues, state.uid, onIssue);
  return {
    entity,
    index: entityInternals(entity).components.indexOf(component),
    uid: state.uid,
    enabled: state.enabled,
    props,
    assets,
    inbound: collectInbound(world, component),
  };
}

/**
 * Writes a snapshot's fields onto the replacement instance.
 *
 * @param component - The replacement.
 * @param schema - The replacement class's schema, or `null`.
 * @param snapshot - What was captured.
 * @param decoder - How uids and addresses resolve back to live objects.
 * @param onIssue - Receives decoding problems.
 */
function restore(
  component: Component,
  schema: Schema | null,
  snapshot: Snapshot,
  decoder: ReferenceDecoder,
  onIssue: (message: string) => void,
): void {
  if (schema === null) {
    return;
  }
  const target = fieldBag(component);
  const decoded = decodeProps(withoutAssets(schema), snapshot.props, decoder);
  report(decoded.issues, snapshot.uid, onIssue);
  // Boundary assertion (coding standards §5.2): the read side of the same invariant.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const values = decoded.value as Record<string, unknown>;
  for (const [name, field] of Object.entries(schema)) {
    if (field.spec.kind === "asset") {
      const carried = snapshot.assets.get(name);
      if (carried !== undefined) {
        target[name] = carried;
      }
      continue;
    }
    target[name] = values[name];
  }
}

/** The props of a class that declares no schema. */
const EMPTY_PROPS: JsonObject = Object.freeze({});

/**
 * A schema with its `asset()` fields removed, so the round trip never sees them.
 *
 * @param schema - The full schema.
 * @returns The same schema when it declares no asset field, or a copy without them.
 */
function withoutAssets(schema: Schema): Schema {
  let hasAsset = false;
  for (const field of Object.values(schema)) {
    if (field.spec.kind === "asset") {
      hasAsset = true;
      break;
    }
  }
  if (!hasAsset) {
    return schema;
  }
  const trimmed: Record<string, (typeof schema)[string]> = {};
  for (const [name, field] of Object.entries(schema)) {
    if (field.spec.kind !== "asset") {
      trimmed[name] = field;
    }
  }
  return trimmed;
}

/**
 * Views a component as the bag of schema-named properties its generated base class assigned.
 *
 * @param component - The component.
 * @returns The same object, typed for named reads and writes.
 */
function fieldBag(component: Component): Record<string, unknown> {
  // Boundary assertion (coding standards §5.2): the invariant the serializer relies on too — a
  // schema-defined class carries exactly the schema's field names as own data properties.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return component as unknown as Record<string, unknown>;
}

/**
 * Finds every tracked field pointing at a component.
 *
 * @param world - The world to scan.
 * @param target - The component about to be destroyed.
 * @returns The holders and field names, in scan order.
 */
function collectInbound(world: World, target: Component): readonly InboundReference[] {
  const found: InboundReference[] = [];
  const all = world.components(Component);
  for (let index = 0; index < all.length; index += 1) {
    const holder = all[index];
    if (holder === undefined) {
      continue;
    }
    const fields = componentInternals(holder).info?.trackedFields ?? [];
    if (fields.length === 0) {
      continue;
    }
    const bag = fieldBag(holder);
    for (let field = 0; field < fields.length; field += 1) {
      const name = fields[field];
      if (name !== undefined && bag[name] === target) {
        found.push({ holder, field: name });
      }
    }
  }
  return found;
}

/**
 * Points one holder field back at the replacement.
 *
 * @param reference - The holder and field recorded before the destroy flush.
 * @param component - The replacement instance.
 */
function repoint(reference: InboundReference | undefined, component: Component): void {
  if (reference === undefined || componentInternals(reference.holder).isReleased) {
    return;
  }
  fieldBag(reference.holder)[reference.field] = component;
}

/**
 * Moves a freshly attached component to the position its predecessor held.
 *
 * @param entity - The entity.
 * @param component - The replacement, currently last in the list.
 * @param index - The position to restore it to.
 */
function moveToIndex(entity: Entity, component: Component, index: number): void {
  const list = entityInternals(entity).components;
  const at = list.indexOf(component);
  if (at < 0 || index < 0 || index >= list.length || at === index) {
    return;
  }
  list.splice(at, 1);
  list.splice(index, 0, component);
}

/**
 * Forwards schema problems as one message each.
 *
 * @param issues - The problems found.
 * @param uid - The component uid to name them against.
 * @param onIssue - Where they go.
 */
function report(issues: readonly SchemaIssue[], uid: string, onIssue: (message: string) => void): void {
  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index];
    if (issue !== undefined) {
      onIssue(`${issue.code} ${uid}.${issue.path === "" ? "<value>" : issue.path}: ${issue.message}`);
    }
  }
}

/**
 * Reads a reference target's own uid.
 *
 * @param value - The field value.
 * @returns Its uid, or `null` when the value carries none.
 */
function readUid(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const uid: unknown = Reflect.get(value, "uid");
  return typeof uid === "string" ? uid : null;
}

/** Encodes every reference to the target's own uid; there is no file membership to test against. */
const OWN_UID_ENCODER: ReferenceEncoder = { entityUid: readUid, componentUid: readUid };

/**
 * Resolves uids and addresses against the whole world rather than one file.
 *
 * @param world - The world to resolve against.
 * @returns The decoder. The component table is built once, lazily, on the first `componentRef`.
 */
function worldDecoder(world: World): ReferenceDecoder {
  let byUid: Map<string, Component> | null = null;
  return {
    entity(uid: string): unknown {
      return world.getEntity(uid);
    },
    component(uid: string): unknown {
      byUid ??= indexComponents(world);
      return byUid.get(uid) ?? null;
    },
    asset(address: string): unknown {
      return world.app.assets.get(address);
    },
  };
}

/**
 * Indexes every live component by uid.
 *
 * @param world - The world to scan.
 * @returns The table.
 */
function indexComponents(world: World): Map<string, Component> {
  const table = new Map<string, Component>();
  const all = world.components(Component);
  for (let index = 0; index < all.length; index += 1) {
    const component = all[index];
    if (component !== undefined) {
      table.set(componentInternals(component).uid, component);
    }
  }
  return table;
}

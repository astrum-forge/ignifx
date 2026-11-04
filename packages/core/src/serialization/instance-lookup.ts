import { entityInternals } from "../entity/internals.js";
import { INSTANCE_PATH_SEPARATOR } from "./instance-paths.js";
import type { Component } from "../component/component.js";
import type { Entity } from "../entity/entity.js";
import type { EntityOrigin } from "../entity/internals.js";

/**
 * Finds the live entity an instance path names inside an instance, as the loader resolves
 * `{ "$entity": "<instanceRootUid>/<uidInThePrefab>" }` while it builds a scene.
 *
 * @remarks
 * For tools that hold such a reference after the scene was built, such as an editor that rebuilt
 * one instance and points the rest of the document at it again. The path is read from `root` down:
 * the uid the prefab file gives the target, with one segment before it per nested prefab.
 *
 * @param root - The entity carrying the `instance` entry: the path's first segment.
 * @param path - The rest of the path, without the root's uid: `"<uidInThePrefab>"` or
 * `"<nestedInstanceUidInThePrefab>/<uidInTheNestedPrefab>"`.
 * @returns The entity, or `null` when the path names nothing in this instance.
 *
 * @example
 * ```ts
 * const weapon = instanceEntityAt(enemy, "01J9Z…WEAPON");
 * ```
 *
 * @public
 */
export function instanceEntityAt(root: Entity, path: string): Entity | null {
  const segments = path.split(INSTANCE_PATH_SEPARATOR);
  let current: Entity | null = root;
  for (let index = 0; index < segments.length && current !== null; index += 1) {
    current = memberEntity(current, segments[index] ?? "");
  }
  return current;
}

/**
 * Finds the live component an instance path names inside an instance, as the loader resolves
 * `{ "$component": "<instanceRootUid>/<uidInThePrefab>" }`.
 *
 * @param root - The entity carrying the `instance` entry: the path's first segment.
 * @param path - The rest of the path, without the root's uid: `"<componentUidInThePrefab>"`, with
 * one segment before it per nested prefab.
 * @returns The component, or `null` when the path names nothing in this instance.
 *
 * @example
 * ```ts
 * const ai = instanceComponentAt(enemy, "01J9Z…AI");
 * ```
 *
 * @public
 */
export function instanceComponentAt(root: Entity, path: string): Component | null {
  const at = path.lastIndexOf(INSTANCE_PATH_SEPARATOR);
  const owner = at < 0 ? root : instanceEntityAt(root, path.slice(0, at));
  return owner === null ? null : memberComponent(owner, path.slice(at + 1));
}

/**
 * The entity of one instance that its file gives a uid.
 *
 * @param root - The instance root.
 * @param uid - The uid in the instanced file.
 * @returns The entity, or `null`.
 */
function memberEntity(root: Entity, uid: string): Entity | null {
  if (entityInternals(root).origin?.instanced?.root?.sourceUid === uid) {
    return root;
  }
  return findMember(root, root, (member, origin) => (origin.sourceUid === uid ? member : null));
}

/**
 * The component of one instance that its file gives a uid: on the root, or on a member.
 *
 * @param root - The instance root.
 * @param uid - The component's uid in the instanced file.
 * @returns The component, or `null`.
 */
function memberComponent(root: Entity, uid: string): Component | null {
  const merged = entityInternals(root).origin?.instanced?.root?.componentSourceUids;
  const own = merged === undefined ? null : componentWithSource(root, merged, uid);
  return (
    own ?? findMember(root, root, (member, origin) => componentWithSource(member, origin.componentSourceUids, uid))
  );
}

/**
 * The first answer `pick` gives for a member of `root`'s instance below `entity`, in tree order.
 *
 * @param entity - Where to walk from.
 * @param root - The instance root.
 * @param pick - Answers for one member, or `null` to go on.
 * @returns The answer, or `null`.
 */
function findMember<T>(
  entity: Entity,
  root: Entity,
  pick: (member: Entity, origin: EntityOrigin) => T | null,
): T | null {
  const children = entity.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined || child.isDestroyed) {
      continue;
    }
    const origin = entityInternals(child).origin;
    const found = origin !== null && origin.instanceRoot === root ? pick(child, origin) : null;
    const answer = found ?? findMember(child, root, pick);
    if (answer !== null) {
      return answer;
    }
  }
  return null;
}

/**
 * The component of an entity whose source uid is `uid`.
 *
 * @param entity - The entity.
 * @param sourceUids - Runtime component uid to source uid.
 * @param uid - The source uid.
 * @returns The component, or `null`.
 */
function componentWithSource(entity: Entity, sourceUids: ReadonlyMap<string, string>, uid: string): Component | null {
  const components = entity.components;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component !== undefined && !component.isDestroyed && sourceUids.get(component.uid) === uid) {
      return component;
    }
  }
  return null;
}

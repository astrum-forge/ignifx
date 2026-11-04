import type { ExpandedScene } from "./expand.js";

/**
 * Instance paths: how a scene file names an entity or component inside a prefab instance it holds
 * (`docs/architecture/06-serialization-and-scene-format.md` §2). Instancing gives every copied
 * entity and component a fresh uid, so a plain `{ "$entity": "<uid>" }` cannot reach into a copy.
 * An instance path can: `"<instanceRootUid>/<uidInThePrefab>"`, where the first segment is the uid
 * of the entity carrying the `instance` entry in this file and the second is the uid the prefab file
 * gives the target. Deeper segments walk into nested instances:
 * `"<instanceRootUid>/<nestedRootUidInThePrefab>/<uidInTheNestedPrefab>"`. Uids never contain `/`
 * (override paths split on it), so a plain uid is never mistaken for a path.
 */

/** The separator between the segments of an instance path. */
export const INSTANCE_PATH_SEPARATOR = "/";

/**
 * Resolves instance paths against one expansion.
 *
 * @internal
 */
export interface InstancePathResolver {
  /**
   * The expanded uid of the entity an instance path names.
   *
   * @param path - The path, `"<instanceRootUid>/…/<entityUid>"`.
   * @returns The expanded uid, or `null` when the path is not one or names nothing.
   */
  entity(path: string): string | null;
  /**
   * The expanded uid of the component an instance path names.
   *
   * @param path - The path, `"<instanceRootUid>/…/<componentUid>"`.
   * @returns The expanded uid, or `null` when the path is not one or names nothing.
   */
  component(path: string): string | null;
}

/**
 * Builds the instance path tables of an expansion.
 *
 * @param expanded - The expansion.
 * @returns The resolver.
 *
 * @internal
 */
export function instancePathResolver(expanded: ExpandedScene): InstancePathResolver {
  // An entity can carry several instances: a single-root prefab whose root itself instances another
  // scene (a variant) merges both into the same carrier.
  const keysOfRoot = new Map<string, string[]>();
  const entities = new Map<string, Map<string, string>>();
  const components = new Map<string, Map<string, string>>();
  for (const instance of expanded.instances) {
    if (instance.rootUid === null) {
      continue;
    }
    const keys = keysOfRoot.get(instance.rootUid) ?? [];
    keys.push(instance.key);
    keysOfRoot.set(instance.rootUid, keys);
    if (instance.root !== null) {
      tableOf(entities, instance.key).set(instance.root.sourceUid, instance.rootUid);
      fillComponents(tableOf(components, instance.key), instance.root.componentSourceUids);
    }
  }
  for (const entity of expanded.entities) {
    if (entity.instanceKey === null) {
      continue;
    }
    tableOf(entities, entity.instanceKey).set(entity.sourceUid, entity.data.uid);
    fillComponents(tableOf(components, entity.instanceKey), entity.componentSourceUids);
  }
  const lookup = (
    tables: ReadonlyMap<string, ReadonlyMap<string, string>>,
    root: string,
    uid: string,
  ): string | null => {
    for (const key of keysOfRoot.get(root) ?? []) {
      const found = tables.get(key)?.get(uid);
      if (found !== undefined) {
        return found;
      }
    }
    return null;
  };
  const resolve = (path: string, last: ReadonlyMap<string, ReadonlyMap<string, string>>): string | null => {
    const segments = path.split(INSTANCE_PATH_SEPARATOR);
    if (segments.length < 2) {
      return null;
    }
    let root: string | null = segments[0] ?? null;
    for (let index = 1; index < segments.length && root !== null; index += 1) {
      const segment = segments[index] ?? "";
      root = lookup(index === segments.length - 1 ? last : entities, root, segment);
    }
    return root;
  };
  return {
    entity: (path) => resolve(path, entities),
    component: (path) => resolve(path, components),
  };
}

/**
 * Rewrites the first segment of an instance path, which names an entity of the file the path is
 * written in, through that file's uid table.
 *
 * @param path - The path, or a plain uid.
 * @param keys - Source uid to expanded uid for the file.
 * @returns The rewritten path, or `null` when `path` is not a path.
 *
 * @internal
 */
export function remapInstancePath(path: string, keys: ReadonlyMap<string, string>): string | null {
  const at = path.indexOf(INSTANCE_PATH_SEPARATOR);
  if (at <= 0) {
    return null;
  }
  const head = path.slice(0, at);
  return `${keys.get(head) ?? head}${path.slice(at)}`;
}

/**
 * The table of one instance key, created on first use.
 *
 * @param tables - The tables by instance key.
 * @param key - The instance key.
 * @returns The table.
 */
function tableOf(tables: Map<string, Map<string, string>>, key: string): Map<string, string> {
  let table = tables.get(key);
  if (table === undefined) {
    table = new Map<string, string>();
    tables.set(key, table);
  }
  return table;
}

/**
 * Adds an expanded-to-source component table, inverted, to an instance's component table.
 *
 * @param into - Source component uid to expanded uid.
 * @param sourceUids - Expanded component uid to source component uid.
 */
function fillComponents(into: Map<string, string>, sourceUids: ReadonlyMap<string, string>): void {
  for (const [expanded, source] of sourceUids) {
    into.set(source, expanded);
  }
}

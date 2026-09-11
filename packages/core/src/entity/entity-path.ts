import { entityInternals } from "./internals.js";
import type { Entity } from "./entity.js";

/**
 * Resolve `/`-separated entity paths within the entity's scene instance.
 * A leading `/` starts at scene roots; whole segments `.` and `..` mean self and parent.
 * Empty segments are ignored and unresolved paths return `null`.
 * Use schema references in runtime source; path lookup is for examples, tests, and tools.
 */

/**
 * Resolves a path relative to an entity.
 *
 * @param from - The entity the path is relative to.
 * @param path - The path.
 * @returns The entity the path names, or `null`.
 *
 * @internal
 */
export function resolvePath(from: Entity, path: string): Entity | null {
  if (path === "") {
    return null;
  }
  let current: Entity | null = from;
  let rest = path;
  if (path.startsWith("/")) {
    rest = path.slice(1);
    if (rest === "") {
      return null;
    }
    const segments = rest.split("/");
    const first = nextSegment(segments, 0);
    if (first === null) {
      return null;
    }
    current = findRoot(from, first.value);
    return current === null ? null : walk(current, segments, first.index + 1);
  }
  const segments = rest.split("/");
  return walk(current, segments, 0);
}

/**
 * Walks the remaining segments from an entity.
 *
 * @param start - Where to walk from.
 * @param segments - Every segment of the path.
 * @param offset - The first segment to consume.
 * @returns The entity the walk lands on, or `null`.
 */
function walk(start: Entity, segments: readonly string[], offset: number): Entity | null {
  let current: Entity | null = start;
  for (let index = offset; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment === "" || segment === ".") {
      continue;
    }
    if (current === null) {
      return null;
    }
    if (segment === "..") {
      current = current.parent;
      continue;
    }
    current = findChildNamed(current, segment);
  }
  return current;
}

/**
 * The first non-empty segment at or after an index.
 *
 * @param segments - Every segment of the path.
 * @param offset - Where to start looking.
 * @returns The segment and the index it was found at, or `null` when there is none.
 */
function nextSegment(segments: readonly string[], offset: number): { value: string; index: number } | null {
  for (let index = offset; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment !== undefined && segment !== "") {
      return { value: segment, index };
    }
  }
  return null;
}

/**
 * Finds a named root of the entity's scene instance.
 *
 * @param from - The entity whose scene is searched.
 * @param name - The root's name.
 * @returns The first root with that name, or `null`.
 */
function findRoot(from: Entity, name: string): Entity | null {
  const roots = entityInternals(from).scene.roots;
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    if (root !== undefined && root.name === name) {
      return root;
    }
  }
  return null;
}

/**
 * Finds a named direct child.
 *
 * @param parent - The entity to search.
 * @param name - The child's name.
 * @returns The first child with that name, or `null`.
 */
function findChildNamed(parent: Entity, name: string): Entity | null {
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined && child.name === name) {
      return child;
    }
  }
  return null;
}

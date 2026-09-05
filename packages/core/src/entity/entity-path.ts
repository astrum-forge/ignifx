import { entityInternals } from "./internals.js";
import type { Entity } from "./entity.js";

/**
 * The `entity.find("Body/Arm.L")` path grammar (`docs/architecture/02-scene-graph.md` §4).
 *
 * @remarks
 * Deliberately fragile — the Godot `get_node` lesson — and therefore allowed only in tests,
 * examples, and tools, where a hard-coded path is the point; `ignifx/no-entity-find-in-src` flags
 * it anywhere else. Serialized `entityRef`/`componentRef` fields and `requireComponent` are the
 * supported way to link objects.
 *
 * The grammar is exactly:
 *
 * - segments are separated by `/`;
 * - a leading `/` resolves from the roots of the entity's **own scene instance**, not the world, so
 *   an additive HUD scene cannot accidentally reach into the gameplay scene (§10 says cross-scene
 *   links go through tags, uids, or a service);
 * - `..` is the parent and `.` is the entity itself, but **only as whole segments** — a name may
 *   contain dots, which is why `Arm.L` resolves as a name and not as a path;
 * - empty segments are skipped, so `"a//b"` and `"a/b/"` mean `"a/b"`;
 * - anything that does not resolve yields `null`, because a lookup that finds nothing is an
 *   expected absence, not an error (coding standards §5.5).
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

import type { App, Entity } from "@ignifx/core";

/**
 * Flatten the entity tree only when marked dirty, reusing its array between refreshes.
 * Structural signals mark it dirty. A reparent without an entity-count change becomes visible
 * at the next dirty event or search refresh; the index does not walk the world every frame.
 */

/** One row of the flattened tree. */
export interface WorldIndexEntry {
  /** The entity the row shows. */
  readonly entity: Entity;
  /** How deep it sits, `0` for a scene root. */
  readonly depth: number;
  /** How many children it has, so the row can draw a disclosure triangle. */
  readonly childCount: number;
}

/** A mutable row, written in place so a rebuild reuses the array it filled last time. */
interface MutableEntry {
  entity: Entity;
  depth: number;
  childCount: number;
}

/**
 * A flattened, collapsible, searchable view of one world's entity tree.
 *
 * @internal
 */
export class WorldIndex {
  readonly #app: App;
  readonly #rows: MutableEntry[] = [];
  readonly #collapsed = new Set<string>();
  readonly #stack: Entity[] = [];
  readonly #depths: number[] = [];
  readonly #shown: boolean[] = [];
  #length = 0;
  #entities = 0;
  #components = 0;
  #dirty = true;

  /**
   * Builds an index over an app's world.
   *
   * @remarks
   * The app, not the world: `app.world` throws `IGX-0107` while extensions are still registering
   * (`packages/core/src/app/app.ts`), and the index is built in `devtools()`'s `register`. Reading
   * it inside {@link WorldIndex.refresh} instead costs one property read per rebuild and lets the
   * service be constructed at the only moment it can be.
   *
   * @param app - The app whose world is indexed.
   */
  constructor(app: App) {
    this.#app = app;
  }

  /**
   * How many rows the last rebuild produced — every entity in the world whose ancestors are all
   * expanded.
   *
   * @returns The row count.
   */
  get length(): number {
    return this.#length;
  }

  /**
   * How many entities the last rebuild found, collapsed subtrees included.
   *
   * @returns The entity count.
   */
  get entityCount(): number {
    return this.#entities;
  }

  /**
   * How many components the last rebuild counted. Collapsed subtrees are walked for the count even
   * though they emit no rows, so the Stats panel's number is the world's, not the tree view's.
   *
   * @returns The component count.
   */
  get componentCount(): number {
    return this.#components;
  }

  /** Marks the index stale; the next {@link WorldIndex.refresh} walks the tree again. */
  invalidate(): void {
    this.#dirty = true;
  }

  /**
   * Reads one row.
   *
   * @param index - The row number, `0`-based.
   * @returns The row, or `null` when the index is out of range.
   */
  at(index: number): WorldIndexEntry | null {
    if (index < 0 || index >= this.#length) {
      return null;
    }
    return this.#rows[index] ?? null;
  }

  /**
   * Reports whether an entity's children are hidden.
   *
   * @param entity - The entity.
   * @returns `true` when it is collapsed.
   */
  isCollapsed(entity: Entity): boolean {
    return this.#collapsed.has(entity.uid);
  }

  /**
   * Shows or hides an entity's children.
   *
   * @param entity - The entity.
   */
  toggleCollapsed(entity: Entity): void {
    const uid = entity.uid;
    if (this.#collapsed.has(uid)) {
      this.#collapsed.delete(uid);
    } else {
      this.#collapsed.add(uid);
    }
    this.#dirty = true;
  }

  /**
   * Rebuilds the flattened list when something marked it stale.
   *
   * @param force - Rebuild even when nothing marked it stale, which is what a re-parent needs.
   * @returns `true` when the list was rebuilt.
   */
  refresh(force = false): boolean {
    if (!this.#dirty && !force) {
      return false;
    }
    this.#dirty = false;
    this.#length = 0;
    this.#entities = 0;
    this.#components = 0;
    const scenes = this.#app.world.scenes;
    for (let index = scenes.length - 1; index >= 0; index -= 1) {
      const roots = scenes[index]?.roots ?? [];
      for (let at = roots.length - 1; at >= 0; at -= 1) {
        const root = roots[at];
        if (root !== undefined) {
          this.#push(root, 0, true);
        }
      }
    }
    this.#drain();
    return true;
  }

  /**
   * Fills a caller-owned array with the row numbers whose entity name contains a search string.
   *
   * @param search - The search string; `""` matches every row.
   * @param out - The array to fill. It is truncated first, so one array serves every refresh.
   * @returns The same `out` array.
   */
  filter(search: string, out: number[]): number[] {
    out.length = 0;
    const needle = search.trim().toLowerCase();
    for (let index = 0; index < this.#length; index += 1) {
      const row = this.#rows[index];
      if (row === undefined) {
        continue;
      }
      if (needle === "" || row.entity.name.toLowerCase().includes(needle)) {
        out.push(index);
      }
    }
    return out;
  }

  /**
   * Pushes one entity onto the walk stack.
   *
   * @param entity - The entity to visit.
   * @param depth - Its depth.
   * @param shown - Whether the entity gets a row, or is only counted.
   */
  #push(entity: Entity, depth: number, shown: boolean): void {
    this.#stack.push(entity);
    this.#depths.push(depth);
    this.#shown.push(shown);
  }

  /** Runs the depth-first walk the stack was seeded with. */
  #drain(): void {
    while (this.#stack.length > 0) {
      const entity = this.#stack.pop();
      const depth = this.#depths.pop() ?? 0;
      const shown = this.#shown.pop() ?? false;
      if (entity === undefined || entity.isDestroyed) {
        continue;
      }
      const children = entity.children;
      this.#entities += 1;
      this.#components += entity.components.length;
      if (shown) {
        this.#write(entity, depth, children.length);
      }
      const expanded = shown && !this.#collapsed.has(entity.uid);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) {
          this.#push(child, depth + 1, expanded);
        }
      }
    }
  }

  /**
   * Writes one row, reusing the slot from the previous rebuild when there is one.
   *
   * @param entity - The entity.
   * @param depth - Its depth.
   * @param childCount - How many children it has.
   */
  #write(entity: Entity, depth: number, childCount: number): void {
    const existing = this.#rows[this.#length];
    if (existing === undefined) {
      this.#rows.push({ entity, depth, childCount });
    } else {
      existing.entity = entity;
      existing.depth = depth;
      existing.childCount = childCount;
    }
    this.#length += 1;
  }
}

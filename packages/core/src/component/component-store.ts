import { componentInternals } from "./internals.js";
import type { ComponentClassInfo } from "./component-registry.js";
import type { ComponentType } from "./component-type.js";
import type { Component } from "./component.js";

/**
 * The world's live per-type component registry — what `world.components(Type)` returns and what
 * every system iterates (`docs/architecture/02-scene-graph.md` §9).
 *
 * @remarks
 * A component is filed under **every** class in its ancestor chain, so a query for `Script` really
 * does return every script and a query for `Component` returns everything, with no prototype walk
 * and no filtering per frame. Each bucket records where the component sits, so removal is a
 * swap-remove rather than a scan: `add` and `remove` are both O(ancestors), which is a small
 * constant.
 *
 * The array a query returns is the bucket itself: obtaining it costs nothing, its identity is
 * stable for the lifetime of the world, and it is live — a component added later shows up in it.
 * Swap-remove means the order is *not* creation order and changes when a component is destroyed;
 * systems that need deterministic ordering iterate `world.scriptsWith(kind)` instead.
 */

/** Shared empty bucket for a type nothing has ever been filed under. */
const EMPTY_BUCKET: readonly Component[] = Object.freeze([]);

/**
 * The per-type component index of one world.
 *
 * @internal
 */
export class ComponentStore {
  readonly #buckets = new Map<ComponentType, Component[]>();

  /**
   * Files a component under its class and every class it derives from.
   *
   * @param component - The component to file.
   * @param info - Its class info, whose `ancestors` list drives the filing.
   */
  add(component: Component, info: ComponentClassInfo): void {
    const internals = componentInternals(component);
    const ancestors = info.ancestors;
    const slots = internals.storeSlots;
    slots.length = ancestors.length;
    for (let index = 0; index < ancestors.length; index += 1) {
      const type = ancestors[index];
      if (type === undefined) {
        continue;
      }
      const bucket = this.#bucketFor(type);
      slots[index] = bucket.length;
      bucket.push(component);
    }
  }

  /**
   * Removes a component from every bucket it was filed under, by swapping the last entry into its
   * slot.
   *
   * @param component - The component to remove.
   * @param info - Its class info, whose `ancestors` list matches the recorded slots.
   */
  remove(component: Component, info: ComponentClassInfo): void {
    const internals = componentInternals(component);
    const ancestors = info.ancestors;
    const slots = internals.storeSlots;
    for (let index = 0; index < ancestors.length; index += 1) {
      const type = ancestors[index];
      const slot = slots[index];
      if (type === undefined || slot === undefined || slot < 0) {
        continue;
      }
      const bucket = this.#buckets.get(type);
      if (bucket === undefined) {
        continue;
      }
      const last = bucket.length - 1;
      const moved = bucket[last];
      if (slot !== last && moved !== undefined) {
        bucket[slot] = moved;
        const movedSlots = componentInternals(moved).storeSlots;
        const movedIndex = indexOfAncestor(moved, type);
        if (movedIndex >= 0) {
          movedSlots[movedIndex] = slot;
        }
      }
      bucket.pop();
      slots[index] = -1;
    }
    slots.length = 0;
  }

  /**
   * The live bucket for a type.
   *
   * @typeParam T - The component instance type.
   * @param type - The component class, abstract or concrete.
   * @returns The live array of matching components. Never allocates once the bucket exists.
   */
  components<T extends Component>(type: ComponentType<T>): readonly T[] {
    const bucket = this.#buckets.get(type);
    if (bucket === undefined) {
      // Nothing of this type has ever existed. Returning the shared frozen empty array keeps the
      // query allocation-free; the bucket is created the moment something is filed under it.
      // Boundary assertion (coding standards §5.2): an empty array of `Component` is an empty array
      // of any subtype.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return EMPTY_BUCKET as unknown as readonly T[];
    }
    // Boundary assertion (coding standards §5.2): the invariant is that a component is only ever
    // filed under classes in its own ancestor chain, so every member of the bucket for `type` is a
    // `T`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return bucket as unknown as readonly T[];
  }

  /** Empties every bucket, for world disposal. */
  clear(): void {
    for (const bucket of this.#buckets.values()) {
      bucket.length = 0;
    }
    this.#buckets.clear();
  }

  /**
   * The bucket for a type, created on demand so that `components(Type)` returns a stable identity
   * from the first component onwards.
   *
   * @param type - The component class.
   * @returns The live bucket.
   */
  #bucketFor(type: ComponentType): Component[] {
    let bucket = this.#buckets.get(type);
    if (bucket === undefined) {
      bucket = [];
      this.#buckets.set(type, bucket);
    }
    return bucket;
  }
}

/**
 * Where a class sits in a component's ancestor chain, so a swap-remove can fix up the moved
 * component's recorded slot.
 *
 * @param component - The component that was moved into another slot.
 * @param type - The bucket's class.
 * @returns The index in the component's ancestor list, or `-1`.
 */
function indexOfAncestor(component: Component, type: ComponentType): number {
  const info = componentInternals(component).info;
  if (info === null) {
    return -1;
  }
  const ancestors = info.ancestors;
  for (let index = 0; index < ancestors.length; index += 1) {
    if (ancestors[index] === type) {
      return index;
    }
  }
  return -1;
}

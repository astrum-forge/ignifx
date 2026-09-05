import { componentInternals } from "./internals.js";
import type { Component } from "./component.js";

/**
 * Tracked references (`docs/architecture/02-scene-graph.md` §4): a field declared with `entityRef`
 * or `componentRef` is set to `null` when its target is destroyed, in the same destroy flush,
 * before any `onDestroy` of the holder runs. Plain class fields holding entities or components are
 * not* tracked; game code checks `isDestroyed` before using those.
 *
 * @remarks
 * **How it is implemented, and why not with accessors.** The obvious design intercepts every write
 * to a tracked field with a generated accessor, so the tracker can index holders by target. Coding
 * standards §5.3 bans `Object.defineProperty` tricks and prototype mutation, which is what
 * generating those accessors requires, so the tracker takes the other route: it keeps the small set
 * of components whose class declares at least one tracked field, and the destroy flush makes one
 * pass over that set, nulling any tracked field whose current value is being destroyed. Tracked
 * fields stay ordinary data properties — `this.target = other` is a plain assignment with no hidden
 * cost — and the pass is O(holders x tracked fields) once per flush that destroys anything, not per
 * frame and not per entity.
 */

/**
 * The set of components with tracked reference fields, and the flush-time nulling pass.
 *
 * @internal
 */
export class ReferenceTracker {
  /** Every attached component whose class declares at least one tracked field. */
  readonly #holders: Component[] = [];

  /** Where each holder sits in `#holders`, so removal is a swap-remove. */
  readonly #slots = new Map<Component, number>();

  /**
   * How many components are being watched. Exposed for tests and diagnostics.
   *
   * @returns The holder count.
   */
  get size(): number {
    return this.#holders.length;
  }

  /**
   * Starts watching a component, if its class declares tracked fields.
   *
   * @param component - The freshly attached component.
   */
  watch(component: Component): void {
    const info = componentInternals(component).info;
    if (info === null || info.trackedFields.length === 0 || this.#slots.has(component)) {
      return;
    }
    this.#slots.set(component, this.#holders.length);
    this.#holders.push(component);
  }

  /**
   * Stops watching a component.
   *
   * @param component - The component being released.
   */
  unwatch(component: Component): void {
    const slot = this.#slots.get(component);
    if (slot === undefined) {
      return;
    }
    this.#slots.delete(component);
    const last = this.#holders.length - 1;
    const moved = this.#holders[last];
    if (slot !== last && moved !== undefined) {
      this.#holders[slot] = moved;
      this.#slots.set(moved, slot);
    }
    this.#holders.pop();
  }

  /**
   * Nulls every tracked field pointing at anything in `doomed`. Run once at the top of the destroy
   * flush, before any `onDisable` or `onDestroy`, so a holder's own `onDestroy` already sees `null`
   * (`docs/architecture/02-scene-graph.md` §4).
   *
   * @param doomed - The entities and components about to be released. `null` is never a member, so
   * a field that is already `null` is left alone.
   */
  nullReferencesTo(doomed: ReadonlySet<unknown>): void {
    if (doomed.size === 0 || this.#holders.length === 0) {
      return;
    }
    const holders = this.#holders;
    for (let index = 0; index < holders.length; index += 1) {
      const holder = holders[index];
      if (holder === undefined) {
        continue;
      }
      const info = componentInternals(holder).info;
      if (info === null) {
        continue;
      }
      const fields = info.trackedFields;
      // Boundary assertion (coding standards §5.2): a tracked field is an ordinary data property
      // whose name came from the component's own schema, so reading and clearing it by name is
      // exactly what the serializer does with the same names.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const bag = holder as unknown as Record<string, unknown>;
      for (let field = 0; field < fields.length; field += 1) {
        const name = fields[field];
        if (name === undefined) {
          continue;
        }
        if (doomed.has(bag[name])) {
          bag[name] = null;
        }
      }
    }
  }

  /** Forgets every holder, for world disposal. */
  clear(): void {
    this.#holders.length = 0;
    this.#slots.clear();
  }
}

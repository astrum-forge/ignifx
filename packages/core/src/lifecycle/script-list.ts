import { componentInternals } from "../component/internals.js";
import type { ScriptClassInfo } from "../component/component-registry.js";
import type { Script } from "../script/script.js";

/**
 * One callback's dispatch list: every effectively-enabled script that implements it, kept sorted by
 * `(executionOrder ascending, creation serial ascending)`
 * (`docs/architecture/01-lifecycle-and-time.md` §3).
 *
 * @remarks
 * The order is maintained incrementally by sorted insertion — never by re-sorting per frame — which
 * is possible because both keys are fixed for a script's whole life: `executionOrder` is a static
 * of its class and the serial is assigned once at attachment.
 *
 * Mutation during a walk is the interesting case, and it is handled without allocating: while a
 * walk is in flight, insertions and removals are recorded and applied when it ends, and the walk
 * itself skips any script that is no longer effectively enabled. So a script disabled or destroyed
 * by another script's callback does not receive the callback this frame, and one enabled during the
 * walk first receives it on the next frame — the same rule that defers a newly created component's
 * `start` to the next flush B (§4).
 *
 * @internal
 */
export class ScriptList {
  readonly #items: Script[] = [];

  readonly #added: Script[] = [];

  readonly #removed: Script[] = [];

  #depth = 0;

  /**
   * The sorted list.
   *
   * @returns The live array. Outside a walk it holds exactly the effectively-enabled scripts that
   * implement this callback.
   */
  get items(): readonly Script[] {
    return this.#items;
  }

  /**
   * Adds a script in sort order. Adding one that is already present is a no-op.
   *
   * @param script - The script that just became effectively enabled.
   * @param info - Its class's ordering data.
   */
  insert(script: Script, info: ScriptClassInfo): void {
    if (this.#depth > 0) {
      this.#added.push(script);
      return;
    }
    const order = info.executionOrder;
    const serial = componentInternals(script).serial;
    const items = this.#items;
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const other = items[middle];
      if (other !== undefined && compare(other, order, serial) < 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (items[low] === script) {
      return;
    }
    items.splice(low, 0, script);
  }

  /**
   * Removes a script. Removing one that is not present is a no-op.
   *
   * @param script - The script that stopped being effectively enabled.
   */
  remove(script: Script): void {
    if (this.#depth > 0) {
      this.#removed.push(script);
      return;
    }
    const index = this.#items.indexOf(script);
    if (index >= 0) {
      this.#items.splice(index, 1);
    }
  }

  /**
   * Walks the list in order, skipping scripts that stopped being effectively enabled.
   *
   * @param visitor - Called with each script.
   */
  forEach(visitor: (script: Script) => void): void {
    this.#depth += 1;
    try {
      const items = this.#items;
      const count = items.length;
      for (let index = 0; index < count; index += 1) {
        const script = items[index];
        if (script === undefined) {
          continue;
        }
        const state = componentInternals(script);
        if (state.isEnabledNow && !state.isDestroyed) {
          visitor(script);
        }
      }
    } finally {
      this.#depth -= 1;
      if (this.#depth === 0) {
        this.#drain();
      }
    }
  }

  /** Empties the list, for world disposal. */
  clear(): void {
    this.#items.length = 0;
    this.#added.length = 0;
    this.#removed.length = 0;
    this.#depth = 0;
  }

  /** Applies the mutations recorded while a walk was in flight, removals first. */
  #drain(): void {
    for (let index = 0; index < this.#removed.length; index += 1) {
      const script = this.#removed[index];
      if (script !== undefined) {
        const at = this.#items.indexOf(script);
        if (at >= 0) {
          this.#items.splice(at, 1);
        }
      }
    }
    this.#removed.length = 0;
    for (let index = 0; index < this.#added.length; index += 1) {
      const script = this.#added[index];
      const info = script === undefined ? null : componentInternals(script).info;
      if (script !== undefined && info !== null && info.script !== null) {
        this.insert(script, info.script);
      }
    }
    this.#added.length = 0;
  }
}

/**
 * Compares a list member against a sort key.
 *
 * @param item - The script already in the list.
 * @param order - The execution order being placed.
 * @param serial - The creation serial being placed.
 * @returns A negative number when `item` sorts first, a positive one when it sorts after.
 */
function compare(item: Script, order: number, serial: number): number {
  const state = componentInternals(item);
  const info = state.info;
  const itemOrder = info?.script?.executionOrder ?? 0;
  if (itemOrder !== order) {
    return itemOrder - order;
  }
  return state.serial - serial;
}

import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";

/**
 * A named set of numeric counters owned by one subsystem — `render`, `physics`, `assets`, `input`,
 * `audio`, `twoD`, `animation` (`docs/architecture/15-devtools-and-diagnostics.md` §3).
 *
 * @remarks
 * Counter names are resolved to array indices once, at registration. Per-frame code holds the index
 * and never performs a string-keyed lookup (coding standards §7).
 *
 * @example
 * ```ts
 * const counters = app.diagnostics.registerGroup("render", ["drawCalls", "triangles"]);
 * const drawCalls = counters.index("drawCalls");
 * // …per frame…
 * counters.set(drawCalls, scene.drawCallCount);
 * ```
 *
 * @public
 */
export interface DiagnosticsGroup {
  /** The group name, unique within one {@link Diagnostics}. */
  readonly name: string;
  /** The counter names in index order. */
  readonly counterNames: readonly string[];

  /**
   * Resolves a counter name to its index. Call it at registration or `awake`, never per frame.
   *
   * @param counter - The counter name.
   * @returns The index to pass to {@link DiagnosticsGroup.get}, `set`, and `add`.
   * @throws IgnifxError with code `IGX-1504` when the group has no such counter.
   */
  index(counter: string): number;

  /**
   * Reads a counter.
   *
   * @param index - The index from {@link DiagnosticsGroup.index}.
   * @returns The current value, or `0` when the index is out of range.
   */
  get(index: number): number;

  /**
   * Replaces a counter's value. Out-of-range indices are ignored.
   *
   * @param index - The index from {@link DiagnosticsGroup.index}.
   * @param value - The new value.
   */
  set(index: number, value: number): void;

  /**
   * Adds to a counter. Out-of-range indices are ignored.
   *
   * @param index - The index from {@link DiagnosticsGroup.index}.
   * @param delta - The amount to add.
   */
  add(index: number, delta: number): void;

  /** Zeroes every counter in the group. */
  reset(): void;
}

class DiagnosticsGroupImpl implements DiagnosticsGroup {
  readonly name: string;
  readonly counterNames: readonly string[];
  readonly #values: Float64Array;
  readonly #indices: ReadonlyMap<string, number>;

  constructor(name: string, counterNames: readonly string[]) {
    this.name = name;
    const names = counterNames.slice();
    this.counterNames = names;
    this.#values = new Float64Array(names.length);
    const indices = new Map<string, number>();
    let index = 0;
    for (const counter of names) {
      indices.set(counter, index);
      index += 1;
    }
    this.#indices = indices;
  }

  index(counter: string): number {
    const index = this.#indices.get(counter);
    if (index === undefined) {
      throw new IgnifxError(
        CoreErrorCode.unknownDiagnosticsCounter,
        `${counter} is not a counter of the diagnostics group ${this.name}.`,
        {
          context: { counter, group: this.name },
          hint: "Declare every counter name when the group is registered.",
        },
      );
    }
    return index;
  }

  get(index: number): number {
    // `noUncheckedIndexedAccess` widens the read; an out-of-range counter reads as zero by design.
    return this.#values[index] ?? 0;
  }

  set(index: number, value: number): void {
    if (index >= 0 && index < this.#values.length) {
      this.#values[index] = value;
    }
  }

  add(index: number, delta: number): void {
    this.set(index, this.get(index) + delta);
  }

  reset(): void {
    this.#values.fill(0);
  }
}

/**
 * Creates a counter group. {@link Diagnostics.registerGroup} is the entry point games use; this
 * factory exists so a group can be built and tested on its own.
 *
 * @param name - The group name.
 * @param counterNames - The counter names, in the order their indices are assigned.
 * @returns The group.
 *
 * @public
 */
export function createDiagnosticsGroup(name: string, counterNames: readonly string[]): DiagnosticsGroup {
  return new DiagnosticsGroupImpl(name, counterNames);
}

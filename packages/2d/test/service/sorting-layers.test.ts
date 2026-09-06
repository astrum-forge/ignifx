import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORTING_LAYER,
  SORTING_LAYER_ORDER_STEP,
  SortingLayerTable,
} from "../../src/service/sorting-layers.js";

/**
 * `@ignifx/core` owns the `sortingLayers` settings section but ships no resolver for it; this is
 * that resolver (`docs/architecture/11-2d-toolkit.md` §1).
 */

/** Asserts that `run` throws an `IgnifxError` carrying `code`. */
function expectCode(run: () => unknown, code: string): void {
  let captured: unknown = null;
  try {
    run();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(Error);
  expect((captured as { readonly code?: string }).code).toBe(code);
}

describe("SortingLayerTable", () => {
  it("indexes names back to front, in declaration order", () => {
    const table = new SortingLayerTable(["Background", "Default", "Foreground"]);
    expect(table.indexOf("Background")).toBe(0);
    expect(table.indexOf("Default")).toBe(1);
    expect(table.indexOf("Foreground")).toBe(2);
    expect(table.names).toEqual(["Background", "Default", "Foreground"]);
  });

  it("falls back to a single Default layer when the project declares none", () => {
    const table = new SortingLayerTable([]);
    expect(table.names).toEqual([DEFAULT_SORTING_LAYER]);
    expect(table.indexOf(DEFAULT_SORTING_LAYER)).toBe(0);
  });

  it("still resolves Default when the project renamed every layer", () => {
    // An unconfigured `SpriteRenderer` carries "Default"; it has to resolve to *something* or the
    // first sprite a game adds throws before it can be seen.
    const table = new SortingLayerTable(["Ground", "Air"]);
    expect(table.indexOf(DEFAULT_SORTING_LAYER)).toBe(0);
    expect(table.names).toEqual(["Ground", "Air"]);
  });

  it("keeps the first of two identical names", () => {
    const table = new SortingLayerTable(["A", "B", "A"]);
    expect(table.indexOf("A")).toBe(0);
  });

  it("answers an unknown name with -1", () => {
    expect(new SortingLayerTable(["A"]).indexOf("B")).toBe(-1);
  });

  it("refuses an unknown name in require, naming what is declared", () => {
    const table = new SortingLayerTable(["Ground", "Air"]);
    expectCode(() => table.require("Water"), "IGX-1107");
  });

  it("spaces layer orders far enough apart for their sub-layers", () => {
    const table = new SortingLayerTable(["Background", "Default", "Foreground"]);
    expect(table.orderOf("Background")).toBe(0);
    expect(table.orderOf("Default")).toBe(SORTING_LAYER_ORDER_STEP);
    expect(table.orderOf("Foreground")).toBe(2 * SORTING_LAYER_ORDER_STEP);
    expect(SORTING_LAYER_ORDER_STEP).toBeGreaterThanOrEqual(1000);
  });
});

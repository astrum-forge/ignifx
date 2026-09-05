import { describe, expect, it } from "vitest";
import { LayerMask } from "../../src/layers/layer-mask.js";
import { createLayerTable, MAX_LAYERS, RESERVED_LAYER_NAMES } from "../../src/layers/layer-table.js";
import { createTestWorld } from "../support/create-test-world.js";

/** `docs/architecture/02-scene-graph.md` §7. */

describe("the layer table", () => {
  it("reserves slots 0 to 7 for the engine defaults, listed or not", () => {
    const table = createLayerTable();
    expect(RESERVED_LAYER_NAMES).toHaveLength(8);
    for (let index = 0; index < RESERVED_LAYER_NAMES.length; index += 1) {
      expect(table.nameOf(index)).toBe(RESERVED_LAYER_NAMES[index]);
    }
    expect(table.indexOf("Default")).toBe(0);
    expect(table.indexOf("UI")).toBe(4);
    expect(table.count).toBe(8);
  });

  it("fills project layers from slot 8 upwards in declaration order", () => {
    const table = createLayerTable(["Ground", "Player", "Enemy"]);
    expect(table.indexOf("Ground")).toBe(8);
    expect(table.indexOf("Player")).toBe(9);
    expect(table.indexOf("Enemy")).toBe(10);
    expect(table.count).toBe(11);
  });

  it("lets a project list repeat a reserved name without consuming a user slot", () => {
    // `docs/architecture/04-extensions.md` §5's example config opens with "Default".
    const table = createLayerTable(["Default", "Ground", "Player"]);
    expect(table.indexOf("Default")).toBe(0);
    expect(table.indexOf("Ground")).toBe(8);
    expect(table.indexOf("Player")).toBe(9);
  });

  it("skips empty names", () => {
    const table = createLayerTable(["", "Ground"]);
    expect(table.indexOf("Ground")).toBe(8);
  });

  it("throws IGX-0304 for a duplicate project layer name", () => {
    expect(() => createLayerTable(["Ground", "Ground"])).toThrow(/IGX-0304/u);
  });

  it("throws IGX-0305 when the project declares more than 24 layers", () => {
    const names: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      names.push(`Layer${String(index)}`);
    }
    expect(() => createLayerTable(names)).toThrow(/IGX-0305/u);
    expect(() => createLayerTable(names.slice(0, 24))).not.toThrow();
    expect(MAX_LAYERS).toBe(32);
  });

  it("reports an unknown name as absent, and throws IGX-0303 when one is required", () => {
    const table = createLayerTable(["Ground"]);
    expect(table.has("Ground")).toBe(true);
    expect(table.has("Nope")).toBe(false);
    expect(table.indexOf("Nope")).toBe(-1);
    expect(table.requireIndex("Ground")).toBe(8);
    expect(() => table.requireIndex("Nope")).toThrow(/IGX-0303/u);
  });

  it("reports an unassigned or out-of-range slot as having no name", () => {
    const table = createLayerTable(["Ground"]);
    expect(table.nameOf(8)).toBe("Ground");
    expect(table.nameOf(9)).toBeNull();
    expect(table.nameOf(99)).toBeNull();
    expect(table.names).toHaveLength(MAX_LAYERS);
  });
});

describe("LayerMask", () => {
  it("builds from slot indices", () => {
    const mask = LayerMask.of(0, 8);
    expect(mask.bits).toBe(0b1_0000_0001);
    expect(mask.has(0)).toBe(true);
    expect(mask.has(8)).toBe(true);
    expect(mask.has(1)).toBe(false);
  });

  it("ignores slots outside 0 to 31", () => {
    expect(LayerMask.of(-1, 32, 3).bits).toBe(0b1000);
    expect(LayerMask.of(3).has(-1)).toBe(false);
    expect(LayerMask.of(3).has(32)).toBe(false);
  });

  it("builds from names through a table, and through world.layers.mask", () => {
    const harness = createTestWorld({ layers: ["Ground", "Player"] });
    const byWorld = harness.world.layers.mask("Ground", "Player");
    const byTable = LayerMask.fromNames(harness.world.layers, ["Ground", "Player"]);
    expect(byWorld.bits).toBe(byTable.bits);
    expect(byWorld.bits).toBe((1 << 8) | (1 << 9));
    expect(() => harness.world.layers.mask("Nope")).toThrow(/IGX-0303/u);
    harness.dispose();
  });

  it("is immutable under with and without", () => {
    const base = LayerMask.of(1);
    const wider = base.with(2);
    expect(base.bits).toBe(0b10);
    expect(wider.bits).toBe(0b110);
    expect(wider.without(1).bits).toBe(0b100);
    const negative = -1;
    expect(base.with(negative)).toBe(base);
    expect(base.without(32)).toBe(base);
  });

  it("offers nothing, everything, and raw bits", () => {
    expect(LayerMask.nothing().bits).toBe(0);
    expect(LayerMask.everything().bits).toBe(0xff_ff_ff_ff);
    expect(LayerMask.everything().has(31)).toBe(true);
    expect(LayerMask.fromBits(0b101).has(2)).toBe(true);
  });

  it("reports overlap", () => {
    expect(LayerMask.of(1, 2).intersects(LayerMask.of(2, 3))).toBe(true);
    expect(LayerMask.of(1).intersects(LayerMask.of(2))).toBe(false);
  });

  it("resolves back to names, skipping unnamed slots", () => {
    const table = createLayerTable(["Ground"]);
    const mask = LayerMask.of(0, 8, 20);
    expect(mask.toNames(table)).toEqual(["Default", "Ground"]);
  });
});

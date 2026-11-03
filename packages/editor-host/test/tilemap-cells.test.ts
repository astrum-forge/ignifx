import { describe, expect, it } from "vitest";
import { planTileWrites } from "../src/scene/tilemap-cells.js";

const LAYERS = [
  { name: "Back", width: 4, height: 3 },
  { name: "Ground", width: 4, height: 3 },
];

describe("planTileWrites", () => {
  it("turns file-ordered pairs, top row first, into bottom-up cell writes", () => {
    expect(planTileWrites(LAYERS, "Ground", [0, 7, 5, 2, 11, 0])).toEqual([
      { layer: 1, x: 0, y: 2, tileId: 7 },
      { layer: 1, x: 1, y: 1, tileId: 2 },
      { layer: 1, x: 3, y: 0, tileId: 0 },
    ]);
    expect(planTileWrites(LAYERS, 0, [4, 1])).toEqual([{ layer: 0, x: 0, y: 1, tileId: 1 }]);
  });

  it("refuses an unknown layer and a cell outside the layer", () => {
    expect(planTileWrites(LAYERS, "Sky", [0, 1])).toMatch(/no layer "Sky"/u);
    expect(planTileWrites(LAYERS, 2, [0, 1])).toMatch(/no layer 2/u);
    expect(planTileWrites(LAYERS, "Ground", [12, 1])).toMatch(/Cell 12 is outside layer "Ground" \(4×3\)/u);
  });
});

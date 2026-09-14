import { describe, expect, it } from "vitest";
import { defineTerrain } from "../../src/definition/define-terrain.js";
import { resolveTerrainAddress } from "../../src/definition/relative.js";
import { TerrainErrorCode } from "../../src/errors.js";

describe("defineTerrain", () => {
  it("fills every default from an empty document", () => {
    const definition = defineTerrain({});

    expect(definition.format).toBe("ignifx.terrain");
    expect(definition.resolution).toBe(513);
    expect(definition.size).toEqual({ width: 512, depth: 512, height: 80 });
    expect(definition.chunks).toEqual({ size: 64, lodLevels: 4, lodDistance: 96, skirtDepth: 2 });
    expect(definition.chunksPerSide).toBe(8);
    expect(definition.layers).toHaveLength(1);
    expect(definition.noise?.seed).toBe(1);
  });

  it("names the terrain after its document when the document names nothing", () => {
    expect(defineTerrain({}, "levels/island.terrain.json").name).toBe("island");
  });

  it("resolves every address relative to the document", () => {
    const definition = defineTerrain(
      {
        heightmap: { source: "island.r16" },
        layers: [{ name: "grass", albedo: "../shared/grass.png", normal: "../shared/grass_n.png" }],
        splat: { control: ["island_splat.png"] },
      },
      "levels/island.terrain.json",
    );

    expect(definition.heightmap?.source).toBe("levels/island.r16");
    expect(definition.layers[0]?.albedo).toBe("shared/grass.png");
    expect(definition.layers[0]?.normal).toBe("shared/grass_n.png");
    expect(definition.splat?.control[0]).toBe("levels/island_splat.png");
  });

  it("ignores noise once a heightmap is named", () => {
    const definition = defineTerrain({ heightmap: { source: "a.r16" }, noise: { seed: 4 } });

    expect(definition.noise).toBeNull();
  });

  it("refuses a document whose format is not ignifx.terrain", () => {
    expect(() => defineTerrain({ format: "ignifx.scene" })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }),
    );
  });

  it("refuses a formatVersion this build does not read", () => {
    expect(() => defineTerrain({ formatVersion: 2 })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }),
    );
  });

  it("refuses a resolution that is not 2^n + 1", () => {
    expect(() => defineTerrain({ resolution: 500, chunks: { size: 1 } })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.invalidResolution }),
    );
  });

  it("refuses a chunk size that does not divide the field", () => {
    expect(() => defineTerrain({ resolution: 129, chunks: { size: 50 } })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.invalidResolution }),
    );
  });

  it("refuses a chunk size the coarsest LOD stride does not divide", () => {
    expect(() => defineTerrain({ resolution: 129, chunks: { size: 4, lodLevels: 4 } })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.invalidResolution }),
    );
  });

  it("refuses more than eight layers", () => {
    const layers = Array.from({ length: 9 }, (_value, index) => ({ name: `layer${String(index)}` }));

    expect(() => defineTerrain({ layers })).toThrow(expect.objectContaining({ code: TerrainErrorCode.tooManyLayers }));
  });

  it("refuses zero layers", () => {
    expect(() => defineTerrain({ layers: [] })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.tooManyLayers }),
    );
  });

  it("refuses two layers with the same name", () => {
    expect(() => defineTerrain({ layers: [{ name: "grass" }, { name: "grass" }] })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }),
    );
  });

  it("refuses a rule naming a layer the terrain does not declare", () => {
    expect(() => defineTerrain({ layers: [{ name: "grass" }], splatRules: [{ layer: "moss" }] })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unknownLayer }),
    );
  });

  it("refuses painted maps and rules together", () => {
    expect(() =>
      defineTerrain({
        layers: [{ name: "grass" }],
        splat: { control: ["a.png"] },
        splatRules: [{ layer: "grass" }],
      }),
    ).toThrow(expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }));
  });

  it("refuses a control map count that does not match the layer count", () => {
    expect(() =>
      defineTerrain({
        layers: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }],
        splat: { control: ["one.png"] },
      }),
    ).toThrow(expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }));
  });

  it("refuses a band whose minimum is above its maximum", () => {
    expect(() =>
      defineTerrain({ layers: [{ name: "grass" }], splatRules: [{ layer: "grass", height: [40, 10] }] }),
    ).toThrow(expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }));
  });

  it("refuses a negative size", () => {
    expect(() => defineTerrain({ size: { width: -1 } })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }),
    );
  });

  it("reads a layer tint as an array or an object", () => {
    const definition = defineTerrain({
      layers: [
        { name: "a", color: [1, 0.5, 0.25] },
        { name: "b", color: { r: 0, g: 1, b: 0, a: 0.5 } },
      ],
    });

    expect(definition.layers[0]?.color).toEqual({ r: 1, g: 0.5, b: 0.25, a: 1 });
    expect(definition.layers[1]?.color).toEqual({ r: 0, g: 1, b: 0, a: 0.5 });
  });
});

describe("resolveTerrainAddress", () => {
  it("joins a reference to the document's directory", () => {
    expect(resolveTerrainAddress("levels/island.terrain.json", "island.r16")).toBe("levels/island.r16");
  });

  it("collapses parent segments", () => {
    expect(resolveTerrainAddress("levels/island.terrain.json", "../shared/grass.png")).toBe("shared/grass.png");
  });

  it("leaves an absolute reference alone", () => {
    expect(resolveTerrainAddress("levels/island.terrain.json", "https://cdn/x.png")).toBe("https://cdn/x.png");
    expect(resolveTerrainAddress("levels/island.terrain.json", "/root.png")).toBe("/root.png");
  });

  it("answers an empty reference with an empty address", () => {
    expect(resolveTerrainAddress("a/b.terrain.json", "")).toBe("");
  });
});

import { IgnifxError, isValidErrorCode } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { TerrainScatter } from "../src/components/terrain-scatter.js";
import { Terrain } from "../src/components/terrain.js";
import { MAX_TERRAIN_LAYERS, TERRAIN_ERROR_MESSAGES, TerrainErrorCode, terrainError } from "../src/errors.js";
import { terrainFileSchema } from "../src/file-schemas.js";
import * as api from "../src/index.js";
import { describeSchemas, describeTerrainFormat } from "../src/schemas.js";
import { createTerrainApp } from "./support/app.js";

describe("the public barrel", () => {
  it("exports the package version", () => {
    expect(typeof api.VERSION).toBe("string");
  });

  it("exports the extension factory, both components, and the loaders", () => {
    expect(typeof api.terrain).toBe("function");
    expect(api.Terrain.typeId).toBe("ignifx/Terrain");
    expect(api.TerrainScatter.typeId).toBe("ignifx/TerrainScatter");
    expect(api.createTerrainLoader().type).toBe("terrain");
    expect(api.createHeightmapLoader().type).toBe("heightmap");
  });

  it("names the file extensions the Vite plugin maps", () => {
    expect(api.TERRAIN_FILE_EXTENSIONS).toEqual([".terrain.json"]);
    expect(api.HEIGHTMAP_FILE_EXTENSIONS).toEqual([".r16"]);
    expect(api.R16_FILE_EXTENSION).toBe(".r16");
  });
});

describe("the terrain error table", () => {
  it("keeps every code inside the 16xx range", () => {
    for (const code of Object.values(TerrainErrorCode)) {
      expect(code).toMatch(/^IGX-16\d\d$/u);
      expect(isValidErrorCode(code)).toBe(true);
    }
  });

  it("gives every code a message template", () => {
    for (const code of Object.values(TerrainErrorCode)) {
      expect(TERRAIN_ERROR_MESSAGES[code]).toBeTypeOf("string");
    }
  });

  it("declares no message for a code the table does not own", () => {
    expect(Object.keys(TERRAIN_ERROR_MESSAGES).toSorted()).toEqual(Object.values(TerrainErrorCode).toSorted());
  });

  it("builds an IgnifxError carrying the code, the context and the hint", () => {
    const error = terrainError(TerrainErrorCode.unknownLayer, "no such layer", {
      context: { layer: "moss" },
      hint: "check the names",
      cause: new Error("root"),
    });

    expect(error).toBeInstanceOf(IgnifxError);
    expect(error.code).toBe("IGX-1611");
    expect(error.message).toContain("moss");
  });

  it("caps the layer count at two control maps", () => {
    expect(MAX_TERRAIN_LAYERS).toBe(8);
  });
});

describe("the terrain extension", () => {
  it("registers the components, the loaders and the LOD system", async () => {
    const harness = await createTerrainApp();

    expect(harness.app.world.components(Terrain)).toEqual([]);
    expect(harness.app.assets.get("nothing")).toBeNull();
    const entity = harness.app.world.createEntity("Terrain");
    expect(entity.addComponent(Terrain)).toBeInstanceOf(Terrain);
    expect(entity.addComponent(TerrainScatter)).toBeInstanceOf(TerrainScatter);
    harness.dispose();
  });

  it("registers its error codes with the app", async () => {
    const harness = await createTerrainApp();

    await expect(harness.load("missing.terrain.json")).rejects.toThrow();
    harness.dispose();
  });

  it("declares the materialPlugins rendering feature the splat shader needs", async () => {
    const harness = await createTerrainApp();

    expect(harness.app.renderer.features.materialPlugins).toBe(true);
    harness.dispose();
  });
});

describe("the documentation harness view", () => {
  it("describes both components and the file format", () => {
    const described = describeSchemas();

    expect(Object.keys(described).toSorted()).toEqual([
      "ignifx/Terrain",
      "ignifx/TerrainScatter",
      "ignifx/terrain-file",
    ]);
  });

  it("names the format the file schema belongs to", () => {
    expect(describeTerrainFormat().format).toBe("ignifx.terrain");
  });

  it("builds a fresh schema each call, so no module holds state", () => {
    expect(terrainFileSchema()).not.toBe(terrainFileSchema());
  });

  it("describes every field a .terrain.json carries", () => {
    const schema = terrainFileSchema();

    for (const field of ["format", "size", "resolution", "heightmap", "noise", "chunks", "layers", "splat"]) {
      expect(schema[field]).toBeDefined();
    }
  });
});

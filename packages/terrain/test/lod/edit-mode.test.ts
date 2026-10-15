import { Camera } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { terrainAssetFromDefinition } from "../../src/assets/terrain-asset.js";
import { Terrain } from "../../src/components/terrain.js";
import { createTerrainApp } from "../support/app.js";

/**
 * `@ignifx/terrain` in an edit-mode app (ADR-0028): the LOD system keeps running, so chunks follow
 * the editor's camera.
 */

/** Samples per side of the fixture terrain. */
const RESOLUTION = 17;

describe("terrain LOD in an edit-mode app", () => {
  it("coarsens a chunk as the editor camera moves away", async () => {
    const harness = await createTerrainApp({ editMode: true });
    try {
      const handle = await terrainAssetFromDefinition(
        harness.app,
        {
          size: { width: 16, depth: 16, height: 10 },
          resolution: RESOLUTION,
          chunks: { size: 8, lodLevels: 2, lodDistance: 20, skirtDepth: 1 },
          layers: [{ name: "ground" }],
        },
        { heights: new Float32Array(RESOLUTION * RESOLUTION).fill(2) },
      );
      const eye = harness.app.world.createEntity("EditorCamera");
      eye.transform.localPosition.set(0, 20, -20);
      eye.transform.lookAt({ x: 0, y: 0, z: 0 });
      eye.addComponent(Camera, { near: 0.1, far: 500, fov: 60, priority: 1_000_000 });
      const terrain = harness.app.world.createEntity("Terrain").addComponent(Terrain, { definition: handle });
      await harness.app.start();
      harness.step();
      harness.step();
      expect(terrain.lodOf(0, 0)).toBe(0);

      eye.transform.localPosition.set(0, 400, -400);
      harness.step();
      expect(terrain.lodOf(0, 0)).toBe(1);
    } finally {
      harness.dispose();
    }
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { bakeLightProbes } from "../../src/render/light-probe-bake.js";
import { Model } from "../../src/render/model.js";
import { addCameraAndLight, createBrowserApp, fixtureUrl, settle, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { ModelAsset } from "../../src/render/model-asset.js";

/**
 * Under an app with a device a `ModelAsset` keeps no file bytes, so the probe bake reads a `Model`'s
 * triangles from its instance's meshes (Lite's `getMeshTriangles`), at each mesh's world matrix.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("bakeLightProbes under an app with a device", () => {
  it("traces a drawn glTF model from its instance's meshes", async () => {
    const running = await createBrowserApp({
      size: 32,
      assets: [{ address: "models/Box.glb", url: fixtureUrl("Box.glb"), type: "model" }],
    });
    harness = running;
    addCameraAndLight(running, 4);
    const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
    expect(handle.value.sourceBytes).toBeNull();
    const crate = running.world.createEntity("Crate");
    crate.transform.localPosition.set(10, 0, 0);
    crate.addComponent(Model, { model: handle });
    await settle(running, SETTLE_FRAMES * 2);
    const baked = await bakeLightProbes(running.world, {
      origin: { x: 10, y: 0, z: 0 },
      cellSize: { x: 1, y: 1, z: 1 },
      counts: { x: 1, y: 1, z: 1 },
      rays: 64,
      sky: { r: 1, g: 1, b: 1, a: 1 },
    });
    expect(baked.skips).toEqual([]);
    expect(baked.triangles).toBe(12);
    // The probe sits inside the box at the model's world position, so every ray hits it: the white
    // sky is hidden and only the red material's bounce reaches the probe, with no green at all.
    expect(baked.data.coefficients[1]).toBeCloseTo(0, 6);
    expect(baked.data.coefficients[0]).toBeGreaterThan(0);
  });
});

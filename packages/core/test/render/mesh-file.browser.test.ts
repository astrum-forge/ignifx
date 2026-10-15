import { afterEach, describe, expect, it } from "vitest";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { addCameraAndLight, createBrowserApp, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { MeshAsset } from "../../src/render/mesh-asset.js";

/**
 * A `.mesh.json` on a real device (ADR-0029): the loader uploads the same geometry the factory
 * would, and a `MeshRenderer` draws it.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A two-metre box, served from a `data:` URL so the test needs no fixture file. */
const CRATE = JSON.stringify({ format: "ignifx.mesh", formatVersion: 1, primitive: "box", options: { size: 2 } });

describe("a mesh file", () => {
  it("uploads its primitive and draws it through a MeshRenderer", async () => {
    const running = await createBrowserApp({
      size: 48,
      assets: [
        {
          address: "meshes/crate.mesh.json",
          url: `data:application/json,${encodeURIComponent(CRATE)}`,
          type: "mesh",
        },
      ],
    });
    harness = running;
    addCameraAndLight(running, 4);
    const mesh = await running.app.assets.loadAsync<MeshAsset>("meshes/crate.mesh.json");
    expect(mesh.value.lite.mesh).not.toBeNull();
    const material = createMaterialAsset(
      running.app,
      pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
      [],
    );
    const renderer = running.world.createEntity("Crate").addComponent(MeshRenderer, { mesh, materials: [material] });
    await running.advance(SETTLE_FRAMES);
    expect(renderer.lite.mesh).not.toBeNull();
    expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(10);
    mesh.release();
  });
});

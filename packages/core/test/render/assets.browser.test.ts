import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentAsset } from "../../src/render/environment-asset.js";
import { Environment } from "../../src/render/environment.js";
import { readInstalledEnvironment } from "../../src/render/gpu/environment-install.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { ModelAsset } from "../../src/render/model-asset.js";
import { Model } from "../../src/render/model.js";
import { TextureAsset } from "../../src/render/texture-asset.js";
import {
  addCameraAndLight,
  createBrowserApp,
  fixtureUrl,
  pixelLuminance,
  pixelsDiffer,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * The GPU asset loaders and the two components that consume them, on a real device
 * (`docs/architecture/05-assets-and-loading.md` §5, `07-rendering.md` §2.4 and §2.5).
 *
 * The fixtures are the repository's shared samples (`tests/fixtures/assets/`, CC-BY 4.0 / Apache
 * 2.0 — see its `ATTRIBUTION.md`), served by Vitest's own dev server, so the manifest here is what
 * a production build's manifest would be: an address mapped to a URL.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The manifest entries every suite in this file loads through. */
const ASSETS = [
  { address: "models/Box.glb", url: fixtureUrl("Box.glb"), type: "model" },
  { address: "environments/studio.env", url: fixtureUrl("studio.env"), type: "environment" },
  // The same image under a second address, so the swap suite has two distinct loaded environments
  // to move between. The repository ships one `.env`; what a swap has to prove is that the scene
  // moves onto the other asset's own uploaded handles, not that two pictures look different.
  { address: "environments/second.env", url: fixtureUrl("studio.env"), type: "environment" },
  { address: "environments/brdf-lut.png", url: fixtureUrl("brdf-lut.png"), type: "texture" },
];

/**
 * Builds a lit app whose manifest points at the repository fixtures.
 *
 * @param size - The canvas edge.
 * @returns The running app.
 */
async function fixtureApp(size = 48): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size,
    assets: ASSETS,
    settings: { rendering: { brdfLut: "environments/brdf-lut.png" } },
  });
  harness = running;
  return running;
}

describe("the model loader and the Model component", () => {
  it("loads a .glb, instantiates it, and draws it", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 4);
    const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
    expect(handle.value).toBeInstanceOf(ModelAsset);
    expect(handle.value.lite.container).not.toBeNull();

    const entity = running.world.createEntity("Box");
    const model = entity.addComponent(Model, { model: handle });
    await running.advance(SETTLE_FRAMES * 2);

    expect(model.lite.root).not.toBeNull();
    expect(model.nodes.size).toBeGreaterThan(0);
    expect(handle.value.instanceCount).toBe(1);
    expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(10);
  });

  it("shares one upload between two instances and counts them", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 6);
    const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
    const first = running.world.createEntity("A");
    first.transform.localPosition.set(-1.5, 0, 0);
    first.addComponent(Model, { model: handle });
    const second = running.world.createEntity("B");
    second.transform.localPosition.set(1.5, 0, 0);
    second.addComponent(Model, { model: handle });
    await running.advance(SETTLE_FRAMES * 2);

    expect(handle.value.instanceCount).toBe(2);
    // §6: the container itself is never added to a scene, so both instances are clones of one
    // template and the template outlives either of them.
    expect(handle.value.lite.container).not.toBeNull();
  });

  it("gives each instance its own node map", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 6);
    const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
    const first = running.world.createEntity("A").addComponent(Model, { model: handle });
    const second = running.world.createEntity("B").addComponent(Model, { model: handle });
    await running.advance(SETTLE_FRAMES);
    expect(first.nodes).not.toBe(second.nodes);
    expect([...first.nodes.keys()]).toEqual([...second.nodes.keys()]);
  });

  it("attaches an entity under a named glTF node", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 6);
    const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
    const model = running.world.createEntity("Box").addComponent(Model, { model: handle });
    await running.advance(SETTLE_FRAMES);
    const name = [...model.nodes.keys()][0] ?? "";
    expect(name).not.toBe("");
    expect(model.attachToNode(name, running.world.createEntity("Marker"))).toBe(true);
    expect(model.attachToNode("no-such-node", running.world.createEntity("Other"))).toBe(false);
  });

  it("takes the instance out of the scene when the component is destroyed", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 4);
    const handle = await running.app.assets.loadAsync<ModelAsset>("models/Box.glb");
    const entity = running.world.createEntity("Box");
    const model = entity.addComponent(Model, { model: handle });
    await running.advance(SETTLE_FRAMES * 2);
    const withInstance = running.world.lite.scene.meshes.length;
    expect(withInstance).toBeGreaterThan(0);
    const lit = await running.centrePixel();

    model.destroy();
    await running.advance(SETTLE_FRAMES * 2);
    expect(handle.value.instanceCount).toBe(0);
    expect(model.lite.root).toBeNull();
    expect(running.world.lite.scene.meshes.length).toBeLessThan(withInstance);
    expect(pixelsDiffer(lit, await running.centrePixel(), 4)).toBe(true);
  });
});

describe("the texture loader", () => {
  it("uploads a real PNG and reports it through the Lite escape hatch", async () => {
    const running = await fixtureApp();
    const handle = await running.app.assets.loadAsync<TextureAsset>("environments/brdf-lut.png");
    expect(handle.value).toBeInstanceOf(TextureAsset);
    expect(handle.value.lite.texture).not.toBeNull();
    expect(handle.value.isReleased).toBe(false);
  });
});

describe("the environment loader and the Environment component", () => {
  it("loads an .env with its BRDF table and changes what the background shows", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 4);
    await running.advance(SETTLE_FRAMES);
    const before = await running.pixelAt(2, 2);

    const handle = await running.app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
    expect(handle.value).toBeInstanceOf(EnvironmentAsset);
    expect(handle.value.lite.textures).not.toBeNull();
    expect(handle.value.brdfUrl).toContain("brdf-lut.png");

    // The component carries its own clear colour, because that is the only thing an environment
    // loaded *after* `app.start()` changes about a *background* pixel. A declaration that enables a
    // skybox and names no image draws its own cube map, but Lite queues that background in the
    // scene's deferred builders and only `registerScene` drains them, so an environment loaded at
    // runtime never gets one — and the project's `rendering.clearColor`, opaque black by default,
    // is already what the frame starts from (`docs/architecture/07-rendering.md` §2.1, §2.5).
    const environment = running.world.createEntity("Environment").addComponent(Environment, {
      environment: handle,
      clearColor: { r: 0, g: 0, b: 1, a: 1 },
    });
    await running.advance(SETTLE_FRAMES * 3);
    expect(environment.installed).toBe(handle.value);
    const after = await running.pixelAt(2, 2);
    expect(pixelsDiffer(before, after, 8)).toBe(true);
    expect(after.b).toBeGreaterThan(after.r + 20);
    expect(running.errors).toEqual([]);
  });

  it("lights a PBR surface through image based lighting", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 4);
    const mesh = MeshAsset.sphere(running.app, { diameter: 2 });
    const material = createMaterialAsset(
      running.app,
      pbrMaterialDefinition({ metallic: 1, roughness: 0.15, baseColor: { r: 1, g: 1, b: 1, a: 1 } }),
      [],
    );
    running.world.createEntity("Ball").addComponent(MeshRenderer, { mesh, materials: [material] });
    await running.advance(SETTLE_FRAMES * 2);
    const unlit = await running.centrePixel();

    const handle = await running.app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
    running.world.createEntity("Environment").addComponent(Environment, { environment: handle });
    await running.advance(SETTLE_FRAMES * 4);
    const lit = await running.centrePixel();
    // A metal sphere is almost entirely environment reflection, so installing an environment is
    // the difference between "black ball" and "something".
    expect(pixelsDiffer(unlit, lit, 8)).toBe(true);
  });

  it("swaps a loaded environment for another one, and back", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 4);
    const mesh = MeshAsset.sphere(running.app, { diameter: 2 });
    const material = createMaterialAsset(
      running.app,
      pbrMaterialDefinition({ metallic: 1, roughness: 0.15, baseColor: { r: 1, g: 1, b: 1, a: 1 } }),
      [],
    );
    running.world.createEntity("Ball").addComponent(MeshRenderer, { mesh, materials: [material] });
    const first = await running.app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
    const second = await running.app.assets.loadAsync<EnvironmentAsset>("environments/second.env");
    expect(second.value).not.toBe(first.value);

    const environment = running.world.createEntity("Environment").addComponent(Environment, { environment: first });
    await running.advance(SETTLE_FRAMES * 4);
    expect(environment.installed).toBe(first.value);
    expect(readInstalledEnvironment(running.world.lite.scene)).toBe(first.value.lite.textures);
    const litByFirst = pixelLuminance(await running.centrePixel());
    expect(litByFirst).toBeGreaterThan(8);

    environment.environment = second;
    await running.advance(SETTLE_FRAMES * 4);
    expect(environment.installed).toBe(second.value);
    expect(readInstalledEnvironment(running.world.lite.scene)).toBe(second.value.lite.textures);
    // The reflection has to survive the swap: the install reports a topology change, the render-sync
    // system rebuilds the material groups a frame later, and the sphere re-binds the new cube map.
    // A dangling view would present black or reject the frame.
    expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(8);

    environment.environment = first;
    await running.advance(SETTLE_FRAMES * 4);
    expect(readInstalledEnvironment(running.world.lite.scene)).toBe(first.value.lite.textures);
    expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(8);
    expect(running.errors).toEqual([]);
  }, 60_000);

  it("applies fog and the clear colour without a device-only path", async () => {
    const running = await fixtureApp();
    addCameraAndLight(running, 4);
    const environment = running.world.createEntity("Environment").addComponent(Environment, {
      clearColor: { r: 0, g: 1, b: 0, a: 1 },
    });
    environment.fog.mode = "exp2";
    environment.fog.density = 0.05;
    await running.advance(SETTLE_FRAMES * 2);
    const corner = await running.pixelAt(1, 1);
    expect(corner.g).toBeGreaterThan(corner.r + 20);
    expect(running.world.lite.scene.fog).not.toBeNull();
  });
});

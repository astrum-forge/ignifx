import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { addCameraAndLight, createBrowserApp, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * The Phase 2 acceptance scene on a real device: a box, a PBR material, a light, and a camera, in a
 * `createApp({ canvas })` app that a game would recognise
 * (`docs/architecture/07-rendering.md` §2.1–§2.3).
 *
 * Every assertion here is a pixel, because the question these components exist to answer is "did
 * anything reach the screen". The luminance readings use generous margins on purpose: the CI
 * adapter is SwiftShader, and coding standards §10 wants a threshold a software rasteriser and a
 * real driver both clear.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a lit scene with one white box at the origin.
 *
 * @param options - How the scene is framed.
 * @param options.distance - How far back the camera sits, in metres.
 * @returns The running app, the camera, and the box's renderer.
 */
async function buildCubeScene(options: { readonly distance?: number } = {}): Promise<{
  readonly harness: BrowserApp;
  readonly camera: Camera;
  readonly renderer: MeshRenderer;
}> {
  const running = await createBrowserApp({ size: 48 });
  harness = running;
  const camera = addCameraAndLight(running, options.distance ?? 4);
  const mesh = MeshAsset.box(running.app, { size: 2 });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ name: "white", baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const cube = running.world.createEntity("Cube");
  const renderer = cube.addComponent(MeshRenderer, { mesh, materials: [material] });
  await running.advance(SETTLE_FRAMES);
  return { harness: running, camera, renderer };
}

describe("a box, a material, a light, and a camera", () => {
  it("draws something other than the clear colour at the centre of the screen", async () => {
    const scene = await buildCubeScene();
    const centre = await scene.harness.centrePixel();
    expect(pixelLuminance(centre)).toBeGreaterThan(20);
    expect(scene.harness.errors).toEqual([]);
  });

  it("selects the camera as the world's main camera and drives Lite's scene through it", async () => {
    const scene = await buildCubeScene();
    expect(scene.harness.world.mainCamera).toBe(scene.camera);
    expect(scene.harness.world.lite.scene.camera).toBe(scene.camera.lite.camera);
  });

  it("exposes the canvas it draws into as renderer.surface", async () => {
    const scene = await buildCubeScene();
    expect(scene.harness.app.renderer.surface).toBe(scene.harness.canvas);
  });

  it("registers the scene, which closes the rendering feature gate", async () => {
    const scene = await buildCubeScene();
    expect(scene.harness.renderer.isSceneRegistered).toBe(true);
    expect(() => {
      scene.harness.app.renderer.requireFeature("stencil");
    }).toThrow(/IGX-0704/u);
  });

  it("reports draw calls once a frame has been rendered", async () => {
    const scene = await buildCubeScene();
    expect(scene.harness.app.renderer.drawCalls).toBeGreaterThan(0);
  });
});

describe("hiding a renderer", () => {
  it("returns the centre pixel to the clear colour while leaving the mesh in the scene", async () => {
    const scene = await buildCubeScene();
    const lit = pixelLuminance(await scene.harness.centrePixel());
    expect(lit).toBeGreaterThan(20);

    const clone = scene.renderer.lite.mesh;
    expect(clone).not.toBeNull();

    scene.renderer.enabled = false;
    await scene.harness.advance(SETTLE_FRAMES);
    expect(pixelLuminance(await scene.harness.centrePixel())).toBeLessThan(lit / 2);
    // §2.3: never remove a mesh from the scene to hide it — Lite disposes a mesh leaving its last
    // scene. The clone is still the same object, still in the scene, and comes straight back.
    expect(scene.renderer.lite.mesh).toBe(clone);
    expect(scene.renderer.isVisible).toBe(false);

    scene.renderer.enabled = true;
    await scene.harness.advance(SETTLE_FRAMES);
    expect(pixelLuminance(await scene.harness.centrePixel())).toBeGreaterThan(lit / 2);
    expect(scene.renderer.isVisible).toBe(true);
  });

  it("hides with the entity as well as with the component", async () => {
    const scene = await buildCubeScene();
    const lit = pixelLuminance(await scene.harness.centrePixel());
    scene.renderer.entity.active = false;
    await scene.harness.advance(SETTLE_FRAMES);
    expect(pixelLuminance(await scene.harness.centrePixel())).toBeLessThan(lit / 2);
  });
});

describe("the orthographic toggle", () => {
  it("changes how much of the box the screen shows", async () => {
    const scene = await buildCubeScene({ distance: 6 });
    const perspectiveEdge = await scene.harness.pixelAt(2, scene.harness.canvas.height >> 1);
    const perspectiveCentre = await scene.harness.centrePixel();
    expect(pixelLuminance(perspectiveCentre)).toBeGreaterThan(20);

    // Half-height 1 with a 2-metre box fills the viewport, so the edge pixel the perspective
    // camera left at the clear colour is now covered.
    scene.camera.projection = "orthographic";
    scene.camera.orthographicSize = 1;
    await scene.harness.advance(SETTLE_FRAMES);
    const orthographicEdge = await scene.harness.pixelAt(2, scene.harness.canvas.height >> 1);
    expect(pixelLuminance(orthographicEdge)).toBeGreaterThan(pixelLuminance(perspectiveEdge) + 10);
  });
});

describe("light colour", () => {
  it("changes the colour of the lit pixel", async () => {
    const running = await createBrowserApp({ size: 48 });
    harness = running;
    const eye = running.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    const sun = running.world.createEntity("Sun");
    const light = sun.addComponent(Light, { type: "hemispheric", intensity: 1 });
    const mesh = MeshAsset.box(running.app, { size: 2 });
    const material = createMaterialAsset(
      running.app,
      pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
      [],
    );
    running.world.createEntity("Cube").addComponent(MeshRenderer, { mesh, materials: [material] });
    await running.advance(SETTLE_FRAMES);
    const white = await running.centrePixel();
    expect(white.r).toBeGreaterThan(10);

    light.color = { r: 1, g: 0, b: 0, a: 1 };
    await running.advance(SETTLE_FRAMES);
    const red = await running.centrePixel();
    expect(red.r).toBeGreaterThan(red.b + 10);
  });
});

describe("the rendering.clearColor setting", () => {
  it("is what a scene with no camera override and no Environment presents", async () => {
    // The corner pixel is background: nothing is drawn there, so it is the clear colour and only
    // the clear colour. `addCameraAndLight` leaves `Camera.clearColor` at `null` and the world has
    // no `Environment`, which is the case the setting is the sole answer to
    // (`docs/architecture/07-rendering.md` §2.1).
    const running = await createBrowserApp({
      size: 48,
      settings: { rendering: { clearColor: { r: 0, g: 1, b: 0, a: 1 } } },
    });
    harness = running;
    const camera = addCameraAndLight(running, 4);
    await running.advance(SETTLE_FRAMES);
    expect(camera.clearColor).toBeNull();

    const corner = await running.pixelAt(1, 1);
    expect(corner.g).toBeGreaterThan(corner.r + 20);
    expect(corner.g).toBeGreaterThan(corner.b + 20);
    expect(running.errors).toEqual([]);
  });
});

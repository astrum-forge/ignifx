import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { addCameraAndLight, createBrowserApp, gpuDeviceErrors, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { RenderCapture } from "../../src/render/renderer.js";

/**
 * Render-to-texture on a real device (`docs/architecture/07-rendering.md` §2.11).
 *
 * The main camera looks at a red box; a second camera, 10 m to the right, looks at a green one.
 * The texture is 30x20 — not square, and with rows that need padding for the GPU copy — so its
 * centre being green proves the second camera rendered into it at its own size, and the canvas
 * centre staying red proves the main view was left alone.
 */

let harness: BrowserApp | null = null;
let deviceErrors: ReturnType<typeof gpuDeviceErrors> | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
  deviceErrors?.stop();
  deviceErrors = null;
});

/** The texture size. */
const WIDTH = 30;
const HEIGHT = 20;

/**
 * Starts the two-box scene.
 *
 * @param msaa - `rendering.msaaSamples`.
 * @returns The app and the second camera.
 */
async function startScene(msaa: 1 | 4): Promise<{ running: BrowserApp; side: Camera }> {
  deviceErrors = gpuDeviceErrors();
  const running = await createBrowserApp({
    size: 48,
    startEmpty: false,
    settings: { rendering: { msaaSamples: msaa, clearColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 } } },
  });
  harness = running;
  addCameraAndLight(running, 4);
  const unlit = (r: number, g: number): ReturnType<typeof createMaterialAsset> =>
    createMaterialAsset(running.app, pbrMaterialDefinition({ baseColor: { r, g, b: 0, a: 1 }, unlit: true }), []);
  running.world
    .createEntity("Red box")
    .addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [unlit(1, 0)] });
  const green = running.world.createEntity("Green box", { position: { x: 10, y: 0, z: 0 } });
  green.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [unlit(0, 1)] });
  const eye = running.world.createEntity("Side camera", { position: { x: 10, y: 0, z: -4 } });
  const side = eye.addComponent(Camera, { near: 0.1, far: 100 });
  await running.start();
  await running.advance(SETTLE_FRAMES);
  return { running, side };
}

/**
 * The centre pixel of a capture.
 *
 * @param capture - The capture.
 * @returns `[r, g, b]`.
 */
function centreOf(capture: RenderCapture): readonly number[] {
  const index = ((capture.height >> 1) * capture.width + (capture.width >> 1)) * 4;
  return [capture.data[index] ?? 0, capture.data[index + 1] ?? 0, capture.data[index + 2] ?? 0];
}

describe.each([1, 4] as const)("render to texture at MSAA %i", (msaa) => {
  it("renders a second camera into a texture once, leaving the main view alone", async () => {
    const { running, side } = await startScene(msaa);
    const texture = running.app.renderer.createRenderTexture(WIDTH, HEIGHT);
    await running.app.renderer.renderToTexture(side, texture);
    const capture = await texture.readPixels();
    expect([capture.width, capture.height, capture.data.length]).toEqual([WIDTH, HEIGHT, WIDTH * HEIGHT * 4]);
    const [r, g, b] = centreOf(capture);
    expect(g, `texture centre ${String([r, g, b])}`).toBeGreaterThan(150);
    expect(r).toBeLessThan(80);
    const main = await running.centrePixel();
    expect(main.r, `canvas centre ${JSON.stringify(main)}`).toBeGreaterThan(150);
    expect(main.g).toBeLessThan(80);
    texture.dispose();
    await running.advance(2);
    expect(running.errors).toEqual([]);
    expect(deviceErrors?.errors).toEqual([]);
  });

  it("renders a camera's renderTarget every frame, and survives the texture's disposal", async () => {
    const { running, side } = await startScene(msaa);
    side.priority = 10;
    const texture = running.app.renderer.createRenderTexture(WIDTH, HEIGHT);
    side.renderTarget = texture;
    await running.advance(SETTLE_FRAMES);
    const [r, g] = centreOf(await texture.readPixels());
    expect(g, `texture centre ${String([r, g])}`).toBeGreaterThan(150);
    expect(running.world.mainCamera).not.toBe(side);
    expect((await running.centrePixel()).r).toBeGreaterThan(150);
    texture.dispose();
    await running.advance(2);
    expect(deviceErrors?.errors).toEqual([]);
  });
});

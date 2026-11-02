import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { RENDER_TEXTURE_MAX_SIZE } from "../../src/render/render-texture.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * `app.renderer.createRenderTexture` and `renderToTexture` (`docs/architecture/07-rendering.md`
 * §2.11) without a device: the size check, the headless refusals, ownership, and the main-camera
 * rule for `Camera.renderTarget`. `render-texture.browser.test.ts` proves the pixels.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A started headless app with the render layer registered.
 *
 * @returns The harness.
 */
async function app(): Promise<RenderHarness> {
  harness = await createRenderHarness();
  return harness;
}

describe("render textures on a headless app", () => {
  it("creates a texture of any size from 1 to the maximum, and refuses others with IGX-0730", async () => {
    const h = await app();
    const texture = h.app.renderer.createRenderTexture(1, RENDER_TEXTURE_MAX_SIZE);
    expect([texture.width, texture.height, texture.isDisposed]).toEqual([1, RENDER_TEXTURE_MAX_SIZE, false]);
    for (const [width, height] of [
      [0, 8],
      [8, RENDER_TEXTURE_MAX_SIZE + 1],
      [1.5, 8],
      [Number.NaN, 8],
    ] as const) {
      expect(() => h.app.renderer.createRenderTexture(width, height)).toThrow(
        expect.objectContaining({ code: "IGX-0730" }),
      );
    }
  });

  it("refuses to render or read with IGX-0729, since nothing is drawn", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    const texture = h.app.renderer.createRenderTexture(8, 8);
    await expect(h.app.renderer.renderToTexture(camera, texture)).rejects.toMatchObject({ code: "IGX-0729" });
    await expect(texture.readPixels()).rejects.toMatchObject({ code: "IGX-0729" });
  });

  it("refuses a disposed or foreign texture with IGX-0731", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    const texture = h.app.renderer.createRenderTexture(8, 8);
    texture.dispose();
    texture.dispose();
    expect(texture.isDisposed).toBe(true);
    await expect(h.app.renderer.renderToTexture(camera, texture)).rejects.toMatchObject({ code: "IGX-0731" });
    await expect(texture.readPixels()).rejects.toMatchObject({ code: "IGX-0731" });
    const foreign = { width: 8, height: 8, isDisposed: false, readPixels: texture.readPixels, dispose(): void {} };
    await expect(h.app.renderer.renderToTexture(camera, foreign)).rejects.toMatchObject({ code: "IGX-0731" });
  });

  it("never makes a camera with a render target the main camera, whatever its priority", async () => {
    const h = await app();
    const main = h.world.createEntity("Main").addComponent(Camera, { priority: 0 });
    const minimap = h.world.createEntity("Minimap").addComponent(Camera, { priority: 10 });
    h.frame();
    expect(h.world.mainCamera).toBe(minimap);
    minimap.renderTarget = h.app.renderer.createRenderTexture(16, 16);
    h.frame();
    expect(h.world.mainCamera).toBe(main);
    minimap.renderTarget = null;
    h.frame();
    expect(h.world.mainCamera).toBe(minimap);
  });

  it("disposes every open texture with the app", async () => {
    const h = await app();
    const texture = h.app.renderer.createRenderTexture(8, 8);
    h.app.dispose();
    expect(texture.isDisposed).toBe(true);
    expect(() => h.app.renderer.createRenderTexture(8, 8)).toThrow(expect.objectContaining({ code: "IGX-0106" }));
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { bindFrameCameras, RENDER_TEXTURE_MAX_SIZE, RenderTextureImpl } from "../../src/render/render-texture.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { LiteCamera } from "../../src/lite/camera.js";
import type { LiteRenderTexture } from "../../src/lite/gpu/render-texture.js";
import type { FrameCameraSource, RenderTextureOwner } from "../../src/render/render-texture.js";

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

  it("refuses nextFrame with IGX-0729, and a wait that is not a finite count of milliseconds with IGX-0733", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    const texture = h.app.renderer.createRenderTexture(8, 8);
    await expect(h.app.renderer.nextFrame()).rejects.toMatchObject({ code: "IGX-0729" });
    await expect(h.app.renderer.nextFrame({ maxWaitMs: 0 })).rejects.toMatchObject({ code: "IGX-0729" });
    for (const maxWaitMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      // oxlint-disable-next-line no-await-in-loop -- each refusal is checked in turn
      await expect(h.app.renderer.nextFrame({ maxWaitMs })).rejects.toMatchObject({ code: "IGX-0733" });
      // oxlint-disable-next-line no-await-in-loop -- each refusal is checked in turn
      await expect(h.app.renderer.renderToTexture(camera, texture, { maxWaitMs })).rejects.toMatchObject({
        code: "IGX-0733",
      });
    }
  });

  it("refuses a detached camera with IGX-0732", async () => {
    const h = await app();
    const eye = h.world.createEntity("Eye");
    const camera = eye.addComponent(Camera);
    eye.removeComponent(camera);
    h.frame();
    const texture = h.app.renderer.createRenderTexture(8, 8);
    await expect(h.app.renderer.renderToTexture(camera, texture)).rejects.toMatchObject({ code: "IGX-0732" });
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
    const foreign = {
      width: 8,
      height: 8,
      isDisposed: false,
      readPixels: async () => texture.readPixels(),
      dispose(): void {},
    };
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

/** A fake GPU pass that records what the texture asked of it. */
interface FakePass extends LiteRenderTexture {
  /** Every camera the pass was pointed at, `null` for off. */
  readonly cameras: (object | null)[];
  /** Whether `dispose` ran. */
  disposed: boolean;
}

/**
 * A texture over a fake owner, for the per-frame logic without a device.
 *
 * @param fail - Whether creating the pass fails.
 * @returns The texture, its pass, and what the owner saw.
 */
function fakeTexture(fail = false): { texture: RenderTextureImpl; pass: FakePass; released: RenderTextureImpl[] } {
  const pass: FakePass = {
    cameras: [],
    disposed: false,
    setCamera(camera): void {
      pass.cameras.push(camera);
    },
    read: async () => new Uint8ClampedArray(4 * 2 * 3),
    dispose(): void {
      pass.disposed = true;
    },
  };
  const released: RenderTextureImpl[] = [];
  const owner: RenderTextureOwner = {
    createPass: async () => (fail ? Promise.reject(new Error("no device")) : pass),
    release: (texture) => {
      released.push(texture);
    },
  };
  return { texture: new RenderTextureImpl(owner, 2, 3), pass, released };
}

/** Two stand-in Lite cameras; the texture only compares them by identity. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- identity is all the texture reads
const EYE_A = {} as LiteCamera;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const EYE_B = {} as LiteCamera;

describe("a render texture's frames", () => {
  it("renders the oldest request's camera, settles its requests after the frame, then the frame camera", async () => {
    const { texture, pass } = fakeTexture();
    await texture.pass("test");
    const first = texture.request(EYE_A);
    const again = texture.request(EYE_A);
    const second = texture.request(EYE_B);
    let settled = 0;
    for (const request of [first, again]) {
      void request.then(() => {
        settled += 1;
      });
    }
    texture.setFrameCamera(EYE_B);
    texture.flush();
    expect(pass.cameras).toEqual([EYE_A]);
    expect(settled).toBe(0);
    await Promise.all([first, again]);
    expect(settled).toBe(2);
    texture.flush();
    await second;
    texture.setFrameCamera(EYE_A);
    texture.flush();
    texture.flush();
    expect(pass.cameras).toEqual([EYE_A, EYE_B, EYE_A, null]);
  });

  it("starts its pass from the first frame camera, and reads through it", async () => {
    const { texture, pass } = fakeTexture();
    texture.setFrameCamera(EYE_A);
    texture.flush();
    expect(pass.cameras).toEqual([]);
    await texture.pass("test");
    texture.setFrameCamera(EYE_A);
    texture.flush();
    expect(pass.cameras).toEqual([EYE_A]);
    expect(await texture.readPixels()).toMatchObject({ width: 2, height: 3 });
  });

  it("retries a pass that failed to start", async () => {
    const { texture } = fakeTexture(true);
    texture.setFrameCamera(EYE_A);
    await expect(texture.pass("test")).rejects.toThrow("no device");
    await expect(texture.readPixels()).rejects.toThrow("no device");
  });

  it("disposes its pass, settles waiting requests, and tells its owner once", async () => {
    const { texture, pass, released } = fakeTexture();
    const starting = texture.pass("test");
    texture.dispose();
    await expect(starting).rejects.toMatchObject({ code: "IGX-0731" });
    expect(pass.disposed).toBe(true);
    const late = fakeTexture();
    await late.texture.pass("test");
    const waiting = late.texture.request(EYE_A);
    late.texture.dispose();
    late.texture.dispose();
    await waiting;
    expect(late.pass.disposed).toBe(true);
    expect(late.released).toEqual([late.texture]);
    expect(released).toEqual([texture]);
  });
});

/**
 * A camera as `bindFrameCameras` reads it.
 *
 * @param renderTarget - Its target.
 * @param camera - Its Lite camera, or `null` when detached.
 * @param isEnabledInHierarchy - Whether it is enabled.
 * @returns The slice.
 */
function source(
  renderTarget: RenderTextureImpl | null,
  camera: LiteCamera | null,
  isEnabledInHierarchy: boolean,
): FrameCameraSource {
  return { renderTarget, lite: { camera }, isEnabledInHierarchy };
}

describe("binding frame cameras", () => {
  it("binds enabled, attached cameras aiming at a live texture, and nothing else", async () => {
    const live = fakeTexture();
    const stray = fakeTexture();
    await live.texture.pass("test");
    await stray.texture.pass("test");
    bindFrameCameras(
      [
        source(null, EYE_A, true),
        source(stray.texture, EYE_A, true),
        source(live.texture, null, true),
        source(live.texture, EYE_A, false),
        source(live.texture, EYE_B, true),
      ],
      new Set([live.texture]),
    );
    live.texture.flush();
    stray.texture.flush();
    expect(live.pass.cameras).toEqual([EYE_B]);
    expect(stray.pass.cameras).toEqual([null]);
  });
});

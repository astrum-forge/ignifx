import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { TextureAsset } from "../../../src/render/texture-asset.js";
import { createBrowserApp, SETTLE_FRAMES } from "../../render/support/browser-harness.js";
import type { PixelRgba } from "../../../src/lite/screenshot.js";
import type { BrowserApp } from "../../render/support/browser-harness.js";

/**
 * `TextureAsset.fromPixels` and `TextureAsset.update` on a real WebGPU device (the plan's §2.2).
 *
 * A 2×2 texture on an unlit quad that covers the frame is the smallest arrangement in which each
 * texel owns a known quadrant of the canvas, so `nearest` filtering is provable by reading four
 * pixels and so is an update that rewrites one of them.
 *
 * ## What is asserted, and why it is a pattern rather than a colour
 *
 * The frame is what the whole output transform produced — Lite's PBR path writes a tone-mapped,
 * gamma-encoded colour whatever `unlit` says — so a byte read back is not the byte that was
 * uploaded. What survives any per-channel monotonic transform is the *pattern*: a channel that went
 * in at 255 comes out bright and one that went in at 0 comes out black. So each quadrant is
 * classified by which of its channels are bright, and the four classes are what the test pins. That
 * is also why every texel here is made of 0s and 255s.
 *
 * Which quadrant gets which texel depends on the plane primitive's UV winding and on WebGPU's
 * top-left texture origin, so the test asserts the *set* of classes rather than a mapping from
 * corner to colour.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. Even, so the four quadrant samples are symmetric. */
const SIZE = 64;

/** Above this a channel counts as bright. Half of the range, so no transfer function moves it. */
const BRIGHT = 128;

/** The four texels of the test texture, in byte order: red, green, blue, white. */
const TEXELS: readonly (readonly [number, number, number])[] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
];

/** The four classes {@link classify} produces for {@link TEXELS}. */
const TEXEL_CLASSES: readonly string[] = ["100", "010", "001", "111"];

/**
 * The 2×2 RGBA8 bytes of {@link TEXELS}.
 *
 * @returns Sixteen bytes.
 */
function checkerPixels(): Uint8Array {
  const data = new Uint8Array(2 * 2 * 4);
  for (let index = 0; index < TEXELS.length; index += 1) {
    const texel = TEXELS[index] ?? [0, 0, 0];
    data[index * 4] = texel[0];
    data[index * 4 + 1] = texel[1];
    data[index * 4 + 2] = texel[2];
    data[index * 4 + 3] = 255;
  }
  return data;
}

/**
 * Which of a pixel's channels are bright, as three digits.
 *
 * @param pixel - The sampled pixel.
 * @returns For example `"100"` for red and `"000"` for black.
 */
function classify(pixel: PixelRgba): string {
  const bit = (channel: number): string => (channel > BRIGHT ? "1" : "0");
  return `${bit(pixel.r)}${bit(pixel.g)}${bit(pixel.b)}`;
}

/**
 * Builds an app showing one unlit quad textured with a 2×2 pixel texture, covering the frame.
 *
 * @returns The running app and the texture asset.
 */
async function buildQuadScene(): Promise<{
  readonly running: BrowserApp;
  readonly texture: TextureAsset;
}> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1 } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -1);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.01, far: 10, fov: 60 });
  const sky = running.world.createEntity("Sky");
  sky.addComponent(Light, { type: "hemispheric", intensity: 1 });

  const handle = TextureAsset.fromPixels(running.app, "checker", checkerPixels(), 2, 2, { filter: "nearest" });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({
      name: "checker",
      unlit: true,
      baseColor: { r: 1, g: 1, b: 1, a: 1 },
      textures: { baseColorTexture: handle.address },
    }),
    [handle],
  );
  // A 2 m quad one metre from a 60-degree camera covers the frame with room to spare, and the
  // quadrant samples at a quarter and three quarters of the frame still land either side of the
  // texture's midpoint — which is all the test needs.
  const quad = MeshAsset.plane(running.app, { size: 2 });
  const screen = running.world.createEntity("Quad");
  screen.addComponent(MeshRenderer, { mesh: quad, materials: [material], castShadows: false });

  await running.start();
  await running.advance(SETTLE_FRAMES * 2);
  return { running, texture: handle.value };
}

/**
 * The classes of the four quadrant centres of the frame.
 *
 * @param running - The app to capture from.
 * @returns Four classes, in reading order: top-left, top-right, bottom-left, bottom-right.
 */
async function quadrantClasses(running: BrowserApp): Promise<readonly string[]> {
  const quarter = SIZE >> 2;
  const threeQuarters = quarter * 3;
  const topLeft = await running.pixelAt(quarter, quarter);
  const topRight = await running.pixelAt(threeQuarters, quarter);
  const bottomLeft = await running.pixelAt(quarter, threeQuarters);
  const bottomRight = await running.pixelAt(threeQuarters, threeQuarters);
  return [classify(topLeft), classify(topRight), classify(bottomLeft), classify(bottomRight)];
}

describe("a texture from pixels", () => {
  it("reaches the GPU and reports its size from Lite's own handle", async () => {
    const { texture } = await buildQuadScene();
    expect(texture.lite.texture).toBeTruthy();
    expect(texture.width).toBe(2);
    expect(texture.height).toBe(2);
  }, 120_000);

  it("shows each of its four texels in its own quadrant with nearest filtering", async () => {
    const { running } = await buildQuadScene();
    const classes = await quadrantClasses(running);
    expect(classes.toSorted()).toEqual(TEXEL_CLASSES.toSorted());
  }, 120_000);
});

describe("update", () => {
  it("changes exactly the texel it was given", async () => {
    const { running, texture } = await buildQuadScene();
    const before = await quadrantClasses(running);
    expect(before).toContain("100");

    // Byte offset 0 is texel (0, 0): the red one. Black is the one class no texel has.
    texture.update(Uint8Array.from([0, 0, 0, 255]), 0, 0, 1, 1);
    await running.advance(SETTLE_FRAMES * 2);

    const after = await quadrantClasses(running);
    expect(after).not.toContain("100");
    expect(after.filter((value) => value === "000")).toHaveLength(1);
    // Every other quadrant is untouched.
    const unchanged = after.filter((value, index) => value === before[index]);
    expect(unchanged).toHaveLength(3);
  }, 120_000);

  it("rewrites the whole texture when it is given no region", async () => {
    const { running, texture } = await buildQuadScene();
    const cyan = new Uint8Array(2 * 2 * 4);
    for (let index = 0; index < 4; index += 1) {
      cyan[index * 4] = 0;
      cyan[index * 4 + 1] = 255;
      cyan[index * 4 + 2] = 255;
      cyan[index * 4 + 3] = 255;
    }
    texture.update(cyan);
    await running.advance(SETTLE_FRAMES * 2);
    expect(await quadrantClasses(running)).toEqual(["011", "011", "011", "011"]);
  }, 120_000);
});

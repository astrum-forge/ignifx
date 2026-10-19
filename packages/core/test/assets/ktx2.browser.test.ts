import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { KTX2_DECODER_FILE, KTX2_TRANSCODER_FILES, MESHOPT_DECODER_FILE } from "../../src/render/decoder-urls.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { addCameraAndLight, createBrowserApp, fixtureUrl, SETTLE_FRAMES } from "../render/support/browser-harness.js";
import type { AssetHandle } from "../../src/assets/types.js";
import type { PixelRgba } from "../../src/lite/screenshot.js";
import type { TextureAsset } from "../../src/render/texture-asset.js";
import type { BrowserApp } from "../render/support/browser-harness.js";

/**
 * KTX2 textures through `app.assets`, on a real device (engine ask E13).
 *
 * The fixture is one 32×32 image with four solid quadrants, as a PNG and as three `.ktx2` files from
 * the editor's importer (`tests/fixtures/assets/ATTRIBUTION.md`): ETC1S and Zstandard UASTC
 * encoded from the image flipped vertically, and ETC1S encoded from the image as is (top row first). Each is drawn unlit on a plane
 * facing the camera and the four quadrants on screen are compared. A `.ktx2` is uploaded with its
 * rows as stored, so the flipped encode matches the PNG under the default `invertY: true` and the
 * as-is encode draws upside down (`src/lite/gpu/decoders.ts`, "Orientation").
 *
 * The manifest lists the decoders at `/packages/core/decoders/`, the vendored copies
 * `@ignifx/vite-plugin` serves from a project's own origin, exactly as the plugin's manifest would
 * (bare file name → served URL). The resource-timing check then proves the page asked
 * `cdn.babylonjs.com` for nothing, which is what a packaged game's `script-src 'self'` requires.
 */

/** Where the vendored decoders are served from by Vitest's dev server. */
const DECODER_ROOT = "/packages/core/decoders/";

/** Every decoder file, as the Vite plugin's manifest lists them. */
const DECODER_ENTRIES = [
  KTX2_DECODER_FILE,
  MESHOPT_DECODER_FILE,
  ...KTX2_TRANSCODER_FILES.map(([, , file]) => file),
].map((file) => ({ address: file, url: `${DECODER_ROOT}${file}`, type: "binary" }));

/** The two textures, both sampled as sRGB colour. */
const TEXTURE_ENTRIES = [
  {
    address: "textures/quadrants.png",
    url: fixtureUrl("ktx2/quadrants.png"),
    type: "texture",
    meta: { texture: { srgb: true } },
  },
  {
    address: "textures/quadrants.ktx2",
    url: fixtureUrl("ktx2/quadrants-etc1s.ktx2"),
    type: "texture",
    meta: { texture: { srgb: true } },
  },
  {
    address: "textures/quadrants-uastc.ktx2",
    url: fixtureUrl("ktx2/quadrants-uastc.ktx2"),
    type: "texture",
    meta: { texture: { srgb: true } },
  },
  {
    address: "textures/quadrants-top-first.ktx2",
    url: fixtureUrl("ktx2/quadrants-etc1s-top-first.ktx2"),
    type: "texture",
    meta: { texture: { srgb: true } },
  },
];

/** The GPU formats Lite may transcode an ETC1S file to, by device features, as sRGB. */
const ETC1S_TARGETS = ["etc2-rgb8unorm-srgb", "etc2-rgba8unorm-srgb", "bc7-rgba-unorm-srgb", "rgba8unorm-srgb"];

/** The GPU formats Lite may transcode a UASTC file to, by device features, as sRGB. */
const UASTC_TARGETS = ["astc-4x4-unorm-srgb", ...ETC1S_TARGETS];

/** The canvas edge. Large enough that each quadrant covers a block of pixels well away from edges. */
const SIZE = 64;

let harness: BrowserApp | null = null;

beforeAll(() => {
  // Vitest's own module loads fill the default 250-entry buffer long before a test runs, and a full
  // buffer silently drops every later entry — including the decoder requests this file checks.
  performance.clearResourceTimings();
  performance.setResourceTimingBufferSize(10_000);
});

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Names the colour of one rendered pixel.
 *
 * @param pixel - The pixel.
 * @returns `red`, `green`, `blue` or `white`, or the raw channels when it is none of them.
 */
function colourName(pixel: PixelRgba): string {
  const { r, g, b } = pixel;
  if (r > 150 && g > 150 && b > 150) {
    return "white";
  }
  if (r > g + 80 && r > b + 80) {
    return "red";
  }
  if (g > r + 80 && g > b + 80) {
    return "green";
  }
  if (b > r + 80 && b > g + 80) {
    return "blue";
  }
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

/**
 * Draws one texture unlit on a plane that fills most of the view and reads the four quadrants.
 *
 * @param address - The texture's address.
 * @returns The loaded handle and the quadrant colours, top-left, top-right, bottom-left,
 * bottom-right as the capture sees them.
 */
async function drawQuadrants(
  address: string,
): Promise<{ readonly handle: AssetHandle<TextureAsset>; readonly quadrants: readonly string[] }> {
  harness?.dispose();
  const running = await createBrowserApp({ size: SIZE, assets: [...DECODER_ENTRIES, ...TEXTURE_ENTRIES] });
  harness = running;
  addCameraAndLight(running, 4);
  const handle = await running.app.assets.loadAsync<TextureAsset>(address);
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ unlit: true, metallic: 0, textures: { baseColorTexture: address } }),
    [handle],
  );
  const mesh = MeshAsset.plane(running.app, { size: 4 });
  running.world.createEntity("Quad").addComponent(MeshRenderer, { mesh, materials: [material] });
  await running.advance(SETTLE_FRAMES * 2);

  const near = SIZE * 0.3;
  const far = SIZE * 0.7;
  const quadrants = await Promise.all(
    [
      [near, near],
      [far, near],
      [near, far],
      [far, far],
    ].map(async ([x = 0, y = 0]) => colourName(await running.pixelAt(Math.round(x), Math.round(y)))),
  );
  expect(running.errors).toEqual([]);
  return { handle, quadrants };
}

/**
 * The URLs the page has requested so far.
 *
 * @returns Every resource-timing entry's URL.
 */
function requestedUrls(): readonly string[] {
  return performance.getEntriesByType("resource").map((entry) => entry.name);
}

describe("a .ktx2 texture loaded through app.assets", () => {
  it("transcodes to a compressed format and draws the same image as the PNG", async () => {
    const png = await drawQuadrants("textures/quadrants.png");
    expect(png.quadrants.toSorted()).toEqual(["blue", "green", "red", "white"]);

    const ktx2 = await drawQuadrants("textures/quadrants.ktx2");
    const texture = ktx2.handle.value.lite.texture;
    expect(texture).not.toBeNull();
    expect(ktx2.handle.value.width).toBe(32);
    expect(ktx2.handle.value.height).toBe(32);
    expect(ETC1S_TARGETS).toContain(texture?.texture.format);
    expect(texture?.texture.mipLevelCount).toBe(6);
    expect(ktx2.quadrants).toEqual(png.quadrants);
  });

  it("transcodes a Zstandard-supercompressed UASTC file the same way", async () => {
    const png = await drawQuadrants("textures/quadrants.png");
    const uastc = await drawQuadrants("textures/quadrants-uastc.ktx2");
    expect(UASTC_TARGETS).toContain(uastc.handle.value.lite.texture?.texture.format);
    expect(uastc.quadrants).toEqual(png.quadrants);
  });

  it("uploads the rows as stored, so a top-row-first file draws upside down next to the PNG", async () => {
    const png = await drawQuadrants("textures/quadrants.png");
    const [topLeft, topRight, bottomLeft, bottomRight] = png.quadrants;
    const ktx2 = await drawQuadrants("textures/quadrants-top-first.ktx2");
    expect(ktx2.quadrants).toEqual([bottomLeft, bottomRight, topLeft, topRight]);
  });

  it("loads the decoder and its transcoders from the project's origin, never from the CDN", async () => {
    await drawQuadrants("textures/quadrants.ktx2");
    const urls = requestedUrls();
    expect(urls.filter((url) => url.includes("cdn.babylonjs.com"))).toEqual([]);
    const decoderUrls = urls.filter((url) => new URL(url).pathname.startsWith(DECODER_ROOT));
    for (const url of decoderUrls) {
      expect(new URL(url).origin).toBe(location.origin);
    }
    const paths = decoderUrls.map((url) => new URL(url).pathname);
    expect(paths).toContain(`${DECODER_ROOT}${KTX2_DECODER_FILE}`);
    // ETC1S goes through the Basis transcoder whatever the target format.
    expect(paths).toContain(`${DECODER_ROOT}msc_basis_transcoder.js`);
    expect(paths).toContain(`${DECODER_ROOT}msc_basis_transcoder.wasm`);
    // UASTC files carry Zstandard supercompression.
    await drawQuadrants("textures/quadrants-uastc.ktx2");
    expect(requestedUrls().filter((url) => url.includes("cdn.babylonjs.com"))).toEqual([]);
    expect(requestedUrls().map((url) => new URL(url).pathname)).toContain(`${DECODER_ROOT}zstddec.wasm`);
  });
});

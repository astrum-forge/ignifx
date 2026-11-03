import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRACO_DECODER_FILE, DRACO_WASM_FILE, MESHOPT_DECODER_FILE } from "../../src/render/decoder-urls.js";
import { ModelAsset } from "../../src/render/model-asset.js";
import { Model } from "../../src/render/model.js";
import {
  addCameraAndLight,
  createBrowserApp,
  fixtureUrl,
  pixelLuminance,
  SETTLE_FRAMES,
} from "../render/support/browser-harness.js";
import type { BrowserApp } from "../render/support/browser-harness.js";

/**
 * Compressed glTF through `app.assets`, on a real device (engine ask E9).
 *
 * The fixtures are `Box.glb` compressed with `KHR_draco_mesh_compression` and with
 * `EXT_meshopt_compression` (`tests/fixtures/assets/ATTRIBUTION.md`). The manifest lists the
 * decoders at `/packages/core/decoders/`, the vendored copies `@ignifx/vite-plugin` serves from a
 * project's own origin, as the plugin's manifest would (bare file name → served URL). Each box must
 * draw, and the page must have fetched its decoder from there and nothing from a CDN.
 */

/** Where the vendored decoders are served from by Vitest's dev server. */
const DECODER_ROOT = "/packages/core/decoders/";

/** The manifest: the glTF decoders and the two boxes. */
const ASSETS = [
  ...[DRACO_DECODER_FILE, DRACO_WASM_FILE, MESHOPT_DECODER_FILE].map((file) => ({
    address: file,
    url: `${DECODER_ROOT}${file}`,
    type: "binary",
  })),
  { address: "models/box-draco.glb", url: fixtureUrl("Box-draco.glb"), type: "model" },
  { address: "models/box-meshopt.glb", url: fixtureUrl("Box-meshopt.glb"), type: "model" },
];

let harness: BrowserApp | null = null;

beforeAll(() => {
  // Vitest's own module loads can fill the default 250-entry buffer, which drops later entries.
  performance.clearResourceTimings();
  performance.setResourceTimingBufferSize(10_000);
});

afterAll(() => {
  performance.clearResourceTimings();
});

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Loads one model, draws it in front of the camera and reads the centre pixel.
 *
 * @param address - The model's address.
 * @returns The centre pixel's luminance.
 */
async function drawModel(address: string): Promise<number> {
  const running = await createBrowserApp({ size: 48, assets: ASSETS });
  harness = running;
  addCameraAndLight(running, 4);
  const handle = await running.app.assets.loadAsync<ModelAsset>(address);
  expect(handle.value).toBeInstanceOf(ModelAsset);
  expect(handle.value.lite.container).not.toBeNull();
  running.world.createEntity("Box").addComponent(Model, { model: handle });
  await running.advance(SETTLE_FRAMES * 2);
  expect(running.errors).toEqual([]);
  return pixelLuminance(await running.centrePixel());
}

/**
 * The paths the page has requested from the decoder directory, after checking it asked no CDN.
 *
 * @returns The request paths under {@link DECODER_ROOT}.
 */
function decoderRequests(): readonly string[] {
  const urls = performance.getEntriesByType("resource").map((entry) => new URL(entry.name));
  expect(urls.filter((url) => url.hostname.endsWith("babylonjs.com"))).toEqual([]);
  return urls.filter((url) => url.pathname.startsWith(DECODER_ROOT)).map((url) => url.pathname);
}

describe("a compressed .glb loaded through app.assets", () => {
  it("decodes KHR_draco_mesh_compression with the hosted Draco decoder and draws it", async () => {
    expect(await drawModel("models/box-draco.glb")).toBeGreaterThan(10);
    const paths = decoderRequests();
    expect(paths).toContain(`${DECODER_ROOT}${DRACO_DECODER_FILE}`);
    expect(paths).toContain(`${DECODER_ROOT}${DRACO_WASM_FILE}`);
  });

  it("decodes EXT_meshopt_compression with the hosted meshopt decoder and draws it", async () => {
    expect(await drawModel("models/box-meshopt.glb")).toBeGreaterThan(10);
    expect(decoderRequests()).toContain(`${DECODER_ROOT}${MESHOPT_DECODER_FILE}`);
  });
});

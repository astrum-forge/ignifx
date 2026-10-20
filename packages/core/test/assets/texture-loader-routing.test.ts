import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { applyLiteDecoderUrls } from "../../src/lite/gpu/decoders.js";
import { loadGltfFromBytes } from "../../src/lite/gpu/gltf.js";
import { loadBasisTexture, loadKtx2Texture, loadTexture } from "../../src/lite/gpu/texture.js";
import { configureDecoders, KTX2_DECODER_FILE, MESHOPT_DECODER_FILE } from "../../src/render/decoder-urls.js";
import { createModelLoader } from "../../src/render/loaders/model-loader.js";
import { createTextureLoader } from "../../src/render/loaders/texture-loader.js";
import { readTextureImportOptions, toLiteTextureOptions } from "../../src/render/texture-asset.js";
import type { App } from "../../src/app/types.js";
import type { AssetManifest, LoaderContext } from "../../src/assets/types.js";
import type * as DecodersModule from "../../src/lite/gpu/decoders.js";
import type * as GltfModule from "../../src/lite/gpu/gltf.js";
import type { LiteTexture2D } from "../../src/lite/gpu/texture.js";
import type * as TextureModule from "../../src/lite/gpu/texture.js";
import type { LiteEngine } from "../../src/lite/scene.js";
import type { JsonObject } from "../../src/schema/json.js";

/**
 * The texture and model loaders' GPU path, with Lite's loaders replaced (engine ask E13): which Lite
 * loader each container reaches, that the decoders are pointed at the manifest's copies before a
 * KTX2, Basis or glTF load and not before an image, and what a failed load leaves behind. The real
 * GPU loads are `ktx2.browser.test.ts`. This file calls `vi.mock`, so it runs in `node-isolated`;
 * `configureDecoders` remembers what it last applied, so each test uses its own decoder URLs.
 */

/** What happened, in order, across the mocked Lite calls. */
const events: string[] = [];

vi.mock("../../src/lite/gpu/texture.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TextureModule>();
  return { ...actual, loadTexture: vi.fn(), loadKtx2Texture: vi.fn(), loadBasisTexture: vi.fn() };
});

vi.mock("../../src/lite/gpu/decoders.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DecodersModule>();
  return { ...actual, applyLiteDecoderUrls: vi.fn() };
});

vi.mock("../../src/lite/gpu/gltf.js", async (importOriginal) => {
  const actual = await importOriginal<typeof GltfModule>();
  return { ...actual, loadGltfFromBytes: vi.fn() };
});

/** The engine the loaders hand to Lite; the mocks only compare it. */
const ENGINE = { fake: "engine" } as unknown as LiteEngine;

/** The texture the mocked Lite loaders resolve with. */
const TEXTURE = { fake: "texture" } as unknown as LiteTexture2D;

const applyUrls = vi.mocked(applyLiteDecoderUrls);
const imageLoad = vi.mocked(loadTexture);
const ktx2Load = vi.mocked(loadKtx2Texture);
const basisLoad = vi.mocked(loadBasisTexture);
const gltfLoad = vi.mocked(loadGltfFromBytes);

applyUrls.mockImplementation(() => {
  events.push("decoders");
});
for (const [name, mock] of [
  ["image", imageLoad],
  ["ktx2", ktx2Load],
  ["basis", basisLoad],
] as const) {
  mock.mockImplementation(() => {
    events.push(name);
    return Promise.resolve(TEXTURE);
  });
}

afterEach(() => {
  events.length = 0;
  vi.clearAllMocks();
});

/**
 * A manifest that lists the KTX2 and meshopt decoders under `prefix`, plus `extra` entries.
 *
 * @param prefix - The served directory, unique to the test.
 * @param extra - More entries.
 * @returns The manifest.
 */
function decoderManifest(
  prefix: string,
  extra: readonly { address: string; url: string; type?: string }[] = [],
): AssetManifest {
  return createAssetManifest([
    { address: KTX2_DECODER_FILE, url: `${prefix}${KTX2_DECODER_FILE}`, type: "binary" },
    { address: MESHOPT_DECODER_FILE, url: `${prefix}${MESHOPT_DECODER_FILE}`, type: "binary" },
    ...extra,
  ]);
}

/** A loader context for a GPU-backed app, and the progress it reported. */
interface FakeLoad {
  readonly ctx: LoaderContext;
  readonly progress: number[];
}

/**
 * Builds a loader context whose app is not headless.
 *
 * @param address - The asset address.
 * @param url - Its URL.
 * @param manifest - The app's manifest.
 * @param meta - The sidecar's contents.
 * @returns The context and its progress log.
 */
function fakeLoad(address: string, url: string, manifest: AssetManifest, meta: JsonObject | null = null): FakeLoad {
  const progress: number[] = [];
  const app = { isHeadless: false, assets: { manifest }, lite: { scene: null } } as unknown as App;
  const ctx: LoaderContext = {
    address,
    url,
    fragment: null,
    type: "texture",
    app,
    signal: new AbortController().signal,
    fetchBytes: () => Promise.resolve(new ArrayBuffer(8)),
    fetchText: () => Promise.reject(new Error("unused")),
    fetchJson: () => Promise.reject(new Error("unused")),
    loadDependency: () => Promise.reject(new Error("unused")),
    reportProgress: (fraction: number) => {
      progress.push(fraction);
    },
    meta,
    lite: { engine: ENGINE },
  };
  return { ctx, progress };
}

describe("the texture loader on a GPU-backed app", () => {
  it("decodes an image through loadTexture and leaves the decoders alone", async () => {
    const { ctx, progress } = fakeLoad("textures/rock.png", "/a/rock.png", decoderManifest("/png/"));
    const asset = await createTextureLoader().load(ctx);
    expect(events).toEqual(["image"]);
    expect(imageLoad).toHaveBeenCalledWith(ENGINE, "/a/rock.png", toLiteTextureOptions(readTextureImportOptions(null)));
    expect(asset.lite.texture).toBe(TEXTURE);
    expect(asset.address).toBe("textures/rock.png");
    expect(progress).toEqual([0, 1]);
  });

  it("points Lite at the manifest's decoders, then loads a .ktx2 with the sidecar's options", async () => {
    const meta: JsonObject = { texture: { srgb: true } };
    const { ctx, progress } = fakeLoad("textures/rock.ktx2", "/k/rock.1a2b.ktx2", decoderManifest("/k/"), meta);
    const asset = await createTextureLoader().load(ctx);
    expect(events).toEqual(["decoders", "ktx2"]);
    expect(applyUrls).toHaveBeenCalledWith(
      expect.objectContaining({ ktx2Decoder: `/k/${KTX2_DECODER_FILE}`, meshoptBaseUrl: "/k/" }),
    );
    const options = toLiteTextureOptions(readTextureImportOptions(meta));
    expect(options.srgb).toBe(true);
    expect(ktx2Load).toHaveBeenCalledWith(ENGINE, "/k/rock.1a2b.ktx2", options);
    expect(asset.lite.texture).toBe(TEXTURE);
    expect(asset.options.srgb).toBe(true);
    expect(progress).toEqual([0, 1]);
  });

  it("points Lite at the decoders before a .basis load too", async () => {
    const { ctx } = fakeLoad("textures/rock.basis", "/b/rock.basis", decoderManifest("/b/"));
    await createTextureLoader().load(ctx);
    expect(events).toEqual(["decoders", "basis"]);
    expect(basisLoad).toHaveBeenCalledWith(ENGINE, "/b/rock.basis", expect.any(Object));
  });

  it("takes the container from the URL when the address has none", async () => {
    const { ctx } = fakeLoad("rock", "/n/rock.KTX2?v=2", decoderManifest("/n/"));
    await createTextureLoader().load(ctx);
    expect(events).toEqual(["decoders", "ktx2"]);
  });

  it("loads a .ktx2 with Lite's default decoders when the manifest lists none", async () => {
    const manifest = createAssetManifest([{ address: "textures/rock.ktx2", url: "/d/rock.ktx2" }]);
    const { ctx } = fakeLoad("textures/rock.ktx2", "/d/rock.ktx2", manifest);
    await createTextureLoader().load(ctx);
    expect(events).toEqual(["ktx2"]);
    expect(applyUrls).not.toHaveBeenCalled();
  });

  it("applies one manifest's decoders once across loads", async () => {
    const manifest = decoderManifest("/once/");
    await createTextureLoader().load(fakeLoad("a.ktx2", "/once/a.ktx2", manifest).ctx);
    await createTextureLoader().load(fakeLoad("b.ktx2", "/once/b.ktx2", manifest).ctx);
    expect(events).toEqual(["decoders", "ktx2", "ktx2"]);
  });

  it("rejects with Lite's error and reports no completion when the GPU load fails", async () => {
    const failure = new Error("transcode failed");
    ktx2Load.mockImplementationOnce(() => Promise.reject(failure));
    const { ctx, progress } = fakeLoad("textures/bad.ktx2", "/e/bad.ktx2", decoderManifest("/e/"));
    await expect(createTextureLoader().load(ctx)).rejects.toBe(failure);
    expect(progress).toEqual([0]);
  });
});

describe("configureDecoders", () => {
  it("applies a manifest that lists only the meshopt decoder", async () => {
    const manifest = createAssetManifest([
      { address: MESHOPT_DECODER_FILE, url: `/m/${MESHOPT_DECODER_FILE}`, type: "binary" },
    ]);
    await configureDecoders(fakeLoad("x", "x", manifest).ctx.app);
    expect(applyUrls).toHaveBeenCalledWith({ ktx2Decoder: null, ktx2Transcoders: {}, meshoptBaseUrl: "/m/" });
  });

  it("tries again on the next load when pointing Lite at the decoders threw", async () => {
    applyUrls.mockImplementationOnce(() => {
      throw new Error("lite refused");
    });
    const app = fakeLoad("x", "x", decoderManifest("/retry/")).ctx.app;
    await expect(configureDecoders(app)).rejects.toThrow("lite refused");
    await configureDecoders(app);
    expect(applyUrls).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["decoders"]);
  });
});

describe("the model loader on a GPU-backed app", () => {
  it("points Lite at the decoders before parsing a glTF and rejects with the parser's error", async () => {
    const failure = new Error("bad glb");
    gltfLoad.mockImplementationOnce(() => {
      events.push("gltf");
      return Promise.reject(failure);
    });
    const { ctx } = fakeLoad("models/ship.glb", "/g/ship.glb", decoderManifest("/g/"));
    await expect(createModelLoader().load(ctx)).rejects.toBe(failure);
    expect(events).toEqual(["decoders", "gltf"]);
    expect(gltfLoad).toHaveBeenCalledWith(ENGINE, expect.any(ArrayBuffer));
  });
});

import { describe, expect, it } from "vitest";
import { createAssetManifest } from "../../src/assets/manifest.js";
import {
  configureDecoders,
  decoderUrlsFromManifest,
  KTX2_DECODER_FILE,
  KTX2_TRANSCODER_FILES,
  MESHOPT_DECODER_FILE,
} from "../../src/render/decoder-urls.js";
import { textureContainerOf } from "../../src/render/loaders/texture-loader.js";
import { TextureAsset } from "../../src/render/texture-asset.js";
import { createAssetHarness } from "./support/harness.js";

/**
 * How the texture loader picks Lite's loader for a file, and where it points Lite's decoders
 * (engine ask E13). The GPU half is `ktx2.browser.test.ts`.
 */

describe("textureContainerOf", () => {
  it("sends .ktx2 and .basis to their own loaders and everything else to the image decoder", () => {
    expect(textureContainerOf("textures/rock.ktx2", "/assets/textures/rock.3f2a1b9c.ktx2")).toBe("ktx2");
    expect(textureContainerOf("textures/rock.basis", "/assets/textures/rock.3f2a1b9c.basis")).toBe("basis");
    expect(textureContainerOf("textures/rock.png", "/assets/textures/rock.3f2a1b9c.png")).toBe("image");
    expect(textureContainerOf("textures/rock.webp", "/assets/textures/rock.webp")).toBe("image");
  });

  it("ignores case, a fragment and a query", () => {
    expect(textureContainerOf("Textures/Rock.KTX2#frame", "x")).toBe("ktx2");
    expect(textureContainerOf("https://cdn.example.com/rock.ktx2?v=3", "https://cdn.example.com/rock.ktx2?v=3")).toBe(
      "ktx2",
    );
  });

  it("falls back to the URL when the address has no extension", () => {
    expect(textureContainerOf("rock", "/assets/rock.ktx2")).toBe("ktx2");
    expect(textureContainerOf("rock", "/assets/rock")).toBe("image");
  });

  it("does not take a directory's dot for an extension", () => {
    expect(textureContainerOf("v1.ktx2/rock", "/assets/v1.ktx2/rock")).toBe("image");
  });
});

describe("decoderUrlsFromManifest", () => {
  it("points Lite at every decoder file the Vite plugin listed", () => {
    const files = [KTX2_DECODER_FILE, MESHOPT_DECODER_FILE, ...KTX2_TRANSCODER_FILES.map(([, , file]) => file)];
    const manifest = createAssetManifest(
      files.map((file) => ({ address: file, url: `/game/assets/${file}`, type: "binary" })),
    );
    const urls = decoderUrlsFromManifest(manifest);
    expect(urls.ktx2Decoder).toBe("/game/assets/babylon.ktx2Decoder.js");
    expect(urls.meshoptBaseUrl).toBe("/game/assets/");
    expect(urls.ktx2Transcoders).toEqual({
      MSCTranscoder: {
        JSModuleURL: "/game/assets/msc_basis_transcoder.js",
        WasmModuleURL: "/game/assets/msc_basis_transcoder.wasm",
      },
      ZSTDDecoder: { WasmModuleURL: "/game/assets/zstddec.wasm" },
      LiteTranscoder_UASTC_ASTC: { WasmModuleURL: "/game/assets/uastc_astc.wasm" },
      LiteTranscoder_UASTC_BC7: { WasmModuleURL: "/game/assets/uastc_bc7.wasm" },
      LiteTranscoder_UASTC_R8_UNORM: { WasmModuleURL: "/game/assets/uastc_r8_unorm.wasm" },
      LiteTranscoder_UASTC_RG8_UNORM: { WasmModuleURL: "/game/assets/uastc_rg8_unorm.wasm" },
      LiteTranscoder_UASTC_RGBA_SRGB: { WasmModuleURL: "/game/assets/uastc_rgba8_srgb_v2.wasm" },
      LiteTranscoder_UASTC_RGBA_UNORM: { WasmModuleURL: "/game/assets/uastc_rgba8_unorm_v2.wasm" },
    });
  });

  it("leaves Lite's defaults alone when the manifest lists no decoder", () => {
    const manifest = createAssetManifest([{ address: "textures/rock.ktx2", url: "/assets/textures/rock.ktx2" }]);
    expect(decoderUrlsFromManifest(manifest)).toEqual({
      ktx2Decoder: null,
      ktx2Transcoders: {},
      meshoptBaseUrl: null,
    });
  });

  it("ignores transcoders without the decoder script that would read them", () => {
    const manifest = createAssetManifest([{ address: "zstddec.wasm", url: "/assets/zstddec.wasm" }]);
    expect(decoderUrlsFromManifest(manifest).ktx2Transcoders).toEqual({});
  });

  it("uses a meshopt entry only when its URL ends in the file name Lite appends", () => {
    const renamed = createAssetManifest([{ address: MESHOPT_DECODER_FILE, url: "/assets/meshopt.abc123.js" }]);
    expect(decoderUrlsFromManifest(renamed).meshoptBaseUrl).toBeNull();
  });
});

describe("configureDecoders and a headless .ktx2 load", () => {
  it("applies the manifest's decoders once and loads a .ktx2 as a GPU-less texture", async () => {
    const harness = await createAssetHarness({
      manifest: createAssetManifest([
        { address: KTX2_DECODER_FILE, url: `/assets/${KTX2_DECODER_FILE}`, type: "binary" },
        { address: MESHOPT_DECODER_FILE, url: `/assets/${MESHOPT_DECODER_FILE}`, type: "binary" },
        { address: "textures/rock.ktx2", url: "/assets/textures/rock.ktx2", type: "texture" },
      ]),
    });
    try {
      await expect(configureDecoders(harness.app)).resolves.toBeUndefined();
      // The second call finds the same manifest and returns without touching Lite.
      await expect(configureDecoders(harness.app)).resolves.toBeUndefined();

      const pending = harness.app.assets.loadAsync<TextureAsset>("textures/rock.ktx2");
      await harness.settle();
      const handle = await pending;
      expect(handle.value).toBeInstanceOf(TextureAsset);
      expect(handle.value.lite.texture).toBeNull();
      // Headless never fetches a texture: the GPU path is what reads the file.
      expect(harness.net.requests).toEqual([]);
    } finally {
      harness.dispose();
    }
  });
});

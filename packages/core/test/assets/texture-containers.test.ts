import { describe, expect, it } from "vitest";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import {
  configureDecoders,
  decoderUrlsFromManifest,
  DRACO_DECODER_FILE,
  DRACO_WASM_FILE,
  gltfExtensionsUsed,
  KTX2_DECODER_FILE,
  KTX2_TRANSCODER_FILES,
  LEFT_OUT_DECODER_META_KEY,
  MESHOPT_DECODER_FILE,
} from "../../src/render/decoder-urls.js";
import { textureContainerOf } from "../../src/render/loaders/texture-loader.js";
import { TextureAsset } from "../../src/render/texture-asset.js";
import { createAssetHarness } from "./support/harness.js";
import type { AssetHarness } from "./support/harness.js";

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
    const files = [
      KTX2_DECODER_FILE,
      MESHOPT_DECODER_FILE,
      DRACO_DECODER_FILE,
      DRACO_WASM_FILE,
      ...KTX2_TRANSCODER_FILES.map(([, , file]) => file),
    ];
    const manifest = createAssetManifest(
      files.map((file) => ({ address: file, url: `/game/assets/${file}`, type: "binary" })),
    );
    const urls = decoderUrlsFromManifest(manifest);
    expect(urls.ktx2Decoder).toBe("/game/assets/babylon.ktx2Decoder.js");
    expect(urls.meshoptBaseUrl).toBe("/game/assets/");
    expect(urls.dracoBaseUrl).toBe("/game/assets/");
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
      dracoBaseUrl: null,
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

  it("uses the Draco script only when its WebAssembly sits in the same directory", () => {
    const script = { address: DRACO_DECODER_FILE, url: `/assets/${DRACO_DECODER_FILE}` };
    expect(decoderUrlsFromManifest(createAssetManifest([script])).dracoBaseUrl).toBeNull();
    const elsewhere = createAssetManifest([script, { address: DRACO_WASM_FILE, url: `/wasm/${DRACO_WASM_FILE}` }]);
    expect(decoderUrlsFromManifest(elsewhere).dracoBaseUrl).toBeNull();
    const together = createAssetManifest([script, { address: DRACO_WASM_FILE, url: `/assets/${DRACO_WASM_FILE}` }]);
    expect(decoderUrlsFromManifest(together).dracoBaseUrl).toBe("/assets/");
  });
});

describe("configureDecoders and a headless .ktx2 load", () => {
  it("applies the manifest's decoders once and loads a .ktx2 as a GPU-less texture", async () => {
    const harness = await createAssetHarness({
      manifest: createAssetManifest([
        { address: KTX2_DECODER_FILE, url: `/assets/${KTX2_DECODER_FILE}`, type: "binary" },
        { address: MESHOPT_DECODER_FILE, url: `/assets/${MESHOPT_DECODER_FILE}`, type: "binary" },
        { address: DRACO_DECODER_FILE, url: `/assets/${DRACO_DECODER_FILE}`, type: "binary" },
        { address: DRACO_WASM_FILE, url: `/assets/${DRACO_WASM_FILE}`, type: "binary" },
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

/**
 * Loads an asset and answers with what its load rejected with.
 *
 * @param harness - The running harness.
 * @param address - The asset.
 * @returns The rejection, or `null` when the load succeeded.
 */
async function failureOf(harness: AssetHarness, address: string): Promise<unknown> {
  return harness.app.assets.loadAsync(address).then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * The IGX code of a failure or of the error it wraps.
 *
 * @param failure - What a load rejected with.
 * @returns The code, or `null`.
 */
function codeOf(failure: unknown): string | null {
  if (!isIgnifxError(failure)) {
    return null;
  }
  return isIgnifxError(failure.cause) ? failure.cause.code : failure.code;
}

/**
 * The message of a failure's IGX cause, or of the failure itself.
 *
 * @param failure - What a load rejected with.
 * @returns The message.
 */
function messageOf(failure: unknown): string {
  if (!isIgnifxError(failure)) {
    return String(failure);
  }
  return isIgnifxError(failure.cause) ? failure.cause.message : failure.message;
}

/**
 * A manifest whose decoder entries carry the plugin's left-out mark, plus the asset to load.
 *
 * @param group - The `decoders` key that was turned off.
 * @param files - That group's decoder files.
 * @param asset - The asset to load.
 * @returns The manifest.
 */
function manifestWithout(
  group: string,
  files: readonly string[],
  asset: string,
): ReturnType<typeof createAssetManifest> {
  return createAssetManifest([
    ...files.map((file) => ({ address: file, url: `/assets/${file}`, meta: { [LEFT_OUT_DECODER_META_KEY]: group } })),
    { address: asset, url: `/assets/${asset}` },
  ]);
}

describe("a decoder the vite plugin left out", () => {
  it("fails a .ktx2 load with IGX-0508 before anything is fetched", async () => {
    const harness = await createAssetHarness({ manifest: manifestWithout("ktx2", [KTX2_DECODER_FILE], "rock.ktx2") });
    try {
      const failure = await harness.settleUntil(failureOf(harness, "rock.ktx2"), "rock.ktx2");
      expect(codeOf(failure)).toBe("IGX-0508");
      expect(messageOf(failure)).toContain("decoders.ktx2: true");
      expect(harness.net.requests).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("fails a glTF that uses Draco with IGX-0508, and loads one that does not", async () => {
    const manifest = createAssetManifest([
      ...[DRACO_DECODER_FILE, DRACO_WASM_FILE].map((file) => ({
        address: file,
        url: `/assets/${file}`,
        meta: { [LEFT_OUT_DECODER_META_KEY]: "draco" },
      })),
      { address: "draco.gltf", url: "/assets/draco.gltf" },
      { address: "plain.gltf", url: "/assets/plain.gltf" },
    ]);
    const harness = await createAssetHarness({ manifest });
    try {
      harness.net.canned.set(
        "/assets/draco.gltf",
        JSON.stringify({ asset: { version: "2.0" }, extensionsUsed: ["KHR_draco_mesh_compression"] }),
      );
      harness.net.canned.set("/assets/plain.gltf", JSON.stringify({ asset: { version: "2.0" } }));
      expect(codeOf(await harness.settleUntil(failureOf(harness, "draco.gltf"), "draco.gltf"))).toBe("IGX-0508");
      expect(await harness.settleUntil(failureOf(harness, "plain.gltf"), "plain.gltf")).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("reads extensionsUsed from a .glb and a .gltf", () => {
    const json = new TextEncoder().encode(
      JSON.stringify({ extensionsUsed: ["EXT_meshopt_compression"], extensionsRequired: ["KHR_texture_basisu"] }),
    );
    const glb = new ArrayBuffer(20 + json.byteLength);
    const view = new DataView(glb);
    view.setUint32(0, 0x46_54_6c_67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.byteLength, true);
    view.setUint32(12, json.byteLength, true);
    view.setUint32(16, 0x4e_4f_53_4a, true);
    new Uint8Array(glb, 20).set(json);
    expect(gltfExtensionsUsed(glb)).toEqual(["EXT_meshopt_compression", "KHR_texture_basisu"]);
    expect(gltfExtensionsUsed(json.slice().buffer)).toEqual(["EXT_meshopt_compression", "KHR_texture_basisu"]);
    expect(gltfExtensionsUsed(new TextEncoder().encode("not json").buffer)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  binaryAssetLoader,
  GENERIC_ASSET_LOADERS,
  jsonAssetLoader,
  textAssetLoader,
} from "../../src/assets/generic-loaders.js";
import { createAssetHarness } from "./support/harness.js";
import type { App } from "../../src/app/types.js";
import type { AssetLoader } from "../../src/assets/types.js";
import type { LiteEngine } from "../../src/lite/scene.js";

/**
 * The three loaders the core extension registers
 * (`docs/architecture/05-assets-and-loading.md` §5, last row of the core table), plus the parts of
 * `LoaderContext` that only a real load exercises.
 */

describe("the generic loaders", () => {
  it("registers exactly json, text and binary", () => {
    expect(GENERIC_ASSET_LOADERS.map((loader) => loader.type)).toEqual(["json", "text", "binary"]);
    expect(jsonAssetLoader.extensions).toEqual([".json"]);
    expect(textAssetLoader.extensions).toEqual([".txt", ".md", ".csv"]);
    expect(binaryAssetLoader.extensions).toEqual([".bin", ".wasm"]);
  });

  it("parses .json", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load<{ readonly hp: number }>("data/player.json");
    h.net.expect("assets/data/player.json").respond('{"hp":3}');
    await h.settle();
    expect(handle.value).toEqual({ hp: 3 });
    h.dispose();
  });

  it("decodes .txt, .md and .csv as text", async () => {
    const h = await createAssetHarness();
    const handles = ["a.txt", "b.md", "c.csv"].map((address) => h.app.assets.load<string>(`data/${address}`));
    h.net.respondAll("body");
    await h.settle();
    for (const handle of handles) {
      expect(handle.type).toBe("text");
      expect(handle.value).toBe("body");
    }
    h.dispose();
  });

  it("returns .bin and .wasm as bytes", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load<ArrayBuffer>("wasm/havok.wasm");
    h.net.expect("assets/wasm/havok.wasm").respond(new Uint8Array([0, 97, 115, 109]));
    await h.settle();
    expect(handle.type).toBe("binary");
    expect(new Uint8Array(handle.value)).toEqual(new Uint8Array([0, 97, 115, 109]));
    h.dispose();
  });
});

describe("LoaderContext", () => {
  it("exposes the app, the address, the URL, and the Lite engine escape hatch", async () => {
    let seenApp: App | null = null;
    let seenEngine: LiteEngine | null = null;
    let seenUrl = "";
    let seenType = "";
    const probe: AssetLoader<string> = {
      type: "probe",
      extensions: [".probe"],
      load: async (ctx) => {
        seenApp = ctx.app;
        seenEngine = ctx.lite.engine;
        seenUrl = ctx.url;
        seenType = ctx.type;
        return await ctx.fetchText();
      },
    };
    const h = await createAssetHarness({ loaders: [probe] });
    h.app.assets.load("data/a.probe");
    h.net.expect("assets/data/a.probe").respond("ok");
    await h.settle();
    expect(seenApp).toBe(h.app);
    expect(seenEngine).toBe(h.app.lite.engine);
    expect(seenUrl).toBe("assets/data/a.probe");
    expect(seenType).toBe("probe");
    h.dispose();
  });

  it("aborts the loader's own signal when the request is cancelled", async () => {
    let aborted = false;
    const probe: AssetLoader<string> = {
      type: "probe",
      extensions: [".probe"],
      load: async (ctx) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return await ctx.fetchText();
      },
    };
    const h = await createAssetHarness({ loaders: [probe] });
    const controller = new AbortController();
    h.app.assets.load("data/a.probe", { signal: controller.signal });
    controller.abort();
    await h.settle();
    expect(aborted).toBe(true);
    h.dispose();
  });
});

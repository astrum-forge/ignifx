import { describe, expect, it } from "vitest";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { defineExtension } from "../../src/extension/define-extension.js";
import { createAssetHarness } from "./support/harness.js";
import type { Extension } from "../../src/app/types.js";
import type { AssetLoader } from "../../src/assets/types.js";

/**
 * How an extension contributes to the asset service (`docs/architecture/04-extensions.md` §1:
 * `registerAssetType`, `registerAssetLoader`) and what the `assets` settings section drives
 * (§5: `assets: { root: "./assets", preload: ["boot"] }`).
 */

/** An extension that registers one loader and one loader-less type. */
const inkExtension: (options?: void) => Extension = defineExtension(() => ({
  name: "test/ink",
  version: "0.0.0",
  register: (ctx) => {
    const loader: AssetLoader<string> = {
      type: "ink",
      extensions: [".ink"],
      load: async (context) => `ink:${await context.fetchText()}`,
    };
    ctx.registerAssetLoader(loader);
    ctx.registerAssetType({ type: "text", extensions: [".note"] });
  },
}));

describe("ExtensionContext", () => {
  it("registers a loader and a loader-less asset type", async () => {
    const h = await createAssetHarness({ extensions: [inkExtension()] });
    const ink = h.app.assets.load<string>("story/a.ink");
    const note = h.app.assets.load<string>("story/b.note");
    h.net.expect("assets/story/a.ink").respond("hello");
    h.net.expect("assets/story/b.note").respond("plain");
    await h.settle();
    expect(ink.value).toBe("ink:hello");
    expect(note.type).toBe("text");
    expect(note.value).toBe("plain");
    h.dispose();
  });

  it("refuses a second extension that claims a registered type", async () => {
    const clash: (options?: void) => Extension = defineExtension(() => ({
      name: "test/clash",
      version: "0.0.0",
      register: (ctx) => {
        ctx.registerAssetLoader({ type: "ink", extensions: [".ink2"], load: () => Promise.resolve(null) });
      },
    }));
    await expect(createAssetHarness({ extensions: [inkExtension(), clash()] })).rejects.toThrow(/IGX-0506/u);
  });
});

describe("the assets settings section", () => {
  it("preloads the manifest groups it names when the app starts", async () => {
    const manifest = createAssetManifest([
      { address: "data/a.json", url: "u/a", groups: ["boot"] },
      { address: "data/b.json", url: "u/b", groups: ["later"] },
    ]);
    const h = await createAssetHarness({ manifest, start: false, settings: { assets: { preload: ["boot"] } } });
    expect(h.net.requests).toHaveLength(0);
    await h.app.start();
    expect(h.net.urls).toEqual(["u/a"]);
    h.net.respondAll("{}");
    await h.settle();
    expect(h.app.assets.get("data/a.json")?.state).toBe("loaded");
    // A preloaded group is retained for the life of the app; that is what preloading means.
    expect(h.app.assets.get("data/a.json")?.refCount).toBe(1);
    h.dispose();
  });

  it("reports a preload failure through app.onError rather than swallowing it", async () => {
    const manifest = createAssetManifest([{ address: "data/a.json", url: "u/a", groups: ["boot"] }]);
    const h = await createAssetHarness({
      manifest,
      start: false,
      settings: { assets: { preload: ["boot"], retries: 0 } },
    });
    await h.app.start();
    h.net.expect("u/a").fail();
    await h.settle();
    await h.flush();
    expect(h.errors.some((report) => report.source === "asset")).toBe(true);
    h.dispose();
  });

  it("does nothing when no group is configured", async () => {
    const h = await createAssetHarness();
    await h.app.start();
    expect(h.net.requests).toHaveLength(0);
    h.dispose();
  });
});

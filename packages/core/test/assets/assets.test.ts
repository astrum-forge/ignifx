import { describe, expect, it } from "vitest";
import { assetRef } from "../../src/assets/asset-ref.js";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { AssetLoadError } from "../../src/assets/types.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { createAssetHarness } from "./support/harness.js";
import type { AssetLoader } from "../../src/assets/types.js";

/**
 * The behaviour of `app.assets` itself: addressing, the shared cache, the delivery point, the
 * priority queue, cancellation, retries, and the collector
 * (`docs/architecture/05-assets-and-loading.md` §2–§4, §9).
 */

/** The URL `data/a.json` resolves to under the default root. */
const A_URL = "assets/data/a.json";

/** The URL `data/b.json` resolves to under the default root. */
const B_URL = "assets/data/b.json";

describe("addressing", () => {
  it("resolves a relative address against the default asset root", async () => {
    const h = await createAssetHarness();
    expect(h.app.assets.resolveUrl("data/a.json")).toBe(A_URL);
    h.dispose();
  });

  it("resolves against the root the assets settings section names", async () => {
    const h = await createAssetHarness({ settings: { assets: { root: "content/" } } });
    expect(h.app.assets.resolveUrl("data/a.json")).toBe("content/data/a.json");
    h.dispose();
  });

  it("prefers the manifest's hashed URL over the root", async () => {
    const manifest = createAssetManifest([{ address: "data/a.json", url: "static/a.9f8e7d.json" }]);
    const h = await createAssetHarness({ manifest });
    expect(h.app.assets.resolveUrl("data/a.json")).toBe("static/a.9f8e7d.json");
    h.dispose();
  });

  it("passes absolute URLs through untouched and strips the fragment", async () => {
    const h = await createAssetHarness();
    expect(h.app.assets.resolveUrl("https://cdn.example.com/a.json")).toBe("https://cdn.example.com/a.json");
    expect(h.app.assets.resolveUrl("data/a.json#frame:x")).toBe(A_URL);
    h.dispose();
  });

  it("refuses an address no loader claims with IGX-0504", async () => {
    const h = await createAssetHarness();
    try {
      h.app.assets.load("art/hero.tga");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetLoadError);
      expect((error as AssetLoadError).code).toBe(CoreErrorCode.assetNoLoader);
      expect((error as AssetLoadError).address).toBe("art/hero.tga");
    }
    h.dispose();
  });

  it("accepts an explicit type for an address whose extension says nothing", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/anonymous", { type: "text" });
    h.net.expect("assets/data/anonymous").respond("hello");
    await h.settle();
    expect(handle.value).toBe("hello");
    h.dispose();
  });

  it("takes the type from the manifest entry when the extension says nothing", async () => {
    const manifest = createAssetManifest([{ address: "data/anonymous", url: "u/anonymous", type: "text" }]);
    const h = await createAssetHarness({ manifest });
    const handle = h.app.assets.load("data/anonymous");
    h.net.expect("u/anonymous").respond("hello");
    await h.settle();
    expect(handle.value).toBe("hello");
    h.dispose();
  });

  it("prefers the longest registered extension, so .scene.json beats .json", async () => {
    // A type name of its own: the core extension already owns `scene`, and one loader owns one type.
    const layoutLoader: AssetLoader<string> = {
      type: "layout",
      extensions: [".layout.json"],
      load: async (ctx) => `layout:${await ctx.fetchText()}`,
    };
    const h = await createAssetHarness({ loaders: [layoutLoader] });
    const handle = h.app.assets.load("levels/1.layout.json");
    h.net.expect("assets/levels/1.layout.json").respond("{}");
    await h.settle();
    expect(handle.type).toBe("layout");
    expect(handle.value).toBe("layout:{}");
    h.dispose();
  });

  it("accepts an AssetRef as well as a bare address", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load(assetRef<string>("data/a.txt"));
    h.net.expect("assets/data/a.txt").respond("hi");
    await h.settle();
    expect(handle.value).toBe("hi");
    h.dispose();
  });
});

describe("delivery", () => {
  it("keeps the handle loading until the next PreUpdate, however the fetch settled", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load<{ readonly x: number }>("data/a.json");
    expect(handle.state).toBe("loading");
    h.net.expect(A_URL).respond('{"x":1}');
    await h.flush();
    expect(handle.state).toBe("loading");
    h.step();
    expect(handle.state).toBe("loaded");
    expect(handle.value).toEqual({ x: 1 });
    h.dispose();
  });

  it("settles the promise at the same point", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    let settled = false;
    void handle.promise.then(() => {
      settled = true;
    });
    h.net.expect(A_URL).respond("{}");
    await h.flush();
    expect(settled).toBe(false);
    h.step();
    await h.flush();
    expect(settled).toBe(true);
    h.dispose();
  });

  it("throws IGX-0501 when the value is read before delivery", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    try {
      void handle.value;
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AssetLoadError).code).toBe(CoreErrorCode.assetNotLoaded);
    }
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    h.dispose();
  });

  it("resolves loadAsync at the delivery point too", async () => {
    const h = await createAssetHarness();
    const pending = h.app.assets.loadAsync<string>("data/a.txt");
    h.net.expect("assets/data/a.txt").respond("hi");
    await h.flush();
    h.step();
    const handle = await pending;
    expect(handle.state).toBe("loaded");
    expect(handle.value).toBe("hi");
    h.dispose();
  });
});

describe("the shared cache", () => {
  it("returns the same handle for the same address and counts the holders", async () => {
    const h = await createAssetHarness();
    const first = h.app.assets.load("data/a.json");
    const second = h.app.assets.load("data/a.json");
    expect(second).toBe(first);
    expect(first.refCount).toBe(2);
    expect(h.net.requests).toHaveLength(1);
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    expect(h.app.assets.get("data/a.json")).toBe(first);
    h.dispose();
  });

  it("keeps different types of one address apart", async () => {
    const h = await createAssetHarness();
    const asJson = h.app.assets.load("data/a.json");
    const asText = h.app.assets.load("data/a.json", { type: "text" });
    expect(asText).not.toBe(asJson);
    expect(h.net.requests).toHaveLength(2);
    h.dispose();
  });

  it("returns null from get for an address nothing requested", async () => {
    const h = await createAssetHarness();
    expect(h.app.assets.get("data/a.json")).toBe(null);
    h.dispose();
  });

  it("releases by address as well as by handle", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    h.app.assets.release("data/a.json");
    expect(handle.refCount).toBe(0);
    h.app.assets.release(handle);
    expect(handle.refCount).toBe(0);
    h.dispose();
  });
});

describe("the collector", () => {
  it("unloads a zero-reference asset after gcDelay seconds of engine time", async () => {
    const unloaded: string[] = [];
    const loader = countingLoader(unloaded);
    const h = await createAssetHarness({ loaders: [loader], settings: { assets: { gcDelay: 2 } } });
    const handle = h.app.assets.load("data/a.count");
    h.net.expect("assets/data/a.count").respond("v1");
    await h.settle();
    handle.release();
    expect(handle.refCount).toBe(0);
    h.step(1);
    expect(handle.state).toBe("loaded");
    h.step(1);
    expect(handle.state).toBe("released");
    expect(unloaded).toEqual(["v1"]);
    expect(() => handle.value).toThrow();
    h.dispose();
  });

  it("unloads at the next delivery point when gcDelay is zero", async () => {
    const h = await createAssetHarness({ settings: { assets: { gcDelay: 0 } } });
    const handle = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    handle.release();
    h.step();
    expect(handle.state).toBe("released");
    h.dispose();
  });

  it("calls a pending collection off when the asset is retained again", async () => {
    const h = await createAssetHarness({ settings: { assets: { gcDelay: 2 } } });
    const handle = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    handle.release();
    h.step(1);
    handle.retain();
    h.step(1);
    h.step(1);
    expect(handle.state).toBe("loaded");
    h.dispose();
  });

  it("unloads on demand through gc()", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    handle.release();
    h.app.assets.gc();
    expect(handle.state).toBe("released");
    h.dispose();
  });

  it("leaves a load that is still in flight alone", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    handle.release();
    h.app.assets.gc();
    expect(handle.state).toBe("loading");
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    expect(handle.state).toBe("loaded");
    h.dispose();
  });

  it("starts a fresh load when a released address is asked for again", async () => {
    const h = await createAssetHarness();
    const first = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).respond('{"v":1}');
    await h.settle();
    first.release();
    h.app.assets.gc();
    const second = h.app.assets.load("data/a.json");
    expect(second).not.toBe(first);
    h.net.expect(A_URL).respond('{"v":2}');
    await h.settle();
    expect(second.value).toEqual({ v: 2 });
    expect(h.net.requests).toHaveLength(2);
    h.dispose();
  });

  it("keeps gcDelay writable at runtime", async () => {
    const h = await createAssetHarness();
    expect(h.app.assets.gcDelay).toBe(5);
    h.app.assets.gcDelay = 0;
    const handle = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    handle.release();
    h.step();
    expect(handle.state).toBe("released");
    h.dispose();
  });
});

describe("the priority queue", () => {
  it("runs at most `concurrency` fetches at once", async () => {
    const h = await createAssetHarness({ settings: { assets: { concurrency: 2 } } });
    h.app.assets.load("data/a.json");
    h.app.assets.load("data/b.json");
    h.app.assets.load("data/c.json");
    h.app.assets.load("data/d.json");
    expect(h.net.requests).toHaveLength(2);
    h.net.expect(A_URL).respond("{}");
    await h.flush();
    expect(h.net.requests).toHaveLength(3);
    h.dispose();
  });

  it("runs a higher priority first and keeps request order within one priority", async () => {
    const h = await createAssetHarness({ settings: { assets: { concurrency: 1 } } });
    h.app.assets.load("data/a.json");
    h.app.assets.load("data/b.json");
    h.app.assets.load("data/c.json", { priority: 10 });
    expect(h.net.urls).toEqual([A_URL]);
    h.net.expect(A_URL).respond("{}");
    await h.flush();
    expect(h.net.urls).toEqual([A_URL, "assets/data/c.json"]);
    h.net.expect("assets/data/c.json").respond("{}");
    await h.flush();
    expect(h.net.urls).toEqual([A_URL, "assets/data/c.json", B_URL]);
    h.dispose();
  });
});

describe("cancellation", () => {
  it("aborts the fetch and fails the handle with IGX-0502", async () => {
    const h = await createAssetHarness();
    const controller = new AbortController();
    const handle = h.app.assets.load("data/a.json", { signal: controller.signal });
    controller.abort();
    await h.settle();
    expect(handle.state).toBe("failed");
    expect(handle.error?.code).toBe(CoreErrorCode.assetLoadAborted);
    h.dispose();
  });

  it("releases the aborted request's own hold", async () => {
    const h = await createAssetHarness();
    const controller = new AbortController();
    const handle = h.app.assets.load("data/a.json", { signal: controller.signal });
    expect(handle.refCount).toBe(1);
    controller.abort();
    expect(handle.refCount).toBe(0);
    await h.settle();
    h.dispose();
  });

  it("does not cancel a shared load that another request still wants", async () => {
    const h = await createAssetHarness();
    const controller = new AbortController();
    const first = h.app.assets.load("data/a.json", { signal: controller.signal });
    const second = h.app.assets.load("data/a.json");
    expect(second).toBe(first);
    controller.abort();
    await h.flush();
    const request = h.net.pending(A_URL);
    expect(request).not.toBe(null);
    request?.respond('{"x":1}');
    await h.settle();
    expect(second.state).toBe("loaded");
    expect(second.refCount).toBe(1);
    h.dispose();
  });

  it("fails immediately when the signal was already aborted", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json", { signal: AbortSignal.abort() });
    expect(handle.refCount).toBe(0);
    await h.settle();
    expect(handle.state).toBe("failed");
    expect(handle.error?.code).toBe(CoreErrorCode.assetLoadAborted);
    h.dispose();
  });

  it("still releases the hold when the abort arrives after the asset loaded", async () => {
    const h = await createAssetHarness();
    const controller = new AbortController();
    const handle = h.app.assets.load("data/a.json", { signal: controller.signal });
    h.net.expect(A_URL).respond("{}");
    await h.settle();
    expect(handle.state).toBe("loaded");
    controller.abort();
    expect(handle.refCount).toBe(0);
    h.dispose();
  });
});

describe("retries", () => {
  it("retries with exponential backoff measured in engine time, then fails with IGX-0505", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    const cause = new Error("network down");
    h.net.expect(A_URL).fail(cause);
    await h.flush();
    expect(h.net.requests).toHaveLength(1);

    h.step(0.05);
    expect(h.net.requests).toHaveLength(1);
    h.step(0.5);
    expect(h.net.requests).toHaveLength(2);

    h.net.expect(A_URL).fail(cause);
    await h.flush();
    h.step(0.1);
    expect(h.net.requests).toHaveLength(2);
    h.step(0.5);
    expect(h.net.requests).toHaveLength(3);

    h.net.expect(A_URL).fail(cause);
    await h.flush();
    h.step(1);
    expect(h.net.requests).toHaveLength(3);
    expect(handle.state).toBe("failed");
    expect(handle.error?.code).toBe(CoreErrorCode.assetLoadFailed);
    expect(handle.error?.cause).toBe(cause);
    h.dispose();
  });

  it("gives up at once when the settings ask for no retries", async () => {
    const h = await createAssetHarness({ settings: { assets: { retries: 0 } } });
    const handle = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).fail();
    await h.settle();
    expect(handle.state).toBe("failed");
    expect(h.net.requests).toHaveLength(1);
    h.dispose();
  });

  it("treats a non-2xx response as a failure", async () => {
    const h = await createAssetHarness({ settings: { assets: { retries: 0 } } });
    const handle = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).respond("not found", { status: 404 });
    await h.settle();
    expect(handle.state).toBe("failed");
    expect(String(handle.error?.cause)).toContain("404");
    h.dispose();
  });

  it("does not retry an abort", async () => {
    const h = await createAssetHarness();
    const controller = new AbortController();
    h.app.assets.load("data/a.json", { signal: controller.signal });
    controller.abort();
    await h.settle();
    h.step(1);
    expect(h.net.requests).toHaveLength(1);
    h.dispose();
  });
});

describe("loader registration", () => {
  it("refuses a second loader for one type with IGX-0506", async () => {
    const h = await createAssetHarness();
    expect(() => {
      h.app.assets.registerLoader({ type: "json", extensions: [".json2"], load: () => Promise.resolve(null) });
    }).toThrow(/IGX-0506/u);
    h.dispose();
  });

  it("lets registerType map extensions before a loader exists", async () => {
    const h = await createAssetHarness();
    h.app.assets.registerType({ type: "text", extensions: [".ini"] });
    const handle = h.app.assets.load("data/a.ini");
    h.net.expect("assets/data/a.ini").respond("k=v");
    await h.settle();
    expect(handle.value).toBe("k=v");
    h.dispose();
  });
});

/**
 * A loader whose values are plain strings and whose `unload` records what it released.
 *
 * @param unloaded - The log to append released values to.
 * @returns The loader.
 */
function countingLoader(unloaded: string[]): AssetLoader<string> {
  return {
    type: "count",
    extensions: [".count"],
    load: (ctx) => ctx.fetchText(),
    unload: (value) => {
      unloaded.push(value);
    },
  };
}

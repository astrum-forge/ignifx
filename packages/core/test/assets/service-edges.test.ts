import { describe, expect, it } from "vitest";
import { AssetsImpl, assetsInternals } from "../../src/assets/assets-service.js";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { Diagnostics } from "../../src/diagnostics/diagnostics.js";
import { createAssetHarness } from "./support/harness.js";
import type { AssetHandle, AssetLoader, Assets } from "../../src/assets/types.js";

/**
 * The corners of the service the happy paths do not reach: construction without an engine, the
 * collector's interaction with loads in flight, hot reload through a loader that implements
 * `reload`, dependency deduplication, and the guards that keep a disposed app quiet.
 */

/** The placeholder a gate's resolver starts as, hoisted so it captures nothing. */
function notSettledYet(): void {
  // Replaced by the promise executor before anything calls it.
}

/** A promise a test settles by hand. */
function gate<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = notSettledYet;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("construction", () => {
  it("refuses the Lite escape hatch until an engine is attached", async () => {
    const h = await createAssetHarness();
    const orphan = new AssetsImpl({ app: h.app, diagnostics: new Diagnostics() });
    expect(() => orphan.engine).toThrow(/IGX-0107/u);
    expect(orphan.manifest.entries).toHaveLength(0);
    h.dispose();
  });

  it("replaces the manifest when a build resolves one later", async () => {
    const h = await createAssetHarness();
    expect(h.app.assets.resolveUrl("data/a.json")).toBe("assets/data/a.json");
    h.assets.setManifest(createAssetManifest([{ address: "data/a.json", url: "hashed/a.json" }], "dist"));
    expect(h.app.assets.resolveUrl("data/a.json")).toBe("hashed/a.json");
    expect(h.app.assets.resolveUrl("data/b.json")).toBe("dist/data/b.json");
    h.dispose();
  });

  it("clamps nonsense settings into range", async () => {
    const h = await createAssetHarness();
    h.assets.applySettings({ root: "r", preload: [], concurrency: 0, gcDelay: -3, retries: -1 });
    expect(h.app.assets.gcDelay).toBe(0);
    h.dispose();
  });

  it("keeps the manifest's root when one was supplied at construction", async () => {
    const manifest = createAssetManifest([], "packaged");
    const h = await createAssetHarness({ manifest, settings: { assets: { root: "ignored" } } });
    expect(h.app.assets.resolveUrl("a.json")).toBe("packaged/a.json");
    h.dispose();
  });

  it("refuses to hand out the internals of something it did not create", () => {
    expect(() => assetsInternals({} as unknown as Assets)).toThrow(/IGX-0702/u);
  });
});

describe("the collector and loads in flight", () => {
  it("leaves a zero-reference load that has not settled in the candidate list", async () => {
    const h = await createAssetHarness({ settings: { assets: { gcDelay: 0 } } });
    const handle = h.app.assets.load("data/a.json");
    handle.release();
    h.step();
    expect(handle.state).toBe("loading");
    h.net.expect("assets/data/a.json").respond("{}");
    await h.settle();
    h.step();
    expect(handle.state).toBe("released");
    h.dispose();
  });

  it("keeps the by-address lookup pointing at the first handle of an address", async () => {
    const h = await createAssetHarness({ settings: { assets: { gcDelay: 0 } } });
    const asJson = h.app.assets.load("data/a.json");
    const asText = h.app.assets.load("data/a.json", { type: "text" });
    h.net.respondAll("{}");
    await h.settle();
    asText.release();
    h.step();
    expect(asText.state).toBe("released");
    expect(h.app.assets.get("data/a.json")).toBe(asJson);
    h.dispose();
  });

  it("does not count a second request as a new interest once the asset is loaded", async () => {
    const h = await createAssetHarness();
    const first = h.app.assets.load("data/a.json");
    h.net.expect("assets/data/a.json").respond("{}");
    await h.settle();
    const second = h.app.assets.load("data/a.json");
    expect(second).toBe(first);
    expect(second.refCount).toBe(2);
    expect(h.net.requests).toHaveLength(1);
    h.dispose();
  });
});

describe("hot reload through a loader that implements reload", () => {
  it("uses the loader's own reload and leaves the previous value to it", async () => {
    const unloaded: string[] = [];
    const reloadable: AssetLoader<string> = {
      type: "reloadable",
      extensions: [".rl"],
      load: (ctx) => ctx.fetchText(),
      reload: async (ctx, previous) => `${previous}+${await ctx.fetchText()}`,
      unload: (value) => {
        unloaded.push(value);
      },
    };
    const h = await createAssetHarness({ loaders: [reloadable] });
    const handle = h.app.assets.load<string>("a.rl");
    h.net.expect("assets/a.rl").respond("v1");
    await h.settle();
    h.assets.reload("a.rl");
    h.net.expect("assets/a.rl").respond("v2");
    await h.settle();
    expect(handle.value).toBe("v1+v2");
    expect(unloaded).toHaveLength(0);
    h.dispose();
  });

  it("matches a fragment handle by its base path", async () => {
    const atlas: AssetLoader<Record<string, number>> = {
      type: "atlas",
      extensions: [".atlas.json"],
      load: (ctx) => ctx.fetchJson<Record<string, number>>(),
      parseFragment: (fragment, value) => value[fragment] ?? null,
    };
    const h = await createAssetHarness({ loaders: [atlas] });
    const button = h.app.assets.load<number>("ui.atlas.json#button");
    h.net.expect("assets/ui.atlas.json").respond('{"button":1}');
    await h.settle();
    await h.settle();
    expect(button.value).toBe(1);
    h.assets.reload("ui.atlas.json");
    h.net.expect("assets/ui.atlas.json").respond('{"button":2}');
    await h.settle();
    await h.settle();
    await h.settle();
    expect(button.value).toBe(2);
    h.dispose();
  });

  it("skips an address whose handle has not finished loading", async () => {
    const h = await createAssetHarness();
    h.app.assets.load("data/a.json");
    h.assets.reload("data/a.json");
    expect(h.net.requests).toHaveLength(1);
    h.net.expect("assets/data/a.json").respond("{}");
    await h.settle();
    h.dispose();
  });
});

describe("dependencies", () => {
  it("retains a repeated dependency exactly once", async () => {
    const twice: AssetLoader<string> = {
      type: "twice",
      extensions: [".twice"],
      load: async (ctx) => {
        const first = await ctx.loadDependency<string>("data/b.txt", { type: "text" });
        const second = await ctx.loadDependency<string>("data/b.txt", { type: "text" });
        return `${first.value}${second.value}`;
      },
    };
    const h = await createAssetHarness({ loaders: [twice] });
    const handle = h.app.assets.load<string>("a.twice");
    h.net.expect("assets/data/b.txt").respond("x");
    await h.settle();
    await h.settle();
    expect(handle.value).toBe("xx");
    expect(h.app.assets.get("data/b.txt")?.refCount).toBe(1);
    h.dispose();
  });
});

describe("late arrivals", () => {
  it("fails a load whose request was aborted after the response came back", async () => {
    const h = await createAssetHarness();
    const controller = new AbortController();
    const handle = h.app.assets.load("data/a.json", { signal: controller.signal });
    h.net.expect("assets/data/a.json").respond("{}");
    controller.abort();
    await h.settle();
    expect(handle.state).toBe("failed");
    expect(handle.error?.code).toBe("IGX-0502");
    h.dispose();
  });

  it("drops a loader result that arrives after the app was disposed", async () => {
    const pending = gate<string>();
    const stubborn: AssetLoader<string> = {
      type: "stubborn",
      extensions: [".sb"],
      load: () => pending.promise,
    };
    const h = await createAssetHarness({ loaders: [stubborn] });
    const handle = h.app.assets.load<string>("a.sb");
    const rejection = handle.promise.catch((error: unknown) => error);
    h.app.dispose();
    pending.resolve("late");
    await h.flush();
    expect(handle.state).toBe("released");
    await rejection;
  });

  it("drops a hot-reload result that arrives after the app was disposed", async () => {
    const pending = gate<string>();
    let calls = 0;
    const stubborn: AssetLoader<string> = {
      type: "stubborn",
      extensions: [".sb"],
      load: (ctx) => {
        calls += 1;
        return calls === 1 ? ctx.fetchText() : pending.promise;
      },
    };
    const h = await createAssetHarness({ loaders: [stubborn] });
    h.app.assets.load<string>("a.sb");
    h.net.expect("assets/a.sb").respond("v1");
    await h.settle();
    h.assets.reload("a.sb");
    h.app.dispose();
    pending.resolve("late");
    await h.flush();
    expect(calls).toBe(2);
  });

  it("ignores delivery and a second dispose once the app is gone", async () => {
    const h = await createAssetHarness();
    h.app.dispose();
    h.assets.deliver(1, 1);
    h.assets.dispose();
    expect(h.errors).toHaveLength(0);
  });

  it("rejects the fetches still queued when the app is disposed", async () => {
    const h = await createAssetHarness({ settings: { assets: { concurrency: 1, retries: 0 } } });
    const first = h.app.assets.load("data/a.json");
    const second = h.app.assets.load("data/b.json");
    const rejections = Promise.all([
      first.promise.catch((error: unknown) => error),
      second.promise.catch((error: unknown) => error),
    ]);
    h.app.dispose();
    const [a, b] = await rejections;
    expect((a as { code: string }).code).toBe("IGX-0503");
    expect((b as { code: string }).code).toBe("IGX-0503");
  });
});

describe("batches", () => {
  it("aborts at once when the outer signal is already aborted", async () => {
    const h = await createAssetHarness();
    const batch = h.app.assets.loadAll(["data/a.json"], { signal: AbortSignal.abort() });
    await h.settle();
    expect(batch.handles[0]?.state).toBe("failed");
    batch.cancel();
    batch.release();
    expect(batch.handles[0]?.refCount).toBe(0);
    h.dispose();
  });
});

describe("failure reporting", () => {
  it("reports a throwing unload through app.onError rather than failing teardown", async () => {
    const angry: AssetLoader<string> = {
      type: "angry",
      extensions: [".angry"],
      load: (ctx) => ctx.fetchText(),
      unload: () => {
        throw new Error("unload boom");
      },
    };
    const h = await createAssetHarness({ loaders: [angry], settings: { assets: { gcDelay: 0 } } });
    const handle = h.app.assets.load<string>("a.angry");
    h.net.expect("assets/a.angry").respond("v");
    await h.settle();
    handle.release();
    h.step();
    expect(handle.state).toBe("released");
    expect(h.errors.some((report) => report.source === "asset")).toBe(true);
    h.dispose();
  });

  it("reports a throwing progress listener and keeps delivering to the rest", async () => {
    const h = await createAssetHarness();
    let reached = 0;
    const options = {
      onProgress: (): void => {
        throw new Error("listener boom");
      },
    };
    const handle: AssetHandle = h.app.assets.load("data/a.json", options);
    h.app.assets.load("data/a.json", {
      onProgress: (): void => {
        reached += 1;
      },
    });
    h.net.expect("assets/data/a.json").respond("{}");
    await h.settle();
    expect(handle.state).toBe("loaded");
    expect(reached).toBeGreaterThan(0);
    expect(h.errors.some((report) => report.source === "asset")).toBe(true);
    h.dispose();
  });

  it("treats releasing an unheld handle as a no-op", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    handle.release();
    handle.release();
    expect(handle.refCount).toBe(0);
    expect(handle.retain()).toBe(handle);
    expect(handle.refCount).toBe(1);
    h.net.expect("assets/data/a.json").respond("{}");
    await h.settle();
    h.dispose();
  });
});

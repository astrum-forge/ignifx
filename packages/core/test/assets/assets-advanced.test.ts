import { describe, expect, it } from "vitest";
import { AppEventsImpl } from "../../src/app/events.js";
import { createAssetManifest } from "../../src/assets/manifest.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { Script } from "../../src/script/script.js";
import { createAssetHarness } from "./support/harness.js";
import type { Coroutine } from "../../src/app/types.js";
import type { AssetHandle, AssetLoadError, AssetLoader, AssetProgress } from "../../src/assets/types.js";

/**
 * Fragments, dependencies, progress, batches, hot reload, disposal, and diagnostics
 * (`docs/architecture/05-assets-and-loading.md` §2, §4–§5, §7, §9,
 * `15-devtools-and-diagnostics.md` §3).
 */

/** An atlas whose fragments name entries of the parsed object. */
const atlasLoader: AssetLoader<Record<string, number>> = {
  type: "atlas",
  extensions: [".atlas.json"],
  load: (ctx) => ctx.fetchJson<Record<string, number>>(),
  parseFragment: (fragment, value) => value[fragment] ?? null,
};

/** A loader that reads a body and then loads whatever address it names. */
const compositeLoader: AssetLoader<string> = {
  type: "composite",
  extensions: [".comp"],
  load: async (ctx) => {
    const target = (await ctx.fetchText()).trim();
    const dependency = await ctx.loadDependency<string>(target, { type: "text" });
    return `comp(${dependency.value})`;
  },
};

/** A loader that reports progress itself, for addresses whose size is unknown. */
const stagedLoader: AssetLoader<string> = {
  type: "staged",
  extensions: [".staged"],
  load: async (ctx) => {
    ctx.reportProgress(0.25);
    const body = await ctx.fetchText();
    ctx.reportProgress(0.75);
    return body;
  },
};

describe("fragments", () => {
  it("loads the base address once and hands the fragment to parseFragment", async () => {
    const h = await createAssetHarness({ loaders: [atlasLoader] });
    const button = h.app.assets.load<number>("ui.atlas.json#button");
    const panel = h.app.assets.load<number>("ui.atlas.json#panel");
    expect(h.net.requests).toHaveLength(1);
    h.net.expect("assets/ui.atlas.json").respond('{"button":7,"panel":9}');
    await h.settle();
    await h.settle();
    expect(button.value).toBe(7);
    expect(panel.value).toBe(9);
    expect(button.address).toBe("ui.atlas.json#button");
    h.dispose();
  });

  it("retains the base address and releases it when the last fragment is collected", async () => {
    const h = await createAssetHarness({ loaders: [atlasLoader], settings: { assets: { gcDelay: 0 } } });
    const button = h.app.assets.load<number>("ui.atlas.json#button");
    h.net.expect("assets/ui.atlas.json").respond('{"button":7}');
    await h.settle();
    await h.settle();
    const base = h.app.assets.get("ui.atlas.json");
    expect(base?.refCount).toBe(1);
    button.release();
    h.step();
    expect(button.state).toBe("released");
    expect(base?.refCount).toBe(0);
    h.dispose();
  });

  it("hands the fragment to the loader itself when it declares no parseFragment", async () => {
    const fragmentAware: AssetLoader<string> = {
      type: "raw",
      extensions: [".raw"],
      load: async (ctx) => `${await ctx.fetchText()}/${String(ctx.fragment)}`,
    };
    const h = await createAssetHarness({ loaders: [fragmentAware] });
    const handle = h.app.assets.load<string>("a.raw#part");
    h.net.expect("assets/a.raw").respond("body");
    await h.settle();
    expect(handle.value).toBe("body/part");
    h.dispose();
  });
});

describe("dependencies", () => {
  it("counts a dependency's progress into the parent and releases it with the parent", async () => {
    const h = await createAssetHarness({ loaders: [compositeLoader], settings: { assets: { gcDelay: 0 } } });
    const handle = h.app.assets.load<string>("a.comp");
    h.net.expect("assets/a.comp").respond("data/b.txt");
    await h.flush();
    h.net.expect("assets/data/b.txt").respond("inner");
    await h.settle();
    await h.settle();
    expect(handle.value).toBe("comp(inner)");
    const dependency = h.app.assets.get("data/b.txt");
    expect(dependency?.refCount).toBe(1);
    handle.release();
    h.step();
    expect(handle.state).toBe("released");
    expect(dependency?.refCount).toBe(0);
    h.dispose();
  });

  it("fails the parent when the dependency fails", async () => {
    const h = await createAssetHarness({ loaders: [compositeLoader], settings: { assets: { retries: 0 } } });
    const handle = h.app.assets.load<string>("a.comp");
    h.net.expect("assets/a.comp").respond("data/b.txt");
    await h.flush();
    h.net.expect("assets/data/b.txt").fail();
    await h.settle();
    await h.settle();
    expect(handle.state).toBe("failed");
    h.dispose();
  });
});

describe("progress", () => {
  it("is bytes-weighted when the manifest knows the size", async () => {
    const manifest = createAssetManifest([{ address: "data/a.bin", url: "u/a.bin", bytes: 10 }]);
    const h = await createAssetHarness({ manifest });
    const handle = h.app.assets.load<ArrayBuffer>("data/a.bin");
    expect(handle.progress).toBe(0);
    const stream = h.net.expect("u/a.bin").respondStream();
    await h.flush();
    stream.push(new Uint8Array(5));
    await h.flush();
    expect(handle.progress).toBeCloseTo(0.5, 6);
    stream.push(new Uint8Array(5));
    stream.close();
    await h.settle();
    expect(handle.progress).toBe(1);
    expect(handle.value.byteLength).toBe(10);
    h.dispose();
  });

  it("falls back to whatever the loader reports when no size is known", async () => {
    const h = await createAssetHarness({ loaders: [stagedLoader] });
    const handle = h.app.assets.load<string>("a.staged");
    expect(handle.progress).toBeCloseTo(0.25, 6);
    h.net.expect("assets/a.staged").respond("done");
    await h.settle();
    expect(handle.progress).toBe(1);
    h.dispose();
  });

  it("delivers the per-request onProgress callback in PreUpdate", async () => {
    const h = await createAssetHarness({ loaders: [stagedLoader] });
    const seen: number[] = [];
    h.app.assets.load<string>("a.staged", {
      onProgress: (fraction) => {
        seen.push(fraction);
      },
    });
    expect(seen).toHaveLength(0);
    h.step();
    expect(seen).toEqual([0.25]);
    h.net.expect("assets/a.staged").respond("done");
    await h.settle();
    expect(seen.at(-1)).toBe(1);
    h.dispose();
  });

  it("emits an aggregate for the run in flight", async () => {
    const manifest = createAssetManifest([
      { address: "data/a.bin", url: "u/a.bin", bytes: 4 },
      { address: "data/b.bin", url: "u/b.bin", bytes: 6 },
    ]);
    const h = await createAssetHarness({ manifest });
    const samples: AssetProgress[] = [];
    h.app.assets.onProgress.connect((sample) => {
      samples.push(sample);
    });
    h.app.assets.load("data/a.bin");
    h.app.assets.load("data/b.bin");
    h.step();
    expect(samples[0]).toEqual({ loaded: 0, total: 2, bytesLoaded: 0, bytesTotal: 10 });
    h.net.expect("u/a.bin").respond(new Uint8Array(4));
    h.net.expect("u/b.bin").respond(new Uint8Array(6));
    await h.settle();
    const last = samples.at(-1);
    expect(last).toEqual({ loaded: 2, total: 2, bytesLoaded: 10, bytesTotal: 10 });
    h.dispose();
  });
});

describe("batches", () => {
  it("tracks its members' progress and settles when they all have", async () => {
    const h = await createAssetHarness();
    const batch = h.app.assets.loadAll(["data/a.json", "data/b.json"]);
    expect(batch.handles).toHaveLength(2);
    expect(batch.progress).toBe(0);
    h.net.expect("assets/data/a.json").respond("{}");
    h.net.expect("assets/data/b.json").respond("{}");
    await h.settle();
    expect(batch.progress).toBe(1);
    await expect(batch.promise).resolves.toBeUndefined();
    batch.release();
    expect(batch.handles[0]?.refCount).toBe(0);
    batch.release();
    expect(batch.handles[0]?.refCount).toBe(0);
    h.dispose();
  });

  it("cancels every member, releasing each exactly once", async () => {
    const h = await createAssetHarness();
    const batch = h.app.assets.loadAll(["data/a.json", "data/b.json"]);
    batch.cancel();
    await h.settle();
    expect(batch.handles[0]?.state).toBe("failed");
    expect(batch.handles[0]?.error?.code).toBe(CoreErrorCode.assetLoadAborted);
    expect(batch.handles[1]?.refCount).toBe(0);
    h.dispose();
  });

  it("forwards an outer signal to its members", async () => {
    const h = await createAssetHarness();
    const controller = new AbortController();
    const batch = h.app.assets.loadAll(["data/a.json"], { signal: controller.signal });
    controller.abort();
    await h.settle();
    expect(batch.handles[0]?.state).toBe("failed");
    h.dispose();
  });

  it("reports an empty batch as finished", async () => {
    const h = await createAssetHarness();
    const batch = h.app.assets.loadAll([]);
    expect(batch.progress).toBe(1);
    await expect(batch.promise).resolves.toBeUndefined();
    h.dispose();
  });

  it("loads every manifest entry carrying a group label", async () => {
    const manifest = createAssetManifest([
      { address: "data/a.json", url: "u/a", groups: ["boot"] },
      { address: "data/b.json", url: "u/b", groups: ["boot", "level1"] },
      { address: "data/c.json", url: "u/c", groups: ["level1"] },
    ]);
    const h = await createAssetHarness({ manifest });
    const batch = h.app.assets.preloadGroup("boot");
    expect(batch.handles).toHaveLength(2);
    expect(h.net.urls).toEqual(["u/a", "u/b"]);
    h.net.respondAll("{}");
    await h.settle();
    expect(batch.progress).toBe(1);
    h.dispose();
  });

  it("returns an empty batch for a group the manifest does not know", async () => {
    const h = await createAssetHarness();
    expect(h.app.assets.preloadGroup("nope").handles).toHaveLength(0);
    h.dispose();
  });
});

describe("hot reload", () => {
  it("swaps the value in place at delivery and fires onReplaced", async () => {
    const unloaded: string[] = [];
    const loader: AssetLoader<string> = {
      type: "count",
      extensions: [".count"],
      load: (ctx) => ctx.fetchText(),
      unload: (value) => {
        unloaded.push(value);
      },
    };
    const h = await createAssetHarness({ loaders: [loader] });
    const handle = h.app.assets.load<string>("a.count");
    h.net.expect("assets/a.count").respond("v1");
    await h.settle();
    const replaced: string[] = [];
    handle.onReplaced.connect((value) => {
      replaced.push(value);
    });
    h.assets.reload("a.count");
    h.net.expect("assets/a.count").respond("v2");
    await h.flush();
    expect(handle.value).toBe("v1");
    h.step();
    expect(handle.value).toBe("v2");
    expect(replaced).toEqual(["v2"]);
    expect(unloaded).toEqual(["v1"]);
    h.dispose();
  });

  it("leaves the old value in place when the reload fails", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load<{ readonly v: number }>("data/a.json");
    h.net.expect("assets/data/a.json").respond('{"v":1}');
    await h.settle();
    h.assets.reload("data/a.json");
    h.net.expect("assets/data/a.json").fail();
    await h.settle();
    expect(handle.value).toEqual({ v: 1 });
    expect(h.errors.some((report) => report.source === "asset")).toBe(true);
    h.dispose();
  });

  it("ignores an address nothing has loaded", async () => {
    const h = await createAssetHarness();
    h.assets.reload("data/never.json");
    expect(h.net.requests).toHaveLength(0);
    h.dispose();
  });
});

describe("disposal", () => {
  it("rejects the loads still in flight with IGX-0503", async () => {
    const h = await createAssetHarness();
    const handle = h.app.assets.load("data/a.json");
    const rejection = handle.promise.catch((error: unknown) => error);
    h.app.dispose();
    const error = (await rejection) as AssetLoadError;
    expect(error.code).toBe(CoreErrorCode.assetAppDisposed);
    expect(handle.state).toBe("released");
  });

  it("unloads the values it already holds", async () => {
    const unloaded: string[] = [];
    const loader: AssetLoader<string> = {
      type: "count",
      extensions: [".count"],
      load: (ctx) => ctx.fetchText(),
      unload: (value) => {
        unloaded.push(value);
      },
    };
    const h = await createAssetHarness({ loaders: [loader] });
    h.app.assets.load("a.count");
    h.net.expect("assets/a.count").respond("v1");
    await h.settle();
    h.app.dispose();
    expect(unloaded).toEqual(["v1"]);
  });

  it("refuses a load after the app is gone", async () => {
    const h = await createAssetHarness();
    const assets = h.app.assets;
    h.app.dispose();
    expect(() => assets.load("data/a.json")).toThrow(/IGX-0106/u);
  });
});

describe("diagnostics", () => {
  it("publishes the assets counter group at delivery", async () => {
    const h = await createAssetHarness({ settings: { assets: { concurrency: 1, gcDelay: 0, retries: 0 } } });
    const group = h.app.diagnostics.group("assets");
    expect(group).not.toBe(null);
    const loaded = group?.index("loaded") ?? 0;
    const queued = group?.index("queued") ?? 0;
    const failed = group?.index("failed") ?? 0;
    const candidates = group?.index("zeroRefCandidates") ?? 0;
    const handle = h.app.assets.load("data/a.json");
    h.app.assets.load("data/b.json");
    h.step();
    expect(group?.get(queued)).toBe(1);
    h.net.expect("assets/data/a.json").respond("{}");
    await h.flush();
    h.net.expect("assets/data/b.json").fail();
    await h.settle();
    await h.settle();
    await h.settle();
    expect(group?.get(loaded)).toBe(1);
    expect(group?.get(failed)).toBe(1);
    handle.release();
    h.step();
    expect(group?.get(candidates)).toBeGreaterThanOrEqual(0);
    h.dispose();
  });
});

describe("coroutine bridging", () => {
  it("resumes on the first Update after the asset was delivered", async () => {
    const h = await createAssetHarness();
    const entity = h.app.world.createEntity("waiter");
    const script = entity.addComponent(AssetWaiter);
    script.asset = h.app.assets.load<string>("data/a.txt");
    h.net.expect("assets/data/a.txt").respond("hi");
    await h.flush();
    h.step();
    expect(script.log).toEqual([]);
    await h.flush();
    h.step();
    expect(script.log).toEqual(["hi"]);
    h.dispose();
  });
});

describe("app.events", () => {
  it("hangs the five engine-wide signals off the app", async () => {
    const h = await createAssetHarness();
    expect(h.app.events.onSceneLoaded.connectionCount).toBe(0);
    expect(h.app.events.onSceneUnloaded.connectionCount).toBe(0);
    expect(h.app.events.onDeviceLost.connectionCount).toBe(0);
    expect(h.app.events.onDeviceRecovered.connectionCount).toBe(0);
    expect(h.app.events.onDeviceRecoveryFailed.connectionCount).toBe(0);
    h.dispose();
  });

  it("fans the device callbacks out through the internal emitters", () => {
    const handlerErrors: unknown[] = [];
    const events = new AppEventsImpl((error) => {
      handlerErrors.push(error);
    });
    const lost: string[] = [];
    events.onDeviceLost.connect((info) => {
      lost.push(info.message);
    });
    let recovered = 0;
    events.onDeviceRecovered.connect(() => {
      recovered += 1;
    });
    let failure: unknown = null;
    events.onDeviceRecoveryFailed.connect((reason) => {
      failure = reason;
    });
    events.emitDeviceLost({ reason: "destroyed", message: "device lost" });
    events.emitDeviceRecovered();
    events.emitDeviceRecoveryFailed("nope");
    expect(lost).toEqual(["device lost"]);
    expect(recovered).toBe(1);
    expect(failure).toBe("nope");
    events.clear();
    expect(events.onDeviceLost.connectionCount).toBe(0);
  });

  it("routes a throwing handler to the reporter instead of stopping delivery", () => {
    const handlerErrors: unknown[] = [];
    const events = new AppEventsImpl((error) => {
      handlerErrors.push(error);
    });
    events.onDeviceRecovered.connect(() => {
      throw new Error("handler boom");
    });
    let reached = 0;
    events.onDeviceRecovered.connect(() => {
      reached += 1;
    });
    events.emitDeviceRecovered();
    expect(handlerErrors).toHaveLength(1);
    expect(reached).toBe(1);
  });
});

/** A script that waits on an asset handle from a coroutine. */
class AssetWaiter extends Script {
  static typeId = "test/AssetWaiter";

  /** The asset to wait on; the test assigns it before the first frame. */
  asset: AssetHandle<string> | null = null;

  /** What the coroutine recorded. */
  readonly log: string[] = [];

  start(): void {
    const asset = this.asset;
    if (asset !== null) {
      this.startCoroutine(this.wait(asset));
    }
  }

  // Plain comment rather than a doc block: `jsdoc/require-yields` would demand a tag TSDoc has not.
  *wait(handle: AssetHandle<string>): Coroutine {
    const value = yield handle.promise;
    this.log.push(String(value));
  }
}

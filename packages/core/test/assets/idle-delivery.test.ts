import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetLoadError } from "../../src/assets/types.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { createAssetHarness } from "./support/harness.js";

/**
 * Delivery while the app is not running (`docs/architecture/05-assets-and-loading.md` §4): before
 * `app.start()` and after `app.stop()` there is no frame to wait for, so a completed load settles as
 * soon as it finishes. Once the loop runs, `assets.test.ts` ("delivery") pins the `PreUpdate` rule.
 */

const A_URL = "assets/data/a.json";

afterEach(() => {
  vi.useRealTimers();
});

describe("asset delivery before app.start()", () => {
  it("settles a completed load without a frame, so preloads can be awaited before start", async () => {
    const h = await createAssetHarness({ start: false });
    const handle = h.app.assets.load<{ readonly x: number }>("data/a.json");
    expect(handle.state).toBe("loading");
    h.net.expect(A_URL).respond('{"x":1}');
    await handle.promise;
    expect(handle.state).toBe("loaded");
    expect(handle.value).toEqual({ x: 1 });
    expect(h.app.isRunning).toBe(false);
    h.dispose();
  });

  it("resolves loadAsync the same way — the recipe's load-then-start shape", async () => {
    const h = await createAssetHarness({ start: false });
    const pending = h.app.assets.loadAsync<{ readonly x: number }>("data/a.json");
    await h.flush();
    h.net.expect(A_URL).respond('{"x":2}');
    const handle = await pending;
    expect(handle.value).toEqual({ x: 2 });
    await h.app.start();
    expect(handle.state).toBe("loaded");
    h.dispose();
  });

  it("reports a failure without a frame when no retries remain", async () => {
    const h = await createAssetHarness({ start: false, settings: { assets: { retries: 0 } } });
    const handle = h.app.assets.load("data/a.json");
    h.net.expect(A_URL).fail(new Error("offline"));
    await expect(handle.promise).rejects.toBeInstanceOf(AssetLoadError);
    expect(handle.state).toBe("failed");
    expect((handle.error as AssetLoadError).code).toBe(CoreErrorCode.assetLoadFailed);
    h.dispose();
  });

  it("runs the retry backoff on the wall clock, since no frame advances it", async () => {
    const h = await createAssetHarness({ start: false, settings: { assets: { retries: 1 } } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = h.app.assets.load<{ readonly x: number }>("data/a.json");
    h.net.expect(A_URL).fail(new Error("offline"));
    await h.flush();
    expect(handle.state).toBe("loading");
    expect(h.net.requests).toHaveLength(1);
    // The first backoff is 0.1 s of wall-clock time before the loop runs.
    await vi.advanceTimersByTimeAsync(99);
    expect(h.net.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.net.requests).toHaveLength(2);
    h.net.expect(A_URL).respond('{"x":3}');
    await handle.promise;
    expect(handle.value).toEqual({ x: 3 });
    h.dispose();
  });

  it("does not retry twice when the loop starts during the backoff", async () => {
    const h = await createAssetHarness({ start: false, settings: { assets: { retries: 1 } } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = h.app.assets.load<{ readonly x: number }>("data/a.json");
    h.net.expect(A_URL).fail(new Error("offline"));
    await h.flush();
    // The loop starts and a frame runs the backoff down first; the wall-clock timer must stand down.
    await h.app.start();
    h.step(0.1);
    await h.flush();
    expect(h.net.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.net.requests).toHaveLength(2);
    h.net.expect(A_URL).respond('{"x":4}');
    await h.settle();
    expect(handle.value).toEqual({ x: 4 });
    h.dispose();
  });

  it("stands down the wall-clock retry when the load is aborted", async () => {
    const controller = new AbortController();
    const h = await createAssetHarness({ start: false, settings: { assets: { retries: 1 } } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = h.app.assets.load("data/a.json", { signal: controller.signal });
    h.net.expect(A_URL).fail(new Error("offline"));
    await h.flush();
    controller.abort();
    await expect(handle.promise).rejects.toMatchObject({ code: CoreErrorCode.assetLoadAborted });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.net.requests).toHaveLength(1);
    h.dispose();
  });
});

describe("asset delivery after app.stop()", () => {
  it("is immediate again once the loop has stopped", async () => {
    const h = await createAssetHarness();
    h.app.stop();
    const handle = h.app.assets.load<{ readonly x: number }>("data/a.json");
    h.net.expect(A_URL).respond('{"x":5}');
    await handle.promise;
    expect(handle.value).toEqual({ x: 5 });
    h.dispose();
  });
});

describe("an abort during a retry backoff", () => {
  it("cancels the retry in a running app too, instead of fetching again", async () => {
    const controller = new AbortController();
    const h = await createAssetHarness({ settings: { assets: { retries: 1 } } });
    const handle = h.app.assets.load("data/a.json", { signal: controller.signal });
    h.net.expect(A_URL).fail(new Error("offline"));
    await h.flush();
    expect(handle.state).toBe("loading");
    controller.abort();
    h.step(1);
    await expect(handle.promise).rejects.toMatchObject({ code: CoreErrorCode.assetLoadAborted });
    expect(h.net.requests).toHaveLength(1);
    h.dispose();
  });
});

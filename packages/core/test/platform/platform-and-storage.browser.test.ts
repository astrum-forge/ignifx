import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app/app.js";
import { detectPlatform, readPlatformHost } from "../../src/platform/platform.js";
import { probeWebGpuInfo } from "../../src/platform/web/adapter-probe.js";
import { storageInternals } from "../../src/storage/storage.js";
import { IndexedDbStorageBackend } from "../../src/storage/web/indexeddb-backend.js";
import type { App } from "../../src/app/types.js";
import type { StoredValue } from "../../src/storage/backend.js";

/**
 * The browser halves of Phase 9: the host scrape reading a real browser
 * (`docs/architecture/14-platform-electron.md` §1), the WebGPU adapter probe, and the IndexedDB
 * backend (§2). Neither `navigator.gpu` nor `indexedDB` exists under Node, which is why
 * `src/platform/web/**` and `src/storage/web/**` are excluded from the unit run's coverage and
 * covered here instead.
 */

/** A namespace no other test in this file writes to. */
function namespace(name: string): string {
  return `test-${name}-${String(Math.random()).slice(2)}`;
}

/** Every app the suite created, disposed afterwards. */
let apps: App[] = [];

/** A canvas the WebGPU engine can bind to. */
function canvas(): HTMLCanvasElement {
  const surface = document.createElement("canvas");
  surface.width = 32;
  surface.height = 32;
  document.body.append(surface);
  return surface;
}

afterEach(() => {
  for (const app of apps) {
    app.dispose();
  }
  apps = [];
});

describe("the host scrape in a real browser", () => {
  it("sees a document, pointer lock, gamepads, and a locale", () => {
    const host = readPlatformHost();
    expect(host.hasDocument).toBe(true);
    expect(host.hasPointerLock).toBe(true);
    expect(host.hasGamepads).toBe(true);
    expect(host.locale).toMatch(/^[a-z]{2}/u);
    expect(host.userAgent).toContain("Mozilla");
  });

  it("detects a browser", () => {
    const platform = detectPlatform();
    expect(platform.kind).toBe("browser");
    expect(platform.hasPointerLock).toBe(true);
    expect(platform.hasGamepads).toBe(true);
    // Chromium runs the suite on a desktop, whatever the host operating system is.
    expect(platform.isMobile).toBe(false);
    expect(platform.os).not.toBe("unknown");
  });
});

describe("the WebGPU adapter probe", () => {
  it("reports the adapter's features and limits as plain data", async () => {
    const webgpu = await probeWebGpuInfo();
    expect(webgpu).not.toBeNull();
    expect(Array.isArray(webgpu?.features)).toBe(true);
    expect(webgpu?.features).toEqual((webgpu?.features ?? []).toSorted());
    expect(typeof webgpu?.limits["maxTextureDimension2D"]).toBe("number");
    expect(typeof webgpu?.adapterInfo.vendor).toBe("string");
    // Plain data: the whole record survives a round trip into a bug report.
    expect(() => JSON.stringify(webgpu)).not.toThrow();
  });
});

describe("createApp in a browser", () => {
  it("populates platform.webgpu when it has a canvas, and defaults to IndexedDB", async () => {
    const app = await createApp({ canvas: canvas() });
    apps.push(app);
    expect(app.platform.kind).toBe("browser");
    expect(app.platform.webgpu).not.toBeNull();
    expect(app.platform.webgpu?.features.length).toBeGreaterThanOrEqual(0);
    expect(storageInternals(app.storage).backend.name).toBe("indexeddb");
  });

  it("leaves platform.webgpu null in a headless app, even in a browser", async () => {
    const app = await createApp({ headless: true });
    apps.push(app);
    expect(app.platform.webgpu).toBeNull();
  });
});

describe("the IndexedDB backend", () => {
  it("round-trips JSON and bytes", async () => {
    const backend = new IndexedDbStorageBackend();
    const scope = namespace("round-trip");
    const bytes: StoredValue = { kind: "bytes", bytes: Uint8Array.from([1, 2, 255]) };
    await backend.set(scope, "slot1", { kind: "json", json: '{"level":3}' });
    await backend.set(scope, "shot", bytes);
    expect(await backend.get(scope, "slot1")).toEqual({ kind: "json", json: '{"level":3}' });
    expect(await backend.get(scope, "shot")).toEqual(bytes);
    expect(await backend.get(scope, "missing")).toBeNull();
    backend.dispose();
  });

  it("lists sorted, filters by prefix, and keeps namespaces apart", async () => {
    const backend = new IndexedDbStorageBackend();
    const scope = namespace("keys");
    await Promise.all(
      ["b", "a", "auto/2", "auto/1", "C"].map(async (key: string) =>
        backend.set(scope, key, { kind: "json", json: "0" }),
      ),
    );
    await backend.set(`${scope}/nested`, "only", { kind: "json", json: "0" });
    expect(await backend.keys(scope)).toEqual(["C", "a", "auto/1", "auto/2", "b"]);
    expect(await backend.keys(scope, "auto/")).toEqual(["auto/1", "auto/2"]);
    expect(await backend.keys(`${scope}/nested`)).toEqual(["only"]);
    expect(await backend.keys(namespace("never"))).toEqual([]);
    backend.dispose();
  });

  it("replaces, deletes, and clears one namespace only", async () => {
    const backend = new IndexedDbStorageBackend();
    const scope = namespace("mutate");
    const other = namespace("other");
    await backend.set(scope, "slot1", { kind: "json", json: "1" });
    await backend.set(scope, "slot1", { kind: "bytes", bytes: Uint8Array.from([7]) });
    expect(await backend.get(scope, "slot1")).toEqual({ kind: "bytes", bytes: Uint8Array.from([7]) });
    await backend.set(scope, "slot2", { kind: "json", json: "2" });
    await backend.set(other, "slot1", { kind: "json", json: "3" });
    await backend.delete(scope, "slot2");
    await backend.delete(scope, "slot2");
    expect(await backend.keys(scope)).toEqual(["slot1"]);
    await backend.clear(scope);
    expect(await backend.keys(scope)).toEqual([]);
    expect(await backend.keys(other)).toEqual(["slot1"]);
    backend.dispose();
  });

  it("survives keys with separators and traversal in them", async () => {
    const backend = new IndexedDbStorageBackend();
    const scope = namespace("hostile");
    const keys = ["..", "a/b", "Slot1", "slot1", "日本語"];
    await Promise.all(
      keys.map(async (key: string) => backend.set(scope, key, { kind: "json", json: JSON.stringify(key) })),
    );
    const read = await Promise.all(keys.map(async (key: string) => backend.get(scope, key)));
    expect(read).toEqual(keys.map((key: string) => ({ kind: "json", json: JSON.stringify(key) })));
    backend.dispose();
  });

  it("persists across two apps in one page", async () => {
    const scope = namespace("persistence");
    const first = await createApp({ headless: true, storage: new IndexedDbStorageBackend() });
    await first.storage.namespace(scope).set("slot1", { level: 3 });
    first.dispose();

    const second = await createApp({ headless: true, storage: new IndexedDbStorageBackend() });
    apps.push(second);
    expect(await second.storage.namespace(scope).get("slot1")).toEqual({ level: 3 });
    expect(await second.storage.namespace(scope).keys()).toEqual(["slot1"]);
    await second.storage.namespace(scope).delete("slot1");
  });

  it("reopens after it has been disposed", async () => {
    const backend = new IndexedDbStorageBackend();
    const scope = namespace("reopen");
    await backend.set(scope, "slot1", { kind: "json", json: "1" });
    backend.dispose();
    expect(await backend.get(scope, "slot1")).toEqual({ kind: "json", json: "1" });
    backend.dispose();
  });
});

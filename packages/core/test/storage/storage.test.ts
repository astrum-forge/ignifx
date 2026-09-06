import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app/app.js";
import { MemoryStorageBackend } from "../../src/storage/memory-backend.js";
import { StorageImpl, storageInternals } from "../../src/storage/storage.js";
import type { Storage } from "../../src/storage/storage.js";

/**
 * The `Storage` facade of `docs/architecture/14-platform-electron.md` §2: namespaces, the value
 * codec, the error codes, and how `createApp` chooses a backend.
 */

/** A store over a fresh in-memory backend. */
function store(): Storage {
  return new StorageImpl(new MemoryStorageBackend());
}

/** The root the directory-option test writes under. */
let root = "";

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "ignifx-storage-app-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("values", () => {
  it("round-trips the JSON kinds", async () => {
    const storage = store();
    await storage.set("object", { level: 3, name: "hero", tags: ["a"], nested: { on: true } });
    await storage.set("array", [1, 2, 3]);
    await storage.set("string", "plain");
    await storage.set("number", 7);
    await storage.set("boolean", false);
    await storage.set("null", null);
    expect(await storage.get("object")).toEqual({ level: 3, name: "hero", tags: ["a"], nested: { on: true } });
    expect(await storage.get("array")).toEqual([1, 2, 3]);
    expect(await storage.get("string")).toBe("plain");
    expect(await storage.get("number")).toBe(7);
    expect(await storage.get("boolean")).toBe(false);
    expect(await storage.get("null")).toBeNull();
  });

  it("answers null for a key that was never written", async () => {
    expect(await store().get("nothing")).toBeNull();
  });

  it("canonicalizes numbers the way scene files do, so two saves are identical", async () => {
    const storage = store();
    await storage.set("drift", { x: 0.1 + 0.2, y: -0, z: 1 / 3 });
    expect(await storage.get("drift")).toEqual({ x: 0.3, y: 0, z: 0.333_333 });
  });

  it("stores a Uint8Array, an ArrayBuffer, a view, and a Blob as bytes", async () => {
    const storage = store();
    const source = Uint8Array.from([1, 2, 3, 4]);
    await storage.set("typed", source);
    await storage.set("buffer", source.buffer);
    await storage.set("window", new Uint8Array(source.buffer, 1, 2));
    await storage.set("blob", new Blob([source]));
    expect(await storage.get("typed")).toEqual(source);
    expect(await storage.get("buffer")).toEqual(source);
    // A view contributes only the window it describes, not the whole buffer behind it.
    expect(await storage.get("window")).toEqual(Uint8Array.from([2, 3]));
    expect(await storage.get("blob")).toEqual(source);
  });

  it("reads every binary kind back as a Uint8Array", async () => {
    const storage = store();
    await storage.set("blob", new Blob(["hi"]));
    const read = await storage.get<Uint8Array>("blob");
    expect(read).toBeInstanceOf(Uint8Array);
    expect(read).not.toBeInstanceOf(Blob);
  });

  it("refuses a value with no JSON form with IGX-1423", async () => {
    const storage = store();
    await expect(storage.set("undefined", undefined)).rejects.toThrow(/IGX-1423/u);
    await expect(storage.set("function", (): void => undefined)).rejects.toThrow(/IGX-1423/u);
    await expect(storage.set("bigint", 1n)).rejects.toThrow(/IGX-1423/u);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    await expect(storage.set("cycle", cycle)).rejects.toThrow(/IGX-1423/u);
  });

  it("reports an unreadable stored value as IGX-1426", async () => {
    const backend = new MemoryStorageBackend();
    const storage = new StorageImpl(backend);
    await backend.set("default", "damaged", { kind: "json", json: "{ not json" });
    await expect(storage.get("damaged")).rejects.toThrow(/IGX-1426/u);
  });
});

describe("keys and deletion", () => {
  it("lists sorted, filters by prefix, and forgets what it deletes", async () => {
    const storage = store();
    await storage.set("b", 1);
    await storage.set("a", 1);
    await storage.set("auto/2", 1);
    await storage.set("auto/1", 1);
    expect(await storage.keys()).toEqual(["a", "auto/1", "auto/2", "b"]);
    expect(await storage.keys("auto/")).toEqual(["auto/1", "auto/2"]);
    await storage.delete("a");
    await storage.delete("a");
    expect(await storage.keys()).toEqual(["auto/1", "auto/2", "b"]);
  });

  it("refuses an invalid key with IGX-1422 on every call that takes one", async () => {
    const storage = store();
    await expect(storage.get("")).rejects.toThrow(/IGX-1422/u);
    await expect(storage.set("", 1)).rejects.toThrow(/IGX-1422/u);
    await expect(storage.delete("")).rejects.toThrow(/IGX-1422/u);
  });
});

describe("namespaces", () => {
  it("isolates a child from its parent and from its siblings", async () => {
    const storage = store();
    const saves = storage.namespace("saves");
    const settings = storage.namespace("settings");
    await storage.set("slot1", "root");
    await saves.set("slot1", "saves");
    await settings.set("slot1", "settings");
    expect(await storage.get("slot1")).toBe("root");
    expect(await saves.get("slot1")).toBe("saves");
    expect(await settings.get("slot1")).toBe("settings");
    expect(await storage.keys()).toEqual(["slot1"]);
    expect(await saves.keys()).toEqual(["slot1"]);
  });

  it("nests, and a nested namespace is not listed by its parent", async () => {
    const storage = store();
    const coop = storage.namespace("saves").namespace("coop");
    await storage.namespace("saves").set("solo", 1);
    await coop.set("host", 1);
    expect(await storage.namespace("saves").keys()).toEqual(["solo"]);
    expect(await coop.keys()).toEqual(["host"]);
  });

  it("returns the same object for the same name", () => {
    const storage = store();
    expect(storage.namespace("saves")).toBe(storage.namespace("saves"));
    expect(storage.namespace("saves")).not.toBe(storage.namespace("settings"));
  });

  it("refuses a name that is not a legal segment with IGX-1421", () => {
    const storage = store();
    expect(() => storage.namespace("../etc")).toThrow(/IGX-1421/u);
    expect(() => storage.namespace("")).toThrow(/IGX-1421/u);
  });

  it("is reachable as the namespace 'default'", async () => {
    const storage = store();
    await storage.set("slot1", "root");
    expect(await storage.namespace("default").get("slot1")).toBeNull();
    expect(storageInternals(storage).namespacePath).toBe("default");
    expect(storageInternals(storage.namespace("saves")).namespacePath).toBe("default/saves");
  });
});

describe("the internals accessor", () => {
  it("swaps the backend under a store a script already holds", async () => {
    const storage = store();
    const saves = storage.namespace("saves");
    await saves.set("slot1", "old");
    const replacement = new MemoryStorageBackend();
    await replacement.set("default/saves", "slot1", { kind: "json", json: '"new"' });
    storageInternals(storage).setBackend(replacement);
    expect(await saves.get("slot1")).toBe("new");
    expect(storageInternals(storage).backend).toBe(replacement);
  });

  it("refuses a store it did not create", () => {
    const fake: Storage = {
      get: async (): Promise<null> => null,
      set: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined,
      keys: async (): Promise<readonly string[]> => [],
      namespace: (): Storage => fake,
    };
    expect(() => storageInternals(fake)).toThrow(/IGX-0702/u);
  });
});

describe("createApp", () => {
  it("gives a headless app an in-memory store", async () => {
    const app = await createApp({ headless: true });
    expect(storageInternals(app.storage).backend.name).toBe("memory");
    await app.storage.namespace("settings").set("audio", { master: 0.8 });
    expect(await app.storage.namespace("settings").get("audio")).toEqual({ master: 0.8 });
    app.dispose();
  });

  it("accepts a backend", async () => {
    const backend = new MemoryStorageBackend();
    const app = await createApp({ headless: true, storage: backend });
    expect(storageInternals(app.storage).backend).toBe(backend);
    app.dispose();
  });

  it("accepts a directory and writes files under it", async () => {
    const directory = path.join(root, "app-directory");
    const app = await createApp({ headless: true, storage: { directory } });
    expect(storageInternals(app.storage).backend.name).toBe("file");
    await app.storage.namespace("saves").set("slot1", { level: 3 });
    expect(readdirSync(path.join(directory, "default", "saves"))).toEqual(["slot1.json"]);
    app.dispose();
  });

  it("disposes the backend with the app", async () => {
    const backend = new MemoryStorageBackend();
    const app = await createApp({ headless: true, storage: backend });
    await app.storage.set("slot1", 1);
    app.dispose();
    expect(await backend.get("default", "slot1")).toBeNull();
  });

  it("leaves platform.webgpu null in a headless app", async () => {
    const app = await createApp({ headless: true });
    expect(app.platform.webgpu).toBeNull();
    expect(app.platform.kind).toBe("node");
    app.dispose();
  });
});

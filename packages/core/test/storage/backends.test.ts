import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeStorageFileName } from "../../src/storage/file-names.js";
import { MemoryStorageBackend } from "../../src/storage/memory-backend.js";
import { createFileStorageBackend, createFileSystemBackend } from "../../src/storage/node/file-backend.js";
import type { StorageBackend, StoredValue } from "../../src/storage/backend.js";
import type { FileSystemApi } from "../../src/storage/node/file-backend.js";

/**
 * The backend contract of `src/storage/backend.ts`, run against every backend Node can reach. The
 * two are meant to be interchangeable, so the shared block is the real test and the per-backend
 * blocks only cover what is genuinely specific — the file layout, atomicity, and key encoding.
 */

/** The root every file-backend test writes under. Removed in `afterAll`. */
let root = "";

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "ignifx-storage-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fresh directory for one test, so tests cannot see each other's files. */
function scratch(name: string): string {
  return path.join(root, `${name}-${String(Math.random()).slice(2)}`);
}

/** JSON payload shorthand. */
function json(text: string): StoredValue {
  return { kind: "json", json: text };
}

/** Byte payload shorthand. */
function bytes(...values: readonly number[]): StoredValue {
  return { kind: "bytes", bytes: Uint8Array.from(values) };
}

const backends: readonly (readonly [string, () => Promise<StorageBackend>])[] = [
  ["memory", async (): Promise<StorageBackend> => new MemoryStorageBackend()],
  ["file", async (): Promise<StorageBackend> => createFileStorageBackend({ directory: scratch("shared") })],
];

describe.each(backends)("the %s backend keeps the contract", (name: string, build: () => Promise<StorageBackend>) => {
  it("names itself", async () => {
    expect((await build()).name).toBe(name);
  });

  it("answers null for a key that was never written", async () => {
    const backend = await build();
    expect(await backend.get("saves", "slot1")).toBeNull();
  });

  it("round-trips JSON", async () => {
    const backend = await build();
    await backend.set("saves", "slot1", json('{"level":3}'));
    expect(await backend.get("saves", "slot1")).toEqual(json('{"level":3}'));
  });

  it("round-trips bytes, empty ones included", async () => {
    const backend = await build();
    await backend.set("saves", "shot", bytes(0, 1, 255, 128));
    await backend.set("saves", "empty", bytes());
    expect(await backend.get("saves", "shot")).toEqual(bytes(0, 1, 255, 128));
    expect((await backend.get("saves", "empty"))?.kind).toBe("bytes");
    expect(await backend.get("saves", "empty")).toEqual(bytes());
  });

  it("does not alias the caller's buffer", async () => {
    const backend = await build();
    const source = Uint8Array.from([1, 2, 3]);
    await backend.set("saves", "shot", { kind: "bytes", bytes: source });
    source[0] = 99;
    const read = await backend.get("saves", "shot");
    expect(read).toEqual(bytes(1, 2, 3));
    if (read?.kind === "bytes") {
      read.bytes[1] = 99;
    }
    expect(await backend.get("saves", "shot")).toEqual(bytes(1, 2, 3));
  });

  it("replaces a value, across kinds", async () => {
    const backend = await build();
    await backend.set("saves", "slot1", json("1"));
    await backend.set("saves", "slot1", json("2"));
    expect(await backend.get("saves", "slot1")).toEqual(json("2"));
    await backend.set("saves", "slot1", bytes(7));
    expect(await backend.get("saves", "slot1")).toEqual(bytes(7));
    expect(await backend.keys("saves")).toEqual(["slot1"]);
    await backend.set("saves", "slot1", json("3"));
    expect(await backend.get("saves", "slot1")).toEqual(json("3"));
    expect(await backend.keys("saves")).toEqual(["slot1"]);
  });

  it("deletes, and tolerates deleting what is not there", async () => {
    const backend = await build();
    await backend.set("saves", "slot1", json("1"));
    await backend.delete("saves", "slot1");
    await backend.delete("saves", "slot1");
    await backend.delete("nothing", "at-all");
    expect(await backend.get("saves", "slot1")).toBeNull();
  });

  it("lists keys sorted, filtered by prefix, and empty for an unknown namespace", async () => {
    const backend = await build();
    await Promise.all(
      ["b", "a", "auto/2", "auto/10", "auto/1", "C"].map(async (key: string) => backend.set("saves", key, json("0"))),
    );
    expect(await backend.keys("saves")).toEqual(["C", "a", "auto/1", "auto/10", "auto/2", "b"]);
    expect(await backend.keys("saves", "auto/")).toEqual(["auto/1", "auto/10", "auto/2"]);
    expect(await backend.keys("saves", "zz")).toEqual([]);
    expect(await backend.keys("never-written")).toEqual([]);
  });

  it("keeps namespaces apart, nested ones included", async () => {
    const backend = await build();
    await backend.set("saves", "slot1", json('"root"'));
    await backend.set("saves/coop", "slot1", json('"nested"'));
    await backend.set("settings", "slot1", json('"other"'));
    expect(await backend.get("saves", "slot1")).toEqual(json('"root"'));
    expect(await backend.get("saves/coop", "slot1")).toEqual(json('"nested"'));
    expect(await backend.keys("saves")).toEqual(["slot1"]);
    expect(await backend.keys("saves/coop")).toEqual(["slot1"]);
  });

  it("clears one namespace and leaves its neighbours alone", async () => {
    const backend = await build();
    await backend.set("saves", "a", json("1"));
    await backend.set("saves/coop", "a", json("1"));
    await backend.set("settings", "a", json("1"));
    await backend.clear("saves");
    await backend.clear("never-written");
    expect(await backend.keys("saves")).toEqual([]);
    expect(await backend.keys("settings")).toEqual(["a"]);
  });

  it("survives keys a file system would choke on", async () => {
    const backend = await build();
    const keys = ["..", ".", "con", "Slot1", "slot1", "a/b", "a:b|c", "日本語", "trailing."];
    await Promise.all(keys.map(async (key: string, index: number) => backend.set("saves", key, json(String(index)))));
    const read = await Promise.all(keys.map(async (key: string) => backend.get("saves", key)));
    expect(read).toEqual(keys.map((_key: string, index: number) => json(String(index))));
    expect(await backend.keys("saves")).toEqual(keys.toSorted());
  });

  it("takes concurrent writes without damaging the store", async () => {
    const backend = await build();
    await Promise.all(
      Array.from({ length: 24 }, async (_unused: unknown, index: number) =>
        backend.set("saves", `slot${String(index)}`, json(String(index))),
      ),
    );
    expect((await backend.keys("saves")).length).toBe(24);
    await Promise.all(Array.from({ length: 12 }, async () => backend.set("saves", "hot", json("1"))));
    expect(await backend.get("saves", "hot")).toEqual(json("1"));
  });
});

describe("the file backend on disk", () => {
  it("creates the directory tree on first write and names files by the encoded key", async () => {
    const directory = scratch("layout");
    const backend = await createFileStorageBackend({ directory });
    await backend.set("saves", "Slot 1", json('{"level":3}'));
    await backend.set("saves", "shot", bytes(1, 2));
    const files = readdirSync(path.join(directory, "saves")).toSorted();
    expect(files).toEqual([`${encodeStorageFileName("Slot 1")}.json`, "shot.bin"]);
    expect(readFileSync(path.join(directory, "saves", `${encodeStorageFileName("Slot 1")}.json`), "utf8")).toBe(
      '{"level":3}',
    );
  });

  it("puts a nested namespace in a nested directory", async () => {
    const directory = scratch("nested");
    const backend = await createFileStorageBackend({ directory });
    await backend.set("saves/coop", "a", json("1"));
    expect(readdirSync(path.join(directory, "saves", "coop"))).toEqual(["a.json"]);
  });

  it("leaves no temporary file behind after a write", async () => {
    const directory = scratch("atomic");
    const backend = await createFileStorageBackend({ directory });
    await backend.set("saves", "slot1", json("1"));
    expect(readdirSync(path.join(directory, "saves")).some((entry: string) => entry.endsWith(".tmp"))).toBe(false);
  });

  it("skips stray files and interrupted temporaries when it lists", async () => {
    const directory = scratch("stray");
    const backend = await createFileStorageBackend({ directory });
    await backend.set("saves", "slot1", json("1"));
    const namespace = path.join(directory, "saves");
    writeFileSync(path.join(namespace, "README"), "not ours");
    writeFileSync(path.join(namespace, "slot1.abc123.tmp"), "half written");
    writeFileSync(path.join(namespace, "%zz.json"), "not an encoding");
    expect(await backend.keys("saves")).toEqual(["slot1"]);
  });

  it("reports a directory it cannot read as IGX-1425", async () => {
    const directory = scratch("unreadable");
    const backend = await createFileStorageBackend({ directory });
    // A *file* where the namespace directory should be: `readdir` fails with ENOTDIR on the
    // namespace itself, which is the absence case, so the failure has to come from one level up.
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "saves"), "not a directory");
    await expect(backend.set("saves", "slot1", json("1"))).rejects.toThrow(/IGX-1425/u);
  });

  it("returns the JSON text verbatim, so the facade is the one that reports corruption", async () => {
    const directory = scratch("corrupt");
    const backend = await createFileStorageBackend({ directory });
    await backend.set("saves", "slot1", json("1"));
    writeFileSync(path.join(directory, "saves", "slot1.json"), "{ not json");
    expect(await backend.get("saves", "slot1")).toEqual(json("{ not json"));
  });
});

describe("the memory backend", () => {
  it("drops everything when it is disposed", async () => {
    const backend = new MemoryStorageBackend();
    await backend.set("saves", "slot1", json("1"));
    backend.dispose();
    expect(await backend.get("saves", "slot1")).toBeNull();
  });
});

/** A file-system fake whose calls all reject with the error the test hands it. */
function failingFs(error: unknown): FileSystemApi {
  const reject = async (): Promise<never> => {
    throw error;
  };
  return { mkdir: reject, readFile: reject, writeFile: reject, rename: reject, rm: reject, readdir: reject };
}

/** A Node-shaped error with an `errno` code. */
function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("the file backend's failure mapping", () => {
  it("reports a full disk as IGX-1424 on every code that means it", async () => {
    await Promise.all(
      ["ENOSPC", "EDQUOT", "EFBIG"].map(async (code: string) => {
        const backend = createFileSystemBackend(failingFs(errno(code)), "/nowhere");
        await expect(backend.set("saves", "slot1", json("1")), code).rejects.toThrow(/IGX-1424/u);
      }),
    );
  });

  it("reports everything else as IGX-1425, whatever the rejection carried", async () => {
    await Promise.all(
      [errno("EACCES"), new Error("plain"), "a string", null, { code: 7 }].map(async (error: unknown) => {
        const backend = createFileSystemBackend(failingFs(error), "/nowhere");
        await expect(backend.set("saves", "slot1", json("1"))).rejects.toThrow(/IGX-1425/u);
      }),
    );
  });

  it("maps a failure of every operation, not just writes", async () => {
    const backend = createFileSystemBackend(failingFs(errno("EACCES")), "/nowhere");
    await expect(backend.get("saves", "slot1")).rejects.toThrow(/IGX-1425/u);
    await expect(backend.delete("saves", "slot1")).rejects.toThrow(/IGX-1425/u);
    await expect(backend.keys("saves")).rejects.toThrow(/IGX-1425/u);
    await expect(backend.clear("saves")).rejects.toThrow(/IGX-1425/u);
  });

  it("treats an absent file and an absent directory as absence, not failure", async () => {
    const backend = createFileSystemBackend(failingFs(errno("ENOENT")), "/nowhere");
    expect(await backend.get("saves", "slot1")).toBeNull();
    expect(await backend.keys("saves")).toEqual([]);
    const notADirectory = createFileSystemBackend(failingFs(errno("ENOTDIR")), "/nowhere");
    expect(await notADirectory.get("saves", "slot1")).toBeNull();
    expect(await notADirectory.keys("saves")).toEqual([]);
  });

  it("cleans up its temporary file after a failed rename, and reports the write failure", async () => {
    const removed: string[] = [];
    let renames = 0;
    const fs: FileSystemApi = {
      mkdir: async (): Promise<unknown> => undefined,
      readFile: async (): Promise<Uint8Array> => new Uint8Array(0),
      writeFile: async (): Promise<void> => undefined,
      rename: async (): Promise<void> => {
        renames += 1;
        throw errno("EXDEV");
      },
      rm: async (target: string): Promise<void> => {
        removed.push(target);
      },
      readdir: async (): Promise<readonly string[]> => [],
    };
    const backend = createFileSystemBackend(fs, "/nowhere");
    await expect(backend.set("saves", "slot1", json("1"))).rejects.toThrow(/IGX-1425/u);
    expect(renames).toBe(1);
    expect(removed.every((target: string) => target.endsWith(".tmp"))).toBe(true);
  });

  it("swallows a cleanup failure rather than hiding the real one", async () => {
    const fs: FileSystemApi = {
      ...failingFs(errno("EACCES")),
      mkdir: async (): Promise<unknown> => undefined,
      writeFile: async (): Promise<void> => undefined,
    };
    const backend = createFileSystemBackend(fs, "/nowhere");
    // Both the rename and the temporary-file cleanup fail; the rename's error is the one that
    // reaches the caller.
    await expect(backend.set("saves", "slot1", json("1"))).rejects.toThrow(/IGX-1425/u);
  });
});

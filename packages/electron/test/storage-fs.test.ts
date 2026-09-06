// Must come first: it registers the `electron` module mock every import below depends on.
// oxlint-disable-next-line import/no-unassigned-import -- see above.
import "./support/electron-mock.js";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStorage } from "../src/main/storage-fs.js";
import { decodeStorageFileName, encodeStorageFileName, storageDirectoryFor } from "../src/main/storage-names.js";

/**
 * The desktop file-system store (`docs/architecture/14-platform-electron.md` §2) and the codec it
 * writes through.
 *
 * The codec's vectors are the ones `@ignifx/core`'s `src/storage/file-names.ts` documents, and they
 * are here deliberately: this package carries a **duplicate** of that codec, because core's copy is
 * `@internal` and the main process must not import `@ignifx/core` at all (its barrel reaches
 * Babylon Lite). These assertions are what keeps the two copies producing the same bytes, so a save
 * written by a desktop build is readable by core's own Node file backend and the other way round.
 */

let root = "";
let storage: FileStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ignifx-storage-"));
  storage = new FileStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the key codec, against @ignifx/core's own vectors", () => {
  it("leaves a plain lower-case key alone", () => {
    expect(encodeStorageFileName("slot1")).toBe("slot1");
    expect(encodeStorageFileName("auto-save.2")).toBe("auto-save.2");
  });

  it("escapes every separator, so a key can never navigate", () => {
    expect(encodeStorageFileName("saves/Slot 1")).toBe("saves%2f%53lot%201");
    expect(encodeStorageFileName("..")).toBe("%2e%2e");
    // A dot is *safe* mid-name — only a leading or trailing one is escaped — so the separators are
    // what stops this navigating, and they are all gone.
    expect(encodeStorageFileName("../../etc/passwd")).toBe("%2e.%2f..%2fetc%2fpasswd");
    expect(encodeStorageFileName("../../etc/passwd")).not.toContain("/");
    expect(encodeStorageFileName("a\\b")).toBe("a%5cb");
  });

  it("escapes upper case, so two keys cannot merge on APFS or NTFS", () => {
    expect(encodeStorageFileName("Slot1")).toBe("%53lot1");
    expect(encodeStorageFileName("slot1")).not.toBe(encodeStorageFileName("Slot1"));
    // Every encoded name is entirely lower case, which is what makes that impossible.
    expect(encodeStorageFileName("MiXeD")).toBe(encodeStorageFileName("MiXeD").toLowerCase());
  });

  it("escapes the Windows device names, which are reserved even with an extension", () => {
    expect(encodeStorageFileName("con")).toBe("%63on");
    expect(encodeStorageFileName("nul")).toBe("%6eul");
    expect(encodeStorageFileName("com1")).toBe("%63om1");
    expect(encodeStorageFileName("lpt9")).toBe("%6cpt9");
    // Not reserved: only the exact names are.
    expect(encodeStorageFileName("console")).toBe("console");
  });

  it("escapes a leading or trailing dot, which NTFS refuses", () => {
    expect(encodeStorageFileName(".hidden")).toBe("%2ehidden");
    expect(encodeStorageFileName("trailing.")).toBe("trailing%2e");
  });

  it("round-trips everything it encodes", () => {
    for (const key of [
      "slot1",
      "Slot1",
      "saves/Slot 1",
      "../../etc/passwd",
      "con",
      ".hidden",
      "trailing.",
      "emoji-🎮",
      "日本語のキー",
      'quotes"and|pipes?and*stars',
    ]) {
      expect(decodeStorageFileName(encodeStorageFileName(key))).toBe(key);
    }
  });

  it("refuses to decode a name it could not have produced", () => {
    expect(decodeStorageFileName("%zz")).toBeNull();
    expect(decodeStorageFileName("%2")).toBeNull();
    expect(decodeStorageFileName("UPPER")).toBeNull();
    // A truncated multi-byte sequence is not valid UTF-8.
    expect(decodeStorageFileName("%e6")).toBeNull();
  });

  it("gives every namespace segment its own encoded directory level", () => {
    expect(storageDirectoryFor("/root", "saves")).toBe("/root/saves");
    expect(storageDirectoryFor("/root", "saves/coop")).toBe("/root/saves/coop");
    expect(storageDirectoryFor("/root", "Input Overrides")).toBe("/root/%49nput%20%4fverrides");
  });
});

describe("FileStorage", () => {
  it("round-trips JSON text byte for byte", async () => {
    await storage.set("saves", "slot1", { kind: "json", json: '{"level":3,"name":"Ann"}' });

    expect(await storage.get("saves", "slot1")).toEqual({ kind: "json", json: '{"level":3,"name":"Ann"}' });
  });

  it("round-trips bytes byte for byte, including an empty array", async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    await storage.set("saves", "thumb", { kind: "bytes", bytes });

    const read = await storage.get("saves", "thumb");
    expect(read?.kind).toBe("bytes");
    expect(read?.kind === "bytes" && [...read.bytes]).toEqual([...bytes]);

    await storage.set("saves", "empty", { kind: "bytes", bytes: new Uint8Array(0) });
    const empty = await storage.get("saves", "empty");
    expect(empty?.kind === "bytes" && empty.bytes.length).toBe(0);
  });

  it("keeps JSON text and identical UTF-8 bytes distinguishable", async () => {
    // The whole reason the kind is carried in the extension: these two are the same octets.
    await storage.set("kinds", "a", { kind: "json", json: '"hi"' });
    await storage.set("kinds", "b", { kind: "bytes", bytes: new TextEncoder().encode('"hi"') });

    expect((await storage.get("kinds", "a"))?.kind).toBe("json");
    expect((await storage.get("kinds", "b"))?.kind).toBe("bytes");
  });

  it("answers null for an absent key rather than throwing", async () => {
    expect(await storage.get("saves", "nothing")).toBeNull();
    expect(await storage.get("no-such-namespace", "nothing")).toBeNull();
  });

  it("replaces a value whose kind changed, leaving no stale file behind", async () => {
    await storage.set("saves", "slot1", { kind: "json", json: "1" });
    await storage.set("saves", "slot1", { kind: "bytes", bytes: new Uint8Array([9]) });

    const read = await storage.get("saves", "slot1");
    expect(read?.kind).toBe("bytes");
    // Exactly one file, so `get`'s JSON-first lookup cannot find the old one.
    expect((await readdir(join(root, "saves"))).length).toBe(1);
  });

  it("deletes under either extension, and deleting an absent key is a no-op", async () => {
    await storage.set("saves", "slot1", { kind: "json", json: "1" });
    await storage.delete("saves", "slot1");
    await storage.delete("saves", "slot1");

    expect(await storage.get("saves", "slot1")).toBeNull();
  });

  it("lists keys sorted, filtered by prefix, and decoded back to the originals", async () => {
    await storage.set("saves", "slot2", { kind: "json", json: "2" });
    await storage.set("saves", "slot1", { kind: "json", json: "1" });
    await storage.set("saves", "auto", { kind: "json", json: "0" });
    await storage.set("saves", "Slot Upper", { kind: "json", json: "3" });

    expect(await storage.keys("saves")).toEqual(["Slot Upper", "auto", "slot1", "slot2"]);
    expect(await storage.keys("saves", "slot")).toEqual(["slot1", "slot2"]);
    expect(await storage.keys("nowhere")).toEqual([]);
  });

  it("treats a namespace as a scope, not a prefix", async () => {
    await storage.set("saves", "a", { kind: "json", json: "1" });
    await storage.set("saves/coop", "a", { kind: "json", json: "2" });

    expect(await storage.get("saves", "a")).toEqual({ kind: "json", json: "1" });
    expect(await storage.get("saves/coop", "a")).toEqual({ kind: "json", json: "2" });
    // Neither appears in the other's listing.
    expect(await storage.keys("saves")).toEqual(["a"]);
    expect(await storage.keys("saves/coop")).toEqual(["a"]);
  });

  it("clears one namespace and leaves the nested one alone", async () => {
    await storage.set("saves", "a", { kind: "json", json: "1" });
    await storage.set("saves", "b", { kind: "json", json: "2" });
    await storage.set("saves/coop", "a", { kind: "json", json: "3" });

    await storage.clear("saves");

    expect(await storage.keys("saves")).toEqual([]);
    expect(await storage.get("saves/coop", "a")).toEqual({ kind: "json", json: "3" });
    // Clearing an unknown namespace is a no-op.
    await storage.clear("never-existed");
  });

  it("skips a stray file in the namespace directory rather than failing the listing", async () => {
    await storage.set("saves", "slot1", { kind: "json", json: "1" });
    await writeFile(join(root, "saves", "README"), "notes", "utf8");
    await writeFile(join(root, "saves", "UPPER.json"), "{}", "utf8");
    await writeFile(join(root, "saves", "slot1.json.tmp-abc"), "half", "utf8");

    expect(await storage.keys("saves")).toEqual(["slot1"]);
  });

  it("survives concurrent writes to one key without damaging the store", async () => {
    await Promise.all(
      Array.from({ length: 25 }, async (_unused, index) =>
        storage.set("saves", "hot", { kind: "json", json: String(index) }),
      ),
    );

    const read = await storage.get("saves", "hot");
    expect(read?.kind).toBe("json");
    // Whichever write landed last, the value is one of the whole ones — never a splice of two.
    expect(read?.kind === "json" && Number.isInteger(Number(read.json))).toBe(true);
    // And no temporary file was left behind.
    expect((await readdir(join(root, "saves"))).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("writes the layout §2 specifies, so core's Node backend can read it", async () => {
    await storage.set("settings", "audio", { kind: "json", json: '{"volume":0.8}' });
    await storage.set("settings", "thumb", { kind: "bytes", bytes: new Uint8Array([1]) });

    expect((await readdir(join(root, "settings"))).toSorted()).toEqual(["audio.json", "thumb.bin"]);
  });
});

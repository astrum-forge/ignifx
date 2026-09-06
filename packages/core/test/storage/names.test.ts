import { describe, expect, it } from "vitest";
import { decodeStorageFileName, encodeStorageFileName } from "../../src/storage/file-names.js";
import { assertNamespaceName, assertStorageKey, joinNamespace } from "../../src/storage/names.js";

/**
 * The syntax rules and the key-to-file-name codec (`docs/architecture/14-platform-electron.md` §2).
 * Both are pure, so this suite is where the hazards the encoding exists for are pinned down: path
 * traversal, Windows device names, and case-insensitive file systems.
 */

describe("namespace names", () => {
  it("accepts the names the architecture document uses", () => {
    for (const name of ["saves", "settings", "input-overrides", "a", "v1.2_beta"]) {
      expect(() => {
        assertNamespaceName(name);
      }).not.toThrow();
    }
  });

  it.each([
    ["an empty name", ""],
    ["a separator", "saves/coop"],
    ["a navigation name", "."],
    ["the parent name", ".."],
    ["a space", "saves coop"],
    ["a non-ASCII letter", "é"],
    ["an over-long name", "x".repeat(65)],
  ])("refuses %s with IGX-1421", (_label: string, name: string) => {
    expect(() => {
      assertNamespaceName(name);
    }).toThrow(/IGX-1421/u);
  });

  it("joins with a slash and validates the child", () => {
    expect(joinNamespace("default", "saves")).toBe("default/saves");
    expect(() => joinNamespace("default", "../etc")).toThrow(/IGX-1421/u);
  });
});

describe("storage keys", () => {
  it("accepts anything printable, separators and traversal included", () => {
    for (const key of ["slot1", "saves/slot 1", "..", "a:b|c?d*e", "日本語", "x".repeat(512)]) {
      expect(() => {
        assertStorageKey(key);
      }).not.toThrow();
    }
  });

  it.each([
    ["an empty key", ""],
    ["a NUL", "a\u0000b"],
    ["a newline", "a\nb"],
    ["a C1 control character", "a\u0085b"],
    ["an over-long key", "x".repeat(513)],
  ])("refuses %s with IGX-1422", (_label: string, key: string) => {
    expect(() => {
      assertStorageKey(key);
    }).toThrow(/IGX-1422/u);
  });
});

describe("the file-name codec", () => {
  it("round-trips every key the validator accepts", () => {
    const keys = [
      "slot1",
      "Slot1",
      "SLOT1",
      "saves/slot 1",
      "..",
      ".",
      ".hidden",
      "trailing.",
      "con",
      "con.json",
      "nul",
      "com1",
      "lpt9",
      'a:b|c?d*e<f>g"h',
      "\\windows\\path",
      "日本語",
      "🎮 emoji",
      "%2f",
      "x".repeat(512),
    ];
    for (const key of keys) {
      expect(decodeStorageFileName(encodeStorageFileName(key)), key).toBe(key);
    }
  });

  it("never produces a separator, a leading dot, a trailing dot, or an upper-case character", () => {
    for (const key of ["saves/slot", "\\a", ".hidden", "trailing.", "Slot1", "..", "a:b"]) {
      const encoded = encodeStorageFileName(key);
      expect(encoded, key).not.toMatch(/[/\\:*?"<>|A-Z]/u);
      expect(encoded.startsWith("."), key).toBe(false);
      expect(encoded.endsWith("."), key).toBe(false);
    }
  });

  it("keeps keys that differ only in case apart on a case-insensitive file system", () => {
    // The whole encoded alphabet is lower case, so two encodings that differ at all differ in a way
    // a case-insensitive file system cannot erase.
    const lower = encodeStorageFileName("slot1");
    const upper = encodeStorageFileName("Slot1");
    expect(lower).not.toBe(upper);
    expect(lower.toLowerCase()).not.toBe(upper.toLowerCase());
  });

  it("escapes the Windows device names, extension and all", () => {
    for (const device of ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"]) {
      expect(encodeStorageFileName(device).startsWith("%"), device).toBe(true);
      expect(encodeStorageFileName(`${device}.save`).startsWith("%"), device).toBe(true);
    }
    expect(encodeStorageFileName("console")).toBe("console");
  });

  it("keeps a readable name readable", () => {
    expect(encodeStorageFileName("slot1")).toBe("slot1");
    expect(encodeStorageFileName("auto-save_2")).toBe("auto-save_2");
  });

  it("rejects a name the encoder could not have produced", () => {
    expect(decodeStorageFileName("README")).toBeNull();
    expect(decodeStorageFileName("a/b")).toBeNull();
    expect(decodeStorageFileName("%")).toBeNull();
    expect(decodeStorageFileName("%2")).toBeNull();
    expect(decodeStorageFileName("%zz")).toBeNull();
    expect(decodeStorageFileName("%2z")).toBeNull();
    expect(decodeStorageFileName("%ff%ff")).toBeNull();
  });
});

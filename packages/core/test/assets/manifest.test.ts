import { describe, expect, it } from "vitest";
import { assetRef, isAssetRef } from "../../src/assets/asset-ref.js";
import {
  assertSupportedManifest,
  createAssetManifest,
  EMPTY_ASSET_MANIFEST,
  ManifestIndex,
} from "../../src/assets/manifest.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import type { AssetManifest } from "../../src/assets/types.js";

describe("the empty manifest", () => {
  it("is rooted at assets and lists nothing", () => {
    expect(EMPTY_ASSET_MANIFEST.root).toBe("assets");
    expect(EMPTY_ASSET_MANIFEST.entries).toHaveLength(0);
    expect(EMPTY_ASSET_MANIFEST.format).toBe("ignifx.manifest");
  });
});

describe("createAssetManifest", () => {
  it("copies the entries so a later push cannot mutate the manifest", () => {
    const entries = [{ address: "a.json", url: "assets/a.json" }];
    const manifest = createAssetManifest(entries);
    entries.push({ address: "b.json", url: "assets/b.json" });
    expect(manifest.entries).toHaveLength(1);
  });

  it("takes the root it was given", () => {
    expect(createAssetManifest([], "content").root).toBe("content");
  });
});

describe("assertSupportedManifest", () => {
  it("accepts the version this build reads", () => {
    expect(assertSupportedManifest(EMPTY_ASSET_MANIFEST)).toBe(EMPTY_ASSET_MANIFEST);
  });

  it("rejects a future format version with IGX-0603", () => {
    // A manifest is JSON from a build tool, so the runtime check is real even though the declared
    // type pins the version.
    const future = { ...EMPTY_ASSET_MANIFEST, formatVersion: 2 } as unknown as AssetManifest;
    try {
      assertSupportedManifest(future);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.unsupportedFormatVersion);
    }
  });
});

describe("ManifestIndex", () => {
  const manifest = createAssetManifest([
    { address: "a.json", url: "assets/a.abc.json", bytes: 12, groups: ["boot", "level1"] },
    { address: "b.json", url: "assets/b.def.json", groups: ["boot"] },
    { address: "c.json", url: "assets/c.json" },
  ]);

  it("looks entries up by address", () => {
    expect(new ManifestIndex(manifest).entry("a.json")?.url).toBe("assets/a.abc.json");
  });

  it("returns null for an address it does not list", () => {
    expect(new ManifestIndex(manifest).entry("missing.json")).toBe(null);
  });

  it("lists a group's addresses in manifest order", () => {
    expect(new ManifestIndex(manifest).group("boot")).toEqual(["a.json", "b.json"]);
  });

  it("returns an empty list for an unknown group", () => {
    expect(new ManifestIndex(manifest).group("nope")).toHaveLength(0);
  });

  it("lets a later entry replace an earlier one for the same address", () => {
    const overridden = createAssetManifest([
      { address: "a.json", url: "first" },
      { address: "a.json", url: "second" },
    ]);
    expect(new ManifestIndex(overridden).entry("a.json")?.url).toBe("second");
  });
});

describe("assetRef", () => {
  it("builds a frozen reference without a type", () => {
    const ref = assetRef("models/hero.glb");
    expect(ref).toEqual({ address: "models/hero.glb" });
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it("carries the type when one is given", () => {
    expect(assetRef("data/x", "json")).toEqual({ address: "data/x", type: "json" });
  });

  it("survives a JSON round trip, which is what makes it the serializable form", () => {
    const ref = assetRef("data/x", "json");
    expect(JSON.parse(JSON.stringify(ref))).toEqual({ address: "data/x", type: "json" });
  });
});

describe("isAssetRef", () => {
  it("recognises a reference", () => {
    expect(isAssetRef(assetRef("a"))).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAssetRef("a")).toBe(false);
    expect(isAssetRef(null)).toBe(false);
    expect(isAssetRef({})).toBe(false);
    expect(isAssetRef({ address: 3 })).toBe(false);
  });
});

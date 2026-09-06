import { afterEach, describe, expect, it } from "vitest";
import { SPRITE_ATLAS_ASSET_TYPE, SPRITE_ATLAS_FILE_EXTENSIONS } from "../../src/atlas/definition.js";
import { createSpriteAtlasLoader, resolveAtlasImageUrl } from "../../src/atlas/loader.js";
import { createTwoDApp, fixtureFiles, readFixture } from "../support/app.js";
import type { SpriteAsset, SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import type { TwoDAppHarness } from "../support/app.js";

/**
 * The `spriteatlas` loader on the null engine (`docs/architecture/05-assets-and-loading.md` §5,
 * `07-rendering.md` §6). Nothing is uploaded, so `lite.atlas` stays `null` while every frame stays
 * queryable — which is what makes frame counts, pivots and `#frame:` addressing testable in Node.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Reads the deepest `IGX-` code off whatever the asset service rejected with.
 *
 * The service wraps a loader failure in an `AssetLoadError` carrying `IGX-0505` and keeps the
 * loader's own error as its `cause`, so the interesting code is the innermost one.
 */
function codeOf(error: unknown): string | undefined {
  // Assembled rather than written out, because a bare `IGX-` literal is not a valid code and the
  // `ignifx/error-code-format` rule rejects it.
  const prefix = "IGX".concat("-");
  let found: string | undefined;
  let current: unknown = error;
  while (current !== null && current !== undefined) {
    const code = (current as { readonly code?: unknown }).code;
    if (typeof code === "string" && code.startsWith(prefix)) {
      found = code;
    }
    current = (current as { readonly cause?: unknown }).cause;
  }
  return found;
}

describe("the loader descriptor", () => {
  it("owns the spriteatlas type and the .atlas.json suffix", () => {
    const loader = createSpriteAtlasLoader();
    expect(loader.type).toBe(SPRITE_ATLAS_ASSET_TYPE);
    expect(loader.extensions).toEqual(SPRITE_ATLAS_FILE_EXTENSIONS);
    expect(loader.extensions).toContain(".atlas.json");
    expect(typeof loader.parseFragment).toBe("function");
  });
});

describe("loading the fixture", () => {
  it("parses every frame and leaves nothing on the device", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    const handle = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const atlas = handle.value;
    expect(atlas.frameCount).toBe(4);
    expect(atlas.frameNames()).toEqual(["idle_0", "idle_1", "run_0", "run_1"]);
    expect(atlas.lite.atlas).toBeNull();
    expect(atlas.isReleased).toBe(true);
    expect(atlas.definition.sampling).toBe("nearest");
    expect(atlas.definition.image).toBe("hero.png");
  });

  it("resolves frames by name and refuses to guess", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    const atlas = (await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json")).value;
    expect(atlas.frameIndex("idle_0")).toBe(0);
    expect(atlas.frameIndex("run_0")).toBe(2);
    expect(atlas.frameIndex("nope")).toBe(-1);
    let captured: unknown = null;
    try {
      atlas.requireFrame("nope");
    } catch (error) {
      captured = error;
    }
    expect(codeOf(captured)).toBe("IGX-1106");
  });

  it("carries the authored pivot and defaults the rest to the centre", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    const atlas = (await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json")).value;
    expect(atlas.frame(0)?.pivot).toEqual({ x: 0.5, y: 1 });
    expect(atlas.frame(2)?.pivot).toEqual({ x: 0.5, y: 0.5 });
    expect(atlas.frame(0)?.widthPx).toBe(32);
    expect(atlas.frame(99)).toBeNull();
  });

  it("warns IGX-1102 for frames packed flush against each other", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const warned = harness.log.toArray().filter((record) => record.message.includes("IGX-1102"));
    expect(warned.length).toBeGreaterThan(0);
    expect(warned[0]?.level).toBe("warn");
  });

  it("stays quiet for an atlas packed with padding", async () => {
    const padded = JSON.stringify({
      format: "ignifx.spriteatlas",
      version: 1,
      image: "hero.png",
      frames: [
        { name: "a", x: 0, y: 0, w: 8, h: 8 },
        { name: "b", x: 10, y: 10, w: 8, h: 8 },
      ],
    });
    harness = await createTwoDApp({ files: { ...fixtureFiles(), "2d/padded.atlas.json": padded } });
    await harness.load<SpriteAtlasAsset>("2d/padded.atlas.json");
    expect(harness.log.toArray().filter((record) => record.message.includes("IGX-1102"))).toEqual([]);
  });
});

describe("the #frame: fragment", () => {
  it("addresses one frame of a shared atlas", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    const handle = await harness.load<SpriteAsset>("2d/hero.atlas.json#frame:run_0");
    expect(handle.value.frame).toBe(2);
    expect(handle.value.name).toBe("run_0");
    expect(handle.value.atlas.frameCount).toBe(4);
  });

  it("refuses a frame the atlas does not declare", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    let captured: unknown = null;
    try {
      await harness.load<SpriteAsset>("2d/hero.atlas.json#frame:nope");
    } catch (error) {
      captured = error;
    }
    expect(codeOf(captured)).toBe("IGX-1106");
  });
});

describe("malformed documents", () => {
  const cases: readonly (readonly [string, string])[] = [
    [
      "wrong format",
      JSON.stringify({ format: "nope", image: "a.png", frames: [{ name: "a", x: 0, y: 0, w: 1, h: 1 }] }),
    ],
    [
      "wrong version",
      JSON.stringify({
        format: "ignifx.spriteatlas",
        formatVersion: 99,
        image: "a.png",
        frames: [{ name: "a", x: 0, y: 0, w: 1, h: 1 }],
      }),
    ],
    [
      "no image",
      JSON.stringify({ format: "ignifx.spriteatlas", image: "", frames: [{ name: "a", x: 0, y: 0, w: 1, h: 1 }] }),
    ],
    ["no frames", JSON.stringify({ format: "ignifx.spriteatlas", image: "a.png", frames: [] })],
    [
      "duplicate names",
      JSON.stringify({
        format: "ignifx.spriteatlas",
        image: "a.png",
        frames: [
          { name: "a", x: 0, y: 0, w: 1, h: 1 },
          { name: "a", x: 2, y: 0, w: 1, h: 1 },
        ],
      }),
    ],
    [
      "zero-size frame",
      JSON.stringify({ format: "ignifx.spriteatlas", image: "a.png", frames: [{ name: "a", x: 0, y: 0, w: 0, h: 1 }] }),
    ],
  ];

  for (const [name, body] of cases) {
    it(`rejects an atlas with a ${name}`, async () => {
      harness = await createTwoDApp({ files: { "2d/bad.atlas.json": body } });
      let captured: unknown = null;
      try {
        await harness.load("2d/bad.atlas.json");
      } catch (error) {
        captured = error;
      }
      expect(captured).not.toBeNull();
      expect(codeOf(captured)).toBe("IGX-1103");
    });
  }
});

describe("the fixture on disk", () => {
  it("is the document this suite thinks it is", () => {
    const parsed = JSON.parse(readFixture("hero.atlas.json")) as { readonly frames: readonly unknown[] };
    expect(parsed.frames).toHaveLength(4);
  });
});

describe("resolveAtlasImageUrl", () => {
  // A hashed production build: the manifest maps addresses to content-hashed URLs.
  const manifest: Record<string, string> = { "sprites/hero.png": "assets/hero.7f3a9c.png" };
  const assets = { resolveUrl: (address: string): string => manifest[address] ?? `assets/${address}` };

  it("resolves a relative image as an address relative to the atlas document, through the manifest", () => {
    expect(resolveAtlasImageUrl(assets, "sprites/hero.atlas.json", "hero.png")).toBe("assets/hero.7f3a9c.png");
    expect(resolveAtlasImageUrl(assets, "sprites/deep/hero.atlas.json", "../hero.png")).toBe("assets/hero.7f3a9c.png");
  });

  it("fetches root-relative and absolute references verbatim, the shape a public/ file has", () => {
    expect(resolveAtlasImageUrl(assets, "sprites/hero.atlas.json", "/tiles.png")).toBe("/tiles.png");
    expect(resolveAtlasImageUrl(assets, "sprites/hero.atlas.json", "https://cdn.example/t.png")).toBe(
      "https://cdn.example/t.png",
    );
    expect(resolveAtlasImageUrl(assets, "sprites/hero.atlas.json", "data:image/png;base64,AA==")).toBe(
      "data:image/png;base64,AA==",
    );
  });
});

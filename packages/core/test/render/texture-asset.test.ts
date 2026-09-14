import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { defaultTextureImportOptions, TextureAsset } from "../../src/render/texture-asset.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * `TextureAsset.fromPixels` and `TextureAsset.update` without a device
 * (`docs/architecture/05-assets-and-loading.md` §5, the plan's §2.2).
 *
 * A headless app uploads nothing, so what is asserted is everything that happens **before** the
 * upload: the byte-count and region arithmetic, the sampler defaults a data map wants, the
 * `memory:` publication, and the refusal to write to a texture that did not come from the pixel
 * factory. The pixels-on-screen half is `test/lite/render/texture-pixels.browser.test.ts`.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a headless app.
 *
 * @returns The harness.
 */
async function build(): Promise<RenderHarness> {
  const running = await createRenderHarness();
  harness = running;
  return running;
}

/**
 * Opaque white RGBA8 pixels.
 *
 * @param width - The width in texels.
 * @param height - The height in texels.
 * @returns The bytes.
 */
function whitePixels(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  data.fill(255);
  return data;
}

/**
 * The `IGX-####` code an error carries.
 *
 * @param run - The call under test.
 * @returns The code, or `null` when nothing was thrown or it was not an `IgnifxError`.
 */
function codeOf(run: () => void): string | null {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : null;
  }
  return null;
}

describe("fromPixels", () => {
  it("publishes a loaded handle with one holder", async () => {
    const running = await build();
    using ramp = TextureAsset.fromPixels(running.app, "ramp", whitePixels(2, 2), 2, 2);
    expect(ramp.state).toBe("loaded");
    expect(ramp.value).toBeInstanceOf(TextureAsset);
    expect(ramp.address.startsWith("memory:texture/")).toBe(true);
  });

  it("records the size it was asked for, even with no device", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(8, 4), 8, 4);
    expect(splat.value.width).toBe(8);
    expect(splat.value.height).toBe(4);
  });

  it("uploads nothing under a headless app", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(2, 2), 2, 2);
    expect(splat.value.lite.texture).toBeNull();
  });

  it("defaults to the sampler state a data map wants", async () => {
    const running = await build();
    using lut = TextureAsset.fromPixels(running.app, "lut", whitePixels(4, 1), 4, 1);
    expect(lut.value.options.minFilter).toBe("nearest");
    expect(lut.value.options.magFilter).toBe("nearest");
    expect(lut.value.options.addressModeU).toBe("clamp-to-edge");
    expect(lut.value.options.srgb).toBe(false);
    expect(lut.value.options.mipMaps).toBe(false);
  });

  it("honours the three options it accepts", async () => {
    const running = await build();
    using tile = TextureAsset.fromPixels(running.app, "tile", whitePixels(2, 2), 2, 2, {
      srgb: true,
      filter: "linear",
      wrap: "repeat",
    });
    expect(tile.value.options.srgb).toBe(true);
    expect(tile.value.options.minFilter).toBe("linear");
    expect(tile.value.options.addressModeV).toBe("repeat");
  });

  it("refuses a byte count that does not match the size with IGX-0722", async () => {
    const running = await build();
    expect(
      codeOf(() => {
        TextureAsset.fromPixels(running.app, "short", whitePixels(2, 2), 4, 4);
      }),
    ).toBe("IGX-0722");
  });

  it("refuses a zero or fractional size", async () => {
    const running = await build();
    expect(
      codeOf(() => {
        TextureAsset.fromPixels(running.app, "empty", new Uint8Array(0), 0, 0);
      }),
    ).toBe("IGX-0722");
    expect(
      codeOf(() => {
        TextureAsset.fromPixels(running.app, "half", whitePixels(2, 2), 2.5, 1.6);
      }),
    ).toBe("IGX-0722");
  });
});

describe("update", () => {
  it("accepts a whole-texture write", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(4, 4), 4, 4);
    expect(() => {
      splat.value.update(whitePixels(4, 4));
    }).not.toThrow();
  });

  it("accepts a one-texel region", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(4, 4), 4, 4);
    expect(() => {
      splat.value.update(whitePixels(1, 1), 3, 3, 1, 1);
    }).not.toThrow();
  });

  it("refuses a region that runs off the edge with IGX-0722", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(4, 4), 4, 4);
    expect(codeOf(() => splat.value.update(whitePixels(2, 2), 3, 3, 2, 2))).toBe("IGX-0722");
  });

  it("refuses a negative origin with IGX-0722", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(4, 4), 4, 4);
    expect(codeOf(() => splat.value.update(whitePixels(1, 1), -1, 0, 1, 1))).toBe("IGX-0722");
  });

  it("refuses a byte count that does not match the region with IGX-0722", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(4, 4), 4, 4);
    expect(codeOf(() => splat.value.update(whitePixels(1, 1), 0, 0, 2, 2))).toBe("IGX-0722");
  });

  it("refuses a texture that did not come from fromPixels with IGX-0702", () => {
    const loaded = new TextureAsset("textures/a.png", null, defaultTextureImportOptions());
    expect(codeOf(() => loaded.update(whitePixels(1, 1), 0, 0, 1, 1))).toBe("IGX-0702");
  });

  it("still validates after the GPU share was released", async () => {
    const running = await build();
    using splat = TextureAsset.fromPixels(running.app, "splat", whitePixels(2, 2), 2, 2);
    splat.value.releaseGpu();
    expect(codeOf(() => splat.value.update(whitePixels(4, 4), 0, 0, 4, 4))).toBe("IGX-0722");
    expect(() => {
      splat.value.update(whitePixels(2, 2));
    }).not.toThrow();
  });
});

describe("width and height", () => {
  it("are zero for a texture that decoded nothing", () => {
    const loaded = new TextureAsset("textures/a.png", null, defaultTextureImportOptions());
    expect(loaded.width).toBe(0);
    expect(loaded.height).toBe(0);
  });
});

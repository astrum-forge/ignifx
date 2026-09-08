import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { twoD } from "../src/extension.js";
import { spriteClearColor } from "../src/settings.js";
import type { App, ColorLike } from "@ignifx/core";

/**
 * The one value `@ignifx/2d` reads out of a **core** settings section: the `rendering.clearColor` a
 * `"sprite"`-mode frame is cleared to (`docs/architecture/11-2d-toolkit.md` §1,
 * `07-rendering.md` §2.1).
 *
 * The plumbing is testable headlessly even though the clear itself is not. `spriteClearColor` is
 * exactly what the extension hands `createRegisteredSpriteRenderer`, so a headless app proves which
 * setting is read and how it is decoded, and `clear-color.browser.test.ts` proves the pixel that
 * comes out of it.
 */

let app: App | null = null;

afterEach(() => {
  app?.dispose();
  app = null;
});

/** sRGB `0.5` decoded to linear, to four places — the reference value the assertions use. */
const HALF_SRGB_AS_LINEAR = 0.214;

describe("spriteClearColor", () => {
  it("decodes the rendering.clearColor setting from sRGB, the way the 3D path does", async () => {
    const running = await createApp({
      headless: true,
      extensions: [twoD()],
      settings: { rendering: { clearColor: { r: 0.5, g: 0, b: 1, a: 1 } } },
    });
    app = running;

    const clear = spriteClearColor(running);
    expect(clear.r).toBeCloseTo(HALF_SRGB_AS_LINEAR, 4);
    // 0 and 1 are their own images under the transfer function, which is what makes an all-black
    // or all-white clear look the same in both colour spaces.
    expect(clear.g).toBe(0);
    expect(clear.b).toBe(1);
    // Alpha is not a colour channel and is passed through untouched.
    expect(clear.a).toBe(1);
  });

  it("answers opaque black for a project that configures no rendering section", async () => {
    const running = await createApp({ headless: true, extensions: [twoD()] });
    app = running;

    const clear: ColorLike = spriteClearColor(running);
    expect(clear).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

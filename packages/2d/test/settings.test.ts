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
 * setting is read, and `clear-color.browser.test.ts` proves the pixel that comes out of it.
 */

let app: App | null = null;

afterEach(() => {
  app?.dispose();
  app = null;
});

describe("spriteClearColor", () => {
  it("hands the rendering.clearColor setting over as sRGB, undecoded", async () => {
    const running = await createApp({
      headless: true,
      extensions: [twoD()],
      settings: { rendering: { clearColor: { r: 0.5, g: 0, b: 1, a: 1 } } },
    });
    app = running;

    expect(spriteClearColor(running)).toEqual({ r: 0.5, g: 0, b: 1, a: 1 });
  });

  it("answers opaque black for a project that configures no rendering section", async () => {
    const running = await createApp({ headless: true, extensions: [twoD()] });
    app = running;

    const clear: ColorLike = spriteClearColor(running);
    expect(clear).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

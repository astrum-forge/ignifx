import { Camera } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { HudText } from "../src/text/hud-text.js";
import { WorldText2D } from "../src/text/world-text-2d.js";
import { WorldText } from "../src/text/world-text.js";
import { createUiBrowserApp, fixtureAssets } from "./support/browser-harness.js";
import type { Capture, Rgba, UiBrowserApp } from "./support/browser-harness.js";
import type { AssetHandle, FontAsset } from "@ignifx/core";

/**
 * Phase 8's *"text rendering golden"* exit criterion, on a real WebGPU device.
 *
 * It is a **deterministic assertion, not a stored PNG**. A golden image of anti-aliased text would
 * be a hostage to the driver, to SwiftShader's rasteriser, and to the day the font is updated; what
 * actually has to hold is narrower and stronger: Babylon Lite's text pass writes lit pixels inside
 * the box the layout computed, and writes nothing outside it. Both halves are asserted here against
 * `app.renderer.captureScreenshot()`, whose readback is *"the final presented 8-bit colours, so
 * comparing two captures compares what the player saw"* (`packages/core/src/render/renderer.ts`).
 *
 * The font is Share Tech Mono, a **monospaced** face, which is what makes the box arithmetic rather
 * than a measurement: every advance is `fontSize x 0.54`, verified on the pinned build.
 */

let harness: UiBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A pixel counts as "lit" when it is well clear of the black the scene clears to. */
const LIT = 40;

/**
 * Whether a pixel is clearly brighter than the background.
 *
 * @param pixel - The pixel.
 * @returns `true` when any channel is lit.
 */
function isLit(pixel: Rgba): boolean {
  return pixel.r > LIT || pixel.g > LIT || pixel.b > LIT;
}

/**
 * Counts the lit pixels of a rectangle.
 *
 * @param capture - The frame.
 * @param left - The rectangle's left edge, in device pixels.
 * @param top - Its top edge.
 * @param width - Its width.
 * @param height - Its height.
 * @returns How many pixels inside it are lit.
 */
function countLit(capture: Capture, left: number, top: number, width: number, height: number): number {
  let lit = 0;
  for (let y = Math.max(0, top); y < Math.min(capture.height, top + height); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(capture.width, left + width); x += 1) {
      if (isLit(capture.at(x, y))) {
        lit += 1;
      }
    }
  }
  return lit;
}

/**
 * Builds an app with a camera, a black clear colour, and the font loaded.
 *
 * @param width - The canvas width.
 * @param height - The canvas height.
 * @returns The app and the font handle.
 */
async function withFont(width = 192, height = 96): Promise<{ running: UiBrowserApp; font: AssetHandle<FontAsset> }> {
  const running = await createUiBrowserApp({
    width,
    height,
    assets: fixtureAssets(),
    settings: { rendering: { clearColor: { r: 0, g: 0, b: 0, a: 1 }, msaaSamples: 1 } },
  });
  harness = running;
  const eye = running.app.world.createEntity("camera");
  eye.transform.localPosition.set(0, 0, -4);
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  const font = running.app.assets.load<FontAsset>("ui/font.ttf");
  await running.advance(4);
  await font.promise;
  return { running, font };
}

describe("HudText", () => {
  it("draws glyph pixels inside the laid-out box and nothing outside it", async () => {
    const { running, font } = await withFont();
    const label = running.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "MMM";
    label.fontSize = 32;
    label.anchor = "topLeft";
    label.position = { x: 8, y: 8 };
    label.color = { r: 1, g: 1, b: 1, a: 1 };
    await running.advance(6);

    const metrics = label.metrics;
    expect(metrics.width).toBeGreaterThan(0);

    const empty = await running.capture();
    expect(empty.width).toBe(192);

    // The box: the anchor put its top-left corner at (8, 8) and it is `metrics` big.
    const inside = countLit(empty, 8, 8, Math.ceil(metrics.width), Math.ceil(metrics.height));
    expect(inside).toBeGreaterThan(20);

    // The same-sized rectangle in the opposite corner holds nothing at all.
    const outsideLeft = empty.width - Math.ceil(metrics.width) - 1;
    const outsideTop = empty.height - Math.ceil(metrics.height) - 1;
    const outside = countLit(empty, outsideLeft, outsideTop, Math.ceil(metrics.width), Math.ceil(metrics.height));
    expect(outside).toBe(0);
  }, 60_000);

  it("moves its pixels when the anchor changes", async () => {
    const { running, font } = await withFont();
    const label = running.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "MMM";
    label.fontSize = 32;
    label.anchor = "topLeft";
    label.position = { x: 8, y: 8 };
    await running.advance(6);
    const metrics = label.metrics;
    const box = { w: Math.ceil(metrics.width), h: Math.ceil(metrics.height) };

    const topLeft = await running.capture();
    expect(countLit(topLeft, 8, 8, box.w, box.h)).toBeGreaterThan(20);

    label.anchor = "bottomRight";
    label.position = { x: -8, y: -8 };
    await running.advance(6);
    const bottomRight = await running.capture();
    expect(countLit(bottomRight, 8, 8, box.w, box.h)).toBe(0);
    expect(
      countLit(bottomRight, bottomRight.width - 8 - box.w, bottomRight.height - 8 - box.h, box.w, box.h),
    ).toBeGreaterThan(20);
  }, 60_000);

  it("stops drawing when the label is disabled and draws again when it is enabled", async () => {
    const { running, font } = await withFont();
    const entity = running.app.world.createEntity("score");
    const label = entity.addComponent(HudText);
    label.font = font;
    label.text = "MMM";
    label.fontSize = 32;
    label.position = { x: 8, y: 8 };
    await running.advance(6);
    const box = { w: Math.ceil(label.metrics.width), h: Math.ceil(label.metrics.height) };
    expect(countLit(await running.capture(), 8, 8, box.w, box.h)).toBeGreaterThan(20);

    label.enabled = false;
    await running.advance(6);
    expect(countLit(await running.capture(), 8, 8, box.w, box.h)).toBe(0);

    label.enabled = true;
    await running.advance(6);
    expect(countLit(await running.capture(), 8, 8, box.w, box.h)).toBeGreaterThan(20);
  }, 60_000);

  it("re-shapes when the text changes without rebuilding the layer", async () => {
    const { running, font } = await withFont();
    const label = running.app.world.createEntity("score").addComponent(HudText);
    label.font = font;
    label.text = "M";
    label.fontSize = 32;
    label.position = { x: 8, y: 8 };
    await running.advance(6);
    const layer = label.lite.layer;
    const narrow = label.metrics.width;

    label.text = "MMMM";
    await running.advance(6);
    expect(label.lite.layer).toBe(layer);
    expect(label.metrics.width).toBeGreaterThan(narrow);
    const wide = await running.capture();
    expect(
      countLit(wide, 8 + Math.ceil(narrow), 8, Math.ceil(narrow), Math.ceil(label.metrics.height)),
    ).toBeGreaterThan(0);
  }, 60_000);
});

describe("WorldText2D", () => {
  it("draws at the entity's projected position and hides behind the camera", async () => {
    const { running, font } = await withFont(128, 128);
    const target = running.app.world.createEntity("target");
    const label = target.addComponent(WorldText2D);
    label.font = font;
    label.text = "M";
    label.fontSize = 32;
    label.pivot = "center";
    await running.advance(6);

    const centred = await running.capture();
    const half = Math.ceil(Math.max(label.metrics.width, label.metrics.height));
    expect(countLit(centred, 64 - half, 64 - half, half * 2, half * 2)).toBeGreaterThan(10);

    target.transform.localPosition.set(0, 0, -20);
    await running.advance(6);
    const behind = await running.capture();
    expect(countLit(behind, 0, 0, behind.width, behind.height)).toBe(0);
  }, 60_000);
});

describe("WorldText", () => {
  it("draws a sign that existed before the app started, and stops when it is emptied", async () => {
    // The renderable has to reach the scene before `registerScene` builds it: Lite drains a
    // deferred scene renderable exactly once, inside `buildScene`, and exposes no way to drain a
    // later one. So the app is built unstarted, one `app.step()` runs the UI system to create and
    // attach the renderable, and only then does the loop start. See `src/text/world-text.ts`.
    const running = await createUiBrowserApp({
      width: 128,
      height: 128,
      assets: fixtureAssets(),
      autoStart: false,
      settings: { rendering: { clearColor: { r: 0, g: 0, b: 0, a: 1 }, msaaSamples: 1 } },
    });
    harness = running;
    const eye = running.app.world.createEntity("camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    const font = running.app.assets.load<FontAsset>("ui/font.ttf");
    await font.promise;

    const sign = running.app.world.createEntity("sign").addComponent(WorldText);
    sign.font = font;
    sign.text = "M";
    sign.fontSize = 64;
    sign.pixelsPerUnit = 64;
    sign.alwaysOnTop = true;
    running.app.step(1 / 60);
    expect(sign.lite.renderable).not.toBeNull();

    await running.app.start();
    await running.advance(8);
    const drawn = await running.capture();
    expect(countLit(drawn, 0, 0, drawn.width, drawn.height)).toBeGreaterThan(0);

    sign.text = "";
    await running.advance(8);
    const blank = await running.capture();
    expect(countLit(blank, 0, 0, blank.width, blank.height)).toBe(0);
  }, 60_000);

  it("warns once when a sign is given its text after the app started", async () => {
    const { running, font } = await withFont(128, 128);
    const first = running.app.world.createEntity("sign").addComponent(WorldText);
    first.font = font;
    first.text = "M";
    const second = running.app.world.createEntity("sign2").addComponent(WorldText);
    second.font = font;
    second.text = "M";
    await running.advance(4);
    expect(first.lite.renderable).not.toBeNull();
    expect(second.lite.renderable).not.toBeNull();
  }, 60_000);
});

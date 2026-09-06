import { afterEach, describe, expect, it } from "vitest";
import { SPRITE_EFFECT_KINDS, SpriteLayerEffect, TINT_EFFECT_WGSL } from "../../src/sprite/sprite-layer-effect.js";
import { createTwoDApp } from "../support/app.js";
import type { TwoDAppHarness } from "../support/app.js";

/**
 * `SpriteLayerEffect` (`docs/architecture/11-2d-toolkit.md` §6): Lite's 2D path has no lighting
 * model, so a per-layer WGSL fragment shader is what a 2D game tints, dissolves, and shimmers with.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A headless app carrying one effect. */
async function createEffect(): Promise<SpriteLayerEffect> {
  harness = await createTwoDApp();
  return harness.app.world.createEntity("fx").addComponent(SpriteLayerEffect);
}

describe("defaults", () => {
  it("starts as an identity tint on the Default layer", async () => {
    const effect = await createEffect();
    expect(effect.sortingLayer).toBe("Default");
    expect(effect.kind).toBe("tint");
    expect(effect.shader).toBe("");
    expect(SPRITE_EFFECT_KINDS).toEqual(["tint", "custom"]);
  });
});

describe("source", () => {
  it("ships a built-in tint", async () => {
    const effect = await createEffect();
    expect(effect.source()).toBe(TINT_EFFECT_WGSL);
    expect(TINT_EFFECT_WGSL).toContain("fx.params");
    expect(TINT_EFFECT_WGSL).toContain("atlasTex");
  });

  it("returns a custom body verbatim", async () => {
    const effect = await createEffect();
    effect.kind = "custom";
    effect.shader = "return vec4f(1.0);";
    expect(effect.source()).toBe("return vec4f(1.0);");
  });

  it("refuses a custom effect with no body", async () => {
    const effect = await createEffect();
    effect.kind = "custom";
    let captured: unknown = null;
    try {
      effect.source();
    } catch (error) {
      captured = error;
    }
    expect((captured as { readonly code?: string }).code).toBe("IGX-1113");
  });
});

describe("params", () => {
  it("writes the tint colour for a tint effect", async () => {
    const effect = await createEffect();
    effect.tint = { r: 0.25, g: 0.5, b: 0.75, a: 0.5 };
    const out = new Float32Array(4);
    expect(effect.writeParams(out)).toBe(out);
    expect([...out]).toEqual([0.25, 0.5, 0.75, 0.5]);
  });

  it("writes the raw vec4 for a custom effect", async () => {
    const effect = await createEffect();
    effect.kind = "custom";
    effect.params = { x: 1, y: 2, z: 3, w: 4 };
    const out = new Float32Array(4);
    effect.writeParams(out);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });
});

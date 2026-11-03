import { afterEach, describe, expect, it } from "vitest";
import { HDR_BLOOM_MIP_COUNT, writeHdrBloomUniforms } from "../../src/lite/gpu/bloom-hdr.js";
import { hdrBloomSupport, loadHdrBloomSupport } from "../../src/render/hdr-bloom-support.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * HDR bloom without a device (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G12): the
 * record's defaults, the uniform layout, the chunk gate, and the LDR bloom leaving the chain under
 * `rendering.hdr`. The chain itself is drawn in `bloom-hdr.browser.test.ts`.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Uniform floats per pass. */
const FLOATS = 4;

/** Where the composite pass's block starts. */
const COMPOSITE = (2 * HDR_BLOOM_MIP_COUNT - 1) * FLOATS;

describe("the bloom record", () => {
  it("defaults the HDR fields to a soft, unthresholded glow", () => {
    const stack = new PostProcessStack();
    expect(stack.bloom.intensity).toBe(0.1);
    expect(stack.bloom.radius).toBe(0.7);
    expect(stack.bloom.hdrThreshold).toBe(0);
    expect(stack.bloom.threshold).toBe(0.9);
  });
});

describe("writeHdrBloomUniforms", () => {
  it("mixes the glow in without a threshold, so the frame keeps its energy", () => {
    const out = new Float32Array(2 * HDR_BLOOM_MIP_COUNT * FLOATS);
    writeHdrBloomUniforms({ intensity: 0.25, radius: 0.5, threshold: 0 }, out);
    expect(out[2]).toBe(1);
    expect(out[FLOATS + 2]).toBe(0);
    expect(out[HDR_BLOOM_MIP_COUNT * FLOATS]).toBe(0.5);
    expect(out[COMPOSITE]).toBe(0.25);
    expect(out[COMPOSITE + 1]).toBe(0.25);
  });

  it("adds the glow with a threshold, and clamps what an inspector could mistype", () => {
    const out = new Float32Array(2 * HDR_BLOOM_MIP_COUNT * FLOATS);
    writeHdrBloomUniforms({ intensity: -1, radius: 3, threshold: 2 }, out);
    expect(out[0]).toBe(2);
    expect(out[1]).toBe(1);
    expect(out[HDR_BLOOM_MIP_COUNT * FLOATS]).toBe(1);
    expect(out[COMPOSITE]).toBe(0);
    expect(out[COMPOSITE + 1]).toBe(0);
  });
});

describe("the HDR bloom chunk", () => {
  it("loads once and exposes the installer", async () => {
    const first = await loadHdrBloomSupport();
    expect(await loadHdrBloomSupport()).toBe(first);
    expect(hdrBloomSupport()).toBe(first);
    expect(typeof first.installHdrBloom).toBe("function");
  });
});

describe("a stack under rendering.hdr", () => {
  it("records no HDR bloom without a presenter, and keeps the LDR bloom out of its chain", async () => {
    harness = await createRenderHarness({
      settings: { rendering: { hdr: true, features: { postProcessing: true } } },
    });
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.smaa.enabled = true;
    harness.frame();
    harness.frame();
    expect(stack.hdrBloom).toBeNull();
    expect(stack.taskCount).toBe(0);
    stack.entity.removeComponent(stack);
    expect(harness.errors).toStrictEqual([]);
  });
});

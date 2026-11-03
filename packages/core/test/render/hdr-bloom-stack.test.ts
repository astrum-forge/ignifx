import { afterEach, describe, expect, it, vi } from "vitest";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { RendererImpl } from "../../src/render/renderer.js";

/**
 * A `PostProcessStack`'s HDR bloom lifecycle under `rendering.hdr` (GI plan G12), over a renderer
 * that reports an HDR presenter and a fake bloom chunk: the chain loads on first want, is installed
 * on the next sync, follows `bloom.enabled`, and is disposed with the stack. What it draws is
 * `bloom-hdr.browser.test.ts`.
 */

const bloom = vi.hoisted(() => ({
  installs: 0,
  setEnabled: [] as boolean[],
  applied: [] as unknown[],
  disposed: 0,
}));

vi.mock("../../src/lite/gpu/bloom-hdr.js", () => ({
  installHdrBloom: () => {
    bloom.installs += 1;
    return {
      mips: [],
      taskCount: 1,
      setEnabled: (enabled: boolean): void => {
        bloom.setEnabled.push(enabled);
      },
      apply: (tuning: unknown): void => {
        bloom.applied.push(tuning);
      },
      dispose: (): void => {
        bloom.disposed += 1;
      },
    };
  },
}));

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * The harness's renderer, reporting an HDR presenter.
 *
 * @param renderer - The headless renderer.
 * @returns A renderer whose presenter has an HDR output.
 */
function withHdrPresenter(renderer: RendererImpl): RendererImpl {
  const fake = {
    presenter: { hdr: {} },
    settings: renderer.settings,
    features: renderer.features,
    isHeadless: true,
    isSceneRegistered: false,
    engine: renderer.engine,
    scene: renderer.scene,
    surface: null,
    effectClock: renderer.effectClock,
    app: renderer.app,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return fake as unknown as RendererImpl;
}

describe("a stack's HDR bloom", () => {
  it("loads, installs, follows bloom.enabled, and is disposed with the stack", async () => {
    harness = await createRenderHarness({
      settings: { rendering: { hdr: true, features: { postProcessing: true } } },
    });
    const renderer = withHdrPresenter(harness.renderer);
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.sync(renderer);
    expect(bloom.installs).toBe(0);

    stack.bloom.enabled = true;
    stack.bloom.intensity = 0.3;
    stack.sync(renderer);
    // The chunk loads first; until it is in, the frame presents without bloom.
    expect(stack.hdrBloom).toBeNull();
    await vi.waitFor(() => {
      stack.sync(renderer);
      expect(stack.hdrBloom).not.toBeNull();
    });
    expect(bloom.installs).toBe(1);
    expect(bloom.setEnabled.at(-1)).toBe(true);
    expect(bloom.applied.at(-1)).toEqual({ intensity: 0.3, radius: stack.bloom.radius, threshold: 0 });
    // Under HDR the LDR bloom is not part of the chain: the only tasks are the HDR chain's.
    expect(stack.plannedChain()).toEqual(["bloom"]);
    expect(stack.taskCount).toBe(1);

    stack.bloom.enabled = false;
    stack.sync(renderer);
    expect(bloom.setEnabled.at(-1)).toBe(false);
    expect(bloom.installs).toBe(1);

    // Removal lands at the end of the frame.
    stack.entity.removeComponent(stack);
    harness.frame();
    expect(bloom.disposed).toBe(1);
    expect(stack.hdrBloom).toBeNull();
  });
});

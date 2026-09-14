import { afterEach, describe, expect, it, vi } from "vitest";
import { rebuildRenderables } from "../../src/lite/shadow.js";
import { Light } from "../../src/render/light.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type * as ShadowModule from "../../src/lite/shadow.js";

/**
 * Renderable rebuilds are serialised: one `rebuildSceneRenderables` runs at a time, and everything
 * asked for while it is running collapses into one further run.
 *
 * ## Why it matters
 *
 * `rebuildSceneGroups` ends its `finally` with `ctx._frameGraph.build()`
 * (`lib/scene/scene-rebuild.js` 50-56), which re-records every task — `buildBindings` over
 * `scene._renderables`, then `buildRenderPassDescriptor` (`lib/frame-graph/render-task.js` 84-92).
 * A second run in flight spends most of its life with the scene torn half down, so that `build()`
 * throws out of `record()` **after** the task's targets were reallocated and **before** the pass
 * descriptor was rebuilt. The task then keeps the attachment it was constructed with —
 * `{ loadOp, storeOp }`, with no `view` key (line 30, 49) — and every later frame dies with
 * `beginRenderPass … colorAttachments[0].view … Required member is undefined`.
 *
 * The rebuild is mocked here because the assertion is about *when* it is called, not what it does,
 * and because a null engine would return from it before anything is observable.
 */

vi.mock("../../src/lite/shadow.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ShadowModule>();
  return { ...actual, rebuildRenderables: vi.fn((): Promise<void> => Promise.resolve()) };
});

let harness: RenderHarness | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  harness?.dispose();
  harness = null;
});

/** A gate a test opens by hand, standing in for a rebuild that spans several frames. */
interface Gate {
  /** The promise the mocked rebuild returns. */
  readonly promise: Promise<void>;
  /** Lets it resolve. */
  open(): void;
}

/**
 * Builds a gate.
 *
 * @returns The gate.
 */
function gate(): Gate {
  let release: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    open(): void {
      release?.();
    },
  };
}

describe("renderable rebuilds", () => {
  it("never runs two at once, and collapses what arrived into one further run", async () => {
    harness = await createRenderHarness();
    const h = harness;
    const rebuild = vi.mocked(rebuildRenderables);
    // The system's headless gate returns before anything is observable, and a registered scene is
    // what a started app has; neither needs a device for this assertion.
    vi.spyOn(h.renderer, "isHeadless", "get").mockReturnValue(false);
    vi.spyOn(h.renderer, "isSceneRegistered", "get").mockReturnValue(true);

    const first = gate();
    rebuild.mockReturnValue(first.promise);
    rebuild.mockClear();

    // A light is a topology change; the rebuild it earns is deferred to the next quiet frame.
    const sun = h.world.createEntity("Sun").addComponent(Light, { type: "directional" });
    h.frame();
    h.frame();
    await h.flush();
    expect(rebuild).toHaveBeenCalledTimes(1);

    // A second topology change while the first rebuild is still running must not start a second.
    sun.type = "point";
    h.frame();
    h.frame();
    await h.flush();
    expect(rebuild).toHaveBeenCalledTimes(1);

    // A third one while still running collapses into the same single follow-up.
    sun.intensity = 2;
    h.frame();
    h.frame();
    await h.flush();
    expect(rebuild).toHaveBeenCalledTimes(1);

    const second = gate();
    rebuild.mockReturnValue(second.promise);
    first.open();
    await h.flush();
    expect(rebuild).toHaveBeenCalledTimes(2);

    second.open();
    await h.flush();
    h.frame();
    await h.flush();
    // Nothing is owed once the queue has drained.
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("reports a failed rebuild and still drains what was queued behind it", async () => {
    harness = await createRenderHarness();
    const h = harness;
    const rebuild = vi.mocked(rebuildRenderables);
    vi.spyOn(h.renderer, "isHeadless", "get").mockReturnValue(false);
    vi.spyOn(h.renderer, "isSceneRegistered", "get").mockReturnValue(true);

    const failure = new Error("group build failed");
    const first = gate();
    rebuild.mockClear();
    rebuild.mockReturnValue(
      first.promise.then((): never => {
        throw failure;
      }),
    );

    const sun = h.world.createEntity("Sun").addComponent(Light, { type: "directional" });
    h.frame();
    h.frame();
    await h.flush();
    sun.type = "point";
    h.frame();
    h.frame();
    await h.flush();
    expect(rebuild).toHaveBeenCalledTimes(1);

    rebuild.mockResolvedValue(undefined);
    first.open();
    await h.flush();
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(h.errors.map((report) => report.error)).toContain(failure);
  });
});

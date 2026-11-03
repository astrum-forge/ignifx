import { afterEach, describe, expect, it } from "vitest";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * Shared scene inputs are pay-for-use (`docs/architecture/07-rendering.md` §2.12,
 * `CONSTITUTION.md` §2.5): an app that never asks for them loads no chunk and adds no task. The
 * GPU half is `scene-inputs.browser.test.ts`.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("scene inputs without a device", () => {
  it("has no user and builds nothing until an effect asks", async () => {
    harness = await createRenderHarness();
    await harness.app.start();
    harness.app.step(1 / 60);
    expect(harness.renderer.sceneInputsUserCount).toBe(0);
  });

  it("returns null under the null engine instead of building a pass", async () => {
    harness = await createRenderHarness();
    expect(await harness.renderer.acquireSceneInputs()).toBeNull();
    expect(harness.renderer.sceneInputsUserCount).toBe(0);
  });
});

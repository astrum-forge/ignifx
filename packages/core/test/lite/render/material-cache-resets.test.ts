import { describe, expect, it, vi } from "vitest";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import {
  createMaterialCacheResets,
  forgetMaterialBindingLayouts,
  learnMaterialCacheResets,
  rebuildRenderables,
} from "../../../src/lite/shadow.js";
import type { SceneContext } from "@babylonjs/lite";

/**
 * How the adapter finds Babylon Lite's material cache resets (`src/lite/shadow.ts`,
 * `MaterialCacheResets`): a group builder pushes its process-wide reset onto `scene._disposables`
 * on every build, so the function a rebuild pushes **again** is the reset, and a scene's own
 * one-off disposers are not.
 *
 * A real group build needs a device, so these tests give a headless scene one stand-in group whose
 * builder pushes what Lite's do: the same module-level reset every time, and a fresh closure.
 */

/** The Lite fields the stand-in group touches. Absent from `index.d.ts`. */
interface BuildableScene {
  _built: boolean;
  _disposables: (() => void)[];
  _groups: Map<unknown, unknown[]>;
  meshes: unknown[];
}

/**
 * Gives a headless scene one built group whose builder registers `reset` and a new closure on each
 * build, the way `buildPbrRenderables` does.
 *
 * @param scene - The headless scene.
 * @param reset - The module-level reset the builder registers.
 * @returns The fields the test reads back.
 */
function withStandInGroup(scene: SceneContext, reset: () => void): BuildableScene {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const buildable = scene as unknown as BuildableScene;
  const builder = (ctx: BuildableScene): Promise<unknown> => {
    // oxlint-disable-next-line no-underscore-dangle
    ctx._disposables.push((): void => undefined, reset);
    return Promise.resolve({ renderables: [], rebuildSingle: (): undefined => undefined });
  };
  const mesh = { material: { _buildGroup: builder } };
  const group: unknown[] & { r?: unknown } = [mesh];
  group.r = (): undefined => undefined;
  buildable.meshes.push(mesh);
  // oxlint-disable-next-line no-underscore-dangle
  buildable._groups.set(builder, group);
  // oxlint-disable-next-line no-underscore-dangle
  buildable._disposables.push(reset);
  // oxlint-disable-next-line no-underscore-dangle
  buildable._built = true;
  return buildable;
}

/**
 * Takes the stand-in mesh back out before the scene is disposed, since it has no GPU data to free.
 *
 * @param scene - The headless scene.
 */
function discard(scene: SceneContext): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const buildable = scene as unknown as BuildableScene;
  buildable.meshes.length = 0;
  // oxlint-disable-next-line no-underscore-dangle
  buildable._groups.clear();
  disposeSceneOnly(scene);
}

describe("material cache resets", () => {
  it("records the function a rebuild registers again, and nothing else", async () => {
    const { scene } = createHeadlessScene();
    const reset = vi.fn();
    try {
      const buildable = withStandInGroup(scene, reset);
      const resets = createMaterialCacheResets();
      await rebuildRenderables(scene, resets);

      expect([...resets.found]).toEqual([reset]);
      // The list is an ordinary array again once the rebuild is over.
      // oxlint-disable-next-line no-underscore-dangle
      expect(Object.hasOwn(buildable._disposables, "push")).toBe(false);
    } finally {
      discard(scene);
    }
  });

  it("calls every recorded reset when the layouts must be forgotten", async () => {
    const { scene } = createHeadlessScene();
    const reset = vi.fn();
    try {
      withStandInGroup(scene, reset);
      const resets = createMaterialCacheResets();
      await learnMaterialCacheResets(scene, resets);
      reset.mockClear();

      forgetMaterialBindingLayouts(resets);

      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      discard(scene);
    }
  });

  it("learns once, and records nothing on a scene that was never built", async () => {
    const { scene } = createHeadlessScene();
    try {
      const resets = createMaterialCacheResets();
      await learnMaterialCacheResets(scene, resets);
      expect(resets.found.size).toBe(0);

      const known = vi.fn();
      resets.found.add(known);
      const reset = vi.fn();
      withStandInGroup(scene, reset);
      await learnMaterialCacheResets(scene, resets);
      expect([...resets.found]).toEqual([known]);
    } finally {
      discard(scene);
    }
  });
});

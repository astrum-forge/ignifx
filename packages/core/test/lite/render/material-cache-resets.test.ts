import { describe, expect, it, vi } from "vitest";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import {
  createMaterialCacheResets,
  forgetMaterialBindingLayouts,
  learnMaterialCacheResets,
  rebuildRenderables,
  trackMaterialCacheResets,
} from "../../../src/lite/shadow.js";
import type { SceneContext } from "@babylonjs/lite";

/**
 * How the adapter finds Babylon Lite's material cache resets (`src/lite/shadow.ts`,
 * `MaterialCacheResets`): a group builder pushes its process-wide reset onto `scene._disposables`
 * on every build, so the function pushed **again** is the reset, and a scene's own one-off
 * disposers are not. A function seen for the first time asks for one confirming rebuild.
 *
 * A real group build needs a device, so these tests give a headless scene one stand-in group whose
 * builder pushes what the test asks for on each build.
 */

/** The Lite fields the stand-in group touches. Absent from `index.d.ts`. */
interface BuildableScene {
  _built: boolean;
  _disposables: (() => void)[];
  _groups: Map<unknown, unknown[]>;
  meshes: unknown[];
}

/**
 * Reads a headless scene through the Lite fields the stand-in group touches.
 *
 * @param scene - The headless scene.
 * @returns The same scene.
 */
function buildable(scene: SceneContext): BuildableScene {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return scene as unknown as BuildableScene;
}

/**
 * Gives a headless scene one built group whose builder pushes `pushes(build)` on each build.
 *
 * @param scene - The headless scene.
 * @param pushes - What the builder registers on its `build`-th build, counting from 1.
 * @returns How many times the builder has run.
 */
function withStandInGroup(
  scene: SceneContext,
  pushes: (build: number) => (() => void)[],
): { readonly builds: () => number } {
  const target = buildable(scene);
  let builds = 0;
  const builder = (ctx: BuildableScene): Promise<unknown> => {
    builds += 1;
    // oxlint-disable-next-line no-underscore-dangle
    ctx._disposables.push(...pushes(builds));
    return Promise.resolve({ renderables: [], rebuildSingle: (): undefined => undefined });
  };
  const mesh = { material: { _buildGroup: builder } };
  const group: unknown[] & { r?: unknown } = [mesh];
  group.r = (): undefined => undefined;
  target.meshes.push(mesh);
  // oxlint-disable-next-line no-underscore-dangle
  target._groups.set(builder, group);
  // oxlint-disable-next-line no-underscore-dangle
  target._built = true;
  return { builds: (): number => builds };
}

/**
 * Takes the stand-in mesh back out before the scene is disposed, since it has no GPU data to free.
 *
 * @param scene - The headless scene.
 */
function discard(scene: SceneContext): void {
  const target = buildable(scene);
  target.meshes.length = 0;
  // oxlint-disable-next-line no-underscore-dangle
  target._groups.clear();
  disposeSceneOnly(scene);
}

/**
 * Adds a second, empty family and runs one untracked rebuild, which installs Lite's runtime-build state and its one-off disposer the
 * way a scene's first rebuild does, so a test can count the rebuilds that follow.
 *
 * @param scene - The headless scene.
 */
async function installRuntimeBuildState(scene: SceneContext): Promise<void> {
  withStandInGroup(scene, () => []);
  await rebuildRenderables(scene);
}

describe("material cache resets", () => {
  it("records a reset a rebuild registers again, in one rebuild", async () => {
    const { scene } = createHeadlessScene();
    const reset = vi.fn();
    try {
      // oxlint-disable-next-line no-underscore-dangle
      buildable(scene)._disposables.push(reset);
      const group = withStandInGroup(scene, () => [reset]);
      const resets = createMaterialCacheResets();
      await installRuntimeBuildState(scene);
      const before = group.builds();

      await rebuildRenderables(scene, resets);

      expect([...resets.found]).toEqual([reset]);
      expect(group.builds() - before).toBe(1);
      expect(resets.unconfirmed).toBe(false);
    } finally {
      discard(scene);
    }
  });

  it("confirms a family first built during a rebuild with one more rebuild, and keeps its one-off disposers out", async () => {
    const { scene } = createHeadlessScene();
    const reset = vi.fn();
    const oneOff = vi.fn();
    try {
      // The builder's first build also registers a one-off disposer, as Lite's lights buffer does.
      const group = withStandInGroup(scene, (build) => (build === 1 ? [oneOff, reset] : [reset]));
      const resets = createMaterialCacheResets();

      await rebuildRenderables(scene, resets);

      expect(group.builds()).toBe(2);
      expect([...resets.found]).toEqual([reset]);
      expect(resets.unconfirmed).toBe(false);
    } finally {
      discard(scene);
    }
  });

  it("never rebuilds more than twice for one call, whatever a builder pushes", async () => {
    const { scene } = createHeadlessScene();
    try {
      const group = withStandInGroup(scene, () => [(): void => undefined]);
      const resets = createMaterialCacheResets();

      await rebuildRenderables(scene, resets);
      expect(group.builds()).toBe(2);
      expect(resets.found.size).toBe(0);
    } finally {
      discard(scene);
    }
  });

  it("flags a reset Lite registered on its own until the next rebuild confirms it", async () => {
    const { scene } = createHeadlessScene();
    const reset = vi.fn();
    try {
      await installRuntimeBuildState(scene);
      const group = withStandInGroup(scene, () => [reset]);
      const resets = createMaterialCacheResets();
      const before = group.builds();
      trackMaterialCacheResets(scene, resets);

      // A runtime build of the first mesh of a family, outside any ignifx rebuild.
      // oxlint-disable-next-line no-underscore-dangle
      buildable(scene)._disposables.push(reset);
      expect(resets.unconfirmed).toBe(true);
      expect(resets.found.size).toBe(0);

      await rebuildRenderables(scene, resets);

      expect([...resets.found]).toEqual([reset]);
      expect(resets.unconfirmed).toBe(false);
      expect(group.builds() - before).toBe(1);
    } finally {
      discard(scene);
    }
  });

  it("learns after registration only when registration built something new", async () => {
    const { scene } = createHeadlessScene();
    const reset = vi.fn();
    try {
      await installRuntimeBuildState(scene);
      const group = withStandInGroup(scene, () => [reset]);
      const resets = createMaterialCacheResets();
      const before = group.builds();
      trackMaterialCacheResets(scene, resets);
      await learnMaterialCacheResets(scene, resets);
      expect(group.builds()).toBe(before);

      // What `registerScene`'s first build of the group pushes.
      // oxlint-disable-next-line no-underscore-dangle
      buildable(scene)._disposables.push(reset);
      await learnMaterialCacheResets(scene, resets);

      expect(group.builds() - before).toBe(1);
      expect([...resets.found]).toEqual([reset]);
    } finally {
      discard(scene);
    }
  });

  it("installs its recorder once, however often it is asked", () => {
    const { scene } = createHeadlessScene();
    try {
      const first = createMaterialCacheResets();
      const second = createMaterialCacheResets();
      trackMaterialCacheResets(scene, first);
      trackMaterialCacheResets(scene, second);

      // oxlint-disable-next-line no-underscore-dangle
      buildable(scene)._disposables.push(vi.fn());

      expect(first.unconfirmed).toBe(true);
      expect(second.unconfirmed).toBe(false);
    } finally {
      discard(scene);
    }
  });

  it("calls every recorded reset when the layouts must be forgotten", async () => {
    const { scene } = createHeadlessScene();
    const reset = vi.fn();
    try {
      withStandInGroup(scene, () => [reset]);
      const resets = createMaterialCacheResets();
      await rebuildRenderables(scene, resets);
      reset.mockClear();

      forgetMaterialBindingLayouts(resets);

      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      discard(scene);
    }
  });
});

describe("a material swap that lands in a rebuild", () => {
  /**
   * Gives the stand-in mesh a builder that throws on its first `failures` builds, after running
   * `during` — what a group builder does when the mesh changed family while it awaited.
   *
   * @param scene - The headless scene.
   * @param failures - How many builds throw.
   * @param during - What happens to the mesh before each throwing build throws.
   * @returns The mesh, and a second family's material to swap it to.
   */
  function withFailingGroup(
    scene: SceneContext,
    failures: number,
    during: (mesh: { material: unknown }, other: unknown, own: unknown) => void,
  ): { readonly builds: () => number } {
    const other = {
      _buildGroup: (): Promise<unknown> =>
        Promise.resolve({ renderables: [], rebuildSingle: (): undefined => undefined }),
    };
    let builds = 0;
    const own: { _buildGroup?: unknown } = {};
    const mesh: { material: unknown } = { material: own };
    // oxlint-disable-next-line no-underscore-dangle
    own._buildGroup = (): Promise<unknown> => {
      builds += 1;
      if (builds <= failures) {
        during(mesh, other, own);
        return Promise.reject(new TypeError("Cannot read properties of undefined (reading '0')"));
      }
      return Promise.resolve({ renderables: [], rebuildSingle: (): undefined => undefined });
    };
    const target = buildable(scene);
    target.meshes.push(mesh);
    // oxlint-disable-next-line no-underscore-dangle
    target._groups.set(own._buildGroup, [mesh]);
    // oxlint-disable-next-line no-underscore-dangle
    target._built = true;
    return { builds: (): number => builds };
  }

  it("starts the rebuild over when the mesh changed family meanwhile", async () => {
    const { scene } = createHeadlessScene();
    try {
      withFailingGroup(scene, 1, (mesh, other) => {
        mesh.material = other;
      });
      const resets = createMaterialCacheResets();
      await expect(rebuildRenderables(scene, resets)).resolves.toBeUndefined();
      expect(resets.retries).toBe(1);
    } finally {
      discard(scene);
    }
  });

  it("starts over without a record of resets too", async () => {
    const { scene } = createHeadlessScene();
    try {
      withFailingGroup(scene, 1, (mesh, other) => {
        mesh.material = other;
      });
      await expect(rebuildRenderables(scene)).resolves.toBeUndefined();
    } finally {
      discard(scene);
    }
  });

  it("rethrows a failure with every material unchanged", async () => {
    const { scene } = createHeadlessScene();
    try {
      const group = withFailingGroup(scene, 1, () => undefined);
      const resets = createMaterialCacheResets();
      await expect(rebuildRenderables(scene, resets)).rejects.toThrow(TypeError);
      expect(resets.retries).toBe(0);
      expect(group.builds()).toBe(1);
    } finally {
      discard(scene);
    }
  });

  it("gives up after two restarts", async () => {
    const { scene } = createHeadlessScene();
    try {
      // Each build leaves the mesh on a fresh material of its own family, so every attempt sees a swap.
      withFailingGroup(scene, Number.POSITIVE_INFINITY, (mesh, _other, own) => {
        mesh.material = { ...(own as object) };
      });
      const resets = createMaterialCacheResets();
      await expect(rebuildRenderables(scene, resets)).rejects.toThrow(TypeError);
      expect(resets.retries).toBe(2);
    } finally {
      discard(scene);
    }
  });
});

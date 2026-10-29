import { Camera, MeshRenderer, Quat } from "@ignifx/core";
import { describe, expect, it, vi } from "vitest";
import { AnimatorAsset } from "../src/animator/animator-asset.js";
import { Animator } from "../src/animator/animator.js";
import { ANIMATOR_ASSET_TYPE } from "../src/animator/definition.js";
import { Billboard } from "../src/environment/billboard.js";
import { LOD_CULLED, LodGroup } from "../src/environment/lod-group.js";
import { NavMeshSurface } from "../src/navigation/nav-mesh-surface.js";
import { heroAnimator } from "./support/animator-fixture.js";
import { floorGeometry } from "./support/geometry.js";
import { createThreeDApp } from "./support/harness.js";

/**
 * `@ignifx/3d` in an edit-mode app (ADR-0028): animators and billboards stand still, level of
 * detail switches for display only, and navigation neither bakes nor steps.
 */

describe("the 3D toolkit in an edit-mode app", () => {
  it("does not advance an Animator, even one that updates while paused", async () => {
    const harness = await createThreeDApp({ editMode: true });
    const asset = new AnimatorAsset("memory:hero.animator.json", heroAnimator());
    const handle = harness.app.assets.register(asset, { type: ANIMATOR_ASSET_TYPE }).retain();
    const animator = harness.world.createEntity("Hero").addComponent(Animator, { animator: handle });
    const opted = harness.world
      .createEntity("Opted")
      .addComponent(Animator, { animator: handle, updateWhenPaused: true });
    const entered: string[] = [];
    animator.onStateEntered.connect((name) => entered.push(name));

    harness.stepMany(30);

    expect(animator.normalizedTime()).toBe(0);
    expect(opted.normalizedTime()).toBe(0);
    expect(entered).toEqual([]);
    handle.release();
    harness.dispose();
  });

  it("leaves a billboard's authored rotation alone", async () => {
    const harness = await createThreeDApp({ editMode: true });
    harness.world.createEntity("Camera").addComponent(Camera);
    const sign = harness.world.createEntity("Sign", { position: { x: 10, y: 0, z: 0 } });
    const authored = Quat.fromEulerDegrees(0, 45, 0);
    sign.transform.rotation = authored;
    sign.addComponent(Billboard);

    harness.stepMany(5);

    const rotation = sign.transform.rotation;
    expect(rotation.y).toBeCloseTo(authored.y, 6);
    expect(rotation.w).toBeCloseTo(authored.w, 6);
    harness.dispose();
  });

  it("does not bake a surface that asks to bake on awake", async () => {
    const harness = await createThreeDApp({ editMode: true });
    const surface = harness.world.createEntity("Level").addComponent(NavMeshSurface, { bakeOnAwake: true });
    const floor = floorGeometry(10);
    surface.addSource(floor.positions, floor.indices, null);

    harness.stepMany(10);

    expect(surface.isBaking).toBe(false);
    expect(surface.isBaked).toBe(false);
    harness.dispose();
  });

  it("shows one LodGroup level for display while leaving every authored enabled alone", async () => {
    const harness = await createThreeDApp({ editMode: true });
    const camera = harness.world.createEntity("EditorCamera").addComponent(Camera, { priority: 1_000_000 });
    const tree = harness.world.createEntity("Tree", { position: { x: 5, y: 0, z: 0 } });
    const near = tree.addComponent(MeshRenderer);
    const far = harness.world.createEntity("TreeFar", { parent: tree }).addComponent(MeshRenderer);
    const group = tree.addComponent(LodGroup, {
      levels: [
        { distance: 10, renderer: near },
        { distance: 30, renderer: far },
      ],
      hysteresis: 0,
    });

    // The editor camera's distance picks the level, as in a game, but only `displayHidden` moves.
    const shown: [number, boolean, boolean][] = [];
    for (const x of [0, 20, 100, 0]) {
      camera.entity.transform.position = { x, y: 0, z: 0 };
      harness.step();
      expect([near.enabled, far.enabled]).toEqual([true, true]);
      shown.push([group.level, near.displayHidden, far.displayHidden]);
    }
    expect(shown).toEqual([
      [0, false, true],
      [1, true, false],
      [LOD_CULLED, true, true],
      [0, false, true],
    ]);

    // While the level stays the same the group writes nothing.
    const writes = vi.spyOn(far, "displayHidden", "set");
    harness.stepMany(3);
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();

    // A disabled group shows every level again, and a re-enabled one picks up where it was.
    group.enabled = false;
    harness.step();
    expect([near.displayHidden, far.displayHidden]).toEqual([false, false]);
    group.enabled = true;
    harness.step();
    expect([near.displayHidden, far.displayHidden]).toEqual([false, true]);

    // A renderer dropped from the level list is shown again.
    group.levels = [{ distance: 10, renderer: far }];
    camera.entity.transform.position = { x: 100, y: 0, z: 0 };
    harness.step();
    expect([near.displayHidden, far.displayHidden]).toEqual([false, true]);

    group.destroy();
    harness.step();
    expect([near.enabled, far.enabled]).toEqual([true, true]);
    expect([near.displayHidden, far.displayHidden]).toEqual([false, false]);
    harness.dispose();
  });

  it("shows a level dropped from the list again while the shown level stays the same", async () => {
    const harness = await createThreeDApp({ editMode: true });
    harness.world.createEntity("EditorCamera").addComponent(Camera, { priority: 1_000_000 });
    const tree = harness.world.createEntity("Tree");
    const near = tree.addComponent(MeshRenderer);
    const mid = harness.world.createEntity("TreeMid", { parent: tree }).addComponent(MeshRenderer);
    const far = harness.world.createEntity("TreeFar", { parent: tree }).addComponent(MeshRenderer);
    const group = tree.addComponent(LodGroup, {
      levels: [
        { distance: 10, renderer: near },
        { distance: 20, renderer: mid },
        { distance: 30, renderer: far },
      ],
      hysteresis: 0,
    });
    harness.step();
    expect([group.level, near.displayHidden, mid.displayHidden, far.displayHidden]).toEqual([0, false, true, true]);

    // Only the list changes: the camera has not moved, so `near` is still the level shown.
    group.levels = [
      { distance: 10, renderer: near },
      { distance: 20, renderer: mid },
    ];
    harness.step();

    expect([group.level, near.displayHidden, mid.displayHidden, far.displayHidden]).toEqual([0, false, true, false]);
    harness.dispose();
  });
});

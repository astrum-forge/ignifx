import { afterEach, describe, expect, it } from "vitest";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { createAssetHarness } from "../assets/support/harness.js";
import { Everything, Tagger, buildFile, entityRecord } from "./fixtures.js";
import type { Entity } from "../../src/entity/entity.js";
import type { SceneInstance } from "../../src/scene/scene-instance.js";
import type { SceneFile } from "../../src/serialization/scene-file.js";
import type { AssetHarness } from "../assets/support/harness.js";

/**
 * `world.instantiate` → `serializeScene` → load → save again: the reloaded world must be the
 * world that was saved, not only the same text (`06-serialization-and-scene-format.md` §2, §5).
 */

const CRATE = "prefabs/crate.prefab.json";
const PAIR = "prefabs/pair.prefab.json";
const VARIANT = "prefabs/big-crate.prefab.json";
const YARD = "prefabs/yard.prefab.json";
const LEVEL = "levels/level.scene.json";

/** One root, offset from the origin, with one component. */
const crateFile: SceneFile = buildFile({
  name: "Crate",
  entities: [
    entityRecord({
      uid: "P-ROOT",
      name: "Crate",
      transform: { position: [0, 0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "P-TAG", type: "test/Tagger", props: { note: "crate" } }],
    }),
  ],
});

/** Two roots, each with one component; the first is offset. */
const pairFile: SceneFile = buildFile({
  name: "Pair",
  entities: [
    entityRecord({
      uid: "A",
      name: "Left",
      transform: { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "A-TAG", type: "test/Tagger", props: { note: "left" } }],
    }),
    entityRecord({ uid: "B", name: "Right", components: [{ uid: "B-TAG", type: "test/Tagger" }] }),
  ],
});

/** A variant: its single root instances the crate, overrides it, and adds a component. */
const variantFile: SceneFile = buildFile({
  name: "Big Crate",
  entities: [
    entityRecord({
      uid: "V-ROOT",
      name: "Big Crate",
      instance: {
        scene: { $asset: CRATE },
        overrides: [{ path: "P-ROOT/components/P-TAG/props/note", value: "big" }],
      },
      components: [{ uid: "V-EXTRA", type: "test/Everything", props: { speed: 4 } }],
    }),
  ],
});

/** A prefab with a crate instanced below its root. */
const yardFile: SceneFile = buildFile({
  name: "Yard",
  entities: [
    entityRecord({ uid: "Y-ROOT", name: "Yard" }),
    entityRecord({ uid: "Y-SLOT", name: "Slot", parent: "Y-ROOT", instance: { scene: { $asset: CRATE } } }),
  ],
});

let harnesses: AssetHarness[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses = [];
});

/** A headless app serving the given files. */
async function sceneApp(files: Readonly<Record<string, SceneFile | string>>): Promise<AssetHarness> {
  const harness = await createAssetHarness();
  harnesses.push(harness);
  harness.app.registerComponents([Everything, Tagger]);
  for (const [address, file] of Object.entries(files)) {
    const text = typeof file === "string" ? file : stringifySceneFile(file);
    harness.net.canned.set(harness.app.assets.resolveUrl(address), text);
  }
  return harness;
}

/** Drives the fake network until a promise settles, then answers with its value. */
async function settled<T>(harness: AssetHarness, work: Promise<T>): Promise<T> {
  const state = { done: false };
  const finish = (): void => {
    state.done = true;
  };
  void work.then(finish, finish);
  for (let index = 0; index < 200 && !state.done; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each frame delivers the next response
    await harness.settle();
  }
  return work;
}

/** Saves a scene instance as canonical text. */
function save(instance: SceneInstance): string {
  return stringifySceneFile(serializeScene(instance, { engineVersion: null, name: "Level" }));
}

/** Loads saved text into a fresh app and answers with the loaded instance and the app's text. */
async function reload(text: string): Promise<{ readonly instance: SceneInstance; readonly again: string }> {
  const harness = await sceneApp({
    [CRATE]: crateFile,
    [PAIR]: pairFile,
    [VARIANT]: variantFile,
    [YARD]: yardFile,
    [LEVEL]: text,
  });
  const instance = await settled(harness, harness.app.world.loadScene(LEVEL));
  return { instance, again: save(instance) };
}

/** The entity's world position, as a plain array. */
function worldPosition(entity: Entity | undefined): number[] {
  const position = entity?.transform.position;
  return position === undefined ? [] : [position.x, position.y, position.z];
}

describe("instantiate, save, and load", () => {
  it("restores a single-root prefab as one entity with its component once and its offset once", async () => {
    const first = await sceneApp({ [CRATE]: crateFile });
    const crate = await settled(
      first,
      first.app.world.instantiateAsync(CRATE, { name: "Crate 0", position: { x: 3, y: 0.5, z: 0 } }),
    );
    const text = save(first.app.world.activeScene);

    const { instance, again } = await reload(text);
    expect(instance.roots.map((root) => root.name)).toEqual(["Crate 0"]);
    const loaded = instance.roots[0];
    expect(loaded?.children).toHaveLength(0);
    expect(loaded?.getComponents(Tagger)).toHaveLength(1);
    expect(loaded?.getComponent(Tagger)?.note).toBe("crate");
    expect(worldPosition(loaded)).toEqual(worldPosition(crate));
    expect(worldPosition(loaded)).toEqual([3, 0.5, 0]);
    expect(loaded?.prefab?.address).toBe(CRATE);
    expect(loaded?.prefab?.instanceRoot).toBe(loaded);
    expect(again).toBe(text);
  });

  it("restores a multi-root prefab under one container, each root's component once", async () => {
    const first = await sceneApp({ [PAIR]: pairFile });
    await settled(first, first.app.world.instantiateAsync(PAIR, { position: { x: 3, y: 0, z: 0 } }));
    const text = save(first.app.world.activeScene);

    const { instance, again } = await reload(text);
    expect(instance.roots.map((root) => root.name)).toEqual(["Pair"]);
    const container = instance.roots[0];
    expect(container?.getComponents(Tagger)).toHaveLength(0);
    expect(worldPosition(container)).toEqual([3, 0, 0]);
    expect(container?.children.map((child) => child.name)).toEqual(["Left", "Right"]);
    expect(container?.children.map((child) => child.getComponents(Tagger).length)).toEqual([1, 1]);
    expect(worldPosition(container?.children[0])).toEqual([4, 0, 0]);
    expect(container?.children[0]?.prefab?.instanceRoot).toBe(container);
    expect(again).toBe(text);
  });

  it("writes run-time edits to a single-root instance as overrides and restores them once", async () => {
    const first = await sceneApp({ [CRATE]: crateFile });
    const crate = await settled(first, first.app.world.instantiateAsync(CRATE, { position: { x: 3, y: 0.5, z: 0 } }));
    const tag = crate.getComponent(Tagger);
    if (tag !== null) {
      tag.note = "edited";
    }
    crate.addComponent(Everything, { speed: 9 });
    const file = serializeScene(first.app.world.activeScene, { engineVersion: null, name: "Level" });
    const entry = file.entities[0];
    expect(file.entities).toHaveLength(1);
    expect(entry?.instance?.overrides).toEqual([{ path: "P-ROOT/components/P-TAG/props/note", value: "edited" }]);
    expect(entry?.components?.map((component) => component.type)).toEqual(["test/Everything"]);
    const text = stringifySceneFile(file);

    const { instance, again } = await reload(text);
    const loaded = instance.roots[0];
    expect(loaded?.children).toHaveLength(0);
    expect(loaded?.getComponents(Tagger).map((component) => component.note)).toEqual(["edited"]);
    expect(loaded?.getComponents(Everything).map((component) => component.speed)).toEqual([9]);
    expect(worldPosition(loaded)).toEqual([3, 0.5, 0]);
    expect(again).toBe(text);
  });

  it("writes a component removed from a single-root instance as a remove override", async () => {
    const first = await sceneApp({ [CRATE]: crateFile });
    const crate = await settled(first, first.app.world.instantiateAsync(CRATE));
    const tag = crate.getComponent(Tagger);
    if (tag !== null) {
      crate.removeComponent(tag);
    }
    await first.settle();
    const file = serializeScene(first.app.world.activeScene, { engineVersion: null, name: "Level" });
    expect(file.entities[0]?.instance?.overrides).toEqual([{ op: "remove", path: "P-ROOT/components/P-TAG" }]);
    expect(file.entities[0]?.components).toBeUndefined();

    const { instance, again } = await reload(stringifySceneFile(file));
    expect(instance.roots[0]?.getComponents(Tagger)).toHaveLength(0);
    expect(again).toBe(stringifySceneFile(file));
  });

  it("loads a hand-written single-root instance entry as that root, with its overrides", async () => {
    const level = buildFile({
      name: "Level",
      entities: [
        entityRecord({
          uid: "L-CRATE",
          name: "Crate 7",
          transform: { position: [7, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          instance: {
            scene: { $asset: CRATE },
            overrides: [{ path: "P-ROOT/components/P-TAG/props/note", value: "seven" }],
          },
          components: [{ uid: "L-EXTRA", type: "test/Everything", props: { speed: 2 } }],
        }),
      ],
    });
    const { instance } = await reload(stringifySceneFile(level));
    expect(instance.roots.map((root) => root.name)).toEqual(["Crate 7"]);
    const loaded = instance.roots[0];
    expect(loaded?.uid).toBe("L-CRATE");
    expect(loaded?.children).toHaveLength(0);
    expect(loaded?.getComponents(Tagger).map((component) => component.note)).toEqual(["seven"]);
    expect(loaded?.getComponents(Everything).map((component) => component.speed)).toEqual([2]);
    expect(worldPosition(loaded)).toEqual([7, 0, 0]);
  });

  it("restores a variant whose root instances another prefab with every component once", async () => {
    const first = await sceneApp({ [CRATE]: crateFile, [VARIANT]: variantFile });
    const crate = await settled(first, first.app.world.instantiateAsync(VARIANT, { position: { x: 2, y: 0, z: 0 } }));
    expect(crate.getComponents(Tagger).map((component) => component.note)).toEqual(["big"]);
    const text = save(first.app.world.activeScene);

    const { instance, again } = await reload(text);
    const loaded = instance.roots[0];
    expect(loaded?.children).toHaveLength(0);
    expect(loaded?.getComponents(Tagger).map((component) => component.note)).toEqual(["big"]);
    expect(loaded?.getComponents(Everything).map((component) => component.speed)).toEqual([4]);
    expect(worldPosition(loaded)).toEqual([2, 0, 0]);
    expect(loaded?.prefab?.address).toBe(VARIANT);
    expect(again).toBe(text);
  });

  it("keeps edits to a single-root instance nested inside another prefab", async () => {
    const first = await sceneApp({ [CRATE]: crateFile, [YARD]: yardFile });
    const yard = await settled(first, first.app.world.instantiateAsync(YARD));
    const slot = yard.children[0];
    expect(slot?.getComponents(Tagger)).toHaveLength(1);
    if (slot !== undefined) {
      slot.name = "Moved";
      slot.transform.localPosition.set(5, 0, 0);
    }
    const file = serializeScene(first.app.world.activeScene, { engineVersion: null, name: "Level" });
    expect(file.entities[0]?.instance?.overrides).toEqual([
      { path: "Y-SLOT/name", value: "Moved" },
      { path: "Y-SLOT/transform/position", value: [5, 0, 0] },
    ]);
    const text = stringifySceneFile(file);

    const { instance, again } = await reload(text);
    const moved = instance.roots[0]?.children[0];
    expect(moved?.name).toBe("Moved");
    expect(moved?.getComponents(Tagger)).toHaveLength(1);
    expect(worldPosition(moved)).toEqual([5, 0, 0]);
    expect(again).toBe(text);
  });
});

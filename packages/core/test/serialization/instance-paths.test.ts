import { afterEach, describe, expect, it } from "vitest";
import { instantiateScene } from "../../src/serialization/load.js";
import { applyOverridesToAsset } from "../../src/serialization/prefab-overrides.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { Everything, Tagger, buildFile, createSerializationWorld, entityRecord, fakeHandle } from "./fixtures.js";
import type { SceneAsset } from "../../src/serialization/scene-asset.js";
import type { SceneFile } from "../../src/serialization/scene-file.js";
import type { TestWorld } from "../support/create-test-world.js";

/** References into prefab instances: `{ "$entity": "<instanceRootUid>/<uidInThePrefab>" }`. */

const ENEMY = "prefabs/enemy.prefab.json";
const SQUAD = "prefabs/squad.prefab.json";

let worlds: TestWorld[] = [];

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

/** Root R aims at its own child C, whose Tagger is T. */
async function enemy(): Promise<SceneAsset> {
  return createSceneAsset(
    ENEMY,
    buildFile({
      entities: [
        entityRecord({
          uid: "R",
          components: [{ uid: "AI", type: "test/Everything", props: { target: { $entity: "C" } } }],
        }),
        entityRecord({
          uid: "C",
          name: "Weapon",
          parent: "R",
          components: [
            { uid: "T", type: "test/Tagger" },
            { uid: "BACK", type: "test/Everything", props: { target: { $entity: "R" } } },
          ],
        }),
      ],
    }),
  );
}

/** A squad prefab: root Q aims at the weapon of the enemy instance N it holds. */
async function squad(inner: SceneAsset): Promise<SceneAsset> {
  return createSceneAsset(
    SQUAD,
    buildFile({
      entities: [
        entityRecord({
          uid: "Q",
          components: [{ uid: "QAI", type: "test/Everything", props: { target: { $entity: "N/C" } } }],
        }),
        entityRecord({ uid: "N", parent: "Q", instance: { scene: { $asset: ENEMY }, hash: inner.hash } }),
      ],
    }),
    [fakeHandle(ENEMY, inner)],
  );
}

/** A level holding an instance `L` and an entity `S` whose Everything props are `props`. */
async function level(prefab: SceneAsset, props: Record<string, { $entity: string } | { $component: string }>) {
  const file: SceneFile = buildFile({
    entities: [
      entityRecord({ uid: "L", instance: { scene: { $asset: prefab.address }, hash: prefab.hash } }),
      entityRecord({ uid: "S", components: [{ uid: "SAI", type: "test/Everything", props }] }),
    ],
  });
  const asset = await createSceneAsset("levels/level.scene.json", file, [fakeHandle(prefab.address, prefab)]);
  const harness = createSerializationWorld();
  worlds.push(harness);
  const built = instantiateScene(harness.world, asset);
  return { built, harness };
}

describe("instance paths", () => {
  it("resolve a scene's reference into an instance and are written back the same way", async () => {
    const { built, harness } = await level(await enemy(), {
      target: { $entity: "L/C" },
      follow: { $component: "L/T" },
    });
    expect(built.issues).toEqual([]);
    const weapon = built.remap.entity("L")?.children[0];
    const ai = built.remap.entity("S")?.getComponent(Everything);
    expect(weapon?.name).toBe("Weapon");
    expect(ai?.target).toBe(weapon);
    expect(ai?.follow).toBe(weapon?.getComponent(Tagger));

    const file = serializeScene(harness.world.activeScene);
    const [instance, scene] = file.entities;
    // The prefab's own reference to its child compares equal, so it is no override.
    expect(instance?.instance?.overrides).toBeUndefined();
    expect(scene?.components?.[0]?.props?.["target"]).toEqual({ $entity: "L/C" });
    expect(scene?.components?.[0]?.props?.["follow"]).toEqual({ $component: "L/T" });
  });

  it("walk into nested instances and keep working inside an instanced prefab", async () => {
    const { built, harness } = await level(await squad(await enemy()), {
      target: { $entity: "L/N/C" },
      follow: { $component: "L/N/T" },
    });
    expect(built.issues).toEqual([]);
    const weapon = built.remap.entity("L")?.children[0]?.children[0];
    expect(weapon?.name).toBe("Weapon");
    expect(built.remap.entity("L")?.getComponent(Everything)?.target).toBe(weapon);
    expect(built.remap.entity("S")?.getComponent(Everything)?.target).toBe(weapon);
    expect(built.remap.entity("S")?.getComponent(Everything)?.follow).toBe(weapon?.getComponent(Tagger));

    const file = serializeScene(harness.world.activeScene);
    expect(file.entities[0]?.instance?.overrides).toBeUndefined();
    expect(file.entities[1]?.components?.[0]?.props?.["target"]).toEqual({ $entity: "L/N/C" });
  });

  it("resolve inside a prefab instantiated on its own", async () => {
    const harness = createSerializationWorld();
    worlds.push(harness);
    const built = instantiateScene(harness.world, await squad(await enemy()), { asInstance: true });
    expect(built.issues).toEqual([]);
    const root = built.roots[0];
    expect(root?.getComponent(Everything)?.target).toBe(root?.children[0]?.children[0]);
  });

  it("still report a path that names nothing", async () => {
    const { built } = await level(await enemy(), { target: { $entity: "L/NOPE" } });
    expect(built.issues.map((issue) => issue.code)).toEqual(["IGX-0602"]);
  });

  it("leave the instance root's own components alone when no path selects them", async () => {
    const file = buildFile({ entities: [entityRecord({ uid: "A" }), entityRecord({ uid: "B" })] });
    const own = { uid: "OWN", type: "test/Tagger" };
    const result = await applyOverridesToAsset({ scene: { $asset: ENEMY } }, file, {
      paths: ["A"],
      rootComponents: [own],
    });
    expect(result.rootComponents).toEqual([own]);
    expect(result.skippedComponents).toEqual([]);
  });
});

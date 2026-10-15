import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { Everything, Tagger, buildFile, createSerializationWorld, entityRecord, fakeHandle } from "./fixtures.js";
import type { SceneAsset } from "../../src/serialization/scene-asset.js";
import type { SceneFileEntity } from "../../src/serialization/scene-file.js";
import type { TestWorld } from "../support/create-test-world.js";

/** Instanced scenes — prefabs (ADR-0005) — and the override machinery of `06` §2 and §4. */

let worlds: TestWorld[] = [];

function world(): TestWorld {
  const harness = createSerializationWorld();
  worlds.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

/** The prefab every test in this file instances: a root with two components and one child. */
async function enemyPrefab(): Promise<SceneAsset> {
  return createSceneAsset(
    "prefabs/enemy.prefab.json",
    buildFile({
      name: "Enemy",
      entities: [
        entityRecord({
          uid: "P-ROOT",
          name: "Enemy",
          components: [
            { uid: "P-AI", type: "test/Everything", props: { speed: 3, label: "calm" } },
            { uid: "P-DEBUG", type: "test/Tagger", props: { note: "debug" } },
          ],
        }),
        entityRecord({ uid: "P-CHILD", name: "Weapon", parent: "P-ROOT" }),
      ],
    }),
  );
}

/** A level that instances the prefab once, with the overrides the caller supplies. */
async function levelInstancing(
  prefab: SceneAsset,
  instance: NonNullable<SceneFileEntity["instance"]>,
): Promise<SceneAsset> {
  return createSceneAsset(
    "levels/level.scene.json",
    buildFile({
      name: "Level",
      entities: [entityRecord({ uid: "L-SPAWN", name: "Enemy_01", instance })],
    }),
    [fakeHandle("prefabs/enemy.prefab.json", prefab)],
  );
}

describe("instance expansion", () => {
  it("merges a single-root scene into the instance root, with fresh uids below it", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, { scene: { $asset: prefab.address }, hash: prefab.hash });
    const harness = world();
    const built = instantiateScene(harness.world, level);
    expect(built.issues).toEqual([]);
    const spawn = built.roots[0];
    expect(spawn?.name).toBe("Enemy_01");
    expect(spawn?.uid).toBe("L-SPAWN");
    expect(spawn?.children.map((child) => child.name)).toEqual(["Weapon"]);
    expect(spawn?.children[0]?.uid).not.toBe("P-CHILD");
    expect(spawn?.getComponent(Everything)?.speed).toBe(3);
    expect(spawn?.getComponents(Tagger)).toHaveLength(1);
  });

  it("expands a multi-root scene under the instance root, which stays a container", async () => {
    const pair = await createSceneAsset(
      "prefabs/pair.prefab.json",
      buildFile({
        name: "Pair",
        entities: [
          entityRecord({ uid: "A", name: "Left", components: [{ uid: "A-TAG", type: "test/Tagger" }] }),
          entityRecord({ uid: "B", name: "Right" }),
        ],
      }),
    );
    const level = await createSceneAsset(
      "levels/pair.scene.json",
      buildFile({
        entities: [entityRecord({ uid: "L", name: "Pair_01", instance: { scene: { $asset: pair.address } } })],
      }),
      [fakeHandle(pair.address, pair)],
    );
    const harness = world();
    const spawn = instantiateScene(harness.world, level).roots[0];
    expect(spawn?.getComponents(Tagger)).toHaveLength(0);
    expect(spawn?.children.map((child) => child.name)).toEqual(["Left", "Right"]);
    expect(spawn?.children[0]?.uid).not.toBe("A");
    expect(spawn?.children[0]?.getComponents(Tagger)).toHaveLength(1);
    expect(spawn?.children[0]?.prefab?.instanceRoot).toBe(spawn);
  });

  it("gives each instance of one prefab its own uids", async () => {
    const prefab = await enemyPrefab();
    const level = await createSceneAsset(
      "levels/two.scene.json",
      buildFile({
        entities: [
          entityRecord({ uid: "A", name: "A", instance: { scene: { $asset: prefab.address } } }),
          entityRecord({ uid: "B", name: "B", instance: { scene: { $asset: prefab.address } } }),
        ],
      }),
      [fakeHandle(prefab.address, prefab)],
    );
    const harness = world();
    const built = instantiateScene(harness.world, level);
    const first = built.roots[0]?.children[0];
    const second = built.roots[1]?.children[0];
    expect(first?.uid).not.toBe(second?.uid);
    expect(harness.world.findAllByName("Weapon")).toHaveLength(2);
  });

  it("sets Entity.prefab on the instance root and on every instanced entity", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, { scene: { $asset: prefab.address } });
    const harness = world();
    const built = instantiateScene(harness.world, level);
    const spawn = built.roots[0];
    const weapon = spawn?.children[0];
    expect(spawn?.prefab?.address).toBe(prefab.address);
    expect(spawn?.prefab?.instanceRoot).toBe(spawn);
    expect(weapon?.prefab?.instanceRoot).toBe(spawn);
    expect(spawn?.prefab?.asset?.address).toBe(prefab.address);
  });

  it("applies replace, remove, and add overrides in order", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, {
      scene: { $asset: prefab.address },
      overrides: [
        { path: "P-ROOT/components/P-AI/props/speed", value: 9 },
        { path: "P-ROOT/name", value: "Boss" },
        { op: "remove", path: "P-ROOT/components/P-DEBUG" },
        {
          op: "add",
          path: "P-ROOT/components",
          value: { uid: "P-LOOT", type: "test/Tagger", props: { note: "loot" } },
        },
      ],
    });
    const harness = world();
    const enemy = instantiateScene(harness.world, level).roots[0];
    expect(enemy?.name).toBe("Boss");
    expect(enemy?.getComponent(Everything)?.speed).toBe(9);
    expect(enemy?.getComponent(Tagger)?.note).toBe("loot");
    expect(enemy?.getComponents(Tagger)).toHaveLength(1);
  });

  it("patches transforms, tags, layer, active and static through overrides", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, {
      scene: { $asset: prefab.address },
      overrides: [
        { path: "P-CHILD/transform/position", value: [1, 2, 3] },
        { path: "P-ROOT/tags", value: ["boss"] },
        { path: "P-ROOT/layer", value: "Enemy" },
        { path: "P-ROOT/static", value: true },
        { path: "P-CHILD/active", value: false },
      ],
    });
    const harness = world();
    const enemy = instantiateScene(harness.world, level).roots[0];
    const weapon = enemy?.children[0];
    expect(weapon?.transform.localPosition.x).toBe(1);
    expect([...(enemy?.tags.values() ?? [])]).toEqual(["boss"]);
    expect(enemy?.layer).toBe(harness.world.layers.indexOf("Enemy"));
    expect(enemy?.isStatic).toBe(true);
    expect(weapon?.active).toBe(false);
  });

  it("reports an override that names nothing without failing the load", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, {
      scene: { $asset: prefab.address },
      overrides: [{ path: "P-GHOST/name", value: "x" }],
    });
    const harness = world();
    const built = instantiateScene(harness.world, level);
    expect(built.issues[0]?.code).toBe(CoreErrorCode.instanceHashMismatch);
    expect(built.roots[0]?.name).toBe("Enemy_01");
  });

  it("nests instances to any depth", async () => {
    const prefab = await enemyPrefab();
    const squad = await createSceneAsset(
      "prefabs/squad.prefab.json",
      buildFile({
        name: "Squad",
        entities: [
          entityRecord({ uid: "S-ROOT", name: "Squad" }),
          entityRecord({
            uid: "S-A",
            name: "Slot",
            parent: "S-ROOT",
            instance: { scene: { $asset: prefab.address }, overrides: [{ path: "P-ROOT/name", value: "Grunt" }] },
          }),
        ],
      }),
      [fakeHandle(prefab.address, prefab)],
    );
    const level = await createSceneAsset(
      "levels/deep.scene.json",
      buildFile({ entities: [entityRecord({ uid: "L", name: "L", instance: { scene: { $asset: squad.address } } })] }),
      [fakeHandle(squad.address, squad)],
    );
    const harness = world();
    const built = instantiateScene(harness.world, level);
    expect(built.issues).toEqual([]);
    const grunt = harness.world.findByName("Grunt");
    expect(grunt).not.toBeNull();
    expect(grunt?.root()).toBe(built.roots[0]);
    expect(grunt?.prefab?.address).toBe(prefab.address);
  });

  it("rejects a scene that instances itself", async () => {
    const file = buildFile({
      entities: [entityRecord({ uid: "R", name: "R", instance: { scene: { $asset: "loop.scene.json" } } })],
    });
    const placeholder = await createSceneAsset("loop.scene.json", file);
    const looping = await createSceneAsset("loop.scene.json", file, [fakeHandle("loop.scene.json", placeholder)]);
    const harness = world();
    expect(() => instantiateScene(harness.world, looping)).toThrow(/nest the scene inside itself/u);
    try {
      instantiateScene(harness.world, looping);
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.sceneInstanceCycle);
    }
  });

  it("rejects an indirect instance cycle", async () => {
    const inner = await createSceneAsset(
      "b.scene.json",
      buildFile({ entities: [entityRecord({ uid: "B", name: "B", instance: { scene: { $asset: "a.scene.json" } } })] }),
      [],
    );
    const outer = await createSceneAsset(
      "a.scene.json",
      buildFile({ entities: [entityRecord({ uid: "A", name: "A", instance: { scene: { $asset: "b.scene.json" } } })] }),
      [fakeHandle("b.scene.json", inner)],
    );
    const cyclic: SceneAsset = { ...inner, dependencies: [fakeHandle("a.scene.json", outer)] };
    const linked: SceneAsset = { ...outer, dependencies: [fakeHandle("b.scene.json", cyclic)] };
    const harness = world();
    expect(() => instantiateScene(harness.world, linked)).toThrow(/nest the scene inside itself/u);
  });

  it("logs a hash mismatch by default and throws with strictInstanceHashes", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, { scene: { $asset: prefab.address }, hash: "sha256:stale" });
    const harness = world();
    const built = instantiateScene(harness.world, level);
    expect(built.issues[0]?.code).toBe(CoreErrorCode.instanceHashMismatch);
    expect(() => instantiateScene(harness.world, level, { strictInstanceHashes: true })).toThrow(
      /were saved against sha256:stale/u,
    );
  });

  it("reports an instanced scene that is not among the dependencies", async () => {
    const level = await createSceneAsset(
      "levels/missing.scene.json",
      buildFile({ entities: [entityRecord({ uid: "L", name: "L", instance: { scene: { $asset: "gone.json" } } })] }),
    );
    const harness = world();
    const built = instantiateScene(harness.world, level);
    expect(built.issues[0]?.code).toBe(CoreErrorCode.sceneNotLoaded);
    expect(built.roots[0]?.children).toHaveLength(0);
  });
});

describe("re-serializing an instance", () => {
  it("emits an instance entry with recomputed overrides", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, {
      scene: { $asset: prefab.address },
      hash: prefab.hash,
      overrides: [{ path: "P-ROOT/components/P-AI/props/speed", value: 9 }],
    });
    const harness = world();
    const built = instantiateScene(harness.world, level);
    const enemy = built.roots[0];
    const ai = enemy?.getComponent(Everything);
    if (ai !== undefined && ai !== null) {
      ai.label = "angry";
    }
    const file = serializeScene(harness.world.activeScene, { engineVersion: null, name: "Level" });
    const spawn = file.entities[0];
    expect(file.entities).toHaveLength(1);
    expect(spawn?.instance?.scene).toEqual({ $asset: prefab.address });
    expect(spawn?.instance?.hash).toBe(prefab.hash);
    const paths = (spawn?.instance?.overrides ?? []).map((override) => override.path);
    expect(paths).toContain("P-ROOT/components/P-AI/props/speed");
    expect(paths).toContain("P-ROOT/components/P-AI/props/label");
    expect(spawn?.instance?.overrides).toHaveLength(2);
    expect(spawn?.components).toBeUndefined();
  });

  it("writes a removed root component as remove and an added one as the entry's own", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, { scene: { $asset: prefab.address } });
    const harness = world();
    const built = instantiateScene(harness.world, level);
    const enemy = built.roots[0];
    const debug = enemy?.getComponent(Tagger) ?? null;
    if (enemy !== undefined && debug !== null) {
      enemy.removeComponent(debug);
    }
    harness.flushDestroy();
    enemy?.addComponent(Tagger, { note: "loot" });
    const spawn = serializeScene(harness.world.activeScene, { engineVersion: null }).entities[0];
    expect(spawn?.instance?.overrides).toEqual([{ op: "remove", path: "P-ROOT/components/P-DEBUG" }]);
    expect(spawn?.components).toEqual([expect.objectContaining({ type: "test/Tagger", props: { note: "loot" } })]);
  });

  it("emits add and remove overrides for components changed at run time below the root", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, { scene: { $asset: prefab.address } });
    const harness = world();
    const weapon = instantiateScene(harness.world, level).roots[0]?.children[0];
    weapon?.addComponent(Tagger, { note: "sharp" });
    const overrides = serializeScene(harness.world.activeScene, { engineVersion: null }).entities[0]?.instance
      ?.overrides;
    expect(overrides).toEqual([expect.objectContaining({ op: "add", path: "P-CHILD/components" })]);
  });

  it("round trips an instanced scene byte-identically", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, {
      scene: { $asset: prefab.address },
      hash: prefab.hash,
      overrides: [{ path: "P-ROOT/components/P-AI/props/speed", value: 9 }],
    });
    const first = world();
    instantiateScene(first.world, level);
    const written = serializeScene(first.world.activeScene, { engineVersion: null, name: "Level" });
    const reloaded = await createSceneAsset(level.address, written, level.dependencies);
    const second = world();
    instantiateScene(second.world, reloaded);
    const again = serializeScene(second.world.activeScene, { engineVersion: null, name: "Level" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(written));
  });

  it("flatten writes the instanced entities as plain entities", async () => {
    const prefab = await enemyPrefab();
    const level = await levelInstancing(prefab, { scene: { $asset: prefab.address } });
    const harness = world();
    instantiateScene(harness.world, level);
    const file = serializeScene(harness.world.activeScene, { engineVersion: null, flatten: true });
    expect(file.entities.map((entity) => entity.name)).toEqual(["Enemy_01", "Weapon"]);
    expect(file.entities[0]?.components?.map((component) => component.type)).toEqual([
      "test/Everything",
      "test/Tagger",
    ]);
    expect(file.entities.every((entity) => entity.instance === undefined)).toBe(true);
  });
});

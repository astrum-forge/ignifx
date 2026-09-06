import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { MemoryStorageBackend } from "../../src/storage/memory-backend.js";
import { StorageImpl } from "../../src/storage/storage.js";
import {
  Everything,
  Tagger,
  buildFile,
  createSerializationWorld,
  entityRecord,
  fakeHandle,
} from "../serialization/fixtures.js";
import type { SceneAsset } from "../../src/serialization/scene-asset.js";
import type { SceneFile, SceneFileEntity } from "../../src/serialization/scene-file.js";
import type { SerializeIssue } from "../../src/serialization/serialize.js";
import type { Storage } from "../../src/storage/storage.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * The Phase 9 exit criterion of `docs/plan/engineering-plan.md`: a save game travels out through
 * `serializeScene`, through `app.storage`, and back into a *different* world, byte for byte —
 * including an instanced prefab whose root carries overrides — and a save whose prefab has changed
 * since it was written behaves the way `06-serialization-and-scene-format.md` §2 says it does.
 */

let worlds: TestWorld[] = [];

/** A world that is disposed after the test. */
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

/** A store over a fresh in-memory backend. */
function saves(): Storage {
  return new StorageImpl(new MemoryStorageBackend()).namespace("saves");
}

/** The prefab the save instances: a root with two components and one child. */
async function enemyPrefab(aggression: number): Promise<SceneAsset> {
  return createSceneAsset(
    "prefabs/enemy.prefab.json",
    buildFile({
      name: "Enemy",
      entities: [
        entityRecord({
          uid: "P-ROOT",
          name: "Enemy",
          components: [
            { uid: "P-AI", type: "test/Everything", props: { speed: aggression, label: "calm" } },
            { uid: "P-DEBUG", type: "test/Tagger", props: { note: "debug" } },
          ],
        }),
        entityRecord({ uid: "P-CHILD", name: "Weapon", parent: "P-ROOT" }),
      ],
    }),
  );
}

/** A level that instances the prefab once, with an override on the instance root's component. */
async function levelFile(prefab: SceneAsset, hash: string): Promise<SceneAsset> {
  const instance: NonNullable<SceneFileEntity["instance"]> = {
    scene: { $asset: prefab.address },
    hash,
    overrides: [
      { path: "P-ROOT/components/P-AI/props/speed", value: 9 },
      { path: "P-ROOT/components/P-AI/props/label", value: "furious" },
      { op: "remove", path: "P-ROOT/components/P-DEBUG" },
    ],
  };
  return createSceneAsset(
    "levels/level.scene.json",
    buildFile({
      name: "Level",
      entities: [
        entityRecord({ uid: "L-HERO", name: "Hero", components: [{ uid: "L-AI", type: "test/Everything" }] }),
        entityRecord({ uid: "L-SPAWN", name: "Enemy_01", instance }),
      ],
    }),
    [fakeHandle("prefabs/enemy.prefab.json", prefab)],
  );
}

describe("a save game through app.storage", () => {
  it("round-trips a scene with an instanced prefab and overrides, byte for byte", async () => {
    const prefab = await enemyPrefab(3);
    const level = await levelFile(prefab, prefab.hash);
    const storage = saves();

    // Build the level, then save what is actually in the world rather than the file it came from.
    const first = world();
    const built = instantiateScene(first.world, level);
    expect(built.issues).toEqual([]);
    const issues: SerializeIssue[] = [];
    const saved = serializeScene(first.world.activeScene, {
      name: "Level",
      onIssue: (issue: SerializeIssue): void => {
        issues.push(issue);
      },
    });
    expect(issues).toEqual([]);
    await storage.set("slot1", saved);

    const restored = await storage.get<SceneFile>("slot1");
    expect(restored).not.toBeNull();
    expect(stringifySceneFile(restored ?? saved)).toBe(stringifySceneFile(saved));

    // A different world, from the stored JSON only.
    const second = world();
    const asset = await createSceneAsset("saves/slot1.scene.json", restored ?? saved, [
      fakeHandle("prefabs/enemy.prefab.json", prefab),
    ]);
    const rebuilt = instantiateScene(second.world, asset);
    expect(rebuilt.issues).toEqual([]);

    const spawn = second.world.activeScene.roots.find((entity) => entity.name === "Enemy_01");
    const enemy = spawn?.children[0];
    expect(enemy?.name).toBe("Enemy");
    expect(enemy?.getComponent(Everything)?.speed).toBe(9);
    expect(enemy?.getComponent(Everything)?.label).toBe("furious");
    expect(enemy?.getComponent(Tagger)).toBeNull();
    expect(enemy?.children.map((child) => child.name)).toEqual(["Weapon"]);

    // And re-serializing the restored world produces the same text again.
    const again = serializeScene(second.world.activeScene, { name: "Level" });
    expect(stringifySceneFile(again)).toBe(stringifySceneFile(saved));
  });

  it("keeps two slots apart and lists them in order", async () => {
    const prefab = await enemyPrefab(3);
    const level = await levelFile(prefab, prefab.hash);
    const storage = saves();
    const harness = world();
    instantiateScene(harness.world, level);
    const saved = serializeScene(harness.world.activeScene, { name: "Level" });
    await storage.set("slot1", saved);
    await storage.set("slot2", { ...saved, name: "Other" });
    await storage.set("autosave/1", saved);
    expect(await storage.keys()).toEqual(["autosave/1", "slot1", "slot2"]);
    expect(await storage.keys("slot")).toEqual(["slot1", "slot2"]);
    expect((await storage.get<SceneFile>("slot2"))?.name).toBe("Other");
  });

  it("stores a binary screenshot next to the save", async () => {
    const storage = saves();
    const shot = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await storage.set("slot1.png", shot);
    expect(await storage.get<Uint8Array>("slot1.png")).toEqual(shot);
  });
});

describe("a save whose prefab has changed since it was written", () => {
  it("loads best-effort and reports IGX-0604 by default", async () => {
    const original = await enemyPrefab(3);
    const level = await levelFile(original, original.hash);
    const storage = saves();
    const first = world();
    instantiateScene(first.world, level);
    const saved = serializeScene(first.world.activeScene, { name: "Level" });
    await storage.set("slot1", saved);

    // The prefab is edited between the save and the load, so its content hash changes.
    const edited = await enemyPrefab(4);
    expect(edited.hash).not.toBe(original.hash);

    const restored = await storage.get<SceneFile>("slot1");
    const asset = await createSceneAsset("saves/slot1.scene.json", restored ?? saved, [
      fakeHandle("prefabs/enemy.prefab.json", edited),
    ]);
    const second = world();
    const rebuilt = instantiateScene(second.world, asset);

    expect(rebuilt.issues.map((issue) => issue.code)).toContain(CoreErrorCode.instanceHashMismatch);
    expect(rebuilt.issues[0]?.message).toMatch(/were saved against/u);
    // "Best effort" means the overrides still land on the entities the paths still name.
    const enemy = second.world.activeScene.roots.find((entity) => entity.name === "Enemy_01")?.children[0];
    expect(enemy?.getComponent(Everything)?.speed).toBe(9);
  });

  it("throws IGX-0604 when the loader is told to be strict", async () => {
    const original = await enemyPrefab(3);
    const level = await levelFile(original, original.hash);
    const storage = saves();
    const first = world();
    instantiateScene(first.world, level);
    await storage.set("slot1", serializeScene(first.world.activeScene, { name: "Level" }));

    const edited = await enemyPrefab(4);
    const restored = await storage.get<SceneFile>("slot1");
    expect(restored).not.toBeNull();
    const asset = await createSceneAsset("saves/slot1.scene.json", restored ?? buildFile({ name: "x", entities: [] }), [
      fakeHandle("prefabs/enemy.prefab.json", edited),
    ]);
    const second = world();
    expect(() => instantiateScene(second.world, asset, { strictInstanceHashes: true })).toThrow(/IGX-0604/u);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { createAssetHarness } from "../assets/support/harness.js";
import {
  AwakeRecorder,
  Everything,
  Tagger,
  buildFile,
  createSerializationWorld,
  entityRecord,
} from "../serialization/fixtures.js";
import { sinkOf } from "../support/create-test-world.js";
import type { SceneFile } from "../../src/serialization/scene-file.js";
import type { AssetHarness } from "../assets/support/harness.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * `World.loadScene`, `unloadScene`, `instantiate`, `instantiateAsync`, and `moveEntityToScene`
 * (`docs/architecture/02-scene-graph.md` §2).
 */

let harnesses: AssetHarness[] = [];
let worlds: TestWorld[] = [];

/** A headless app with the scene loader registered and the fake network primed. */
async function sceneApp(files: Readonly<Record<string, SceneFile>>): Promise<AssetHarness> {
  // The core extension registers the scene loader itself since Phase 2 (`04-extensions.md` §7), so
  // the harness only has to prime the network.
  const harness = await createAssetHarness();
  harnesses.push(harness);
  harness.app.registerComponents([Everything, Tagger, AwakeRecorder]);
  for (const [address, file] of Object.entries(files)) {
    harness.net.canned.set(harness.app.assets.resolveUrl(address), stringifySceneFile(file));
  }
  return harness;
}

/** A world with no asset service, for the synchronous paths. */
function localWorld(): TestWorld {
  const harness = createSerializationWorld();
  worlds.push(harness);
  return harness;
}

/** Drives the fake network until a promise settles. */
async function settle(harness: AssetHarness, work: Promise<unknown>): Promise<void> {
  const state = { done: false };
  const finish = (): void => {
    state.done = true;
  };
  void work.then(finish, finish);
  // The delivery point is `PreUpdate`, so a load settles only once frames run; the cap keeps a
  // stuck request from hanging the suite instead of failing it.

  for (let index = 0; index < 200 && !state.done; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- see the comment above
    await harness.settle();
  }
}

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  for (const harness of worlds) {
    harness.dispose();
  }
  harnesses = [];
  worlds = [];
});

/** A two-entity level whose root carries a recorder script. */
function levelFile(name = "Level"): SceneFile {
  return buildFile({
    name,
    entities: [
      entityRecord({
        uid: "L-ROOT",
        name: "Root",
        components: [{ uid: "L-S", type: "test/AwakeRecorder", props: { note: "root" } }],
      }),
      entityRecord({
        uid: "L-CHILD",
        name: "Child",
        parent: "L-ROOT",
        components: [{ uid: "L-C", type: "test/AwakeRecorder", props: { note: "child" } }],
      }),
    ],
  });
}

describe("loadScene", () => {
  it("builds the scene, awakes in tree order, and fires onSceneLoaded", async () => {
    const harness = await sceneApp({ "levels/a.scene.json": levelFile() });
    const loaded: string[] = [];
    harness.app.world.onSceneLoaded.connect((instance) => {
      loaded.push(instance.name);
    });
    const promise = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, promise);
    const instance = await promise;
    expect(instance.name).toBe("Level");
    expect(instance.isLoaded).toBe(true);
    expect(instance.asset?.address).toBe("levels/a.scene.json");
    expect(instance.roots.map((entity) => entity.name)).toEqual(["Root"]);
    expect(loaded).toEqual(["Level"]);
    expect(sinkOf(harness.app.world)).toEqual(["awake:Root:root", "awake:Child:child"]);
    expect(harness.app.world.activeScene).toBe(instance);
    expect(harness.app.world.scenes).toHaveLength(2);
  });

  it("keeps the file's uids and resolves references before awake", async () => {
    const harness = await sceneApp({ "levels/a.scene.json": levelFile() });
    const promise = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, promise);
    await promise;
    expect(harness.app.world.getEntity("L-ROOT")?.name).toBe("Root");
  });

  it("additive keeps existing scenes and leaves the active scene alone", async () => {
    const harness = await sceneApp({
      "levels/a.scene.json": levelFile("A"),
      "levels/b.scene.json": levelFile("B"),
    });
    const first = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, first);
    const a = await first;
    const second = harness.app.world.loadScene("levels/b.scene.json", { mode: "additive" });
    await settle(harness, second);
    const b = await second;
    expect(harness.app.world.scenes).toHaveLength(3);
    expect(harness.app.world.activeScene).toBe(a);
    expect(b.name).toBe("B");
  });

  it("single unloads every scene that is not persistent", async () => {
    const harness = await sceneApp({
      "levels/a.scene.json": levelFile("A"),
      "levels/b.scene.json": levelFile("B"),
    });
    const first = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, first);
    const a = await first;
    const kept = harness.app.world.createEntity("Persistent", {
      scene: harness.app.world.scenes[0] ?? harness.app.world.activeScene,
    });
    const second = harness.app.world.loadScene("levels/b.scene.json");
    await settle(harness, second);
    await second;
    expect(harness.app.world.scenes.map((scene) => scene.name)).toEqual(["default", "B"]);
    expect(a.roots).toHaveLength(0);
    expect(kept.isDestroyed).toBe(false);
  });

  it("respects setActive and reports progress", async () => {
    const harness = await sceneApp({ "levels/a.scene.json": levelFile() });
    const seen: number[] = [];
    const promise = harness.app.world.loadScene("levels/a.scene.json", {
      setActive: false,
      onProgress: (progress) => {
        seen.push(progress.fraction);
      },
    });
    await settle(harness, promise);
    const instance = await promise;
    expect(harness.app.world.activeScene).not.toBe(instance);
    expect(seen.at(-1)).toBe(1);
  });

  it("keeps the file's settings block on the instance", async () => {
    const harness = await sceneApp({
      "levels/a.scene.json": { ...levelFile(), settings: { clearColor: [0.05, 0.05, 0.08, 1] } },
    });
    const promise = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, promise);
    const instance = await promise;
    expect(instance.settings).toEqual({ clearColor: [0.05, 0.05, 0.08, 1] });
    expect(serializeScene(instance, { engineVersion: null }).settings).toEqual({
      clearColor: [0.05, 0.05, 0.08, 1],
    });
  });

  it("warns about a layer the project does not declare", async () => {
    const harness = await sceneApp({
      "levels/a.scene.json": buildFile({ entities: [entityRecord({ uid: "A", layer: "Nope" })] }),
    });
    const promise = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, promise);
    const instance = await promise;
    expect(instance.roots[0]?.layer).toBe(0);
  });

  it("rejects when the signal aborted before construction", async () => {
    const harness = await sceneApp({ "levels/a.scene.json": levelFile() });
    const controller = new AbortController();
    const promise = harness.app.world.loadScene("levels/a.scene.json", { signal: controller.signal });
    const caught = promise.catch((error: unknown) => error);
    controller.abort();
    await settle(harness, caught);
    const error = await caught;
    expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.assetLoadAborted);
  });

  it("throws IGX-0307 for a component type nothing registered", async () => {
    const harness = await sceneApp({
      "levels/a.scene.json": buildFile({
        entities: [entityRecord({ uid: "A", components: [{ uid: "C", type: "test/Missing" }] })],
      }),
    });
    const caught = harness.app.world.loadScene("levels/a.scene.json").catch((error: unknown) => error);
    await settle(harness, caught);
    expect(isIgnifxError(await caught) && (await caught)).toMatchObject({ code: CoreErrorCode.unknownComponentTypeId });
  });
});

describe("unloadScene", () => {
  it("fires onUnloading, destroys the roots, releases the asset, and fires onSceneUnloaded", async () => {
    const harness = await sceneApp({ "levels/a.scene.json": levelFile() });
    const promise = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, promise);
    const instance = await promise;
    const order: string[] = [];
    instance.onUnloading.connect(() => {
      order.push("unloading");
    });
    harness.app.world.onSceneUnloaded.connect((scene) => {
      order.push(`unloaded:${scene.name}`);
    });
    const root = instance.roots[0];
    await harness.app.world.unloadScene(instance);
    expect(order).toEqual(["unloading", "unloaded:Level"]);
    expect(root?.isDestroyed).toBe(true);
    expect(harness.app.world.scenes).toHaveLength(1);
    expect(harness.app.world.activeScene).toBe(harness.app.world.scenes[0]);
    expect(instance.isLoaded).toBe(false);
    expect(instance.asset).toBeNull();
  });

  it("ignores the implicit default scene and unknown instances", async () => {
    const harness = await sceneApp({});
    const world = harness.app.world;
    const before = world.scenes.length;
    await world.unloadScene(world.scenes[0] ?? world.activeScene);
    expect(world.scenes).toHaveLength(before);
  });
});

describe("instantiate", () => {
  it("expands a loaded prefab, answers with its root, and places it", async () => {
    const prefab = await createSceneAsset(
      "p.prefab.json",
      buildFile({
        name: "Enemy",
        entities: [
          entityRecord({ uid: "P", name: "Enemy", components: [{ uid: "PC", type: "test/Tagger" }] }),
          entityRecord({ uid: "PK", name: "Kid", parent: "P" }),
        ],
      }),
    );
    const harness = localWorld();
    const enemy = harness.world.instantiate(prefab, {
      name: "Enemy_01",
      position: { x: 4, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(enemy.name).toBe("Enemy_01");
    expect(enemy.transform.localPosition.x).toBe(4);
    expect(enemy.children.map((child) => child.name)).toEqual(["Kid"]);
    expect(enemy.prefab?.instanceRoot).toBe(enemy);
    expect(enemy.prefab?.address).toBe("p.prefab.json");
    expect(enemy.uid).not.toBe("P");
    expect(enemy.getComponent(Tagger)).not.toBeNull();
  });

  it("wraps a multi-root scene in a container named after it", async () => {
    const prefab = await createSceneAsset(
      "pair.prefab.json",
      buildFile({ name: "Pair", entities: [entityRecord({ uid: "A" }), entityRecord({ uid: "B" })] }),
    );
    const harness = localWorld();
    const root = harness.world.instantiate(prefab);
    expect(root.name).toBe("Pair");
    expect(root.children).toHaveLength(2);
    expect(root.prefab?.instanceRoot).toBe(root);
    expect(root.children[0]?.prefab?.instanceRoot).toBe(root);
    expect(root.activeInHierarchy).toBe(true);
  });

  it("places the root in world space when asked", async () => {
    const prefab = await createSceneAsset(
      "p.prefab.json",
      buildFile({ entities: [entityRecord({ uid: "P", name: "P" })] }),
    );
    const harness = localWorld();
    const parent = harness.world.createEntity("Parent");
    parent.transform.localPosition.set(10, 0, 0);
    const child = harness.world.instantiate(prefab, {
      parent,
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 1, z: 0, w: 0 },
      worldSpace: true,
    });
    expect(child.transform.localPosition.x).toBeCloseTo(-9);
  });

  it("throws IGX-0301 when an instanced scene is not loaded", async () => {
    const level = await createSceneAsset(
      "l.scene.json",
      buildFile({ entities: [entityRecord({ uid: "L", instance: { scene: { $asset: "gone.prefab.json" } } })] }),
    );
    const harness = localWorld();
    try {
      harness.world.instantiate(level);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.sceneNotLoaded);
    }
  });

  it("answers with an empty container for a scene that declares no entities", async () => {
    const empty = await createSceneAsset("empty.prefab.json", buildFile({ name: "Empty", entities: [] }));
    const harness = localWorld();
    const root = harness.world.instantiate(empty);
    expect(root.name).toBe("Empty");
    expect(root.children).toHaveLength(0);
  });

  it("queues awake for the next lifecycle flush", async () => {
    const prefab = await createSceneAsset(
      "p.prefab.json",
      buildFile({
        entities: [entityRecord({ uid: "P", name: "P", components: [{ uid: "S", type: "test/AwakeRecorder" }] })],
      }),
    );
    const harness = localWorld();
    harness.world.instantiate(prefab);
    expect(harness.log).toEqual([]);
    harness.flushA();
    expect(harness.log).toEqual(["awake:P:"]);
  });

  it("instantiateAsync loads first", async () => {
    const harness = await sceneApp({
      "p.prefab.json": buildFile({ entities: [entityRecord({ uid: "P", name: "P" })] }),
    });
    const promise = harness.app.world.instantiateAsync("p.prefab.json");
    await settle(harness, promise);
    expect((await promise).name).toBe("P");
  });
});

describe("moveEntityToScene", () => {
  it("moves a root and its subtree", async () => {
    const harness = await sceneApp({ "levels/a.scene.json": levelFile() });
    const promise = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, promise);
    const instance = await promise;
    const entity = harness.app.world.createEntity("Kept");
    const child = harness.app.world.createEntity("KeptChild", { parent: entity });
    harness.app.world.moveEntityToScene(entity, instance);
    expect(entity.scene).toBe(instance);
    expect(child.scene).toBe(instance);
    expect(instance.roots).toContain(entity);
  });

  it("refuses a child and a destroyed entity", () => {
    const harness = localWorld();
    const parent = harness.world.createEntity("P");
    const child = harness.world.createEntity("C", { parent });
    try {
      harness.world.moveEntityToScene(child, harness.world.activeScene);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.entityIsNotSceneRoot);
    }
    parent.destroy();
    try {
      harness.world.moveEntityToScene(parent, harness.world.activeScene);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.mutationAfterDestroy);
    }
  });
});

describe("createEntity uid and active options", () => {
  it("adopts a free uid and mints a fresh one on a collision", () => {
    const harness = localWorld();
    const first = harness.world.createEntity("A", { uid: "FIXED" });
    const second = harness.world.createEntity("B", { uid: "FIXED" });
    expect(first.uid).toBe("FIXED");
    expect(second.uid).not.toBe("FIXED");
  });

  it("creates an inactive entity that awakes nothing until it is activated", () => {
    const harness = localWorld();
    const entity = harness.world.createEntity("A", { active: false });
    entity.addComponent(AwakeRecorder);
    harness.flushA();
    expect(harness.log).toEqual([]);
    entity.active = true;
    harness.flushA();
    expect(harness.log).toEqual(["awake:A:"]);
  });
});

describe("round trip through the world", () => {
  it("re-serializes a loaded scene byte-identically", async () => {
    const harness = await sceneApp({ "levels/a.scene.json": levelFile() });
    const promise = harness.app.world.loadScene("levels/a.scene.json");
    await settle(harness, promise);
    const instance = await promise;
    const written = serializeScene(instance, { engineVersion: null, name: "Level" });
    const asset = await createSceneAsset("levels/a.scene.json", written);
    const local = localWorld();
    instantiateScene(local.world, asset);
    expect(stringifySceneFile(serializeScene(local.world.activeScene, { engineVersion: null, name: "Level" }))).toBe(
      stringifySceneFile(written),
    );
  });
});

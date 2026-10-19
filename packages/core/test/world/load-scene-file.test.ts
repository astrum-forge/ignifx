import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { computeSceneHash } from "../../src/serialization/scene-asset.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { loadSceneDependencies } from "../../src/serialization/scene-loader.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { createAssetHarness } from "../assets/support/harness.js";
import { AwakeRecorder, Everything, Tagger, buildFile, entityRecord } from "../serialization/fixtures.js";
import { sinkOf } from "../support/create-test-world.js";
import type { SceneLoadIssue } from "../../src/serialization/load.js";
import type { SceneFile } from "../../src/serialization/scene-file.js";
import type { AssetHarness } from "../assets/support/harness.js";

/**
 * `World.loadSceneFile`, `World.createScene` and `loadSceneDependencies`: a scene built from a file
 * object in memory, and an empty instance built in code (`docs/architecture/02-scene-graph.md` §2,
 * §3). These are what the editor host's `openScene` and its `editor` scene stand on.
 */

let harnesses: AssetHarness[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses = [];
});

/**
 * A headless, started app with the test components registered and canned files on the network.
 *
 * @param files - Bodies by address.
 * @returns The harness.
 */
async function sceneApp(files: Readonly<Record<string, string>> = {}): Promise<AssetHarness> {
  const harness = await createAssetHarness();
  harnesses.push(harness);
  harness.app.registerComponents([Everything, Tagger, AwakeRecorder]);
  for (const [address, body] of Object.entries(files)) {
    harness.net.canned.set(harness.app.assets.resolveUrl(address), body);
  }
  return harness;
}

/** A prefab with one root and a child, so an instance of it expands to two entities. */
const CRATE: SceneFile = buildFile({
  name: "Crate",
  entities: [
    entityRecord({ uid: "P-ROOT", name: "Crate", components: [{ uid: "P-T", type: "test/Tagger" }] }),
    entityRecord({ uid: "P-LID", name: "Lid", parent: "P-ROOT" }),
  ],
});

/**
 * A level with a script, a child, and a prefab instance.
 *
 * @param hash - The prefab hash the instance entry records, as a save writes it.
 * @returns The file.
 */
function levelFile(hash?: string): SceneFile {
  return {
    ...buildFile({
      name: "Level",
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
          components: [{ uid: "L-T", type: "test/Tagger", props: { note: "child" } }],
        }),
        entityRecord({
          uid: "L-CRATE",
          name: "Crate",
          instance: { scene: { $asset: "prefabs/crate.prefab.json" }, ...(hash === undefined ? {} : { hash }) },
        }),
      ],
    }),
    settings: { clearColor: [0.1, 0.1, 0.12, 1] },
  };
}

/** The canned network every test below serves. */
const NETWORK = { "prefabs/crate.prefab.json": stringifySceneFile(CRATE) };

describe("world.loadSceneFile", () => {
  it("builds a file held in memory with the file's uids, and never fetches the file", async () => {
    const harness = await sceneApp(NETWORK);
    const file = levelFile();
    const loaded: string[] = [];
    harness.app.world.onSceneLoaded.connect((instance) => {
      loaded.push(instance.name);
    });

    const instance = await harness.settleUntil(
      harness.app.world.loadSceneFile(file, { address: "levels/draft.scene.json" }),
    );

    expect(harness.net.requests.map((request) => request.url)).toEqual([
      harness.app.assets.resolveUrl("prefabs/crate.prefab.json"),
    ]);
    expect(instance.name).toBe("Level");
    expect(instance.isLoaded).toBe(true);
    expect(instance.settings).toEqual({ clearColor: [0.1, 0.1, 0.12, 1] });
    expect(harness.app.world.activeScene).toBe(instance);
    expect(harness.app.world.getEntity("L-CHILD")?.parent?.uid).toBe("L-ROOT");
    expect(harness.app.world.getEntity("L-CRATE")?.children.map((child) => child.name)).toEqual(["Lid"]);
    expect(sinkOf(harness.app.world)).toEqual(["awake:Root:root"]);
    expect(loaded).toEqual(["Level"]);
    expect(serializeScene(instance, { engineVersion: null })).toEqual(levelFile(await computeSceneHash(CRATE)));
  });

  it("publishes the file at its address and releases what it holds when unloaded", async () => {
    const harness = await sceneApp(NETWORK);
    const instance = await harness.settleUntil(
      harness.app.world.loadSceneFile(levelFile(), { address: "levels/draft.scene.json", name: "Draft" }),
    );
    const prefab = harness.app.assets.get("prefabs/crate.prefab.json");

    expect(instance.name).toBe("Draft");
    expect(instance.asset?.address).toBe("levels/draft.scene.json");
    expect(harness.app.assets.get("levels/draft.scene.json")).toBe(instance.asset);
    expect(prefab?.refCount).toBe(1);

    await harness.app.world.unloadScene(instance);

    expect(prefab?.refCount).toBe(0);
    expect(instance.asset).toBeNull();
    expect(harness.app.world.getEntity("L-ROOT")).toBeNull();
  });

  it("hands every build issue to onIssue", async () => {
    const harness = await sceneApp();
    const issues: SceneLoadIssue[] = [];
    const file = buildFile({ entities: [entityRecord({ uid: "A", layer: "Nope" })] });

    await harness.settleUntil(
      harness.app.world.loadSceneFile(file, { address: "memory:scene/a", onIssue: (issue) => issues.push(issue) }),
    );

    expect(issues.map((issue) => issue.code)).toEqual([CoreErrorCode.unknownLayer]);
  });

  it("refuses a file that does not match the format and unloads nothing", async () => {
    const harness = await sceneApp(NETWORK);
    const first = await harness.settleUntil(
      harness.app.world.loadSceneFile(levelFile(), { address: "levels/a.scene.json" }),
    );
    const broken = {
      ...levelFile(),
      entities: [
        { ...entityRecord({ uid: "X" }), transform: { position: [0, 0, 0], rotation: [0, 0, 1], scale: [1, 1, 1] } },
      ],
    } as unknown as SceneFile;

    const error: unknown = await harness.app.world
      .loadSceneFile(broken, { address: "levels/b.scene.json" })
      .catch((thrown: unknown) => thrown);

    expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.sceneFileInvalid);
    expect(harness.app.world.scenes).toContain(first);
  });

  it("unloads the half-built instance when the file names an unregistered type", async () => {
    const harness = await sceneApp();
    const file = buildFile({
      entities: [entityRecord({ uid: "A", components: [{ uid: "C", type: "test/Unknown" }] })],
    });

    const error: unknown = await harness.settleUntil(
      harness.app.world.loadSceneFile(file, { address: "memory:scene/a" }).catch((thrown: unknown) => thrown),
    );

    expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.unknownComponentTypeId);
    expect(harness.app.world.scenes.map((scene) => scene.name)).toEqual(["default"]);
    expect(harness.app.world.getEntity("A")).toBeNull();
  });

  it("additive keeps the other scenes and leaves the active scene alone", async () => {
    const harness = await sceneApp(NETWORK);
    const first = await harness.settleUntil(
      harness.app.world.loadSceneFile(levelFile(), { address: "levels/a.scene.json" }),
    );
    const file = buildFile({ name: "Extra", entities: [entityRecord({ uid: "E" })] });

    const second = await harness.settleUntil(
      harness.app.world.loadSceneFile(file, { address: "levels/b.scene.json", mode: "additive" }),
    );

    expect(harness.app.world.scenes).toEqual([harness.app.world.scenes[0], first, second]);
    expect(harness.app.world.activeScene).toBe(first);
  });
});

describe("world.createScene", () => {
  it("creates an empty instance that code fills and that a persistent flag keeps across loads", async () => {
    const harness = await sceneApp(NETWORK);
    const world = harness.app.world;
    const tools = world.createScene("editor", { persistent: true });
    const scratch = world.createScene("scratch");
    const camera = world.createEntity("Editor Camera", { scene: tools });

    expect(tools.name).toBe("editor");
    expect(tools.persistent).toBe(true);
    expect(scratch.persistent).toBe(false);
    expect(tools.roots).toEqual([camera]);
    expect(world.scenes.map((scene) => scene.name)).toEqual(["default", "editor", "scratch"]);

    const level = await harness.settleUntil(world.loadSceneFile(levelFile(), { address: "levels/a.scene.json" }));

    expect(world.scenes.map((scene) => scene.name)).toEqual(["default", "editor", "Level"]);
    expect(camera.isDestroyed).toBe(false);
    expect(serializeScene(level, { engineVersion: null }).entities.map((entity) => entity.name)).not.toContain(
      "Editor Camera",
    );

    await world.unloadScene(level);
    expect(world.scenes).toContain(tools);

    await world.unloadScene(tools);
    expect(camera.isDestroyed).toBe(true);
    expect(world.scenes.map((scene) => scene.name)).toEqual(["default"]);
  });
});

describe("loadSceneDependencies", () => {
  it("loads every referenced asset once, in the loader's order, with one holder each", async () => {
    const harness = await sceneApp(NETWORK);
    const handles = await harness.settleUntil(loadSceneDependencies(harness.app.assets, levelFile()));

    expect(handles.map((handle) => handle.address)).toEqual(["prefabs/crate.prefab.json"]);
    expect(handles.map((handle) => handle.refCount)).toEqual([1]);
  });

  it("releases what it loaded when one dependency fails", async () => {
    const harness = await sceneApp(NETWORK);
    const file = buildFile({
      entities: [
        entityRecord({ uid: "A", instance: { scene: { $asset: "prefabs/crate.prefab.json" } } }),
        entityRecord({ uid: "B", instance: { scene: { $asset: "prefabs/missing.prefab.json" } } }),
      ],
    });
    harness.net.canned.set(harness.app.assets.resolveUrl("prefabs/missing.prefab.json"), "not json");

    const error: unknown = await harness.settleUntil(
      loadSceneDependencies(harness.app.assets, file).catch((thrown: unknown) => thrown),
    );

    expect(error).toBeInstanceOf(Error);
    expect(harness.app.assets.get("prefabs/crate.prefab.json")?.refCount ?? 0).toBe(0);
  });
});

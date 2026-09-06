import { afterEach, describe, expect, it } from "vitest";
import { assetsInternals } from "../../src/assets/assets-service.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { createAssetHarness } from "../assets/support/harness.js";
import { buildFile, entityRecord, Everything, Tagger } from "../serialization/fixtures.js";
import type { HotReloadReport } from "../../src/hot-reload/contract.js";
import type { SceneInstance } from "../../src/scene/scene-instance.js";
import type { SceneFile } from "../../src/serialization/scene-file.js";
import type { AssetHarness } from "../assets/support/harness.js";

/**
 * Scene hot reload (`docs/architecture/15-devtools-and-diagnostics.md` §5): `reloadScene` rebuilds
 * an instance from its asset's current value, and `reloadScenes` makes a replaced scene file do it
 * on its own.
 */

const LEVEL = "levels/level.scene.json";
const PREFAB = "prefabs/enemy.prefab.json";

let harnesses: AssetHarness[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses = [];
});

/** The prefab the level instances: one entity carrying a `Tagger`. */
function prefabFile(): SceneFile {
  return buildFile({
    name: "Enemy",
    entities: [
      entityRecord({
        uid: "P-ROOT",
        name: "Enemy",
        components: [{ uid: "P-TAG", type: "test/Tagger", props: { note: "base" } }],
      }),
    ],
  });
}

/** A level with one plain entity and one prefab instance whose name is overridden. */
function levelFile(speed: number): SceneFile {
  return buildFile({
    name: "Level",
    entities: [
      entityRecord({
        uid: "L-ROOT",
        name: "Root",
        components: [{ uid: "L-EVERY", type: "test/Everything", props: { speed } }],
      }),
      entityRecord({
        uid: "L-SPAWN",
        name: "Spawn",
        parent: "L-ROOT",
        instance: {
          scene: { $asset: PREFAB },
          overrides: [
            { path: "P-ROOT/name", value: "Boss" },
            { path: "P-ROOT/components/P-TAG/props/note", value: "elite" },
          ],
        },
      }),
    ],
  });
}

/**
 * A headless app serving the level and its prefab.
 *
 * @param reloadScenes - Whether a replaced scene file rebuilds its instances by itself.
 * @returns The harness.
 */
async function sceneHarness(reloadScenes: boolean): Promise<AssetHarness> {
  const harness = await createAssetHarness({ hotReload: { reloadScenes } });
  harnesses.push(harness);
  harness.app.registerComponents([Everything, Tagger]);
  harness.net.canned.set(harness.app.assets.resolveUrl(PREFAB), stringifySceneFile(prefabFile()));
  harness.net.canned.set(harness.app.assets.resolveUrl(LEVEL), stringifySceneFile(levelFile(1)));
  return harness;
}

/**
 * Drives the fake network and the frame loop until a promise settles.
 *
 * @param harness - The harness.
 * @param work - The promise to drive.
 * @returns What the promise resolved with.
 */
async function settle<T>(harness: AssetHarness, work: Promise<T>): Promise<T> {
  const state: { done: boolean } = { done: false };
  const finish = (): void => {
    state.done = true;
  };
  void work.then(finish, finish);
  for (let index = 0; index < 200 && !state.done; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- draining a queue is sequential by nature.
    await harness.settle();
  }
  return work;
}

describe("reloadScene", () => {
  it("rebuilds the instance from the file, overrides included", async () => {
    const harness = await sceneHarness(false);
    const first = await settle(harness, harness.app.world.loadScene(LEVEL));
    const reports: HotReloadReport[] = [];
    harness.app.hotReload.onApplied.connect((report) => {
      reports.push(report);
    });
    const rootBefore = first.roots[0];

    const rebuilt = await settle(harness, harness.app.hotReload.reloadScene(first));

    expect(rebuilt).not.toBe(first);
    expect(rootBefore?.isDestroyed).toBe(true);
    expect(harness.app.world.scenes).toContain(rebuilt);
    expect(harness.app.world.scenes).not.toContain(first);
    expect(harness.app.world.activeScene).toBe(rebuilt);
    const spawn = rebuilt.roots[0]?.children[0];
    expect(spawn?.children[0]?.name).toBe("Boss");
    expect(spawn?.children[0]?.getComponent(Tagger)?.note).toBe("elite");
    expect(reports.map((report) => report.kind)).toEqual(["scene"]);
    expect(reports[0]?.typeIds).toEqual([LEVEL]);
    expect(reports[0]?.instances).toBeGreaterThan(0);
  });

  it("picks up the file's new content", async () => {
    const harness = await sceneHarness(false);
    const first = await settle(harness, harness.app.world.loadScene(LEVEL));
    expect(first.roots[0]?.getComponent(Everything)?.speed).toBe(1);

    await settle(harness, replaceFile(harness, levelFile(7)));
    const rebuilt = await settle(harness, harness.app.hotReload.reloadScene(first));

    expect(rebuilt.roots[0]?.getComponent(Everything)?.speed).toBe(7);
  });

  it("refuses an instance with no scene asset with IGX-1506", async () => {
    const harness = await sceneHarness(false);
    try {
      await harness.app.hotReload.reloadScene(harness.app.world.activeScene);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.sceneNotReloadable);
    }
  });
});

describe("reloadScenes", () => {
  it("rebuilds a live instance when its scene asset is replaced", async () => {
    const harness = await sceneHarness(true);
    const first = await settle(harness, harness.app.world.loadScene(LEVEL));
    expect(first.roots[0]?.getComponent(Everything)?.speed).toBe(1);

    const rebuild = waitForRebuild(harness, first);
    void replaceFile(harness, levelFile(5));
    const rebuilt = await settle(harness, rebuild);

    expect(rebuilt).not.toBe(first);
    expect(rebuilt.roots[0]?.getComponent(Everything)?.speed).toBe(5);
  });

  it("leaves the instance alone when the toggle is off", async () => {
    const harness = await sceneHarness(false);
    const first = await settle(harness, harness.app.world.loadScene(LEVEL));

    await settle(harness, replaceFile(harness, levelFile(5)));
    for (let index = 0; index < 10; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the frames have to run one at a time.
      await harness.settle();
    }

    expect(harness.app.world.scenes).toContain(first);
    expect(first.roots[0]?.getComponent(Everything)?.speed).toBe(1);
  });
});

/**
 * Serves a new body for the level and resolves once the asset service has swapped it in.
 *
 * @param harness - The harness.
 * @param file - The new file body.
 * @returns A promise that settles at the delivery that replaced the value.
 */
function replaceFile(harness: AssetHarness, file: SceneFile): Promise<void> {
  harness.net.canned.set(harness.app.assets.resolveUrl(LEVEL), stringifySceneFile(file));
  const handle = harness.app.assets.get(LEVEL);
  const replaced = new Promise<void>((resolve) => {
    handle?.onReplaced.connect(() => {
      resolve();
    });
  });
  assetsInternals(harness.app.assets).reload(LEVEL);
  return replaced;
}

/**
 * Resolves with the instance that replaced one the toggle rebuilt.
 *
 * @param harness - The harness.
 * @param previous - The instance that is going away.
 * @returns The replacement.
 */
function waitForRebuild(harness: AssetHarness, previous: SceneInstance): Promise<SceneInstance> {
  return new Promise<SceneInstance>((resolve) => {
    harness.app.events.onSceneLoaded.connect((instance: SceneInstance) => {
      if (instance !== previous) {
        resolve(instance);
      }
    });
  });
}

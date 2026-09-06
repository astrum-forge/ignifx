import { Signal } from "@ignifx/core";
import { describe, expect, it, vi } from "vitest";
import { createSceneReloadWatcher } from "../src/scene-reload.js";
import type { App, SceneInstance } from "@ignifx/core";

/**
 * The runtime half of `devtools.reloadScenes`. The rebuild itself belongs to
 * `app.hotReload.reloadScene`; what is tested here is when the watcher subscribes, when it stands
 * down, and what it does with a failure.
 *
 * The app is a hand-built stand-in rather than a real one: a real `onReplaced` needs a scene file
 * on a dev server to change, and the watcher's whole contract is the four members below.
 */

/** A scene stand-in with a replaceable asset. */
interface FakeScene {
  /** The instance name. */
  readonly name: string;
  /** The asset handle, or `null` for a scene built in code. */
  readonly asset: { readonly onReplaced: Signal<unknown> } | null;
}

/** What {@link createFakeApp} returns. */
interface FakeAppHarness {
  /** The app stand-in, ready to hand to the watcher. */
  readonly app: App;
  /** The scenes the world reports. */
  readonly scenes: FakeScene[];
  /** Fires when a scene is loaded. */
  readonly onSceneLoaded: Signal<SceneInstance>;
  /** Every error the watcher reported. */
  readonly reported: unknown[];
  /** Every scene name the watcher announced as reloaded. */
  readonly reloaded: string[];
}

/**
 * Builds an app stand-in with the four members the watcher touches.
 *
 * @param hotReload - What `app.hotReload` should be.
 * @returns The harness.
 */
function createFakeApp(hotReload: unknown): FakeAppHarness {
  const scenes: FakeScene[] = [];
  const onSceneLoaded = new Signal<SceneInstance>();
  const app = { world: { scenes, onSceneLoaded }, hotReload };
  return {
    // Boundary assertion: the watcher touches `world.scenes`, `world.onSceneLoaded` and
    // `hotReload`, and this object has all three.
    app: app as unknown as App,
    scenes,
    onSceneLoaded,
    reported: [],
    reloaded: [],
  };
}

/**
 * Builds a scene stand-in.
 *
 * @param name - The instance name.
 * @param withAsset - Whether it carries a replaceable asset.
 * @returns The scene.
 */
function fakeScene(name: string, withAsset = true): FakeScene {
  return { name, asset: withAsset ? { onReplaced: new Signal<unknown>() } : null };
}

/**
 * Builds a watcher over a fake app.
 *
 * @param harness - The app harness.
 * @returns The watcher.
 */
function watcherFor(harness: FakeAppHarness): ReturnType<typeof createSceneReloadWatcher> {
  return createSceneReloadWatcher({
    app: harness.app,
    report: (error: unknown): void => {
      harness.reported.push(error);
    },
    onReloaded: (scene: string): void => {
      harness.reloaded.push(scene);
    },
  });
}

/**
 * Lets every queued microtask and promise continuation run.
 *
 * @returns A promise that settles on the next macrotask.
 */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("the scene-reload watcher", () => {
  it("subscribes to nothing until it is enabled", () => {
    const harness = createFakeApp({ reloadScenes: false, reloadScene: vi.fn() });
    const scene = fakeScene("Level");
    harness.scenes.push(scene);
    const watcher = watcherFor(harness);

    expect(watcher.isEnabled).toBe(false);
    expect(scene.asset?.onReplaced.connectionCount).toBe(0);
    expect(harness.onSceneLoaded.connectionCount).toBe(0);
  });

  it("watches the loaded scenes and every scene loaded afterwards", () => {
    const reloadScene = vi.fn(async (): Promise<unknown> => undefined);
    const harness = createFakeApp({ reloadScenes: false, reloadScene });
    const first = fakeScene("Level");
    harness.scenes.push(first);
    const watcher = watcherFor(harness);
    watcher.setEnabled(true);
    watcher.setEnabled(true);

    expect(watcher.isEnabled).toBe(true);
    expect(first.asset?.onReplaced.connectionCount).toBe(1);

    const second = fakeScene("Menu");
    harness.onSceneLoaded.emit(second as unknown as SceneInstance);
    expect(second.asset?.onReplaced.connectionCount).toBe(1);

    watcher.setEnabled(false);
    expect(first.asset?.onReplaced.connectionCount).toBe(0);
    expect(second.asset?.onReplaced.connectionCount).toBe(0);
  });

  it("ignores a scene that was not built from a file", () => {
    const harness = createFakeApp({ reloadScenes: false, reloadScene: vi.fn() });
    harness.scenes.push(fakeScene("Runtime", false));
    const watcher = watcherFor(harness);

    expect(() => {
      watcher.setEnabled(true);
    }).not.toThrow();
    watcher.dispose();
  });

  it("rebuilds through app.hotReload.reloadScene and announces the result", async () => {
    const reloadScene = vi.fn(async (): Promise<unknown> => undefined);
    const harness = createFakeApp({ reloadScenes: false, reloadScene });
    const scene = fakeScene("Level");
    harness.scenes.push(scene);
    const watcher = watcherFor(harness);
    watcher.setEnabled(true);

    scene.asset?.onReplaced.emit(null);
    await flush();

    expect(reloadScene).toHaveBeenCalledTimes(1);
    expect(harness.reloaded).toEqual(["Level"]);
    watcher.dispose();
  });

  it("reports a rebuild that rejected", async () => {
    const harness = createFakeApp({
      reloadScenes: false,
      reloadScene: async (): Promise<unknown> => {
        throw new Error("bad file");
      },
    });
    const scene = fakeScene("Level");
    harness.scenes.push(scene);
    const watcher = watcherFor(harness);
    watcher.setEnabled(true);

    scene.asset?.onReplaced.emit(null);
    await flush();

    expect(harness.reported).toHaveLength(1);
    watcher.dispose();
  });

  it("tolerates a host whose reloadScene does not return a promise", async () => {
    const harness = createFakeApp({ reloadScenes: false, reloadScene: (): void => {} });
    const scene = fakeScene("Level");
    harness.scenes.push(scene);
    const watcher = watcherFor(harness);
    watcher.setEnabled(true);

    scene.asset?.onReplaced.emit(null);
    await flush();

    expect(harness.reloaded).toEqual(["Level"]);
    watcher.dispose();
  });

  it("reports IGX-1556 when the core it is running on cannot rebuild a scene", () => {
    const harness = createFakeApp({ reloadScenes: false });
    const scene = fakeScene("Level");
    harness.scenes.push(scene);
    const watcher = watcherFor(harness);
    watcher.setEnabled(true);

    scene.asset?.onReplaced.emit(null);

    expect(String(harness.reported[0])).toContain("IGX-1556");
    watcher.dispose();
  });

  it("stands down when app.hotReload is already re-instantiating scenes", () => {
    const harness = createFakeApp({ reloadScenes: true, reloadScene: vi.fn() });
    const scene = fakeScene("Level");
    harness.scenes.push(scene);
    const watcher = watcherFor(harness);
    watcher.setEnabled(true);

    expect(watcher.isDelegated).toBe(true);
    expect(watcher.isEnabled).toBe(false);
    expect(scene.asset?.onReplaced.connectionCount).toBe(0);
  });

  it("reports no delegation when the app has no hot-reload host at all", () => {
    const harness = createFakeApp(undefined);

    expect(watcherFor(harness).isDelegated).toBe(false);
  });
});

import { devtoolsError, DevtoolsErrorCode } from "./errors.js";
import type { App, Disconnect, SceneInstance } from "@ignifx/core";

/**
 * `devtools.reloadScenes` (`docs/architecture/15-devtools-and-diagnostics.md` §5: *"scene files
 * reload by re-instantiating the affected `SceneInstance` when `devtools.reloadScenes` is
 * enabled"*).
 *
 * ## Who does what
 *
 * `@ignifx/core` owns the rebuild: `app.hotReload.reloadScene(instance)` unloads an instance and
 * puts a fresh one built from the asset's current value in its place, honouring the file's
 * overrides (`packages/core/src/hot-reload/contract.ts`). Devtools never re-implements it.
 *
 * What core does **not** offer is a *runtime* switch: `app.hotReload.reloadScenes` is fixed by
 * `createApp({ hotReload: { reloadScenes: true } })` and is read-only afterwards. That is what this
 * watcher is: the same behaviour, turned on and off from the overlay. When the app was built with
 * core's flag already on, the watcher stands down entirely rather than reloading each scene twice —
 * {@link SceneReloadWatcher.isDelegated} says so, and the Stats panel shows it.
 */

/** What {@link createSceneReloadWatcher} needs. */
export interface SceneReloadOptions {
  /** The app whose scenes are watched. */
  readonly app: App;
  /**
   * Reports a failure the way every other devtools failure is reported.
   *
   * @param error - The failure.
   */
  readonly report: (error: unknown) => void;
  /**
   * Announces a reload, so the Console panel can show it.
   *
   * @param scene - The scene that was re-instantiated.
   */
  readonly onReloaded: (scene: string) => void;
}

/** The live watcher. */
export interface SceneReloadWatcher {
  /** Whether the watcher is currently subscribed. */
  readonly isEnabled: boolean;
  /** Whether `app.hotReload` is already doing this, so the watcher deliberately does nothing. */
  readonly isDelegated: boolean;
  /**
   * Subscribes or unsubscribes.
   *
   * @param value - Whether scene reload is on.
   */
  setEnabled(value: boolean): void;
  /** Unsubscribes from everything. */
  dispose(): void;
}

/**
 * Reads `app.hotReload.reloadScene`, when the app's core has one.
 *
 * @param app - The app.
 * @returns The function, or `null`.
 */
function hostReloader(app: App): ((scene: SceneInstance) => Promise<SceneInstance>) | null {
  const host: unknown = Reflect.get(app, "hotReload");
  if (host === null || typeof host !== "object") {
    return null;
  }
  const reload: unknown = Reflect.get(host, "reloadScene");
  if (typeof reload !== "function") {
    return null;
  }
  return async (scene: SceneInstance): Promise<SceneInstance> => {
    const result: unknown = Reflect.apply(reload, host, [scene]);
    if (!(result instanceof Promise)) {
      // The contract declares a promise; a host that returned nothing still resolves here.
      return scene;
    }
    await result;
    return scene;
  };
}

/**
 * Reports whether `app.hotReload` is already re-instantiating scenes by itself.
 *
 * @param app - The app.
 * @returns `true` when core's own flag is on.
 */
function hostHandlesScenes(app: App): boolean {
  const host: unknown = Reflect.get(app, "hotReload");
  if (host === null || typeof host !== "object") {
    return false;
  }
  return Reflect.get(host, "reloadScenes") === true;
}

/**
 * Builds the scene-reload watcher. It subscribes to nothing until {@link SceneReloadWatcher.setEnabled}
 * is called with `true`, which is what keeps a closed overlay free of subscriptions.
 *
 * @param options - The app and the two reporting callbacks.
 * @returns The watcher.
 *
 * @internal
 */
export function createSceneReloadWatcher(options: SceneReloadOptions): SceneReloadWatcher {
  const { app, report, onReloaded } = options;
  const perScene = new Map<SceneInstance, Disconnect>();
  let root: Disconnect | null = null;
  let enabled = false;

  /**
   * Re-instantiates one scene instance through core's hot-reload host.
   *
   * @param scene - The instance whose file changed.
   */
  function reload(scene: SceneInstance): void {
    const viaHost = hostReloader(app);
    if (viaHost === null) {
      report(
        devtoolsError(DevtoolsErrorCode.sceneReloadUnsupported, `${scene.name} cannot be re-instantiated.`, {
          context: { scene: scene.name },
          hint: "Scene reload needs app.hotReload.reloadScene, which this build of @ignifx/core has not got.",
        }),
      );
      return;
    }
    void viaHost(scene)
      .then((): void => {
        onReloaded(scene.name);
      })
      .catch((error: unknown): void => {
        report(error);
      });
  }

  /**
   * Watches one scene instance's asset handle.
   *
   * @param scene - The instance to watch.
   */
  function watch(scene: SceneInstance): void {
    if (perScene.has(scene)) {
      return;
    }
    const asset = scene.asset;
    if (asset === null) {
      return;
    }
    perScene.set(
      scene,
      asset.onReplaced.connect((): void => {
        reload(scene);
      }),
    );
  }

  /** Subscribes to every current scene and to future ones. */
  function subscribe(): void {
    root = app.world.onSceneLoaded.connect((scene: SceneInstance): void => {
      watch(scene);
    });
    const scenes = app.world.scenes;
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      if (scene !== undefined) {
        watch(scene);
      }
    }
  }

  /** Drops every subscription. */
  function unsubscribe(): void {
    root?.();
    root = null;
    for (const disconnect of perScene.values()) {
      disconnect();
    }
    perScene.clear();
  }

  return {
    get isEnabled(): boolean {
      return enabled;
    },
    get isDelegated(): boolean {
      return hostHandlesScenes(app);
    },
    setEnabled(value: boolean): void {
      const wanted = value && !hostHandlesScenes(app);
      if (wanted === enabled) {
        return;
      }
      enabled = wanted;
      if (wanted) {
        subscribe();
      } else {
        unsubscribe();
      }
    },
    dispose(): void {
      enabled = false;
      unsubscribe();
    },
  };
}

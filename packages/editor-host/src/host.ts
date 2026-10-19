/**
 * The scene view's host: the app the editor looks at, built from the project's own `@ignifx/core`,
 * and the channel the editor drives it through.
 */

import { createApp, VERSION } from "@ignifx/core";
import { checkChannelOptions, openChannel, resolveMessageTarget } from "./channel.js";
import { HostCapability, HostKind, PROTOCOL_VERSION } from "./protocol/index.js";
import { SceneHost } from "./scene/scene-host.js";
import type { Channel, EditorMessageTarget } from "./channel.js";
import type { EditorAssetChange } from "./scene/asset-reload.js";
import type {
  App,
  AssetsCreateOptions,
  ConcreteComponentType,
  CreateAppOptions,
  Extension,
  RenderSurface,
  SceneInstance,
  SettingsInput,
} from "@ignifx/core";

/**
 * Options accepted by {@link startEditorHost}. The app options are the ones the project's `main.ts`
 * passes to `createApp`; the editor host's Vite plugin generates the call that supplies them.
 *
 * @beta
 */
export interface EditorHostOptions {
  /**
   * The origin the editor is served from, for example `"ignifx://app"`. A port posted from any
   * other origin is ignored.
   */
  readonly editorOrigin: string;
  /** Which view this host runs. Only `"scene"` exists in this release. Defaults to `"scene"`. */
  readonly hostKind?: typeof HostKind.scene;
  /** The canvas to render into. Without one the app is headless. */
  readonly canvas?: RenderSurface;
  /** Run on Babylon Lite's null engine. Defaults to `true` when there is no `canvas`. */
  readonly headless?: boolean;
  /**
   * Build the app in edit mode (`createApp({ editMode })`, ADR-0028), so the scene view shows the
   * scene without playing it: only scripts whose class sets `static runInEditMode = true` get
   * callbacks, and physics and other game-clock systems hold or skip. Defaults to `true`; pass
   * `false` to run the scene view as a game.
   */
  readonly editMode?: boolean;
  /** The project's extensions, in the order its `main.ts` registers them. */
  readonly extensions?: readonly Extension[];
  /** The project's component classes, registered with `app.registerComponents`. */
  readonly scripts?: readonly ConcreteComponentType[];
  /** Project settings, as `ignifx.config.ts` supplies them (`import.meta.env.IGNIFX_CONFIG`). */
  readonly settings?: SettingsInput;
  /** The asset manifest and `fetch`, as the project's `main.ts` passes them. */
  readonly assets?: AssetsCreateOptions;
  /** A scene address to load before the app starts, through the normal loader. Defaults to none. */
  readonly bootScene?: string | null;
  /**
   * The project's `@ignifx/core` version, reported in `ready`. Used only while core's own
   * `VERSION` is the unstamped `"0.0.0"`; the Vite plugin reads it from the project's installed
   * `@ignifx/core/package.json`.
   */
  readonly engineVersion?: string;
  /** Milliseconds between heartbeats once the editor has said `hello`. Defaults to `1000`. */
  readonly heartbeatIntervalMs?: number;
  /** Where the editor's connect message arrives. Defaults to the page's `window`. */
  readonly messageTarget?: EditorMessageTarget;
}

/**
 * A running scene-view host. The host owns its app: disposing the host disposes the app.
 *
 * @beta
 */
export interface EditorHost {
  /** The app the scene view shows. */
  readonly app: App;
  /** The instance of `bootScene`, or `null` when none was given. */
  readonly bootScene: SceneInstance | null;
  /**
   * The persistent scene instance named `editor` that holds the host's own objects, such as the
   * editor camera. It survives every scene the editor opens and is never part of the document.
   */
  readonly editorScene: SceneInstance;
  /** The engine version the host reports in `ready`. */
  readonly engineVersion: string;
  /** Whether the editor has handed the host a port that is still open. */
  readonly isConnected: boolean;
  /**
   * Reloads an asset that changed on disk, in place, through `app.assets.reload`. The generated
   * scene-view module calls it on every `ignifx:asset-changed` event.
   *
   * @remarks
   * Only an asset the app has loaded is reloaded, and only one of the types the renderers follow:
   * a scene or prefab, whose instances in the open document are then rebuilt from the new file with
   * their uids, transforms and overrides, or a model, mesh, material, sprite atlas or shader, which
   * the renderers pick up on their next frame. A texture, a removed file and the open document's
   * own file are left alone. Once the new value is in, the host sends `assetReloaded` with the
   * address, the type and the rebuilt instance roots, so the editor can compare its document with
   * the view instead of reloading it.
   *
   * @param change - The address and what happened to it.
   * @returns Whether the asset was reloaded; `false` when it was left alone or the reload failed,
   * which the app reports as an error (`hostError`).
   */
  assetChanged(change: EditorAssetChange): Promise<boolean>;
  /** Stops the heartbeat, closes the port, and disposes the app. Idempotent. */
  dispose(): void;
  /** Same as {@link EditorHost.dispose}, for `using`. */
  [Symbol.dispose](): void;
}

/** What core's `VERSION` reads when core runs from source; its build stamps the real number. */
const UNSTAMPED_VERSION = "0.0.0";

/**
 * Chooses the engine version a host reports.
 *
 * @param fallback - The version the Vite plugin read from the project, if any.
 * @param coreVersion - Core's `VERSION`; a parameter only so tests can give an unstamped one.
 * @returns Core's `VERSION` when it is stamped, else the fallback, else `VERSION`.
 */
export function resolveEngineVersion(fallback: string | undefined, coreVersion: string = VERSION): string {
  if (coreVersion !== UNSTAMPED_VERSION) {
    return coreVersion;
  }
  return fallback ?? coreVersion;
}

/**
 * Starts the scene view's host: listens for the editor's port, creates the app from the project's
 * own `@ignifx/core` (in edit mode unless `editMode` is `false`), registers the project's scripts,
 * loads `bootScene` if one is given, starts the app, and serves the editor protocol's scene methods
 * (protocol 0.3, `docs/architecture/17-editor-host.md` §6).
 *
 * @remarks
 * The host answers `hello` with `ready` and `ping` with `"pong"` as soon as a port arrives, even
 * while the app is still being created; the scene methods answer `notReady` until the app has
 * started, and the host's first `schemasChanged` says they are accepted. It accepts a new port
 * whenever the editor sends one, closing the previous port.
 *
 * With a `canvas` the host draws Babylon Lite's gizmos and a selection outline in core's render
 * overlay (`app.renderer.openOverlay()`), answers `screenshot`, and has a 2D view mode
 * (`setViewMode`), which shows the sprites through an editor-owned `Camera2D` and picks them with
 * `app.twoD.pickAt` when the project registers `@ignifx/2d`. A headless host serves every method
 * that needs no GPU.
 *
 * @param options - The editor's origin and the project's app options.
 * @returns The running host, once the app has started.
 * @throws IgnifxError `IGX-1801` for a malformed `editorOrigin`, `IGX-1802` with no window and no
 * `messageTarget`, `IGX-1803` for a bad `heartbeatIntervalMs`. Whatever `createApp`, the scene
 * load, or `start` throws is rethrown after the channel is closed.
 *
 * @example
 * ```ts
 * import { startEditorHost } from "@ignifx/editor-host";
 *
 * const host = await startEditorHost({ editorOrigin: "ignifx://app", canvas, extensions: [], scripts });
 * ```
 *
 * @beta
 */
export async function startEditorHost(options: EditorHostOptions): Promise<EditorHost> {
  const heartbeatIntervalMs = checkChannelOptions(options.editorOrigin, options.heartbeatIntervalMs);
  const engineVersion = resolveEngineVersion(options.engineVersion);
  const capabilities = hasGpuView(options)
    ? [
        HostCapability.heartbeat,
        HostCapability.gizmos,
        HostCapability.screenshot,
        HostCapability.viewMode2d,
        HostCapability.pick2d,
      ]
    : [HostCapability.heartbeat];
  let channel: Channel | null = null;
  const scene = new SceneHost({
    capabilities,
    notify: (method, params) => {
      channel?.notify(method, params);
    },
  });
  // The channel opens before the first `await`, so a port posted while the app is created is kept.
  const opened = openChannel({
    target: resolveMessageTarget(options.messageTarget),
    editorOrigin: options.editorOrigin,
    ready: {
      engineVersion,
      protocol: PROTOCOL_VERSION,
      capabilities,
      hostKind: options.hostKind ?? HostKind.scene,
    },
    methods: scene.methods,
    heartbeatIntervalMs,
    onReady: () => {
      scene.sendSchemas();
    },
  });
  channel = opened;

  let app: App | null = null;
  let bootScene: SceneInstance | null = null;
  try {
    app = await createApp(appOptions(options));
    app.registerComponents(options.scripts ?? []);
    scene.prepare(app);
    // Loaded before `start()`, so the load settles without frames being pumped.
    if (options.bootScene !== undefined && options.bootScene !== null) {
      bootScene = await app.world.loadScene(options.bootScene);
    }
    await app.start();
    await scene.start(options.canvas ?? null);
  } catch (error) {
    scene.dispose();
    opened.dispose();
    app?.dispose();
    throw error;
  }

  const started = app;
  const editorScene = scene.editorScene ?? started.world.activeScene;
  const dispose = (): void => {
    scene.dispose();
    opened.dispose();
    started.dispose();
  };
  return {
    app: started,
    bootScene,
    editorScene,
    engineVersion,
    get isConnected(): boolean {
      return opened.isConnected;
    },
    assetChanged: async (change: EditorAssetChange): Promise<boolean> => scene.assetChanged(change),
    dispose,
    [Symbol.dispose]: dispose,
  };
}

/**
 * Tells whether a host renders: it has a canvas and is not forced headless.
 *
 * @param options - The host options.
 * @returns True when the view draws gizmos and can be captured.
 */
function hasGpuView(options: EditorHostOptions): boolean {
  return options.canvas !== undefined && options.headless !== true;
}

/**
 * Picks the `createApp` options out of the host options, leaving out the ones that were not given.
 *
 * @param options - The host options.
 * @returns The app options.
 */
function appOptions(options: EditorHostOptions): CreateAppOptions {
  return {
    editMode: options.editMode ?? true,
    ...(options.canvas === undefined ? {} : { canvas: options.canvas }),
    ...(options.headless === undefined ? {} : { headless: options.headless }),
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.assets === undefined ? {} : { assets: options.assets }),
  };
}

/**
 * The play view's controls: the project's own game page, reached by the editor through the app the
 * game's `main.ts` hands to `attachEditorPlayControls(app)` from `virtual:ignifx/editor`.
 */

import { checkChannelOptions, InvalidParamsError, openChannel, resolveMessageTarget } from "./channel.js";
import { resolveEngineVersion } from "./host.js";
import { HostCapability, PlayMethod } from "./messages.js";
import { HostKind, PROTOCOL_VERSION } from "./protocol.js";
import type { EditorMessageTarget, RequestHandler } from "./channel.js";
import type { PlayState } from "./messages.js";
import type { App } from "@ignifx/core";

/**
 * Options accepted by {@link startEditorPlayControls}.
 *
 * @beta
 */
export interface EditorPlayControlsOptions {
  /** The origin the editor is served from; a port posted from any other origin is ignored. */
  readonly editorOrigin: string;
  /** The project's `@ignifx/core` version, reported in `ready` while core's `VERSION` is unstamped. */
  readonly engineVersion?: string;
  /** Milliseconds between heartbeats once the editor has said `hello`. Defaults to `1000`. */
  readonly heartbeatIntervalMs?: number;
  /** Where the editor's connect message arrives. Defaults to the page's `window`. */
  readonly messageTarget?: EditorMessageTarget;
}

/**
 * The play view's side of an editor channel. The game keeps its app; the controls only drive it.
 *
 * @beta
 */
export interface EditorPlayControls {
  /** Whether the editor has handed the page a port that is still open. */
  readonly isConnected: boolean;
  /** Stops the heartbeat and closes the port. The app is left as it is. Idempotent. */
  dispose(): void;
  /** Same as {@link EditorPlayControls.dispose}, for `using`. */
  [Symbol.dispose](): void;
}

/**
 * Reads the game's state for a reply.
 *
 * @param app - The game's app.
 * @returns The state every play method answers with.
 */
function playState(app: App): PlayState {
  return { isRunning: app.isRunning, isPaused: app.time.paused, frameCount: app.time.frameCount };
}

/**
 * Reads the frame delta of a `step` request.
 *
 * @param app - The game's app, whose fixed step is the default.
 * @param params - The received `params`.
 * @returns The delta in seconds.
 * @throws InvalidParamsError when `deltaSeconds` is present and not a positive finite number.
 */
function stepDelta(app: App, params: unknown): number {
  if (typeof params !== "object" || params === null || !("deltaSeconds" in params)) {
    return app.time.fixedDeltaTime;
  }
  const delta = params.deltaSeconds;
  if (typeof delta !== "number" || !Number.isFinite(delta) || delta <= 0) {
    throw new InvalidParamsError("step needs deltaSeconds to be a positive number of seconds.");
  }
  return delta;
}

/**
 * Builds the play methods for one app.
 *
 * @param app - The game's app.
 * @returns The handlers, by method name.
 */
function playMethods(app: App): ReadonlyMap<string, RequestHandler> {
  return new Map<string, RequestHandler>([
    [
      PlayMethod.play,
      async (): Promise<PlayState> => {
        app.time.paused = false;
        await app.start();
        return playState(app);
      },
    ],
    [
      PlayMethod.pause,
      (): PlayState => {
        app.time.paused = true;
        return playState(app);
      },
    ],
    [
      PlayMethod.step,
      (params): PlayState => {
        const delta = stepDelta(app, params);
        // `app.step()` refuses to run beside the render loop, so stepping stops it first.
        app.stop();
        app.time.paused = false;
        app.step(delta);
        app.time.paused = true;
        return playState(app);
      },
    ],
    [
      PlayMethod.stop,
      (): PlayState => {
        app.stop();
        return playState(app);
      },
    ],
  ]);
}

/**
 * Lets the editor drive a running game: answers the handshake with `hostKind: "play"`, then `play`,
 * `pause`, `step` and `stop`.
 *
 * @remarks
 * A game does not call this directly. It calls `attachEditorPlayControls(app)` from
 * `virtual:ignifx/editor`, which the editor host's Vite plugin serves: in `vite dev` that module
 * calls this function, and in a production build it is an empty function, so no editor code ships.
 *
 * @param app - The game's app. The controls never dispose it.
 * @param options - The editor's origin and the reporting options.
 * @returns The controls; dispose them to stop listening.
 * @throws IgnifxError `IGX-1801` for a malformed `editorOrigin`, `IGX-1802` with no window and no
 * `messageTarget`, `IGX-1803` for a bad `heartbeatIntervalMs`.
 *
 * @example
 * ```ts
 * const controls = startEditorPlayControls(app, { editorOrigin: "ignifx://app" });
 * controls.dispose();
 * ```
 *
 * @beta
 */
export function startEditorPlayControls(app: App, options: EditorPlayControlsOptions): EditorPlayControls {
  const heartbeatIntervalMs = checkChannelOptions(options.editorOrigin, options.heartbeatIntervalMs);
  const channel = openChannel({
    target: resolveMessageTarget(options.messageTarget),
    editorOrigin: options.editorOrigin,
    ready: {
      engineVersion: resolveEngineVersion(options.engineVersion),
      protocol: PROTOCOL_VERSION,
      capabilities: [HostCapability.heartbeat, HostCapability.playControls],
      hostKind: HostKind.play,
    },
    methods: playMethods(app),
    heartbeatIntervalMs,
  });
  const dispose = (): void => {
    channel.dispose();
  };
  return {
    get isConnected(): boolean {
      return channel.isConnected;
    },
    dispose,
    [Symbol.dispose]: dispose,
  };
}

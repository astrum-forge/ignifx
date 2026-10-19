/**
 * The play view's controls: the project's own game page, reached by the editor through the app the
 * game's `main.ts` hands to `attachEditorPlayControls(app)` from `virtual:ignifx/editor`.
 */

import { hotReloadedParamsOf, relayAppReports } from "./app-reports.js";
import {
  checkChannelOptions,
  connectPortOf,
  InvalidParamsError,
  openChannel,
  Reply,
  resolveMessageTarget,
} from "./channel.js";
import { resolveEngineVersion } from "./host.js";
import {
  HostCapability,
  HostKind,
  PlayMethod,
  PlayNotification,
  PlayPhase,
  PROTOCOL_VERSION,
} from "./protocol/index.js";
import type { EditorMessageTarget, RequestHandler } from "./channel.js";
import type { PlayState, PlayStateReport } from "./protocol/index.js";
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
 * A play view whose page listens for the editor's port before the game's app exists, so the
 * editor's first connect message is kept rather than lost.
 *
 * @beta
 */
export interface EditorPlayConnector {
  /** Whether a port has arrived and waits for {@link EditorPlayConnector.attach}. */
  readonly hasPendingPort: boolean;
  /**
   * Starts the play controls for the game's app on the port that has arrived, if any, and from
   * then on on every new one. Only the first call takes the waiting port; a later call, or one after
   * `dispose`, opens controls that wait for the editor's next port.
   *
   * @param app - The game's app. The controls never dispose it.
   * @returns The controls.
   */
  attach(app: App): EditorPlayControls;
  /** Stops listening, closes a waiting port, and disposes the controls it attached. Idempotent. */
  dispose(): void;
  /** Same as {@link EditorPlayConnector.dispose}, for `using`. */
  [Symbol.dispose](): void;
}

/**
 * How many reports the play view keeps while no editor has said `hello`; older ones are dropped.
 */
const EARLY_REPORT_LIMIT = 256;

/** One report waiting for the handshake. */
interface EarlyReport {
  /** The notification's method. */
  readonly method: string;
  /** Its parameters. */
  readonly params: unknown;
}

/**
 * Sends the game's log lines, error reports and hot reloads to the editor, keeping the newest
 * {@link EARLY_REPORT_LIMIT} while no handshake has completed and sending them once one has.
 *
 * @param app - The game's app.
 * @param channel - The channel, read when a report arrives.
 * @returns A function that sends what was kept, for the handshake, and one that stops following.
 */
function relayPlayReports(
  app: App,
  channel: () => { readonly isReady: boolean; notify(method: string, params?: unknown): void },
): { readonly flush: () => void; readonly dispose: () => void } {
  const early: EarlyReport[] = [];
  const send = (method: string, params: unknown): void => {
    const current = channel();
    if (current.isReady) {
      current.notify(method, params);
      return;
    }
    early.push({ method, params });
    if (early.length > EARLY_REPORT_LIMIT) {
      early.shift();
    }
  };
  const dispose = relayAppReports(app, {
    log: (params): void => {
      send(PlayNotification.log, params);
    },
    error: (params): void => {
      send(PlayNotification.hostError, params);
    },
    hotReloaded: (report): void => {
      send(PlayNotification.hotReloaded, hotReloadedParamsOf(report));
    },
  });
  const flush = (): void => {
    const current = channel();
    for (const report of early.splice(0)) {
      current.notify(report.method, report.params);
    }
  };
  return { flush, dispose };
}

/**
 * Reads the game's state for a reply.
 *
 * @param app - The game's app.
 * @returns The state `play`, `pause`, `step` and `stop` answer with.
 */
function playState(app: App): PlayState {
  return { isRunning: app.isRunning, isPaused: app.time.paused, frameCount: app.time.frameCount };
}

/**
 * Tells whether the game plays, is paused, or is stopped.
 *
 * @param app - The game's app.
 * @param isStopped - Whether the last control that stopped the loop was `stop`.
 * @returns The phase.
 */
function playPhase(app: App, isStopped: boolean): PlayPhase {
  if (app.isRunning) {
    return app.time.paused ? PlayPhase.paused : PlayPhase.playing;
  }
  // A stepped game has no loop but sits paused on its frame; a stopped one is stopped, paused or not.
  return app.time.paused && !isStopped ? PlayPhase.paused : PlayPhase.stopped;
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
 * @param tracker - Reads the game's phase and reports its changes.
 * @returns The handlers, by method name.
 */
function playMethods(app: App, tracker: PhaseTracker): ReadonlyMap<string, RequestHandler> {
  // Every control answers first, then reports the change it made, in that order on the port.
  const answer = (): Reply => new Reply(playState(app), tracker.report);
  return new Map<string, RequestHandler>([
    [
      PlayMethod.play,
      async (): Promise<Reply> => {
        tracker.isStopped = false;
        app.time.paused = false;
        await app.start();
        return answer();
      },
    ],
    [
      PlayMethod.pause,
      (): Reply => {
        app.time.paused = true;
        return answer();
      },
    ],
    [
      PlayMethod.step,
      (params): Reply => {
        const delta = stepDelta(app, params);
        // `app.step()` refuses to run beside the render loop, so stepping stops it first.
        app.stop();
        tracker.isStopped = false;
        app.time.paused = false;
        app.step(delta);
        app.time.paused = true;
        return answer();
      },
    ],
    [
      PlayMethod.stop,
      (): Reply => {
        app.stop();
        tracker.isStopped = true;
        return answer();
      },
    ],
    [PlayMethod.playState, (): PlayStateReport => tracker.read()],
  ]);
}

/** Reads the game's phase and sends `playStateChanged` when it differs from the last one sent. */
interface PhaseTracker {
  /** Whether the last control that stopped the loop was `stop` rather than `step`. */
  isStopped: boolean;
  /** Reads the game's state as `playState` answers it. */
  readonly read: () => PlayStateReport;
  /** Sends `playStateChanged` when the phase changed since the editor last saw it. */
  readonly report: () => void;
  /** Takes the current phase as the one the editor knows, after a handshake. */
  readonly reset: () => void;
}

/**
 * The options every play view checks before it opens a channel.
 *
 * @param options - The options as given.
 * @returns The heartbeat period and the message target.
 */
function checkPlayOptions(options: EditorPlayControlsOptions): {
  heartbeatIntervalMs: number;
  target: EditorMessageTarget;
} {
  const heartbeatIntervalMs = checkChannelOptions(options.editorOrigin, options.heartbeatIntervalMs);
  return { heartbeatIntervalMs, target: resolveMessageTarget(options.messageTarget) };
}

/**
 * Opens the play controls' channel.
 *
 * @param app - The game's app.
 * @param options - The editor's origin and the reporting options.
 * @param target - Where the connect message arrives.
 * @param heartbeatIntervalMs - The heartbeat period, which is also how often a change the game
 * makes itself is looked for.
 * @param port - A port that arrived before the app existed, or `null`.
 * @returns The controls.
 */
function openPlayControls(
  app: App,
  options: EditorPlayControlsOptions,
  target: EditorMessageTarget,
  heartbeatIntervalMs: number,
  port: MessagePort | null,
): EditorPlayControls {
  let lastPhase: PlayPhase | null = null;
  const tracker: PhaseTracker = {
    isStopped: false,
    read: (): PlayStateReport => ({
      state: playPhase(app, tracker.isStopped),
      frameCount: app.time.frameCount,
      time: app.time.time,
    }),
    report: (): void => {
      if (!channel.isReady) {
        return;
      }
      const report = tracker.read();
      if (report.state !== lastPhase) {
        lastPhase = report.state;
        channel.notify(PlayNotification.playStateChanged, report);
      }
    },
    reset: (): void => {
      lastPhase = playPhase(app, tracker.isStopped);
    },
  };
  const channel = openChannel({
    target,
    editorOrigin: options.editorOrigin,
    ready: {
      engineVersion: resolveEngineVersion(options.engineVersion),
      protocol: PROTOCOL_VERSION,
      capabilities: [HostCapability.heartbeat, HostCapability.playControls, HostCapability.logRelay],
      hostKind: HostKind.play,
    },
    methods: playMethods(app, tracker),
    heartbeatIntervalMs,
    onReady: (): void => {
      tracker.reset();
      reports.flush();
    },
    port,
  });
  const reports = relayPlayReports(app, () => channel);
  // The game can pause, stop or start itself; nothing in core announces it, so the controls look.
  const watch = setInterval(tracker.report, heartbeatIntervalMs);
  const dispose = (): void => {
    clearInterval(watch);
    reports.dispose();
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

/**
 * Lets the editor drive a running game: answers the handshake with `hostKind: "play"`, then `play`,
 * `pause`, `step`, `stop` and `playState`, and sends `playStateChanged` when the game's phase
 * changes, and `log`, `hostError` and `hotReloaded` for the game's log lines, `app.onError` reports
 * and hot reloads (the newest 256 from before the handshake right after it).
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
  const { heartbeatIntervalMs, target } = checkPlayOptions(options);
  return openPlayControls(app, options, target, heartbeatIntervalMs, null);
}

/**
 * Listens for the editor's connect message before the game's app exists, and keeps the newest port
 * until {@link EditorPlayConnector.attach} hands it the app.
 *
 * @remarks
 * The editor posts its port on the play view's `load` event, which can fire while the game's
 * `main.ts` still awaits `createApp`. `virtual:ignifx/editor` calls this when the module is
 * evaluated, which is before `main.ts` runs, and `attachEditorPlayControls(app)` calls `attach`, so
 * the handshake runs on the port the editor sent first. A port is accepted only from exactly
 * `editorOrigin`; a newer one replaces and closes the one waiting. Nothing is read from the port
 * before `attach`: the editor's `hello` waits in it.
 *
 * @param options - The editor's origin and the reporting options.
 * @returns The connector; dispose it to stop listening.
 * @throws IgnifxError `IGX-1801` for a malformed `editorOrigin`, `IGX-1802` with no window and no
 * `messageTarget`, `IGX-1803` for a bad `heartbeatIntervalMs`.
 *
 * @example
 * ```ts
 * const connector = listenForEditorPlayControls({ editorOrigin: "ignifx://app" });
 * const app = await createApp({ headless: true });
 * const controls = connector.attach(app);
 * connector.dispose();
 * ```
 *
 * @beta
 */
export function listenForEditorPlayControls(options: EditorPlayControlsOptions): EditorPlayConnector {
  const { heartbeatIntervalMs, target } = checkPlayOptions(options);
  const attached: EditorPlayControls[] = [];
  let pending: MessagePort | null = null;
  let isListening = true;
  let isDisposed = false;

  const onWindowMessage = (event: Event): void => {
    const port = connectPortOf(event, options.editorOrigin);
    if (port !== null) {
      pending?.close();
      pending = port;
    }
  };
  const stopListening = (): void => {
    if (isListening) {
      isListening = false;
      target.removeEventListener("message", onWindowMessage);
    }
  };
  target.addEventListener("message", onWindowMessage);

  const dispose = (): void => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    stopListening();
    pending?.close();
    pending = null;
    for (const controls of attached.splice(0)) {
      controls.dispose();
    }
  };
  return {
    get hasPendingPort(): boolean {
      return pending !== null;
    },
    attach(app: App): EditorPlayControls {
      // The channel's own listener replaces this one in the same turn, so no message falls between.
      stopListening();
      const port = pending;
      pending = null;
      const controls = openPlayControls(app, options, target, heartbeatIntervalMs, port);
      if (!isDisposed) {
        attached.push(controls);
      }
      return controls;
    },
    dispose,
    [Symbol.dispose]: dispose,
  };
}

import type { DevtoolsSample, DevtoolsSampler } from "./sampler.js";
import type { WorldIndex } from "./world-index.js";
import type { DevtoolsLogSink } from "../log-sink.js";
import type { DevtoolsPanelName } from "../settings.js";
import type { App, Entity, ErrorReport } from "@ignifx/core";

/**
 * What one panel of the overlay is, and what it is handed
 * (`docs/architecture/15-devtools-and-diagnostics.md` §4).
 *
 * A panel is a plain object rather than a class hierarchy: it builds its DOM once in `mount`,
 * rewrites it in `update`, and drops its subscriptions in `dispose`. `update` runs at the overlay's
 * throttled text rate — ten times a second — unless the panel sets `perFrame`, which the Timeline
 * graph does.
 */

/**
 * One error the Console panel shows, as the overlay retained it.
 *
 * @internal
 */
export interface DevtoolsErrorEntry {
  /** The report `app.onError` emitted. */
  readonly report: ErrorReport;
  /** The message, already formatted. */
  readonly message: string;
  /** The app clock's reading when it arrived, in seconds. */
  readonly timeSeconds: number;
}

/**
 * One hot-reload line the Console and Stats panels show.
 *
 * @internal
 */
export interface DevtoolsHotReloadEntry {
  /** What was reloaded. */
  readonly label: string;
  /** The policy, instance count and failure, when the report carried them. */
  readonly detail: string;
  /** Whether the report described a failure. */
  readonly failed: boolean;
  /** The app clock's reading when it arrived, in seconds. */
  readonly timeSeconds: number;
}

/**
 * Everything a panel may read and do. It is deliberately narrower than `DevtoolsService`: a panel
 * never opens or closes the overlay, and it never touches another panel.
 *
 * @internal
 */
export interface DevtoolsPanelHost {
  /** The app being inspected. */
  readonly app: App;
  /** The document the panel's elements live in. */
  readonly document: Document;
  /** This frame's numbers. */
  readonly sample: DevtoolsSample;
  /** The sampler, for the Timeline panel's walk over the frame history. */
  readonly sampler: DevtoolsSampler;
  /** The flattened entity tree. */
  readonly index: WorldIndex;
  /** The entity the inspector is showing, or `null`. */
  readonly selected: Entity | null;
  /** The Console panel's log sink, or `null` when the game installed none. */
  readonly logSink: DevtoolsLogSink | null;
  /** The retained `app.onError` reports, newest last. */
  readonly errors: readonly DevtoolsErrorEntry[];
  /** The retained hot-reload reports, newest last. */
  readonly hotReloads: readonly DevtoolsHotReloadEntry[];
  /** Whether scene files re-instantiate their live instances when they change. */
  readonly reloadScenes: boolean;
  /** Whether `app.hotReload` is already doing that, so the devtools toggle stands down. */
  readonly sceneReloadDelegated: boolean;
  /**
   * Selects an entity, which is what the Scene tree panel and "select in world" both do.
   *
   * @param entity - The entity, or `null` to clear the selection.
   */
  select(entity: Entity | null): void;
  /**
   * Turns scene reload on or off.
   *
   * @param value - The new state.
   */
  setReloadScenes(value: boolean): void;
  /**
   * Reports a devtools failure the way every other subsystem does, so a game's `app.onError`
   * handler sees it and the overlay never throws into the frame loop.
   *
   * @param error - The failure.
   */
  report(error: unknown): void;
}

/**
 * One panel of the overlay.
 *
 * @internal
 */
export interface DevtoolsPanel {
  /** The name the `panels` setting and `app.devtools.panel(name)` address it by. */
  readonly name: DevtoolsPanelName;
  /** The tab label. */
  readonly title: string;
  /** Whether the panel refreshes every frame rather than at the throttled text rate. */
  readonly perFrame: boolean;
  /**
   * Builds the panel's DOM. Called once, when the overlay is first opened.
   *
   * @param root - The panel's own container, already in the document.
   * @param host - What the panel may read and do.
   */
  mount(root: HTMLElement, host: DevtoolsPanelHost): void;
  /**
   * Rewrites the panel's DOM from the current sample. Called only while the panel is the visible
   * one, so a hidden panel costs nothing.
   *
   * @param host - What the panel may read and do.
   */
  update(host: DevtoolsPanelHost): void;
  /** Drops whatever the panel subscribed to. */
  dispose(): void;
}

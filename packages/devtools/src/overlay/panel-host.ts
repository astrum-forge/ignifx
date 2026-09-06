import { devtoolsError, DevtoolsErrorCode } from "../errors.js";
import type { DevtoolsErrorEntry, DevtoolsHotReloadEntry, DevtoolsPanelHost } from "./panel.js";
import type { DevtoolsSample, DevtoolsSampler } from "./sampler.js";
import type { WorldIndex } from "./world-index.js";
import type { DevtoolsLogSink } from "../log-sink.js";
import type { App, Entity } from "@ignifx/core";

/**
 * Builds the {@link DevtoolsPanelHost} the service hands its panels.
 *
 * It is a free function rather than an object literal inside `DevtoolsService` for one reason: a
 * literal with getters needs `this` to be the service, which means aliasing `this` into a local —
 * the thing `typescript/no-this-alias` exists to stop. Passing the *stable* references and a small
 * set of arrow-captured accessors instead keeps every getter reading live service state without
 * anyone aliasing anything.
 */

/** The stable references and live accessors {@link createPanelHost} needs. */
export interface PanelHostSource {
  /** The app being inspected. */
  readonly app: App;
  /** The frame sampler. */
  readonly sampler: DevtoolsSampler;
  /** The flattened entity tree. */
  readonly index: WorldIndex;
  /** The Console panel's sink, or `null`. */
  readonly logSink: DevtoolsLogSink | null;
  /**
   * Finds the document the panels' elements live in.
   *
   * @returns The document, or `null` when the app has no DOM.
   */
  readonly getDocument: () => Document | null;
  /** The service's live error ring. */
  readonly errors: readonly DevtoolsErrorEntry[];
  /** The service's live hot-reload ring. */
  readonly hotReloads: readonly DevtoolsHotReloadEntry[];
  /**
   * Reads the current selection.
   *
   * @returns The selected entity, or `null`.
   */
  readonly getSelected: () => Entity | null;
  /**
   * Reads the scene-reload toggle.
   *
   * @returns `true` while scene reload is on.
   */
  readonly getReloadScenes: () => boolean;
  /**
   * Reads whether `app.hotReload` already re-instantiates scenes.
   *
   * @returns `true` when devtools' own toggle stands down.
   */
  readonly getSceneReloadDelegated: () => boolean;
  /**
   * Changes the selection.
   *
   * @param entity - The entity, or `null`.
   */
  readonly select: (entity: Entity | null) => void;
  /**
   * Writes the scene-reload toggle.
   *
   * @param value - The new state.
   */
  readonly setReloadScenes: (value: boolean) => void;
  /**
   * Reports a devtools failure.
   *
   * @param error - The failure.
   */
  readonly report: (error: unknown) => void;
}

/**
 * Wraps the service's state in the read-only view panels see.
 *
 * @param source - The stable references and accessors.
 * @returns The host.
 *
 * @internal
 */
export function createPanelHost(source: PanelHostSource): DevtoolsPanelHost {
  return {
    app: source.app,
    sampler: source.sampler,
    index: source.index,
    logSink: source.logSink,
    errors: source.errors,
    hotReloads: source.hotReloads,
    get document(): Document {
      const document = source.getDocument();
      if (document === null) {
        throw devtoolsError(DevtoolsErrorCode.headlessNoOp, "The devtools overlay has no document.", {
          context: { member: "panel.document" },
          hint: "Panels are only built after open() found a DOM canvas; this app has none.",
        });
      }
      return document;
    },
    get sample(): DevtoolsSample {
      return source.sampler.sample;
    },
    get selected(): Entity | null {
      return source.getSelected();
    },
    get reloadScenes(): boolean {
      return source.getReloadScenes();
    },
    get sceneReloadDelegated(): boolean {
      return source.getSceneReloadDelegated();
    },
    select: source.select,
    setReloadScenes: source.setReloadScenes,
    report: source.report,
  };
}

import { Signal } from "../signal/signal.js";
import type { AppEvents, DeviceLostInfo } from "./types.js";
import type { SceneInstance } from "../scene/scene-instance.js";

/**
 * `app.events` (`docs/architecture/02-scene-graph.md` §8: "Engine-wide events live on `app.events`
 * as typed signals"). The world already emits `onSceneLoaded`/`onSceneUnloaded`; the app forwards
 * them so that a script does not have to know whether an event belongs to the world or to the
 * device, and so extensions can add their own through declaration merging.
 *
 * The three device signals are emitted by the rendering layer through the `@internal` `emit*`
 * methods (`07-rendering.md` §4). Keeping the emitters off the public {@link AppEvents} interface is
 * what makes `app.events` a read-only surface for game code.
 */

/**
 * The engine-wide event table of one app.
 *
 * @internal
 */
export class AppEventsImpl implements AppEvents {
  /** Emitted after a scene instance and its entities exist. */
  readonly onSceneLoaded: Signal<SceneInstance>;

  /** Emitted just before a scene instance's entities are destroyed. */
  readonly onSceneUnloaded: Signal<SceneInstance>;

  /** Emitted when the WebGPU device was lost. */
  readonly onDeviceLost: Signal<DeviceLostInfo>;

  /** Emitted when the WebGPU device and its resources were rebuilt. */
  readonly onDeviceRecovered: Signal;

  /** Emitted when recovery failed and the app cannot render again. */
  readonly onDeviceRecoveryFailed: Signal<unknown>;

  /**
   * Creates the table.
   *
   * @param onHandlerError - Where a handler's exception goes; the app routes it to `app.onError` so
   * one listener throwing never stops the others (`02-scene-graph.md` §8).
   */
  constructor(onHandlerError: (error: unknown) => void) {
    this.onSceneLoaded = new Signal<SceneInstance>({ onHandlerError });
    this.onSceneUnloaded = new Signal<SceneInstance>({ onHandlerError });
    this.onDeviceLost = new Signal<DeviceLostInfo>({ onHandlerError });
    this.onDeviceRecovered = new Signal({ onHandlerError });
    this.onDeviceRecoveryFailed = new Signal<unknown>({ onHandlerError });
  }

  /**
   * Announces that the WebGPU device was lost.
   *
   * @param info - Lite's reason and message.
   */
  emitDeviceLost(info: DeviceLostInfo): void {
    this.onDeviceLost.emit(info);
  }

  /** Announces that the device and its resources were rebuilt. */
  emitDeviceRecovered(): void {
    this.onDeviceRecovered.emit();
  }

  /**
   * Announces that recovery failed.
   *
   * @param reason - Whatever the recovery path reported.
   */
  emitDeviceRecoveryFailed(reason: unknown): void {
    this.onDeviceRecoveryFailed.emit(reason);
  }

  /** Detaches every handler; the app calls it on disposal. */
  clear(): void {
    this.onSceneLoaded.clear();
    this.onSceneUnloaded.clear();
    this.onDeviceLost.clear();
    this.onDeviceRecovered.clear();
    this.onDeviceRecoveryFailed.clear();
  }
}

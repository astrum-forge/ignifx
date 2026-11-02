/**
 * The play view's `sendInput` (engine ask E49): synthetic key and pointer events queued into the
 * game's own `app.input`, the way headless tests drive the engine. The host does not depend on
 * `@ignifx/input`: it finds `app.input` by name and calls `simulateEvent` by shape, as it reaches
 * `app.twoD` (`./scene/view-2d.ts`). Nothing here dispatches a DOM event or touches the editor.
 */

import { InvalidParamsError } from "./channel.js";
import { isSendInputParams, SEND_INPUT_MAX_EVENTS } from "./protocol/index.js";
import type { SendInputEvent, SendInputKeyEvent, SendInputResult } from "./protocol/index.js";
import type { App } from "@ignifx/core";

/** One raw event as `@ignifx/input`'s `SimulatedEvent` takes it, as far as the host fills it in. */
interface SimulatedEventLike {
  /** The event kind. */
  readonly type: SendInputEvent["type"];
  /** A key event's `<Keyboard>` control name. */
  readonly code?: string;
  /** The pointer x, in backing-store pixels. */
  readonly x?: number;
  /** The pointer y, in backing-store pixels. */
  readonly y?: number;
  /** The pointer movement x, in CSS pixels. */
  readonly deltaX?: number;
  /** The pointer movement y, in CSS pixels. */
  readonly deltaY?: number;
  /** The `PointerEvent.button`. */
  readonly button?: number;
}

/** What the host uses of `app.input`, `@ignifx/input`'s `InputService`. */
export interface InputServiceLike {
  /**
   * Queues one synthetic raw event.
   *
   * @param event - The event.
   */
  simulateEvent(event: SimulatedEventLike): void;
  /**
   * Tells whether a binding path names a control, when the service can say (`resolveControl`).
   *
   * @param path - The binding path.
   * @returns False when the path names no control; true when it does or the service cannot say.
   */
  hasControl(path: string): boolean;
}

/**
 * The game's input service, when the project registers `@ignifx/input`.
 *
 * @param app - The game's app.
 * @returns `app.input`, or `null` when it has no `simulateEvent`.
 */
export function inputServiceOf(app: App): InputServiceLike | null {
  const service: unknown = Reflect.get(app, "input");
  if (typeof service !== "object" || service === null) {
    return null;
  }
  const simulateEvent: unknown = Reflect.get(service, "simulateEvent");
  if (typeof simulateEvent !== "function") {
    return null;
  }
  const resolveControl: unknown = Reflect.get(service, "resolveControl");
  return {
    simulateEvent: (event): void => {
      Reflect.apply(simulateEvent, service, [event]);
    },
    hasControl: (path): boolean => {
      if (typeof resolveControl !== "function") {
        return true;
      }
      try {
        Reflect.apply(resolveControl, service, [path]);
        return true;
      } catch {
        // `IGX-0803`: the path names no control of this build's keyboard.
        return false;
      }
    },
  };
}

/**
 * Splits a `sendInput` event into a key event or a pointer one.
 *
 * @param event - The event.
 * @returns True for `keydown` and `keyup`.
 */
function isKeyEvent(event: SendInputEvent): event is SendInputKeyEvent {
  return event.type === "keydown" || event.type === "keyup";
}

/** The game canvas's size in backing-store pixels, and how many CSS pixels one of them is. */
interface CanvasMetrics {
  /** The backing width; `1` without a canvas, as a headless camera assumes. */
  readonly width: number;
  /** The backing height; `1` without a canvas. */
  readonly height: number;
  /** CSS pixels per backing pixel (`clientWidth / width`); `1` when the canvas has no layout. */
  readonly cssPerPixel: number;
}

/**
 * Measures the game's canvas.
 *
 * @param app - The game's app.
 * @returns Its size and pixel ratio.
 */
function canvasMetrics(app: App): CanvasMetrics {
  const surface = app.renderer.surface;
  const width = surface !== null && surface.width > 0 ? surface.width : 1;
  const height = surface !== null && surface.height > 0 ? surface.height : 1;
  // An `OffscreenCanvas` has no layout, so its CSS size is its backing size.
  const clientWidth: unknown = surface === null ? undefined : Reflect.get(surface, "clientWidth");
  const cssPerPixel = typeof clientWidth === "number" && clientWidth > 0 ? clientWidth / width : 1;
  return { width, height, cssPerPixel };
}

/**
 * Queues `sendInput`'s events into one game's input service. Keeps the last pointer position it
 * sent, so a move reports the motion since it, as a real pointer does.
 */
export class PlayInput {
  readonly #app: App;
  readonly #input: InputServiceLike;
  #last: { readonly x: number; readonly y: number } | null = null;

  /**
   * Creates the queue for one game.
   *
   * @param app - The game's app.
   * @param input - Its input service.
   */
  constructor(app: App, input: InputServiceLike) {
    this.#app = app;
    this.#input = input;
  }

  /**
   * `sendInput`: checks every event, then queues them all in order. The game resolves them on its
   * next frame, as it does events from the page.
   *
   * @param params - The received `params`.
   * @returns How many events were queued.
   * @throws InvalidParamsError for malformed parameters or a key the game's keyboard does not have;
   * nothing is queued then.
   */
  send(params: unknown): SendInputResult {
    if (!isSendInputParams(params)) {
      throw new InvalidParamsError(
        `sendInput needs 1 to ${String(SEND_INPUT_MAX_EVENTS)} events: { type: "keydown" | "keyup", control } or { type: "pointermove" | "pointerdown" | "pointerup", x, y (0 to 1), button? (0 to 4) }.`,
      );
    }
    for (const event of params.events) {
      if (isKeyEvent(event) && !this.#input.hasControl(`<Keyboard>/${event.control}`)) {
        throw new InvalidParamsError(
          `sendInput: the game's keyboard has no key "${event.control}". Use the <Keyboard> control name, such as w, space or arrowUp.`,
        );
      }
    }
    const metrics = canvasMetrics(this.#app);
    for (const event of params.events) {
      this.#input.simulateEvent(this.#simulated(event, metrics));
    }
    return { queued: params.events.length };
  }

  /**
   * Builds the raw event for one request event.
   *
   * @param event - The request's event.
   * @param metrics - The canvas's size and pixel ratio.
   * @returns The event `simulateEvent` takes.
   */
  #simulated(event: SendInputEvent, metrics: CanvasMetrics): SimulatedEventLike {
    if (isKeyEvent(event)) {
      return { type: event.type, code: event.control };
    }
    const x = event.x * metrics.width;
    const y = event.y * metrics.height;
    const last = this.#last;
    this.#last = { x, y };
    // A press starts a track, so it reports no motion; a move or release reports it in CSS pixels.
    const moves = event.type !== "pointerdown" && last !== null;
    return {
      type: event.type,
      x,
      y,
      deltaX: moves ? (x - last.x) * metrics.cssPerPixel : 0,
      deltaY: moves ? (y - last.y) * metrics.cssPerPixel : 0,
      button: event.button ?? 0,
    };
  }
}

import { Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/** How often the HUD line is rewritten, in seconds. Sixty times a second is wasted DOM work. */
const HUD_INTERVAL = 0.25;

/**
 * Writes one line of status into the HUD element, four times a second.
 *
 * A script rather than a `setInterval`, so it runs on the game's frame loop: it stops when the app
 * stops, and it does not keep a timer alive after `app.dispose()`.
 */
export class HudLine extends Script implements ScriptCallbacks {
  static typeId = "third-person/HudLine";

  /** The element to write into. Assigned right after the component is added. */
  element: HTMLDivElement | null = null;

  /** Produces the line. Assigned right after the component is added. */
  render: (() => string) | null = null;

  /** Seconds since the last write. */
  #elapsed = HUD_INTERVAL;

  update(dt: number): void {
    this.#elapsed += dt;
    if (this.#elapsed < HUD_INTERVAL) {
      return;
    }
    this.#elapsed = 0;
    const element = this.element;
    const render = this.render;
    if (element !== null && render !== null) {
      element.textContent = render();
    }
  }
}

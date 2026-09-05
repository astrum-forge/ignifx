import { describe, expect, it } from "vitest";
import { Script, createApp } from "../../src/index.js";
import { registerFrameCallback } from "../../src/lite/loop.js";
import type { App } from "../../src/index.js";

/**
 * The browser driver (`docs/architecture/01-lifecycle-and-time.md` §1): a real WebGPU engine, Babylon
 * Lite's requestAnimationFrame loop, exactly one ignifx before-render callback, and the document
 * events that reach `onApplicationPause`/`onApplicationFocus` (§4, §7).
 */

/** How many `update` calls the counting script waits for before the test asserts. */
const REQUIRED_FRAMES = 4;

/** The shared log of Lite callback ticks, in the order Lite ran them. */
const order: string[] = [];

/** A script that resolves a promise once it has seen enough frames. */
class Counter extends Script {
  static typeId = "test/BrowserCounter";

  /** How many `update` calls it has received. */
  frames = 0;

  /** How many `onApplicationPause(true)` calls it has received. */
  paused: boolean[] = [];

  /** How many `onApplicationFocus` calls it has received. */
  focus: boolean[] = [];

  /** Resolved once {@link Counter.frames} reaches {@link REQUIRED_FRAMES}. Test-only. */
  onEnough: (() => void) | null = null;

  /** The shared frame-ordering log. */
  order: string[] = [];

  update(): void {
    this.frames += 1;
    this.order.push("frame");
    if (this.frames >= REQUIRED_FRAMES) {
      this.onEnough?.();
      this.onEnough = null;
    }
  }

  onApplicationPause(isPaused: boolean): void {
    this.paused.push(isPaused);
  }

  onApplicationFocus(isFocused: boolean): void {
    this.focus.push(isFocused);
  }
}

/**
 * Creates a canvas attached to the document, which WebGPU needs for a real surface.
 *
 * @returns The canvas.
 */
function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  document.body.append(canvas);
  return canvas;
}

describe("the browser driver", () => {
  it("runs frames from Lite's render loop, registers one callback, and delivers the application callbacks", async () => {
    const canvas = createCanvas();
    let app: App | null = null;
    try {
      app = await createApp({ canvas });
      expect(app.isHeadless).toBe(false);
      expect(app.platform.kind).toBe("browser");

      const counter = app.world.createEntity("Counter").addComponent(Counter);
      counter.order = order;
      const enough = new Promise<void>((resolve) => {
        counter.onEnough = resolve;
      });

      await app.start();
      expect(app.isRunning).toBe(true);
      // ADR-0003 Validation: Lite runs before-render callbacks in reverse registration order, so a
      // probe registered *after* the app's own callback runs *before* it every frame. A strict
      // "probe, frame, probe, frame" alternation is what proves the app registered exactly one.
      registerFrameCallback(app.lite.scene, () => {
        order.push("probe");
      });
      await enough;

      expect(counter.frames).toBeGreaterThanOrEqual(REQUIRED_FRAMES);
      expect(app.time.frameCount).toBeGreaterThanOrEqual(REQUIRED_FRAMES);
      expect(app.time.deltaTime).toBeGreaterThan(0);

      const paired = order.slice(order.indexOf("probe"));
      expect(paired.length).toBeGreaterThanOrEqual(4);
      for (let index = 0; index + 1 < paired.length; index += 2) {
        expect(paired[index]).toBe("probe");
        expect(paired[index + 1]).toBe("frame");
      }

      // §8: `step()` is refused while Lite is driving the frames.
      expect(() => app?.step(1 / 60)).toThrow(/headless/u);

      // §4: the document events reach every script implementing the callbacks.
      const hidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
      if (hidden !== undefined) {
        Object.defineProperty(document, "hidden", hidden);
      }
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));

      expect(counter.paused).toEqual([true, false]);
      expect(counter.focus).toEqual([false, true]);

      app.stop();
      expect(app.isRunning).toBe(false);
      // The listeners are removed with the loop, so a later event changes nothing.
      document.dispatchEvent(new Event("visibilitychange"));
      expect(counter.paused).toEqual([true, false]);
    } finally {
      app?.dispose();
      app = null;
      canvas.remove();
    }
  });
});

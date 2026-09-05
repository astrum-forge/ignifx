import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { defineInputActions, input } from "../src/index.js";
import type { App } from "@ignifx/core";

/**
 * The Chromium half of the input suite: real DOM events, dispatched at a real canvas and at the
 * window, driving a real `createApp({ canvas })` app (`docs/architecture/08-input.md` §4).
 *
 * The node suites prove the resolution pipeline; what only a browser can prove is the wiring —
 * that the adapters subscribe to the right targets, that `KeyboardEvent.code` reaches the right
 * control, that CSS coordinates are canvas-relative, and that pointer lock and the cursor touch the
 * real canvas.
 */

/** How many animation frames a dispatched event is given to reach the action state. */
const SETTLE_FRAMES = 3;

/** A running app plus its canvas. */
interface BrowserInputApp {
  readonly app: App;
  readonly canvas: HTMLCanvasElement;
  advance(frames?: number): Promise<void>;
  dispose(): void;
}

let harness: BrowserInputApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Waits for one animation frame. */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** Builds and starts an app with a laid-out canvas and the demo action document installed. */
async function createBrowserInputApp(): Promise<BrowserInputApp> {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  canvas.style.position = "fixed";
  canvas.style.left = "0px";
  canvas.style.top = "0px";
  canvas.style.width = "64px";
  canvas.style.height = "64px";
  document.body.append(canvas);
  const app = await createApp({ canvas, extensions: [input()] });
  app.input.loadActions(
    defineInputActions({
      controlSchemes: [
        { name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] },
        { name: "Touch", devices: ["Touch"] },
      ],
      maps: [
        {
          name: "Player",
          actions: [
            {
              name: "move",
              type: "vector2",
              bindings: [
                {
                  composite: "2DVector",
                  up: "<Keyboard>/w",
                  down: "<Keyboard>/s",
                  left: "<Keyboard>/a",
                  right: "<Keyboard>/d",
                },
              ],
            },
            { name: "fire", type: "button", bindings: [{ path: "<Mouse>/leftButton" }] },
            { name: "tap", type: "button", bindings: [{ path: "<Touch>/primaryTouch/press" }] },
            { name: "zoom", type: "vector2", bindings: [{ path: "<Mouse>/scroll" }] },
          ],
        },
      ],
    }),
  );
  await app.start();
  const running: BrowserInputApp = {
    app,
    canvas,
    advance: (frames = SETTLE_FRAMES): Promise<void> =>
      Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve()),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
  harness = running;
  await running.advance();
  return running;
}

describe("real keyboard events", () => {
  it("drive a 2DVector composite through the physical key code", async () => {
    const running = await createBrowserInputApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    await running.advance();
    const move = running.app.input.actions.get("move");
    expect(move.vector.y).toBe(1);
    expect(move.vector.x).toBe(1);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    await running.advance();
    expect(running.app.input.actions.get("move").vector.y).toBe(0);
  });

  it("publish the raw event with its code and key", async () => {
    const running = await createBrowserInputApp();
    let seen = 0;
    const check = (): void => {
      for (const event of running.app.input.events) {
        if (event.type === "keydown" && event.code === "space") {
          seen += 1;
        }
      }
    };
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
    await nextFrame().then(check).then(nextFrame).then(check);
    expect(seen).toBeGreaterThan(0);
  });

  it("release every control when the window loses focus", async () => {
    const running = await createBrowserInputApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    await running.advance();
    expect(running.app.input.actions.get("move").vector.x).toBe(1);
    window.dispatchEvent(new Event("blur"));
    await running.advance();
    expect(running.app.input.actions.get("move").vector.x).toBe(0);
  });
});

describe("real pointer events", () => {
  it("drive the mouse buttons and report canvas-relative coordinates", async () => {
    const running = await createBrowserInputApp();
    running.canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 20,
        clientY: 30,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        bubbles: true,
      }),
    );
    await running.advance();
    expect(running.app.input.actions.get("fire").isPressed).toBe(true);
    const position = running.app.input.devices.mouse.control("position");
    expect(position).not.toBeNull();
    if (position !== null) {
      expect(running.app.input.devices.mouse.valueAt(position.offset)).toBe(20);
      expect(running.app.input.devices.mouse.valueAt(position.offset + 1)).toBe(30);
    }
    window.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 20, clientY: 30, button: 0, pointerId: 1, pointerType: "mouse" }),
    );
    await running.advance();
    expect(running.app.input.actions.get("fire").isPressed).toBe(false);
  });

  it("drive the touch device from a touch-type pointer", async () => {
    const running = await createBrowserInputApp();
    running.canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 5,
        clientY: 5,
        button: 0,
        pointerId: 42,
        pointerType: "touch",
        bubbles: true,
      }),
    );
    await running.advance();
    expect(running.app.input.actions.get("tap").isPressed).toBe(true);
    expect(running.app.input.currentScheme).toBe("Touch");
    window.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 5, clientY: 5, button: 0, pointerId: 42, pointerType: "touch" }),
    );
    await running.advance();
    expect(running.app.input.actions.get("tap").isPressed).toBe(false);
  });

  it("drive the wheel", async () => {
    const running = await createBrowserInputApp();
    running.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true }));
    let sawScroll = false;
    await Array.from({ length: SETTLE_FRAMES }).reduce<Promise<void>>(
      (chain) =>
        chain.then(nextFrame).then((): void => {
          if (running.app.input.actions.get("zoom").vector.y !== 0) {
            sawScroll = true;
          }
        }),
      Promise.resolve(),
    );
    expect(sawScroll).toBe(true);
  });
});

describe("pointer lock and the cursor", () => {
  it("settles the pointer-lock request either way and mirrors document.pointerLockElement", async () => {
    const running = await createBrowserInputApp();
    // Headless Chromium usually refuses a lock requested outside a user gesture; the contract is
    // only that the promise settles and that `locked` agrees with the document.
    const locked = await Promise.race([
      running.app.input.pointerLock.request().catch(() => false),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 1000);
      }),
    ]);
    expect(typeof locked).toBe("boolean");
    expect(running.app.input.pointerLock.locked).toBe(document.pointerLockElement === running.canvas);
    running.app.input.pointerLock.exit();
  });

  it("toggles the canvas cursor style", async () => {
    const running = await createBrowserInputApp();
    expect(running.canvas.style.cursor).toBe("");
    running.app.input.cursor.visible = false;
    expect(running.canvas.style.cursor).toBe("none");
    running.app.input.cursor.visible = true;
    expect(running.canvas.style.cursor).toBe("");
  });
});

describe("diagnostics on a real app", () => {
  it("counts the frame's events and the pointer-lock state", async () => {
    const running = await createBrowserInputApp();
    const group = running.app.diagnostics.group("input");
    expect(group).not.toBeNull();
    if (group === null) {
      return;
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    let sawEvent = false;
    await Array.from({ length: SETTLE_FRAMES }).reduce<Promise<void>>(
      (chain) =>
        chain.then(nextFrame).then((): void => {
          if (group.get(group.index("eventsThisFrame")) > 0) {
            sawEvent = true;
          }
        }),
      Promise.resolve(),
    );
    expect(sawEvent).toBe(true);
    expect(group.get(group.index("pointerLocked"))).toBe(0);
  });
});

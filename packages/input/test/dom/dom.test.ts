import { describe, expect, it } from "vitest";
import { DomBridge } from "../../src/dom/dom-bridge.js";
import { asDomCanvas } from "../../src/dom/dom-target.js";
import { InputEventQueue } from "../../src/dom/event-queue.js";
import { FocusSource } from "../../src/dom/focus-source.js";
import { KeyboardSource } from "../../src/dom/keyboard-source.js";
import { PointerSource } from "../../src/dom/pointer-source.js";
import { Cursor, PointerLock, createNavigatorGamepadReader } from "../../src/index.js";
import { createFakeDom } from "./fake-dom.js";
import type { FakeDom } from "./fake-dom.js";
import type { DomTarget, InputEventRecord } from "../../src/index.js";

/** Presents the fake DOM as a `DomTarget`. */
function asTarget(dom: FakeDom): DomTarget {
  return dom as unknown as DomTarget;
}

/** Drains a queue into a plain list. */
function drain(queue: InputEventQueue): readonly InputEventRecord[] {
  queue.drain(() => undefined);
  return queue.events;
}

describe("asDomCanvas", () => {
  it("returns null when the host has no DOM canvas class", () => {
    expect(asDomCanvas({})).toBeNull();
    expect(asDomCanvas(null)).toBeNull();
  });
});

describe("the keyboard adapter", () => {
  it("subscribes on the window and translates codes to control names", () => {
    const dom = createFakeDom();
    const queue = new InputEventQueue();
    const source = new KeyboardSource({ target: asTarget(dom), queue });
    source.attach();
    source.attach();
    expect(dom.window.count("keydown")).toBe(1);
    dom.window.dispatch("keydown", { code: "KeyW", key: "w", repeat: false });
    dom.window.dispatch("keyup", { code: "ShiftLeft", key: "Shift", repeat: false });
    dom.window.dispatch("keydown", { code: "Unknown", key: "?", repeat: true });
    const events = drain(queue);
    expect(events.map((event) => [event.type, event.code, event.key, event.repeat])).toEqual([
      ["keydown", "w", "w", false],
      ["keyup", "shiftLeft", "Shift", false],
      ["keydown", "", "?", true],
    ]);
    source.detach();
    source.detach();
    expect(dom.window.count("keydown")).toBe(0);
  });
});

describe("the pointing adapter", () => {
  it("reads pointer down and wheel from the canvas and move and up from the window", () => {
    const dom = createFakeDom();
    const queue = new InputEventQueue();
    const source = new PointerSource({ target: asTarget(dom), queue, isLocked: () => false });
    source.attach();
    source.attach();
    expect(dom.canvas.count("pointerdown")).toBe(1);
    expect(dom.window.count("pointermove")).toBe(1);
    dom.canvas.dispatch("pointerdown", {
      clientX: 30,
      clientY: 50,
      movementX: 0,
      movementY: 0,
      button: 2,
      pointerId: 4,
      pointerType: "pen",
    });
    dom.window.dispatch("pointermove", {
      clientX: 40,
      clientY: 60,
      movementX: 10,
      movementY: 10,
      button: 0,
      pointerId: 4,
      pointerType: "pen",
    });
    dom.canvas.dispatch("wheel", { deltaX: 1, deltaY: -2, clientX: 30, clientY: 50 });
    const events = drain(queue);
    expect(events[0]).toMatchObject({ type: "pointerdown", x: 20, y: 30, button: 2, pointerId: 4, pointerType: "pen" });
    expect(events[1]).toMatchObject({ type: "pointermove", x: 30, y: 40, deltaX: 10, deltaY: 10 });
    expect(events[2]).toMatchObject({ type: "wheel", deltaX: 1, deltaY: -2, x: 20, y: 30 });
    source.detach();
    source.detach();
    expect(dom.canvas.count("pointerdown")).toBe(0);
    expect(dom.window.count("pointerup")).toBe(0);
  });

  it("suppresses the context menu only while the pointer is locked", () => {
    const dom = createFakeDom();
    const queue = new InputEventQueue();
    let locked = false;
    const source = new PointerSource({ target: asTarget(dom), queue, isLocked: () => locked });
    source.attach();
    let prevented = 0;
    const event = {
      preventDefault: (): void => {
        prevented += 1;
      },
    };
    dom.canvas.dispatch("contextmenu", event);
    expect(prevented).toBe(0);
    locked = true;
    dom.canvas.dispatch("contextmenu", event);
    expect(prevented).toBe(1);
  });
});

describe("the focus adapter", () => {
  it("queues a release on blur and on becoming hidden", () => {
    const dom = createFakeDom();
    const queue = new InputEventQueue();
    const source = new FocusSource({ target: asTarget(dom), queue });
    source.attach();
    source.attach();
    dom.window.dispatch("blur", {});
    expect(queue.pendingCount).toBe(1);
    dom.document.dispatch("visibilitychange", {});
    expect(queue.pendingCount).toBe(1);
    dom.document.visibilityState = "hidden";
    dom.document.dispatch("visibilitychange", {});
    expect(queue.pendingCount).toBe(2);
    source.detach();
    source.detach();
    expect(dom.window.count("blur")).toBe(0);
  });
});

describe("the cursor controller", () => {
  it("applies and restores the canvas cursor", () => {
    const dom = createFakeDom();
    dom.canvas.style.cursor = "crosshair";
    const cursor = new Cursor();
    cursor.attach(asTarget(dom));
    expect(dom.canvas.style.cursor).toBe("crosshair");
    cursor.visible = false;
    expect(dom.canvas.style.cursor).toBe("none");
    cursor.visible = true;
    expect(dom.canvas.style.cursor).toBe("crosshair");
    cursor.visible = false;
    cursor.detach();
    expect(dom.canvas.style.cursor).toBe("crosshair");
    cursor.detach();
  });
});

describe("the pointer-lock controller", () => {
  it("resolves true when the document reports the canvas is locked", async () => {
    const dom = createFakeDom();
    const lock = new PointerLock();
    lock.attach(asTarget(dom));
    lock.attach(asTarget(dom));
    const seen: boolean[] = [];
    lock.onChange.connect((locked: boolean) => seen.push(locked));
    const pending = lock.request();
    expect(dom.canvas.pointerLockRequests).toBe(1);
    dom.document.pointerLockElement = dom.canvas;
    dom.document.dispatch("pointerlockchange", {});
    expect(await pending).toBe(true);
    expect(lock.locked).toBe(true);
    expect(seen).toEqual([true]);
    expect(await lock.request()).toBe(true);
    lock.exit();
    expect(dom.document.exitCalls).toBe(1);
    lock.detach();
    lock.detach();
    expect(lock.locked).toBe(false);
  });

  it("resolves false when the browser refuses", async () => {
    const dom = createFakeDom();
    const lock = new PointerLock();
    lock.attach(asTarget(dom));
    const pending = lock.request();
    dom.document.dispatch("pointerlockerror", {});
    expect(await pending).toBe(false);
    lock.detach();
  });

  it("settles when the returned promise rejects", async () => {
    const dom = createFakeDom();
    dom.canvas.lockResult = Promise.reject(new Error("denied"));
    const lock = new PointerLock();
    lock.attach(asTarget(dom));
    expect(await lock.request()).toBe(false);
    lock.detach();
  });

  it("exits nothing when the app does not hold the lock", () => {
    const lock = new PointerLock();
    lock.exit();
    lock.detach();
    expect(lock.locked).toBe(false);
  });
});

describe("the DOM bridge", () => {
  it("attaches and detaches every adapter once", () => {
    const dom = createFakeDom();
    const queue = new InputEventQueue();
    const bridge = new DomBridge({
      target: asTarget(dom),
      queue,
      pointerLock: new PointerLock(),
      cursor: new Cursor(),
    });
    bridge.attach();
    bridge.attach();
    expect(dom.window.count("keydown")).toBe(1);
    expect(dom.canvas.count("pointerdown")).toBe(1);
    expect(dom.document.count("pointerlockchange")).toBe(1);
    bridge.detach();
    bridge.detach();
    expect(dom.window.count("keydown")).toBe(0);
    expect(dom.document.count("pointerlockchange")).toBe(0);
  });
});

describe("the navigator gamepad reader", () => {
  it("is absent under Node, where there is no Gamepad API", () => {
    expect(createNavigatorGamepadReader()).toBeNull();
  });
});

describe("the event queue", () => {
  it("recycles pending entries when it is cleared", () => {
    const queue = new InputEventQueue();
    queue.push("keydown", "keyup");
    expect(queue.pendingCount).toBe(2);
    queue.clear();
    expect(queue.pendingCount).toBe(0);
    expect(queue.poolSize).toBe(2);
  });
});

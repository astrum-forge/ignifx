import { describe, expect, it } from "vitest";
import { InputEventQueue } from "../../src/dom/event-queue.js";
import { PointerSource } from "../../src/dom/pointer-source.js";
import { createFakeDom } from "./fake-dom.js";
import type { FakeDom } from "./fake-dom.js";
import type { DomTarget, InputEventRecord } from "../../src/index.js";

/**
 * The two pixel spaces a pointer event carries (`docs/architecture/08-input.md` §5). A **position**
 * is in backing-store pixels, because that is what `Camera.worldToScreen` and `renderer.pickAsync`
 * compare against; a **delta** is in CSS pixels, because it measures hand motion and a look
 * sensitivity must not double on a retina display or move with the render-scale slider.
 */

/** Presents the fake DOM as a `DomTarget`. */
function asTarget(dom: FakeDom): DomTarget {
  return dom as unknown as DomTarget;
}

/** Drains a queue into a plain list. */
function drain(queue: InputEventQueue): readonly InputEventRecord[] {
  queue.drain(() => undefined);
  return queue.events;
}

/** Makes the canvas 100 CSS pixels wide with a 200-pixel backing store: device pixel ratio 2. */
function scaleCanvas(dom: FakeDom): void {
  Object.assign(dom.canvas, {
    width: 200,
    getBoundingClientRect: (): { left: number; top: number; width: number } => ({ left: 10, top: 20, width: 100 }),
  });
}

describe("pointer pixel space", () => {
  it("reports positions in backing-store pixels and deltas in CSS pixels when the canvas is scaled", () => {
    const dom = createFakeDom();
    scaleCanvas(dom);
    const queue = new InputEventQueue();
    const source = new PointerSource({ target: asTarget(dom), queue, isLocked: () => false });
    source.attach();
    dom.window.dispatch("pointermove", {
      clientX: 30,
      clientY: 50,
      movementX: 5,
      movementY: -5,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    });
    // The position is what `pickAsync` wants; the delta is hand motion and must not carry the ratio,
    // or a look would be twice as fast on a retina display (`docs/architecture/08-input.md` §5).
    expect(drain(queue)[0]).toMatchObject({ type: "pointermove", x: 40, y: 60, deltaX: 5, deltaY: -5 });
    source.detach();
  });

  it("derives a touch delta in CSS pixels from successive client positions", () => {
    const dom = createFakeDom();
    scaleCanvas(dom);
    const queue = new InputEventQueue();
    const source = new PointerSource({ target: asTarget(dom), queue, isLocked: () => false });
    source.attach();
    // A touch pointer reports no `movementX`/`movementY` at all, so the adapter derives the motion.
    const touch = { movementX: 0, movementY: 0, button: 0, pointerId: 9, pointerType: "touch" };
    dom.canvas.dispatch("pointerdown", { ...touch, clientX: 30, clientY: 50 });
    dom.window.dispatch("pointermove", { ...touch, clientX: 45, clientY: 40 });
    dom.window.dispatch("pointerup", { ...touch, clientX: 45, clientY: 40 });
    const events = drain(queue);
    expect(events[0]).toMatchObject({ type: "pointerdown", x: 40, y: 60, deltaX: 0, deltaY: 0 });
    expect(events[1]).toMatchObject({ type: "pointermove", x: 70, y: 40, deltaX: 15, deltaY: -10 });
    // The slot is freed on release, so a pointer that reuses the id starts from rest rather than
    // inheriting the finished touch's last position.
    dom.window.dispatch("pointermove", { ...touch, clientX: 80, clientY: 80 });
    expect(drain(queue)[0]).toMatchObject({ type: "pointermove", deltaX: 0, deltaY: 0 });
    source.detach();
  });

  it("keeps CSS pixels when the canvas reports no sizes, as the fakes elsewhere in this file do", () => {
    const dom = createFakeDom();
    const queue = new InputEventQueue();
    const source = new PointerSource({ target: asTarget(dom), queue, isLocked: () => false });
    source.attach();
    dom.canvas.dispatch("pointerdown", {
      clientX: 30,
      clientY: 50,
      movementX: 5,
      movementY: 5,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(drain(queue)[0]).toMatchObject({ x: 20, y: 30, deltaX: 5 });
    source.detach();
  });
});

import { describe, expect, it, vi } from "vitest";
import { EndOfFrameQueue } from "../../src/scheduler/deferred-queue.js";

/**
 * The `EndOfFrame` queue (`docs/architecture/01-lifecycle-and-time.md` §3 step 0,
 * `02-scene-graph.md` §8).
 */
describe("the EndOfFrame queue", () => {
  it("runs queued callbacks in order and empties itself", () => {
    const seen: string[] = [];
    const queue = new EndOfFrameQueue(() => undefined);
    queue.enqueue(() => seen.push("a"));
    queue.enqueue(() => seen.push("b"));
    expect(queue.length).toBe(2);

    expect(queue.drain()).toBe(2);
    expect(seen).toEqual(["a", "b"]);
    expect(queue.length).toBe(0);
    expect(queue.drain()).toBe(0);
  });

  it("defers work queued by a draining callback to the next drain", () => {
    const seen: string[] = [];
    const queue = new EndOfFrameQueue(() => undefined);
    queue.enqueue(() => {
      seen.push("first");
      queue.enqueue(() => seen.push("second"));
    });

    queue.drain();
    expect(seen).toEqual(["first"]);
    queue.drain();
    expect(seen).toEqual(["first", "second"]);
  });

  it("reports a throwing callback and keeps draining", () => {
    const seen: string[] = [];
    const onError = vi.fn();
    const queue = new EndOfFrameQueue(onError);
    queue.enqueue(() => {
      throw new Error("deferred boom");
    });
    queue.enqueue(() => seen.push("survivor"));

    queue.drain();

    expect(onError).toHaveBeenCalledOnce();
    expect(seen).toEqual(["survivor"]);
  });

  it("drops everything on clear", () => {
    const seen: string[] = [];
    const queue = new EndOfFrameQueue(() => undefined);
    queue.enqueue(() => seen.push("never"));
    queue.clear();
    expect(queue.drain()).toBe(0);
    expect(seen).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_ASSET_CONCURRENCY, RequestQueue } from "../../src/assets/request-queue.js";
import { flushMicrotasks } from "./support/harness.js";

/** The placeholder a deferred resolver starts as, hoisted so it captures nothing. */
function notSettledYet(): void {
  // Replaced by the promise executor before anything calls it.
}

/** A task whose completion the test controls. */
function deferred(): { readonly promise: Promise<string>; resolve: (value: string) => void } {
  let resolve: (value: string) => void = notSettledYet;
  const promise = new Promise<string>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("RequestQueue", () => {
  it("defaults to six concurrent tasks, the limit section 4 names", () => {
    expect(new RequestQueue().concurrency).toBe(DEFAULT_ASSET_CONCURRENCY);
    expect(DEFAULT_ASSET_CONCURRENCY).toBe(6);
  });

  it("runs at most `concurrency` tasks at once", async () => {
    const queue = new RequestQueue(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = gates.map((gate, index) =>
      queue.run(0, () => {
        started.push(index);
        return gate.promise;
      }),
    );
    expect(started).toEqual([0, 1]);
    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(1);
    gates[0]?.resolve("a");
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2]);
    gates[1]?.resolve("b");
    gates[2]?.resolve("c");
    await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c"]);
    expect(queue.activeCount).toBe(0);
  });

  it("runs higher priorities first and keeps enqueue order within one priority", async () => {
    const queue = new RequestQueue(1);
    const first = deferred();
    const order: string[] = [];
    const running = queue.run(0, () => {
      order.push("blocker");
      return first.promise;
    });
    const low = queue.run(0, () => Promise.resolve(order.push("low")));
    const highA = queue.run(10, () => Promise.resolve(order.push("highA")));
    const highB = queue.run(10, () => Promise.resolve(order.push("highB")));
    first.resolve("done");
    await Promise.all([running, low, highA, highB]);
    expect(order).toEqual(["blocker", "highA", "highB", "low"]);
  });

  it("frees the slot when a task rejects", async () => {
    const queue = new RequestQueue(1);
    const failing = queue.run(0, () => Promise.reject(new Error("boom")));
    await expect(failing).rejects.toThrow("boom");
    await expect(queue.run(0, () => Promise.resolve("next"))).resolves.toBe("next");
    expect(queue.activeCount).toBe(0);
  });

  it("rejects the tasks that never started when it is cleared", async () => {
    const queue = new RequestQueue(1);
    const gate = deferred();
    const running = queue.run(0, () => gate.promise);
    const waiting = queue.run(0, () => Promise.resolve("never"));
    queue.clear(new Error("disposed"));
    await expect(waiting).rejects.toThrow("disposed");
    expect(queue.pendingCount).toBe(0);
    gate.resolve("ok");
    await expect(running).resolves.toBe("ok");
  });
});

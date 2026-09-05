import { describe, expect, it, vi } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { Signal, type DeferredQueue, type SignalOwner } from "../../src/signal/signal.js";

/** A handler that does nothing, for tests that only care about connection bookkeeping. */
function noop(): void {
  // Intentionally empty.
}

/** A deferred queue that runs nothing until the test flushes it, standing in for EndOfFrame. */
function createManualQueue(): DeferredQueue & { flush(): void; readonly size: number } {
  const pending: (() => void)[] = [];
  return {
    enqueue(callback: () => void): void {
      pending.push(callback);
    },
    flush(): void {
      const running = pending.splice(0);
      for (const callback of running) {
        callback();
      }
    },
    get size(): number {
      return pending.length;
    },
  };
}

/** The minimal object that satisfies the structural owner contract. */
function createOwner(): SignalOwner & { destroy(): void } {
  const onDestroyed = new Signal<unknown>();
  let isDestroyed = false;
  return {
    onDestroyed,
    get isDestroyed(): boolean {
      return isDestroyed;
    },
    destroy(): void {
      isDestroyed = true;
      onDestroyed.emit(undefined);
    },
  };
}

describe("signal delivery", () => {
  it("calls handlers in connection order", () => {
    const signal = new Signal<number>();
    const seen: string[] = [];
    signal.connect(() => {
      seen.push("first");
    });
    signal.connect(() => {
      seen.push("second");
    });
    signal.emit(1);
    expect(seen).toEqual(["first", "second"]);
  });

  it("passes the emitted value to every handler", () => {
    const signal = new Signal<string>();
    const first = vi.fn(() => {});
    const second = vi.fn(() => {});
    signal.connect(first);
    signal.connect(second);
    signal.emit("hello");
    expect(first).toHaveBeenCalledWith("hello");
    expect(second).toHaveBeenCalledWith("hello");
  });

  it("emits without an argument when the payload is void", () => {
    const signal = new Signal();
    const handler = vi.fn(() => {});
    signal.connect(handler);
    signal.emit();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does nothing when nobody is connected", () => {
    expect(() => new Signal<number>().emit(1)).not.toThrow();
  });

  it("counts live connections", () => {
    const signal = new Signal();
    expect(signal.connectionCount).toBe(0);
    const stop = signal.connect(noop);
    expect(signal.connectionCount).toBe(1);
    stop();
    expect(signal.connectionCount).toBe(0);
  });
});

describe("disconnecting", () => {
  it("stops delivery through the returned function", () => {
    const signal = new Signal();
    const handler = vi.fn(() => {});
    const stop = signal.connect(handler);
    stop();
    signal.emit();
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores a second call to the returned function", () => {
    const signal = new Signal();
    const stop = signal.connect(noop);
    stop();
    stop();
    expect(signal.connectionCount).toBe(0);
  });

  it("stops delivery through disconnect(handler)", () => {
    const signal = new Signal();
    const handler = vi.fn(() => {});
    signal.connect(handler);
    signal.disconnect(handler);
    signal.emit();
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores disconnecting a handler that was never connected", () => {
    const signal = new Signal();
    const connected = vi.fn(() => {});
    signal.connect(connected);
    expect(() => signal.disconnect(noop)).not.toThrow();
    expect(signal.connectionCount).toBe(1);
  });

  it("removes only the first of two connections of the same handler", () => {
    const signal = new Signal();
    const handler = vi.fn(() => {});
    signal.connect(handler);
    signal.connect(handler);
    signal.disconnect(handler);
    signal.emit();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("drops every handler on clear", () => {
    const signal = new Signal();
    const handler = vi.fn(() => {});
    signal.connect(handler);
    signal.connect(handler);
    signal.clear();
    signal.emit();
    expect(signal.connectionCount).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps delivering to the remaining handlers after a middle one is removed", () => {
    const signal = new Signal();
    const seen: string[] = [];
    signal.connect(() => {
      seen.push("a");
    });
    const stop = signal.connect(() => {
      seen.push("b");
    });
    signal.connect(() => {
      seen.push("c");
    });
    stop();
    signal.emit();
    expect(seen).toEqual(["a", "c"]);
  });
});

describe("once connections", () => {
  it("delivers exactly one value", () => {
    const signal = new Signal<number>();
    const handler = vi.fn(() => {});
    signal.connect(handler, { once: true });
    signal.emit(1);
    signal.emit(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
    expect(signal.connectionCount).toBe(0);
  });

  it("leaves other handlers connected", () => {
    const signal = new Signal();
    const kept = vi.fn(() => {});
    signal.connect(noop, { once: true });
    signal.connect(kept);
    signal.emit();
    signal.emit();
    expect(kept).toHaveBeenCalledTimes(2);
    expect(signal.connectionCount).toBe(1);
  });
});

describe("reentrancy", () => {
  it("runs a handler connected during an emit on the next emit", () => {
    const signal = new Signal();
    const late = vi.fn(() => {});
    signal.connect(() => {
      signal.connect(late);
    });
    signal.emit();
    expect(late).not.toHaveBeenCalled();
    signal.emit();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("does not call a handler disconnected earlier in the same emit", () => {
    const signal = new Signal();
    const target = vi.fn(() => {});
    signal.connect(() => {
      signal.disconnect(target);
    });
    signal.connect(target);
    signal.emit();
    expect(target).not.toHaveBeenCalled();
  });

  it("survives a handler that disconnects itself", () => {
    const signal = new Signal();
    const seen: string[] = [];
    const stop = signal.connect(() => {
      seen.push("self");
      stop();
    });
    signal.connect(() => {
      seen.push("other");
    });
    signal.emit();
    signal.emit();
    expect(seen).toEqual(["self", "other", "other"]);
    expect(signal.connectionCount).toBe(1);
  });

  it("survives a handler that clears the signal mid-emit", () => {
    const signal = new Signal();
    const later = vi.fn(() => {});
    signal.connect(() => {
      signal.clear();
    });
    signal.connect(later);
    signal.emit();
    expect(later).not.toHaveBeenCalled();
    expect(signal.connectionCount).toBe(0);
  });

  it("delivers correctly to the remaining handlers after nested emits", () => {
    const signal = new Signal<number>();
    const seen: number[] = [];
    signal.connect((value) => {
      seen.push(value);
      if (value === 1) {
        signal.emit(2);
      }
    });
    signal.connect((value) => {
      seen.push(value * 10);
    });
    signal.emit(1);
    expect(seen).toEqual([1, 2, 20, 10]);
  });

  it("compacts tombstones so later emits stay correct", () => {
    const signal = new Signal();
    const kept = vi.fn(() => {});
    const stops = [signal.connect(noop), signal.connect(noop)];
    signal.connect(() => {
      for (const stop of stops) {
        stop();
      }
    });
    signal.connect(kept);
    signal.emit();
    expect(signal.connectionCount).toBe(2);
    signal.emit();
    expect(kept).toHaveBeenCalledTimes(2);
  });
});

describe("owner connections", () => {
  it("disconnects the handler when the owner is destroyed", () => {
    const signal = new Signal();
    const owner = createOwner();
    const handler = vi.fn(() => {});
    signal.connect(handler, { owner });
    owner.destroy();
    signal.emit();
    expect(handler).not.toHaveBeenCalled();
    expect(signal.connectionCount).toBe(0);
  });

  it("is a no-op when the owner is already destroyed", () => {
    const signal = new Signal();
    const owner = createOwner();
    owner.destroy();
    const stop = signal.connect(noop, { owner });
    expect(signal.connectionCount).toBe(0);
    expect(() => stop()).not.toThrow();
  });

  it("releases the hook on the owner when the handler disconnects first", () => {
    const signal = new Signal();
    const owner = createOwner();
    const stop = signal.connect(noop, { owner });
    expect(owner.onDestroyed.connectionCount).toBe(1);
    stop();
    expect(owner.onDestroyed.connectionCount).toBe(0);
  });

  it("leaves other owners' handlers connected", () => {
    const signal = new Signal();
    const first = createOwner();
    const second = createOwner();
    const kept = vi.fn(() => {});
    signal.connect(noop, { owner: first });
    signal.connect(kept, { owner: second });
    first.destroy();
    signal.emit();
    expect(kept).toHaveBeenCalledTimes(1);
  });
});

describe("deferred connections", () => {
  it("delivers on the queue flush rather than inside emit", () => {
    const queue = createManualQueue();
    const signal = new Signal<number>({ deferredQueue: queue });
    const handler = vi.fn(() => {});
    signal.connect(handler, { deferred: true });
    signal.emit(7);
    expect(handler).not.toHaveBeenCalled();
    queue.flush();
    expect(handler).toHaveBeenCalledWith(7);
  });

  it("throws IGX-0103 when the signal has no scheduler", () => {
    const signal = new Signal();
    try {
      signal.connect(noop, { deferred: true });
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.deferredSignalWithoutScheduler);
    }
    expect(signal.connectionCount).toBe(0);
  });

  it("cancels a queued delivery when the handler disconnects before the flush", () => {
    const queue = createManualQueue();
    const signal = new Signal({ deferredQueue: queue });
    const handler = vi.fn(() => {});
    const stop = signal.connect(handler, { deferred: true });
    signal.emit();
    stop();
    queue.flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it("still delivers a deferred once connection after it is detached", () => {
    const queue = createManualQueue();
    const signal = new Signal({ deferredQueue: queue });
    const handler = vi.fn(() => {});
    signal.connect(handler, { deferred: true, once: true });
    signal.emit();
    expect(signal.connectionCount).toBe(0);
    queue.flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("runs immediate handlers inside emit while deferring the others", () => {
    const queue = createManualQueue();
    const signal = new Signal<string>({ deferredQueue: queue });
    const seen: string[] = [];
    signal.connect(() => {
      seen.push("immediate");
    });
    signal.connect(
      () => {
        seen.push("deferred");
      },
      { deferred: true },
    );
    signal.emit("x");
    expect(seen).toEqual(["immediate"]);
    queue.flush();
    expect(seen).toEqual(["immediate", "deferred"]);
  });
});

describe("handler errors", () => {
  it("delivers to every handler even when one throws", () => {
    const signal = new Signal();
    const after = vi.fn(() => {});
    signal.connect(() => {
      throw new Error("boom");
    });
    signal.connect(after);
    expect(() => signal.emit()).toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("rethrows the first failure as IGX-0104 with the original as its cause", () => {
    const signal = new Signal();
    const boom = new Error("boom");
    signal.connect(() => {
      throw boom;
    });
    signal.connect(() => {
      throw new Error("second");
    });
    try {
      signal.emit();
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.signalHandlerThrew);
      expect(isIgnifxError(error) && error.cause).toBe(boom);
      expect(isIgnifxError(error) && error.context["errorCount"]).toBe(2);
    }
  });

  it("reports to onHandlerError instead of throwing when a reporter is given", () => {
    const reported: unknown[] = [];
    const signal = new Signal({
      onHandlerError: (error) => {
        reported.push(error);
      },
    });
    signal.connect(() => {
      throw new Error("boom");
    });
    const after = vi.fn(() => {});
    signal.connect(after);
    expect(() => signal.emit()).not.toThrow();
    expect(reported).toHaveLength(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("hands the reporter the signal that failed", () => {
    let seen: unknown = null;
    const signal = new Signal({
      onHandlerError: (_error, source) => {
        seen = source;
      },
    });
    signal.connect(() => {
      throw new Error("boom");
    });
    signal.emit();
    expect(seen).toBe(signal);
  });
});

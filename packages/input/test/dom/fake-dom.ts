/**
 * A hand-rolled DOM stand-in. Node has no `HTMLCanvasElement`, `KeyboardEvent`, or `PointerEvent`,
 * and the adapters under `src/dom/` only ever call `addEventListener`, `removeEventListener`, and a
 * handful of properties — so a fake target is enough to test the translation from browser event to
 * queue entry. The real objects are exercised by the Chromium suite.
 */

/** One listener registration. */
type Listener = (event: unknown) => void;

/** An `EventTarget` a test dispatches by hand. */
export class FakeTarget {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, handler: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, handler: Listener): void {
    this.listeners.get(type)?.delete(handler);
  }

  /** How many listeners are attached for a type. */
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  /** Calls every listener registered for a type. */
  dispatch(type: string, event: unknown): void {
    // A copy, so a listener that detaches itself during dispatch does not disturb the iteration.
    for (const handler of Array.from(this.listeners.get(type) ?? [])) {
      handler(event);
    }
  }
}

/** A canvas stand-in with the three members the adapters touch. */
export class FakeCanvas extends FakeTarget {
  readonly style = { cursor: "" };

  pointerLockRequests = 0;

  lockResult: unknown = undefined;

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 10, top: 20 };
  }

  requestPointerLock(): unknown {
    this.pointerLockRequests += 1;
    return this.lockResult;
  }
}

/** A document stand-in. */
export class FakeDocument extends FakeTarget {
  visibilityState = "visible";

  pointerLockElement: unknown = null;

  exitCalls = 0;

  exitPointerLock(): void {
    this.exitCalls += 1;
    this.pointerLockElement = null;
  }
}

/** The three objects a `DomTarget` carries, in their fake form. */
export interface FakeDom {
  readonly canvas: FakeCanvas;
  readonly window: FakeTarget;
  readonly document: FakeDocument;
}

/** Builds a fresh fake DOM. */
export function createFakeDom(): FakeDom {
  return { canvas: new FakeCanvas(), window: new FakeTarget(), document: new FakeDocument() };
}

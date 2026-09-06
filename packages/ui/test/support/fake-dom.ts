/**
 * A DOM small enough to run under Node and large enough to drive `UiHost`, the widgets, and
 * `WorldAnchor`.
 *
 * jsdom is not a dependency of this repository and must not become one, so the node suite follows
 * the precedent `packages/input/test/dom/fake-dom.ts` set: production code is written against the
 * real DOM types, and a test presents this object graph as one through a single
 * `as unknown as UiDomTarget`. Only the members `packages/ui/src/**` actually touches exist here —
 * the real objects are exercised by the Chromium suite.
 *
 * The fake tracks enough to assert on: every element's inline properties (`setProperty` /
 * `getPropertyValue`), the child list, the attribute bag, and the listeners, with `dispatch` to
 * fire one by hand.
 */

/** A listener, as the fake stores it. */
type Listener = (event: unknown) => void;

/** The rectangle {@link FakeElement.getBoundingClientRect} answers with. */
export interface FakeRect {
  /** The left edge, in CSS pixels. */
  left: number;
  /** The top edge, in CSS pixels. */
  top: number;
  /** The width, in CSS pixels. */
  width: number;
  /** The height, in CSS pixels. */
  height: number;
}

/** An inline style bag with the two methods the source uses. */
export class FakeStyle {
  /** Every property written, in insertion order. */
  readonly properties = new Map<string, string>();

  /**
   * Writes one property.
   *
   * @param name - The property name.
   * @param value - The value.
   */
  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  /**
   * Reads one property.
   *
   * @param name - The property name.
   * @returns The value, or `""` when it was never written.
   */
  getPropertyValue(name: string): string {
    return this.properties.get(name) ?? "";
  }

  /**
   * Removes one property.
   *
   * @param name - The property name.
   * @returns The value it had.
   */
  removeProperty(name: string): string {
    const value = this.getPropertyValue(name);
    this.properties.delete(name);
    return value;
  }
}

/** An element with the members `packages/ui/src/**` touches. */
export class FakeElement {
  /** The tag name, upper-cased, as the DOM reports it. */
  readonly tagName: string;

  /** The inline style bag. */
  readonly style = new FakeStyle();

  /** The `data-*` bag, keyed as `dataset` keys it. */
  readonly dataset: Record<string, string> = {};

  /** The children, in document order. */
  readonly children: FakeElement[] = [];

  /** Every attribute written with `setAttribute`. */
  readonly attributes = new Map<string, string>();

  /** The listeners, keyed by event type. */
  readonly listeners = new Map<string, Set<Listener>>();

  /** The `class` attribute. */
  className = "";

  /** The `id` attribute. */
  id = "";

  /** The text content. */
  textContent = "";

  /** An `<input>`'s type. */
  type = "";

  /** Whether the element is `contenteditable`. */
  isContentEditable = false;

  /** The parent, or `null` when the element is detached. */
  parentElement: FakeElement | null = null;

  /** The document that created it. */
  ownerDocument: FakeDocument;

  /** The rectangle {@link FakeElement.getBoundingClientRect} answers with. */
  rect: FakeRect = { left: 0, top: 0, width: 0, height: 0 };

  /** Every `setPointerCapture` call, for a test to assert the stick claimed its pointer. */
  readonly pointerCaptures: number[] = [];

  /**
   * Builds an element.
   *
   * @param tagName - The tag, in any case.
   * @param ownerDocument - The document that created it.
   */
  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
  }

  /**
   * Appends children.
   *
   * @param nodes - The children.
   */
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.push(node);
    }
  }

  /**
   * Inserts a node immediately after this one.
   *
   * @param node - The node to insert.
   */
  after(node: FakeElement): void {
    const parent = this.parentElement;
    if (parent === null) {
      return;
    }
    node.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
  }

  /**
   * Removes one child.
   *
   * @param node - The child.
   */
  removeChild(node: FakeElement): void {
    const index = this.children.indexOf(node);
    if (index >= 0) {
      this.children.splice(index, 1);
      node.parentElement = null;
    }
  }

  /** Detaches the element from its parent. */
  remove(): void {
    this.parentElement?.removeChild(this);
  }

  /** Removes every child. */
  replaceChildren(): void {
    // A snapshot, because `removeChild` mutates the list being walked.
    for (const child of Array.from(this.children)) {
      this.removeChild(child);
    }
  }

  /**
   * Writes an attribute.
   *
   * @param name - The attribute name.
   * @param value - The value.
   */
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  /**
   * Reads an attribute.
   *
   * @param name - The attribute name.
   * @returns The value, or `null`.
   */
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  /**
   * Records a pointer capture.
   *
   * @param pointerId - The pointer.
   */
  setPointerCapture(pointerId: number): void {
    this.pointerCaptures.push(pointerId);
  }

  /**
   * The rectangle the element occupies.
   *
   * @returns The rectangle a test set on {@link FakeElement.rect}.
   */
  getBoundingClientRect(): FakeRect {
    return this.rect;
  }

  /**
   * Subscribes a listener.
   *
   * @param type - The event type.
   * @param handler - The listener.
   */
  addEventListener(type: string, handler: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(type, set);
  }

  /**
   * Unsubscribes a listener.
   *
   * @param type - The event type.
   * @param handler - The listener.
   */
  removeEventListener(type: string, handler: Listener): void {
    this.listeners.get(type)?.delete(handler);
  }

  /**
   * Fires every listener of a type, then bubbles to the parent.
   *
   * @param type - The event type.
   * @param event - The event object handed to the listeners.
   */
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const payload = { type, target: this, preventDefault: (): void => {}, stopPropagation: (): void => {}, ...event };
    // A snapshot, so a handler that unsubscribes itself does not break the walk.
    for (const handler of Array.from(this.listeners.get(type) ?? [])) {
      handler(payload);
    }
    this.parentElement?.dispatch(type, { ...event, target: payload["target"] });
  }

  /**
   * Every descendant, breadth-first, including this element.
   *
   * @returns The elements.
   */
  descendants(): FakeElement[] {
    const out: FakeElement[] = [this];
    for (const child of this.children) {
      out.push(...child.descendants());
    }
    return out;
  }
}

/** A canvas with the four members the host reads. */
export class FakeCanvas extends FakeElement {
  /** The backing-store width. */
  width = 0;

  /** The backing-store height. */
  height = 0;

  /**
   * Builds a canvas.
   *
   * @param ownerDocument - The document that created it.
   */
  constructor(ownerDocument: FakeDocument) {
    super("canvas", ownerDocument);
  }
}

/** A document with the members the host and the widgets use. */
export class FakeDocument {
  /** The `<head>`, where the stylesheet is injected. */
  readonly head: FakeElement;

  /** The `<body>`, the fallback mount point. */
  readonly body: FakeElement;

  /** The listeners on the document itself. */
  readonly listeners = new Map<string, Set<Listener>>();

  /** What `document.activeElement` answers. */
  activeElement: unknown = null;

  /** The window this document belongs to; assigned by {@link createFakeDom}. */
  defaultView: FakeWindow | null = null;

  /** Builds an empty document with a head and a body. */
  constructor() {
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
  }

  /**
   * Creates an element.
   *
   * @param tag - The tag name.
   * @returns The element.
   */
  createElement(tag: string): FakeElement {
    return tag.toLowerCase() === "canvas" ? new FakeCanvas(this) : new FakeElement(tag, this);
  }

  /**
   * Finds an element by id, anywhere in the head or the body.
   *
   * @param id - The id to find.
   * @returns The element, or `null`.
   */
  getElementById(id: string): FakeElement | null {
    for (const element of [...this.head.descendants(), ...this.body.descendants()]) {
      if (element.id === id) {
        return element;
      }
    }
    return null;
  }

  /**
   * Subscribes a listener.
   *
   * @param type - The event type.
   * @param handler - The listener.
   */
  addEventListener(type: string, handler: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(type, set);
  }

  /**
   * Unsubscribes a listener.
   *
   * @param type - The event type.
   * @param handler - The listener.
   */
  removeEventListener(type: string, handler: Listener): void {
    this.listeners.get(type)?.delete(handler);
  }

  /**
   * Fires every listener of a type.
   *
   * @param type - The event type.
   * @param event - The event object handed to the listeners.
   */
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const handler of Array.from(this.listeners.get(type) ?? [])) {
      handler({ type, target: null, ...event });
    }
  }
}

/** A window with `addEventListener` and an optional `ResizeObserver`. */
export class FakeWindow {
  /** The listeners on the window. */
  readonly listeners = new Map<string, Set<Listener>>();

  /** What `window.devicePixelRatio` answers. */
  devicePixelRatio = 1;

  /**
   * Subscribes a listener.
   *
   * @param type - The event type.
   * @param handler - The listener.
   */
  addEventListener(type: string, handler: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(type, set);
  }

  /**
   * Unsubscribes a listener.
   *
   * @param type - The event type.
   * @param handler - The listener.
   */
  removeEventListener(type: string, handler: Listener): void {
    this.listeners.get(type)?.delete(handler);
  }

  /**
   * Fires every listener of a type.
   *
   * @param type - The event type.
   */
  dispatch(type: string): void {
    for (const handler of Array.from(this.listeners.get(type) ?? [])) {
      handler({ type });
    }
  }
}

/** A `ResizeObserver` stand-in whose callbacks a test fires by hand. */
export class FakeResizeObserver {
  /** Every observer built, so a test can fire them without holding a reference. */
  static readonly instances: FakeResizeObserver[] = [];

  /** The elements passed to `observe`. */
  readonly observed: unknown[] = [];

  /** Whether `disconnect` was called. */
  disconnected = false;

  readonly #callback: () => void;

  /**
   * Records the callback.
   *
   * @param callback - What `observe` reports through.
   */
  constructor(callback: () => void) {
    this.#callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  /**
   * Starts observing.
   *
   * @param target - The element.
   */
  observe(target: unknown): void {
    this.observed.push(target);
  }

  /** Stops observing. */
  disconnect(): void {
    this.disconnected = true;
  }

  /** Fires the callback, as a real observer would after a layout change. */
  fire(): void {
    this.#callback();
  }
}

/** The three objects a `UiDomTarget` carries, in their fake form. */
export interface FakeDom {
  /** The canvas the overlay is positioned over. */
  readonly canvas: FakeCanvas;
  /** The document. */
  readonly document: FakeDocument;
  /** The window. */
  readonly window: FakeWindow;
  /** The wrapper the canvas sits in, so the overlay has a sibling slot. */
  readonly wrapper: FakeElement;
}

/** What {@link createFakeDom} accepts. */
export interface FakeDomOptions {
  /** The canvas's CSS width. Defaults to `800`. */
  readonly cssWidth?: number;
  /** The canvas's CSS height. Defaults to `600`. */
  readonly cssHeight?: number;
  /** The canvas's backing-store width. Defaults to the CSS width. */
  readonly deviceWidth?: number;
  /** The canvas's backing-store height. Defaults to the CSS height. */
  readonly deviceHeight?: number;
  /** Whether the window exposes a `ResizeObserver`. Defaults to `true`. */
  readonly resizeObserver?: boolean;
}

/**
 * Builds a fresh fake DOM with a laid-out canvas inside a wrapper.
 *
 * @param options - The canvas's two sizes and whether a `ResizeObserver` exists.
 * @returns The fake.
 */
export function createFakeDom(options: FakeDomOptions = {}): FakeDom {
  const cssWidth = options.cssWidth ?? 800;
  const cssHeight = options.cssHeight ?? 600;
  const document = new FakeDocument();
  const window = new FakeWindow();
  document.defaultView = window;
  if (options.resizeObserver !== false) {
    Reflect.set(window, "ResizeObserver", FakeResizeObserver);
  }
  const wrapper = document.createElement("div");
  document.body.append(wrapper);
  const canvas = new FakeCanvas(document);
  canvas.width = options.deviceWidth ?? cssWidth;
  canvas.height = options.deviceHeight ?? cssHeight;
  canvas.rect = { left: 0, top: 0, width: cssWidth, height: cssHeight };
  wrapper.append(canvas);
  return { canvas, document, window, wrapper };
}

/**
 * Resizes a fake canvas and fires everything a real resize would.
 *
 * @param dom - The fake DOM.
 * @param cssWidth - The new CSS width.
 * @param cssHeight - The new CSS height.
 * @param deviceScale - The device pixel ratio to apply to the backing store.
 */
export function resizeFakeCanvas(dom: FakeDom, cssWidth: number, cssHeight: number, deviceScale = 1): void {
  dom.canvas.rect = { left: 0, top: 0, width: cssWidth, height: cssHeight };
  dom.canvas.width = cssWidth * deviceScale;
  dom.canvas.height = cssHeight * deviceScale;
  dom.window.devicePixelRatio = deviceScale;
  for (const observer of FakeResizeObserver.instances) {
    if (!observer.disconnected && observer.observed.includes(dom.canvas)) {
      observer.fire();
    }
  }
  dom.window.dispatch("resize");
}

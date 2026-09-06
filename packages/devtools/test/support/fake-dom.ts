/**
 * A DOM small enough to run under Node and large enough to drive the whole devtools overlay.
 *
 * jsdom is not a dependency of this repository and must not become one, so this file follows the
 * precedent `packages/ui/test/support/fake-dom.ts` set — production code is written against the
 * real DOM types, and a test presents this object graph as one through a single
 * `as unknown as DevtoolsDomTarget`. It is a sibling implementation rather than an import: a node
 * suite must not depend on another package's test tree.
 *
 * What this fake carries that the UI one does not: form-control state (`value`, `checked`,
 * `disabled`, `min`/`max`/`step`, `placeholder`, `readOnly`, `rows`), scroll geometry
 * (`scrollTop`, `clientHeight`) for the scene tree's virtualisation, and a canvas whose
 * `getContext("2d")` records every `fillRect` so the timeline test can assert that pixels were
 * drawn.
 */

/** A listener, as the fake stores it. */
type Listener = (event: unknown) => void;

/** One recorded `fillRect` call. */
export interface FakeFill {
  /** The fill style in effect. */
  readonly style: string;
  /** The left edge. */
  readonly x: number;
  /** The top edge. */
  readonly y: number;
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

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

/** An inline style bag with the methods the source uses. */
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

/** An element with the members `packages/devtools/src/**` touches. */
export class FakeElement {
  /** The tag name, upper-cased, as the DOM reports it. */
  readonly tagName: string;

  /** The inline style bag. */
  readonly style = new FakeStyle();

  /** The `data-*` bag. */
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

  /** The `title` attribute, as a property. */
  title = "";

  /** The text content. */
  textContent = "";

  /** An `<input>`'s or `<button>`'s type. */
  type = "";

  /** An `<input>`'s or `<select>`'s value. */
  value = "";

  /** A checkbox's state. */
  checked = false;

  /** Whether a control is disabled. */
  disabled = false;

  /** Whether a text area is read-only. */
  readOnly = false;

  /** A text area's row count. */
  rows = 0;

  /** A numeric input's lower bound. */
  min = "";

  /** A numeric input's upper bound. */
  max = "";

  /** A numeric input's increment. */
  step = "";

  /** A text input's placeholder. */
  placeholder = "";

  /** How far the element is scrolled. */
  scrollTop = 0;

  /** The element's laid-out height; `0` means "no layout", which is what a fake has. */
  clientHeight = 0;

  /** Whether the element is `contenteditable`. */
  isContentEditable = false;

  /** The parent, or `null` when the element is detached. */
  parentElement: FakeElement | null = null;

  /** The document that created it. */
  readonly ownerDocument: FakeDocument;

  /** The rectangle {@link FakeElement.getBoundingClientRect} answers with. */
  rect: FakeRect = { left: 0, top: 0, width: 0, height: 0 };

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
    // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point.
    for (const child of [...this.children]) {
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
    const payload = {
      type,
      target: this,
      preventDefault: (): void => {},
      stopPropagation: (): void => {},
      ...event,
    };
    // A snapshot, so a handler that unsubscribes itself does not break the walk.
    // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point.
    for (const handler of [...(this.listeners.get(type) ?? [])]) {
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

  /**
   * Finds every descendant carrying a class.
   *
   * @param className - The class to match.
   * @returns The matching elements.
   */
  byClass(className: string): FakeElement[] {
    return this.descendants().filter((element: FakeElement): boolean =>
      element.className.split(" ").includes(className),
    );
  }
}

/** A 2D context that records what was drawn. */
export class FakeContext2D {
  /** Every `fillRect` call, in order. */
  readonly fills: FakeFill[] = [];

  /** Every `clearRect` call, in order. */
  readonly clears: FakeFill[] = [];

  /** The current fill style. */
  fillStyle = "";

  /**
   * Records a clear.
   *
   * @param x - The left edge.
   * @param y - The top edge.
   * @param width - The width.
   * @param height - The height.
   */
  clearRect(x: number, y: number, width: number, height: number): void {
    this.clears.push({ style: this.fillStyle, x, y, width, height });
  }

  /**
   * Records a fill.
   *
   * @param x - The left edge.
   * @param y - The top edge.
   * @param width - The width.
   * @param height - The height.
   */
  fillRect(x: number, y: number, width: number, height: number): void {
    this.fills.push({ style: this.fillStyle, x, y, width, height });
  }
}

/** A canvas with a recording 2D context. */
export class FakeCanvas extends FakeElement {
  /** The backing-store width. */
  width = 0;

  /** The backing-store height. */
  height = 0;

  /** The one context this canvas hands out. */
  readonly context = new FakeContext2D();

  /**
   * Builds a canvas.
   *
   * @param ownerDocument - The document that created it.
   */
  constructor(ownerDocument: FakeDocument) {
    super("canvas", ownerDocument);
  }

  /**
   * Hands out the recording context.
   *
   * @param kind - The context kind; only `"2d"` is answered.
   * @returns The context, or `null`.
   */
  getContext(kind: string): FakeContext2D | null {
    return kind === "2d" ? this.context : null;
  }
}

/** A document with the members the overlay uses. */
export class FakeDocument {
  /** The `<head>`, where the stylesheet is injected. */
  readonly head: FakeElement;

  /** The `<body>`, the fallback mount point. */
  readonly body: FakeElement;

  /** The listeners on the document itself. */
  readonly listeners = new Map<string, Set<Listener>>();

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
    // A snapshot, so a handler that unsubscribes itself does not break the walk.
    // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point.
    for (const handler of [...(this.listeners.get(type) ?? [])]) {
      handler({ type, target: null, preventDefault: (): void => {}, ...event });
    }
  }
}

/** A window with the two members the overlay reads. */
export class FakeWindow {
  /** The listeners on the window. */
  readonly listeners = new Map<string, Set<Listener>>();

  /** What `window.navigator` answers. */
  navigator: Record<string, unknown> = {};

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
}

/** The three objects a devtools DOM target carries, in their fake form. */
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
  /** Whether the canvas has a parent element. Defaults to `true`. */
  readonly wrapped?: boolean;
}

/**
 * Builds a fresh fake DOM with a laid-out canvas inside a wrapper.
 *
 * @param options - The canvas size and whether it sits in a wrapper.
 * @returns The fake.
 */
export function createFakeDom(options: FakeDomOptions = {}): FakeDom {
  const cssWidth = options.cssWidth ?? 800;
  const cssHeight = options.cssHeight ?? 600;
  const document = new FakeDocument();
  const window = new FakeWindow();
  document.defaultView = window;
  const wrapper = document.createElement("div");
  document.body.append(wrapper);
  const canvas = new FakeCanvas(document);
  canvas.width = cssWidth;
  canvas.height = cssHeight;
  canvas.rect = { left: 0, top: 0, width: cssWidth, height: cssHeight };
  if (options.wrapped === false) {
    document.body.append(canvas);
  } else {
    wrapper.append(canvas);
  }
  return { canvas, document, window, wrapper };
}

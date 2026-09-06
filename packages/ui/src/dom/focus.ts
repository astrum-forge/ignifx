/**
 * Focus routing (`docs/architecture/13-ui.md` §1, `08-input.md` §5).
 *
 * ## What `@ignifx/input` does and does not do
 *
 * `InputService.uiHasFocus` is a **plain settable property**; its own documentation says so —
 * "`@ignifx/ui` assigns it"* (`packages/input/src/service/input-service.ts` 340-349). Nothing in
 * `@ignifx/input` watches the DOM for it: `FocusSource` subscribes only to `blur` and
 * `visibilitychange`, and translates both into one `releaseAll`. So the policy for *what counts as
 * a focused text field* is defined here, by this module, and this module is the only thing that
 * ever writes the flag. While it is `true`, `Binding.readRef` reports every keyboard control as
 * released (`packages/input/src/bindings/binding.ts` 330 and 350), which is what makes typing in a
 * field stop firing actions; pointer and gamepad controls are untouched.
 *
 * ## The policy
 *
 * An element takes the keyboard when it is a text-entry element: a `<textarea>`, a `<select>`, a
 * `contenteditable` element, or an `<input>` whose type is not one of the button-like or
 * slider-like types (which games legitimately want to drive with the keyboard *and* have the
 * player use). Two data attributes override the guess in either direction, for the widgets a
 * framework builds out of `<div role="textbox">` and for the search box a game wants to keep
 * transparent to gameplay:
 *
 * - `data-ignifx-focus="capture"` — always takes the keyboard.
 * - `data-ignifx-focus="ignore"` — never takes it.
 */

/**
 * The attribute that overrides the editability guess in either direction.
 *
 * @public
 */
export const UI_FOCUS_ATTRIBUTE = "data-ignifx-focus";

/**
 * The `<input>` types that are **not** text entry: a player may want to drive them with the
 * keyboard, so focusing one must not stop gameplay actions.
 */
const NON_TEXT_INPUT_TYPES: readonly string[] = Object.freeze([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** The element members this module reads, so a fake in a node test only has to provide these. */
interface FocusCandidate {
  readonly tagName?: unknown;
  readonly type?: unknown;
  readonly isContentEditable?: unknown;
  readonly getAttribute?: unknown;
}

/**
 * Reads one attribute off a candidate without assuming it is a real `Element`.
 *
 * @param candidate - The focused node.
 * @param name - The attribute name.
 * @returns The attribute's value, or `null` when there is none or the node cannot answer.
 */
function attribute(candidate: FocusCandidate, name: string): string | null {
  const getter = candidate.getAttribute;
  if (typeof getter !== "function") {
    return null;
  }
  const value: unknown = Reflect.apply(getter, candidate, [name]);
  return typeof value === "string" ? value : null;
}

/**
 * Reports whether a focused node is a text-entry element, and therefore owns the keyboard.
 *
 * @remarks
 * Deliberately structural rather than `instanceof HTMLInputElement`: the same function then answers
 * for a real element in Chromium and for the fake DOM the node suite builds, and two documents in
 * one page (an `<iframe>`) do not need their constructors to match.
 *
 * @param node - The node that just received focus, or `null`.
 * @returns `true` when typing into it must stop keyboard actions from firing.
 *
 * @example
 * ```ts
 * const field = document.createElement("input");
 * isEditableElement(field); // true — an <input> with no type is a text field
 * ```
 *
 * @public
 */
export function isEditableElement(node: unknown): boolean {
  if (node === null || typeof node !== "object") {
    return false;
  }
  const candidate: FocusCandidate = node;
  const override = attribute(candidate, UI_FOCUS_ATTRIBUTE);
  if (override === "capture") {
    return true;
  }
  if (override === "ignore") {
    return false;
  }
  if (candidate.isContentEditable === true) {
    return true;
  }
  const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toUpperCase() : "";
  if (tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (tagName !== "INPUT") {
    return false;
  }
  const type = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "text";
  return !NON_TEXT_INPUT_TYPES.includes(type);
}

/**
 * What {@link UiFocusWatcher} needs.
 *
 * @internal
 */
export interface UiFocusWatcherOptions {
  /** The document `focusin` and `focusout` are read from. */
  readonly document: Document;
  /** Called whenever the answer changes; the host forwards it to `app.input.uiHasFocus`. */
  readonly onChanged: (hasFocus: boolean) => void;
}

/**
 * Watches the document's focus and reports whether a text field owns the keyboard.
 *
 * @remarks
 * Scoped to the whole document rather than to `app.ui.root`, because a game may portal a menu
 * anywhere — a React portal on `document.body`, a `<dialog>` in the top layer — and a field that
 * fires gameplay actions is a bug wherever it lives. `focusout` re-reads `document.activeElement`
 * rather than trusting `relatedTarget`, which is `null` for a blur that leaves the page entirely.
 *
 * @internal
 */
export class UiFocusWatcher {
  readonly #document: Document;

  readonly #onChanged: (hasFocus: boolean) => void;

  #hasFocus = false;

  #attached = false;

  readonly #onFocusIn = (event: Event): void => {
    this.#set(isEditableElement(event.target));
  };

  readonly #onFocusOut = (): void => {
    // `focusout` fires *before* the new element is focused, so the answer is read on the next
    // microtask — by which time `activeElement` is the element that actually took focus, or the
    // body when nothing did.
    void Promise.resolve().then((): void => {
      if (this.#attached) {
        this.#set(isEditableElement(this.#document.activeElement));
      }
    });
  };

  /**
   * Builds the watcher. It subscribes nothing until {@link UiFocusWatcher.attach} is called.
   *
   * @param options - The document to watch and the callback to report through.
   */
  constructor(options: UiFocusWatcherOptions) {
    this.#document = options.document;
    this.#onChanged = options.onChanged;
  }

  /**
   * Whether a text field currently owns the keyboard.
   *
   * @returns The last reported answer.
   */
  get hasFocus(): boolean {
    return this.#hasFocus;
  }

  /** Subscribes to the document, and reports the element that is already focused. */
  attach(): void {
    if (this.#attached) {
      return;
    }
    this.#attached = true;
    this.#document.addEventListener("focusin", this.#onFocusIn);
    this.#document.addEventListener("focusout", this.#onFocusOut);
    this.#set(isEditableElement(this.#document.activeElement));
  }

  /** Unsubscribes and reports `false`, so a disposed overlay never leaves the keyboard captured. */
  detach(): void {
    if (!this.#attached) {
      return;
    }
    this.#attached = false;
    this.#document.removeEventListener("focusin", this.#onFocusIn);
    this.#document.removeEventListener("focusout", this.#onFocusOut);
    this.#set(false);
  }

  /**
   * Reports a new answer, if it changed.
   *
   * @param value - The new answer.
   */
  #set(value: boolean): void {
    if (this.#hasFocus === value) {
      return;
    }
    this.#hasFocus = value;
    this.#onChanged(value);
  }
}

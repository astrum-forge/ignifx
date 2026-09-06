import { DEVTOOLS_CLASS_NAMES } from "./styles.js";

/**
 * The handful of DOM helpers every panel is built from.
 *
 * Two rules shape them. Panels refresh at up to ten times a second, so a refresh must **reuse** its
 * elements rather than rebuild them — {@link RowList} is that reuse, and it is why the panels'
 * update methods are a few lines each. And a text write that would not change anything is skipped,
 * because assigning `textContent` invalidates layout even when the string is identical.
 */

/**
 * Creates an element and gives it a class.
 *
 * @typeParam K - The tag name.
 * @param document - The document to create in.
 * @param tag - The tag name.
 * @param className - The class to set, when there is one.
 * @returns The element.
 *
 * @internal
 */
export function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  return node;
}

/**
 * Writes an element's text, skipping the write when it would not change anything.
 *
 * @param node - The element.
 * @param value - The text.
 *
 * @internal
 */
export function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) {
    node.textContent = value;
  }
}

/**
 * Adds or removes one class without touching the rest of the class list.
 *
 * @param node - The element.
 * @param className - The class to toggle.
 * @param on - Whether the class should be present.
 *
 * @internal
 */
export function toggleClass(node: HTMLElement, className: string, on: boolean): void {
  const base = node.className.replace(className, "").trim();
  const next = on ? `${base} ${className}`.trim() : base;
  if (node.className !== next) {
    node.className = next;
  }
}

/**
 * Creates a push button.
 *
 * @param document - The document to create in.
 * @param label - The button's text.
 * @param onClick - What to run when it is pressed.
 * @returns The button.
 *
 * @internal
 */
export function button(document: Document, label: string, onClick: () => void): HTMLButtonElement {
  const node = element(document, "button", DEVTOOLS_CLASS_NAMES.button);
  node.type = "button";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

/**
 * Creates a labelled text input.
 *
 * @param document - The document to create in.
 * @param placeholder - The placeholder text.
 * @param onInput - What to run with the value on each keystroke.
 * @returns The input.
 *
 * @internal
 */
export function textInput(document: Document, placeholder: string, onInput: (value: string) => void): HTMLInputElement {
  const node = element(document, "input", DEVTOOLS_CLASS_NAMES.input);
  node.type = "text";
  node.placeholder = placeholder;
  node.addEventListener("input", (): void => {
    onInput(node.value);
  });
  return node;
}

/**
 * Creates a section heading.
 *
 * @param document - The document to create in.
 * @param label - The heading text.
 * @returns The heading element.
 *
 * @internal
 */
export function heading(document: Document, label: string): HTMLElement {
  const node = element(document, "div", DEVTOOLS_CLASS_NAMES.heading);
  node.textContent = label;
  return node;
}

/** One label/value row of a {@link RowList}. */
export interface KeyValueRow {
  /** The row element. */
  readonly row: HTMLElement;
  /** The label half. */
  readonly label: HTMLElement;
  /** The value half. */
  readonly value: HTMLElement;
}

/**
 * A reusable list of label/value rows.
 *
 * @remarks
 * A refresh calls {@link RowList.set} once per row and then {@link RowList.truncate}; rows that
 * already exist are rewritten in place and rows that are no longer needed are hidden rather than
 * removed, so a panel that oscillates between eight and nine rows never touches the DOM tree.
 *
 * @internal
 */
export class RowList {
  readonly #document: Document;
  readonly #parent: HTMLElement;
  readonly #rows: KeyValueRow[] = [];
  #used = 0;

  /**
   * Builds an empty list inside a container.
   *
   * @param document - The document to create rows in.
   * @param parent - The container the rows are appended to.
   */
  constructor(document: Document, parent: HTMLElement) {
    this.#document = document;
    this.#parent = parent;
  }

  /**
   * How many rows are currently shown.
   *
   * @returns The row count.
   */
  get length(): number {
    return this.#used;
  }

  /** Starts a refresh: the next {@link RowList.set} writes row zero. */
  begin(): void {
    this.#used = 0;
  }

  /**
   * Writes the next row.
   *
   * @param label - The label half.
   * @param value - The value half.
   * @returns The row, so a caller can style or extend it.
   */
  set(label: string, value: string): KeyValueRow {
    const row = this.#rowAt(this.#used);
    this.#used += 1;
    setText(row.label, label);
    setText(row.value, value);
    row.row.style.setProperty("display", "flex");
    return row;
  }

  /** Hides every row past the last one {@link RowList.set} wrote. */
  truncate(): void {
    for (let index = this.#used; index < this.#rows.length; index += 1) {
      this.#rows[index]?.row.style.setProperty("display", "none");
    }
  }

  /**
   * Returns the row at an index, creating it the first time.
   *
   * @param index - The row number.
   * @returns The row.
   */
  #rowAt(index: number): KeyValueRow {
    const existing = this.#rows[index];
    if (existing !== undefined) {
      return existing;
    }
    const row = element(this.#document, "div", DEVTOOLS_CLASS_NAMES.row);
    const label = element(this.#document, "span", DEVTOOLS_CLASS_NAMES.label);
    const value = element(this.#document, "span", DEVTOOLS_CLASS_NAMES.value);
    row.append(label, value);
    this.#parent.append(row);
    const created: KeyValueRow = { row, label, value };
    this.#rows.push(created);
    return created;
  }
}

import { Signal } from "@ignifx/core";
import { UI_CLASS_NAMES } from "../dom/styles.js";
import type { UiHost } from "../dom/host.js";
import type { SignalLike } from "@ignifx/core";

/**
 * Modal dialogs use a higher stacking level than menus so their panels and backdrops stay above
 * other layer content. Without a DOM overlay, methods are no-ops and `element` is `null`.
 */

/**
 * One button in a dialog.
 *
 * @public
 */
export interface DialogButton {
  /** The identifier `onChosen` reports. */
  readonly id: string;
  /** The text drawn on the button. */
  readonly label: string;
}

/**
 * What `new Dialog(app.ui, options)` accepts.
 *
 * @public
 */
export interface DialogOptions {
  /** The heading. Omit for a dialog with no title. */
  readonly title?: string;
  /** The body text. Omit for a dialog with no message. */
  readonly message?: string;
  /** The buttons, left to right. */
  readonly buttons?: readonly DialogButton[];
  /** The layer to mount into. Defaults to `"menu"`. */
  readonly layer?: string;
  /** Whether the dialog starts shown. Defaults to `false`. */
  readonly visible?: boolean;
  /** Whether a click on the backdrop dismisses the dialog. Defaults to `false`. */
  readonly dismissOnBackdrop?: boolean;
  /** The stacking order inside the layer. Defaults to `UI_DIALOG_Z_INDEX`, from the stylesheet. */
  readonly zIndex?: number;
}

/**
 * A modal panel with a title, a message, and buttons.
 *
 * @public
 */
export class Dialog {
  readonly #root: HTMLDivElement | null;

  readonly #title: HTMLHeadingElement | null = null;

  readonly #message: HTMLParagraphElement | null = null;

  readonly #buttonRow: HTMLDivElement | null = null;

  readonly #buttonCleanups: (() => void)[] = [];

  readonly #chosen = new Signal<string>();

  readonly #dismissed = new Signal();

  readonly #cleanups: (() => void)[] = [];

  #visible: boolean;

  #disposed = false;

  /**
   * Builds the dialog and mounts it hidden.
   *
   * @param host - The overlay host, normally `app.ui`.
   * @param options - The title, the message, the buttons, and the layer.
   */
  constructor(host: UiHost, options: DialogOptions = {}) {
    this.#visible = options.visible ?? false;
    const layerElement = host.layer(options.layer ?? "menu").element;
    if (layerElement === null) {
      this.#root = null;
      return;
    }
    const document = layerElement.ownerDocument;
    const root = document.createElement("div");
    root.className = UI_CLASS_NAMES.dialog;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    const backdrop = document.createElement("div");
    backdrop.className = UI_CLASS_NAMES.dialogBackdrop;
    root.append(backdrop);
    if (options.dismissOnBackdrop === true) {
      const onBackdrop = (): void => {
        this.hide();
      };
      backdrop.addEventListener("pointerdown", onBackdrop);
      this.#cleanups.push((): void => {
        backdrop.removeEventListener("pointerdown", onBackdrop);
      });
    }
    const panel = document.createElement("div");
    panel.className = UI_CLASS_NAMES.dialogPanel;
    if (options.title !== undefined) {
      const heading = document.createElement("h2");
      heading.className = UI_CLASS_NAMES.dialogTitle;
      heading.textContent = options.title;
      panel.append(heading);
      this.#title = heading;
    }
    if (options.message !== undefined) {
      const paragraph = document.createElement("p");
      paragraph.className = UI_CLASS_NAMES.dialogMessage;
      paragraph.textContent = options.message;
      panel.append(paragraph);
      this.#message = paragraph;
    }
    const row = document.createElement("div");
    row.className = UI_CLASS_NAMES.dialogButtons;
    panel.append(row);
    this.#buttonRow = row;
    root.append(panel);
    root.style.setProperty("display", this.#visible ? "flex" : "none");
    if (options.zIndex !== undefined) {
      root.style.setProperty("z-index", String(options.zIndex));
    }
    layerElement.append(root);
    this.#root = root;
    this.setButtons(options.buttons ?? []);
  }

  /**
   * The dialog's outermost element, so a template can restyle it or mount more into it.
   *
   * @returns The element, or `null` when the app has no DOM overlay.
   */
  get element(): HTMLDivElement | null {
    return this.#root;
  }

  /**
   * Whether the dialog is shown.
   *
   * @returns `true` while it is on screen.
   */
  get isVisible(): boolean {
    return this.#visible;
  }

  /**
   * Emitted with a button's `id` when it is pressed. The dialog does not hide itself; the game
   * decides, because "Cancel" and "Delete everything" want different follow-ups.
   *
   * @returns The signal.
   */
  get onChosen(): SignalLike<string> {
    return this.#chosen;
  }

  /**
   * Emitted after {@link Dialog.hide}, whatever caused it.
   *
   * @returns The signal.
   */
  get onDismissed(): SignalLike {
    return this.#dismissed;
  }

  /** Shows the dialog. */
  show(): void {
    if (this.#visible || this.#disposed) {
      return;
    }
    this.#visible = true;
    this.#root?.style.setProperty("display", "flex");
  }

  /** Hides the dialog and emits {@link Dialog.onDismissed}. */
  hide(): void {
    if (!this.#visible || this.#disposed) {
      return;
    }
    this.#visible = false;
    this.#root?.style.setProperty("display", "none");
    this.#dismissed.emit();
  }

  /**
   * Replaces the heading, if the dialog was built with one.
   *
   * @param text - The new heading.
   */
  setTitle(text: string): void {
    if (this.#title !== null) {
      this.#title.textContent = text;
    }
  }

  /**
   * Replaces the body text, if the dialog was built with one.
   *
   * @param text - The new message.
   */
  setMessage(text: string): void {
    if (this.#message !== null) {
      this.#message.textContent = text;
    }
  }

  /**
   * Replaces the buttons.
   *
   * @remarks
   * One dialog re-used for every question is cheaper than one dialog per question and keeps the
   * stacking predictable, so the buttons have to be able to change: a confirmation asks
   * "Yes"/"No", a save error offers "Retry"/"Cancel", and a locale change relabels both.
   *
   * @param buttons - The buttons, left to right. An empty list leaves the row empty.
   *
   * @example
   * ```ts ignore-check
   * dialog.setMessage("Delete this save?");
   * dialog.setButtons([{ id: "no", label: "No" }, { id: "yes", label: "Yes" }]);
   * ```
   */
  setButtons(buttons: readonly DialogButton[]): void {
    const row = this.#buttonRow;
    if (row === null || this.#disposed) {
      return;
    }
    for (const cleanup of this.#buttonCleanups) {
      cleanup();
    }
    this.#buttonCleanups.length = 0;
    row.replaceChildren();
    const document = row.ownerDocument;
    for (const button of buttons) {
      row.append(this.#createButton(document, button));
    }
  }

  /** Removes the dialog and unsubscribes. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const cleanup of [...this.#cleanups, ...this.#buttonCleanups]) {
      cleanup();
    }
    this.#cleanups.length = 0;
    this.#buttonCleanups.length = 0;
    this.#root?.remove();
    this.#chosen.clear();
    this.#dismissed.clear();
  }

  /**
   * Builds one button and wires it to {@link Dialog.onChosen}.
   *
   * @param document - The document to create in.
   * @param button - The button's id and label.
   * @returns The element.
   */
  #createButton(document: Document, button: DialogButton): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = UI_CLASS_NAMES.dialogButton;
    element.textContent = button.label;
    element.dataset["ignifxDialogButton"] = button.id;
    const onClick = (): void => {
      this.#chosen.emit(button.id);
    };
    element.addEventListener("click", onClick);
    this.#buttonCleanups.push((): void => {
      element.removeEventListener("click", onClick);
    });
    return element;
  }
}

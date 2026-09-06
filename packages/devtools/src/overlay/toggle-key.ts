/**
 * The overlay's toggle key (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"toggled with a
 * configurable key (default backtick)"*, read through `08-input.md` §5).
 *
 * It is a **raw** `keydown` listener on the document, never an input action. Two reasons, both from
 * §5: `@ignifx/input` is an optional peer, so an action binding would make devtools unusable in a
 * core-only game; and an action map that a game disables — a pause menu does exactly that — would
 * take the developer's escape hatch with it.
 *
 * The listener is the only thing devtools leaves running while the overlay is closed, which is what
 * the *"zero cost when closed"* exit criterion allows: one listener, one string comparison per
 * keystroke, nothing allocated.
 */

/**
 * Reports whether a tag name is one whose keystrokes belong to the field rather than to the toggle.
 *
 * @remarks
 * Three comparisons rather than a module-scope `Set`: `ignifx/no-module-side-effects` forbids
 * building a collection at import time (coding standards §4), and three `===` are cheaper than the
 * `Set` would have been anyway.
 *
 * @param tag - The upper-cased tag name.
 * @returns `true` for `INPUT`, `TEXTAREA` and `SELECT`.
 */
function isEditableTag(tag: string): boolean {
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Reports whether a key event was typed into a text field.
 *
 * @param target - The event's target.
 * @returns `true` when the keystroke belongs to an editor.
 *
 * @internal
 */
export function isEditableTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") {
    return false;
  }
  const tag: unknown = Reflect.get(target, "tagName");
  if (typeof tag === "string" && isEditableTag(tag.toUpperCase())) {
    return true;
  }
  return Reflect.get(target, "isContentEditable") === true;
}

/**
 * Installs the toggle-key listener.
 *
 * @param document - The document to listen on.
 * @param code - The `KeyboardEvent.code` that toggles the overlay.
 * @param onToggle - What to run when the key is pressed.
 * @returns The function that removes the listener.
 *
 * @internal
 */
export function installToggleKey(document: Document, code: string, onToggle: () => void): () => void {
  const listener = (event: KeyboardEvent): void => {
    if (event.code !== code || event.repeat || isEditableTarget(event.target)) {
      return;
    }
    // The overlay's own key must not also reach the game: a backtick that opens devtools should not
    // type a backtick into whatever had focus.
    event.preventDefault();
    onToggle();
  };
  document.addEventListener("keydown", listener);
  return (): void => {
    document.removeEventListener("keydown", listener);
  };
}

/**
 * The one stylesheet `@ignifx/ui` injects, and the class names it defines
 * (`docs/architecture/13-ui.md` §3: *"plain DOM helper classes with no styling opinions beyond a
 * minimal stylesheet; templates ship their own CSS"*).
 *
 * The rules do only what a game cannot reasonably be asked to repeat: position the root over the
 * canvas, make it click-through, and give the helper widgets a shape that is visible before any
 * game CSS loads. Every rule is a single class selector with no `!important`, so a template's own
 * stylesheet wins on specificity or on order.
 */

/**
 * The `id` of the injected `<style>` element, so a second app in one document reuses it.
 *
 * @public
 */
export const UI_STYLE_ELEMENT_ID = "ignifx-ui-styles";

/**
 * The class names the host and the helper widgets set, so a template's CSS can target them without
 * guessing (`docs/architecture/13-ui.md` §3).
 *
 * @public
 */
export const UI_CLASS_NAMES = {
  /** The overlay root. */
  root: "ignifx-ui-root",
  /** A named layer inside the root. */
  layer: "ignifx-ui-layer",
  /** Anything that should receive pointer events; the root does not. */
  interactive: "ignifx-ui-interactive",
  /** A `Dialog`'s outermost element. */
  dialog: "ignifx-ui-dialog",
  /** A `Dialog`'s backdrop. */
  dialogBackdrop: "ignifx-ui-dialog-backdrop",
  /** A `Dialog`'s panel. */
  dialogPanel: "ignifx-ui-dialog-panel",
  /** A `Dialog`'s title. */
  dialogTitle: "ignifx-ui-dialog-title",
  /** A `Dialog`'s message. */
  dialogMessage: "ignifx-ui-dialog-message",
  /** A `Dialog`'s button row. */
  dialogButtons: "ignifx-ui-dialog-buttons",
  /** One `Dialog` button. */
  dialogButton: "ignifx-ui-dialog-button",
  /** A `Toast`'s stack container. */
  toastStack: "ignifx-ui-toasts",
  /** One toast. */
  toast: "ignifx-ui-toast",
  /** A `LoadingScreen`'s outermost element. */
  loading: "ignifx-ui-loading",
  /** A `LoadingScreen`'s label. */
  loadingLabel: "ignifx-ui-loading-label",
  /** A `LoadingScreen`'s progress track. */
  loadingTrack: "ignifx-ui-loading-track",
  /** A `LoadingScreen`'s progress bar. */
  loadingBar: "ignifx-ui-loading-bar",
  /** A `VirtualJoystick`'s outer pad. */
  joystick: "ignifx-ui-joystick",
  /** A `VirtualJoystick`'s knob. */
  joystickKnob: "ignifx-ui-joystick-knob",
  /** A `VirtualButton`. */
  button: "ignifx-ui-button",
} as const;

/**
 * The CSS custom properties the root carries, so game CSS can read the safe area and the current
 * scale without measuring anything (`docs/architecture/13-ui.md` §1).
 *
 * @public
 */
export const UI_CSS_VARIABLES = {
  /** The top safe-area inset, from `env(safe-area-inset-top)`. */
  safeTop: "--ignifx-safe-top",
  /** The right safe-area inset. */
  safeRight: "--ignifx-safe-right",
  /** The bottom safe-area inset. */
  safeBottom: "--ignifx-safe-bottom",
  /** The left safe-area inset. */
  safeLeft: "--ignifx-safe-left",
  /** The uniform scale the root is drawn at, as a bare number. */
  scale: "--ignifx-ui-scale",
} as const;

/**
 * The stylesheet text.
 *
 * @remarks
 * A function rather than a module constant so nothing but a declaration lives at module scope
 * (`CONSTITUTION.md` §3.5, and the `ignifx/no-module-side-effects` rule).
 *
 * @returns The CSS the host injects once per document.
 *
 * @internal
 */
export function uiStyleSheet(): string {
  const c = UI_CLASS_NAMES;
  return [
    `.${c.root}{position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;transform-origin:0 0;}`,
    `.${c.layer}{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;}`,
    `.${c.interactive}{pointer-events:auto;}`,
    `.${c.dialog}{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;` +
      `align-items:center;justify-content:center;pointer-events:auto;}`,
    `.${c.dialogBackdrop}{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);}`,
    `.${c.dialogPanel}{position:relative;min-width:12rem;padding:1rem;border-radius:0.5rem;` +
      `background:#1b1d22;color:#f5f5f5;font:inherit;}`,
    `.${c.dialogTitle}{margin:0 0 0.5rem;font-size:1.1em;}`,
    `.${c.dialogMessage}{margin:0 0 1rem;}`,
    `.${c.dialogButtons}{display:flex;gap:0.5rem;justify-content:flex-end;}`,
    `.${c.dialogButton}{padding:0.4rem 0.9rem;border:0;border-radius:0.25rem;background:#3a6df0;` +
      `color:#fff;font:inherit;cursor:pointer;}`,
    `.${c.toastStack}{position:absolute;right:1rem;bottom:1rem;display:flex;flex-direction:column;` +
      `gap:0.5rem;align-items:flex-end;}`,
    `.${c.toast}{padding:0.5rem 0.9rem;border-radius:0.25rem;background:#1b1d22;color:#f5f5f5;}`,
    `.${c.loading}{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;` +
      `flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;` +
      `background:#0d0f12;color:#f5f5f5;pointer-events:auto;}`,
    `.${c.loadingTrack}{width:60%;max-width:24rem;height:0.5rem;border-radius:0.25rem;background:#2a2e36;}`,
    `.${c.loadingBar}{height:100%;width:0;border-radius:0.25rem;background:#3a6df0;}`,
    `.${c.joystick}{position:absolute;width:7rem;height:7rem;border-radius:50%;` +
      `background:rgba(255,255,255,0.12);touch-action:none;pointer-events:auto;}`,
    `.${c.joystickKnob}{position:absolute;top:50%;left:50%;width:3rem;height:3rem;margin:-1.5rem 0 0 -1.5rem;` +
      `border-radius:50%;background:rgba(255,255,255,0.35);}`,
    `.${c.button}{position:absolute;width:4rem;height:4rem;border:0;border-radius:50%;` +
      `background:rgba(255,255,255,0.2);color:#fff;font:inherit;touch-action:none;pointer-events:auto;}`,
  ].join("\n");
}

/**
 * Injects the stylesheet into a document, once.
 *
 * @remarks
 * Keyed by {@link UI_STYLE_ELEMENT_ID}, so two apps sharing a document share one `<style>` element
 * and neither removes the other's (`CONSTITUTION.md` §3.6). Nothing removes it: a stylesheet with
 * no matching elements costs nothing, and unmounting it would break the app that is still running.
 *
 * @param document - The document to inject into.
 *
 * @internal
 */
export function ensureUiStyles(document: Document): void {
  // `getElementById` rather than `querySelector`: the id is the whole query, and the node test's
  // fake document then needs one method instead of a selector parser.
  // oxlint-disable-next-line unicorn/prefer-query-selector
  if (document.getElementById(UI_STYLE_ELEMENT_ID) !== null) {
    return;
  }
  const style = document.createElement("style");
  style.id = UI_STYLE_ELEMENT_ID;
  style.textContent = uiStyleSheet();
  document.head.append(style);
}

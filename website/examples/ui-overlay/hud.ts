/**
 * The DOM half of the overlay: the HUD panel `app.ui.layer("hud")` carries, and the safe-area
 * override the "Simulate a notch" toggle writes.
 *
 * @remarks
 * **This is not the kit reaching into the document.** `04-examples-platform.md` §4 says the kit is
 * the only place an example touches the DOM, and `@ignifx/ui` is the one exception the rule was
 * written around: game UI in ignifx *is* HTML, and `app.ui.layer(name).element` is the engine
 * handing a game the `<div>` it is meant to build into. Everything below goes through that element.
 *
 * Two things are worth reading before copying it.
 *
 * `ignifx-ui-interactive` is what turns pointer events back on. The overlay root and its layers are
 * `pointer-events: none` so a click reaches the canvas; a HUD that wants a button says so with that
 * class, and `UI_CLASS_NAMES` is where the name comes from rather than a string literal.
 *
 * The four safe-area insets are published by the host as CSS custom properties on the overlay root
 * — `env(safe-area-inset-*)` with a `0px` fallback — so game CSS reads a notch with
 * `var(--ignifx-safe-top)` and never measures anything. A desktop browser reports zero for all
 * four, which is why this example can set them on its own subtree: the same declarations, the same
 * cascade, and a laptop can see what a phone would do.
 */

import { UI_CLASS_NAMES, UI_CSS_VARIABLES } from "ignifx";
import type { UiHost, UiLayout } from "ignifx";

/** The inset a simulated notch reports on the top and bottom edges. */
const NOTCH_BLOCK = "34px";

/** The inset a simulated notch reports on the left and right edges. */
const NOTCH_INLINE = "18px";

/** The HUD, mounted, with the two things `main.ts` drives from the panel. */
export interface Hud {
  /** The outermost element, so a caller can read it in a test. */
  readonly element: HTMLElement;
  /**
   * Writes the live figures. Called every frame, and a no-op on a frame where nothing changed.
   *
   * @param layout - What `app.ui.layout` currently says.
   */
  readonly update: (layout: UiLayout) => void;
  /**
   * Overrides the four safe-area insets on this subtree, or gives them back to the host.
   *
   * @param on - `true` to report a notch, `false` to inherit the device's own insets.
   */
  readonly setNotch: (on: boolean) => void;
  /** Removes the HUD. */
  readonly dispose: () => void;
}

/**
 * Builds one labelled figure.
 *
 * @param label - The label text.
 * @returns The row, and the cell {@link Hud.update} rewrites.
 */
function buildRow(label: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement("div");
  row.className = "hud-row";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "hud-value";
  row.append(name, value);
  return { row, value };
}

/**
 * Mounts the HUD into the overlay's `hud` layer.
 *
 * @remarks
 * Returns `null` on an app with no DOM overlay — a headless app — so the caller needs no branch.
 * The layer is created for you: `layer(name)` is get-or-create.
 *
 * @param ui - The overlay host, normally `app.ui`.
 * @returns The HUD, or `null` when there is no overlay to mount into.
 *
 * @example
 * ```ts
 * const hud = createHud(app.ui);
 * hud?.update(app.ui.layout);
 * ```
 */
export function createHud(ui: UiHost): Hud | null {
  const host = ui.layer("hud").element;
  if (host === null) {
    return null;
  }

  const element = document.createElement("section");
  // Interactive because the HUD carries a button; a HUD that only reads would leave the class off
  // and let every click through to the game.
  element.className = `${UI_CLASS_NAMES.interactive} hud`;
  element.setAttribute("aria-label", "Heads-up display");

  const title = document.createElement("h2");
  title.className = "hud-title";
  title.textContent = "app.ui";
  element.append(title);

  const mode = buildRow("scaling");
  const unit = buildRow("one UI unit");
  const size = buildRow("root, UI units");
  const scale = buildRow("root scale");
  const inset = buildRow("safe area, top");
  element.append(mode.row, unit.row, size.row, scale.row, inset.row);

  const note = document.createElement("p");
  note.className = "hud-note";
  note.textContent = "Plain DOM in app.ui.layer(“hud”). The score above it is HudText, drawn by the GPU.";
  element.append(note);

  host.append(element);

  const words: Readonly<Record<UiLayout["mode"], string>> = {
    css: "one CSS pixel",
    fit: "one reference pixel",
    dpi: "one backing-store pixel",
  };

  /**
   * Reads the resolved top inset back out of the cascade.
   *
   * @remarks
   * Called when the notch toggle moves and once at mount, never per frame: `getComputedStyle`
   * forces a style recalculation, and a HUD that did it every frame would be the most expensive
   * thing on the page. It is read back rather than remembered so the figure is what the cascade
   * resolved — `env(safe-area-inset-top, 0px)` on a desktop, the override when one is set.
   *
   * @returns The inset as CSS wrote it, e.g. `"0px"`.
   */
  const readInset = (): string => getComputedStyle(element).getPropertyValue(UI_CSS_VARIABLES.safeTop).trim() || "0px";

  // The last layout written, so a per-frame refresh with nothing to say touches no DOM at all.
  let written = "";
  inset.value.textContent = readInset();

  return {
    element,
    update(layout: UiLayout): void {
      const key = `${layout.mode}|${String(layout.width)}|${String(layout.height)}|${String(layout.scale)}`;
      if (key === written) {
        return;
      }
      written = key;
      mode.value.textContent = layout.mode;
      unit.value.textContent = words[layout.mode];
      size.value.textContent = `${String(Math.round(layout.width))} × ${String(Math.round(layout.height))}`;
      scale.value.textContent = layout.scale.toFixed(3);
    },
    setNotch(on: boolean): void {
      const style = element.style;
      for (const [name, value] of [
        [UI_CSS_VARIABLES.safeTop, NOTCH_BLOCK],
        [UI_CSS_VARIABLES.safeBottom, NOTCH_BLOCK],
        [UI_CSS_VARIABLES.safeLeft, NOTCH_INLINE],
        [UI_CSS_VARIABLES.safeRight, NOTCH_INLINE],
      ] as const) {
        if (on) {
          style.setProperty(name, value);
        } else {
          style.removeProperty(name);
        }
      }
      inset.value.textContent = readInset();
    },
    dispose(): void {
      element.remove();
    },
  };
}

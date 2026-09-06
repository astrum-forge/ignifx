---
"@ignifx/ui": minor
---

Add `Menu` and `MenuStack`, the list and screen-navigation widgets every game menu is made of, and
fix `Dialog`'s stacking.

**Breaking**

- The `@ignifx/ui` stylesheet is now **prepended** to `<head>` rather than appended. That is what
  makes the documented rule true — _"a template's own stylesheet wins on specificity or on order"_ —
  but a game whose own rule of equal specificity was previously being overridden by the package's
  default will now see its own rule take effect.
- A `Dialog` is drawn at `z-index: 1000` (`UI_DIALOG_Z_INDEX`) inside its layer, so it is always
  above the layer's other roots. A game that relied on DOM order to paint something over a dialog
  must now give that element a higher `z-index`, or the dialog a lower one through the new
  `DialogOptions.zIndex`.
- `Dialog` always creates its button row, even when it was built with no buttons, so that
  `setButtons` can fill it later. A stylesheet that assumed `.ignifx-ui-dialog-panel` had no
  `.ignifx-ui-dialog-buttons` child may need a `:empty` rule.

**Added**

- `Menu` — a focusable vertical list of declarative rows (`action`, `toggle`, `slider`, `choice`,
  `binding`, `heading`, `separator`) with one selection model for keyboard, gamepad and pointer,
  disabled rows, scroll-into-view, `onSelectionChanged`/`onActivated`/`onBack`, and `role="menu"` /
  `menuitem` / `menuitemcheckbox` / `separator` plus `aria-activedescendant` for screen readers.
- `MenuStack` — push/pop screen navigation where Escape unwinds one level, with held-direction
  repeat on the unscaled clock and a `MenuNavigation` interface that an `@ignifx/input` action
  satisfies structurally, so `@ignifx/input` stays an optional peer.
- `Dialog.setButtons`, `DialogOptions.zIndex`, and the `UI_DIALOG_Z_INDEX` constant.
- Row helpers `formatBindingPath`, `snapToStep`, `resolveMenuLabel` and `resolveMenuChoices`, and
  the `ignifx-ui-menu*` entries in `UI_CLASS_NAMES`.

**Documentation**

- `Toast.advance` now says what it always required: the script that calls it needs
  `static updateWhenPaused = true` for a toast to expire while the game is paused.
- The four templates drop their hand-written `src/menus/menu-screen.ts` and build their title,
  pause, settings, rebinding and credits screens out of `Menu` and `MenuStack`.

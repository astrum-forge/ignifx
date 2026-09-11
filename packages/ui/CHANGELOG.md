# @ignifx/ui

## 0.2.2

### Patch Changes

- Updated dependencies [be82465]
  - @ignifx/core@0.2.2
  - @ignifx/input@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [21a4ba7]
- Updated dependencies [388b0f6]
  - @ignifx/input@0.2.1
  - @ignifx/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0
  - @ignifx/input@0.2.0

## 0.1.0

### Minor Changes

- 5bf13be: API review: the overlay's internal plumbing leaves the public barrel
  
  **Breaking.** Six symbols marked `@internal` are no longer exported from `@ignifx/ui` (nor,
  therefore, from the `ignifx` umbrella). None was reachable in a way a game could use: `UiHost`,
  `I18nService`, `TextRuntime` and `UiSystem` are all built by the `ui()` extension through
  constructors that are themselves `@internal`.
  
  - `asDomCanvas`, `resolveDomTarget` — the DOM-target narrowing helpers.
  - `UiHostOptions`, `I18nServiceOptions`, `TextRuntimeOptions` — the option bags of those `@internal`
    constructors.
  - `TextRuntime` — the Lite text-renderer wrapper the UI system drives.
  
  `UiSystemOptions` is now `@internal` for the same reason: `UiSystem`'s constructor is `@internal`
  and the interface carried `TextRuntime` into the public surface. `UiDomTarget` and `UiSystem` stay
  `@public`.
  
  **Changed.** `AnchorInput` is `@public`. `computeAnchorPlacement` is `@public` and takes one, which
  API Extractor reported as an `ae-incompatible-release-tags` contradiction.
- d049484: Add `Menu` and `MenuStack`, the list and screen-navigation widgets every game menu is made of, and
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
- d349254: Phase 8: UI
  
  `@ignifx/ui` ships the subsystem `docs/architecture/13-ui.md` describes. Registering `ui()` gives a game `app.ui`, `app.i18n`, four components, the `i18n` asset type, the `ui` settings section, and one `PreRender` system at order `1100` — after `@ignifx/core`'s camera synchronisation at `900`, because every projection needs this frame's camera.
  
  **The overlay.** One absolutely positioned `<div>` over the canvas, `pointer-events: none`, holding one `<div>` per named layer at z-index `10`, `20`, `30`… Games mount React, Svelte, Vue or plain DOM into it. Three scaling modes: `"css"` (one UI unit is one CSS pixel), `"fit"` (one reference pixel, letterboxed to keep aspect), and `"dpi"` (one **backing-store** pixel — the space `Camera.worldToScreen`, `HudText` and `captureScreenshot()` all work in, so an element at `left: 100px` lands on render-target column 100). The layout follows the canvas through a `ResizeObserver` and the window's `resize`, and `app.ui.pixelMapping` converts between the two pixel spaces. Safe-area insets are exposed as `--ignifx-safe-*` custom properties.
  
  **Focus routing.** `InputService.uiHasFocus` is a plain settable property whose own documentation says `@ignifx/ui` assigns it, so this package owns the policy and defines it as text entry — `<textarea>`, `<select>`, `contenteditable`, and an `<input>` whose type is not button-like or slider-like — with `data-ignifx-focus="capture"`/`"ignore"` as the override. A focused `<button>` deliberately keeps gameplay running. A press on an interactive UI element never reaches gameplay in the first place, because `@ignifx/input` reads `pointerdown` from the canvas and the overlay is the canvas's sibling; a *drag* still moves `<Pointer>/delta`, and `app.ui.pointerOverUi` is the hook for that until `@ignifx/input` gains a pointing-device equivalent of `uiHasFocus`.
  
  **Text.** `WorldAnchor` keeps a game-supplied DOM element on an entity's screen position, with clamping, behind-camera handling and distance scaling. `HudText`, `WorldText2D` and `WorldText` draw through Babylon Lite's text renderer: pixel-space text anchored to one of nine points of the render target, pixel-space text at an entity's projected position, and a 3D renderable in the scene. Fonts come from core's `FontAsset`. Changing `text` or `color` re-shapes in place; changing `font`, `fontSize`, `maxWidth`, `align` or `lineHeight` rebuilds the block, because Lite's `updateDefaultTextData` reuses the size and layout options the block was created with.
  
  **Helpers.** `Dialog`, `Toast` and `LoadingScreen` are plain DOM classes with one injected stylesheet and `ignifx-ui-*` class hooks; a pause menu is `new Dialog(app.ui, { title, buttons })` plus `app.pause()`, and a boot screen is `new LoadingScreen(app.ui).bindTo(app.assets)`. `VirtualJoystick` and `VirtualButton` write `@ignifx/input`'s virtual device, replacing the widget the 2D templates carried in Phase 6; they reach the device structurally rather than by importing `@ignifx/input`, which is what keeps that peer genuinely optional.
  
  **Localization.** `app.i18n` loads `ignifx.i18n` documents (`.i18n.json`, asset type `i18n`) that carry every locale in one file, with `{name}` interpolation and ICU-style plurals — `=0`-style exact matches, the active locale's CLDR categories through `Intl.PluralRules`, and `#` for the number. A missing key renders as the key; `select`, number and date skeletons and ICU apostrophe quoting are out of scope. All three text components accept an `i18nKey` and re-shape on `onLocaleChanged`.
  
  **Two Babylon Lite limitations, verified against 1.27.0 and documented rather than worked around.** `addTextRenderable` pushes a *deferred* scene builder that only `buildScene` drains, once, when the scene is registered — so a `WorldText` that first gets its text after `app.start()` does not draw and logs `IGX-1308`; `WorldText2D` owns a text layer and has no such restriction. And there is no `removeTextRenderable`: a destroyed `WorldText` empties its block and zeroes its opacity, which draws nothing and frees its GPU buffers, but the record stays in the scene's renderable list until the scene is disposed.
  
  New diagnostic codes: `IGX-1301` a second `ui()`, `IGX-1302` an unreadable `.i18n.json`, `IGX-1303` an undeclared locale, `IGX-1304` an unparseable message, `IGX-1305` a touch widget without `@ignifx/input`, `IGX-1306` a text component with no font, `IGX-1307` a DOM member on a host with no document, `IGX-1308` a `WorldText` built too late for Lite to draw.

### Patch Changes

- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [7ca9efe]
- Updated dependencies [d349254]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [4cfb15f]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0
  - @ignifx/input@0.1.0

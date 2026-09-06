---
name: ui
description: Builds game UI in ignifx with @ignifx/ui: the DOM overlay host and layers, scaling modes, input focus routing, world-space anchors, world and HUD text on Babylon Lite's text renderer, virtual joysticks and buttons for touch, dialogs, toasts, loading screens, and localization. Use when adding or editing menus, HUDs, on-screen text, touch controls, or overlay UI in an ignifx project, or when the user mentions @ignifx/ui, HudText, WorldAnchor, VirtualJoystick, or app.i18n.
license: Apache-2.0
metadata:
  ignifx-version: "0.0.0-unreleased"
---

# @ignifx/ui

## What this is / when to use

**Game UI in ignifx is HTML.** `@ignifx/ui` puts one absolutely positioned `<div>` over the canvas
and lets a game mount React, Svelte, Vue or plain DOM into named layers inside it. That is what
gives every game accessibility, real fonts, real layout, and any framework the team already knows.

Use the DOM for menus, HUDs, dialogs and touch controls. Use the **text components** only for text
that has to be drawn by the GPU: text that belongs in the world (`WorldText`), text that follows an
entity (`WorldText2D`), and pixel-exact HUD text that has to show up in `captureScreenshot()`
(`HudText`).

Everything registers headlessly. With no canvas, `app.ui.root` is `null`, every DOM member is a
documented no-op, and the components keep their state — so the same script runs in a Node test.

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- WebGPU only, browser and Electron. Babylon Lite `1.27.0` is a peer dependency.
- `@ignifx/input` is an **optional** peer: only `VirtualJoystick` and `VirtualButton` need it.
- Register it like any extension; nothing happens at import time.

```ts
import { createApp } from "ignifx";
import { ui } from "@ignifx/ui";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({
    canvas,
    extensions: [ui({ scaling: "fit", referenceResolution: [640, 360] })],
  });
  await app.start();
}
```

`ignifx.config.ts` carries the same settings under `ui`:

| Setting               | Default                      | Meaning                                 |
| --------------------- | ---------------------------- | --------------------------------------- |
| `scaling`             | `"css"`                      | `"css"`, `"fit"` or `"dpi"` — see below |
| `referenceResolution` | `[1920, 1080]`               | The `[w, h]` `"fit"` scales to          |
| `layers`              | `["hud", "menu", "overlay"]` | Created up front, back to front         |
| `visible`             | `true`                       | Whether the overlay is shown            |

`ui()` also takes `strings` (a `.i18n.json` address to load at start-up) and `locale`.

## Mental model

```
app.ui (UiHost)
 ├─ root            the <div> over the canvas; pointer-events: none
 ├─ layer(name)     one <div> per layer, z-index 10, 20, 30 …
 ├─ scaling         "css" | "fit" | "dpi"; layout · pixelMapping · onLayoutChanged
 ├─ visible · pointerOverUi · keyboardHasFocus · refresh()
app.i18n (I18nService)
 └─ load(handle) · t(key, params) · locale · onLocaleChanged · availableLocales

components   WorldAnchor · HudText · WorldText2D · WorldText
helpers      Dialog · Toast · LoadingScreen · VirtualJoystick · VirtualButton
```

**One system, `PreRender` order 1100** — after core's camera sync at 900, because every projection
needs this frame's camera. It projects the anchors, re-shapes whatever text changed, and writes the
DOM.

**Three coordinate systems.** A canvas has a CSS size and a backing-store size. `Camera.worldToScreen`,
`HudText`, and `captureScreenshot()` all work in **backing-store** pixels; a DOM element is placed in
**UI units**. The scaling mode decides what a UI unit is:

| Mode    | One UI unit is      | Use it for                                             |
| ------- | ------------------- | ------------------------------------------------------ |
| `"css"` | one CSS pixel       | responsive HTML menus (the browser default)            |
| `"fit"` | one reference pixel | a HUD authored once at a fixed resolution, letterboxed |
| `"dpi"` | one backing pixel   | a pixel HUD that must line up with a screenshot        |

`app.ui.pixelMapping` converts between them, and `WorldAnchor` already does it for you.

## First app

```ts
import { createApp, FontAsset } from "ignifx";
import { HudText, ui, WorldAnchor } from "@ignifx/ui";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [ui()] });

  // A DOM label in the hud layer.
  const score = document.createElement("div");
  score.textContent = "Score: 0";
  score.style.position = "absolute";
  score.style.left = "16px";
  score.style.top = "16px";
  app.ui.layer("hud").element?.append(score);

  // A name tag that follows an entity.
  const tag = document.createElement("div");
  tag.textContent = "Boss";
  app.ui.layer("hud").element?.append(tag);
  const boss = app.world.createEntity("boss");
  const anchor = boss.addComponent(WorldAnchor);
  anchor.element = tag;
  anchor.offset = { x: 0, y: 2, z: 0 };

  // GPU text, for a pixel-exact readout.
  const font = app.assets.load<FontAsset>("ui/Inter-Regular.ttf");
  const readout = app.world.createEntity("readout").addComponent(HudText);
  readout.font = font;
  readout.text = "60 fps";
  readout.anchor = "topRight";
  readout.position = { x: -16, y: 16 };

  await app.start();
}
```

## Core APIs

**`app.ui`** — `root`, `isActive`, `layer(name, { zIndex, visible })`, `layers`, `scaling`,
`referenceResolution`, `visible`, `layout`, `pixelMapping`, `pointerOverUi`, `keyboardHasFocus`,
`onLayoutChanged`, `refresh()`.

**`UiLayer`** — `name`, `element`, `zIndex`, `visible`, `clear()`.

**`WorldAnchor`** — `element` (assigned in code, never serialised), `offset`,
`hideWhenBehindCamera`, `clampToScreen`, `scaleWithDistance`, `referenceDistance`, `minScale`,
`maxScale`, `placement`.

**`HudText`** — the shared text fields plus `anchor` (one of nine), `position` (backing pixels from
that anchor), `order`, `metrics`.

**`WorldText2D`** — the shared fields plus `offset` (world), `screenOffset` (pixels), `pivot`,
`hideWhenBehindCamera`, `order`.

**`WorldText`** — the shared fields plus `offset`, `pixelsPerUnit` (default 100), `billboard`,
`alwaysOnTop`.

Shared text fields: `font` (a `FontAsset` handle), `text`, `i18nKey`, `fontSize`, `color`, `align`,
`maxWidth`, `lineHeight`, `opacity`.

**`app.i18n`** — `load(handleOrAsset)`, `t(key, params)`, `has(key)`, `locale`, `fallbackLocale`,
`availableLocales`, `onLocaleChanged`.

Full signatures: `skills/ignifx/references/api/ui.md`.

## Recipes

### A pause menu, and a loading screen

```ts
import { createApp } from "ignifx";
import { Dialog, LoadingScreen, ui } from "@ignifx/ui";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [ui()] });

  const loading = new LoadingScreen(app.ui, { label: "Loading…" });
  loading.bindTo(app.assets);
  await app.assets.preloadGroup("boot").promise;
  loading.hide();

  const pause = new Dialog(app.ui, {
    title: "Paused",
    buttons: [
      { id: "resume", label: "Resume" },
      { id: "quit", label: "Quit" },
    ],
  });
  pause.onChosen.connect((id: string) => {
    pause.hide();
    if (id === "resume") {
      app.resume();
    }
  });

  // Somewhere in the game's own input handling:
  pause.show();
  app.pause();

  await app.start();
}
```

### Touch controls

```ts
import { createApp } from "ignifx";
import { input } from "@ignifx/input";
import { ui, VirtualButton, VirtualJoystick } from "@ignifx/ui";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [input(), ui()] });
  if (navigator.maxTouchPoints > 0) {
    const stick = new VirtualJoystick(app, { control: "joystick", style: { left: "2rem", bottom: "2rem" } });
    const jump = new VirtualButton(app, { control: "jump", label: "A", style: { right: "2rem", bottom: "2rem" } });
    void stick;
    void jump;
  }
  await app.start();
}
```

Bind `<Virtual>/joystick` and `<Virtual>/jump` in the game's `.input.json` exactly as any hardware
path; nothing else changes.

### Localized text

```ts
import { createApp } from "ignifx";
import { LocaleAsset, ui } from "@ignifx/ui";

const app = await createApp({ headless: true, extensions: [ui()] });
const strings = app.assets.load<LocaleAsset>("ui/strings.i18n.json");
await app.i18n.load(strings);

app.i18n.t("hud.score", { score: 42 }); // "Score: 42"
app.i18n.t("hud.lives", { count: 1 }); // "1 life"
app.i18n.t("hud.lives", { count: 3 }); // "3 lives"

app.i18n.locale = "fr";
app.i18n.t("hud.lives", { count: 3 }); // "3 vies"
app.dispose();
```

A `HudText`, `WorldText` or `WorldText2D` with an `i18nKey` re-shapes itself when the locale
changes; `i18nKey` wins over `text`.

## File formats

`ignifx.i18n` (`.i18n.json`, asset type `i18n`) — one document, every locale:

```json
{
  "format": "ignifx.i18n",
  "formatVersion": 1,
  "defaultLocale": "en",
  "locales": {
    "en": { "hud.lives": "{count, plural, =0 {No lives} one {# life} other {# lives}}" },
    "fr": { "hud.lives": "{count, plural, =0 {Aucune vie} one {# vie} other {# vies}}" }
  }
}
```

Supported: `{name}` interpolation, `{n, plural, …}` with `=0`-style exact matches, the CLDR
categories for the active locale, and `#` for the number. Not supported: `select`, number and date
skeletons, and ICU's apostrophe quoting — braces are structural, so a literal brace arrives as a
parameter. Field reference: `skills/ignifx/references/formats/ignifx.i18n.md`.

## Gotchas

- **A click on UI never reaches gameplay, but a drag does.** `@ignifx/input` reads `pointerdown`
  from the _canvas_, and the overlay is the canvas's sibling — so a press on a
  `pointer-events: auto` element is never queued. It reads `pointermove`/`pointerup` from the
  _window_, so a drag that started on a slider still moves `<Pointer>/delta`. Check
  `app.ui.pointerOverUi` in a camera script.
- **Only text fields take the keyboard.** `app.input.uiHasFocus` is set for `<input>` (except the
  button- and slider-like types), `<textarea>`, `<select>` and `contenteditable`. A focused
  `<button>` deliberately does not stop gameplay. Override with `data-ignifx-focus="capture"` or
  `"ignore"`.
- **`HudText.position` is in render-target pixels, not CSS pixels.** That is the point: it is the
  same space `captureScreenshot()` reads back. A DOM label in `app.ui.layer("hud")` is the right
  tool when you want CSS pixels.
- **`WorldText` has to exist before `app.start()`.** Babylon Lite drains a deferred scene renderable
  exactly once, when the scene is registered, and offers no way to drain a later one; a sign that
  first gets its text mid-game logs `IGX-1308` and does not draw. Use `WorldText2D`, which owns a
  text layer and can be added at any time.
- **`align` aligns lines against each other, not against `maxWidth`.** To centre a block on screen,
  use `HudText.anchor` (or read `metrics` and do the arithmetic).
- **Changing `fontSize`, `maxWidth`, `align`, `lineHeight` or `font` re-shapes from scratch**;
  changing `text` or `color` does not. A per-frame counter is cheap; a per-frame font size is not.
- **`WorldAnchor.element` is not serialised.** A scene file carries the flags; the game assigns the
  element in `awake`.
- **A `Toast` runs on the game clock.** Call `toast.advance(dt)` from a script's `update`; it then
  pauses when the game pauses and is deterministic in a headless test.
- **Two apps in one document share one stylesheet and get one overlay each.** The root is mounted
  as the canvas's next sibling, so put the canvas in a positioned wrapper.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `docs/architecture/13-ui.md` for design
rationale · `skills/ignifx/references/api/ui.md` for full signatures.

---
"@ignifx/devtools": minor
---

The devtools overlay, its nine panels, and `app.devtools`

`devtools()` gives a game `app.devtools`, the `devtools` settings section, and a toggle key — a raw
`keydown` on the document (default `Backquote`), never an input action, so it works without
`@ignifx/input` and survives a pause menu disabling an action map.
`app.devtools` is `{ open, close, toggle, isOpen, panel(name), panels, select, selected,
reloadScenes, isSceneReloadDelegated, onOpened, onClosed, onSelectionChanged }`. On an app with no
DOM canvas `open()` is a documented no-op with one debug line; everything else works headlessly.

**Zero cost when closed**, precisely: no system is registered until the first `open()`, no signal is
subscribed to while it is closed, and no DOM exists while it is closed. `benchmarks/devtools-closed.test.ts`
measures a 1,002-entity headless scene over 1,200 frames per variant and asserts the per-frame
median moves by at most 0.02 ms; it measured 0.0005 ms. Core's scheduler has no `unregisterSystem`,
so after the first `open()` the `PreRender` sampler stays registered and returns on its first line
while the overlay is closed.

Nine panels: **Stats**, **Scene tree** (search, select, toggle active, destroy, virtualised to
10,000 entities), **Inspector** (schema-driven editing, copy as JSON, "select in world" through
`renderer.pickAsync`), **Assets**, **Input**, **Audio**, **Physics**, **Console** and **Timeline**
(per-phase CPU milliseconds over the 300-frame ring buffer). The overlay mounts into
`app.ui.layer("devtools")` when `@ignifx/ui` is registered and builds its own root beside the canvas
otherwise. `@ignifx/ui`, `@ignifx/input`, `@ignifx/audio`, `@ignifx/physics` and `@ignifx/physics-2d`
are optional peers the package never imports: every reach into them is a structural shape check, so
a game with only `@ignifx/core` opens the same overlay.

`createDevtoolsLogSink()` is how the Console panel gets log lines: `app.log`'s sink is fixed by
`createApp`, so the game passes one sink object to both `createApp({ logSink })` and
`devtools({ logSink })`. Without it the panel still shows `app.onError` and `app.hotReload` reports.

New codes: `IGX-1550` (duplicate extension), `IGX-1551` (headless no-op), `IGX-1552` (unknown
panel), `IGX-1553` (read-only field), `IGX-1554` (rejected inspector write), `IGX-1555` (no asset
reload entry point), `IGX-1556` (scene cannot be re-instantiated), `IGX-1557` (no canvas to pick
from). `@ignifx/core` keeps `IGX-1501`–`IGX-1549`.

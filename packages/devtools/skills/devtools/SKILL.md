---
name: devtools
description: Inspects and debugs a running ignifx game with @ignifx/devtools: the stats and diagnostics overlay, the scene tree browser, the schema-driven component inspector, the physics debug view, the console, and the script hot-reload reports. Use when diagnosing frame time, entity counts, component values, asset refcounts, or physics behaviour in an ignifx project, or when the user mentions @ignifx/devtools, the stats overlay, the inspector, or app.devtools.
license: Apache-2.0
metadata:
  ignifx-version: "0.2.0"
---

# @ignifx/devtools

## What this is / when to use

`@ignifx/devtools` is the ignifx extension that puts a debug overlay over the canvas: frame numbers,
the entity tree, a live component inspector, asset handles, input, audio, physics, the log, and a
per-phase timing graph. Register it in a development build, press the backtick key, and look.

Use it when the question is "what is this game actually doing right now". Do **not** use it to build
game UI — that is `@ignifx/ui`. Do not ship it in a production bundle; it is a development tool and
nothing in it is a stable runtime surface for game code.

It costs nothing while it is closed: no system runs, no signal is subscribed to, and no DOM exists
until `open()` is called.

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- WebGPU only, browser and Electron. The overlay is plain DOM over the canvas.
- `@ignifx/ui`, `@ignifx/input`, `@ignifx/audio`, `@ignifx/physics` and `@ignifx/physics-2d` are all
  **optional** peers. The package imports none of them; it reaches them structurally, so a game with
  only `@ignifx/core` gets the same overlay with three of its nine panels saying "not registered".
- Register it like any extension; nothing happens at import time.

```ts
import { createApp } from "ignifx";
import { devtools } from "@ignifx/devtools";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [devtools()] });
  await app.start();
  app.devtools.open();
}
```

`ignifx.config.ts` carries the same settings under `devtools`:

| Setting        | Default            | Meaning                                                 |
| -------------- | ------------------ | ------------------------------------------------------- |
| `toggleKey`    | `"Backquote"`      | A `KeyboardEvent.code`; a raw `keydown` on the document |
| `openOnStart`  | `false`            | Open the overlay as soon as the app starts              |
| `reloadScenes` | `false`            | Re-instantiate a scene instance when its file changes   |
| `panels`       | all nine, in order | The tab order — and, by omission, a filter              |
| `position`     | `"right"`          | `"right"`, `"left"`, `"top"` or `"bottom"`              |
| `opacity`      | `0.92`             | The overlay's background opacity                        |

`devtools()` also takes `logSink` to share the Console panel's sink with something else (a `tee` to the browser console, a bigger buffer); by default the extension creates one and adds it to `app.log`.

## Mental model

```
app.devtools (DevtoolsService)
├── open() / close() / toggle()     the whole lifecycle; closed means "not there"
├── panel(name).show() / .hide()    nine panels, addressed by name
├── select(entity)                  what the Inspector shows
└── onOpened / onClosed / onSelectionChanged
```

Opening installs one `PreRender` system at order `9000` — after every renderer, 2D, UI and audio
system, so the numbers it reports are the ones those systems just wrote. That system samples once
per frame; text panels are rewritten at 10 Hz and the Timeline graph every frame, and only the
visible panel is rewritten at all.

Where the overlay mounts depends on what else is installed. With `@ignifx/ui` registered it goes into
`app.ui.layer("devtools")`; without it, the overlay builds its own `<div>` as the canvas's next
sibling. Either way it is a sibling of the canvas rather than a child, so it never intercepts a
gameplay click.

Everything except the DOM works headlessly: on an app with no canvas, `open()` is a no-op with one
debug line, and `panel(name)`, `select(entity)` and the signals behave normally.

## First app

A complete headless program. `app.devtools.open()` does nothing without a canvas, which is the
point: the same code is the same code in a test.

```ts run
import { createApp, f32, Script } from "ignifx";
import { devtools } from "@ignifx/devtools";

class Mover extends Script.define({ speed: f32(3) }) {
  static typeId = "mygame/Mover";

  update(dt: number): void {
    this.transform.localPosition.x += this.speed * dt;
  }
}

const app = await createApp({ headless: true, extensions: [devtools()] });
app.registerComponents([Mover]);

const hero = app.world.createEntity("Hero");
hero.addComponent(Mover, { speed: 5 });

await app.start();
app.step(1 / 60);

// The overlay would show these three numbers in its Stats panel.
const frame = app.diagnostics.frame;
console.log(frame.frame, frame.scriptsUpdated, app.world.scenes[0]?.roots.length);

// Point the Inspector at the hero, and bring its tab to the front.
app.devtools.select(hero);
app.devtools.panel("inspector").show();
console.log(app.devtools.selected?.name, app.devtools.isOpen);

app.dispose();
```

## Core APIs

`skills/ignifx/references/api/devtools.md` has the generated surface. The parts a developer touches:

| Member                             | What it does                                                        |
| ---------------------------------- | ------------------------------------------------------------------- |
| `devtools(options?)`               | The extension factory; pass it to `createApp({ extensions })`       |
| `app.devtools.open/close/toggle()` | Builds or disposes the overlay; `open()` is a no-op with no canvas  |
| `app.devtools.isOpen`              | Whether the overlay is up                                           |
| `app.devtools.panel(name)`         | `{ name, title, visible, show(), hide() }`; `IGX-1552` if unknown   |
| `app.devtools.panels`              | Every panel this build carries, in tab order                        |
| `app.devtools.select(entity)`      | What the Inspector shows; `null` clears it                          |
| `app.devtools.reloadScenes`        | Runtime scene reload — see **Gotchas**                              |
| `app.devtools.onOpened/onClosed`   | Signals, for a game that pauses itself while the overlay is up      |
| `createDevtoolsLogSink(options?)`  | The Console panel's sink; the game installs it on `createApp`       |
| `DEVTOOLS_PANEL_NAMES`             | `stats scene inspector assets input audio physics console timeline` |

Panel names are exactly those nine strings; `panels` in the settings is a re-ordering and a filter
over them.

## Recipes

### Read the numbers the Stats panel shows

Everything on the Stats panel comes from `app.diagnostics`, so a test or a HUD can read the same
values without opening anything.

```ts run
import { createApp } from "ignifx";
import { devtools } from "@ignifx/devtools";

const app = await createApp({ headless: true, extensions: [devtools()] });
await app.start();
app.step(1 / 60);

const frame = app.diagnostics.frame;
console.log(frame.rawDeltaMs, frame.fixedSteps, frame.scriptsUpdated);

// Counter groups are per subsystem; `render` and `assets` are always registered by core.
const render = app.diagnostics.group("render");
if (render !== null) {
  console.log(render.get(render.index("drawCalls")));
}

app.dispose();
```

### Put the log in the Console panel

`app.log`'s sink is fixed when the app is built, so the game installs the sink and hands the _same
object_ to both calls.

```ts run
import { createApp } from "ignifx";
import { createDevtoolsLogSink, devtools } from "@ignifx/devtools";

// Optional: a sink of your own, here with a bigger buffer. Without it the extension makes one and
// adds it to `app.log` itself, so the Console panel fills either way.
const logSink = createDevtoolsLogSink({ limit: 2000 });
const app = await createApp({ headless: true, logLevel: "debug", extensions: [devtools({ logSink })] });

app.log.child("assets").warn("no atlas for sprite:", "hero");
console.log(logSink.length, logSink.at(0)?.message);

app.dispose();
```

### Open a specific panel on a key of your own

```ts run
import { createApp } from "ignifx";
import { devtools } from "@ignifx/devtools";

const app = await createApp({ headless: true, extensions: [devtools({ toggleKey: "F1" })] });
await app.start();

app.devtools.onOpened.connect(() => {
  app.devtools.panel("timeline").show();
});
app.devtools.panel("audio").hide();

console.log(app.devtools.panels.map((panel) => `${panel.name}:${String(panel.visible)}`).join(" "));
app.dispose();
```

## File formats

None. `@ignifx/devtools` reads the formats other packages own — the scene file through
`serializeScene` for "copy entity as JSON", and every component schema for the Inspector — and
writes none of its own. Its one configuration surface is the `devtools` section of
`ignifx.config.ts`, listed under **Environment**.

## Gotchas

- **The Console panel is added to `app.log`, not put in its place.** `createApp({ logSink })` keeps
  writing wherever the game pointed it (the browser console by default); the devtools sink is a
  second sink via `Logger.addSink`, removed again when the app is disposed.
- **`Transform` has no schema.** The scene format writes it as a first-class record rather than as
  `props`, so the Inspector builds its position/rotation/scale rows by hand. They write through
  `transform.localPosition` and friends, which are live views over the Babylon Lite node — which is
  why an inspector edit moves the entity in the same frame.
- **Some field kinds are read-only in the Inspector.** `array`, `record`, `map`, `layerMask`,
  `curve` and `custom` are shown as their encoded JSON. Edit them from code or from the scene file.
- **The Assets panel lists the manifest, not every handle.** `Assets` publishes no listing of live
  handles, so an asset registered at run time under an address the manifest never carried does not
  appear. Force reload needs the asset service's `reload` entry point; on a build without one the
  button is disabled and reports `IGX-1555`.
- **`app.devtools.reloadScenes` is the runtime switch, not the engine's.** Core's own
  `app.hotReload.reloadScenes` is set by `createApp({ hotReload: { reloadScenes: true } })` and is
  read-only afterwards. When it is already on, the devtools toggle deliberately stands down rather
  than rebuilding every scene twice, and the Stats panel says so.
- **The sampler system outlives a close.** Core's scheduler has `registerSystem` and no
  `unregisterSystem`, so once the overlay has been opened the system stays registered and returns on
  its first line while the overlay is closed. Never opening it registers nothing at all.
- **Do not ship it.** Register `devtools()` behind your build's development flag. The package is
  ~36 KB gzipped and its whole purpose is to expose internals.
- **The toggle key is a raw `keydown` on the document**, not an input action, so it works without
  `@ignifx/input` and cannot be disabled by a pause menu turning an action map off. It ignores
  keystrokes typed into an `<input>`, `<textarea>`, `<select>` or `contenteditable`.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `docs/architecture/15-devtools-and-diagnostics.md`
§3–§5 for the diagnostics, overlay and hot-reload design · `packages/devtools/api/devtools.api.md`
for the exact surface.

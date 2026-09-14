# 03 · Pages and copy

Historical launch copy, superseded by the 2026-09-11 content pass in [DESIGN.md](../DESIGN.md).
Current copy lives in the page renderers, copy tables and example catalogue entries.
Where a line depends on the first npm release, both variants are given and marked
**[pre-release]** / **[release]**; the
build picks one from `website/site.config.ts` (`published: boolean`, `version: string`).

Conventions: `ignifx` is lowercase everywhere. Package names are code. Browser versions are the ones
the skill states. Text in _italics_ is a note to the engineer, not copy.

---

## 1. Global

**Site name:** ignifx
**Default title pattern:** `<Page> · ignifx` (home: `ignifx · The TypeScript game engine for WebGPU`)
**Default meta description:** ignifx is an open-source TypeScript game engine built on WebGPU. Write
your game as code and run it in the browser or on the desktop, with physics, audio, input, UI and
animation included.

**Header:** Features · Examples · Docs · Press · GitHub · npm

- npm **[pre-release]**: a disabled button labelled "npm · soon" with `title="First release coming to npm"`.
- npm **[release]**: links to `https://www.npmjs.com/package/ignifx`.
- GitHub: `https://github.com/astrum-forge/ignifx`.

**Footer columns:** see `01-strategy-and-ia.md` §8.
**Footer line:** © 2026 Astrum Forge Studios Pty Ltd. ignifx is a trademark of Astrum Forge Studios.
Apache-2.0. Building with an AI agent? Start at /llms.txt.

**Support pill states:**

- no JS: "WebGPU: checking…"
- available: "WebGPU available in this browser"
- unavailable: "WebGPU is not available in this browser. See browser support →"

---

## 2. Home `/`

**Title:** ignifx · The TypeScript game engine for WebGPU
**Description:** Build 2D and 3D games in TypeScript and ship them to any modern browser and the
desktop. Open source, WebGPU-only, batteries included.

### Hero

Eyebrow: OPEN SOURCE · TYPESCRIPT · WEBGPU

H1: **Ignite your next game.**

_Alternate H1 if the owner prefers the literal: "The TypeScript game engine for WebGPU."_

Lead: ignifx is an open-source TypeScript game engine built on WebGPU. Write your game as code, run it
in the browser or on the desktop, and ship with physics, audio, input, UI and animation already in
the box.

Buttons: **Get started** → `/docs/getting-started/` · **See the examples** → `/examples/`

Support line (under the buttons, small): Runs wherever WebGPU does: Chrome and Edge 113+, Safari
26+, Firefox 141+ on Windows and 145+ on Apple Silicon. Desktop through Electron.

Hero canvas caption: _Physically based rendering_ — a glTF model lit by an image-based environment,
with bloom and tone mapping. Drag to orbit. **Open this example →**

### Why ignifx

H2: **Why ignifx**

1. **Code first.** Your game is TypeScript, not a project file. Entities, components and scripts with
   typed, schema-declared fields. One obvious way to do each thing, and no decorators, globals or
   magic.
2. **WebGPU only, by design.** ignifx renders through Babylon Lite on WebGPU alone. One render path
   means PBR materials, image-based lighting, shadows and post-processing that behave the same
   everywhere WebGPU runs, and nothing to test twice.
3. **Batteries included.** 3D physics on Havok. 2D physics on Rapier. Spatial audio with a real
   mixer. Action-based input with rebinding. A DOM UI layer. Animation state machines, navigation
   meshes, sprites and tilemaps. Each one is a line in `createApp`.
4. **Browser, desktop and headless.** The same game runs in a browser tab, in a hardened Electron
   window, and headlessly in Node for your tests and tools. Saves, settings and rebinds persist on
   all three.
5. **Open source, from a studio that ships with it.** Apache-2.0, developed in the open, and used by
   Astrum Forge Studios for its own games and projects.

### The code

H2: **This is a complete ignifx app**

Copy: A camera, a shadow-casting light, a ground plane and a spinning cube, every asset created in
code. There is no hidden project file behind it. This sample is compiled and run by the engine's
documentation checks, so it cannot go stale.

_Code: the "First app" block from `skills/ignifx/SKILL.md`, sliced at build time as the current site
does. Caption: `main.ts · compiled by the docs harness`._

Side bullets:

- **Typed fields, no decorators.** `Script.define({ speed: f32(90) })` is a serialisable, inspectable
  field.
- **One frame, six phases.** A fixed step for simulation, `update` for the rest, and every callback
  in a documented order.
- **Extensions in one line.** `createApp({ extensions: [input(), physics(), audio()] })`.

### Features grid

H2: **Everything a game needs**

Intro: Twelve subsystems, one API style, one version number. Add the ones you use.

_Twelve cards. Each: package chip, heading, one line, "See it →" to the example named._

| Chip                 | Heading                  | Line                                                                                  | See it                           |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------- | -------------------------------- |
| `@ignifx/core`       | Rendering                | PBR materials, image-based lighting, shadows, bloom and SMAA through Babylon Lite.    | `pbr-model`                      |
| `@ignifx/core`       | Scenes and prefabs       | One JSON format for scenes and prefabs; instances keep their overrides.               | `scenes-and-prefabs`             |
| `@ignifx/core`       | Assets                   | Addressed, typed, reference-counted, cancellable, and hot-swappable in development.   | `model-loading`                  |
| `@ignifx/physics`    | 3D physics               | Rigid bodies, colliders, triggers, a character controller and queries, on Havok.      | `physics-playground`             |
| `@ignifx/physics-2d` | 2D physics               | Bodies, colliders, one-way platforms and a platformer controller, on Rapier.          | `physics-2d`                     |
| `@ignifx/2d`         | Sprites and tilemaps     | Atlases from TexturePacker and Aseprite, tilemaps from Tiled and LDtk, pixel-perfect. | `tilemap`                        |
| `@ignifx/3d`         | Characters and cameras   | Third- and first-person rigs, an orbit camera that stays out of walls.                | `third-person`                   |
| `@ignifx/3d`         | Animation and navigation | State machines with blend trees on glTF skeletons; navmesh agents on Recast.          | `animator`                       |
| `@ignifx/input`      | Input                    | Keyboard, mouse, gamepad and touch become named actions you can rebind at runtime.    | `input-actions`                  |
| `@ignifx/audio`      | Audio                    | A bus tree, positional one-shots, music, and browsers that start locked, handled.     | `audio-mixer`                    |
| `@ignifx/ui`         | UI                       | Menus, dialogs, toasts, HUD and world-space text, virtual gamepad, translations.      | `ui-overlay`                     |
| `@ignifx/electron`   | Desktop                  | A hardened Electron window, a typed bridge, and file-system saves. One flag to build. | `/docs/getting-started/#desktop` |

Link under the grid: **All features →** `/features/`

### Templates

H2: **Start from a playable game**

Intro: Four templates, each a small finished game: title screen, pause menu, settings, rebinding,
saves, and keyboard, gamepad and touch controls. Copy one and replace the game.

| Template         | Line                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| 2D top-down      | A tilemap with collision, Y-sorted props, a dead-zoned camera and shrines to light.        |
| 2D side-scroller | Parallax bands, slopes and one-way platforms, coins, and a pixel-perfect camera.           |
| 3D third-person  | A character on a capsule, an orbit camera that avoids walls, an animated rig, a companion. |
| 3D first-person  | Walk, sprint, crouch and jump with pointer lock, a view model, and things to push.         |

Card buttons: **Play** → the template's example page · **Create** _(copies `npx create-ignifx my-game
--template <name>`; pre-release: shows the clone path instead)_.

### Examples teaser

H2: **See it running**

Intro: Every example runs in your browser, with its source beside it.

_Six example cards: `pbr-model`, `shadows`, `bloom`, `tilemap`, `physics-playground`,
`third-person`._ Link: **All examples →**

### Studio

H2: **Built by a studio that ships with it**

Copy: ignifx is developed by Astrum Forge Studios, an independent game studio, and it is the engine
behind the studio's own games and projects. Features arrive because a game needed them, and they stay
because a game still does.

Link: **astrumforge.com →**

### Get started

H2: **Get started in a minute**

**[release]** code block:

```sh
npm create ignifx@latest my-game
cd my-game && npm install && npm run dev
```

Caption: Pick a template when asked, or pass `--template 3d-third-person`. Add `--desktop` for an
Electron build.

**[pre-release]** code block:

```sh
git clone https://github.com/astrum-forge/ignifx.git
cd ignifx && pnpm install && pnpm build
pnpm --filter ignifx-template-3d-third-person dev
```

Caption: ignifx is not on npm yet. Until the first release, clone the repository and run a template
from the workspace. **Watch the repository** to hear when the packages ship.

Button: **Read the guide** → `/docs/getting-started/`

---

## 3. Features `/features/`

**Title:** Features · ignifx
**Description:** The complete list of what ignifx does: rendering, physics, 2D, 3D, input, audio, UI,
desktop, devtools, tooling, and headless testing.

H1: **Features**
Lead: Everything in the box, grouped the way you will use it. Each section links to an example that
runs in your browser.

_Jump bar: the fifteen section titles below._

### 3.1 Kernel and scripting — `@ignifx/core`

The engine's core is small and explicit. An `App` owns a `World`; a world holds scenes; scenes hold
entities; entities hold a transform and components. A `Script` is a component with lifecycle
callbacks and typed fields you declare with a schema, so every field is serialisable, inspectable and
hot-reloadable without a decorator in sight.

- `createApp` with extensions, settings, a clock and a log sink
- `World`, `SceneInstance`, `Entity`, `Transform`, tags and layers
- `Component` for data, `Script` for behaviour; fields from `Script.define({ … })`
- A documented frame: `PreUpdate` → `fixedUpdate` × N → `start` → `update` → coroutines → `PostUpdate` → `lateUpdate` → `PreRender` → render
- Coroutines as generators; `Signal` with owner-scoped disconnect
- `app.time`: fixed step, time scale, pause and resume, clamped deltas
- `app.tweens` for numbers, vectors and quaternions on the game clock
- Metres, seconds, degrees; left-handed, Y up
- Every engine error has an `IGX-####` code and reaches `app.onError`
- Diagnostics counters and structured logging

See it: Lifecycle · Coroutines and tweens · Signals

### 3.2 Rendering — `@ignifx/core` on Babylon Lite

ignifx renders exclusively through WebGPU, using Babylon Lite as its rasteriser. You describe a frame
with six components and the engine keeps Babylon Lite in sync, once per frame, writing only what
changed.

- `Camera`: perspective and orthographic, priority, viewport, clear colour, screen-to-ray and
  world-to-screen
- `Light`: directional, point, spot and hemispheric; include and exclude lists
- Shadows from directional and spot lights: PCF and ESM maps, cascades, bias and map size
- `MeshRenderer` with box, ground and custom geometry; `Model` for glTF 2.0 and GLB
- PBR materials from `.material.json` or from code; unlit materials; material overrides per model
- `Environment`: image-based lighting from `.env`, `.hdr` and `.dds`, skybox, fog, exposure,
  contrast and Standard, ACES or Neutral tone mapping
- `PostProcessStack`: bloom, SMAA anti-aliasing, image processing
- MSAA ×4, resolution scale and device-pixel-ratio clamp
- GPU picking and CPU raycasts against renderables
- Screenshots, per-task GPU timings, draw-call counters
- Material warm-up before a scene shows, and WebGPU device-loss recovery
- A documented `.lite` escape hatch when you need Babylon Lite itself

See it: Physically based rendering · Shadows · Bloom · Tone mapping · Picking

### 3.3 Assets and scenes — `@ignifx/core` and `@ignifx/vite-plugin`

Everything a game loads is addressed by path, typed, reference-counted and asynchronous. The Vite
plugin generates the manifest, validates every JSON document against the engine's schemas at build
time, and hot-swaps assets while you work.

- Textures (PNG, JPEG, WebP, KTX2, Basis), models (glTF, GLB), environments (`.env`, `.hdr`, `.dds`),
  fonts, audio, JSON, text and bytes
- Sub-assets by fragment: `"hero.glb#animation:Run"`
- Cancellable loads, preload groups, reference counting with delayed unload
- One format for scenes and prefabs; `world.instantiate` stamps a prefab out and overrides survive a
  save and load
- `serializeScene` for saves; versioned save documents in the templates
- Hot reload of assets and scripts in development

See it: Model loading · Scenes and prefabs · Loading screen

### 3.4 Input — `@ignifx/input`

Game code asks for `"jump"`, never for a key code. Actions, bindings, composites and processors live
in an `.input.json` document, so rebinding is data and control schemes are a file.

- Keyboard, mouse, pointer, gamepad and touch devices
- Action maps, control schemes, composites (2D vectors, axes), processors (dead zone, normalise,
  clamp, scale, invert)
- `wasPressedThisFrame` that is consistent across every fixed step of a frame
- Interactive rebinding with save and load of overrides
- Pointer lock and cursor control
- Virtual joystick and buttons for touch (with `@ignifx/ui`)
- `simulate()` for tests: drive input headlessly with no device

See it: Input actions · Rebinding · Touch controls

### 3.5 3D physics — `@ignifx/physics`

Havok, through Babylon Lite, stepped by the engine's fixed loop and interpolated for the screen. It
runs headlessly too, so a physics test needs no GPU.

- `Rigidbody`: dynamic, kinematic and static; mass, rotation locks, sleep
- Box, sphere, capsule, cylinder, mesh and heightfield colliders; triggers
- Physics materials (`.physicsmaterial.json`): friction, restitution
- `CharacterController`: collide-and-slide, a slope limit, support detection and body pushing
  _(corrected 2026-09-08: Babylon Lite's controller has no step height and no snap-to-ground; see `07-wishlist.md`)_
- Collision and trigger enter, stay and exit events
- Raycasts, shape casts and overlaps with a layer matrix
- Deterministic per platform: the same inputs give the same hash across processes

See it: Physics playground · Character controller · Raycasts and triggers

### 3.6 2D toolkit — `@ignifx/2d`

Sprites, atlases, tilemaps and cameras in pixels per unit, drawn through Babylon Lite's sprite layers.

- `Camera2D` with pixels per unit, pixel-perfect zoom, follow with a dead zone
- `SpriteRenderer`, `SpriteAnimator` and `.spriteanimation.json` clips
- Atlas importers for TexturePacker, Aseprite and grids
- `Tilemap` and `TilemapRenderer` with Tiled and LDtk importers and chunk culling
- Sorting layers with Y-sort; `ParallaxLayer`; per-layer tint and custom shaders
- 2D picking

See it: Sprite animation · Tilemap · Parallax · Pixel-perfect

### 3.7 2D physics — `@ignifx/physics-2d`

Rapier 2D behind the same component vocabulary as 3D, with a platformer controller that handles the
cases a platformer needs.

- `Rigidbody2D`; box, circle, capsule, polygon, edge and tilemap colliders; triggers
- `CharacterController2D`: slopes, auto-step, snap-to-ground, one-way platforms
- Queries, events, interpolation, a layer matrix
- Runs headlessly; deterministic per platform

See it: 2D physics · Platformer controller

### 3.8 3D toolkit — `@ignifx/3d`

The parts of a 3D game that every 3D game rewrites, done once.

- `ThirdPersonController` and `FirstPersonController`: walk, sprint, crouch, jump, head pitch
- `ThirdPersonCamera`: an orbit rig with wall collision and damping
- `Animator`: a state machine from `.animator.json` with 1D blend trees, masks, additive layers and
  events, driving glTF skeletons
- `NavMeshSurface`, `NavMeshAgent` and `NavMeshObstacle` on Recast, baked headlessly
- `RigidbodyMover`, `PlatformMover`, `Projectile`, `LodGroup`, `Billboard`

See it: Third-person · First-person · Animator · Navigation

### 3.9 Audio — `@ignifx/audio`

A mixer, not a play function. Buses are declared in a file; every sound plays on one; volumes
multiply down the tree.

- `.audio.json` bus tree with per-bus volume and pause behaviour
- `AudioSource` for one-shots, loops and spatial playback; `AudioListener`; `MusicPlayer`
- Browsers start locked: plays are queued, not lost, until the first gesture
- Pauses with the app; a `UI` bus that does not
- WAV, MP3, OGG, WebM and FLAC; a headless backend with exact timing for tests

See it: Audio mixer · Positional audio

### 3.10 UI — `@ignifx/ui`

Game UI is HTML, placed over the canvas by the engine, with focus routing so a text field never
steals a jump.

- An overlay root with named layers, `css`, `fit` and `dpi` scaling, safe-area variables
- `Menu` and `MenuStack` driven by keyboard, gamepad and pointer through one selection model
- `Dialog`, `Toast`, `LoadingScreen`
- `HudText`, `WorldText`, `WorldText2D` and `WorldAnchor`
- `VirtualJoystick` and `VirtualButton` feeding `@ignifx/input`
- `app.i18n` with `.i18n.json`, all locales in one file, ICU-style plurals

See it: UI overlay · Menus · Translations

### 3.11 Desktop — `@ignifx/electron`

Ship the same build to Windows, macOS and Linux inside a hardened Electron window.

- `createGameWindow` with the WebGPU flags already set
- The `ignifx://` protocol serving your build with range requests
- Context isolation, sandboxed renderers, no Node in the renderer, a strict CSP and a typed,
  versioned preload bridge
- File-system `app.storage` for saves and settings; `app.desktop` for window control
- `create-ignifx --desktop` scaffolds the Electron variant of any template with electron-vite and
  electron-builder configured

See it: Getting started → Desktop

### 3.12 Devtools — `@ignifx/devtools`

Press backtick. Stats, the scene tree, a schema-driven inspector, assets, input, audio, physics
debug, a console and a timeline. Zero cost while closed, and every number comes from
`app.diagnostics`, which your game can read too.

See it: Devtools overlay

### 3.13 Tooling — `@ignifx/vite-plugin` and `create-ignifx`

- A Vite plugin that generates the asset manifest, writes `.meta.json` sidecars, validates scene,
  prefab, material, input, audio, animator and tilemap JSON against the engine schemas, handles
  WebAssembly, and wires hot module replacement
- Typed `virtual:ignifx/*` modules
- `create-ignifx` with four templates and a desktop flag
- `check-webgpu` and `new-script` helper scripts in every project

### 3.14 Platform and storage — `@ignifx/core`

- `app.platform`: where the game runs (browser, Electron, headless), OS, mobile, pointer lock,
  gamepads, the WebGPU adapter, locale and reduced-motion preference
- `app.storage`: an async key-value store with namespaces, backed by IndexedDB in the browser, files
  in Electron, and memory or files in Node
- Save games, settings and input overrides use it; so can you

See it: Save and load

### 3.15 Headless and testing

Create an app with `headless: true`, step it with `app.step(1 / 60)`, and assert. Physics, navigation,
audio timing and input all run without a GPU or a DOM, which is how the engine's own thousand-plus
tests run.

- Manual clocks for deterministic tests
- Memory log sinks and error capture
- Playwright browser suites and visual goldens in the repository as worked examples

---

## 4. Examples `/examples/`

**Title:** Examples · ignifx
**Description:** Runnable ignifx examples: rendering, post-processing, lighting, glTF models, 2D,
physics, gameplay, input, audio and UI, each with its source code.

H1: **Examples**
Lead: Every example runs in your browser on this site's engine build, with its source beside it and
the same file on GitHub one click away. Press backtick in any example for the devtools overlay.

Category chips: All · Rendering · Post-processing · Lighting · Models · 2D · Physics · Gameplay ·
Input · Audio · UI · Platform

Footer line: Sample models and environments are credited on the **attribution page →**.

_Per-example titles and one-liners are in `04-examples-platform.md` §7; the card shows title and
line, the page shows title, paragraph and "Try" bullets from the same table._

### Example page frame

- Back link: ← All examples
- Toolbar labels: Play · Pause · Fullscreen · Open standalone · `` ` `` devtools
- Metrics: `<frame> ms · <n> draw calls` (running only)
- Source heading: **Source** · buttons: **View on GitHub** · **Copy**
- Footer: Uses: _(components)_ · Assets: _(name, licence, author)_ · ← Previous · Next →

### Attribution `/examples/attribution/`

**Title:** Example asset credits · ignifx
H1: **Credits**
Lead: The examples use sample assets published under open licences. Each one is listed here with its
author, licence and source. ignifx itself, the example code, and every capture on this site are
Apache-2.0.

_Table generated from `website/examples/assets/ATTRIBUTION.md`: asset, used by, author, licence,
source link._

---

## 5. Docs hub `/docs/`

**Title:** Docs · ignifx
**Description:** Getting started, guides, the API reference, templates and browser support for ignifx.

H1: **Docs**
Lead: Start here, then read a guide that does one thing.

Cards:

- **Getting started** — From nothing to a running template in five minutes.
- **Guides** — Sixteen short guides, one task each, with code the engine's checks compile.
- **API reference ↗** — Every public export of every package, generated from the source. _(GitHub:
  `skills/ignifx/references/api/`)_
- **Templates** — Four small finished games to copy. _(→ `/#templates`)_
- **Browser support** — What WebGPU is, where it runs, and how to check.
- **Contributing ↗** — How the project works and how to get a change in. _(GitHub `CONTRIBUTING.md`)_

H2: **Guides**
_Grouped list. Group → guide title → one line (the recipe's first sentence)._

| Group                | Guides                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Scenes and assets    | Load a model · Spawn a prefab · Spawn a prefab on click                                                            |
| Rendering and motion | Tween a transform                                                                                                  |
| Input                | Bind an action and read it · Rebind a key at run time                                                              |
| 3D                   | Move a 3D character controller · Follow a character with a third-person camera · Raycast and catch a trigger in 3D |
| 2D                   | Animate a sprite from an atlas · Load a tilemap and give it collision · Move a 2D platformer character             |
| Audio                | Play a positional one-shot and a music loop                                                                        |
| UI                   | Build a pause menu                                                                                                 |
| Saving               | Save and load game state                                                                                           |
| Tools                | Show a gameplay counter in devtools                                                                                |

---

## 6. Getting started `/docs/getting-started/`

**Title:** Getting started · ignifx
**Description:** Install ignifx, pick a template, and run your first game in the browser or on the
desktop.

H1: **Getting started**
Lead: Five minutes from an empty folder to a running game. You need Node 24, a package manager, and
a browser with WebGPU.

_Support pill here._

### Step 1 · Create a project

**[release]**

```sh
npm create ignifx@latest my-game
```

You will be asked for a template. Pass one to skip the question:

```sh
npm create ignifx@latest my-game -- --template 3d-third-person
```

**[pre-release]**
ignifx is not on npm yet, so the first step is the repository:

```sh
git clone https://github.com/astrum-forge/ignifx.git
cd ignifx
pnpm install
pnpm build
```

`pnpm build` compiles every package once; the templates import them from the workspace.

### Step 2 · Pick a template

_Four compact template cards._ Every template is a small finished game: a title screen, a pause menu,
settings for volume, render scale, shadows and post-processing, interactive rebinding, saves with
checkpoint autosave, and English and French strings. Delete the game and keep the front end.

### Step 3 · Run it

**[release]**

```sh
cd my-game
npm install
npm run dev
```

**[pre-release]**

```sh
pnpm --filter ignifx-template-3d-third-person dev
```

Open `http://localhost:5173`. Press backtick for the devtools overlay. Press Escape for the pause
menu.

### Step 4 · Change something

Open `src/scripts/` and find a `Script`. Change a speed, save, and watch the game update without a
reload. Every field you declare with `Script.define` shows up in the devtools inspector.

### Step 5 · Build

**[release]** `npm run build` writes a static `dist/` you can host anywhere: Cloudflare Pages,
Netlify, GitHub Pages, an S3 bucket, itch.io.
**[pre-release]** `pnpm --filter ignifx-template-3d-third-person build`

### Desktop

Add `--desktop` when you create the project and you get an Electron variant with `dev:desktop`,
`build:desktop` and `dist:desktop`. The window is created with WebGPU enabled, context isolation on,
the renderer sandboxed, and a typed bridge for the few things a game needs from the host.

**[release]** `npm create ignifx@latest my-game -- --template 3d-first-person --desktop`

### What next

- **Guides** → one task each.
- **Examples** → see a feature running and read its source.
- **API reference ↗** → every export.
- Something wrong? **Open an issue ↗**.

---

## 7. Browser support `/docs/browser-support/`

**Title:** Browser support · ignifx
**Description:** ignifx runs on WebGPU. Which browsers have it, how to enable it, and how to check.

H1: **Browser support**
Lead: ignifx renders through WebGPU and nothing else. That is a deliberate choice: one render path,
tested once, with modern features everywhere it runs.

_Support pill._

| Browser                        | WebGPU since                                          |
| ------------------------------ | ----------------------------------------------------- |
| Chrome, Edge (desktop)         | 113                                                   |
| Chrome (Android)               | 121                                                   |
| Safari (macOS, iOS, iPadOS)    | 26                                                    |
| Firefox (Windows)              | 141                                                   |
| Firefox (macOS, Apple Silicon) | 145                                                   |
| Electron                       | Any current release; `@ignifx/electron` sets the flag |

_Note to engineer: the Chrome Android row is from public release notes, not from the skill; confirm
before publishing or drop the row._

H2: **If your browser does not have it**
A browser without WebGPU cannot run an ignifx game, and the engine says so clearly: `createApp`
rejects with error `IGX-0701`, and every template shows a fallback panel that links here. On Linux
and on some older integrated GPUs, WebGPU exists but is off by default; check `chrome://gpu` or
`about:config` for your browser's flag.

H2: **Check from the command line**
Every project ships `node scripts/check-webgpu.mjs`, which launches a browser headlessly and reports
what the adapter says.

---

## 8. Release gating

| Surface                       | [pre-release]                                    | [release]                                     |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------- |
| Header npm button             | disabled "npm · soon"                            | link to npm                                   |
| Home install block            | clone commands + "not on npm yet"                | `npm create ignifx@latest`                    |
| Template "Create" buttons     | copies the clone path                            | copies the create command                     |
| Getting started steps 1, 3, 5 | clone variant                                    | npm variant                                   |
| Footer "npm"                  | omitted                                          | present                                       |
| Badges page                   | present; the badge is fine to use before release | unchanged                                     |
| Version chip in the footer    | "0.x · unreleased"                               | the version from `packages/core/package.json` |

The flip is one line in `website/site.config.ts`. It is part of the release checklist in
`06-engineering.md` §8.

---

## 9. 404

**Title:** Page not found · ignifx
H1: **This page has gone dark.**
Copy: The address may have moved when the site was rebuilt. These still work:
Home · Features · Examples · Docs · Press

---

## 10. Press `/press/`

All copy for the press page, including the three boilerplates and the name story, is in
`05-press-kit.md` §2 so that the page and the downloadable kit share one source.

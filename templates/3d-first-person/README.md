# 3d-first-person

A first-person 3D game: a walking, sprinting, crouching character with head bob and pointer lock, a
view model welded to the rig's hand, a crosshair ray that lights pedestals, pushable crates, and the
full front end.

```sh
pnpm install && pnpm dev      # http://localhost:5173 · `pnpm build` → dist/
```

WebGPU only; a browser without it gets the fallback panel in `index.html`.

## Controls

| Action       | Keyboard                  | Gamepad          | Touch             |
| ------------ | ------------------------- | ---------------- | ----------------- |
| `Move`       | WASD, arrows              | left stick, dpad | on-screen stick   |
| `Look`       | mouse, once locked        | right stick      | right stick       |
| `Jump`       | Space                     | ✕ / A            | the **▲** button  |
| `Sprint`     | <kbd>Shift</kbd>          | L3               | the **»** button  |
| `Crouch`     | <kbd>C</kbd>, Ctrl        | ○ / B            | the **▼** button  |
| `Interact`   | <kbd>E</kbd>, left click¹ | RT               | the **E** button  |
| `Pause`      | <kbd>Esc</kbd>            | Start            | the **II** button |
| `menuMove`   | arrows, WASD              | left stick, dpad | —                 |
| `menuSubmit` | <kbd>Enter</kbd>, Space   | ✕ / A            | tap a row         |
| `menuBack`   | <kbd>Esc</kbd>, Backspace | ○ / B            | the **Back** row  |

¹ A left click only interacts while the game holds the pointer. The click that _takes_ the pointer
is the player asking for their view back, and letting it also flip whichever pedestal happened to
sit under the crosshair would toggle one nobody aimed at, so `src/scripts/interactor.ts` reads
`InputAction.activeDevice` and ignores a mouse press until `app.input.pointerLock.locked`.
<kbd>E</kbd>, the gamepad trigger and the on-screen button are never gated.

`assets/game.input.json` owns all of it: the `Player` map is gameplay and the `UI` map drives the
menus, so keyboard and gamepad navigate through one code path. `Look` carries no `scale(...)`
processor: a mouse delta is a displacement in CSS pixels that `sensitivity` turns into degrees, and
a stick is a deflection that `stickLookSpeed` turns into degrees per second, so the two are tuned on
the controller and not in the binding.

## Looking around

`FirstPersonController` runs with `lockPointerOnClick: true`. **Click the picture to look around,
and press <kbd>Esc</kbd> to give the pointer back**; a line at the bottom of the screen says so
whenever the game is running without the lock. Until the browser grants the lock, mouse look is
ignored, so a cursor crossing the canvas on its way to a menu button no longer whips the view round;
gamepad and touch look never wait for anything. Losing the lock — <kbd>Esc</kbd>, tabbing away, the
window losing focus — opens the pause menu, and the next click takes the pointer back.

Sensitivity is **0.1 degrees per CSS pixel**, the same feel on a retina display and on a 1080p
monitor, and the sticks turn at **180 degrees per second** at full deflection. Mouse forward and
stick up both look up; `invertY` on the controller flips both together.

The head bob is **0.025 m at 0.5 bobs per metre travelled**, which at the 4 m/s walk is two bobs a
second — a footfall cadence. The phase advances with distance rather than with time, so a sprint
bobs faster for free and a stopped character does not bob at all.

## Menus, settings and saves

`src/menus/` builds a **title screen** (Continue · New game · Settings · Credits), a **pause menu**
(<kbd>Esc</kbd> in play: Resume · Save game · Settings · Quit to title) and a **settings screen** —
master/music/effects sliders on the `Master`/`Music`/`SFX` buses, a render-scale slider on
`app.renderer.resolutionScale`, a shadows toggle on the sun's own `light.shadows.enabled`, a
post-processing toggle on the `PostProcessStack` (bloom and SMAA), the interactive rebinding page, an `en`/`fr` language
toggle, Delete save and Reset to defaults. Settings and rebindings persist through
`app.storage.namespace("settings")`; the music ducks rather than stops while a menu is up.

**Focus order is row order**, wrapping at both ends and skipping headings and disabled rows: Up/Down
move, Left/Right adjust, Enter activates, <kbd>Esc</kbd> backs out one screen, and the pointer
hovers to select and clicks to activate. All of that is `@ignifx/ui`'s `Menu` and `MenuStack`, not
template code: rows are `tabindex="-1"` because a gamepad raises no DOM focus events and two focus
authorities disagree, so the widget owns the selection and announces it with `aria-activedescendant`.
`src/menus/game-menus.ts` only declares which rows exist and what they read and write.

**Saves** are a versioned `ignifx-template.save` document under `app.storage.namespace("saves")`:
position, the pedestals already lit, score and elapsed seconds — not a serialized scene, which would store the
level rather than the progress through it. Lighting a pedestal autosaves, at most one write every two
seconds; a save from an older build is discarded with an `IGX-TPL-0011` warning rather than
migrated, which is what makes regenerating the art safe.

## Level and assets

`src/level.ts` builds the room in code: a floor slab, a ring of wall panels sharing one mesh, two
interior stubs, a seeded crate scatter, three interactable pedestals — each with its own material
clone and an emissive cap — and an inverted sphere with an unlit gradient for the sky, because
`Environment.skybox` wants a cube map that cannot be generated from arithmetic. `pnpm dev:desktop` /
`build:desktop` / `dist:desktop` run the Electron build; `@ignifx/electron` is registered in both and
is inert without a preload bridge.

Every pixel and every sample comes from a committed, seeded script; nothing is downloaded
(`CONSTITUTION.md` §11.3). Regenerate from the repository root with `pnpm assets:3d`
and `pnpm assets:audio`.

## Query flags

- `?static=1` — stops the clock **before** `app.start()` and leaves the front end out, so no fixed
  step runs and the frame is exactly the authored scene. The visual goldens open it.
- `?hud=1` — keeps the overlay visible in a static scene; the gallery capture uses it.
- `?bench=1` — skips the title screen and installs `window.__ignifxFrameTime` for
  `tests/visual/tests/frame-time.spec.ts`.
- `?probe=1` — installs `window.__ignifxGameplay` (`src/gameplay-probe.ts`), the view and character
  readings `tests/visual/tests/templates.spec.ts` asserts on. It does not exist without the flag.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

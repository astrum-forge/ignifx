# 3d-third-person

A third-person 3D game: a character on a `CharacterController`, an orbit camera that will not clip
through a wall, an `Animator` state machine on a rigged model, a navmesh-driven companion, pushable
crates, three beacons to light, and the full front end.

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
| `Pause`      | <kbd>Esc</kbd>            | Start            | the **II** button |
| `menuMove`   | arrows, WASD              | left stick, dpad | —                 |
| `menuSubmit` | <kbd>Enter</kbd>, Space   | ✕ / A            | tap a row         |
| `menuBack`   | <kbd>Esc</kbd>, Backspace | ○ / B            | the **Back** row  |

`assets/game.input.json` owns all of it: the `Player` map is gameplay and the `UI` map drives the
menus, so keyboard and gamepad navigate through one code path. `Look` carries no `scale(...)`
processor: a mouse delta is a displacement in CSS pixels that `sensitivity` turns into degrees, and
a stick is a deflection that `stickLookSpeed` turns into degrees per second, so the two are tuned on
the rig and not in the binding.

## The camera

`ThirdPersonCamera` runs with `lockPointerOnClick: true`. **Click the picture to look around, and
press <kbd>Esc</kbd> to give the pointer back**; a line at the bottom of the screen says so whenever
the game is running without the lock. Until the browser grants the lock, mouse look is ignored — a
cursor crossing the canvas on its way to a menu button is not a look gesture, and one that leaves
the window would otherwise stop a turn dead. Gamepad and touch look never wait for anything. Losing
the lock — <kbd>Esc</kbd>, tabbing away, the window losing focus — opens the pause menu, so the game
never runs on unwatched, and the next click on the picture takes the pointer back.

Sensitivity is **0.1 degrees per CSS pixel**, which is the same feel on a retina display and on a
1080p monitor and does not move when the settings screen changes the render scale. The sticks orbit
at **150 degrees per second** at full deflection.

The boom sweeps a sphere from the shoulder pivot out to the camera, so a wall behind the character
shortens it at once and it eases back out at `collisionRecoverySpeed`. The pivot is over the right
shoulder, inside the character's capsule, and the rig sweeps _past_ that capsule
(`ShapeCastOptions.ignore`): Lite's sweep cannot be filtered by layer, so `collisionLayers` only
decides which hit is attributed an entity, and any other body in the way — the companion included —
shortens the boom the way a wall does.

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
position, the beacons already lit, score and elapsed seconds — not a serialized scene, which would store the
level rather than the progress through it. Lighting a beacon autosaves, at most one write every two
seconds; a save from an older build is discarded with an `IGX-TPL-0011` warning rather than
migrated, which is what makes regenerating the art safe.

## Level and assets

`src/level.ts` builds the courtyard in code: a floor slab, a ring of wall panels sharing one mesh, two
interior stubs, a seeded crate scatter, three beacons, and an inverted sphere with an unlit gradient
for the sky — `Environment.skybox` wants a `.dds` or `.env` cube map, which cannot be generated from
arithmetic the way every other asset here is. The navmesh is baked from the same geometry through
`NavMeshSurface.addSource`. `pnpm dev:desktop` / `build:desktop` / `dist:desktop` run the Electron
build; `@ignifx/electron` is registered in both and is inert without a preload bridge.

Every pixel and every sample comes from a committed, seeded script; nothing is downloaded
(`CONSTITUTION.md` §11.3). Regenerate from the repository root with `pnpm assets:3d`
and `pnpm assets:audio`.

## Query flags

- `?static=1` — stops the clock **before** `app.start()` and leaves the front end out, so no fixed
  step runs and the frame is exactly the authored scene. The visual goldens open it.
- `?hud=1` — keeps the overlay visible in a static scene; the gallery capture uses it.
- `?bench=1` — skips the title screen and installs `window.__ignifxFrameTime` for
  `tests/visual/tests/frame-time.spec.ts`.
- `?probe=1` — installs the two test hooks: `window.__ignifxProbe` (`src/desktop-probe.ts`, the
  device-loss criterion in `tests/visual/tests/desktop.spec.ts`) and `window.__ignifxGameplay`
  (`src/gameplay-probe.ts`, the camera and character readings `tests/visual/tests/templates.spec.ts`
  asserts on). Neither exists without the flag.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

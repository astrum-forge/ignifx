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
| `Look`       | mouse                     | right stick      | right stick       |
| `Jump`       | Space                     | ✕ / A            | the **▲** button  |
| `Sprint`     | <kbd>Shift</kbd>          | L3               | the **»** button  |
| `Pause`      | <kbd>Esc</kbd>            | Start            | the **II** button |
| `menuMove`   | arrows, WASD              | left stick, dpad | —                 |
| `menuSubmit` | <kbd>Enter</kbd>, Space   | ✕ / A            | tap a row         |
| `menuBack`   | <kbd>Esc</kbd>, Backspace | ○ / B            | the **Back** row  |

`assets/game.input.json` owns all of it: the `Player` map is gameplay and the `UI` map drives the
menus, so keyboard and gamepad navigate through one code path.

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
hovers to select and clicks to activate. Rows are `tabindex="-1"` because a gamepad raises no DOM
focus events and two focus authorities disagree — `menu-screen.ts` owns the selection.

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
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

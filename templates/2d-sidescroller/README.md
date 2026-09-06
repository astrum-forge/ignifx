# 2d-sidescroller

A pixel-perfect 2D side-scroller: three parallax bands, a tilemap with slopes and one-way platforms,
collectible coins, a reference platformer controller, and the full front end.

```sh
pnpm install && pnpm dev      # http://localhost:5173 · `pnpm build` → dist/
```

WebGPU only; a browser without it gets the fallback panel in `index.html`.

## Controls

| Action       | Keyboard                  | Gamepad          | Touch             |
| ------------ | ------------------------- | ---------------- | ----------------- |
| `move`       | WASD, arrows              | left stick, dpad | on-screen stick   |
| `jump`       | Space, <kbd>Z</kbd>       | ✕ / A            | the **▲** button  |
| `pause`      | <kbd>Esc</kbd>            | Start            | the **II** button |
| `menuMove`   | arrows, WASD              | left stick, dpad | —                 |
| `menuSubmit` | <kbd>Enter</kbd>, Space   | ✕ / A            | tap a row         |
| `menuBack`   | <kbd>Esc</kbd>, Backspace | ○ / B            | the **Back** row  |

`assets/game.input.json` owns all of it: the `Player` map is gameplay and the `UI` map drives the
menus, so keyboard and gamepad navigate through one code path.

## Menus, settings and saves

`src/menus/` builds a **title screen** (Continue · New game · Settings · Credits), a **pause menu**
(<kbd>Esc</kbd> in play: Resume · Save game · Settings · Quit to title) and a **settings screen** —
master/music/effects sliders on the `Master`/`Music`/`SFX` buses, a render-scale slider on
`app.renderer.resolutionScale`, the interactive rebinding page, an `en`/`fr` language
toggle, Delete save and Reset to defaults. Settings and rebindings persist through
`app.storage.namespace("settings")`; the music ducks rather than stops while a menu is up.

**Focus order is row order**, wrapping at both ends and skipping headings and disabled rows: Up/Down
move, Left/Right adjust, Enter activates, <kbd>Esc</kbd> backs out one screen, and the pointer
hovers to select and clicks to activate. Rows are `tabindex="-1"` because a gamepad raises no DOM
focus events and two focus authorities disagree — `menu-screen.ts` owns the selection.

**Saves** are a versioned `ignifx-template.save` document under `app.storage.namespace("saves")`:
position, the coins already taken, score and elapsed seconds — not a serialized scene, which would store the
level rather than the progress through it. Taking a coin autosaves, at most one write every two
seconds; a save from an older build is discarded with an `IGX-TPL-0011` warning rather than
migrated, which is what makes regenerating the art safe.

## Level and assets

`assets/level.tilemap.json` carries the terrain, the slopes and the one-way planks, plus an objects
layer the spawn and every coin come from. The camera is `pixelPerfect` against a 320 x 180 reference
resolution, so one source texel covers a whole number of screen pixels. `public/` holds the sheet
images, because a `.atlas.json` names its image relative to itself.

Every pixel and every sample comes from a committed, seeded script; nothing is downloaded
(`CONSTITUTION.md` §11.3). Regenerate from the repository root with `pnpm assets:2d`, `pnpm assets:levels`
and `pnpm assets:audio`.

## Query flags

- `?static=1` — stops the clock **before** `app.start()` and leaves the front end out, so no fixed
  step runs and the frame is exactly the authored scene. The visual goldens open it.
- `?hud=1` — keeps the overlay visible in a static scene; the gallery capture uses it.
- `?bench=1` — skips the title screen and installs `window.__ignifxFrameTime` for
  `tests/visual/tests/frame-time.spec.ts`.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

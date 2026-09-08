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

Hold <kbd>S</kbd> (or the down arrow, or push the stick down) and press `jump` while standing on one
of the wooden planks to **drop through** it.

## How the character moves

`src/scripts/platformer-controller.ts` is the reference controller, and its numbers are the ones a
game would actually tune:

| What        | Number           | Why                                                                                                |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| Run speed   | 7 m/s            | Reached in 0.1 s on the ground and 0.2 s in the air, so a correction in mid-air costs something.   |
| Jump        | 1.28 m to 3.42 m | A one-frame tap clears `minJumpHeight`; holding for 0.2 s gives the whole `jumpSpeed` arc.         |
| Gravity     | 36 up, 52 down   | Two gravities: the fall is faster than the rise, which is what makes the arc read as "snappy".     |
| Coyote time | 0.1 s            | A jump pressed just after running off a ledge still works.                                         |
| Jump buffer | 0.12 s           | A jump pressed just before landing fires on the landing frame.                                     |
| Fall limit  | y = −3           | Below the map the character is put back on the last ground it stood on. Nothing is scored or lost. |

Two things it does that are easy to get wrong. The **variable jump height** is one clamp on the
release edge, not a factor applied every step the button is up — a factor compounds, and the same
launch then reaches 0.41 m or 3.42 m depending on how many frames the tap happened to cover. And a
**wall** is recognised from the contact normals `CharacterController2D.onCollided` reports, not from
"the controller moved less than I asked for": collide-and-slide on a 45-degree slope legitimately
returns about half the requested horizontal motion, so the short-move test alone turns every hill
into a crawl. The run is also rotated onto the surface it is standing on, so a slope is climbed at
the run speed rather than at its cosine.

## Menus, settings and saves

`src/menus/` builds a **title screen** (Continue · New game · Settings · Credits), a **pause menu**
(<kbd>Esc</kbd> in play: Resume · Save game · Settings · Quit to title) and a **settings screen** —
master/music/effects sliders on the `Master`/`Music`/`SFX` buses, a render-scale slider on
`app.renderer.resolutionScale`, the interactive rebinding page, an `en`/`fr` language
toggle, Delete save and Reset to defaults. Settings and rebindings persist through
`app.storage.namespace("settings")`; the music ducks rather than stops while a menu is up.

**Focus order is row order**, wrapping at both ends and skipping headings and disabled rows: Up/Down
move, Left/Right adjust, Enter activates, <kbd>Esc</kbd> backs out one screen, and the pointer
hovers to select and clicks to activate. All of that is `@ignifx/ui`'s `Menu` and `MenuStack`, not
template code: rows are `tabindex="-1"` because a gamepad raises no DOM focus events and two focus
authorities disagree, so the widget owns the selection and announces it with `aria-activedescendant`.
`src/menus/game-menus.ts` only declares which rows exist and what they read and write.

**Saves** are a versioned `ignifx-template.save` document under `app.storage.namespace("saves")`:
position, the coins already taken, score and elapsed seconds — not a serialized scene, which would store the
level rather than the progress through it. Taking a coin autosaves, at most one write every two
seconds; a save from an older build is discarded with an `IGX-TPL-0011` warning rather than
migrated, which is what makes regenerating the art safe.

## Level and assets

`assets/level.tilemap.json` carries the terrain, the slopes and the one-way planks, plus an objects
layer the spawn and every coin come from. The camera is `pixelPerfect` against a 320 x 180 reference
resolution, so one source texel covers a whole number of screen pixels. Each sheet image sits
beside its `.atlas.json`, which names it relatively; `@ignifx/2d` resolves that through the asset
manifest, so a hashed build and a deploy under a sub-path both find it.

Every pixel and every sample comes from a committed, seeded script; nothing is downloaded
(`CONSTITUTION.md` §11.3). Regenerate from the repository root with `pnpm assets:2d`, `pnpm assets:levels`
and `pnpm assets:audio`.

## Query flags

- `?static=1` — stops the clock **before** `app.start()` and leaves the front end out, so no fixed
  step runs and the frame is exactly the authored scene. The visual goldens open it.
- `?hud=1` — keeps the overlay visible in a static scene; the gallery capture uses it.
- `?bench=1` — skips the title screen and installs `window.__ignifxFrameTime` for
  `tests/visual/tests/frame-time.spec.ts`.
- `?probe=1` — installs `window.__ignifxGameplay`, a read-only reading of the character and the run
  that `tests/visual/tests/templates.spec.ts` measures instead of photographing. See
  `src/gameplay-probe.ts`.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

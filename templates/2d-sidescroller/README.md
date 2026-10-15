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

## The level

The level is data: **`assets/scenes/main.scene.json`** holds every entity — three `ParallaxLayer`
bands and the eleven strips they slow down, the `Level` with its `Tilemap`, `TilemapRenderer` and
`TilemapCollider2D`, the player, eighteen coins and the camera — with its components, their fields,
and the references between them (`{ "$entity": … }`, `{ "$asset": … }`). `main.ts` loads it with
`app.world.loadScene("scenes/main.scene.json")` and never builds a level entity itself, and the
scene names every script by its `typeId`, so a script edit hot-patches the class instead of
reloading the page. The camera is `pixelPerfect` against a 320 x 180 reference resolution, so one
source texel covers a whole number of screen pixels; both are fields of its `Camera2D` in the file.
Each strip names the frame it draws in its `SpriteRenderer`'s `frameName` (`"hills"`).

The terrain, the slopes and the one-way planks stay in `assets/level.tilemap.json`.
`TilemapCollider2D` reads the `Tilemap` on the same entity, so they collide as soon as the scene has
loaded, with no code. The map has no objects layer: the spawn and every coin are entities in the
scene file, because ignifx never spawns entities from a map. Move the player or add a coin in the
scene file. (A `.tilemap.json` that does carry objects, such as one converted from Tiled, moves them
into a scene once with `ignifx import tilemap`.)

The file is in the canonical form `stringifySceneFile` writes: keys in a fixed order, numbers
rounded to six decimals, one value per line, no final newline. Edit it by hand, by an agent, or in
the ignifx editor. The ignifx repository's `tests/templates` loads it headless, checks the entity
list, and saves it again to prove the text comes back byte for byte.

**Adding an entity as data.** Copy an entity record, give it and each of its components a fresh
ULID (`generateUlid()` from `@ignifx/core`), set `parent` to `null` or another entity's `uid`, and
list it after its parent. A coin, say, is a copy of `Coin 1` with a new name — which is also its id
in a save file — and a new position: a `SpriteRenderer` on `coin.atlas.json`, a `SpriteAnimator`
playing `spin`, a trigger `CircleCollider2D` and `sidescroller/Collectible`, on the `Pickup` layer.

**Adding an entity in code.** Do it in `main.ts` after `loadScene`, the way the front end does:
`app.world.createEntity("Name")`, then `addComponent`. A project script is reached by its type id,
`scriptType<MyScript>(app, "my-game/MyScript")`, never by importing its module (`src/script-types.ts`
says why).

**What stays in code**, or needs a script, because a scene file cannot say it:

- **The sounds.** A clip referenced by a scene field is a dependency of the scene, and one the
  browser cannot decode would fail the whole load; every sound here is optional, so the footstep,
  jump, landing and coin sounds are assigned after the load and the ambient pad's `AudioSource` is
  created in code.
- **The front end**: menus, HUD, saves, input overrides, the coins' `onCollected` callback, and the
  `Game UI` entity that carries the front end's scripts. They hold DOM elements and closures.
- **The input actions and audio buses** are assets, loaded before the scene because
  `PlatformerController` resolves its actions in `awake`, which runs inside `loadScene`.

Each sheet image sits beside its `.atlas.json`, which names it relatively; `@ignifx/2d` resolves
that through the asset manifest, so a hashed build and a deploy under a sub-path both find it. Every
pixel and every sample comes from a committed, seeded script; nothing is downloaded
(`CONSTITUTION.md` §11.3). Regenerate from the repository root with `pnpm assets:2d`, `pnpm assets:levels`
and `pnpm assets:audio`.

## Extensions

`src/extensions.ts` exports `extensions()`, the list `main.ts` passes to `createApp`. It is a module
of its own so that anything else that builds an app over this project — the ignifx editor's scene
view, a headless test — registers the same extensions in the same order.

## Open in the ignifx editor

The project is ready for the ignifx editor. `vite.config.ts` lists `editorHostPlugin` from
`@ignifx/editor-host`, and `main.ts` passes the app to `attachEditorPlayControls`. Under `pnpm dev`
the editor's scene view is served at `/__ignifx_editor__/`, and the editor can play, pause, step and
stop the game in its play view. Only the editor's origin can frame the scene view or connect to
either view. The editor sets that origin in `IGNIFX_EDITOR_ORIGIN` when it starts the dev server,
and it defaults to the packaged editor's `ignifx-editor://app`. `pnpm build` contains no editor code.

## Query flags

- `?static=1` — loads the same scene, stops the clock **before** `app.start()` and leaves the front
  end out, so no fixed step runs and the frame is exactly the authored scene. The visual goldens
  open it.
- `?hud=1` — keeps the overlay visible in a static scene; the gallery capture uses it.
- `?bench=1` — skips the title screen and installs `window.__ignifxFrameTime` for
  `tests/visual/tests/frame-time.spec.ts`.
- `?probe=1` — installs `window.__ignifxGameplay`, a read-only reading of the character and the run
  that `tests/visual/tests/templates.spec.ts` measures instead of photographing. See
  `src/gameplay-probe.ts`.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

# 2d-topdown

A top-down 2D game: a tilemap with a collision layer, a Y-sorted layer of props and a character, a
dead-zoned camera follow, shrines to light, and the full front end.

```sh
pnpm install && pnpm dev      # http://localhost:5173 · `pnpm build` → dist/
```

WebGPU only; a browser without it gets the fallback panel in `index.html`.

## Controls

| Action       | Keyboard                  | Gamepad          | Touch             |
| ------------ | ------------------------- | ---------------- | ----------------- |
| `move`       | WASD, arrows              | left stick, dpad | on-screen stick   |
| `interact`   | <kbd>E</kbd>, Space       | ✕ / A            | the **E** button  |
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
hovers to select and clicks to activate. All of that is `@ignifx/ui`'s `Menu` and `MenuStack`, not
template code: rows are `tabindex="-1"` because a gamepad raises no DOM focus events and two focus
authorities disagree, so the widget owns the selection and announces it with `aria-activedescendant`.
`src/menus/game-menus.ts` only declares which rows exist and what they read and write.

**Saves** are a versioned `ignifx-template.save` document under `app.storage.namespace("saves")`:
position, the shrines already lit, score and elapsed seconds — not a serialized scene, which would store the
level rather than the progress through it. Lighting a shrine autosaves, at most one write every two
seconds; a save from an older build is discarded with an `IGX-TPL-0011` warning rather than
migrated, which is what makes regenerating the art safe.

## The level

The level is data: **`assets/scenes/main.scene.json`** holds every entity — the `Level` with its
`Tilemap`, `TilemapRenderer` and `TilemapCollider2D`, the player, thirteen props, the shrine and the
camera — with its components, their fields, and the references between them (`{ "$entity": … }`,
`{ "$asset": … }`). `main.ts` loads it with `app.world.loadScene("scenes/main.scene.json")` and
never builds a level entity itself, and the scene names every script by its `typeId`, so a script
edit hot-patches the class instead of reloading the page.

The tiles themselves stay in `assets/level.tilemap.json`: two tile layers, the tileset and the solid
cells. Its objects layer still lists the spawn, the props and the shrine — the map generator writes
it — but the game registers no `registerTileObjectFactory`, so loading the scene spawns nothing from
it: the entities in the scene file are the ones the game has. Move the player or add a prop in the
scene file, not in the map. An object's declared width and height were its trigger box, so the
shrine's `BoxCollider2D` is one cell, the size of the `pad` frame it is drawn with. The props along
the path are solid at their base only, so walking east from the spawn means stepping around a barrel
rather than through it.

The file is in the canonical form `stringifySceneFile` writes: keys in a fixed order, numbers
rounded to six decimals, one value per line, no final newline. Edit it by hand, by an agent, or in
the ignifx editor. The ignifx repository's `tests/templates` loads it headless, checks the entity
list, and saves it again to prove the text comes back byte for byte.

**Adding an entity as data.** Copy an entity record, give it and each of its components a fresh
ULID (`generateUlid()` from `@ignifx/core`), set `parent` to `null` or another entity's `uid`, and
list it after its parent. A prop, say, is a `SpriteRenderer` naming `tiles.atlas.json` on the
`Default` sorting layer, a `topdown/SpriteFrame` naming the frame (`"barrel"`), and a
`BoxCollider2D`, on the `Solid` layer. A second shrine is a copy of `Shrine` with a new name, which
is also its id in a save file.

**Adding an entity in code.** Do it in `main.ts` after `loadScene`, the way the front end does:
`app.world.createEntity("Name")`, then `addComponent`. A project script is reached by its type id,
`scriptType<MyScript>(app, "my-game/MyScript")`, never by importing its module (`src/script-types.ts`
says why).

**What stays in code**, or needs a script, because a scene file cannot say it:

- **Which frame a still sprite draws.** `SpriteRenderer.frame` is a runtime index, not a field, so
  each prop and the shrine carry `SpriteFrame` (`src/scripts/sprite-frame.ts`), whose `frame` field
  names the frame and whose `awake` looks it up in the loaded atlas.
- **The tilemap's collision outlines.** `TilemapCollider2D` does not read the `Tilemap` beside it,
  so `main.ts` hands it the tilemap's `collisionData` after the load.
- **The sounds.** A clip referenced by a scene field is a dependency of the scene, and one the
  browser cannot decode would fail the whole load; every sound here is optional, so the footstep and
  the shrine's chime are assigned after the load and the ambient pad's `AudioSource` is created in
  code.
- **The front end**: menus, HUD, saves, input overrides, the shrines' `onLit` and the player's
  `onLookAround` callbacks, and the `Game UI` entity that carries the front end's scripts. They
  hold DOM elements and closures.
- **The input actions and audio buses** are assets, loaded before the scene because
  `PlayerController` resolves its actions in `awake`, which runs inside `loadScene`.

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
- `?probe=1` — installs `window.__ignifxGameplay`, a read-only reading of the character, the camera
  and the run that `tests/visual/tests/templates.spec.ts` measures instead of photographing. See
  `src/gameplay-probe.ts`.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

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

## The level

The level is data: **`assets/scenes/main.scene.json`** holds every entity — the sky, the sun and
the fill light, the floor slab, 24 wall panels and two interior stubs, six crates, three beacons,
the character, the companion and the camera rig — with its components, their fields, and the
references between them (`{ "$entity": … }`, `{ "$component": … }`, `{ "$asset": … }`). `main.ts`
loads it with `app.world.loadScene("scenes/main.scene.json")` and never builds a level entity
itself, and the scene names every script by its `typeId`, so a script edit hot-patches the class
instead of reloading the page.

The file is in the canonical form `stringifySceneFile` writes: keys in a fixed order, numbers
rounded to six decimals, one value per line, no final newline. Edit it by hand, by an agent, or —
later — in the ignifx editor. The ignifx repository's `tests/templates` loads it headless, checks the
entity list, and saves it again to prove the text comes back byte for byte.

**Adding an entity as data.** Copy an entity record, give it and each of its components a fresh
ULID (`generateUlid()` from `@ignifx/core`), set `parent` to `null` or another entity's `uid`, and
list it after its parent. A wall panel, say, is a `MeshRenderer` naming `meshes/wall-x` or
`meshes/wall-z` and `wall.material.json`, plus a `BoxCollider`, on the `Level` layer — and the
navmesh walks around it with no code change, because the bake reads every `Level` collider.

**Adding an entity in code.** Do it in `main.ts` after `loadScene`, the way the front end does:
`app.world.createEntity("Name")`, then `addComponent`. A project script is reached by its type id,
`scriptType<MyScript>(app, "my-game/MyScript")`, never by importing its module (`src/script-types.ts`
says why).

**What stays in code**, because a scene file cannot say it:

- **The primitive meshes** (`src/level-meshes.ts`). ignifx has no mesh file format and a primitive
  lives at a `memory:` address no file can name, so each one is published a second time at a plain
  address — `meshes/crate`, `meshes/wall-x`, … — before the scene loads. The scene loads only in an
  app that ran that step first.
- **The navmesh** (`src/navigation.ts`). `NavMeshSurface` takes its geometry from `addSource`
  arrays, so the bake runs after the load, from the scene's `Level` colliders.
- **The sounds.** A clip referenced by a scene field is a dependency of the scene, and one the
  browser cannot decode would fail the whole load; every sound here is optional, so `HeroAnimation.footstep`
  is assigned after the load and the ambient pad's `AudioSource` is created in code.
- **The post-process stack.** Its effects can only be switched on after `app.start()`.
- **The front end**: menus, HUD, saves, input overrides, the beacons' `onLit` callback, and the
  `Game UI` entity that carries their scripts. They hold DOM elements and closures.
- **The input actions and audio buses** are assets, loaded before the scene because the
  controllers resolve their actions in `awake`, which runs inside `loadScene`.

Every pixel and every sample comes from a committed, seeded script; nothing is downloaded
(`CONSTITUTION.md` §11.3). Regenerate from the repository root with `pnpm assets:3d`
and `pnpm assets:audio`. `pnpm dev:desktop` / `build:desktop` / `dist:desktop` run the Electron
build; `@ignifx/electron` is registered in both and is inert without a preload bridge.

## Extensions

`src/extensions.ts` exports `extensions()`, the list `main.ts` passes to `createApp`. It is a module
of its own so that anything else that builds an app over this project — the ignifx editor's scene
view, a headless test — registers the same extensions in the same order.

## Query flags

- `?static=1` — loads the same scene, switches every script and the companion's agent off, places
  the camera by hand, stops the clock **before** `app.start()` and leaves the front end out, so no
  fixed step runs and the frame is exactly the authored scene. The visual goldens open it.
- `?hud=1` — keeps the overlay visible in a static scene; the gallery capture uses it.
- `?bench=1` — skips the title screen and installs `window.__ignifxFrameTime` for
  `tests/visual/tests/frame-time.spec.ts`.
- `?probe=1` — installs the two test hooks: `window.__ignifxProbe` (`src/desktop-probe.ts`, the
  device-loss criterion in `tests/visual/tests/desktop.spec.ts`) and `window.__ignifxGameplay`
  (`src/gameplay-probe.ts`, the camera and character readings `tests/visual/tests/templates.spec.ts`
  asserts on). Neither exists without the flag.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

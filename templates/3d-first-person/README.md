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

## The level

The level is data: **`assets/scenes/main.scene.json`** holds every entity — the sky, the sun and
the fill light, the floor slab, 24 wall panels and two interior stubs, six crates, three pedestals
with their posts and emissive caps, the character with its head, view model and the prop it holds —
with its components, their fields, and the references between them (`{ "$entity": … }`,
`{ "$asset": … }`). `main.ts` loads it with `app.world.loadScene("scenes/main.scene.json")` and
never builds a level entity itself, and the scene names every script by its `typeId`, so a script
edit hot-patches the class instead of reloading the page. The `FirstPersonController`, the
crosshair ray (`Interactor`, its `eye` and `reach`) and `AttachToHand` (its `prop`) are scene
components like any other.

**The primitive meshes are files too**: `assets/meshes/*.mesh.json`, each naming one `MeshAsset`
primitive and its options (`{ "format": "ignifx.mesh", "formatVersion": 1, "primitive": "box",
"options": { "size": 1 } }`), and the scene names them by path, `meshes/crate.mesh.json`. No code
runs before the scene loads, so any app built from `src/extensions.ts` and the scripts — a headless
test, the ignifx editor's scene view — opens the level. The sky is an inverted 180-metre sphere with
an unlit gradient, because `Environment.skybox` wants a cube map that cannot be generated from
arithmetic. The floor's `uvScale` of 10 keeps the 128-pixel slab texture at about two and a half
metres a tile. The walls are 4-metre panels sharing `wall-x` or `wall-z` rather than four long
boxes, because a box gives every face the unit UV square and one 24-metre wall would stretch a
single texture across it.

The file is in the canonical form `stringifySceneFile` writes: keys in a fixed order, numbers
rounded to six decimals, one value per line, no final newline. Edit it by hand, by an agent, or in
the ignifx editor. The ignifx repository's `tests/templates` loads it headless, checks the entity
list, and saves it again to prove the text comes back byte for byte.

**Adding an entity as data.** Copy an entity record, give it and each of its components a fresh
ULID (`generateUlid()` from `@ignifx/core`), set `parent` to `null` or another entity's `uid`, and
list it after its parent. A crate, say, is a `MeshRenderer` naming `meshes/crate.mesh.json` and
`crate.material.json`, a `BoxCollider` and a `Rigidbody`, on the `Prop` layer. A fourth pedestal is
an entity on the `Interactable` layer with a `MeshRenderer`, a `BoxCollider` and a child renderer
for its cap: the crosshair finds it, and it gets a material of its own, with no code change.

**Adding an entity in code.** Do it in `main.ts` after `loadScene`, the way the front end does:
`app.world.createEntity("Name")`, then `addComponent`. A project script is reached by its type id,
`scriptType<MyScript>(app, "my-game/MyScript")`, never by importing its module (`src/script-types.ts`
says why).

**What stays in code**, because a scene file cannot say it:

- **Each pedestal's own material** (`src/pedestals.ts`). Lighting a pedestal recolours its
  material, which every renderer sharing it draws with. The scene can only name the shared
  `crate.material.json`, so each pedestal is given a `clone` after the load.
- **The sounds.** A clip referenced by a scene field is a dependency of the scene, and one the
  browser cannot decode would fail the whole load; every sound here is optional, so the crosshair's
  pickup blip is assigned after the load and the ambient pad's `AudioSource` is created in code.
- **The post-process stack.** Its effects can only be switched on after `app.start()`.
- **The front end**: menus, HUD, saves, input overrides, the crosshair ray's targets, crosshair
  element and `onToggled` callback, and the `Game UI` entity that carries the front end's scripts.
  They hold DOM elements and closures.
- **The input actions and audio buses** are assets, loaded before the scene because the controller
  and the crosshair ray resolve their actions in `awake`, which runs inside `loadScene`.

Every pixel and every sample comes from a committed, seeded script; nothing is downloaded
(`CONSTITUTION.md` §11.3). Regenerate from the repository root with `pnpm assets:3d`
and `pnpm assets:audio`. `pnpm dev:desktop` / `build:desktop` / `dist:desktop` run the Electron
build; `@ignifx/electron` is registered in both and is inert without a preload bridge.

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

- `?static=1` — loads the same scene, switches the controller and the crosshair ray off, turns the
  character to face the pedestals by hand, stops the clock **before** `app.start()` and leaves the
  front end out, so no fixed step runs and the frame is exactly the authored scene. The visual
  goldens open it.
- `?hud=1` — keeps the overlay visible in a static scene; the gallery capture uses it.
- `?bench=1` — skips the title screen and installs `window.__ignifxFrameTime` for
  `tests/visual/tests/frame-time.spec.ts`.
- `?probe=1` — installs `window.__ignifxGameplay` (`src/gameplay-probe.ts`), the view and character
  readings `tests/visual/tests/templates.spec.ts` asserts on. It does not exist without the flag.
- `?locale=<tag>` — picks a locale from `assets/strings.i18n.json` before the menus are built.

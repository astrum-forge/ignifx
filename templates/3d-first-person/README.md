# 3d-first-person

A first-person 3D game: a character whose body owns the yaw and whose head owns the pitch, pointer
lock on the first click, crouch, a crosshair ray that lights the pedestal it lands on, a view model
with a prop welded to the rig's `hand` node, a loading screen and a pause menu.

```sh
pnpm install && pnpm dev      # http://localhost:5173 · `pnpm build` → dist/
```

WebGPU only. A browser without it gets the fallback panel in `index.html`.

## Controls

| Action     | Keyboard                          | Gamepad          | Touch             |
| ---------- | --------------------------------- | ---------------- | ----------------- |
| `Move`     | WASD, arrows                      | left stick, dpad | left stick        |
| `Look`     | mouse (click to lock the pointer) | right stick      | right stick       |
| `Jump`     | <kbd>Space</kbd>                  | ✕ / A            | the **▲** button  |
| `Sprint`   | <kbd>Shift</kbd>                  | left stick click | —                 |
| `Crouch`   | <kbd>C</kbd>, <kbd>Ctrl</kbd>     | ◯ / B            | the **▼** button  |
| `Interact` | <kbd>E</kbd>, left mouse          | right trigger    | the **E** button  |
| `Pause`    | <kbd>Esc</kbd>                    | Start            | the **II** button |

Opening the pause menu exits pointer lock, so the dialog's buttons are reachable; the next click on
the canvas takes it back.

## Layout

- `ignifx.config.ts` — collision layers (`Interactable` is its own, so the ray filters in Havok),
  shadows, and the `ui` layers.
- `assets/` — the rig as `viewmodel.glb`, the animator document, three materials with their
  textures, and the input, bus and locale documents.
- `src/level.ts` — the room, the pushable crates, and three pedestals, each with its **own** clone
  of the crate material so lighting one does not light all three.
- `src/main.ts` — create the app, load and await every asset, build the world, start.
- `src/scripts/interactor.ts` — the crosshair ray: `app.physics.raycast` from the head, masked to
  the `Interactable` layer.
- `src/scripts/attach-to-hand.ts` — `Model.attachToNode("hand", prop)`, retried until the model has
  instantiated (it clones on its first `PreRender` sync, not on `addComponent`).
- `src/game-ui.ts` — the `@ignifx/ui` overlay: loading screen, pause dialog, crosshair, HUD line.

## Flags

`?static=1` builds the scene without the controller and stops the clock before the first frame; the
visual golden suite opens it. `?locale=fr` switches `app.i18n`.

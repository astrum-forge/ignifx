# 3d-third-person

A third-person 3D game: a character on a `CharacterController`, an orbit camera that will not clip
through a wall, an `Animator` state machine on a rigged model, a navmesh-driven companion, pushable
crates, a loading screen and a pause menu.

```sh
pnpm install && pnpm dev      # http://localhost:5173 · `pnpm build` → dist/
```

WebGPU only. A browser without it gets the fallback panel in `index.html`.

## Controls

| Action   | Keyboard         | Gamepad          | Touch             |
| -------- | ---------------- | ---------------- | ----------------- |
| `Move`   | WASD, arrows     | left stick, dpad | left stick        |
| `Look`   | mouse            | right stick      | right stick       |
| `Jump`   | <kbd>Space</kbd> | ✕ / A            | the **▲** button  |
| `Sprint` | <kbd>Shift</kbd> | left stick click | the **»** button  |
| `Pause`  | <kbd>Esc</kbd>   | Start            | the **II** button |

`assets/game.input.json` owns all of that. The names are capitalised because they are the defaults
`ThirdPersonController` and `ThirdPersonCamera` read; renaming one means setting the matching field
(`moveAction`, `lookAction`, …) and calling `rebind()`.

## Layout

- `ignifx.config.ts` — collision layers, shadows, the `ui` layers, and the navigation seed.
- `assets/` — the rig under **two** addresses (`player.glb` and `companion.glb`, because one
  `Animator` binds one model asset), the animator document, three materials with their textures,
  the input, bus and locale documents. Scanned by `@ignifx/vite-plugin`, reached by address.
- `src/level.ts` — the courtyard, and the triangle soup the navmesh bakes from.
- `src/main.ts` — create the app, load and await every asset, build the world, bake, start.
- `src/scripts/` — `HeroAnimation` (controller state → animator parameters, plus footsteps) and
  `Companion` (a `NavMeshAgent` that follows the player).
- `src/game-ui.ts` — the `@ignifx/ui` overlay: loading screen, pause dialog, HUD line, touch sticks.

## Flags

`?static=1` builds the scene without the controllers and stops the clock before the first frame, so
the picture is exactly the authored scene; the visual golden suite opens it. `?locale=fr` switches
`app.i18n`, which is where every menu string lives.

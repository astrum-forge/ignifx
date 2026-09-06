# 2d-topdown

A top-down 2D game: a tilemap with a collision layer, a Y-sorted layer of props and a character, a
dead-zoned camera follow, and a trigger zone that plays a sound.

```sh
pnpm install && pnpm dev      # http://localhost:5173 · `pnpm build` → dist/
```

WebGPU only. A browser without it gets the fallback panel in `index.html`.

## Controls

| Action     | Keyboard                       | Gamepad          | Touch             |
| ---------- | ------------------------------ | ---------------- | ----------------- |
| `move`     | WASD, arrows                   | left stick, dpad | on-screen stick   |
| `interact` | <kbd>E</kbd>, <kbd>Space</kbd> | ✕ / A            | the **E** button  |
| `pause`    | <kbd>Esc</kbd>                 | Start            | the **II** button |

`assets/game.input.json` owns all of that; nothing about it is hard-coded.

## Layout

- `ignifx.config.ts` — sorting layers, collision layers, `twoD` and `physics2d` settings.
- `assets/` — atlases, animation clips, the tilemap and the input document. Scanned by
  `@ignifx/vite-plugin`, content-hashed on a build, reached by address through the manifest.
- `public/` — the sheet images. A `.atlas.json` names its image **relative to the document**, and a
  hashed build would break that, so the PNGs are served unhashed from here.
- `src/main.ts` — create the app, load and await every asset, build the world, start.
- `src/scripts/` — `PlayerController` (input in `update`, movement in `fixedUpdate`) and `Shrine`.
- `src/game-ui.ts` — the `@ignifx/ui` overlay: a `LoadingScreen` bound to `app.assets`, a pause
  `Dialog` driven by a script that keeps updating while the app is paused, and the
  `VirtualJoystick` / `VirtualButton` touch controls. It replaced the hand-written
  `src/touch-controls.ts` this template shipped in Phase 6; the bindings did not change.

## Level

`assets/level.tilemap.json` carries two tile layers and an objects layer. Everything except the
camera is spawned from that objects layer through `app.twoD.registerTileObjectFactory`, so a map
edit can move the player's start or add a prop without touching any TypeScript.

`?static=1` stops the clock before the first frame; the visual golden suite opens it.

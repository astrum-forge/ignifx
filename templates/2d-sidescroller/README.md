# 2d-sidescroller

A pixel-perfect 2D side-scroller: three parallax bands, a tilemap with slopes and one-way
platforms, collectible coins, and a reference platformer controller.

```sh
pnpm install && pnpm dev      # http://localhost:5173 · `pnpm build` → dist/
```

WebGPU only. A browser without it gets the fallback panel in `index.html`.

## Controls

| Action  | Keyboard                       | Gamepad          | Touch             |
| ------- | ------------------------------ | ---------------- | ----------------- |
| `move`  | A/D, arrows                    | left stick, dpad | on-screen stick   |
| `jump`  | <kbd>Space</kbd>, <kbd>Z</kbd> | ✕ / A            | the **▲** button  |
| `pause` | <kbd>Esc</kbd>                 | Start            | the **II** button |

Hold down and press jump to drop through a one-way platform. Holding jump gives the full arc;
tapping gives a hop.

## The controller

`src/scripts/platformer-controller.ts` is the piece worth reading: coyote time, a jump buffer, a
variable jump height, and drop-through, all in `fixedUpdate` over input captured in `update`. A
`CharacterController2D` is purely kinematic, so the script owns gravity — which is what lets it use
a weaker one going up than coming down. `shape: "box"` is not a style choice either: with the
default capsule the autostep clears about 0.15 m whatever `stepOffset` says.

## Layout

- `ignifx.config.ts` — one sorting layer per parallax band, plus `twoD` and `physics2d` settings.
- `assets/` — atlases, clips, the tilemap and the input document, reached by address.
- `public/` — the sheet images, served unhashed because a `.atlas.json` names its image relative to
  itself.
- `src/main.ts` — parallax bands, tilemap and collider, then whatever the objects layer spawns.
- `src/game-ui.ts` — the `@ignifx/ui` overlay: a `LoadingScreen` bound to `app.assets`, a pause
  `Dialog` driven by a script that keeps updating while the app is paused, and the
  `VirtualJoystick` / `VirtualButton` touch controls. It replaced the hand-written
  `src/touch-controls.ts` this template shipped in Phase 6; the bindings did not change.

`?static=1` stops the clock before the first frame; the visual golden suite opens it.

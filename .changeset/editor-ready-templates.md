---
"@ignifx/cli": minor
---

`2d-topdown`, `2d-sidescroller` and `3d-first-person` projects keep their level in `assets/scenes/main.scene.json`, which `src/main.ts` loads, and open in the ignifx editor as `3d-third-person` projects do. Change the level by editing the scene file, and put code-only steps after `loadScene` in `main.ts`.

- The extension list moves to `src/extensions.ts`, and `3d-first-person`'s `src/level.ts` is gone.
- The 2D templates no longer spawn the tilemap's objects layer; the player, props, shrine and coins are entities in the scene file.
- `main.ts` no longer imports anything under `src/scripts/`, so a script edit hot-patches instead of reloading the page.

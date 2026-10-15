---
"@ignifx/cli": minor
---

`3d-third-person` projects keep their level in `assets/scenes/main.scene.json`, which `src/main.ts` loads; `src/level.ts` is gone. Change the level by editing the scene file, and put code-only steps after `loadScene` in `main.ts`.

- The extension list moves to `src/extensions.ts`, whose `extensions()` other tools can call to build an app with the same extensions.
- `main.ts` no longer imports anything under `src/scripts/`, so the template itself no longer turns a script edit into a full page reload.

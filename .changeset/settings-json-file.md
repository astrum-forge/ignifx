---
"@ignifx/vite-plugin": minor
---

Read project settings from `ignifx.settings.json` as well as `ignifx.config.ts`; the config file wins a section both define.
Pass `schemas.settings` to fail a misspelled settings key with `IGX-0554`. Editing either file now restarts the dev server, so the new values reach the game.

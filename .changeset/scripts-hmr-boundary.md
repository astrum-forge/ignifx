---
"@ignifx/vite-plugin": patch
---

Fixed: editing a script in `src/scripts/` (or your `scripts` glob) now hot-reloads it through `app.hotReload` instead of reloading the whole page.

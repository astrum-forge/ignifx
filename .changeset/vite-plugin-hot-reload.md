---
"@ignifx/vite-plugin": minor
---

`virtual:ignifx/scripts` accepts HMR updates

The generated script registry now self-accepts: a script file is already in Vite's module graph, so hot reload needs no channel of its own. On an update the module diffs the old and new registries by `typeId` for its log line and hands the new registry to `app.hotReload.apply`, which decides what each change means. The module exports `acceptHotReload(app)` next to `scripts` — one line of game code, because a generated module cannot discover the app and a module-level app reference is forbidden — and keeps its subscribers in `import.meta.hot.data`, so the module that handles the second update still knows about them.

None of that ships in a build: `scriptsModuleSource(pattern, { hot })` emits the client only when the dev server is serving the module, and a production bundle carries `acceptHotReload` as an empty function with no `import.meta.hot` reference at all.

---
"@ignifx/core": patch
"@ignifx/vite-plugin": patch
---

Kernel and build fixes surfaced by Phase 4

- `ExtensionContext.setSimulationScene(null)` is a no-op while the app is being disposed. `App.dispose()` disposes the world before the extensions, and `World.dispose()` has already dropped the scene, so a clear from an extension's `dispose` — which the hook's own documentation recommends — used to throw `IGX-0106`.
- `ignifx.assets.public` entries that begin with `node_modules/` are resolved through the extension's own `node_modules` and then each ancestor directory, so a dependency's file (Havok's `.wasm`, declared by `@ignifx/physics`) is found under a hoisting package manager as well as under pnpm.

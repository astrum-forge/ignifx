---
"@ignifx/vite-plugin": patch
---

`vite build` and `vite dev` now find `@ignifx/physics`'s Havok WebAssembly in a standalone pnpm project, instead of failing with `IGX-0553` unless `@babylonjs/havok` was a direct dependency.

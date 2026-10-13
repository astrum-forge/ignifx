---
"@ignifx/core": patch
"@ignifx/2d": patch
"@ignifx/3d": patch
"@ignifx/particles": patch
"@ignifx/particles-2d": patch
"ignifx": patch
---

Fix API and skill examples that called `.retain()` on an asset handle before assigning it to a component field. A field takes no reference of its own, so that extra reference was never released. The examples now assign the handle directly and release it when it is no longer used.

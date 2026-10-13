---
"@ignifx/cli": patch
---

The scaffolded templates no longer call `.retain()` on an asset handle before assigning it to a component field. A field takes no reference of its own, so those extra references were never released; the templates now assign the handle directly and keep the handles they create for the game's lifetime.

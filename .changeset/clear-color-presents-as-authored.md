---
"@ignifx/core": minor
"@ignifx/2d": minor
---

The clear colour now presents exactly as authored. `rendering.clearColor`, `Camera.clearColor` and `Environment.clearColor` used to present much darker than their sRGB value (an sRGB `0.5` showed as byte `55` instead of `128`), with or without tone mapping or bloom, and in both 2D modes.

### Breaking

Backgrounds get brighter wherever a clear colour is not pure black or white. If you wrapped a clear colour in `Color.linearToSrgb(...)` or brightened it by hand to make up for this, remove that compensation and write the sRGB colour you want.

---
"@ignifx/core": minor
---

`app.renderer.pickAsync` now hits at every device pixel ratio, because it converts its backing-store
pixel coordinates to the CSS pixels Babylon Lite's picker takes.
A pick on any part of a glTF `Model` now resolves to the model's entity and `Model` component, in
`pickAsync`, its `filter` and `world.raycastRender`.
`RenderPickOptions.ignore` looks through entities, components and earlier hits, so passing the
previous hit walks through what is under one pixel, front to back.
`RenderPick` adds `meshName` and `thinInstanceIndex`, and `point` is now set on every GPU hit.

### Breaking

Code that passed CSS pixels to `pickAsync`, as its old example with `event.offsetX` did, now misses
at a device pixel ratio other than 1. Multiply DOM coordinates by `canvas.width / canvas.clientWidth`,
or pass `<Pointer>/position` as it is.

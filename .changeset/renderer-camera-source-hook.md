---
"@ignifx/core": patch
---

`IGX-0706` is not logged when another rendering context draws the frame through a camera of its own

A world with a `Camera2D` and no 3D `Camera` is a correct `@ignifx/2d` `"sprite"`-mode scene, and
the render-sync system warned at it once per world: "this world has no enabled camera, so nothing is
drawn", of which the second half was false. `Renderer` gains an `@internal` `addCameraSource(probe)`
— returning a `Disconnect` — that an extension owning a second rendering context on the same surface
calls from `register`; the sync system asks the registered probes only in a frame where no enabled
`Camera` was found, so a well-formed 3D scene pays nothing. A claim also clears the once-only latch,
so the sequence "app starts on an empty world, the 2D camera arrives, the 2D camera is destroyed"
warns exactly as the same sequence does for a `Camera`.

No public API change: the new member is `@internal`.

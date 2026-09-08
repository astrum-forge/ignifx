---
"@ignifx/2d": patch
---

`"sprite"` mode clears the frame to `rendering.clearColor`, and a `Camera2D`-only world stops logging `IGX-0706`

A `"sprite"`-mode sprite pass opens its own swapchain pass and clears it, so nothing the render scene
did survives underneath and the whole of the 3D clear-colour precedence
(`docs/architecture/07-rendering.md` §2.1) never reached the screen in a 2D game. The extension
passed a hard-coded black to `createSpriteRenderer`, so every 2D scene had a black sky and both 2D
templates' configured `rendering.clearColor` did nothing. It now clears to the resolved setting,
decoded from sRGB exactly as `RendererImpl.applyClearColor` decodes it — a browser test measures the
same three bytes out of a `"sprite"` frame and a `"mixed"` frame with the same setting, so one
setting means one colour whichever mode a game is in. Neither `Camera.clearColor` nor
`Environment.clearColor` applies in `"sprite"` mode: there is no such component in a 2D scene, and
`Camera2D` has no `clearColor` field of its own. Measured on 2026-09-08 (macOS arm64, SwiftShader):
the surface is not an sRGB-encoding format, so a channel is presented at `srgbToLinear(value) * 255`
rather than `value * 255` — `{ r: 0.6, g: 0.2, b: 0.9 }` reads back as bytes `81, 8, 201`, and a
literal `#14181F` is almost black. The 2D skill's Gotchas now say so.

The extension also registers a camera source with the rendering service, so core's `IGX-0706` ("this
world has no enabled camera, so nothing is drawn") is no longer logged at a scene whose only camera
is an enabled `Camera2D` — a warning on a correct scene. It still fires for a world with no camera
of either kind, and again if the last `Camera2D` goes away.

No public API change: the two additions are `@internal`.

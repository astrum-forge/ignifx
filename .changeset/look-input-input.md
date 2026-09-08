---
"@ignifx/input": patch
---

Pointer deltas are CSS pixels, the canvas wheel no longer scrolls the page, `InputAction.activeDevice`, and pointer lock asks for raw mouse motion

Four fixes to the things a look control is built out of, all found while chasing "the camera on the
third-person example does not behave correctly" and "scroll interferes with page scrolling".

**The wheel is taken non-passively.** The canvas `wheel` listener was registered `{ passive: true }`,
which forbids `preventDefault`, so a wheel over a running game zoomed the camera _and_ scrolled the
page underneath it — obvious on ignifx.com, where the examples live in an `<iframe>` and the wheel
took the article with it. The listener is now non-passive and prevents the default on every event it
queues. The wheel is still read from the canvas alone, so a wheel over the page's own chrome is
untouched, and the queued entry is unchanged.

**Pointer deltas are CSS pixels; positions stay backing-store pixels.** `<Mouse>/delta`,
`<Pointer>/delta`, `<Touch>/…/delta` and `event.deltaX`/`deltaY` were multiplied by
`canvas.width / rect.width`, the same scale positions need. A delta is hand motion, not a place on
the render target: the scale doubled every look sensitivity on a device-pixel-ratio-2 display and
moved it again whenever a settings screen changed `renderer.resolutionScale`. Deltas are now the
browser's raw `movementX`/`movementY`, and for the pointer types that leave those at zero (touch,
some pens) the DOM adapter derives the motion from that pointer's own successive `clientX`/`clientY`
— in CSS pixels, never from the queued position. `DeviceWriter` derives nothing at all now, so
`simulateEvent` reports exactly the delta a test states. Positions are unchanged, so
`renderer.pickAsync(pointer.position)` and `Camera.screenToRay` are still exact at every ratio.
A game author sees one number to tune: a mouse look sensitivity in degrees per CSS pixel, around
0.08–0.15, the same on every display.

**`InputAction.activeDevice`** names the device family behind the binding whose magnitude won the
frame, and `null` when the action is at rest or disabled — stable for the frame like every other
reading. One `Look` action bound to both a mouse and a stick carries two different quantities, and
this is what lets a rig tell them apart: `@ignifx/3d` uses it to ignore mouse look until the pointer
is locked and to read a stick as a rate. A composite reports the device of its first part, which is
the only sensible answer for a `2DVector` whose four parts are one device.

**`PointerLock.request()` asks for `unadjustedMovement: true`** before it asks plainly, falling back
when the browser rejects the option by throwing or by rejecting the returned promise. That is raw
mouse motion with the desktop's pointer-acceleration curve removed, which is what a first-person look
wants — with acceleration on, a fast flick turns further than a slow one over the same desk distance,
which is most of what players describe as a jumpy look. Settle semantics are unchanged: `true` on
`pointerlockchange`, `false` on `pointerlockerror`, `IGX-0809` on a headless app.

Public API change: `InputAction.activeDevice: DeviceKind | null` is new. No signature changed, but
the **meaning** of `<Mouse>/delta`, `<Pointer>/delta` and `<Touch>/…/delta` did: they are CSS pixels
now, so a project that tuned its sensitivity on a retina display re-tunes it once (`invert` and
`scale(...)` processors still apply as before).

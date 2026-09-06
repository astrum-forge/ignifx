---
"@ignifx/input": minor
---

`app.input.uiHasPointer`

A settable flag, symmetric with `uiHasFocus`: while a pointer is pressed on the UI overlay, pointing-device actions read as released (their events are still published), so a drag that began on a UI slider no longer also turns the camera. `@ignifx/ui` assigns it.

Pointer positions and deltas (`<Pointer>/position`, `<Pointer>/delta`, `<Mouse>/…`, `<Touch>/…`, and `app.input.events`) are reported in the canvas's backing-store pixels instead of CSS pixels, the space `Camera.worldToScreen`, `Camera.screenToRay`, and `renderer.pickAsync` already used, so `pickAsync(pointer.position)` is exact at every device pixel ratio.

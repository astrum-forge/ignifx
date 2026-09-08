---
"@ignifx/3d": patch
---

The look rigs re-arm pointer lock, ignore an unlocked mouse, and read a stick as a rate

`FirstPersonController` and `ThirdPersonCamera` were each doing their own look arithmetic, and both
were wrong in the same four ways. The look half of both now lives in one internal module and the
four defects are fixed together.

**Pointer lock re-arms.** `FirstPersonController` set a latch on its first request and never cleared
it, so once the browser released the lock — Escape, which the templates also bind to the pause menu,
or a focus change — no later click could take it back and the player finished the session with an
unlocked mouse. The lock is now requested on **every** frame that carries a `pointerdown`
while the lock is not held; the only guard is a request already in flight. A refusal is logged and
dropped, exactly as before.

**An unlocked mouse no longer turns the view.** While `lockPointerOnClick` is on and the lock is not
held, a `Look` reading whose `InputAction.activeDevice` is `Mouse` or `Pointer` is ignored. Before,
the view spun whenever the cursor crossed the canvas — on its way to a menu button, say — and stopped
dead when the cursor left the frame. Gamepad, touch, and virtual sticks are never gated: they have no
cursor to lose. `lockPointerOnClick: false` keeps unconditional mouse look for drag-to-look designs.

**A stick is a rate, a pointer is a displacement.** Both rigs did `yaw += look.x * sensitivity` for
every device. That is right for a pointer delta, which is this frame's motion, and wrong for a stick,
whose value is a deflection: at 120 Hz the stick turned twice as fast as at 60 Hz, and games papered
over it with a `scale(18)` processor. A gamepad or virtual reading is now multiplied by the new
`stickLookSpeed` (degrees per second at full deflection, default 180) and the frame delta, so the
same push turns through the same angle in the same second at any frame rate, and slow motion slows
the look with everything else. `sensitivity` keeps its meaning for pointer readings — degrees per unit,
which with `@ignifx/input`'s CSS-pixel deltas is degrees per CSS pixel, so 0.08–0.15 suits most mice
on every display and at every render scale.

**Up is up on every device.** A screen's `movementY` grows downward and a stick's `y` grows upward,
and both rigs subtracted `look.y` from their pitch regardless — so one `invertY` could only ever suit
one device family, and a first-person mouse looked *down* when it was pushed forward. The pitch axis
is normalised where the device is known: `Mouse`, `Pointer`, and `Touch` readings are negated, gamepad
and virtual are not, and the rigs apply their own sign and `invertY` on top as before. Moving the
mouse forward and pushing a stick up now both look up in first person, and both lower the boom and
aim the camera up in third person; `invertY` flips every device together.

`ThirdPersonCamera` also gains `lockPointerOnClick`, defaulting to **`false`**: a rig that orbits on a
held mouse button needs its cursor, so nothing changes for an existing third-person game until it
opts in to the console-style "click to capture, Escape to release" behaviour.

Public API change: `FirstPersonController.stickLookSpeed`, `ThirdPersonCamera.stickLookSpeed`, and
`ThirdPersonCamera.lockPointerOnClick` are new schema fields. No field was removed or renamed. Two
behaviour changes need a look from any game that ships a look binding: drop the `scale(...)`
processors from stick look bindings, which double-count against `stickLookSpeed`, keeping the
`deadzone(...)`; and drop any `scale(1, -1)` that existed to line a stick up with the mouse, because
the rigs agree on which way is up now — reach for `invertY` instead.

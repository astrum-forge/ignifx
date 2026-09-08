---
"@ignifx/physics": patch
---

The interpolated display pose is written before `update`, so camera rigs and scripts see the pose the frame draws

Poses are still snapshotted on the fixed step and interpolated with `time.fixedStepAlpha`, but the
system that writes `lerp(prev, cur, alpha)` into a `Rigidbody`'s or `CharacterController`'s node
moved from `Systems(PreRender, −500)` to `Systems(Update, −900)` — straight after the fixed loop and
lifecycle flush B, in front of `scripts.update`.

Why: `ThirdPersonCamera`, `FirstPersonController`, bone attachments and every hand-written follow camera
run in `update`/`lateUpdate`, which used to be *before* the display pose existed. They framed the
character where the last fixed step left it while the renderer drew it at `lerp(prev, cur, alpha)`,
so at any refresh rate the character juddered against the camera by up to one fixed step of motion —
about 0.1 m at sprint speed, every frame. Writing the pose at the top of `Update` means `update`,
`lateUpdate`, animation, camera rigs and the render sync all read the same pose the frame presents.
This is Unity's model.

What a game author sees: a smooth third- or first-person camera, and `transform.position` read from
`update`/`lateUpdate` now returning the interpolated pose rather than the last fixed one. The
simulation is unchanged: the restore system at `FixedUpdate −100` still runs before
`scripts.fixedUpdate`, so `fixedUpdate` and Havok only ever see authoritative poses, and a kinematic
body moved by writing its transform behaves exactly as before — the restore already overwrote such a
write before the step read it. A system that must read an authoritative pose outside the fixed loop
registers at `Phase.Update` with an order below `−900`.

Public API change: none. The order constant and the interpolation system are `@internal`.

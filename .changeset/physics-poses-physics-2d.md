---
"@ignifx/physics-2d": patch
---

A `CharacterController2D` walks through triggers instead of bouncing off them, and the display pose is written before `update` so follow cameras stop juddering

**Triggers were walls.** Rapier's `KinematicCharacterController.computeColliderMovement` takes
`filterFlags` as its third argument, and the adapter passed `undefined`, which leaves sensors in the
obstacle set. Measured on 2026-09-08 against `@dimforge/rapier2d-compat@0.20.0` (macOS arm64,
Node 24): a kinematic box driven by the controller towards a static sensor ball stops dead at the
sensor's surface — `x = 0.49` for a sensor at `x = 1` with radius 0.3, a 0.2 half-width character and
a 0.01 offset — and because it never overlaps, `drainCollisionEvents` reports nothing at all. With
`QueryFilterFlags.EXCLUDE_SENSORS` the same character reaches `x = 3.0` and the queue reports the
`started`/`stopped` pair. Every controller move now passes that flag.

What a game author sees: a collectible finally works. The side-scroller template's coins are a
`CircleCollider2D { isTrigger: true }` on an entity with no rigidbody, and the player is a
`CharacterController2D` — so every coin was an invisible bump the player stopped against and
`onTriggerEnter` never fired. The same was true of the top-down template's shrine pads and of any
trigger zone a controller-driven character is meant to enter. The flip side is intended: a sensor no
longer appears in `CharacterController2D.onCollided`, because a trigger is not an obstacle. Use
`onTriggerEnter`/`onTriggerExit` for pickups and zones and `onCollided` for the walls and floors the
character actually pushed against.

**The display pose is written at the top of `Update`, not in `PreRender`.** Poses are still
snapshotted on the fixed step and interpolated with `time.fixedStepAlpha`, but the system that writes
`lerp(prev, cur, alpha)` moved from `Systems(PreRender, −500)` to `Systems(Update, −900)`, which runs
straight after the fixed loop and before `scripts.update`. `Camera2DFollow` and every hand-written
follow camera run in `update`/`lateUpdate`, so they used to frame the character where the last fixed
step left it while the renderer drew it interpolated: up to one fixed step of relative motion — about
0.1 m at sprint speed — of judder every frame, and with the pixel-perfect camera the two poses are
quantised independently, so the sprite visibly shook while running. Now scripts, animation, camera
rigs and the render sync all read the pose the frame presents, which is Unity's model. `fixedUpdate`
and Rapier are unaffected: the restore system at `FixedUpdate −100` still runs before
`scripts.fixedUpdate`, so the simulation only ever sees authoritative poses, and a kinematic body
moved by writing its transform behaves exactly as before.

Public API change: none. The order constants and both systems are `@internal`.

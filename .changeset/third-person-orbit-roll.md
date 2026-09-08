---
"@ignifx/3d": patch
---

`ThirdPersonCamera` no longer rolls the horizon when the mouse moves sideways

The rig built its rotation with one `Quat.fromEulerDegrees(pitch, yaw, 0)` call. That helper composes
in intrinsic XYZ order, so the boom was pitched first and then yawed about the *tilted* axis: with
any pitch at all — and the template starts twelve degrees down — a horizontal mouse motion tilted the
camera rather than turning it, and the camera rose and fell as it went round (measured 2026-09-08:
at 15 degrees of pitch its height followed `cos(yaw)`).

The rotation is now `Ry(yaw) * Rx(pitch)`: yaw about the world's up, then pitch about the camera's
own right, which is the one order in which looking sideways is a turn about the vertical. The
starting angles are read off the entity's forward vector at `awake` instead of its Euler angles, so
an authored downward tilt seeds the same pitch whatever Euler order wrote it.

What a game author sees: a third-person camera whose horizon stays level and whose height stays put
through a full orbit, at every pitch.

Public API change: none.

---
"@ignifx/physics": patch
"@ignifx/3d": patch
---

`shapeCast` can sweep past one body, and the third-person boom and step probe no longer report the character's own capsule

Lite's `ShapeCastQuery` carries no collision masks — unlike `physicsRaycast` — so a shape sweep
cannot be filtered by layer inside Havok; `layerMask` only ever decided which hit was *attributed*
an entity, and a body outside the mask still stopped the sweep, reported with `entity: null`. Two
callers in `@ignifx/3d` were sweeping from inside the character's own capsule and were stopped by it
at fraction zero every time:

- `ThirdPersonCamera` sweeps from its shoulder pivot, which sits inside the capsule, out along the
  boom. For every yaw whose boom crossed the capsule the sweep hit it immediately, `currentDistance`
  collapsed to `0` and the camera sat inside the character's head — measured on 2026-09-08 in the
  third-person template at every yaw from 30° to 180° at the spawn, with no wall anywhere near.
  `collisionLayers: ["Level", "Prop"]` could not prevent it, because the mask never reached the sweep.
- `ThirdPersonController`'s step probe sweeps a sphere forward from the character's feet; both of its
  sweeps found the capsule first, so `stepHeight` never lifted anything.

`ShapeCastOptions` — `QueryOptions` plus `ignore?: Entity | null` — names the one body the sweep
passes through, resolved to its Havok body whether the entity is a `Rigidbody`, a collider-only
static, or a `CharacterController` (whose capsule body Lite exposes through `getBody()`). The camera
rig ignores its `target`; the step probe ignores its own entity. A masked-out body other than the
ignored one still shortens the boom, which for scenery is the point and is now said so on
`collisionLayers`.

What a game author sees: a third-person camera that holds its distance through a full orbit and a
`stepHeight` that climbs steps; and, for their own queries, a way to sweep out of a body they are
standing in.

Public API change: `ShapeCastOptions` is new and `PhysicsService.shapeCast` takes it in place of
`QueryOptions` (a widening — every existing call compiles). Nothing was removed or renamed.

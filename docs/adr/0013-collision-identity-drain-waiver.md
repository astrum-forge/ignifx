# ADR-0013 · Waiver: adapter-internal Havok collision-event drain

**Status:** Superseded (2026-10-15: upstream Babylon Lite now reports both bodies of a collision, so the waiver is lifted; see [Superseded](#superseded--2026-10-15)) · **Date:** 2026-09-05 · **Waiver under:** `CONSTITUTION.md` §10.3, exception to §3.4 / ADR-0002

The sections below the Status line record the waiver as it stood while it was active (2026-09-06 to 2026-10-15).

## Context

`@babylonjs/lite@1.27.0` reports collision events (`onPhysicsCollision`) without body identities, while trigger events (`onPhysicsTriggerBodies`) carry them. ignifx must route `onCollisionEnter/Stay/Exit` to entities. The preferred fix is an upstream API (`onPhysicsCollisionBodies`). If that is not available in time, the only alternative reads Havok's collision-event buffer through the world's internal handles at the same offsets Lite uses, which crosses the adapter boundary that ADR-0002 forbids.

## Decision (conditional)

If, by the end of week 1 of Phase 4, upstream support has not landed:

- The drain ships in `@ignifx/physics` behind `physics({ collisionIdentities: "internal" })` (default `"upstream"`, which delivers contacts with `other === null` until upstream lands).
- It lives in one file under `src/lite/internal/collision-drain.ts`, marked `@internal`, with a test that pins the pinned Lite version and fails if the buffer layout or the world's internal field names change.
- Trigger events remain the documented default mechanism for gameplay reactions in the skill until the flag is no longer needed.
- The waiver is removed (file deleted, ADR marked Superseded) in the first release after upstream support ships.

## Consequences

- A single, named, tested exception to the adapter boundary with an explicit kill switch and expiry, instead of an undocumented workaround.
- Users who enable the flag accept that a Lite upgrade may require the same ignifx release to update the drain.

## Validation — Phase 4 (2026-09-06)

Spike S4.2 checked the upstream path first and found it absent, so the condition above is met and
the waiver is **active**. The drain ships in `packages/physics/src/lite/internal/collision-drain.ts`.

### What the pinned version actually exposes

| Fact                                                                                                                               | Evidence                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| There is no `onPhysicsCollisionBodies`. `@babylonjs/lite@1.27.0` exports exactly one symbol whose name begins `onPhysicsCollision` | `index.d.ts` 7764; asserted in `packages/physics/test/lite/collision-drain.test.ts` ("confirms upstream still reports collisions without body identities") |
| `PhysicsCollisionInfo` carries `type`, `point`, `normal` and `impulse` and no body handles                                         | `index.d.ts` 8455                                                                                                                                          |
| Triggers _do_ carry both bodies, through `onPhysicsTriggerBodies` → `PhysicsTriggerBodyInfo`                                       | `index.d.ts` 7787, 8620                                                                                                                                    |
| Lite's own drain reads the event buffer at `offA = 2` / `offB = 18` and simply never reads the two body-id slots                   | `lib/physics/havok-collision.js:9-30`                                                                                                                      |

### The layout the drain reads

Over the address `HP_World_GetCollisionEvents(world)[1]` returns, walked with
`HP_World_GetNextCollisionEvent`:

| Slot            | Index           | Read by Lite? |
| --------------- | --------------- | ------------- |
| event type      | `int[0]`        | yes           |
| body A id       | `int[2]`        | **no**        |
| contact point   | `float[10..12]` | yes           |
| contact normal  | `float[13..15]` | yes           |
| body B id       | `int[18]`       | **no**        |
| applied impulse | `float[34]`     | yes           |

The two id slots are the ones Babylon.js's own `CollisionEvent.readToRef` reads, which is where the
offsets are corroborated. Ids are resolved to bodies with the same linear scan over `world._bodies`
that Lite's `findBodyById` performs (`lib/physics/havok-trigger.js`, `havok-queries.js`).

### The guard, and what breaks it

`probeCollisionLayout(world)` checks `_hknp`, `_hkWorld`, `_bodies`, the two `HP_World_*` functions,
and the `COLLISION_STARTED`/`COLLISION_CONTINUED` event-type values. `drainCollisionsWithBodies`
refuses with `IGX-0908` when the probe fails, so a Babylon Lite upgrade that moves any of them
breaks loudly rather than silently reporting no collisions. `packages/physics/test/lite/collision-drain.test.ts`
pins the installed version to `1.27.0`, drives two real bodies into contact and asserts that both
nodes come back, and asserts `IGX-0908` for a world that does not expose the internals.

### What the default mode does

`physics()` still defaults to `collisionIdentities: "upstream"`, as this ADR requires. In that mode a
collision event carries no identity at all, so ignifx delivers it — with `other === null` — to every
entity that opted into collision events, and the physics skill documents **trigger** events as the
mechanism for gameplay reactions. `09-physics.md` §4 said "`onCollision*` callbacks deliver contact
data with `other` set to `null`" without saying who receives them; that broadcast is the only
implementable reading, and it is why the flag exists.

## Superseded — 2026-10-15

Upstream support shipped, so this waiver is removed on its own terms: the drain file is deleted and
this ADR is marked Superseded.

`@babylonjs/lite` added body identities to `PhysicsCollisionInfo` in **1.29.0** (2026-09-14, Babylon
Lite pull request #647, "add Havok thin-instance bodies"); 1.28.0 still declares the four-field
interface. ignifx adopts it with the pin to 1.34.0. The upstream API kept its name: there is still
exactly one export beginning `onPhysicsCollision`, and no `onPhysicsCollisionBodies`.

| Fact in `@babylonjs/lite@1.34.0`                                                                                                                             | Evidence                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `onPhysicsCollision(world, cb)` is the one collision listener                                                                                                | `index.d.ts` 9315                                                            |
| `PhysicsCollisionInfo` carries `collider`, `colliderIndex`, `collidedAgainst`, `collidedAgainstIndex`, plus `type`, `point`, `normal`, `impulse`, `distance` | `index.d.ts` 10030-10049                                                     |
| The indices are thin-instance indices, `0` for an ordinary body                                                                                              | `index.d.ts` 10034, 10038                                                    |
| Lite resolves both native ids through a body map, and skips an event whose bodies it no longer tracks                                                        | `lib/physics/havok-collision.js:47-52, 68-72`; `lib/physics/havok-events.js` |

What changed in `@ignifx/physics`:

- The adapter's `onCollisionEvents` (`src/lite/havok.ts`) maps `collider.node` and
  `collidedAgainst.node` to entities through the same node-to-record map the trigger drain uses, and
  delivers each contact to both entities with `other` set. ignifx creates no thin-instance bodies, so
  it ignores the two indices.
- `src/lite/internal/collision-drain.ts` and its layout-guard test are deleted. The
  `physics({ collisionIdentities })` option and the `CollisionIdentityMode` type are removed, and the
  "broadcast to every listening entity with `other === null`" delivery is gone.
- `IGX-0908`, the drain's guard, is retired and not reused.
- `test/lite/collision-identities.test.ts` drives two real Havok bodies into contact through the public
  API and checks both bodies come back; `test/physics/events.test.ts` checks both entities receive
  `other` and that an entity outside the contact receives nothing.

# ADR-0013 · Waiver: adapter-internal Havok collision-event drain

**Status:** Superseded (2026-10-15: upstream Babylon Lite now reports both bodies of a collision, so the waiver is lifted; see [Superseded](#superseded--2026-10-15)) · **Date:** 2026-09-05 · **Waiver under:** `CONSTITUTION.md` §10.3, exception to §3.4 / ADR-0002

The sections above "Superseded" record the waiver as it stood while it was active (2026-09-06 to 2026-10-15).

## Context

`@babylonjs/lite@1.27.0` reported collision events (`onPhysicsCollision`) without body identities, while trigger events (`onPhysicsTriggerBodies`) carried them. ignifx must route `onCollisionEnter/Stay/Exit` to entities. The preferred fix was an upstream API. Without one, the only alternative read Havok's collision-event buffer through the world's internal handles at the same offsets Lite uses, which crosses the adapter boundary that ADR-0002 forbids.

## Decision (conditional)

If upstream support has not landed when collision events are implemented:

- The drain ships in `@ignifx/physics` behind `physics({ collisionIdentities: "internal" })` (default `"upstream"`, which delivers contacts with `other === null` until upstream lands).
- It lives in one file under `src/lite/internal/`, marked `@internal`, with a test that pins the pinned Lite version and fails if the buffer layout or the world's internal field names change.
- Trigger events remain the documented default mechanism for gameplay reactions in the skill until the flag is no longer needed.
- The waiver is removed (file deleted, ADR marked Superseded) in the first release after upstream support ships.

## Consequences

- A single, named, tested exception to the adapter boundary with an explicit kill switch and expiry, instead of an undocumented workaround.
- Users who enable the flag accept that a Lite upgrade may require the same ignifx release to update the drain.

## Validation

The upstream path was absent on 2026-09-06, so the condition was met and the waiver became active. The drain read the two body-id slots of Havok's collision-event record, which Lite's own drain skipped, and resolved them to bodies the way Lite resolves trigger bodies. A layout probe guarded it and refused with `IGX-0908` when any internal it relied on had moved, so a Lite upgrade would break loudly rather than silently report no collisions.

## Superseded — 2026-10-15

Upstream support shipped, so this waiver is removed on its own terms: the drain file is deleted and this ADR is marked Superseded.

`@babylonjs/lite` added body identities to `PhysicsCollisionInfo` in 1.29.0, under the existing `onPhysicsCollision` listener: `collider` and `collidedAgainst`, each with a thin-instance index that is `0` for an ordinary body. Lite skips an event whose bodies it no longer tracks.

What changed in `@ignifx/physics`:

- The adapter's `onCollisionEvents` (`src/lite/havok.ts`) maps `collider.node` and `collidedAgainst.node` to entities through the same node-to-record map the trigger drain uses, and delivers each contact to both entities with `other` set. ignifx creates no thin-instance bodies, so it ignores the two indices.
- The drain and its layout-guard test are deleted. The `physics({ collisionIdentities })` option and the `CollisionIdentityMode` type are removed, and the "broadcast to every listening entity with `other === null`" delivery is gone.
- `IGX-0908`, the drain's guard, is retired and not reused.
- `test/lite/collision-identities.test.ts` drives two real Havok bodies into contact through the public API and checks both bodies come back; `test/physics/events.test.ts` checks both entities receive `other` and that an entity outside the contact receives nothing.

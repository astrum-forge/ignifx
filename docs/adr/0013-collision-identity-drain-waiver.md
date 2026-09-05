# ADR-0013 · Waiver: adapter-internal Havok collision-event drain

**Status:** Proposed (activates only if the upstream path in ADR-0003 fails by the Phase 4 decision point) · **Date:** 2026-09-05 · **Waiver under:** `CONSTITUTION.md` §10.3, exception to §3.4 / ADR-0002

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

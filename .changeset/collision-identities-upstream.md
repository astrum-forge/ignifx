---
"@ignifx/physics": minor
"ignifx": minor
---

### Breaking

- `onCollisionEnter`, `onCollisionStay` and `onCollisionExit` now reach only the two entities in a contact, and each receives the other as `collision.other`.
- Remove the `collisionIdentities` option of `physics()` and the `CollisionIdentityMode` type and `COLLISION_IDENTITY_MODES` constant. Delete the option from your `physics({ ... })` call; identities are always on.
- Remove `PhysicsErrorCode.internalDrainUnavailable` (`IGX-0908`), which nothing can throw any more.

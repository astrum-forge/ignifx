---
"@ignifx/physics": minor
"ignifx": minor
---

Phase 4: 3D physics on Havok through Babylon Lite.

`@ignifx/physics` simulates rigid bodies on its own null-engine scene, stepped by ignifx's fixed
loop (ADR-0003), so the simulation advances at a fixed rate regardless of frame rate, is
deterministic on one platform and build, and runs headless with no GPU.

- `physics()` extension: the `physics` settings section, the `physicsmaterial` asset loader, the
  `09xx` diagnostic codes, the `physics` diagnostics group, and three systems — restore poses at
  `FixedUpdate -100`, step and dispatch at `FixedUpdate 100`, interpolate at `PreRender -500`.
- `Rigidbody` with dynamic, kinematic, and static bodies, forces, impulses, velocities, teleports,
  frozen rotation axes, and `collisionEvents` auto-detected from the scripts on the entity.
- `BoxCollider`, `SphereCollider`, `CapsuleCollider`, `CylinderCollider`, `MeshCollider`, and
  `HeightfieldCollider`; several on one entity form one compound body, and a collider-only entity
  gets an implicit static body with the `IGX-0901` moved-static diagnostic.
- `CharacterController`: a kinematic capsule with collide-and-slide, support classification, skin
  width, crouching, and dynamic-body pushing.
- Trigger and collision callbacks delivered to both entities through the kernel's script-callback
  hook, with pooled event objects. Collision identities need
  `physics({ collisionIdentities: "internal" })` until Babylon Lite reports them upstream (ADR-0013).
- `app.physics`: `raycast`, `shapeCast`, `overlap`, `distanceToNearest`, world gravity, and the
  wireframe debug viewer.
- Collision layers and the project collision matrix, mapped onto Havok's 32-bit filters.
- `PhysicsMaterial` and the `ignifx.physicsmaterial` file format.

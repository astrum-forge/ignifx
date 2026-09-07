# @ignifx/physics

## 0.1.0

### Minor Changes

- 8947b19: Phase 4: 3D physics on Havok through Babylon Lite.
  
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

### Patch Changes

- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [7ca9efe]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0

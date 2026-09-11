# @ignifx/physics

## 0.2.2

### Patch Changes

- Updated dependencies [be82465]
  - @ignifx/core@0.2.2

## 0.2.1

### Patch Changes

- 6a39fae: The interpolated display pose is written before `update`, so camera rigs and scripts see the pose the frame draws
  
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
- 6a39fae: `shapeCast` can sweep past one body, and the third-person boom and step probe no longer report the character's own capsule
  
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
- Updated dependencies [388b0f6]
  - @ignifx/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0

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

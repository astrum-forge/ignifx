# @ignifx/physics-2d

## 0.10.0

### Minor Changes

- 0d32a0c: `TilemapCollider2D` reads the `Tilemap` on its own entity, so a scene file that holds both components has tile collision with no code after `loadScene`, and tile edits reach physics at the next fixed step. Assign `collisionData` only to use other geometry; assigning `null` goes back to the tilemap.

### Patch Changes

- 6d46060: In an edit-mode app, physics does not step or interpolate, so bodies stay where they were authored and a transform the editor moves is not overwritten.
- Updated dependencies [5de1886]
- Updated dependencies [6f197c9]
- Updated dependencies [1804a62]
- Updated dependencies [e0276f8]
- Updated dependencies [4c6e200]
- Updated dependencies [324ce73]
- Updated dependencies [f5dac24]
- Updated dependencies [37cf52e]
- Updated dependencies [612ba87]
- Updated dependencies [159ea03]
- Updated dependencies [b0480a0]
- Updated dependencies [1fba2ea]
- Updated dependencies [df7b73f]
- Updated dependencies [dc768d6]
- Updated dependencies [738f68d]
- Updated dependencies [254b63c]
- Updated dependencies [fd0afe5]
- Updated dependencies [3a8e47b]
- Updated dependencies [3c02fb1]
- Updated dependencies [63d4e86]
  - @ignifx/2d@0.10.0
  - @ignifx/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [2c61694]
  - @ignifx/core@0.9.0
  - @ignifx/2d@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [874d49b]
  - @ignifx/core@0.8.0
  - @ignifx/2d@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [2ea5e9e]
- Updated dependencies [a837a3e]
- Updated dependencies [f0f3f4f]
  - @ignifx/core@0.7.0
  - @ignifx/2d@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [d843b2e]
  - @ignifx/core@0.6.1
  - @ignifx/2d@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [3a8b165]
- Updated dependencies [41450fb]
- Updated dependencies [e198c1c]
- Updated dependencies [96cdf34]
- Updated dependencies [946e837]
- Updated dependencies [09ef95f]
  - @ignifx/core@0.6.0
  - @ignifx/2d@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [d617f2c]
- Updated dependencies [6175ff5]
- Updated dependencies [ee4f87b]
  - @ignifx/core@0.5.0
  - @ignifx/2d@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [097d60b]
- Updated dependencies [1f45e2f]
  - @ignifx/core@0.4.0
  - @ignifx/2d@0.4.0

## 0.3.1

### Patch Changes

- @ignifx/2d@0.3.1
  - @ignifx/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [be82465]
- Updated dependencies [6e1eed7]
- Updated dependencies [6e1eed7]
  - @ignifx/core@0.3.0
  - @ignifx/2d@0.3.0

## 0.2.1

### Patch Changes

- 6a39fae: A `CharacterController2D` walks through triggers instead of bouncing off them, and the display pose is written before `update` so follow cameras stop juddering
  
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
- Updated dependencies [388b0f6]
  - @ignifx/core@0.2.1
  - @ignifx/2d@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0
  - @ignifx/2d@0.2.0

## 0.1.0

### Minor Changes

- 5bf13be: API review: the capsule-direction names take the package's trailing-`2D` convention
  
  **Breaking.** `Capsule2DDirection` is renamed to `CapsuleDirection2D` and `CAPSULE_2D_DIRECTIONS` to
  `CAPSULE_DIRECTIONS_2D`. Every other component-level 2D name in the package puts `2D` last
  (`BodyType2D`/`BODY_TYPES_2D`, `InterpolationMode2D`/`INTERPOLATION_MODES_2D`,
  `CollisionEventMode2D`/`COLLISION_EVENT_MODES_2D`); these two inserted it mid-name. The values are
  unchanged.
- a0625fb: Implement Phase 6 2D physics on Rapier 2D (ADR-0006, `docs/architecture/11-2d-toolkit.md` §8).
  
  `physics2d()` registers `app.physics2d`, the `physics2d` settings section, the `ignifx.physicsmaterial` loader, the `IGX-11xx` diagnostics, and the three systems that put 2D physics in the frame — restore poses at `FixedUpdate −100`, step Rapier and dispatch events at `FixedUpdate 100`, interpolate at `PreRender −500`.
  
  - **Components:** `Rigidbody2D` (dynamic/kinematic/static, exact `mass`, gravity scale, per-body damping, frozen rotation, forces, impulses, torque, teleport), `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `PolygonCollider2D`, `EdgeCollider2D`, `TilemapCollider2D`, and `CharacterController2D` with slopes, autostep, snap-to-ground, and one-way platforms.
  - **Events:** `onCollisionEnter`/`Stay`/`Exit` and `onTriggerEnter`/`Exit` — the 3D callback names, carrying pooled `Collision2D` / `TriggerEvent2D` payloads. Rapier reports both colliders, so both identities are always present and no ADR-0013-style waiver is needed.
  - **Queries:** `raycast`, `raycastAll`, `overlapCircle`, `overlapBox`, and `shapeCast`, all shape-accurate and all reporting the exact collider they hit.
  - **Layers:** the project collision matrix maps onto Rapier's interaction groups. Rapier's groups are 16 bits wide, so only the first sixteen layers filter; a collider above them reports `IGX-1152` and falls back to layer 0.
  - **Determinism:** a committed baseline hash over 600 fixed steps, reproduced across apps and across processes. `@dimforge/rapier2d-compat` is Rapier's main build, which guarantees local determinism only.

### Patch Changes

- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [d349254]
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [7ca9efe]
- Updated dependencies [7ca9efe]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [a0625fb]
- Updated dependencies [1d18250]
  - @ignifx/2d@0.1.0
  - @ignifx/core@0.1.0

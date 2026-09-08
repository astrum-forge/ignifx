# @ignifx/3d

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0
  - @ignifx/input@0.2.0
  - @ignifx/physics@0.2.0

## 0.1.0

### Minor Changes

- 5bf13be: API review: one options type for `play`, not two
  
  **Breaking.** `PlayStateOptions` is removed. It was a field-for-field copy of `AnimatorPlayOptions`
  — `Animator.play` forwards its options object into `AnimatorStateMachine.play` unchanged — so the
  two methods now take one type, `AnimatorPlayOptions`, declared alongside the state machine.
- d349254: Phase 7: the 3D toolkit
  
  `@ignifx/3d` ships the subsystem `docs/architecture/12-3d-toolkit.md` describes, minus the sections it marks Phase 7b. Registering `threeD()` gives a game `app.navigation`, twelve components, the `animator` asset type, the `threeD` settings section, and four systems: `Animator` in `PostUpdate` at order `10`, `Billboard` at `20`, `LodGroup` in `PreRender` at `-10`, and the navigation crowd in `FixedUpdate` at `200`, after physics.
  
  **Characters.** `ThirdPersonController` moves relative to the main camera's yaw on a `CharacterController`, with coyote time, jump buffering, air control, an optional `shapeCast` step probe, and configurable action names. `FirstPersonController` splits yaw onto the body and pitch onto a `cameraPivot` child, requests pointer lock on the first `pointerdown`, and crouches through `setHeight`. `RigidbodyMover` (with a `torqueSteering` mode), `PlatformMover` (a kinematic lift that carries its riders), and `Projectile` round out §1.3. The movement arithmetic — camera-relative direction, turn-towards, coyote and buffer timers, slope projection — is a pure module, so it is tested a frame at a time with no physics world.
  
  **Slope handling is not `supportState`.** Babylon Lite's character controller defaults `staticFriction` to `0` (`index.d.ts` 8310), so it reports *every* incline as `sliding` and `isGrounded` as `false`, at ten degrees as readily as at sixty. `ThirdPersonController.isGrounded` therefore classifies the ground itself, from the contact normal against `CharacterController.slopeLimit`, and cancels the down-slope creep the ground-stick bias would otherwise produce. A character stands still on a 30° ramp, walks up it, and slides down a 60° one.
  
  **`ThirdPersonCamera`** is an orbit rig in `lateUpdate` — after the `Animator` has posed the frame — with damping, a shoulder offset, and a `shapeCast` boom that pulls in instantly and eases back out.
  
  **`Animator`** runs an `ignifx.animator` document (`.animator.json`): parameters (`float`/`int`/`bool`/`trigger`), layers with bone masks and additive blending, states with clips or 1D blend trees, transitions with conditions, exit times, interruptibility and `from: "any"`, and animation events. The state machine is a **pure module** with no Babylon Lite in it, so transitions, exit times, trigger consumption, blend-tree thresholds and events are all verified headlessly; the Lite adapter applies its weights, speeds and playheads and advances a per-animator `AnimationManager` on ignifx's clock, so `timeScale` and `app.pause()` behave.
  
  **Navigation** bakes a navmesh from `MeshRenderer`s on a layer mask or from world-space geometry handed over directly, and runs Recast crowds on the fixed step. `NavMeshSurface`, `NavMeshAgent`, `NavMeshObstacle`, and `app.navigation.findPath`/`closestPoint`/`raycast`. **It runs headlessly**: Babylon Lite inlines the Recast WebAssembly as a `data:` URL, so a plain Node process bakes a mesh, routes a path around a wall, and walks an agent to its destination with no configuration at all — which is why the navigation suite is a node suite rather than a browser one. `docs/adr/0017-navigation-wasm.md` records the measurement, the cost (1.45 MiB raw / 441 KiB gzip / 190 KiB brotli, in a lazily imported chunk), and the Phase 12 follow-up.
  
  **`LodGroup`** and **`Billboard`** ship from §6; `DayNightCycle`, `SimpleWater`, `FogVolume`, `CameraBrain` and `VirtualCamera` remain Phase 7b.
  
  **Three Babylon Lite limitations, verified against 1.27.0, documented rather than worked around.** There is no navmesh serialization — no `getNavMeshData`, no `buildFromNavMeshData` — so `.navmesh.bin` and `ignifx bake navmesh` are not implementable and `NavMeshSurface.prebaked` warns and bakes at runtime. There is no `removeAgent`, so a destroyed agent parks rather than freeing its crowd slot. And `addAnimationGroup` binds a clip to one manager while a cloned skinned mesh shares the template's skeleton, so two `Model`s of one `.glb` cannot be animated independently; the second animator reports the refusal on `app.onError` rather than throwing mid-frame.
  
  New codes: `IGX-1201` through `IGX-1214`.

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
- Updated dependencies [d349254]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [4cfb15f]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [8947b19]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0
  - @ignifx/input@0.1.0
  - @ignifx/physics@0.1.0

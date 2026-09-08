# @ignifx/3d

## 0.2.1

### Patch Changes

- 7adf987: The look rigs re-arm pointer lock, ignore an unlocked mouse, and read a stick as a rate
  
  `FirstPersonController` and `ThirdPersonCamera` were each doing their own look arithmetic, and both
  were wrong in the same four ways. The look half of both now lives in one internal module and the
  four defects are fixed together.
  
  **Pointer lock re-arms.** `FirstPersonController` set a latch on its first request and never cleared
  it, so once the browser released the lock — Escape, which the templates also bind to the pause menu,
  or a focus change — no later click could take it back and the player finished the session with an
  unlocked mouse. The lock is now requested on **every** frame that carries a `pointerdown`
  while the lock is not held; the only guard is a request already in flight. A refusal is logged and
  dropped, exactly as before.
  
  **An unlocked mouse no longer turns the view.** While `lockPointerOnClick` is on and the lock is not
  held, a `Look` reading whose `InputAction.activeDevice` is `Mouse` or `Pointer` is ignored. Before,
  the view spun whenever the cursor crossed the canvas — on its way to a menu button, say — and stopped
  dead when the cursor left the frame. Gamepad, touch, and virtual sticks are never gated: they have no
  cursor to lose. `lockPointerOnClick: false` keeps unconditional mouse look for drag-to-look designs.
  
  **A stick is a rate, a pointer is a displacement.** Both rigs did `yaw += look.x * sensitivity` for
  every device. That is right for a pointer delta, which is this frame's motion, and wrong for a stick,
  whose value is a deflection: at 120 Hz the stick turned twice as fast as at 60 Hz, and games papered
  over it with a `scale(18)` processor. A gamepad or virtual reading is now multiplied by the new
  `stickLookSpeed` (degrees per second at full deflection, default 180) and the frame delta, so the
  same push turns through the same angle in the same second at any frame rate, and slow motion slows
  the look with everything else. `sensitivity` keeps its meaning for pointer readings — degrees per unit,
  which with `@ignifx/input`'s CSS-pixel deltas is degrees per CSS pixel, so 0.08–0.15 suits most mice
  on every display and at every render scale.
  
  **Up is up on every device.** A screen's `movementY` grows downward and a stick's `y` grows upward,
  and both rigs subtracted `look.y` from their pitch regardless — so one `invertY` could only ever suit
  one device family, and a first-person mouse looked *down* when it was pushed forward. The pitch axis
  is normalised where the device is known: `Mouse`, `Pointer`, and `Touch` readings are negated, gamepad
  and virtual are not, and the rigs apply their own sign and `invertY` on top as before. Moving the
  mouse forward and pushing a stick up now both look up in first person, and both lower the boom and
  aim the camera up in third person; `invertY` flips every device together.
  
  `ThirdPersonCamera` also gains `lockPointerOnClick`, defaulting to **`false`**: a rig that orbits on a
  held mouse button needs its cursor, so nothing changes for an existing third-person game until it
  opts in to the console-style "click to capture, Escape to release" behaviour.
  
  Public API change: `FirstPersonController.stickLookSpeed`, `ThirdPersonCamera.stickLookSpeed`, and
  `ThirdPersonCamera.lockPointerOnClick` are new schema fields. No field was removed or renamed. Two
  behaviour changes need a look from any game that ships a look binding: drop the `scale(...)`
  processors from stick look bindings, which double-count against `stickLookSpeed`, keeping the
  `deadzone(...)`; and drop any `scale(1, -1)` that existed to line a stick up with the mouse, because
  the rigs agree on which way is up now — reach for `invertY` instead.
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
- ef054ec: `ThirdPersonCamera` no longer rolls the horizon when the mouse moves sideways
  
  The rig built its rotation with one `Quat.fromEulerDegrees(pitch, yaw, 0)` call. That helper composes
  in intrinsic XYZ order, so the boom was pitched first and then yawed about the *tilted* axis: with
  any pitch at all — and the template starts twelve degrees down — a horizontal mouse motion tilted the
  camera rather than turning it, and the camera rose and fell as it went round (measured 2026-09-08:
  at 15 degrees of pitch its height followed `cos(yaw)`).
  
  The rotation is now `Ry(yaw) * Rx(pitch)`: yaw about the world's up, then pitch about the camera's
  own right, which is the one order in which looking sideways is a turn about the vertical. The
  starting angles are read off the entity's forward vector at `awake` instead of its Euler angles, so
  an authored downward tilt seeds the same pitch whatever Euler order wrote it.
  
  What a game author sees: a third-person camera whose horizon stays level and whose height stays put
  through a full orbit, at every pitch.
  
  Public API change: none.
- Updated dependencies [21a4ba7]
- Updated dependencies [6a39fae]
- Updated dependencies [388b0f6]
- Updated dependencies [6a39fae]
  - @ignifx/input@0.2.1
  - @ignifx/physics@0.2.1
  - @ignifx/core@0.2.1

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

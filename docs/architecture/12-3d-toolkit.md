# 12 · 3D Toolkit

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/3d` · **Related:** `07-rendering.md`, `09-physics.md`, `01-lifecycle-and-time.md` §3 · **Inspiration:** Unity `CharacterController`/Animator/Cinemachine, Godot `CharacterBody3D`/AnimationTree

Everything here is scripts and components built on core + physics; nothing in this package touches Babylon Lite except the `Animator` and `NavMesh` adapters (`src/lite/**`).

---

## 1. Characters

### 1.1 `ThirdPersonController` (script)

- Requires `CharacterController` (`09-physics.md` §2.3). Reads `move` (vector2), `jump`, `sprint` actions; moves relative to the camera's yaw; rotates the entity toward the movement direction with `turnSpeed`; applies gravity through `checkSupport`/`integrate`; jump with coyote time and jump buffering; slope handling from `supportState`; optional step probe using `shapeCast` (`stepHeight`).
- Exposed state for animation: `speed`, `isGrounded`, `verticalVelocity`, `isSprinting`.

### 1.2 `FirstPersonController` (script)

- Requires `CharacterController`. `look` action drives yaw on the entity and pitch on a child camera entity (`cameraPivot`), clamped; pointer lock requested on first click (`app.input.pointerLock`); head bob and FOV kick optional; crouch via `CharacterController.setHeight`.

### 1.3 `Rigidbody`-based movers

`RigidbodyMover` for physics-driven characters/vehicles (forces in `fixedUpdate`), `PlatformMover` (kinematic body that carries riders), `Projectile`.

## 2. Cameras

### 2.1 `ThirdPersonCamera` (script)

Orbit rig: `target` (entity ref), `distance`, `minPitch/maxPitch`, `sensitivity`, `damping`, `shoulderOffset`, `collision: { enabled, radius, layerMask }` (pulls the camera in with a `shapeCast` against the environment). Runs in `lateUpdate` so it sees animated targets.

### 2.2 `CameraBrain` and `VirtualCamera` (Phase 7b)

Cinemachine-style: `VirtualCamera` scripts declare `priority`, `follow`, `lookAt`, and body/aim behaviours (`Transposer`, `Orbital`, `Composer`); `CameraBrain` on the `Camera` entity picks the highest-priority enabled vcam and blends (cut, ease-in-out, custom curve) between them. `CameraShake` adds impulse noise.

## 3. `Animator`

Runs skeletal/morph animation for `Model` instances on ignifx's clock.

- **Asset** `.animator.json` (`ignifx.animator`): `parameters` (`float | int | bool | trigger`), `layers` (`{ name, weight, mask: bone names, additive }`), `states` (`{ name, clip, speed, loop, events: [{ time, name }] }`), `transitions` (`{ from | "any", to, conditions: [{ param, op, value }], duration, exitTime?, interruptible }`), `blendTrees1D` (`{ param, children: [{ clip, threshold }] }`).
- **Component**: `animator: asset(AnimatorAsset)`, `updateWhenPaused`, `speed`. Methods: `setFloat/setInt/setBool/setTrigger`, `play(state, { layer, transitionSeconds })`, `crossFade`, `currentState(layer)`, `normalizedTime`, `onStateEntered/Exited: Signal`, `onEvent: Signal<string>`.
- **Adapter:** one Lite `AnimationManager` per `Animator` (`createAnimationManager()`, `enableAnimationBlending`, `addAnimationGroup` for the instance's groups); each frame in `PostUpdate` the state machine computes target weights and calls `setAnimationWeight` / `fadeAnimationWeight` / `crossFadeAnimationGroups`, sets `speedRatio`, and advances with `updateAnimationManager(manager, dt·1000)`. Masks map to `createAnimationGroupMask` (include/exclude by bone name); additive layers to `setAnimationAdditive`.
- **Events** are evaluated by ignifx from `currentTime` (Lite has no animation events); each event fires once per loop crossing.
- **Root motion** and 2D blend spaces are post-1.0 (Lite exposes no root-motion extraction; ignifx would need to read the root bone delta).
- `Animator` can also drive a `SpriteAnimator` state machine in 2D projects (same asset, `clip` refers to sprite clips) so 2D and 3D share one state-machine vocabulary.

## 4. Tweening

`app.tweens.to(target, props, { duration, ease, delay, loop, yoyo, onComplete })` (core, used by both toolkits), advanced in `PostUpdate`; targets are any object with numeric fields, `Vec3`/`Quat`-aware. Property animation for materials/cameras uses the same API; Lite's `createPropertyAnimationClip` is reserved for baked clips.

## 5. Navigation

- `NavMeshSurface` component: bakes a navmesh from static meshes matching a layer mask (`createNavigationPluginAsync` (Recast WASM), `createNavMesh(plugin, meshes, params)`), or loads a pre-baked navmesh asset (`.navmesh.bin`, produced by `ignifx bake navmesh`). Obstacles via `NavMeshObstacle` when the surface has `maxObstacles > 0` (tile cache).
- `NavMeshAgent` component: `speed`, `acceleration`, `radius`, `height`, `stoppingDistance`; `setDestination(point)`, `remainingDistance`, `velocity`, `isStopped`, `onArrived`. Agents belong to one crowd (`createNavCrowd`), updated with `updateNavCrowd(crowd, dt)` in `FixedUpdate` for determinism; agent positions are written to transforms after the update.
- Path queries: `app.navigation.findPath(from, to)`, `raycast`, `closestPoint`.

## 6. Environment helpers

`DayNightCycle` (drives a directional light and environment rotation), `LodGroup` (distance-based `MeshRenderer` switching; Lite has no automatic LOD), `Billboard` (faces camera; or uses Lite billboard sprite systems for particles), `SimpleWater`, `FogVolume` — Phase 7b/8 items, listed so the package boundary is clear.

## 7. Templates

- **3d-third-person:** `ThirdPersonController` + `ThirdPersonCamera` + `Animator` (idle/walk/run/jump blend tree) + navmesh-driven companion + physics props.
- **3d-first-person:** `FirstPersonController` + weapon attachment through `Model.attachToNode` + raycast interaction + `AudioListener` on camera.

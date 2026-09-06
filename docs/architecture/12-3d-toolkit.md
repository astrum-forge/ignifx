# 12 · 3D Toolkit

**Status:** Implemented in Phase 7, except where a section says otherwise (pre-1.0) · **Package:** `@ignifx/3d` · **Related:** `07-rendering.md`, `09-physics.md`, `01-lifecycle-and-time.md` §3, `docs/adr/0017-navigation-wasm.md` · **Inspiration:** Unity `CharacterController`/Animator/Cinemachine, Godot `CharacterBody3D`/AnimationTree

Everything here is scripts and components built on core + physics; nothing in this package touches Babylon Lite except the `Animator` and `NavMesh` adapters (`src/lite/**`).

---

## 1. Characters

### 1.1 `ThirdPersonController` (script)

- Requires `CharacterController` (`09-physics.md` §2.3). Reads `Move` (vector2), `Jump`, `Sprint` actions — the names are fields, so a project renames them without subclassing; moves relative to the camera's yaw; rotates the entity toward the movement direction with `turnSpeed`; integrates its own gravity and hands the result to `CharacterController.move`; jump with coyote time and jump buffering; slope handling; optional step probe using `app.physics.shapeCast` (`stepHeight`, `0` by default).
- Exposed state for animation: `speed`, `isGrounded`, `verticalVelocity`, `isSprinting`, `moveDirection`.
- **Correction (Phase 7, measured).** Slope handling cannot come from `supportState` alone. Babylon Lite's character controller defaults `staticFriction` to `0` (`index.d.ts` 8310), so `checkSupport` classifies _every_ incline as `sliding` and `isGrounded` as `false` — at ten degrees as readily as at sixty, and regardless of `slopeLimit` (`@ignifx/physics`'s own character suite records the same measurement). `ThirdPersonController` therefore classifies the ground itself: a contact whose normal is within `CharacterController.slopeLimit` of vertical is walkable, and `ThirdPersonController.isGrounded` reports _that_, not Havok's flag. It also cancels the down-slope creep the ground-stick bias would otherwise produce on a frictionless incline, which is what lets a character stand still on a ramp.
- **Correction (Phase 7).** The `move` action is read where §1 says it is — in `fixedUpdate`, from the values input captured at frame start — but the _look_ half of §1.2 runs in `update`, because a mouse is sampled per frame and a look bound to the fixed step feels heavy.

### 1.2 `FirstPersonController` (script)

- Requires `CharacterController`. `Look` action drives yaw on the entity and pitch on a child camera entity (`cameraPivot`), clamped to ±89°; pointer lock requested on the first `pointerdown` of the frame (`app.input.pointerLock`), which is the gesture browsers accept as user activation; head bob and FOV kick optional and off by default; crouch via `CharacterController.setHeight(height, preserveFeet)`.

### 1.3 `Rigidbody`-based movers

`RigidbodyMover` for physics-driven characters/vehicles (forces in `fixedUpdate`, with a `torqueSteering` mode for vehicles), `PlatformMover` (kinematic body that carries riders), `Projectile`.

**Correction (Phase 7).** `PlatformMover` finds its riders with a short downward `app.physics.raycast` from each `CharacterController`'s feet, not through `CharacterController.onCollided`. The contact stream reports a character's _collisions_, and a character resting on a surface it never pushes into produces none — the probe is the only thing that sees a passenger standing still.

**Correction (Phase 7).** `Projectile` gives itself its muzzle velocity on its first `fixedUpdate`, not in `awake`: `Rigidbody` builds its Havok body inside the physics extension's own fixed pass, so a velocity written before the first step is written onto nothing.

## 2. Cameras

### 2.1 `ThirdPersonCamera` (script)

Orbit rig: `target` (entity ref), `distance`, `minPitch/maxPitch`, `sensitivity`, `damping`, `shoulderOffset`, and collision (pulls the camera in with a `shapeCast` against the environment). Runs in `lateUpdate` so it sees animated targets.

**Correction (Phase 7).** The collision fields are flat — `collisionEnabled`, `collisionRadius`, `collisionLayers`, `collisionRecoverySpeed` — rather than a nested `collision` record, because the schema's `layerMask` field kind stores layer _names_ and a nested record would make a scene file's override paths two levels deep for no gain. Pulling in is immediate and easing back out is damped: a camera that eased _into_ a wall would spend the ease inside it.

### 2.2 `CameraBrain` and `VirtualCamera` (Phase 7b — not implemented)

Cinemachine-style: `VirtualCamera` scripts declare `priority`, `follow`, `lookAt`, and body/aim behaviours (`Transposer`, `Orbital`, `Composer`); `CameraBrain` on the `Camera` entity picks the highest-priority enabled vcam and blends (cut, ease-in-out, custom curve) between them. `CameraShake` adds impulse noise.

## 3. `Animator`

Runs skeletal/morph animation for `Model` instances on ignifx's clock.

- **Asset** `.animator.json` (`ignifx.animator`): `parameters` (`float | int | bool | trigger`), `layers` (`{ name, weight, mask: bone names, additive }`), `states` (`{ name, clip, speed, loop, events: [{ time, name }] }`), `transitions` (`{ from | "any", to, conditions: [{ param, op, value }], duration, exitTime?, interruptible }`), `blendTrees1D` (`{ param, children: [{ clip, threshold }] }`).
- **Component**: `animator: asset(AnimatorAsset)`, `updateWhenPaused`, `speed`, `defaultLayer`, `applyOnAwake`. Methods: `setFloat/setInt/setBool/setTrigger`, `getFloat/getBool`, `play(state, { layer, transitionSeconds })`, `crossFade`, `currentState(layer)`, `normalizedTime(layer)`, `onStateEntered/Exited: Signal<string>`, `onEvent: Signal<string>`. The state machine itself is a separate, pure module (`AnimatorStateMachine`) that the component owns and that a game can drive directly.
- **Adapter:** one Lite `AnimationManager` per `Animator` (`createAnimationManager()`, `enableAnimationBlending`, `addAnimationGroup` for the instance's groups); each frame in `PostUpdate` the state machine computes target weights and calls `setAnimationWeight` / `fadeAnimationWeight` / `crossFadeAnimationGroups`, sets `speedRatio`, and advances with `updateAnimationManager(manager, dt·1000)`. Masks map to `createAnimationGroupMask` (include/exclude by bone name); additive layers to `setAnimationAdditive`.
- **Events** are evaluated by ignifx from the state machine's own cumulative cursor rather than from `AnimationGroup.currentTime` (Lite has no animation events); each event fires once per loop crossing, and a single large step that crosses three loops fires three times. `time` is a **fraction of the clip**, in `[0, 1]`, not seconds. Events do not fire while a state plays backwards.

**Corrections (Phase 7, measured against `@babylonjs/lite@1.27.0`).**

- `createAnimationManager()` must be given an `engine` (`index.d.ts` 439-444). Without it a skeletal clip throws _"AnimationController.tick requires an EngineContext for skeleton or morph animation"_ on the first tick, because uploading bone matrices needs the device. The option is documented as optional and is not.
- A glTF load marks **only the first clip** as started and every other one as internally stopped (`lib/animation/animation-group.js` 81), and a stopped group is skipped by both the weighted mixer and the plain tick (same file, 26). Setting `AnimationGroup.isPlaying` does **not** clear that flag; `playAnimation(group)` (`index.d.ts` 8923) does. Miss it and every clip but the first is silently never posed, with no error anywhere.
- `addAnimationGroup` binds a group to exactly one manager and throws when it already belongs to another (`lib/animation/animation-group-task.js` 21-26). `Model.animations` hands out the **asset's** groups, shared by every `Model` of that asset, and a cloned skinned mesh shares the template's skeleton (`lib/scene/transform-node.js` 38-53). Two `Model`s of one asset therefore cannot be animated independently: the second `Animator` to claim the clips is refused (reported on `app.onError`, not thrown mid-frame) and both instances would show one pose in any case. Independently animated instances need a per-instance clone of the container, which is a post-Phase-7 problem.
- ignifx writes `AnimationGroup.currentTime` from its own cursor each frame and then advances the manager by **zero** milliseconds; the tick is what re-evaluates and uploads the pose. That is what makes `app.pause()` freeze the rendered pose exactly rather than approximately.
- **Root motion** and 2D blend spaces are post-1.0 (Lite exposes no root-motion extraction; ignifx would need to read the root bone delta).
- `Animator` can also drive a `SpriteAnimator` state machine in 2D projects (same asset, `clip` refers to sprite clips) so 2D and 3D share one state-machine vocabulary. **Not implemented in Phase 7**: `AnimatorStateMachine` is already the toolkit-agnostic half — it emits clip names and weights and knows nothing about Babylon Lite — so the work is a `@ignifx/2d` adapter that maps those names onto `SpriteAnimator` clips, and it is left to whoever owns that package next.

## 4. Tweening

`app.tweens.to(target, props, { duration, ease, delay, loop, yoyo, updateWhenPaused, onComplete })` (core, used by both toolkits), advanced in `PostUpdate`; targets are any object with numeric fields, `Vec2`/`Vec3`/`Quat`-aware (quaternions slerp along the shortest arc). Property animation for materials/cameras uses the same API; Lite's `createPropertyAnimationClip` is reserved for baked clips.

**Detail settled in Phase 7.** The handle is a `Tween` with `pause`/`resume`/`stop`/`complete`, a `progress` in `[0, 1]`, and an `onComplete` signal alongside the callback; `stop` leaves the value where it stands and never completes, `complete` jumps to the end and fires. `loop` counts _extra_ cycles and `-1` repeats forever. Endpoints are latched when the delay elapses, not when the tween is created, so two tweens queued on one property chain rather than fight. Ordinary tweens are frozen by `app.pause()`; `updateWhenPaused` ones run on `time.unscaledDeltaTime`. The system registers at `PostUpdate` order `-100`, ahead of both toolkits' animation systems, so a tween driving an `Animator` parameter is read in the same frame it is written.

## 5. Navigation

- `NavMeshSurface` component: bakes a navmesh from static meshes matching a layer mask (`createNavigationPluginAsync` (Recast WASM), `createNavMesh(plugin, meshes, params)`), **or** from world-space geometry handed to it directly with `addSource(positions, indices, worldMatrix)` (`createNavMeshFromSources`) — which is the path a procedural level uses and the only one that works under a headless app. Obstacles via `NavMeshObstacle` when the surface has `maxObstacles > 0` (tile cache).

  **Correction (Phase 7).** Loading a pre-baked `.navmesh.bin` is **not implementable** against Babylon Lite 1.27.0: `index.d.ts` declares no `getNavMeshData`, no `buildFromNavMeshData`, and nothing else that turns a baked navmesh into bytes or back. `NavMeshSurface.prebaked` exists so a project can record the intent, but naming one logs a warning and the surface bakes at runtime instead, and `ignifx bake navmesh` stays a CLI stub. `docs/adr/0017-navigation-wasm.md` records the finding and what to re-check on the next Lite bump.

  Recast's parameters are exposed in metres where a game thinks in metres (`agentHeight`, `agentClimb`, `agentRadius`) and converted to the voxel counts Recast wants using `cellSize`/`cellHeight`.

- `NavMeshAgent` component: `speed`, `acceleration`, `radius`, `height`, `stoppingDistance`; `setDestination(point)`, `remainingDistance`, `velocity`, `isStopped`, `onArrived`. Agents belong to one crowd (`createNavCrowd`), updated with `updateNavCrowd(crowd, dt)` in `FixedUpdate` for determinism (Lite's own documentation gives determinism as the reason the crowd is manual, `index.d.ts` 2718-2721); agent positions are written to transforms after the update.

  **Corrections (Phase 7).** There is no `removeAgent` in Lite 1.27.0: `addAgent` hands out an index for the crowd's lifetime, so a destroyed agent is parked rather than freed and `maxAgents` counts every agent that has _ever_ joined. Re-baking the surface builds a fresh crowd. `remainingDistance` is the straight-line distance to the destination, not the length of the remaining corridor, because Recast's crowd exposes no corridor length — the same approximation Unity makes for a partial path. `stop()` is implemented as "go to where you already are", which is the only halt Recast offers.

- Path queries: `app.navigation.findPath(from, to)`, `raycast`, `closestPoint`. They run against the first **baked** surface in the world; `NavMeshSurface` carries the same three methods for a world with more than one navmesh. A query made before anything is baked answers with an empty path or `null` rather than throwing — a companion that stands still for a frame is a far better failure than a scene that does not load.

- **The Recast module loads lazily, from the copy Babylon Lite inlines as a `data:` URL.** Nothing is copied into `ignifx.assets.public` and nothing is served, which is why navigation runs in a plain Node process with no configuration and why the Phase 7 navigation suite is a _headless_ suite. `threeD({ navigationWasmUrl })` is the escape hatch. Costs and the Phase 12 follow-up are in `docs/adr/0017-navigation-wasm.md`.

## 6. Environment helpers

`LodGroup` (distance-based `MeshRenderer` switching with hysteresis, evaluated in `PreRender` against the highest-priority enabled camera; Lite has no automatic LOD) and `Billboard` (faces that camera, with a `yAxis` mode that stays upright; Lite's own billboard sprite systems remain the answer for particles) **shipped in Phase 7**.

`DayNightCycle` (drives a directional light and environment rotation), `SimpleWater`, and `FogVolume` are Phase 7b/8 items, listed so the package boundary is clear. **Not implemented.**

There is no notion of a "main camera" in `@ignifx/core` — `Camera.priority` orders render passes — so `@ignifx/3d` states the rule once, in `mainCamera(world)`: the enabled camera with the highest `priority`, and the first of those in component order when several tie. Every rig, billboard, and LOD group in the package reads it.

## 7. Templates

- **3d-third-person:** `ThirdPersonController` + `ThirdPersonCamera` + `Animator` (idle/walk/run/jump blend tree) + navmesh-driven companion + physics props.
- **3d-first-person:** `FirstPersonController` + weapon attachment through `Model.attachToNode` + raycast interaction + `AudioListener` on camera.

Both are built on the package rather than in it, by whoever owns `templates/**` next. `tests/fixtures/assets/3d/` already holds what they need: `rig.glb` (a four-joint skinned box-man with `idle`/`walk`/`run`/`jump` and a `hand` node) and `hero.animator.json`.

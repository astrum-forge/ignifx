# 12 · 3D Toolkit

**Status:** Implemented; describes the code on `main` · **Package:** `@ignifx/3d` · **Related:** `07-rendering.md`, `09-physics.md`, `01-lifecycle-and-time.md` §3, `docs/adr/0017-navigation-wasm.md` · **Inspiration:** Unity `CharacterController`/Animator/Cinemachine, Godot `CharacterBody3D`/AnimationTree

Everything here is scripts and components built on core + physics; nothing in this package touches Babylon Lite except the `Animator` and `NavMesh` adapters (`src/lite/**`). Babylon Lite names are those of the pinned version (`pnpm-workspace.yaml` catalog).

**Source map** (`packages/3d/src/`)

- `extension.ts` — `threeD()`: settings, the loaders, the navigation service and the systems.
- `character/` — `third-person-controller.ts`, `first-person-controller.ts`, `movers.ts` (`RigidbodyMover`, `PlatformMover`, `Projectile`), `look-input.ts` (the look rules both rigs share), `movement.ts` (slope and jump maths), `actions.ts`.
- `camera/` — `third-person-camera.ts`, `main-camera.ts` (`mainCamera(world)`).
- `animator/` — `state-machine.ts` (pure, no Lite), `animator.ts` (the component), `definition.ts` and `loader.ts` (`.animator.json`), `animation-system.ts` (`PostUpdate` 10).
- `navigation/` — the surface, agent and obstacle components, `navigation-service.ts` (`app.navigation`), `navigation-system.ts` (`FixedUpdate` 200).
- `environment/` — `lod-group.ts` (`PreRender` −10), `billboard.ts` (`PostUpdate` 20).
- `lite/` — the only files that import Babylon Lite: `gpu/animation-mixer.ts`, `navigation/plugin.ts`.
- Tweening is in core: `packages/core/src/tween/` (`PostUpdate` −100). Error codes `IGX-1201`–`IGX-1217` are in `errors.ts`.

Invariants to keep:

- Controllers classify the ground themselves; Havok's `supportState` reads `sliding` on every incline (§1.1).
- Movement is read in `fixedUpdate`; look is read per frame (§1.1). A stick is a rate and a pointer a displacement, and `+y` means up on every device (§1.2).
- A sweep that starts inside a body must pass `ignore` (camera boom, step probe) (§2.1).
- The camera's rotation is yaw about world up, then pitch about its own right; never one Euler call (§2.1).
- The animator writes `currentTime` from its own cursor and ticks Lite by zero milliseconds, so a pause freezes the pose exactly (§3).
- Every clip of a loaded model must be started with `playAnimation`, and a clip belongs to one `Animator` (§3).
- The crowd updates in `FixedUpdate`; a destroyed agent is parked, never freed (§5).
- "Main camera" means `mainCamera(world)` everywhere in the package (§6).

Not built: `CameraBrain`/`VirtualCamera`/`CameraShake`, an `Animator` driving a `SpriteAnimator`, root motion and 2D blend spaces, loading a pre-baked navmesh, independently animated instances of one model asset, and environment helpers beyond `LodGroup` and `Billboard`. Terrain and particles are separate packages (`@ignifx/terrain`, ADR-0026; `@ignifx/particles`, ADR-0025) with no architecture document of their own.

---

## 1. Characters

### 1.1 `ThirdPersonController` (script)

- Requires `CharacterController` (`09-physics.md` §2.3). Reads `Move` (vector2), `Jump`, `Sprint` actions — the names are fields, so a project renames them without subclassing; moves relative to the camera's yaw; rotates the entity toward the movement direction with `turnSpeed`; integrates its own gravity and hands the result to `CharacterController.move`; jump with coyote time and jump buffering; slope handling; optional step probe using `app.physics.shapeCast` (`stepHeight`, `0` by default), which passes `ignore: entity` so the sweep leaves the character's own capsule (§2.1).
- Exposed state for animation: `speed`, `isGrounded`, `verticalVelocity`, `isSprinting`, `moveDirection`.
- **Slope handling cannot come from `supportState` alone.** Babylon Lite's character controller defaults `staticFriction` to `0`, so `checkSupport` classifies _every_ incline as `sliding` and `isGrounded` as `false` — at ten degrees as readily as at sixty, and regardless of `slopeLimit` (`@ignifx/physics`'s own character suite records the same measurement). `ThirdPersonController` therefore classifies the ground itself: a contact whose normal is within `CharacterController.slopeLimit` of vertical is walkable, and `ThirdPersonController.isGrounded` reports _that_, not Havok's flag. It also cancels the down-slope creep the ground-stick bias would otherwise produce on a frictionless incline, which is what lets a character stand still on a ramp.
- **Move in the fixed step, look per frame.** The `move` action is read in `fixedUpdate`, from the values input captured at frame start. The _look_ half of §1.2 runs in `update`, because a mouse is sampled per frame and a look bound to the fixed step feels heavy.

### 1.2 `FirstPersonController` (script)

- Requires `CharacterController`. `Look` action drives yaw on the entity and pitch on a child camera entity (`cameraPivot`), clamped to ±89°; pointer lock requested on a `pointerdown` of the frame (`app.input.pointerLock`), which is the gesture browsers accept as user activation; head bob and FOV kick (`sprintFovKick`) optional and off by default; crouch via `CharacterController.setHeight(height, preserveFeet)`.

The look half of both rigs is one internal module, `src/character/look-input.ts`. Its rules:

1. **The lock request re-arms.** The request is issued on **every** frame that carries a `pointerdown` while `lockPointerOnClick` is on and the lock is not held; the only guard is the request already in flight. A one-shot latch would leave the player with an unlocked mouse after the browser released the lock (Escape, which is also the pause key, or a focus change). A refusal, including the `IGX-0809` a headless app rejects with, is logged and dropped.
2. **Unlocked mouse look is ignored.** With `lockPointerOnClick` on and the lock not held, a `Look` reading whose `InputAction.activeDevice` is `Mouse` or `Pointer` is discarded; otherwise a cursor crossing the canvas on its way to a menu button turns the view. Gamepad, touch, and virtual sticks are never gated: they have no cursor to lose. `lockPointerOnClick: false` keeps unconditional mouse look, which is what a drag-to-look design wants.
3. **A stick is a rate, a pointer is a displacement.** `sensitivity` is degrees per unit of **pointer** look — with CSS-pixel deltas (`08-input.md` §5) that is degrees per CSS pixel, DPR- and render-scale-independent, and 0.08–0.15 suits most mice. A gamepad or virtual stick reports a deflection, so it is multiplied by `stickLookSpeed` (degrees per second at full deflection, default 180) **and the frame delta**: `yaw += look.x * stickLookSpeed * dt`. Without the delta a stick turns twice as far at 120 Hz as at 60 Hz. The delta is the scaled one `update`/`lateUpdate` receive, so slow motion slows the look with everything else; a paused app stops calling `update` on the rigs altogether unless one declares `updateWhenPaused` (§7 of `01-lifecycle-and-time.md`).
4. **Up is up on every device.** The two device families disagree about which way `y` points — a screen's `movementY` grows downward, a stick's `y` grows upward — so one `invertY` could only ever suit one of them. `look-input.ts` negates the pitch axis for `Mouse`, `Pointer`, and `Touch` readings and leaves gamepad and virtual alone, so what it hands a rig always means "`+y` is up"; the rigs apply their own `-look.y` and `invertY` on top. Moving the mouse forward and pushing a stick up both look **up** in first person, which is the FPS convention; in third person both lower the boom and aim the camera up, and `invertY` gives the swing-up-and-over feel to a game that prefers it.

### 1.3 `Rigidbody`-based movers

`RigidbodyMover` for physics-driven characters/vehicles (forces in `fixedUpdate`, with a `torqueSteering` mode for vehicles), `PlatformMover` (kinematic body that carries riders), `Projectile`.

- `PlatformMover` finds its riders with a short downward `app.physics.raycast` from each `CharacterController`'s feet, not through `CharacterController.onCollided`. The contact stream reports a character's _collisions_, and a character resting on a surface it never pushes into produces none — the probe is the only thing that sees a passenger standing still.
- `Projectile` gives itself its muzzle velocity on its first `fixedUpdate`, not in `awake`: `Rigidbody` builds its Havok body inside the physics extension's own fixed pass, so a velocity written before the first step is written onto nothing.

## 2. Cameras

### 2.1 `ThirdPersonCamera` (script)

Orbit rig: `target` (entity ref), `distance`, `minPitch/maxPitch`, `sensitivity`, `damping`, `shoulderOffset`, and collision (pulls the camera in with a `shapeCast` against the environment). Runs in `lateUpdate` so it sees animated targets.

- **Orbit.** The rig's rotation is `Ry(yaw) * Rx(pitch)` — yaw about the world's up, then pitch about the camera's own right — built from two quaternions. A single `Quat.fromEulerDegrees(pitch, yaw, 0)` composes in intrinsic XYZ and yaws about the already-pitched axis, which rolls the horizon and moves the camera up and down as it orbits at any non-zero pitch. The starting yaw and pitch are read from the entity's forward vector at `awake`, not from `Transform.eulerAngles`.
- **The boom ignores its target.** The sweep passes `ignore: target` to `app.physics.shapeCast`: the shoulder pivot sits inside the character's capsule, Lite's sweep cannot be layer-filtered, and without it the capsule is reported at fraction zero for every yaw whose boom crosses it, collapsing the camera into the character's head (`09-physics.md` §5). `collisionLayers` decides which hit is _attributed_ an entity; any other body in the way still shortens the boom.
- **The collision fields are flat** — `collisionEnabled`, `collisionRadius`, `collisionLayers`, `collisionRecoverySpeed` — rather than a nested `collision` record, because the schema's `layerMask` field kind stores layer _names_ and a nested record would make a scene file's override paths two levels deep for no gain. Pulling in is immediate and easing back out is damped: a camera that eased _into_ a wall would spend the ease inside it.
- **Look input.** The rig shares `src/character/look-input.ts` with `FirstPersonController` and has the same two fields. `lockPointerOnClick` (**default `false`**) gives a third-person game the console-style "click to capture, Escape to release" behaviour the first-person controller has: while it is on, a `pointerdown` asks for the lock whenever it is not held, and mouse or unified-pointer look is ignored until it is granted. It defaults to `false` because a rig that orbits on a held mouse button needs the cursor. `stickLookSpeed` (degrees per second at full deflection, default 180) makes gamepad and virtual-stick orbit a rate rather than a per-frame displacement; `sensitivity` applies to pointer deltas, in degrees per CSS pixel.
- **Which way the mouse pitches the rig**, so a template can choose `invertY` deliberately: positive `pitch` **raises** the camera and aims it down at the target, and the look axis is normalised per device (§1.2, point 4), so moving the mouse forward and pushing a stick up both **lower** the boom and aim the camera up, while pulling back raises it and looks down over the target's shoulder. `invertY` flips every device together; a rig that should swing up and over on a forward push sets it.

## 3. `Animator`

Runs skeletal/morph animation for `Model` instances on ignifx's clock.

- **Asset** `.animator.json` (`ignifx.animator`): `parameters` (`float | int | bool | trigger`), `layers` (`{ name, weight, mask: bone names, additive }`), `states` (`{ name, clip, speed, loop, events: [{ time, name }] }`), `transitions` (`{ from | "any", to, conditions: [{ param, op, value }], duration, exitTime?, interruptible }`), `blendTrees1D` (`{ param, children: [{ clip, threshold }] }`).
- **Component**: `animator: asset(AnimatorAsset)`, `updateWhenPaused`, `speed`, `defaultLayer`, `applyOnAwake`. Methods: `setFloat/setInt/setBool/setTrigger`, `getFloat/getBool`, `play(state, { layer, transitionSeconds })`, `crossFade`, `currentState(layer)`, `normalizedTime(layer)`, `sample(state, normalizedTime, { parameters })` (a pose on demand without playing; ADR-0028, amendment of 2026-10-20), `onStateEntered/Exited: Signal<string>`, `onEvent: Signal<string>`. The state machine itself is a separate, pure module (`AnimatorStateMachine`) that the component owns and that a game can drive directly. It emits clip names and weights and knows nothing about Babylon Lite.
- **Adapter:** one Lite `AnimationManager` per `Animator` (`createAnimationManager()`, `enableAnimationBlending`, `addAnimationGroup` for the instance's groups); each frame in `PostUpdate` the state machine computes target weights and calls `setAnimationWeight` / `fadeAnimationWeight` / `crossFadeAnimationGroups`, sets `speedRatio`, and advances with `updateAnimationManager`. Masks map to `createAnimationGroupMask` (include/exclude by bone name); additive layers to `setAnimationAdditive`.
- **Events** are evaluated by ignifx from the state machine's own cumulative cursor rather than from `AnimationGroup.currentTime` (Lite has no animation events); each event fires once per loop crossing, and a single large step that crosses three loops fires three times. `time` is a **fraction of the clip**, in `[0, 1]`, not seconds. Events do not fire while a state plays backwards.

Babylon Lite behaviour the adapter depends on:

- `createAnimationManager()` must be given an `engine`. Without it a skeletal clip throws _"AnimationController.tick requires an EngineContext for skeleton or morph animation"_ on the first tick, because uploading bone matrices needs the device. The typings declare the option optional; it is not.
- A glTF load marks **only the first clip** as started and every other one as internally stopped (`lib/animation/animation-group.js`), and a stopped group is skipped by both the weighted mixer and the plain tick. Setting `AnimationGroup.isPlaying` does **not** clear that flag; `playAnimation(group)` does. Miss it and every clip but the first is silently never posed, with no error anywhere.
- `addAnimationGroup` binds a group to exactly one manager and throws when it already belongs to another (`lib/animation/animation-group-task.js`). `Model.animations` hands out the **asset's** groups, shared by every `Model` of that asset, and a cloned skinned mesh shares the template's skeleton (`lib/scene/transform-node.js`). Two `Model`s of one asset therefore cannot be animated independently: the second `Animator` to claim the clips is refused (reported on `app.onError`, not thrown mid-frame) and both instances would show one pose in any case. Independently animated instances would need a per-instance clone of the container.
- ignifx writes `AnimationGroup.currentTime` from its own cursor each frame and then advances the manager by **zero** milliseconds; the tick is what re-evaluates and uploads the pose. That is what makes `app.pause()` freeze the rendered pose exactly rather than approximately.
- Lite exposes no root-motion extraction, so there is no root motion; blend trees are one-dimensional.

## 4. Tweening

`app.tweens.to(target, props, { duration, ease, delay, loop, yoyo, updateWhenPaused, onComplete })` (core, used by both toolkits), advanced in `PostUpdate`; targets are any object with numeric fields, `Vec2`/`Vec3`/`Quat`-aware (quaternions slerp along the shortest arc). Property animation for materials/cameras uses the same API; Lite's `createPropertyAnimationClip` is reserved for baked clips.

The handle is a `Tween` with `pause`/`resume`/`stop`/`complete`, a `progress` in `[0, 1]`, and an `onComplete` signal alongside the callback; `stop` leaves the value where it stands and never completes, `complete` jumps to the end and fires. `loop` counts _extra_ cycles and `-1` repeats forever. Endpoints are latched when the delay elapses, not when the tween is created, so two tweens queued on one property chain rather than fight. Ordinary tweens are frozen by `app.pause()`; `updateWhenPaused` ones run on `time.unscaledDeltaTime`. The system registers at `PostUpdate` order `-100`, ahead of both toolkits' animation systems, so a tween driving an `Animator` parameter is read in the same frame it is written.

## 5. Navigation

- `NavMeshSurface` component: bakes a navmesh from static meshes matching a layer mask (`createNavigationPluginAsync` (Recast WASM), `createNavMesh(plugin, meshes, params)`), **or** from world-space geometry handed to it directly with `addSource(positions, indices, worldMatrix)` (`createNavMeshFromSources`) — which is the path a procedural level uses and the only one that works under a headless app. Obstacles via `NavMeshObstacle` when the surface has `maxObstacles > 0` (tile cache).

  **A pre-baked navmesh cannot be loaded.** Babylon Lite declares no `getNavMeshData`, no `buildFromNavMeshData`, and nothing else that turns a baked navmesh into bytes or back. `NavMeshSurface.prebaked` exists so a project can record the intent, but naming one logs a warning and the surface bakes at runtime instead. `docs/adr/0017-navigation-wasm.md` records the finding and what to re-check on a Lite bump.

  Recast's parameters are exposed in metres where a game thinks in metres (`agentHeight`, `agentClimb`, `agentRadius`) and converted to the voxel counts Recast wants using `cellSize`/`cellHeight`.

- `NavMeshAgent` component: `speed`, `acceleration`, `radius`, `height`, `stoppingDistance`; `setDestination(point)`, `remainingDistance`, `velocity`, `isStopped`, `onArrived`. Agents belong to one crowd (`createNavCrowd`), updated with `updateNavCrowd(crowd, dt)` in `FixedUpdate` for determinism (Lite's own documentation gives determinism as the reason the crowd is manual); agent positions are written to transforms after the update.

  Lite has no `removeAgent`: `addAgent` hands out an index for the crowd's lifetime, so a destroyed agent is parked rather than freed and `maxAgents` counts every agent that has _ever_ joined. Re-baking the surface builds a fresh crowd. `remainingDistance` is the straight-line distance to the destination, not the length of the remaining corridor, because Recast's crowd exposes no corridor length — the same approximation Unity makes for a partial path. `stop()` is implemented as "go to where you already are", which is the only halt Recast offers.

- Path queries: `app.navigation.findPath(from, to)`, `raycast`, `closestPoint`. They run against the first **baked** surface in the world; `NavMeshSurface` carries the same three methods for a world with more than one navmesh. A query made before anything is baked answers with an empty path or `null` rather than throwing — a companion that stands still for a frame is a far better failure than a scene that does not load.

- **The Recast module loads lazily, from the copy Babylon Lite inlines as a `data:` URL.** Nothing is copied into `ignifx.assets.public` and nothing is served, which is why navigation runs in a plain Node process with no configuration and why the navigation suite is a _headless_ suite. `threeD({ navigationWasmUrl })` is the escape hatch. Costs are in `docs/adr/0017-navigation-wasm.md`.

## 6. Environment helpers

`LodGroup`: distance-based `MeshRenderer` switching with hysteresis, evaluated in `PreRender` against the highest-priority enabled camera (Lite has no automatic LOD). In an edit-mode app it switches `MeshRenderer.displayHidden` instead of the saved `enabled`, and a renderer belongs to one group (`IGX-1217`, ADR-0028).

`Billboard`: faces that camera, with a `yAxis` mode that stays upright. Lite's own billboard sprite systems remain the answer for particles.

There is no notion of a "main camera" in `@ignifx/core` — `Camera.priority` orders render passes — so `@ignifx/3d` states the rule once, in `mainCamera(world)`: the enabled camera with the highest `priority`, and the first of those in component order when several tie. Every rig, billboard, and LOD group in the package reads it.

## 7. Templates

- **3d-third-person:** `ThirdPersonController` + `ThirdPersonCamera` + `Animator` (idle/walk/run blend tree and a jump state) + navmesh-driven companion + physics props.
- **3d-first-person:** `FirstPersonController` + weapon attachment through `Model.attachToNode` + raycast interaction + `AudioListener` on camera.

Both live in `templates/` and are built on the package rather than in it. `tests/fixtures/assets/3d/` holds the package's own test rig: `rig.glb` (a four-joint skinned box-man with `idle`/`walk`/`run`/`jump` and a `hand` node) and `hero.animator.json`.

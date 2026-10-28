# ADR-0028 · Edit mode: an app that shows a scene without playing it

**Status:** Proposed · **Date:** 2026-10-15 · **Deciders:** Astrum Forge Studios

## Context

The ignifx editor (repository `astrum-forge/ignifx-editor`, plan `docs/plan/2026-10-editor-plan.md` §3.5 and §5 ask E1) runs the project's own engine in its scene view. That view must show a scene without playing it: no game script may run, nothing may simulate, and the systems that turn component data into pixels, text, and sound must keep working. `CONSTITUTION.md` §1.3 allows an editor after 1.0 only if it builds on the runtime, so this belongs in the engine, not in an editor-side imitation.

`time.paused` is not that mode. Under `app.pause()` scripts still receive `awake`, `onEnable`, and `start`, coroutines still resume, and every system runs with a non-zero `dt` (`01-lifecycle-and-time.md` §7; the editor's spike S0.7, `docs/research/spikes/s0.7-edit-mode-inventory.md` §1.4, checked this with a probe). The editor plan forbids emulating edit mode with it.

The spike inventoried the frame (S0.7 §1–§5, engine commit `182343b`):

- Every script callback, from every call site, ends in `LifecycleQueue.invokeCallback`: the scheduler, `World.loadScene`'s synchronous flush, `destroyImmediate`, `unloadScene`, nested enables, `onApplicationPause`/`onApplicationFocus` from DOM events, physics callbacks through `ExtensionContext.dispatchScriptCallback`, and the hot-reload `"recreate"` teardown. Only `onAttach` and `onDetach` bypass it.
- There are 25 systems. Every `FixedUpdate` system is simulation. Two `Update` systems (physics interpolation, 3D and 2D) write a pose into the transform every frame and would fight an editor's gizmo.
- Physics bodies are built only inside a fixed step. `Animator` and `SpriteAnimator` have no way to show a pose without playing. `entity.isStatic` locks after the first lifecycle flush even for an entity with no script.

Constraints: correctness and determinism of games must not change (§2.1, §3.1, §3.2); a game must pay nothing measurable for a mode it does not use (§2.4, §2.5); third-party extensions must be able to declare the same things first-party ones do (§2.3, §8.1); misuse throws an actionable, coded error (§3.9); the behaviour is testable headlessly (§3.8, §6.1).

## Options considered

1. **The editor pauses the app and strips scripts from the scenes it loads.** No engine change. Breaks the round trip (the editor would save files without their scripts), cannot run the editor's own camera scripts, and leaves simulation systems running. Rejected; the plan forbids it.
2. **A per-system `if (app.isEditMode)` in each package.** Small at first. Every new system must remember it, third-party extensions have no contract to follow, and the rules spread across eleven packages. Rejected.
3. **One gate at the callback call site, the fixed loop switched off in the scheduler, and a per-registration declaration of what each system does in edit mode.** The kernel decides, extensions declare. Chosen.

## Decision

Option 3, as these rules.

**R1 · The switch.** `createApp({ editMode: true })` builds an edit-mode app. The default is `false`. It is fixed for the app's life; `app.isEditMode` reports it. (The plan calls it `app.editMode`; coding standards §5.1 name boolean queries `is…`, as `app.isHeadless` is.) Play mode is a separate app in a separate document (editor plan §3.6), so switching at run time is not needed.

**R2 · The callback gate.** In an edit-mode app, a script receives none of the fifteen `ScriptCallbacks` (`awake`, `onEnable`, `start`, `fixedUpdate`, `update`, `lateUpdate`, `onDisable`, `onDestroy`, `onCollisionEnter/Stay/Exit`, `onTriggerEnter/Exit`, `onApplicationPause`, `onApplicationFocus`) unless its class declares `static runInEditMode = true`. The check sits in `LifecycleQueue.invokeCallback`, so it covers every call site in the Context list, including `loadScene`, `destroyImmediate`, application events, physics callbacks, and hot reload. A script that may not be called is never filed in the per-callback dispatch lists either, so it costs no frame work and `diagnostics.frame.scriptsUpdated` counts only real calls.

`runInEditMode` is a static on `ScriptStatics`, resolved once per class into `ScriptClassInfo.runInEditMode`, exactly like `updateWhenPaused`. It is deliberately not declared on `Script`: a static on the base class would make every subclass write `static override runInEditMode = true` under `noImplicitOverride` (`03-scripting-and-components.md` §2).

**R3 · Opted-in scripts follow the game's rules.** A `runInEditMode` script gets `awake`, `onEnable`, `start`, `update`, `lateUpdate`, `onDisable`, `onDestroy`, and the application callbacks exactly when a game would deliver them. It gets no `fixedUpdate` and no physics callback, because nothing produces them (R6).

**R4 · Setup and teardown match.** A script whose class does not run in edit mode never receives `awake`, and so never receives `onDisable` or `onDestroy`. The answer is per class and cannot change during an instance's life (R8), so no instance is set up under one answer and torn down under the other.

**R5 · What is not gated.** Constructors and field initialisers (the loader must build a component to hold its data), `onAttach` and `onDetach`, property setters, signal handlers, and `static onHotReload` all run. `onAttach`/`onDetach` are component hooks, not lifecycle callbacks (`03-scripting-and-components.md` §1): engine components such as `ParticleSystem` and `SpriteAnimator` join their services there, and gating them for `Script` subclasses only would split one hook's contract by base class. A script must not do game work in them; that was already the documented contract.

**R6 · No fixed loop.** An edit-mode frame runs no fixed step: no `FixedUpdate` system, whatever it declares, no `fixedUpdate`, no physics step or callback, and no `waitFixedUpdate()` resume. The accumulator stays at `0`, so `time.fixedTime` and `time.fixedStepAlpha` stay `0`, `time.inFixedStep` stays `false`, and `diagnostics.frame.fixedSteps` stays `0`.

**R7 · Coroutines.** In an edit-mode app, `CoroutineHost.start` (and so `Script.startCoroutine`) throws `IGX-0111` when the owner's class does not run in edit mode, with a hint naming `static runInEditMode = true`. Such a script can only reach `startCoroutine` from a constructor, `onAttach`, or code the host calls, and the throw catches all three. Because no gated script can own a coroutine, the runner never resumes one for it. An opted-in script's coroutines run as in a game, except that `waitFixedUpdate()` never resumes (R6).

**R8 · Hot reload.** `app.hotReload.apply` works in edit mode; the editor applies script edits constantly. A `"recreate"` reload tears instances down and rebuilds them through the gated paths, so a gated class gets no callback. A `"patch"` reload whose replacement class changes `runInEditMode` is applied as `"recreate"` in an edit-mode app, so the old instance is torn down under the old answer and the new one is set up under the new answer (R4). Outside edit mode such a patch stays a patch. `static onHotReload` runs as in a game (R5).

**R9 · Systems declare what they do in edit mode.** `RegisterSystemOptions.editMode` is `"run"` (the default), `"hold"`, or `"skip"`:

- `"run"`: the system runs as in a game. Right for reconcilers that turn data into what is drawn, heard, or laid out; third-party reconcilers keep working with no change.
- `"hold"`: the system runs with `ctx.dt` set to `0` and the new `SystemContext.isClockHeld` set to `true`, so it shows its current state without advancing it. A system that reads `time` directly treats a held clock like `time.paused`.
- `"skip"`: the system does not run. Right for simulation and for systems that would overwrite authored data.

The scheduler resolves the value at registration; in an app that is not in edit mode every entry is `"run"`, so a game's frame takes the path it always took and pays one comparison per system. `onWorldCreated`, `onWorldDisposed`, and `dispose` are called for every system, skipped ones included.

The first-party systems, from the spike's inventory (S0.7 §2):

| System                                                  | Phase, order          | Edit mode        | Why                                                                                                   |
| ------------------------------------------------------- | --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `ignifx/asset-delivery`                                 | PreUpdate −900        | run              | Scene loads, hot swaps, and asset collection need it                                                  |
| `ignifx/tweens`                                         | PostUpdate −100       | run              | Only host or opted-in code can start a tween in edit mode                                             |
| `ignifx/shader-uniforms`                                | PreRender 890         | run (amended)    | Light uniforms stay live; the clock runs unless `animateMaterialsInEditMode` is off (M1–M2)           |
| `ignifx/render-sync`                                    | PreRender 900         | run              | The reconciler; picks the highest-priority camera, the editor's                                       |
| `ignifx/2d-animation`                                   | PostUpdate 0          | skip (on demand) | Clips and animated tiles do not play; `SpriteAnimator.sample` shows a frame                           |
| `ignifx/2d-sync`                                        | PreRender −450        | run              | The 2D reconciler                                                                                     |
| `ignifx/3d-animation`                                   | PostUpdate 10         | skip (on demand) | Animators do not play, even with `updateWhenPaused`; pose on demand is a follow-up (Consequences)     |
| `ignifx/3d-billboard`                                   | PostUpdate 20         | skip             | It overwrites the authored, serialised `transform.rotation` every frame                               |
| `ignifx/3d-lod`                                         | PreRender −10         | skip (amended)   | It writes the serialised `MeshRenderer.enabled`; every level shows as authored (2026-10-28)           |
| `ignifx/3d-navigation`                                  | FixedUpdate 200       | skip             | Simulation; `bakeOnAwake` does not bake. A preview bake is an explicit `NavMeshSurface.bake()`        |
| `ignifx/audio-pump`                                     | PreRender −400        | run              | Harmless: the sources are scripts (R2); fades and a host preview still work                           |
| `devtools-sample`                                       | PreRender 9000        | run              | Diagnostic; returns at once while the overlay is closed                                               |
| `input-resolve`                                         | PreUpdate −950        | run              | Opted-in tool scripts may read actions                                                                |
| `ignifx/particles-update`, `ignifx/particles-2d-update` | Update 900            | hold             | A system still starts and shows its first frame; its clock stands still. `simulate(seconds)` previews |
| `ignifx/particles-render`, `ignifx/particles-2d-write`  | PreRender 880, −460   | run              | They upload whatever state exists; no clock                                                           |
| `physics-restore`, `physics-step` (3D and 2D)           | FixedUpdate −100, 100 | skip             | Simulation; no fixed loop runs anyway (R6)                                                            |
| `physics-interpolate`, `physics2d-interpolate`          | Update −900           | skip             | It writes `lerp(prev, cur)` into the transform and would fight the gizmo                              |
| `physics-edit-sync`, `physics2d-edit-sync` (amendment)  | PreRender −800        | run (edit only)  | Registered only in an edit-mode app: builds and places bodies without stepping (P1)                   |
| `ignifx/terrain-lod`                                    | PreRender 10          | run              | A reconciler; also what makes sculpting visible                                                       |
| `ignifx/ui-sync`                                        | PreRender 1100        | run              | Text from scene files must show                                                                       |

**R10 · Time.** The frame clock runs as in a game: `deltaTime` and `unscaledDeltaTime` are the real frame delta, `time` and `unscaledTime` advance, `frameCount` counts frames, and `timeScale` and `maximumDeltaTime` apply. Opted-in scripts receive that real delta (an editor camera needs it to fly). Held systems receive `0`. The fixed-step values stay at zero (R6).

**R11 · `time.paused` and `app.step()` keep their meaning.** `app.pause()` and `app.resume()` work in edit mode and mean what they mean in a game: an opted-in script's `update` and `lateUpdate` are skipped unless its class sets `updateWhenPaused`, and `"run"` systems see `time.paused`. The fixed loop is off either way. `app.step(dt)` runs one edit-mode frame and keeps its `IGX-0105` rule. The editor never emulates edit mode with `pause()`.

**R12 · `isStatic` stays writable.** In a game, `entity.isStatic` may only change before the entity's first lifecycle flush. In an edit-mode app it can change at any time, because an inspector edits it on loaded entities.

**R13 · Audio needs nothing more.** `AudioSource`, `MusicPlayer`, and `AudioListener` are scripts, so R2 alone keeps an editor silent: nothing plays on awake and no listener registers. The pump runs (R9), so a preview the host starts with `AudioSource.play()` advances and fades. The remaining audio questions are listed below for the owner.

**R14 · Pose on demand.** `SpriteAnimator.sample(clip, frameIndex)` shows one frame of a clip without playing it and emits no signal; it works in any app. The 3D equivalent is not part of this decision (Consequences).

### The spike's open questions (S0.7 §6.4)

| #   | Question                                                      | Answer                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Do opted-in scripts get `fixedUpdate` and physics callbacks?  | Decided: no (R3, R6)                                                                                                                                                                                                                         |
| 2   | Are `onAttach`/`onDetach` of gated scripts gated?             | Decided: no (R5)                                                                                                                                                                                                                             |
| 3   | `static onHotReload`; a patch that flips `runInEditMode`      | Decided: `onHotReload` runs; a flip re-creates (R8)                                                                                                                                                                                          |
| 4   | Build physics bodies without stepping? Load the physics WASM? | **Decided 2026-10-20: yes, bodies without stepping; the WASM loads as in a game** (Amendment, P1–P6). Until then no body existed and a query threw `IGX-0902` (3D) or `IGX-1153` (2D)                                                        |
| 5   | The shape of pose on demand                                   | Decided for 2D (R14). **3D left to the owner** with a proposed signature (Consequences)                                                                                                                                                      |
| 6   | Audio preview and a listener on the editor camera             | **Left to the owner.** Options: let engine-owned audio scripts opt in to teardown only, so a host-started voice is released on destroy; or give `AudioService` a host-owned preview call. A spatial preview needs a listener the host places |
| 7   | Which engine-shipped scripts opt in                           | Decided: none in this change. No gameplay script may. `AudioListener` waits on question 6                                                                                                                                                    |
| 8   | Should the shader `time` uniform animate on request?          | **Decided 2026-10-20: yes, on by default** (Amendment, M1–M3). It was held (R9) until then                                                                                                                                                   |
| 9   | Do `app.pause()` and `updateWhenPaused` mean anything?        | Decided: yes, the game's meaning (R11)                                                                                                                                                                                                       |
| 10  | The error code for `startCoroutine`                           | Decided: `IGX-0111` (R7)                                                                                                                                                                                                                     |

## Consequences

- An editor can load a project's scenes into its own app and show them still: scripts are inert, physics and navigation are off, animators and billboards keep their authored state, and particles show their first frame. The editor's own camera scripts opt in with one static.
- Third-party extensions get the same contract: a reconciler needs no change; a simulation system adds `editMode: "skip"`; a clock-driven display system adds `editMode: "hold"` and treats `ctx.isClockHeld` like `time.paused`.
- A game pays one comparison per system per frame in the scheduler and one branch per callback in `invokeCallback`. Both flags are resolved at construction or registration; nothing is looked up per frame (§2.5).
- `SystemContext` gains a required `isClockHeld` field. Code that builds a `SystemContext` by hand, which only tests do, must add `isClockHeld: false`.
- ~~Physics queries do not work in edit mode (question 4).~~ Superseded by the amendment of 2026-10-20: bodies exist and queries work. Moves made in edit mode still never meet a stale body in play mode, because play mode is a new app that builds bodies from the saved scene on its first step. Moving a dynamic body _during_ play needs `Rigidbody.teleport`, which is the host's job.
- Follow-ups this decision does not implement:
  - **`Animator.sample`**, proposed as `sample(state: string, normalizedTime: number, options?: { layer?: string }): boolean`: put a layer in a state at a normalised time, write the pose with `mixer.tick(0)`, emit no signal, and return `false` until the document and the model's clips are bound. It needs a seek on `AnimatorStateMachine`, which is more than a small addition. Until then a skinned model shows its loaded rest pose.
  - **LOD writes authored data.** `LodSystem` switches `MeshRenderer.enabled`, a serialised field, so an editor that reads fields back would save camera-dependent values. _Done 2026-10-28 (editor audit defect B1): the system is `"skip"` and `LodGroup.onDetach` leaves the levels alone in an edit-mode app, so every level shows as authored. A display-only switch (S0.7 §5), which would bring distance switching back to the scene view, is still open._
  - **Static sprites sync once.** A `SpriteRenderer` on an `isStatic` entity is written once, so a gizmo move of a static sprite is not drawn. Edit mode should re-sync static sprites on transform change (S0.7 §5).
  - `WorldAnchor.element` is assigned by game code in `awake`, so anchored DOM is absent in edit mode. This is expected.
- Revisit if play-in-place (switching one app between modes) is ever wanted: R1, R4, and R8 assume the answer never changes for a live app.

## Amendment (2026-10-20): physics bodies without stepping, and an "animate materials" toggle

**Status:** Accepted by the owner on 2026-10-20 (editor tracker Q5b, part 1), answering open questions 4 and 8.

### Physics bodies exist, nothing steps

An editor needs the physics world for collider gizmos and for queries against the scene it edits (a drop raycast, an overlap test), so edit mode builds bodies but never simulates them.

- **P1 · Bodies follow the scene.** In an edit-mode app `@ignifx/physics` and `@ignifx/physics-2d` build, rebuild and remove bodies and colliders from component, layer and tile changes, exactly as a game's fixed step would, and place every body whose transform changed where the transform now is (a teleport, never a simulated move). Each extension registers one extra system for this, `physics-edit-sync` and `physics2d-edit-sync` (`PreRender`, order −800), **only in an edit-mode app**, so a game registers and pays nothing. The restore, step and interpolation systems stay `"skip"` (R9).
- **P2 · Nothing steps.** No fixed step runs (R6), so no body falls, no velocity integrates, no collision or trigger callback fires (an opted-in script gets none either, R3), no simulated pose is written to a transform, and the diagnostics report `stepsThisFrame = 0`. `app.physics.hasStepped` stays `false`.
- **P3 · Queries work from the first frame.** `raycast`, `shapeCast`, `overlap` and `distanceToNearest` (3D) and the 2D queries answer in an edit-mode app without a step: each query first brings the bodies in line with the world, so a query issued right after an editor's move sees it. Outside edit mode a query before the first step still throws `IGX-0902` / `IGX-1153`.
- **P4 · Broadphase, per backend.** Havok inserts a new body into its broadphase but does not move it there on a teleport until the next step (measured on Lite 1.34.0 / Havok 1.3.14: after `setPhysicsBodyTransform` a ray at the new place misses and one at the old place misses too). A moved 3D body is therefore removed and added again with the shapes it has; a changed lossy scale rebuilds the shapes. Rapier refreshes its broadphase only inside a step, so 2D runs the zero-length step a game already runs before its first real one (S6.2) after any change; with a zero timestep nothing moves, and the events it reports are dropped.
- **P5 · Collider gizmos.** `app.physics.colliderOutlines(entity)` and `app.physics2d.colliderOutlines(entity)` return each enabled collider's outline as world-space line segments with `isTrigger`. 3D outlines are built from the same fields, world pose and lossy scale the Havok shape is (a `MeshCollider` has none headless; a `HeightfieldCollider` outlines the box of its samples); 2D outlines are Rapier's own debug drawing of the colliders, tile collision included. `@ignifx/editor-host` serves them as `getColliderOutlines`. The 3D debug viewer now also follows bodies built, rebuilt or removed after it was switched on, so it draws an edit-mode scene correctly.
- **P6 · Play mode is unchanged.** A game app behaves exactly as before; the editor's play view is a separate app (R1).

### An "animate materials" toggle

- **M1 · The setting.** `app.renderer.animateMaterialsInEditMode: boolean`, `true` by default. In an edit-mode app it decides whether the shader clock (`time`, `unscaledTime`, `deltaTime` of shader materials and of custom post effects) runs. Outside edit mode it is ignored.
- **M2 · How it holds.** `ignifx/shader-uniforms` now registers as `"run"` (it was `"hold"`), because a registration cannot change and the toggle can; the system holds the clock itself while the toggle is off, exactly as `app.pause()` holds it, and resumes without a jump. The main-light and ambient uniforms stay live either way. In an edit-mode app custom post effects read the same accumulated clock as materials, so the two never drift apart when the clock is held and resumed (a game's post effects keep reading `app.time`).
- **M3 · The host.** `@ignifx/editor-host` sets it with `setAnimateMaterials { enabled }`. The host starts with it on, so an editor sends its own state after each `ready`.

The R9 table above shows both changes: the `ignifx/shader-uniforms` row and the edit-mode sync row.

## Amendment (2026-10-20): `Animator.sample`, the 3D pose on demand

**Status:** Accepted by the owner on 2026-10-20 (editor tracker Q5b, part 2), answering open question 5 for 3D and the `Animator.sample` follow-up under Consequences. The sections above are unchanged; where they say the 3D pose is left to the owner, this section is the answer.

An editor previews a character's pose at a chosen point of an animation state while the animator's clock is held (R9: `ignifx/3d-animation` is `"skip"`).

- **A1 · The call.** `Animator.sample(state: string, normalizedTime: number, options?: AnimatorSampleOptions): boolean`, with `AnimatorSampleOptions = { parameters?: Record<string, number | boolean> }`. It poses the entity's `Model` at once and synchronously (the mixer's playheads are written and the manager ticked by zero, as a frame's pose is), and returns `true` when the pose was written in full. It returns `false` while the animator document or the model's clips are still loading, when the model lacks a clip the state names or another `Animator` holds that clip (the rest of the pose is still written), and always under a headless app, which has nothing to pose; the arguments are checked either way once the document has loaded. The proposed `layer` option is dropped: a state belongs to one layer, and the pose is that state's.
- **A2 · What the pose is.** The sampled state replaces its own layer, at the layer's weight and with no crossfade; every clip of it has the sample's time as its playhead, and the layer's mask and additive setting still apply, because they live on the clips. Every other layer keeps contributing at the machine's current weights and times (a crossfade on another layer included). Lite resets every bone to its rest pose before it mixes, so dropping the other layers would show a masked upper-body state over legs in bind pose and an additive state as its delta on the bind pose.
- **A3 · Time.** `0` is the state's start and `1` its end. A time inside `[0, 1]` is used as given, so `1` shows a looping clip's last key rather than its first. Outside it a looping state wraps (`1.25` → `0.25`, `-0.25` → `0.75`) and a one-shot state clamps. `NaN` and `±Infinity` are refused (A6). The mixer's Lite groups do not loop (`loopAnimation = false`): the machine already wraps, and Lite 1.34 would wrap a playhead at the end (`(t - start) % duration`) to the first key, so a one-shot clip at `1`, sampled or finished in play, would show its first key instead of its last.
- **A4 · Blend trees.** A blend-tree state reads its parameter from `options.parameters` and otherwise from the animator's current value. The override is for that sample only: nothing is written into the machine. A `float` or `int` takes a number (an `int` is truncated), a `bool` a boolean; a trigger cannot be given.
- **A5 · Play mode: a pose-only override.** `sample` works in any app and changes only the pose: the state machine keeps its states, cursors, parameters and triggers, queues no event and no state change, and no `onEvent`, `onStateEntered` or `onStateExited` fires. In an edit-mode app nothing advances the animator, so the pose stays until the next `sample`. In a playing app it lasts until the animation system next advances that animator, which writes the machine's own pose again; called from `update` it is overwritten in the same frame's `PostUpdate`, so a game samples from `lateUpdate`, or while the app is paused or the animator disabled.
  - _Why not edit mode only._ Refusing in a playing app would add a mode check and buy no safety, since a sample changes nothing a game reads; and a held pose in a paused game or a debug view is a real use.
  - _Why not a seek._ The follow-up proposed putting the layer in the state at that time. A seek changes gameplay state: it enters and leaves states (whose signals a game's scripts act on), moves the cursors that exit times and events read, and drops a crossfade in flight. Honouring "emit no signal" would leave the queued state changes out of step with the machine. In edit mode a seek and a pose look the same, because nothing advances. A pose-only sample is a pure function of the document, the clip lengths, the state, the time and the parameters, so it is deterministic (`CONSTITUTION.md` §3.1), costs a game nothing unless called (§2.4), and needs no seek on `AnimatorStateMachine`, which removes the obstacle the follow-up named. A seek for gameplay (`play` at a time) remains a separate, later request.
- **A6 · Errors.** `IGX-1215` (new): the entity has no `Model`, its `Model` names no file, or the loaded file has no clips (not checked headless, where no file has clips). `IGX-1216` (new): `normalizedTime` or a parameter value is not a finite number; refused even before the document loads. `IGX-1202` for an undeclared state, `IGX-1203` for an undeclared parameter, `IGX-1204` for a value of the wrong kind or a trigger. Both new codes are in `ThreeDErrorCode` and `THREE_D_ERROR_MESSAGES`, registered by `threeD()`.
- **A7 · The headless half.** `AnimatorStateMachine.sample(state, normalizedTime, options?)` returns the pose as `ClipSample[]` (each a `ClipWeight` plus its `normalizedTime`) without changing the machine. The list is rebuilt in place on each call, and a sample without parameters allocates no map, so an editor scrubbing every frame makes little garbage. `Animator.sample` writes exactly that into the mixer, so the node suites test the pose there and the browser suite tests the frame.
- **A8 · The host.** `@ignifx/editor-host` answers `sampleAnimation { entity, state, normalizedTime, parameters? }` with `{ posed }`, additively within protocol 0.3 (an older host answers `methodNotFound`). It finds the `Animator` by its type id, `ignifx/Animator`, and calls `sample` by shape, so the host still depends on core only. An entity the open document lacks, one without an `Animator`, and any `IgnifxError` from `sample` are `invalidParams`, the last with the engine's code as `data.code`.

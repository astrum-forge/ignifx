# 09 · Physics (3D, Havok through Babylon Lite)

**Status:** Implemented; describes the code on `main` · **Package:** `@ignifx/physics` · **Related:** `01-lifecycle-and-time.md` §3, ADR-0003, ADR-0006 (2D backend), `11-2d-toolkit.md` §8

Babylon Lite names are those of the pinned version (`pnpm-workspace.yaml` catalog).

**Source map** (`packages/physics/src/`)

- `extension.ts` — `physics()`: declares the systems and the service in `register`, creates the simulation scene and the Havok world in `onStart`.
- `runtime/runtime.ts` — body, shape and controller records, event drain, body-bounds index; `runtime/systems.ts` — the four systems and their orders; `runtime/outline.ts` — collider outlines; `runtime/host.ts`, `runtime/runtime-key.ts` — how components reach the runtime.
- `components/` — `Rigidbody`, the colliders, `CharacterController`. `service.ts`, `queries.ts` — `app.physics`. `settings.ts`, `material.ts`, `events.ts`, `errors.ts` (`IGX-0901`–`IGX-0907`).
- `lite/` — the only files that import Babylon Lite: `havok.ts`, `havok-module.ts` (loading the binary), `queries.ts`, `character.ts`, `gpu/viewer.ts`.
- 2D physics is `packages/physics-2d/src/` (§10; `11-2d-toolkit.md` §8).

Invariants to keep:

- Havok steps only on the simulation scene, once per ignifx fixed step; nothing else may run Lite's physics callback (§1).
- System orders: `FixedUpdate` −100 restore and 100 step, `Update` −900 interpolate, `PreRender` −800 edit sync (§1, §11).
- The display pose never reaches Havok: dynamic bodies have prestep sync off and the restore system undoes it before `scripts.fixedUpdate` (§1).
- A body's entity is a root entity; a parented body reports `IGX-0907` (§2.1).
- Only rays report a body. `shapeCast` identity and `overlap` come from the bounds index and are bounds-accurate (§5).
- Events and query results are pooled or reused; valid only during the callback or until the next call (§4, §5).
- Records are kept in creation order, which fixes Havok's ordering; no wall-clock reads (§8).
- An edit-mode app keeps bodies and never steps them (§11).

Not built: colliders on child entities joining an ancestor's body, per-body damping, gravity factor, sleep control and per-body velocity limits (§2.1, §2.2).

---

## 1. Stepping model (ADR-0003)

Lite's `createHavokWorld(scene, hknp)` inserts its own callback at the front of `scene._beforeRender` and performs **one** `HP_World_Step` per rendered frame at the configured fixed step, with no accumulator and no way to unregister the callback through public API. ignifx needs an accumulator-driven fixed loop, so:

- The physics extension creates a **simulation scene** on a null engine at `onStart`: `simEngine = createNullEngine(); simScene = createSceneContext(simEngine, { defaultRenderTask: false }); world = createHavokWorld(simScene, hknp, gravity)`. Bodies reference plain `SceneNode`s, which are scene-agnostic, so the same nodes are rendered by the render scene and simulated by the simulation scene.
- Each fixed step, the step system calls `stepScene(simEngine, simScene, fixedDeltaTime * 1000)`, which sets the frame delta and runs `simScene._update()`: Lite's Havok callback performs pre-step node→body sync for `ANIMATED` bodies (and any body with prestep enabled), the Havok step, and body→node sync for `DYNAMIC` bodies. `setPhysicsTimestep(world, fixedDeltaTime)` keeps Lite's per-step delta equal to ignifx's (Lite clamps a step at 100 ms).
- The simulation scene never holds meshes or lights. Physics debug rendering (`createPhysicsViewer`) targets the render scene.
- Lite has no public `stepPhysicsWorld(world, dt)`. If a future version exposes one, the adapter switches to it with no API change for users (it is one of the upstream asks in `07-rendering.md` §8).

Per fixed step (see `01-lifecycle-and-time.md` §3, step 4):

```
Systems(FixedUpdate, order -100)  restore authoritative poses on interpolated bodies (undo the display pose written at the top of the previous Update)
scripts.fixedUpdate(dt)           forces, velocities, CharacterController.move() requests, kinematic node moves
Systems(FixedUpdate, order  100)  stepScene(simEngine, simScene, dt·1000); snapshot poses (prev ← cur, cur ← node)
event dispatch                    collisions and triggers drained by Lite's post-step hook → onCollision*/onTrigger* on scripts of both entities
```

Per frame in `Update` (order −900): for every `Rigidbody` with `interpolation: "interpolate"`, write `lerp(prev, cur, time.fixedStepAlpha)` into the node. Dynamic bodies have prestep sync disabled, so the display pose never leaks back into Havok.

The display pose is written at the **top of `Update`**, in `Systems(Update, order < 0)`, and not in `PreRender` (`01-lifecycle-and-time.md` §3). `fixedStepAlpha` is final as soon as the fixed loop ends, and everything after that point — `scripts.update`, animation, `lateUpdate` camera rigs, the render sync — has to read the same pose the frame presents. Written any later, a follow camera running in `lateUpdate` would frame the character at the last fixed step's pose while the renderer drew it interpolated, and the character would judder against the camera by up to a fixed step of motion every frame. `fixedUpdate` and Havok are unaffected: the restore system at `FixedUpdate −100` runs before `scripts.fixedUpdate`.

## 2. Components

### 2.1 `Rigidbody`

| Field                                                    | Default                     | Lite                                                                                                  |
| -------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bodyType`: `"dynamic"` \| `"kinematic"` \| `"static"`   | `"dynamic"`                 | `PhysicsMotionType.DYNAMIC` / `ANIMATED` / `STATIC` (`createPhysicsBody`, `setPhysicsBodyMotionType`) |
| `mass`                                                   | 1                           | `setPhysicsBodyMass` (0 for static)                                                                   |
| `startAsleep`                                            | false                       | `createPhysicsBody(..., startsAsleep)`                                                                |
| `freezeRotation`: `{ x, y, z }`                          | all false                   | `lockPhysicsBodyRotationAxes` / `unlockPhysicsBodyRotationAxes`                                       |
| `interpolation`: `"none"` \| `"interpolate"`             | `"interpolate"` for dynamic | ignifx (§1)                                                                                           |
| `collisionEvents`: `"auto"` \| `"on"` \| `"off"`         | `"auto"` (below)            | `setPhysicsBodyCollisionEventsEnabled`                                                                |
| `kinematicSync`: `"teleport"` \| `"velocity"`            | `"teleport"`                | `setPhysicsBodyPrestepType(TELEPORT/ACTION)`                                                          |
| `linearVelocity`, `angularVelocity` (runtime)            | —                           | `get/setPhysicsBodyLinearVelocity`, `get/setPhysicsBodyAngularVelocity`                               |
| `addForce(force, point?)`, `addImpulse(impulse, point?)` | —                           | `applyPhysicsBodyForce`, `applyPhysicsBodyImpulse`                                                    |
| `teleport(position, rotation)`                           | —                           | `setPhysicsBodyTransform`                                                                             |

`collisionEvents: "auto"` enables contact events when any script on the entity implements `onCollision*`; it is recomputed on every `addComponent`/`removeComponent` and pushed to Havok.

Not available in the pinned Babylon Lite and therefore absent from the schema (each needs an upstream API):
per-body linear/angular damping, per-body gravity factor, sleep thresholds, explicit `wakeUp()`, and
**per-body velocity limits** — `setPhysicsVelocityLimits` is per world, so the
clamps live in the `physics` settings section (§6) and there is no `Rigidbody.velocityLimits` field.

A body's entity must be a **root** entity. Lite's post-step sync writes `node.position` and
`node.rotationQuaternion`, which are the node's _local_ values (`lib/physics/havok.js`,
`_syncBodyToNode`), so a parented body would be simulated in its parent's space; the extension
reports `IGX-0907` and simulates it anyway rather than silently misplacing it. Gravity is per world (`setPhysicsGravity`; `app.physics.gravity`).

### 2.2 Colliders

`BoxCollider { size, center }`, `SphereCollider { radius, center }`, `CapsuleCollider { radius, height, center, direction }`, `CylinderCollider { radius, height, center }`, `MeshCollider { mesh?: asset(MeshAsset) | null (uses the entity's MeshRenderer/Model), convex: bool(false), includeChildren: bool(true) }`, `HeightfieldCollider { heights, samplesX, samplesZ, size }` (Lite's explicit sample-grid path; its `groundMesh` path reads `mesh._cpuPositions` and needs a GPU). Shared fields: `center`, `isTrigger`, `material: asset(PhysicsMaterial)`,
`inlineMaterial: { friction, staticFriction, restitution } | null`, and `layerOverride: string` (a
layer **name**; `""` means "use `entity.layer`"). A schema field has exactly one kind (ADR-0004), so
the asset-or-inline union is two fields: the asset wins, the inline record is the fallback, and
`physics.defaultMaterial` is the last resort.

- Lite mapping: `createPhysicsShape(world, { type: PhysicsShapeType.*, parameters })`, `setPhysicsShapeIsTrigger`, `setPhysicsShapeMaterial`, `setPhysicsShapeFilterMembershipMask`/`CollideMask`, `setPhysicsBodyShape`. Several colliders on one entity form a `CONTAINER` shape (`addPhysicsShapeChild`).
- An entity with colliders but no `Rigidbody` gets an implicit **static** body that is placed once and does not follow later transform changes; a development diagnostic (`IGX-0901`) fires if such an entity's `worldMatrixVersion` changes. Anything that moves needs a kinematic `Rigidbody`. Compound bodies are same-entity only: a collider on a child entity does not join an ancestor's `Rigidbody`.
- Shape sizes are authored in local units and scaled by the entity's lossy scale at creation; scale changes after creation require `collider.rebuild()`. A negative scale mirrors geometry, which Havok cannot represent, so the shape uses the magnitude.
- **`MeshCollider` needs a GPU app.** Lite documents mesh and convex-hull shapes as unsupported on the null engine (`index.d.ts`, `createNullEngine`), and a headless `MeshAsset` uploads no geometry, so a headless mesh collider reports `IGX-0906` instead of building an empty shape.

### 2.3 `CharacterController`

Wraps Lite's `PhysicsCharacterController` (kinematic capsule with collide-and-slide, support detection, and dynamic-body pushing).

```ts
class CharacterController extends Component.define({
  radius: f32(0.4),
  height: f32(1.8),
  center: vec3(),
  slopeLimit: f32(45), // degrees → maxSlopeCosine
  skinWidth: f32(0.05), // keepDistance
  pushStrength: f32(1), // characterStrength scale
  interpolation: enumOf(["none", "interpolate"] as const, "interpolate"),
}) {
  move(displacement: Vec3Like): void; // call in fixedUpdate; collide-and-slide (moveWithCollisions)
  setVelocity(v: Vec3Like): void;
  readonly velocity: Vec3;
  readonly isGrounded: boolean; // supportedState === SUPPORTED
  readonly supportState: "unsupported" | "sliding" | "supported";
  readonly groundNormal: Vec3;
  setHeight(height: number, preserveFeet?: boolean): void; // crouch (setShapeOptions)
  teleport(position: Vec3Like): void;
  readonly onCollided: Signal<CharacterCollision>; // dynamic bodies pushed (onTriggerCollisionObservable)
}
```

- The controller owns the entity's world position: after each step it writes `getPosition()` into the transform. Rotation stays user-controlled. With `interpolation: "interpolate"` (the default) the controller keeps the previous and current step positions and the `Update −900` system writes the interpolated position exactly as for `Rigidbody`, restoring the authoritative position at the start of each fixed step, so player characters do not judder above the fixed rate — and a camera rig in `lateUpdate` reads the same interpolated position the renderer draws.
- `pushStrength` **scales** Lite's `characterStrength`, whose default is `1e38` — effectively infinite — so `pushStrength: 1` means "Lite's default", not "one newton".
- `supportState` comes from a `checkSupport` probe the step system runs once per step with a **unit** gravity direction (handing Lite the full 9.81 m/s² vector makes the probe overshoot). Lite's `PhysicsCharacterController.staticFriction` defaults to `0`, so a bare controller pressed against _any_ incline keeps a residual down-slope velocity and the probe classifies it as `sliding`; `slopeLimit` still decides what the character can climb. The toolkit controllers add the friction and gravity handling that make `supportState` read the way Unity's does.
- Step offset (stairs) is not a Lite feature; the 3D toolkit's `ThirdPersonController` implements a step probe with `shapeCast` (`stepHeight`).
- Gravity is applied by the toolkit controllers through `checkSupport` + `integrate`, so a bare `CharacterController` is purely kinematic.

### 2.4 `PhysicsMaterial` asset

`{ "format": "ignifx.physicsmaterial", "friction": 0.6, "staticFriction": 0.6, "restitution": 0 }`.

## 3. Layers and the collision matrix

- The entity's `layer` becomes the shape's membership bit (`1 << layer`); the collide mask is the OR of layers the project's collision matrix allows for that layer (`ignifx.config.ts` → `physics.collisionMatrix`). Both are 32-bit, matching Havok's filters.
- Changing `entity.layer` at runtime updates the masks on the next fixed step.
- Raycasts and shape queries take a `LayerMask`.

## 4. Events

- **Triggers:** `onPhysicsTriggerBodies` gives `bodyA`/`bodyB`; the adapter resolves bodies to entities and delivers `onTriggerEnter`/`onTriggerExit` to scripts on both entities with `TriggerEvent { other: Entity | null, otherCollider, self }`. Lite reports no _shape_ identity, only a body, so `otherCollider` is the other entity's first collider.
- **Collisions:** `onPhysicsCollision` reports `type`, `point`, `normal`, `impulse` and both bodies, as `collider` and `collidedAgainst`. The adapter resolves them to entities through the same node map the trigger drain uses and delivers `onCollisionEnter/Stay/Exit` to scripts on both entities, each with the other as `other`. A contact reaches only its two entities. `other` is `null` only when the other body is not an entity's, such as a `CharacterController`'s capsule. ignifx creates no thin-instance bodies, so it ignores Lite's `colliderIndex`/`collidedAgainstIndex`. Triggers and collisions are both valid ways to react in gameplay.
- `Collision { other: Entity | null, otherCollider, self, contacts: [{ point, normal, impulse }], relativeVelocity }`. The `Collision`, its `contacts`, and the `TriggerEvent` are all pooled and only valid during the callback. `relativeVelocity` is `null` whenever `other` is.

## 5. Queries (`app.physics`)

```ts
raycast(origin, direction, maxDistance?, options?: { layerMask?, hitTriggers? }): RaycastHit | null  // physicsRaycast
shapeCast(shape, from, to, options?: { layerMask?, hitTriggers?, ignore? }): ShapeCastHit | null    // shapeCast
overlap(shape, position, rotation?, options?): readonly Entity[]                                    // bounds index
distanceToNearest(shape, position, maxDistance, options?): number                                   // shapeProximity
```

`shape` is a description — `{ kind: "sphere" | "box" | "capsule", … }` — that the service turns into
a temporary Havok shape for the call.

`RaycastHit { entity, collider, point, normal, distance, triangleIndex }`. Queries require at least
one completed step (Lite builds the broadphase on the first step); calling earlier throws
`IGX-0902`. An edit-mode app is the exception (§11).

**Identity is only available for rays.** Lite reports a body for `physicsRaycast` alone:
`ShapeCastResult` and `ShapeProximityResult` carry points and normals but no body, and
`shapeProximity`'s collector has capacity `1`, so it can never list more than one hit. So
`shapeCast` runs Lite's sweep for the geometry and resolves `entity` against the extension's own
body-bounds index, and `overlap` is answered entirely from that index — the entities whose world
bounding box the query shape's bounding box intersects. Both are bounds-accurate rather than
shape-accurate until an upstream API lands, and `overlap` returns a **reused** array.

**Character capsules are query targets.** A `CharacterController`'s capsule is a Havok body on a node Lite creates for it, kept in the runtime's controller records rather than its body records. Every query resolves it to the character's entity with `collider: null`, and the bounds index holds an entry for it that follows the capsule's last-step centre, `setHeight`, rebuilds and removal; `overlap` lists bodies first and characters after, each in creation order. Lite builds the capsule's shape with every filter bit set and exposes no way to change it, so Havok cannot layer-filter a ray against it: when a ray's `layerMask` excludes the character, the service resumes the ray just inside the capsule, where Havok does not report it again. For the same reason `collisionMatrix` does not apply to the capsule's own collisions; the character's layer only steers queries.

**A sweep cannot be layer-filtered, but it can pass through one body.** `ShapeCastQuery` has no `membership`/`collideWith`, so a body outside `layerMask` still stops a `shapeCast`; the mask decides only whether the hit is attributed an `entity`. `ShapeCastOptions.ignore` names the one entity — a `Rigidbody`, a collider-only static or a `CharacterController` — whose body the sweep passes through (Lite's `ignoreBody`). It exists because a sweep that starts inside a body reports that body at fraction zero and nothing else, which is what a camera boom leaving its target's capsule and a step probe leaving the character's feet both do; `@ignifx/3d`'s `ThirdPersonCamera` and `ThirdPersonController` use it for exactly that.

## 6. Settings

`physics: { gravity: [0, -9.81, 0], collisionMatrix, defaultMaterial, velocityLimits: { linear, angular }, interpolation: true, havokWasm: "auto" | url }`. `fixedDeltaTime` is shared with `time` settings and read from `app.time` on every step.

`velocityLimits` defaults to `{ linear: 0, angular: 0 }`, where `0` means "leave Havok's own default
alone". A layer that appears as a key in `collisionMatrix` collides only with the layers it lists; a
layer that appears nowhere collides with everything, and Havok tests a pair in both directions, so
one side refusing is enough to block it.

## 7. Loading Havok

`@babylonjs/havok` (peer dependency) exports `HavokPhysics(options)`. Its ESM build hard-codes
`ENVIRONMENT_IS_WEB` and `fetch`es the binary, so `locateFile` cannot help under Node; the extension
therefore always obtains the **bytes** first and passes Emscripten's `wasmBinary`.

The Vite plugin copies `HavokPhysics.wasm` into the public asset path from the package's
`ignifx.assets.public` list, unhashed and **by base name**, and the default asset root is that same
directory — so the address is the bare `"HavokPhysics.wasm"` and
`app.assets.resolveUrl("HavokPhysics.wasm")` is the URL. Under Node, where nothing serves that
address, the loader falls back to reading the binary out of the installed `@babylonjs/havok`
package, so `app.isHeadless` only changes _where the bytes come from_. The world is created in
`onStart`; there is no `lazy` option.

## 8. Determinism

- Fixed step, fixed iteration order (bodies are stepped by Havok; ignifx dispatches events in Havok's order), no wall-clock reads. Same inputs + same build ⇒ identical results **on the same platform and browser engine**; replays rely on this. `packages/physics/test/determinism/` holds it to a committed pose hash, in the unit-test job, which runs on Linux only. Cross-platform bit-exactness is neither tested nor guaranteed (WASM engines may differ in transcendental math and FMA usage); a lockstep networking design must budget for that.
- Body creation order affects Havok's internal ordering; scene loading is deterministic (tree order), and scripts creating bodies at runtime must do so from deterministic callbacks (`fixedUpdate`), not from asset-load promises, when determinism matters.

## 9. Debugging

`app.physics.debugViewer.enabled` toggles Lite's `createPhysicsViewer` (wireframe bodies on the
render scene); the `@ignifx/devtools` Physics panel toggles it and shows the `physics` diagnostics group
(`bodies`, `activeBodies`, `stepsThisFrame`, `collisionEvents`, `triggerEvents`, `queries`,
`stepMs`). The viewer builds a `Mesh` per body, so it needs a GPU device and is a no-op with a
warning on a headless app. It follows bodies built, rebuilt or removed after it was switched on.
`app.physics.colliderOutlines(entity)` (and `app.physics2d.colliderOutlines`) gives the same
information as data: each enabled collider's outline as world-space line segments, for an editor's
collider gizmos (§11).

## 10. 2D physics

2D games use `@ignifx/physics-2d` (ADR-0006), which exposes the same component vocabulary with a `2D` suffix (`Rigidbody2D`, `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `PolygonCollider2D`, `EdgeCollider2D`, `TilemapCollider2D`, `CharacterController2D`) and the same stepping model (§1) on its own backend. A world uses either the 3D or the 2D physics extension, not both; registering both throws `IGX-1101`.

## 11. Edit mode (ADR-0028)

In an edit-mode app (`createApp({ editMode: true })`) both physics extensions keep bodies but never simulate them (the decision is ADR-0028's amendment of 2026-10-20):

- **Bodies follow the scene.** A `physics-edit-sync` (`physics2d-edit-sync`) system, registered only in an edit-mode app at `PreRender` −800, builds, rebuilds and removes bodies for component, layer and tile changes and places every body whose transform the editor moved. A 3D body is removed and added again with its shapes, because a Havok teleport leaves the broadphase behind until a step; a changed scale rebuilds the shapes. 2D runs Rapier's zero-length priming step after a change and drops its events. Interpolation is off.
- **Nothing steps.** No fixed step runs, so nothing falls, no collision or trigger callback fires, no simulated pose is written to a transform, and `hasStepped` stays `false`.
- **Queries answer** from the first frame without a step: each one first brings the bodies in line with the world, so it sees a move the editor made a moment ago.
- **Collider gizmos.** `colliderOutlines(entity)` on either service returns world-space line segments per enabled collider. 3D outlines come from the collider's fields, world pose and lossy scale (a `MeshCollider` has none; a `HeightfieldCollider` outlines the box of its samples); 2D outlines are Rapier's debug drawing, tile collision included. `@ignifx/editor-host` serves them as `getColliderOutlines`.
- The Havok and Rapier WebAssembly modules load as they do in a game.

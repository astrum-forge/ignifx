# 09 · Physics (3D, Havok through Babylon Lite)

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/physics` · **Related:** `01-lifecycle-and-time.md` §3, ADR-0003, ADR-0006 (2D backend), `11-2d-toolkit.md` §8

Lite API names verified against `@babylonjs/lite@1.27.0`.

---

## 1. Stepping model (ADR-0003)

Lite's `createHavokWorld(scene, hknp)` inserts its own callback at the front of `scene._beforeRender` and performs **one** `HP_World_Step` per rendered frame at the configured fixed step, with no accumulator and no way to unregister the callback through public API. ignifx needs an accumulator-driven fixed loop, so:

- The physics extension creates a **simulation scene** on a null engine at `onStart`: `simEngine = createNullEngine(); simScene = createSceneContext(simEngine, { defaultRenderTask: false }); world = createHavokWorld(simScene, hknp, gravity)`. Bodies reference plain `SceneNode`s, which are scene-agnostic, so the same nodes are rendered by the render scene and simulated by the simulation scene.
- Each fixed step, the step system calls `stepScene(simEngine, simScene, fixedDeltaTime * 1000)`, which sets the frame delta and runs `simScene._update()`: Lite's Havok callback performs pre-step node→body sync for `ANIMATED` bodies (and any body with prestep enabled), the Havok step, and body→node sync for `DYNAMIC` bodies. `setPhysicsTimestep(world, fixedDeltaTime)` keeps Lite's per-step delta equal to ignifx's (Lite clamps a step at 100 ms).
- The simulation scene never holds meshes or lights. Physics debug rendering (`createPhysicsViewer`) targets the render scene.
- If a future Lite version exposes a public `stepPhysicsWorld(world, dt)`, the adapter switches to it with no API change for users. An upstream request is part of Phase 4.

Per fixed step (see `01-lifecycle-and-time.md` §3, step 4):

```
Systems(FixedUpdate, order -100)  restore authoritative poses on interpolated bodies (undo the display pose written last PreRender)
scripts.fixedUpdate(dt)           forces, velocities, CharacterController.move() requests, kinematic node moves
Systems(FixedUpdate, order  100)  stepScene(simEngine, simScene, dt·1000); snapshot poses (prev ← cur, cur ← node)
event dispatch                    collisions and triggers drained by Lite's post-step hook → onCollision*/onTrigger* on scripts of both entities
```

Per frame in `PreRender` (order −500): for every `Rigidbody` with `interpolation: "interpolate"`, write `lerp(prev, cur, time.fixedStepAlpha)` into the node. Dynamic bodies have prestep sync disabled, so the display pose never leaks back into Havok.

## 2. Components

### 2.1 `Rigidbody`

| Field                                                    | Default                                                                                                                                                     | Lite                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bodyType`: `"dynamic"` \| `"kinematic"` \| `"static"`   | `"dynamic"`                                                                                                                                                 | `PhysicsMotionType.DYNAMIC` / `ANIMATED` / `STATIC` (`createPhysicsBody`, `setPhysicsBodyMotionType`) |
| `mass`                                                   | 1                                                                                                                                                           | `setPhysicsBodyMass` (0 for static)                                                                   |
| `startAsleep`                                            | false                                                                                                                                                       | `createPhysicsBody(..., startsAsleep)`                                                                |
| `freezeRotation`: `{ x, y, z }`                          | all false                                                                                                                                                   | `lockPhysicsBodyRotationAxes` / `unlockPhysicsBodyRotationAxes`                                       |
| `interpolation`: `"none"` \| `"interpolate"`             | `"interpolate"` for dynamic                                                                                                                                 | ignifx (§1)                                                                                           |
| `collisionEvents`                                        | auto (true when any script on the entity implements `onCollision*`; recomputed on every `addComponent`/`removeComponent` on the entity and pushed to Havok) | `setPhysicsBodyCollisionEventsEnabled`                                                                |
| `kinematicSync`: `"teleport"` \| `"velocity"`            | `"teleport"`                                                                                                                                                | `setPhysicsBodyPrestepType(TELEPORT/ACTION)`                                                          |
| `linearVelocity`, `angularVelocity` (runtime)            | —                                                                                                                                                           | `get/setPhysicsBodyLinearVelocity`, `get/setPhysicsBodyAngularVelocity`                               |
| `addForce(force, point?)`, `addImpulse(impulse, point?)` | —                                                                                                                                                           | `applyPhysicsBodyForce`, `applyPhysicsBodyImpulse`                                                    |
| `teleport(position, rotation)`                           | —                                                                                                                                                           | `setPhysicsBodyTransform`                                                                             |
| `velocityLimits`                                         | world default                                                                                                                                               | `setPhysicsVelocityLimits`                                                                            |

Not available in Lite 1.27.0 and therefore absent from the schema (tracked as upstream requests): per-body linear/angular damping, per-body gravity factor, sleep thresholds, and explicit `wakeUp()`. Gravity is per world (`setPhysicsGravity`) with optional regional gravity for planetary setups.

### 2.2 Colliders

`BoxCollider { size, center }`, `SphereCollider { radius, center }`, `CapsuleCollider { radius, height, center, direction }`, `CylinderCollider { radius, height, center }`, `MeshCollider { mesh?: asset(MeshAsset) | null (uses the entity's MeshRenderer/Model), convex: bool(false), includeChildren: bool(true) }`, `HeightfieldCollider { heights, size }`. Shared fields: `isTrigger`, `material: asset(PhysicsMaterial) | inline { friction, restitution, staticFriction }`, `layerOverride: layer | null`.

- Lite mapping: `createPhysicsShape(world, { type: PhysicsShapeType.*, parameters })`, `setPhysicsShapeIsTrigger`, `setPhysicsShapeMaterial`, `setPhysicsShapeFilterMembershipMask`/`CollideMask`, `setPhysicsBodyShape`. Several colliders on one entity form a `CONTAINER` shape (`addPhysicsShapeChild`).
- An entity with colliders but no `Rigidbody` gets an implicit **static** body that is placed once and does not follow later transform changes; a development diagnostic (`IGX-0901`) fires if such an entity's `worldMatrixVersion` changes. Anything that moves needs a kinematic `Rigidbody`. Colliders on child entities attach to the nearest ancestor `Rigidbody` (compound bodies) in Phase 4b; the MVP supports same-entity compounds.
- Shape sizes are authored in local units and scaled by the entity's lossy scale at creation; scale changes after creation require `collider.rebuild()`.

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

- The controller owns the entity's world position: after each step it writes `getPosition()` into the transform. Rotation stays user-controlled. With `interpolation: "interpolate"` (the default) the controller keeps the previous and current step positions and the `PreRender` system writes the interpolated position exactly as for `Rigidbody`, restoring the authoritative position at the start of each fixed step, so player characters do not judder above the fixed rate.
- Step offset (stairs) is not a Lite feature; the 3D toolkit's `ThirdPersonController`/`FirstPersonController` implement a step probe with `shapeCast` (Phase 7).
- Gravity is applied by the toolkit controllers through `checkSupport` + `integrate`, so a bare `CharacterController` is purely kinematic.

### 2.4 `PhysicsMaterial` asset

`{ "format": "ignifx.physicsmaterial", "friction": 0.6, "staticFriction": 0.6, "restitution": 0 }`.

## 3. Layers and the collision matrix

- The entity's `layer` becomes the shape's membership bit (`1 << layer`); the collide mask is the OR of layers the project's collision matrix allows for that layer (`ignifx.config.ts` → `physics.collisionMatrix`). Both are 32-bit, matching Havok's filters.
- Changing `entity.layer` at runtime updates the masks on the next fixed step.
- Raycasts and shape queries take a `LayerMask`.

## 4. Events

- **Triggers:** `onPhysicsTriggerBodies` gives `bodyA`/`bodyB`; the adapter resolves bodies to entities and delivers `onTriggerEnter`/`onTriggerExit` to scripts on both entities with `TriggerEvent { other: Entity, otherCollider, self }`.
- **Collisions:** `onPhysicsCollision` currently reports `type`, `point`, `normal`, `impulse` **without body identities**. Delivering `onCollisionEnter/Stay/Exit` to the right entities requires one of:
  1. an upstream addition `onPhysicsCollisionBodies` (mirrors the trigger API) — the preferred path; Phase 4 includes the pull request; or
  2. an adapter-internal drain that reads Havok's collision event buffer through the world's internal handles (same offsets Lite uses). This deliberately crosses the adapter boundary and is therefore governed by its own waiver, ADR-0013: opt-in through `physics({ collisionIdentities: "internal" })`, guarded by a version-pinned layout test, and removed the release after upstream support lands.
     The plan carries this as risk R-4. Until one path ships, trigger events (which carry identities) are the documented mechanism for gameplay reactions, and `onCollision*` callbacks deliver contact data with `other` set to `null`.
- `Collision { other: Entity, otherCollider, contacts: [{ point, normal, impulse }], relativeVelocity? }`. Contacts are pooled and only valid during the callback.

## 5. Queries (`app.physics`)

```ts
raycast(origin, direction, maxDistance, options?: { layerMask?, hitTriggers? }): RaycastHit | null    // physicsRaycast
shapeCast(shape, from, to, options?): ShapeCastHit | null                                          // shapeCast
overlap(shape, position, rotation?, options?): Entity[]                                             // shapeProximity
```

`RaycastHit { entity, collider, point, normal, distance, triangleIndex }`. Queries require at least one completed step (Lite builds the broadphase on the first step); calling earlier returns `null` with a development warning.

## 6. Settings

`physics: { gravity: [0, -9.81, 0], collisionMatrix, defaultMaterial, velocityLimits: { linear, angular }, interpolation: true, havokWasm: "auto" | url }`. `fixedDeltaTime` is shared with `time` settings.

## 7. Loading Havok

`@babylonjs/havok` (peer dependency) exports `HavokPhysics({ locateFile })`. The Vite plugin copies `HavokPhysics.wasm` to the public assets (manifest `assets.public`), and the extension loads it in `onStart` (or lazily on first `Rigidbody` when `physics({ lazy: true })`). Headless tests load the same WASM in Node.

## 8. Determinism

- Fixed step, fixed iteration order (bodies are stepped by Havok; ignifx dispatches events in Havok's order), no wall-clock reads. Same inputs + same build ⇒ identical results **on the same platform and browser engine**; replays rely on this. Cross-platform bit-exactness is tested on Linux, macOS, and Windows in CI from Phase 4 but is _not_ guaranteed (WASM engines may differ in transcendental math and FMA usage); a lockstep networking design after 1.0 must budget for that (risk R-14).
- Body creation order affects Havok's internal ordering; scene loading is deterministic (tree order), and scripts creating bodies at runtime must do so from deterministic callbacks (`fixedUpdate`), not from asset-load promises, when determinism matters.

## 9. Debugging

`@ignifx/devtools` toggles Lite's `createPhysicsViewer` (wireframe bodies/constraints on the render scene) and shows step counts, body counts, and event counts from `app.diagnostics.physics`.

## 10. 2D physics

2D games use `@ignifx/physics-2d` (ADR-0006), which exposes the same component vocabulary with a `2D` suffix (`Rigidbody2D`, `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `PolygonCollider2D`, `TilemapCollider2D`, `CharacterController2D`) and the same stepping model (§1) on its own backend. A world uses either the 3D or the 2D physics extension, not both, in the MVP.

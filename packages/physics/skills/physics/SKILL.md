---
name: physics
description: Adds 3D physics to an ignifx game with @ignifx/physics: Havok simulation on a separate headless scene, Rigidbody, box/sphere/capsule/mesh colliders, physics materials, triggers, CharacterController, raycasts and shape queries, the collision layer matrix, and render interpolation. Use when adding or editing 3D physics bodies, colliders, triggers, character movement, or physics queries in an ignifx project, or when the user mentions @ignifx/physics, Rigidbody, Havok, or collision layers.
license: Apache-2.0
metadata:
  ignifx-version: "0.2.1"
---

# @ignifx/physics

## What this is / when to use

`@ignifx/physics` is the ignifx extension that simulates 3D rigid bodies with Havok, through Babylon
Lite. Add a collider to make an entity solid, add a `Rigidbody` to make it move, and read the result
off `entity.transform` like any other pose — the body and the renderer share one scene node.

The simulation runs on its **own** null-engine scene, stepped by ignifx's fixed loop, so it advances
at a fixed rate no matter what the frame rate does, it is deterministic on one platform and build,
and it runs headless with no GPU. Use it for anything that falls, collides, is pushed, is walked
through, or has to be asked "what is under the crosshair".

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Peer dependencies: `@babylonjs/lite` (exactly `1.27.0`) and `@babylonjs/havok` (`^1.3.0`).
- Browsers, Electron, and Node. The Vite plugin copies `HavokPhysics.wasm` into the public asset
  path, so the browser loads it from `assets/HavokPhysics.wasm`; under Node the extension reads the
  binary out of the installed `@babylonjs/havok` package, so a headless test needs no setup.
- Register it like any extension; nothing happens at import time.

```ts run
import { createApp, physics } from "ignifx";

const app = await createApp({ headless: true, extensions: [physics()] });
await app.start();
```

`ignifx.config.ts` carries the settings under `physics`:

| Setting           | Default                | Meaning                                                            |
| ----------------- | ---------------------- | ------------------------------------------------------------------ |
| `gravity`         | `{x:0,y:-9.81,z:0}`    | World gravity, m/s²                                                |
| `collisionMatrix` | `{}`                   | `{ layerName: [layerNames] }`; an unlisted layer collides with all |
| `defaultMaterial` | friction `0.6`         | The surface a collider with no material of its own uses            |
| `velocityLimits`  | `{linear:0,angular:0}` | World speed clamps; `0` leaves Havok's own defaults                |
| `interpolation`   | `true`                 | Whether dynamic bodies interpolate between fixed steps             |
| `havokWasm`       | `"auto"`               | `"auto"` resolves through the asset manifest, or give a URL        |

`fixedDeltaTime` is **not** here: the step comes from the core `time` section and `app.time`.

## Mental model

```
app.physics (PhysicsService)     gravity · raycast · shapeCast · overlap · debugViewer · lite
 │
 ├─ Rigidbody              dynamic | kinematic | static, one per entity
 ├─ Box/Sphere/Capsule/Cylinder/Mesh/HeightfieldCollider   several per entity form one compound
 └─ CharacterController    kinematic capsule, collide-and-slide

per fixed step:
  Systems(FixedUpdate, -100)  restore the authoritative pose of interpolated bodies
  scripts.fixedUpdate(dt)     forces, velocities, controller.move()
  Systems(FixedUpdate,  100)  step Havok · snapshot poses · dispatch collision and trigger events

once per frame, after the fixed loop:
  Systems(Update,     -900)   write lerp(previous, current, time.fixedStepAlpha)
  scripts.update · animation · scripts.lateUpdate · rendering   all read that display pose
```

- Colliders and bodies are (re)built at the **start of the next fixed step**, never mid-frame, so
  body creation order — and therefore Havok's internal order — follows entity creation order.
- An entity with colliders and no `Rigidbody` gets an implicit **static** body placed once. Moving
  it afterwards logs `IGX-0901`; anything that moves needs a kinematic `Rigidbody`.
- A body's entity must be a **root** entity: Havok writes the node's local pose, so a parented body
  would be simulated in its parent's space (`IGX-0907`).

## First app

```ts run
import { BoxCollider, createApp, physics, Rigidbody } from "ignifx";

const app = await createApp({ headless: true, extensions: [physics()] });
await app.start();

const floor = app.world.createEntity("Floor");
floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });

const crate = app.world.createEntity("Crate");
crate.transform.position = { x: 0, y: 5, z: 0 };
crate.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
crate.addComponent(Rigidbody, { mass: 2 });

for (let step = 0; step < 60; step += 1) {
  app.step(1 / 60);
}
app.log.info("crate at y:", crate.transform.position.y);
```

## Core APIs

### `app.physics`

| Member                                                      | What it does                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gravity`                                                   | World gravity; assigning it takes effect on the next step                                                                                                                      |
| `raycast(origin, direction, maxDistance?, options?)`        | First entity along a ray, with point, normal, and distance                                                                                                                     |
| `shapeCast(shape, from, to, options?)`                      | Sweeps a sphere/box/capsule and reports the first contact; `options.ignore` names one entity the sweep passes through — the caller's own body, when the sweep starts inside it |
| `overlap(shape, position, rotation?, options?)`             | Entities whose world bounds the shape touches (array is reused)                                                                                                                |
| `distanceToNearest(shape, position, maxDistance, options?)` | Distance to the closest body, or `Infinity`                                                                                                                                    |
| `debugViewer.enabled`                                       | Lite's wireframe overlay on the render scene (needs a GPU)                                                                                                                     |
| `lite`                                                      | Unstable escape hatch: the Havok world and the simulation scene                                                                                                                |

Every query needs at least one completed fixed step — Havok builds its broadphase there — and
reports `IGX-0902` before that.

### `Rigidbody`

| Field / member                                  | Default         | Meaning                                             |
| ----------------------------------------------- | --------------- | --------------------------------------------------- |
| `bodyType`                                      | `"dynamic"`     | `"dynamic"`, `"kinematic"`, or `"static"`           |
| `mass`                                          | `1`             | Kilograms; dynamic bodies only                      |
| `startAsleep`                                   | `false`         | Whether Havok starts it asleep                      |
| `freezeRotation`                                | all `false`     | Locks rotation about X, Y, or Z                     |
| `interpolation`                                 | `"interpolate"` | `"none"` pins the display pose to the last step     |
| `collisionEvents`                               | `"auto"`        | `"auto"` follows the scripts on the entity          |
| `kinematicSync`                                 | `"teleport"`    | `"velocity"` drags resting bodies along instead     |
| `linearVelocity` / `angularVelocity`            | —               | Read and write; `…ToRef` variants allocate nothing  |
| `addForce(f, point?)` / `addImpulse(i, point?)` | —               | Call from `fixedUpdate`                             |
| `teleport(position, rotation?)`                 | —               | Moves without integrating, and resets interpolation |

### Colliders

`BoxCollider { size }` · `SphereCollider { radius }` · `CapsuleCollider { radius, height, direction }`
· `CylinderCollider { radius, height }` · `MeshCollider { mesh, convex, includeChildren }` ·
`HeightfieldCollider { heights, samplesX, samplesZ, size }`.

All of them share `center`, `isTrigger`, `material` (a `.physicsmaterial.json` asset),
`inlineMaterial`, and `layerOverride`. Sizes are authored in local units and multiplied by the
entity's lossy scale when the shape is built; changing the scale afterwards needs
`collider.rebuild()`.

### `CharacterController`

`move(displacement)` from `fixedUpdate` (displacements accumulate), then read `isGrounded`,
`supportState`, `groundNormal`, and `velocity`. `setHeight(h, preserveFeet?)` crouches,
`teleport(position)` relocates, and `onCollided` reports every dynamic body the capsule pushed.
Gravity is **not** applied for you — a bare controller is purely kinematic.

## Recipes

### A trigger volume

```ts run
import { BoxCollider, createApp, physics, Rigidbody, Script } from "ignifx";
import type { ScriptCallbacks, TriggerEvent } from "ignifx";

class Pickup extends Script implements ScriptCallbacks {
  static typeId = "mygame/Pickup";

  onTriggerEnter(trigger: TriggerEvent): void {
    this.app.log.info("entered the zone:", trigger.other?.name ?? "something");
  }
}

const app = await createApp({ headless: true, extensions: [physics()] });
app.registerComponents([Pickup]);
await app.start();

const zone = app.world.createEntity("Zone");
zone.transform.position = { x: 0, y: 2, z: 0 };
zone.addComponent(BoxCollider, { size: { x: 4, y: 1, z: 4 }, isTrigger: true });
zone.addComponent(Pickup);

const ball = app.world.createEntity("Ball");
ball.transform.position = { x: 0, y: 6, z: 0 };
ball.addComponent(BoxCollider);
ball.addComponent(Rigidbody);

for (let step = 0; step < 120; step += 1) {
  app.step(1 / 60);
}
```

### A raycast under the crosshair

```ts run
import { BoxCollider, createApp, LayerMask, physics } from "ignifx";

const app = await createApp({ headless: true, extensions: [physics()] });
await app.start();
app.world.createEntity("Ground").addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });
app.step(1 / 60);

const hit = app.physics.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20, {
  layerMask: LayerMask.everything(),
});
if (hit !== null) {
  app.log.info("hit:", hit.entity.name, "y:", hit.point.y);
}
```

### Layers that ignore each other

```ts run
// ignifx.config.ts
export default {
  layers: ["Default", "Ground", "Ghost"],
  physics: { collisionMatrix: { Ghost: ["Ghost"] } },
};
```

A layer that appears as a key collides only with the layers it lists; a layer that appears nowhere
collides with everything. Havok tests a pair in both directions, so one side refusing is enough.
`entity.layer` changes take effect on the next fixed step.

## File formats

- `*.physicsmaterial.json` — `ignifx.physicsmaterial`: `friction`, `staticFriction`, `restitution`.
  See `skills/ignifx/references/formats/ignifx.physicsmaterial.md`.
- Component fields as they appear in a scene file: `skills/ignifx/references/formats/components.md`.

## Gotchas

- **Queries before the first step return `IGX-0902`.** Step once after building the scene.
- **`MeshCollider` needs a GPU app.** Babylon Lite cannot build mesh or convex-hull shapes on the
  null engine and a headless `MeshAsset` uploads no geometry, so a headless mesh collider reports
  `IGX-0906`. Use a primitive collider in headless tests.
- **`collision.other` is `null` by default.** `@babylonjs/lite@1.27.0` reports collisions without
  body identities. Trigger events _do_ carry both entities, so they are the documented mechanism for
  gameplay reactions; `physics({ collisionIdentities: "internal" })` opts into the ADR-0013 waiver
  that recovers the identities.
- **Event objects are pooled.** `TriggerEvent` and `Collision` (and its `contacts`) are reused for
  every event of a step: copy anything you keep past the callback.
- **Type the callback parameter, do not cast it.** Core declares `onTriggerEnter?(trigger: unknown)`
  on `ScriptCallbacks` because it cannot depend on this package, but method parameters are bivariant
  in TypeScript, so `onTriggerEnter(trigger: TriggerEvent): void` satisfies the interface as written.
  `trigger as TriggerEvent` is redundant, and it trips `typescript/no-unsafe-type-assertion` under
  the engine's own lint settings.
- **`overlap` returns a reused array**, and it is bounds-accurate rather than shape-accurate,
  because Lite's `shapeProximity` reports neither a body identity nor more than one hit.
- **A body's entity must be a root entity** (`IGX-0907`), and a moving collider needs a
  `Rigidbody` (`IGX-0901`).
- **Interpolated poses are display-only.** Read `transform.position` in `fixedUpdate` when you need
  the authoritative pose. Everything outside the fixed loop — `update`, `lateUpdate`, animation,
  camera rigs, rendering — sees the interpolated one, because the display pose is written at the top
  of `Update`. That is deliberate: a follow camera in `lateUpdate` must frame the character where the
  frame draws it, or the two judder against each other.
- **A resting body sleeps.** Changing `app.physics.gravity` does not wake it; apply an impulse.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `skills/ignifx/references/api/physics.md` for
the generated API · `docs/architecture/09-physics.md` and ADR-0003 / ADR-0013 for the design
rationale.

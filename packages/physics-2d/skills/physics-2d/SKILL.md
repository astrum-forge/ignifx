---
name: physics-2d
description: Adds 2D physics to an ignifx game with @ignifx/physics-2d: Rapier 2D simulation on the fixed loop, Rigidbody2D, box/circle/capsule/polygon/edge/tilemap colliders, physics materials, 2D triggers, CharacterController2D with slopes, autostep, snap-to-ground and one-way platforms, 2D raycasts and shape queries, the collision layer matrix, and render interpolation. Use when adding or editing 2D physics bodies, 2D colliders, platformer movement, 2D triggers, or 2D queries in an ignifx project, or when the user mentions @ignifx/physics-2d, Rigidbody2D, Rapier, or CharacterController2D.
license: Apache-2.0
metadata:
  ignifx-version: "0.2.0"
---

# @ignifx/physics-2d

## What this is / when to use

`@ignifx/physics-2d` is the ignifx extension that simulates 2D rigid bodies with **Rapier 2D**
(`@dimforge/rapier2d-compat`, Apache-2.0, ADR-0006). Add a 2D collider to make an entity solid, add
a `Rigidbody2D` to make it move, and read the result off `entity.transform.position2D` /
`rotation2D` like any other pose.

Units are **metres and seconds**, +Y is up, and `rotation2D` is degrees counter-clockwise about +Z.
Pixels-per-unit affects only rendering (`docs/architecture/11-2d-toolkit.md` §3). The simulation is
stepped directly by ignifx's fixed loop — there is no Babylon Lite scene involved — so it advances
at a fixed rate whatever the frame rate does, and it runs headless with no GPU.

A world uses **either** `physics()` **or** `physics2d()`. Registering both throws `IGX-1101`.

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Dependency: `@dimforge/rapier2d-compat` `^0.20.0`. The `-compat` build **inlines** its WebAssembly
  as base64, so nothing has to be served and Node, the browser, and Electron all take the same path.
- `@ignifx/2d` is an **optional** peer: you need it only for `TilemapCollider2D`'s data type, so a
  game that draws its own graphics can use 2D physics on its own.
- Register it like any extension; nothing happens at import time.

```ts run
import { createApp } from "@ignifx/core";
import { physics2d } from "@ignifx/physics-2d";

const app = await createApp({ headless: true, extensions: [physics2d()] });
await app.start();
```

`ignifx.config.ts` carries the settings under `physics2d`:

| Setting              | Default         | Meaning                                                            |
| -------------------- | --------------- | ------------------------------------------------------------------ |
| `gravity`            | `{x:0,y:-9.81}` | World gravity, m/s²; +Y is up                                      |
| `collisionMatrix`    | `{}`            | `{ layerName: [layerNames] }`; an unlisted layer collides with all |
| `defaultMaterial`    | friction `0.6`  | The surface a collider with no material of its own uses            |
| `velocityIterations` | `0`             | Rapier solver iterations; `0` leaves Rapier's own default of 4     |
| `interpolation`      | `true`          | Whether dynamic bodies interpolate between fixed steps             |

`fixedDeltaTime` is **not** here: the step comes from the core `time` section and `app.time`.

## Mental model

```
app.physics2d (Physics2DService)   gravity · raycast · raycastAll · overlapCircle/Box · shapeCast · rapier
 │
 ├─ Rigidbody2D            dynamic | kinematic | static, one per entity
 ├─ Box/Circle/Capsule/Polygon/Edge/TilemapCollider2D   several per entity form one compound body
 └─ CharacterController2D  kinematic capsule or box, collide-and-slide

per fixed step:
  Systems(FixedUpdate, -100)  restore the authoritative pose of interpolated bodies
  scripts.fixedUpdate(dt)     forces, velocities, controller.move()
  Systems(FixedUpdate,  100)  step Rapier · snapshot poses · dispatch collision and trigger events

once per frame, after the fixed loop:
  Systems(Update,     -900)   write lerp(previous, current, time.fixedStepAlpha)
  scripts.update · animation · scripts.lateUpdate · rendering   all read that display pose
```

- Bodies and colliders are (re)built at the **start of the next fixed step**, never mid-frame, so
  body creation order — and therefore Rapier's internal order — follows entity creation order.
- An entity with 2D colliders and no `Rigidbody2D` gets an implicit **static** body placed once.
  Moving it afterwards logs `IGX-1151`; anything that moves needs a kinematic `Rigidbody2D`.
- A body's entity should be a **root** entity; a parented one logs `IGX-1157`.
- The callbacks are the **3D names** — `onCollisionEnter`, `onCollisionStay`, `onCollisionExit`,
  `onTriggerEnter`, `onTriggerExit` — carrying the 2D payloads. There is no `onCollisionEnter2D`.
  Type the parameter as the 2D payload — `onTriggerEnter(trigger: TriggerEvent2D): void` — rather
  than accepting core's `unknown` and casting: method parameters are bivariant, so the narrow
  signature satisfies `ScriptCallbacks`, and the cast trips `typescript/no-unsafe-type-assertion`
  under the engine's own lint settings.

## First app

```ts run
import { createApp } from "@ignifx/core";
import { BoxCollider2D, physics2d, Rigidbody2D } from "@ignifx/physics-2d";

const app = await createApp({ headless: true, extensions: [physics2d()] });
await app.start();

const floor = app.world.createEntity("Floor");
floor.transform.position = { x: 0, y: -0.5, z: 0 };
floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

const crate = app.world.createEntity("Crate");
crate.transform.position = { x: 0, y: 5, z: 0 };
crate.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
const body = crate.addComponent(Rigidbody2D, { mass: 2 });

for (let index = 0; index < 240; index += 1) {
  app.step(1 / 60);
}
app.log.info("crate y:", crate.transform.position.y, "mass:", body.computedMass);
```

## Core APIs

`Rigidbody2D` — `bodyType` (`"dynamic" | "kinematic" | "static"`), `mass` (exact kilograms; `0`
means "weigh the colliders at 1 kg/m²"), `gravityScale`, `linearDamping`, `angularDamping`,
`freezeRotation`, `interpolation`, `collisionEvents` (`"auto" | "on" | "off"`). At runtime:
`linearVelocity` (m/s), `angularVelocity` (**degrees**/s), `computedMass`, `addForce`, `addImpulse`,
`addTorque`, `teleport(position, rotationDegrees?)`, and the `rapier` escape hatch.

Colliders share `offset`, `isTrigger`, `material` (a `.physicsmaterial.json` asset), the
`inlineMaterial` fallback, `frictionCombine` / `restitutionCombine`, `oneWay`, and `layerOverride`:

| Collider            | Geometry                                                    |
| ------------------- | ----------------------------------------------------------- |
| `BoxCollider2D`     | `size` — an axis-aligned rectangle                          |
| `CircleCollider2D`  | `radius`; the larger scale axis wins                        |
| `CapsuleCollider2D` | `radius`, `height` (tip to tip), `direction` (`"x" \| "y"`) |
| `PolygonCollider2D` | `points` → the **convex hull** of the list                  |
| `EdgeCollider2D`    | `points` → an open chain; infinitely thin                   |
| `TilemapCollider2D` | `collisionData` from a `Tilemap`                            |

`CharacterController2D` — `shape` (`"capsule" | "box"`), `radius`, `height`, `offset`, `slopeLimit`
(degrees), `stepOffset`, `snapToGround`, `skinWidth`, `onOneWayPlatforms`, `pushBodies`,
`interpolation`. Drive it with `move(delta)` from `fixedUpdate`; read `isGrounded`, `velocity`,
`groundNormal`, and `onCollided`.

`app.physics2d` — `gravity`, `raycast`, `raycastAll`, `overlapCircle`, `overlapBox`, `shapeCast`,
and `rapier` (the unstable escape hatch). Full signatures:
`skills/ignifx/references/api/physics-2d.md`.

## Recipes

### A trigger zone

```ts run
import { Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";
import type { TriggerEvent2D } from "@ignifx/physics-2d";

export class Coin extends Script implements ScriptCallbacks {
  static typeId = "mygame/Coin";

  onTriggerEnter(trigger: TriggerEvent2D): void {
    if (trigger.other?.name === "Player") {
      this.entity.destroy();
    }
  }
}
```

Give the coin a collider with `isTrigger: true`; give the player anything that moves. Both entities
receive the callback, and `trigger.other` and `trigger.otherCollider` are always the real objects —
Rapier reports both colliders, so 2D has none of the identity gaps 3D physics documents.

The coin needs no `Rigidbody2D`: a collider on its own gets an implicit static body, which is the
right thing for a pickup that never moves. The player can be a `Rigidbody2D` **or** a
`CharacterController2D` — a trigger is never an obstacle to the controller, so the character walks
straight through the volume at full speed while the callbacks fire.

### Platformer movement

```ts run
import { Script, Vec2 } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";
import { CharacterController2D } from "@ignifx/physics-2d";

export class Platformer extends Script implements ScriptCallbacks {
  static typeId = "mygame/Platformer";

  /** Metres per second. */
  speed = 5;

  /** The vertical speed a jump starts at. */
  jumpSpeed = 9;

  readonly #velocity = new Vec2();

  fixedUpdate(dt: number): void {
    const controller = this.entity.requireComponent(CharacterController2D);
    this.#velocity.x = this.speed;
    if (controller.isGrounded) {
      this.#velocity.y = this.jumpSpeed;
    } else {
      this.#velocity.y -= 9.81 * dt;
    }
    controller.move({ x: this.#velocity.x * dt, y: this.#velocity.y * dt });
  }
}
```

Gravity is **not** applied by the controller: a bare `CharacterController2D` is purely kinematic, so
the script owns the vertical velocity, coyote time, and variable jump height.

### A raycast

```ts run
import { createApp } from "@ignifx/core";
import { BoxCollider2D, physics2d } from "@ignifx/physics-2d";

const app = await createApp({ headless: true, extensions: [physics2d()] });
await app.start();
const ground = app.world.createEntity("Ground");
ground.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
app.step(1 / 60);

const hit = app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20);
if (hit !== null) {
  app.log.info("hit:", hit.entity.name, "y:", hit.point.y);
}
```

### Tilemap collision

```ts run
import { createApp } from "@ignifx/core";
import { physics2d, TilemapCollider2D } from "@ignifx/physics-2d";

const app = await createApp({ headless: true, extensions: [physics2d()] });
await app.start();
const map = app.world.createEntity("Map");
const collider = map.addComponent(TilemapCollider2D);
collider.collisionData = {
  cellSize: 1,
  chunkSize: 8,
  version: 1,
  chunks: [
    {
      chunkX: 0,
      chunkY: 0,
      polygons: [
        [
          { x: -4, y: -1 },
          { x: 4, y: -1 },
          { x: 4, y: 0 },
          { x: -4, y: 0 },
        ],
      ],
      oneWayEdges: [],
    },
  ],
};
app.step(1 / 60);
```

Assign `tilemap.collisionData` from `@ignifx/2d` instead of building it by hand. The runtime watches
the data's `version` every fixed step and rebuilds the shapes when it changes, so a tile edit reaches
physics with no subscription of your own.

## File formats

`ignifx.physicsmaterial` — the **same** `.physicsmaterial.json` document 3D physics reads
(`skills/ignifx/references/formats/ignifx.physicsmaterial.md`): `{ "format":
"ignifx.physicsmaterial", "friction": 0.6, "restitution": 0 }`. `staticFriction` is ignored, because
Rapier 2D has one friction coefficient. The combine rules are collider fields, not asset fields.

Component field tables: `skills/ignifx/references/formats/components.md`.

## Gotchas

- **Only sixteen layers filter.** Rapier packs membership and filter into 16 bits each, so a
  collider on layer 16 or above logs `IGX-1152` and falls back to layer 0. Keep the layers 2D
  physics uses in the first sixteen of `ignifx.config.ts`.
- **Queries need one completed step.** Rapier builds its broadphase inside `step`, so a query before
  the first fixed step throws `IGX-1153`. Call `app.step(1 / 60)` once first.
- **Autostep needs a box.** `stepOffset` clears a 0.3 m step with `shape: "box"`; with the default
  capsule of radius 0.2 it clears about 0.15 m and no more (measured, ADR-0006 Validation). Give a
  stair-climbing character `shape: "box"`.
- **A trigger is never an obstacle to a character controller.** `CharacterController2D` filters
  sensors out of its collide-and-slide sweep, so it passes through an `isTrigger` collider without
  slowing and the trigger callbacks fire on both entities. The flip side: a sensor never shows up in
  `CharacterController2D.onCollided` — use `onTriggerEnter`/`onTriggerExit` for pickups and zones,
  and `onCollided` only for the walls and floors the character actually pushed against. (Rapier's
  controller counts sensors as walls unless `QueryFilterFlags.EXCLUDE_SENSORS` is passed; measured
  2026-09-08 against 0.20.0, ADR-0006 Validation.)
- **One-way platforms are a character-controller feature.** `oneWay` changes what
  `CharacterController2D` collides with; rigid bodies fall through such a collider in both
  directions in the MVP.
- **`PolygonCollider2D` is convex.** Rapier builds the convex hull of the points, so a concave
  outline is silently filled in. Use several polygons on one entity, or an `EdgeCollider2D`.
- **`EdgeCollider2D` is infinitely thin.** A fast body can tunnel through it and a body that starts
  inside it is not pushed out. It is for static level geometry.
- **Determinism is same-machine only.** `@dimforge/rapier2d-compat` is Rapier's main build, which
  promises local determinism, not cross-platform bit-exactness; the
  `-deterministic-` builds are the ones that do (ADR-0006 Validation).
- **`angularVelocity` is degrees per second**, matching `Transform.rotation2D`, while Rapier's own
  API is radians. The `rapier` escape hatch gives you radians.
- **Interpolated poses are display-only.** Read `transform.position` in `fixedUpdate` when you need
  the authoritative pose. Everything outside the fixed loop — `update`, `lateUpdate`, animation,
  `Camera2DFollow`, rendering — sees the interpolated one, because the display pose is written at the
  top of `Update`. That is what keeps a follow camera locked to the sprite the frame actually draws.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `docs/architecture/11-2d-toolkit.md` §8 and
ADR-0006 for design rationale.

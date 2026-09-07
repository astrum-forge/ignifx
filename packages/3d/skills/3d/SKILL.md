---
name: 3d
description: Builds 3D games in ignifx with @ignifx/3d: third-person and first-person character controllers and camera rigs, the Animator state machine with blend trees and animation events, navigation meshes and agents, LOD groups, and billboards. Use when adding or editing 3D character movement, camera rigs, animation state machines, or navigation in an ignifx project, or when the user mentions @ignifx/3d, Animator, ThirdPersonController, or NavMeshAgent.
license: Apache-2.0
metadata:
  ignifx-version: "0.1.0"
---

# @ignifx/3d

## What this is / when to use

`@ignifx/3d` is the ignifx extension that turns `@ignifx/core` + `@ignifx/physics` + `@ignifx/input`
into a **3D game**: characters that walk, a camera that follows them without clipping through walls,
an animation state machine that drives their skeleton, and navigation for everything that is not the
player.

Use it for character movement, camera rigs, skeletal animation, and pathfinding. Do **not** use it
for drawing — `Model`, `MeshRenderer`, `Camera`, and `Light` are core — or for collision, which is
`@ignifx/physics`.

Almost all of it works under `createApp({ headless: true })`: the state machine runs, transitions and
animation events fire, the controllers move a `CharacterController`, navigation bakes and agents
walk. Only the _pose_ needs a GPU.

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Requires `@ignifx/physics` and `@ignifx/input`; register both **before** `threeD()`.
- WebGPU only, browser and Electron. Babylon Lite `1.27.0` is a peer dependency.
- Nothing happens at import time.

```ts
import { createApp } from "ignifx";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";
import { threeD } from "@ignifx/3d";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({
    canvas,
    extensions: [physics(), input(), threeD({ navigationSeed: 42 })],
  });
  await app.start();
}
```

## Mental model

| Thing                                                        | Phase it runs in           | Why there                                                                                                                            |
| ------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ThirdPersonController`, `FirstPersonController`, the movers | `fixedUpdate`              | Movement is simulation; it reads the input captured at frame start, so 30 fps and 240 fps behave identically.                        |
| `FirstPersonController`'s _look_                             | `update`                   | A mouse is sampled per frame; a look on the fixed step feels heavy.                                                                  |
| `NavigationSystem` (crowds)                                  | `FixedUpdate`, order `200` | After physics. Babylon Lite makes the crowd manual _for determinism_, and a fixed step is what makes two runs of one seed identical. |
| `app.tweens` (core)                                          | `PostUpdate`, order `-100` | Before animation, so a tween driving an `Animator` parameter is read the same frame.                                                 |
| `Animator`                                                   | `PostUpdate`, order `10`   | After tweens and after `@ignifx/2d`'s sprite clock.                                                                                  |
| `Billboard`                                                  | `PostUpdate`, order `20`   | After animation, so a billboard on a bone uses this frame's pose.                                                                    |
| `ThirdPersonCamera`                                          | `lateUpdate`               | After `PostUpdate`, so the camera frames the character where the animation actually put it.                                          |
| `LodGroup`                                                   | `PreRender`, order `-10`   | Before core's render sync, so a switched renderer reaches the scene this frame.                                                      |

"The main camera" is not a core concept, so this package states the rule once: `mainCamera(world)`
is the enabled `Camera` with the highest `priority`. Every rig, billboard, and LOD group reads it.

## First app

A character that walks, an orbit camera that follows it, and a floor. Compiles and runs headlessly.

```ts run
import { Camera, createApp } from "ignifx";
import { BoxCollider, CharacterController, Rigidbody, physics } from "@ignifx/physics";
import { input } from "@ignifx/input";
import { ThirdPersonCamera, ThirdPersonController, threeD } from "@ignifx/3d";

const app = await createApp({ headless: true, extensions: [physics(), input(), threeD()] });

const floor = app.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } });
floor.addComponent(BoxCollider, { size: { x: 60, y: 1, z: 60 } });
floor.addComponent(Rigidbody, { bodyType: "static" });

const hero = app.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
hero.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 45 });
const controller = hero.addComponent(ThirdPersonController, {
  walkSpeed: 4,
  sprintSpeed: 7,
  jumpHeight: 1.2,
  stepHeight: 0.3,
});

const eye = app.world.createEntity("Main Camera");
eye.addComponent(Camera);
eye.addComponent(ThirdPersonCamera, { target: hero, distance: 5, shoulderOffset: { x: 0.5, y: 1.5, z: 0 } });

await app.start();
app.step(1 / 60);
// `isGrounded`, `speed`, `verticalVelocity`, and `isSprinting` are what an Animator reads.
app.log.info("grounded:", controller.isGrounded, "speed:", controller.speed);
```

The controller reads the actions `Move` (vector2), `Jump`, and `Sprint` by default. The names are
fields — `controller.moveAction = "Walk"` then `controller.rebind()` — so a project renames them
without subclassing. An action no loaded map declares is reported once as `IGX-1212` and then
treated as absent; the character stands still rather than throwing.

## Core APIs

| Component               | What it does                                                     | Key fields                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ThirdPersonController` | Camera-relative movement on a `CharacterController`.             | `walkSpeed`, `sprintSpeed`, `turnSpeed`, `gravity`, `jumpHeight`, `coyoteTime`, `jumpBufferTime`, `airControl`, `stepHeight`, `slideSpeed`, `rotateToMovement` |
| `FirstPersonController` | Mouse-look on the body's yaw and a child pivot's pitch.          | `cameraPivot`, `sensitivity`, `invertY`, `standHeight`, `crouchHeight`, `headBobAmplitude`, `sprintFovKick`, `lockPointerOnClick`                              |
| `RigidbodyMover`        | Forces on a `Rigidbody`; `torqueSteering` for vehicles.          | `force`, `maxSpeed`, `cameraRelative`, `torqueSteering`                                                                                                        |
| `PlatformMover`         | A kinematic platform that carries the characters standing on it. | `offset`, `duration`, `waitSeconds`, `carryRiders`                                                                                                             |
| `Projectile`            | Muzzle velocity, gravity scale, lifetime, destroy-on-hit.        | `speed`, `gravityScale`, `lifetimeSeconds`, `destroyOnHit`, `owner`                                                                                            |
| `ThirdPersonCamera`     | Orbit rig with damping and wall collision.                       | `target`, `distance`, `minPitch`, `maxPitch`, `sensitivity`, `damping`, `shoulderOffset`, `collisionEnabled`, `collisionRadius`, `collisionLayers`             |
| `Animator`              | Runs a `.animator.json` state machine on a `Model`.              | `animator`, `speed`, `defaultLayer`, `updateWhenPaused`                                                                                                        |
| `NavMeshSurface`        | Bakes a navmesh and owns its crowd.                              | `layers`, `bakeOnAwake`, `agentRadius`, `agentHeight`, `agentClimb`, `cellSize`, `maxObstacles`, `maxAgents`, `randomSeed`                                     |
| `NavMeshAgent`          | One crowd agent, written back onto the transform.                | `speed`, `acceleration`, `radius`, `height`, `stoppingDistance`, `updateRotation`                                                                              |
| `NavMeshObstacle`       | A runtime hole in a tile-cache navmesh.                          | `shape`, `size`, `radius`, `height`                                                                                                                            |
| `LodGroup`              | Distance-based `MeshRenderer` switching with hysteresis.         | `levels`, `hysteresis`                                                                                                                                         |
| `Billboard`             | Faces the main camera; `yAxis` stays upright.                    | `mode`, `faceCameraPlane`                                                                                                                                      |

`app.navigation` carries `findPath(from, to)`, `closestPoint(point)`, `raycast(from, to)`,
`surfaces`, `primarySurface`, `isLoaded`, and `onReady`.

## Recipes

### An `Animator` on a rigged model

```ts
import { Model, Script, type ModelAsset, createApp } from "ignifx";
import { input } from "@ignifx/input";
import { CharacterController, physics } from "@ignifx/physics";
import { Animator, ThirdPersonController, type AnimatorAsset, threeD } from "@ignifx/3d";

/** Feeds the controller's state into the animator, once per frame. */
class HeroAnimation extends Script {
  static typeId = "game/HeroAnimation";

  #animator: Animator | null = null;

  #controller: ThirdPersonController | null = null;

  awake(): void {
    this.#animator = this.entity.getComponent(Animator);
    this.#controller = this.entity.getComponent(ThirdPersonController);
    this.#animator?.onEvent.connect(
      (name: string) => {
        if (name === "landed") {
          this.app.log.info("thud");
        }
      },
      { owner: this },
    );
  }

  update(): void {
    const animator = this.#animator;
    const controller = this.#controller;
    if (animator === null || controller === null) {
      return;
    }
    animator.setFloat("speed", controller.speed);
    animator.setBool("grounded", controller.isGrounded);
    if (controller.verticalVelocity > 0 && !controller.isGrounded) {
      animator.setTrigger("jump");
    }
  }
}

const app = await createApp({ headless: true, extensions: [physics(), input(), threeD()] });
app.registerComponents([HeroAnimation]);

const hero = app.world.createEntity("Hero");
hero.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
hero.addComponent(ThirdPersonController);
hero.addComponent(Model, { model: app.assets.load<ModelAsset>("3d/rig.glb").retain() });
hero.addComponent(Animator, {
  animator: app.assets.load<AnimatorAsset>("3d/hero.animator.json").retain(),
});
hero.addComponent(HeroAnimation);
```

The document is a state machine, not a clip list:

```json
{
  "format": "ignifx.animator",
  "formatVersion": 1,
  "parameters": [
    { "name": "speed", "kind": "float" },
    { "name": "grounded", "kind": "bool", "value": true },
    { "name": "jump", "kind": "trigger" }
  ],
  "layers": [{ "name": "Base", "defaultState": "locomotion" }],
  "states": [
    { "name": "locomotion", "blendTree": "locomotion" },
    { "name": "jump", "clip": "jump", "loop": false, "events": [{ "time": 0.85, "name": "landed" }] }
  ],
  "transitions": [
    { "from": "any", "to": "jump", "conditions": [{ "param": "jump", "op": "trigger" }], "duration": 0.08 },
    {
      "from": "jump",
      "to": "locomotion",
      "conditions": [{ "param": "grounded", "op": "eq", "value": true }],
      "duration": 0.15,
      "exitTime": 0.85
    }
  ],
  "blendTrees1D": [
    {
      "name": "locomotion",
      "param": "speed",
      "children": [
        { "clip": "idle", "threshold": 0 },
        { "clip": "walk", "threshold": 2 },
        { "clip": "run", "threshold": 6 }
      ]
    }
  ]
}
```

`clip` names an **animation group of the `.glb`**, by name. An event's `time` is a fraction of the
clip, in `[0, 1]`, and fires once per loop crossing.

### A tween

`app.tweens` is core, not this package, and it is what to reach for instead of a coroutine that
lerps by hand.

```ts run
import { createApp } from "ignifx";

const app = await createApp({ headless: true });
const door = app.world.createEntity("Door");

const tween = app.tweens.to(
  door.transform,
  { position: { x: 0, y: 3, z: 0 } },
  {
    duration: 0.8,
    ease: "cubicInOut",
    onComplete: (): void => app.log.info("open"),
  },
);
await app.start();
// `app.step(dt)` is clamped by `time.maximumDeltaTime` (0.1 s): half of a 0.8 s tween is 24 frames.
for (let frame = 0; frame < 24; frame += 1) {
  app.step(1 / 60);
}
app.log.info("halfway:", tween.progress);
```

### A companion that walks to the player

```ts run
import { createApp } from "ignifx";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";
import { NavMeshAgent, NavMeshSurface, threeD } from "@ignifx/3d";

const app = await createApp({ headless: true, extensions: [physics(), input(), threeD()] });

const level = app.world.createEntity("Level");
const surface = level.addComponent(NavMeshSurface, { agentRadius: 0.4, bakeOnAwake: false });
// Either bake from the enabled MeshRenderers on the matching layers, or hand over geometry.
// A 20x20 floor, wound so its normal points up:
surface.addSource([-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10], [0, 1, 2, 0, 2, 3], null);
await surface.bake();

const companion = app.world.createEntity("Companion", { position: { x: -8, y: 0, z: 0 } });
const agent = companion.addComponent(NavMeshAgent, { speed: 4, stoppingDistance: 0.6 });
agent.onArrived.connect((): void => app.log.info("arrived"), { owner: agent });

await app.start();
app.step(1 / 60); // The agent joins its crowd on the first fixed step.
agent.setDestination({ x: 8, y: 0, z: 0 });
```

Agents join their crowd on the next fixed step, so `setDestination` before the first `app.step`
answers `false`. Wait for `surface.onBaked`, or simply call it again next frame.

### Level of detail and billboards

```ts run
import { MeshRenderer, createApp } from "ignifx";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";
import { Billboard, LodGroup, threeD } from "@ignifx/3d";

const app = await createApp({ headless: true, extensions: [physics(), input(), threeD()] });

const tree = app.world.createEntity("Tree", { position: { x: 0, y: 0, z: 30 } });
const highDetail = tree.addComponent(MeshRenderer);
const lowDetail = app.world.createEntity("TreeFar", { parent: tree }).addComponent(MeshRenderer);
tree.addComponent(LodGroup, {
  levels: [
    { distance: 20, renderer: highDetail },
    { distance: 60, renderer: lowDetail },
  ],
  hysteresis: 0.1,
});

const nameplate = app.world.createEntity("Nameplate", { parent: tree });
nameplate.addComponent(Billboard, { mode: "yAxis" });
```

Past the last level's distance every renderer is off — that is how a group culls itself.

## File formats

| Format            | Extension        | Reference                           |
| ----------------- | ---------------- | ----------------------------------- |
| `ignifx.animator` | `.animator.json` | `skills/ignifx/references/formats/` |

## Gotchas

| Trap                                                           | What happens                                                                                                                                                                                                                         | Do this instead                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Two `Model`s of one `.glb`, each with an `Animator`            | The second animator is refused the clips (reported on `app.onError`) and both instances would share one pose anyway: Babylon Lite binds an animation group to one manager, and a cloned skinned mesh shares the template's skeleton. | One animated instance per model asset. Load a second copy of the `.glb` under a different address for a second animated character. |
| `.navmesh.bin` / `ignifx bake navmesh`                         | Babylon Lite 1.27.0 has no navmesh serialization at all. `NavMeshSurface.prebaked` logs a warning and bakes at runtime.                                                                                                              | Bake at runtime, or keep the bake cheap by baking from `addSource` geometry. See `docs/adr/0017-navigation-wasm.md`.               |
| Destroying `NavMeshAgent`s in a loop                           | Lite has no `removeAgent`; the slot is never freed and `maxAgents` fills up.                                                                                                                                                         | Re-bake the surface, which builds a fresh crowd, or pool your agents.                                                              |
| Reading `CharacterController.isGrounded` for animation         | Havok's character controller has no static friction, so it reports `false` on _any_ incline.                                                                                                                                         | Read `ThirdPersonController.isGrounded`, which classifies the ground against `slopeLimit`.                                         |
| Expecting `app.navigation.findPath` to work on the first frame | Recast is WebAssembly and loads asynchronously; nothing is baked yet, so the path is empty.                                                                                                                                          | `await surface.bake()`, or connect to `surface.onBaked`. Queries never throw — they answer empty.                                  |
| A tween on `transform.position` in a coroutine loop            | Two tweens on one property fight, and hand-rolled lerps ignore `timeScale`.                                                                                                                                                          | One `app.tweens.to(...)`; it latches its start value when its delay elapses.                                                       |

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `skills/ignifx/references/api/3d.md` for the
generated API · `docs/architecture/12-3d-toolkit.md` for design rationale ·
`docs/adr/0017-navigation-wasm.md` for how Recast is loaded and what it costs.

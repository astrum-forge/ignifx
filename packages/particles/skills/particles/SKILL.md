---
name: particles
description: Builds GPU particle effects in ignifx with @ignifx/particles: fire, smoke, sparks, explosions, weather and magic, declared in .particles.json and evaluated on the GPU from CPU-written spawn records. Use when adding or editing a particle effect, an emitter, or a .particles.json document in an ignifx project, or when the user mentions @ignifx/particles, ParticleSystem, particleDefinition, or app.particles.
license: Apache-2.0
metadata:
  ignifx-version: "0.2.1"
---

# @ignifx/particles

## What this is / when to use

`@ignifx/particles` draws effects: fire, smoke, sparks, explosions, rain, snow, dust, glints and
falling leaves. An effect is a **document** — a `.particles.json`, or the same object built in code —
and a `ParticleSystem` component plays it.

Use it for anything made of many small, short-lived, non-interacting pieces. Do not use it for
things that must collide, chain into one another, or be sorted against each other; the design
trades those away, and "Gotchas" below says what to do instead. For 2D sprite particles use
`@ignifx/particles-2d`, which reads the same documents.

## Environment

- Engine: ignifx `0.2.1`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Requires nothing but `@ignifx/core`. `@ignifx/physics` is optional: when it is registered, an
  effect that asks for "the world's gravity" reads the `physics` settings section.
- WebGPU only, browser and Electron. Babylon Lite `1.27.0` is a peer dependency, and this package
  imports none of it.
- Everything except the GPU upload runs under `createApp({ headless: true })`.
- Nothing happens at import time.

```ts
import { createApp } from "@ignifx/core";
import { particles } from "@ignifx/particles";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [particles({ maxParticles: 50_000 })] });
  await app.start();
}
```

## Mental model

A particle is **stateless**. The CPU writes one 48-byte _spawn record_ when the particle is born —
its birth time, lifetime, seed, start position, size, velocity and rotation — and never touches it
again. Every frame the vertex shader reads the record, subtracts the birth time from the system
clock, and computes the whole particle from closed formulas. A particle whose age has passed its
lifetime collapses to a point behind the far plane.

```
emit()  ──▶  spawn record  ──▶  ring buffer (capacity records)
                                      │
                     one updateStorageBuffer of the new records per frame
                                      ▼
              vertex shader: state(t) = f(record, clock)  ──▶  one instanced draw
```

| Thing                                        | Phase       | Order | Why there                                                                 |
| -------------------------------------------- | ----------- | ----- | ------------------------------------------------------------------------- |
| Emission (`ParticleUpdateSystem`)            | `Update`    | `900` | After every script's `update`, so `emit()` from a script draws this frame |
| Upload and uniforms (`ParticleRenderSystem`) | `PreRender` | `880` | Before core's shader-uniform and render-sync systems                      |

What follows from being stateless:

- **Pause is exact.** The system clock advances by the frame delta only while the app is not paused
  and the system is playing; freeze it and every particle freezes where it is.
- **The seed is the simulation.** Two systems with one seed, fed the same frame deltas, write
  identical records.
- **The frame rate does not change the result.** A particle's state is a function of its age.
- **Fast-forward is free.** `simulate(5)` is the same arithmetic as five seconds of frames.
- **Nothing is freed.** A record is overwritten by a newer one; `capacity` is the whole budget.

## First app

A campfire on a headless app: load a preset, play it, step the frame loop, count the flames.

```ts run
import { Camera, createApp } from "@ignifx/core";
import { ParticleSystem, particleAssetFromDefinition, particleDefinition, particles } from "@ignifx/particles";

const app = await createApp({ headless: true, extensions: [particles()] });

const eye = app.world.createEntity("Main Camera", { position: { x: 0, y: 1.5, z: -4 } });
eye.transform.lookAt({ x: 0, y: 0.5, z: 0 });
eye.addComponent(Camera);

await app.start();

// The third argument is a diagnostics label, not an address: in-code assets get a generated `memory:` address.
const fire = particleAssetFromDefinition(app, particleDefinition("fire"), "campfire");
const campfire = app.world.createEntity("Campfire", { position: { x: 0, y: 0.2, z: 0 } });
const system = campfire.addComponent(ParticleSystem, { definition: fire, seed: 7 });

for (let frame = 0; frame < 60; frame += 1) {
  app.step(1 / 60);
}

app.log.info(`alive: ${String(system.aliveCount)} of ${String(system.capacity)}`);
system.emit(20);
app.step(1 / 60);
app.log.info(`after a burst: ${String(system.aliveCount)}`);

app.dispose();
```

## Core APIs

### `ParticleSystem`

| Member                   | What it does                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `definition`             | The `.particles.json` handle it plays. Assigning a different one rebuilds the effect.                  |
| `playOnAwake`            | Play the first frame the component is enabled. The document's own `main.playOnAwake` must agree.       |
| `seed`                   | The emission seed. `0` uses the document's, and `0` there picks one at random on `play()`.             |
| `play()`                 | Start, or resume after `stop()`. A `prewarm` document fast-forwards one cycle first.                   |
| `stop({ clear })`        | Stop emitting. Live particles finish their lives unless `clear` is `true`.                             |
| `pause()` / `resume()`   | Hold and release the system clock. Everything freezes in place.                                        |
| `emit(count)`            | Spawn `count` particles at the current clock, playing or not. `qualityScale` does not apply.           |
| `simulate(seconds)`      | Fast-forward in sixtieths, emitting as it goes. What `prewarm` uses.                                   |
| `isPlaying` / `isPaused` | Playback state.                                                                                        |
| `aliveCount`             | How many particles are alive. Exact, on the CPU, headless too.                                         |
| `drawCount`              | How many records the GPU draws: the newest back to the oldest still alive.                             |
| `droppedCount`           | Spawns that displaced a particle that was still alive, because the capacity is too small for the rate. |
| `time`                   | The system's own clock, in seconds. `app.time` is never read.                                          |
| `capacity`               | The records it holds, after `app.particles.maxParticles` clamped the document's.                       |
| `onStopped`              | Emitted once when a non-looping system runs out of cycle and particles.                                |
| `evaluate(slot, out)`    | The CPU twin of the shader: one record's world state at the current clock. `@beta`, for tools.         |

Several effects may share one entity: `ParticleSystem` is `allowMultiple`.

### `app.particles`

| Member          | What it does                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `maxParticles`  | The budget every system's `capacity` is counted against. Default `100_000`.                         |
| `qualityScale`  | A `0`–`1` multiplier on every emission rate and burst count, read each frame. For settings screens. |
| `gravity`       | The world gravity a document's `forces.gravityMultiplier` scales. Defaults to `(0, -9.81, 0)`.      |
| `systems`       | Every attached `ParticleSystem`, in attach order.                                                   |
| `capacityInUse` | How much of the budget the attached systems hold.                                                   |
| `counters`      | The `particles` diagnostics group: `systems`, `alive`, `emitted`, `uploadBytes`, `drawCalls`.       |

### Presets

`particleDefinition(name, overrides?)` returns a complete document. The nine names are `fire`,
`smoke`, `sparks`, `explosion`, `dust`, `sparkle`, `rain`, `snow` and `leaves`. An object override
merges key by key; an array or a primitive replaces the whole value.

```ts
import { particleDefinition } from "@ignifx/particles";

export const bigFire = particleDefinition("fire", {
  main: { capacity: 512 },
  start: { size: { min: 0.6, max: 1 } },
});
```

### The module set

| Module         | Fields                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`         | `capacity`, `duration`, `looping`, `prewarm`, `startDelay`, `simulationSpace`, `seed`, `playOnAwake`, `timeScale`, `renderOrder`                                                                           |
| `emission`     | `rateOverTime`, `rateOverDistance`, `bursts: [{ time, count, cycles, interval, probability }]`                                                                                                             |
| `shape`        | `kind` (`point`, `sphere`, `hemisphere`, `cone`, `box`, `circle`, `edge`, `mesh`), `radius`, `thickness`, `arc`, `angle`, `length`, `size`, `emitFrom`, `randomDirection`, `spherizeDirection`, `vertices` |
| `start`        | `lifetime`, `speed`, `size`, `size3D`, `rotation`, `color`                                                                                                                                                 |
| `forces`       | `gravity`, `gravityMultiplier`, `drag`, `constantForce`, `orbit: { axis, speed }`, `noise: { strength, frequency, scroll, octaves, influenceOverLife }`                                                    |
| `overLifetime` | `color` (gradient), `size`, `sizeY`, `sizeZ`, `rotation` (angular speed)                                                                                                                                   |
| `renderer`     | `mode` (`billboard`, `stretched`, `horizontal`, `vertical`, `mesh`), `mesh`, `texture`, `sheet`, `blend`, `lit`, `pivot`, `speedScale`, `lengthScale`                                                      |

A **value** is a number, `{ "min": a, "max": b }` (rolled once per particle), or
`{ "curve": { "keys": [[t, v, inTangent, outTangent], …] } }` (read at the particle's age). A
**colour value** is `[r, g, b, a]`, `{ "min": …, "max": … }`, or `{ "gradient": [[t, r, g, b, a], …] }`.
Colours are sRGB in `0`–`1`; curves and gradients are baked into 64-sample rows both the CPU and the
GPU read the same way.

**Which way a shape faces.** Every shape is authored in the emitter's local space, and a directional
one sends particles along local `+Y`. Rotate the entity to aim it; a negative `start.speed` reverses
it. Two of them lie flat in the ground plane, which is the usual surprise:

| Shape                  | Spread                               | Direction                                                    |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `circle`               | X and Z, nothing in Y                | Radially outward in the XZ plane — a ring seen from above    |
| `edge`                 | X only                               | `+Y`                                                         |
| `box`                  | X, Y and Z by `size`                 | `+Y`                                                         |
| `cone`                 | X and Z on the base disc by `radius` | `+Y`, opening out by `angle` — a wide `angle` spreads in X/Z |
| `sphere`, `hemisphere` | X, Y and Z by `radius`               | Radially outward (`hemisphere` keeps `y >= 0`)               |
| `point`                | Nothing                              | `+Y`                                                         |
| `mesh`                 | The triangles you supply             | Along each face normal                                       |

A camera looking down `-Z` at a scene laid out in X and Y therefore sees a `circle` edge-on, as a
horizontal line, and sees a wide `cone` spread sideways while it travels up. For a fan in the camera
plane, use a `cone` with a small `angle` and let `shape.randomDirection` widen it, or rotate the
emitter ninety degrees about X so the circle faces the camera.

### Choosing a blend

| Blend           | Use it for                           | Why                                                                            |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| `premultiplied` | Smoke, dust, mixed effects (default) | Fire and smoke can share one draw and still composite front to back correctly. |
| `additive`      | Fire, sparks, glints, magic          | Light adds; overlapping particles get brighter, and black is transparent.      |
| `alpha`         | Rain, leaves, anything with an edge  | Straight alpha over the background, with no brightening.                       |

Particles never write depth and are never depth-sorted against each other. `main.renderOrder` orders
whole systems within the transparent phase; lower draws first.

## Recipes

### A muzzle flash a script fires

`emit()` runs before this frame's upload, so the flash appears on the frame the shot happens.

```ts
import { Script } from "@ignifx/core";
import { ParticleSystem } from "@ignifx/particles";

/** Fires one burst of sparks per shot. */
export class Muzzle extends Script {
  static typeId = "game/Muzzle";

  #sparks: ParticleSystem | null = null;

  awake(): void {
    this.#sparks = this.entity.getComponent(ParticleSystem);
  }

  fire(): void {
    this.#sparks?.emit(24);
  }
}
```

### A one-shot explosion that cleans itself up

```ts
import { Entity } from "@ignifx/core";
import { ParticleSystem, particleAssetFromDefinition, particleDefinition } from "@ignifx/particles";
import type { App } from "@ignifx/core";

/**
 * Spawns an explosion that destroys its own entity when the last ember dies.
 *
 * @param app - The running app.
 * @param at - Where to put it.
 * @returns The entity, which destroys itself.
 */
export function explodeAt(app: App, at: { x: number; y: number; z: number }): Entity {
  const asset = particleAssetFromDefinition(app, particleDefinition("explosion"), "explosion");
  const entity = app.world.createEntity("Explosion", { position: at });
  const system = entity.addComponent(ParticleSystem, { definition: asset });
  system.onStopped.connect(
    () => {
      entity.destroy();
    },
    { owner: entity },
  );
  return entity;
}
```

`onStopped` fires once, when a non-looping document has run out of cycle **and** its last particle
has died. A looping document never stops on its own.

### A rain document, as a file

```json
{
  "format": "ignifx.particles",
  "formatVersion": 1,
  "main": { "capacity": 2000, "duration": 2, "looping": true, "prewarm": true, "simulationSpace": "world" },
  "emission": { "rateOverTime": 600 },
  "shape": { "kind": "box", "size": { "x": 12, "y": 0.1, "z": 12 } },
  "start": { "lifetime": 1.2, "speed": { "min": -9, "max": -11 }, "size": 0.02, "color": [0.7, 0.8, 1, 0.5] },
  "forces": { "gravityMultiplier": 1 },
  "renderer": { "mode": "stretched", "blend": "alpha", "speedScale": 0.03 }
}
```

Load it the way any asset loads, and hand the handle to the component:

```ts
import { createApp } from "@ignifx/core";
import { ParticleSystem, particles } from "@ignifx/particles";
import type { ParticleAsset } from "@ignifx/particles";

const app = await createApp({ headless: true, extensions: [particles()] });
await app.start();
const weather = app.assets.load<ParticleAsset>("fx/rain.particles.json");
app.world.createEntity("Weather", { position: { x: 0, y: 10, z: 0 } }).addComponent(ParticleSystem, {
  definition: weather,
});
```

A negative `start.speed` on a `box` shape emits downward: directional shapes emit along the
emitter's local `+Y`, so a negative speed reverses it. `simulationSpace: "world"` leaves each drop
where it was emitted, so moving the emitter does not drag the storm with it.

### A quality setting

```ts
import type { App } from "@ignifx/core";

/**
 * Applies a three-step effects quality setting.
 *
 * @param app - The running app.
 * @param level - `"low"`, `"medium"` or `"high"`.
 */
export function setEffectsQuality(app: App, level: "low" | "medium" | "high"): void {
  app.particles.qualityScale = level === "low" ? 0.25 : level === "medium" ? 0.6 : 1;
}
```

`qualityScale` multiplies every rate and burst count on the next frame. It does not touch `emit()`,
because a script that asked for twenty-four sparks meant twenty-four.

### A trail that follows a moving emitter

```ts
import { particleDefinition } from "@ignifx/particles";

export const exhaust = particleDefinition("smoke", {
  main: { simulationSpace: "world", capacity: 256 },
  emission: { rateOverTime: 0, rateOverDistance: 12 },
  start: { lifetime: { min: 0.6, max: 1.2 }, size: { min: 0.1, max: 0.25 }, speed: 0.2 },
});
```

`rateOverDistance` emits per metre the emitter's entity moves, so a stationary ship makes no smoke.

## File formats

| Format             | Extension         | Reference                           |
| ------------------ | ----------------- | ----------------------------------- |
| `ignifx.particles` | `.particles.json` | `skills/ignifx/references/formats/` |

Every module and every field is optional; `defineParticles` fills in the defaults and refuses a
document it cannot read with `IGX-1701`, naming the exact path — `start.lifetime.min`, not "invalid
document". A misspelled key is an error, not a silent no-op.

## Gotchas

| Trap                                                       | What happens                                                                                                                            | Do this instead                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Expecting particles to collide, or to spawn more particles | Neither is a function of the particle's age, so the shader cannot compute it. There is no collision module and no sub-emitter.          | Hit an effect at the point your own code decides: play a second `ParticleSystem` there, or drive a `Rigidbody` for the few pieces that matter. |
| Expecting particles to sort against each other             | They never write depth and are never depth-sorted, so two overlapping systems composite in draw order.                                  | Use `additive` (order-independent), or set `main.renderOrder` to order whole systems.                                                          |
| A looping effect that starts empty and fills in            | Without `prewarm` the first cycle is the effect filling up; a campfire the player walks up to should already be burning.                | `"main": { "prewarm": true }` on a looping document, or call `system.simulate(seconds)` after `play()`.                                        |
| A rate the capacity cannot hold                            | The ring overwrites the oldest live particle, so the effect visibly thins out. `droppedCount` counts each one.                          | `capacity` at least `rateOverTime × the longest lifetime`. Check `system.droppedCount` after a few seconds.                                    |
| A system that draws nothing after a while                  | `app.particles.maxParticles` ran out and the system was clamped; `IGX-1702` was logged once, naming the entity.                         | Raise `maxParticles` in `ignifx.config.ts`, or give the document a smaller `capacity`.                                                         |
| `app.pause()` and an effect that keeps moving              | It cannot: the system clock advances only while `time.paused` is false. An effect that _should_ keep moving while paused has no switch. | Nothing to do — pause is exact. For a menu background, keep it in its own app or run it with `main.timeScale` and your own `simulate()`.       |
| `emit()` before the definition has loaded                  | `IGX-1705`: the system has no document, so it cannot spawn anything.                                                                    | Await the handle, or emit from `update` and let the first frames pass; `aliveCount` stays `0` until the document arrives.                      |
| The first frames of a new effect drawing nothing           | The generated program is loaded as an asset and compiled on first draw, which takes a few frames.                                       | Expect it, or warm the effect up during a loading screen by adding the system while the screen is still showing.                               |
| Reading `app.time.time` to age particles                   | A system's clock is its own: `timeScale`, `pause()` and `simulate()` all move it independently.                                         | Read `system.time`.                                                                                                                            |
| A gradient authored in linear colour                       | Document colours are sRGB in `0`–`1`, decoded on the way to the GPU, so linear values come out dark.                                    | Author the numbers you would type into a colour picker.                                                                                        |
| Expecting `stop()` to clear the screen                     | It stops emission; the live particles finish their lives, which is what a torch being put out looks like.                               | `stop({ clear: true })` to drop them all at once.                                                                                              |

- `simulate(seconds)` advances the records at once, but `aliveCount` and the draw count refresh in the next `app.step()`, when the update system runs its census.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `skills/ignifx/references/api/particles.md` for
the generated API · `docs/plan/2026-09-terrain-particles-shaders.md` §4 for the design ·
`docs/adr/0025-stateless-gpu-particles.md` for why particles are stateless and what that costs ·
`packages/particles-2d/skills/particles-2d/SKILL.md` for the same documents drawn as sprites.

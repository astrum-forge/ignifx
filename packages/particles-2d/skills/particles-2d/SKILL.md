---
name: particles-2d
description: Draws ignifx particle effects as sprites with @ignifx/particles-2d: the ParticleSystem2D component, one .particles.json shared with the 3D system, sprite atlases and sheet frames, sorting layers and blend modes, and the budget it shares with app.particles. Use when adding, editing or debugging 2D particle effects — fire, dust, sparkles, weather — in a sprite game, or when the user mentions @ignifx/particles-2d or ParticleSystem2D.
license: Apache-2.0
metadata:
  ignifx-version: "0.3.0"
---

# @ignifx/particles-2d

## What this is / when to use

`ParticleSystem2D` plays a `.particles.json` effect as sprites on a sorting layer. Use it in a
sprite game — torch fire, footstep dust, coin sparkle, rain — so the particles sort, blend and
pan with everything else `@ignifx/2d` draws. Use `@ignifx/particles`' `ParticleSystem` instead when
the effect belongs in a 3D scene. One document drives both.

## Environment

- Engine: ignifx `0.3.0`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Needs `@ignifx/2d` (the sprite layers it draws into) and `@ignifx/particles` (the document, the
  presets, and `app.particles`). Register all three; nothing happens at import time.
- No WGSL and no GPU work of its own: the particles are ordinary sprites, so everything here runs
  headless and on any device that runs `@ignifx/2d`.
- There is no `particles2d` settings section. The budget, the quality scale and the gravity are
  `app.particles`' (`particles` section), shared with the 3D systems.

```ts
import { twoD } from "@ignifx/2d";
import { createApp } from "@ignifx/core";
import { particles } from "@ignifx/particles";
import { particles2D } from "@ignifx/particles-2d";

const app = await createApp({
  canvas: document.querySelector("canvas") ?? document.createElement("canvas"),
  extensions: [twoD({ pixelsPerUnit: 16 }), particles(), particles2D()],
});
await app.start();
```

## Mental model

```
app.particles (ParticlesService)   maxParticles · qualityScale · gravity   ← shared with 3D
 │
 └─ ParticleSystem2D               one per effect; several may share an entity
     ├─ ParticleEmitterCore        the ring of spawn records, the clock, the emission schedule
     └─ SpriteBatch                `capacity` entity-less sprite slots in one Lite layer

Update      order 900   emit: a script's emit() in `update` is drawn the same frame
PreRender   order -460  write: every live record evaluated into a slot, before the 2D sync (-450)
```

A particle is never an entity. The component evaluates each live spawn record every frame and
writes position, size, rotation, colour and frame into one slot of its batch; `count` follows the
alive particles and the slots above it are hidden.

## First app

```ts
import { Camera2D, twoD } from "@ignifx/2d";
import { createApp, Vec2 } from "@ignifx/core";
import { particleDefinition, particleAssetFromDefinition, particles } from "@ignifx/particles";
import { ParticleSystem2D, particles2D } from "@ignifx/particles-2d";
import type { SpriteAtlasAsset } from "@ignifx/2d";

const canvas = document.querySelector("canvas") ?? document.createElement("canvas");
const app = await createApp({
  canvas,
  extensions: [twoD({ pixelsPerUnit: 16 }), particles(), particles2D()],
});
app.world.createEntity("Camera").addComponent(Camera2D);

// The atlas the particles draw frames of, and the effect they play.
const atlas = app.assets.load<SpriteAtlasAsset>("2d/fx.atlas.json").retain();
await atlas.promise;
const fire = particleAssetFromDefinition(app, particleDefinition("fire"), "memory:fire.particles.json");

const torch = app.world.createEntity("torch");
torch.transform.position2D = new Vec2(3, 1);
torch.addComponent(ParticleSystem2D, { definition: fire, atlas, sortingLayer: "Default" });

await app.start();
```

## Core APIs

### `ParticleSystem2D`

| Field          | Kind                      | Default     | Meaning                                                        |
| -------------- | ------------------------- | ----------- | -------------------------------------------------------------- |
| `definition`   | `asset(ParticleAsset)`    | `null`      | The `.particles.json` to play                                  |
| `atlas`        | `asset(SpriteAtlasAsset)` | `null`      | The atlas whose frames the particles draw; must be loaded      |
| `playOnAwake`  | `bool`                    | `true`      | Play the first frame it is enabled, if the document agrees     |
| `seed`         | `u32`                     | `0`         | `0` uses the document's; `0` there picks at random on `play()` |
| `sortingLayer` | `str`                     | `"Default"` | Which sorting layer the sprites draw on                        |

| Member                   | Meaning                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `play()`                 | Start, or resume after `stop()`; `prewarm` fast-forwards one cycle           |
| `stop({ clear })`        | Stop emitting; `clear: true` also forgets the live particles                 |
| `pause()` / `resume()`   | Hold and release the system's own clock                                      |
| `emit(count)`            | Spawn now, playing or not; from `update` they are drawn the same frame       |
| `simulate(seconds)`      | Fast-forward, emitting as it goes                                            |
| `isPlaying` / `isPaused` | The state `play`, `stop` and `pause` set                                     |
| `aliveCount`             | Exact live particles, as of the last frame                                   |
| `spriteCount`            | Slots the last frame drew; equals `aliveCount` while the system is enabled   |
| `capacity`               | The ring size in use, after `app.particles.maxParticles` clamped it          |
| `time`                   | The system's own clock, in seconds — what every particle's age measures from |
| `onStopped`              | `Signal<ParticleSystem2D>`, emitted once a non-looping system runs dry       |

The API is the 3D `ParticleSystem`'s, plus `atlas`, `sortingLayer` and `spriteCount`. Everything a
`.particles.json` declares is simulated identically, because both components run the same emitter
and the same evaluator.

### How a document becomes sprites

| Document field                             | What the 2D system does with it                                             |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `main.capacity`                            | The number of sprite slots claimed, after the shared budget clamps it       |
| `main.simulationSpace`                     | `"local"` follows the entity, `"world"` leaves particles where they spawned |
| `start.size`, `overLifetime.size`          | The sprite's width from `size.x` and height from `size.y`, in metres        |
| `start.rotation`, `overLifetime.rotation`  | Degrees counter-clockwise, as `Transform.rotation2D` reads                  |
| `start.color`, `overLifetime.color`        | The sprite tint, linear — the same values a `SpriteRenderer.color` holds    |
| `renderer.blend`                           | The layer's blend: `premultiplied`, `additive` or `alpha`                   |
| `renderer.sheet.tiles`                     | Frame **n** of the sheet is frame **n** of the atlas (see below)            |
| `forces.*`, `emission.*`, `shape.*`        | Simulated exactly as in 3D; the Z they produce is not drawn                 |
| `renderer.texture`, `mode`, `lit`, `pivot` | Ignored: the `atlas` field is the texture, and sprites are flat             |

**The frame rule.** The evaluator turns `renderer.sheet` into a tile index counted across rows, and
the 2D system uses that number as the **atlas frame index**, unchanged. So pack the atlas frames in
the same order as the sheet tiles and `tiles: { x: 2, y: 2 }` picks frames 0–3. A document with no
`sheet` draws frame 0. An index the atlas does not have draws frame 0 too, exactly as a
`SpriteRenderer` falls back.

**The Z rule.** Records are simulated in three dimensions — a cone shape, gravity and an orbit all
produce Z — but only X and Y are drawn, because 2D ordering is sorting layers, not depth
(`docs/architecture/11-2d-toolkit.md` §3). An effect written for a 2D scene should emit in the XY
plane; a `cone` pointing along +Z looks like a still point.

**Which way a shape faces.** Shapes are authored in the emitter's local space and directional ones
send particles along local `+Y`, which is "up" on screen. Two shapes lie flat in the ground plane
(X and Z), so a 2D camera sees them edge-on:

| Shape                  | Spread                               | Seen by a 2D camera                                             |
| ---------------------- | ------------------------------------ | --------------------------------------------------------------- |
| `circle`               | X and Z, nothing in Y                | A horizontal line; rotate the emitter 90° about X for a ring    |
| `edge`                 | X only                               | A line along X, particles travelling up                         |
| `box`                  | X, Y and Z by `size`                 | A rectangle of `size.x` by `size.y`                             |
| `cone`                 | X and Z on the base disc by `radius` | A fan travelling up; a wide `angle` spreads it sideways along X |
| `sphere`, `hemisphere` | X, Y and Z by `radius`               | A disc (`hemisphere` keeps `y >= 0`)                            |
| `point`                | Nothing                              | One spot, particles travelling up                               |

For a fan in the screen plane use a `cone` with a small `angle` and widen it with
`shape.randomDirection`.

### The shared budget

`app.particles` owns both dimensions. `maxParticles` is the ceiling every system's `capacity` is
taken from, in attach order; a system that does not fit is clamped and says so with `IGX-1702`.
`qualityScale` multiplies every emission rate and burst count, read each frame, which is what a
settings screen turns down. `app.diagnostics` carries a `particles-2d` group with `systems`,
`alive`, `emitted` and `sprites`, beside the 3D `particles` group.

```ts
import type { ParticlesService } from "@ignifx/particles";

/**
 * Turns every effect, 2D and 3D, up or down. Pass `app.particles`.
 *
 * @param particles - The shared service.
 * @param level - The quality the settings screen chose.
 */
export function applyQuality(particles: ParticlesService, level: "low" | "high"): void {
  particles.qualityScale = level === "low" ? 0.35 : 1;
}
```

## Recipes

### A torch that burns while the player is near

```ts
import { Script } from "@ignifx/core";
import { ParticleSystem2D } from "@ignifx/particles-2d";

export class TorchGlow extends Script {
  static typeId = "game/TorchGlow";

  #fire: ParticleSystem2D | null = null;

  awake(): void {
    this.#fire = this.entity.getComponent(ParticleSystem2D);
  }

  update(): void {
    const fire = this.#fire;
    if (fire === null) {
      return;
    }
    const near = this.transform.position2D.x < 10;
    if (near && !fire.isPlaying) {
      fire.play();
    } else if (!near && fire.isPlaying) {
      fire.stop();
    }
  }
}
```

### A burst of dust under a landing character

```ts
import { Script } from "@ignifx/core";
import { ParticleSystem2D } from "@ignifx/particles-2d";

export class LandingDust extends Script {
  static typeId = "game/LandingDust";

  #dust: ParticleSystem2D | null = null;

  awake(): void {
    this.#dust = this.entity.getComponent(ParticleSystem2D);
  }

  /**
   * Spawns the puff. Called from the controller the frame a jump ends.
   *
   * @param speed - The landing speed, in metres per second.
   */
  land(speed: number): void {
    // `emit` from `update` lands in the same frame: the write system runs after every script.
    this.#dust?.emit(Math.min(24, Math.round(speed * 3)));
  }
}
```

### One effect, two renderers

```ts
import { ParticleSystem } from "@ignifx/particles";
import { ParticleSystem2D } from "@ignifx/particles-2d";
import type { SpriteAtlasAsset } from "@ignifx/2d";
import type { App, AssetHandle } from "@ignifx/core";
import type { ParticleAsset } from "@ignifx/particles";

export function spawnSparks(
  app: App,
  definition: AssetHandle<ParticleAsset>,
  atlas: AssetHandle<SpriteAtlasAsset>,
  flat: boolean,
): void {
  const entity = app.world.createEntity("sparks");
  if (flat) {
    entity.addComponent(ParticleSystem2D, { definition, atlas, seed: 4 });
  } else {
    entity.addComponent(ParticleSystem, { definition, seed: 4 });
  }
}
```

### Counting particles headlessly

```ts run
import { Camera2D, twoD } from "@ignifx/2d";
import { createApp, createManualClock } from "@ignifx/core";
import { particleDefinition, particleAssetFromDefinition, particles } from "@ignifx/particles";
import { ParticleSystem2D, particles2D } from "@ignifx/particles-2d";

const clock = createManualClock();
const app = await createApp({
  headless: true,
  clock,
  extensions: [twoD(), particles(), particles2D()],
});

app.world.createEntity("Camera").addComponent(Camera2D);

const sparkle = particleAssetFromDefinition(app, particleDefinition("sparkle"), "memory:sparkle.particles.json");
const entity = app.world.createEntity("fx");
const system = entity.addComponent(ParticleSystem2D, { definition: sparkle });

// Headless there is no atlas to draw into, so the system reports `IGX-1754` once and simulates
// without drawing. Everything below — emission, ageing, the budget — is what a real frame runs.
for (let frame = 0; frame < 60; frame += 1) {
  clock.advance(1000 / 60);
  app.step(1 / 60);
}

app.log.info(`alive after a second: ${String(system.aliveCount)}`);
app.dispose();
```

## File formats

There is no format of this package's own. `ParticleSystem2D` reads `ignifx.particles`
(`.particles.json`), which `@ignifx/particles` defines and documents, and `ignifx.spriteatlas`
(`.atlas.json`), which `@ignifx/2d` defines. The generated tables are in
`skills/ignifx/references/formats/`.

The component serializes as any other: `definition` and `atlas` are asset references, `playOnAwake`,
`seed` and `sortingLayer` are plain fields.

## Gotchas

- **The atlas must be loaded before anything draws.** The component claims its slots on the first
  frame the handle is `"loaded"`; until then it reports `IGX-1754` once and draws nothing. Retain
  the handle for as long as the system lives.
- **No sorting inside a batch.** Slots draw in index order, oldest particle first, and Y-sort is a
  property of the layer, not of the batch. Put a large moving effect on a sorting layer that does
  not Y-sort: any position change marks a Y-sorting layer unsorted and costs a full re-sort and
  re-upload of it that frame.
- **Every particle is centred on its position.** A batch has no pivots, so `renderer.pivot` does
  nothing and a sprite frame's own pivot is ignored.
- **Particles are not pickable.** A slot holds no component, so `app.twoD.pickAt` never returns one.
- **An undeclared sorting layer falls back to `"Default"`** with `IGX-1756`, rather than throwing in
  the middle of a frame. Declare the layer in `ignifx.config.ts`.
- **The budget is shared.** A 3D system that attaches first can leave a 2D system with less capacity
  than its document asks for; the clamp is logged as `IGX-1702`.
- **`capacity` is fixed once a system starts.** Changing `main.capacity` means a new document; the
  component rebuilds its core and re-claims its slots when the `definition` handle's value changes.
- **The system's clock is its own.** `pause()` freezes it, and so does `app.pause()`; `app.time.time`
  is never read, so two effects with the same seed stay in step whatever the frame rate.
- **Sizes are metres, not pixels.** `start.size` of `0.5` is half a world unit wide, which is 8
  pixels at `pixelsPerUnit: 16`.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`packages/particles/skills/particles/SKILL.md` for the document and the presets ·
`packages/2d/skills/2d/SKILL.md` for atlases, sorting layers and cameras ·
`skills/ignifx/SKILL.md` for the engine entry skill ·
`docs/plan/2026-09-terrain-particles-shaders.md` §4 for the design.

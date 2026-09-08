---
name: 2d
description: Builds 2D games in ignifx with @ignifx/2d: Camera2D, SpriteRenderer, SpriteAnimator, texture atlases, Tilemap rendering and import, sorting layers and Y-sort, pixel-perfect cameras, parallax layers, and 2D picking. Use when adding or editing sprites, sprite animation, tilemaps, atlases, sorting layers, or a 2D camera in an ignifx project, or when the user mentions @ignifx/2d, Camera2D, SpriteRenderer, or Tilemap.
license: Apache-2.0
metadata:
  ignifx-version: "0.1.0"
---

# @ignifx/2d

## What this is / when to use

`@ignifx/2d` is the ignifx extension that draws **sprites**. It uses the same entities, transforms,
scripts, assets and phases as 3D — only the camera, the renderer and the sorting model differ.

Use it for anything drawn from a texture atlas: characters, tilemaps, HUD art, parallax backdrops,
2D pickable objects. Pair it with `@ignifx/physics-2d` for collision.

The whole toolkit works under `createApp({ headless: true })`: components keep their state, loaders
parse, `SpriteAnimator` advances on the stepped clock. Only the pixels need a GPU.

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- WebGPU only, browser and Electron. Babylon Lite `1.27.0` is a peer dependency.
- Register it like any extension; nothing happens at import time.

```ts
import { createApp } from "ignifx";
import { twoD } from "@ignifx/2d";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({
    canvas,
    settings: { sortingLayers: { sortingLayers: ["Background", "Default", "Foreground"] } },
    extensions: [twoD({ pixelsPerUnit: 16, ySort: { Default: true } })],
  });
  await app.start();
}
```

`ignifx.config.ts` carries the same settings under `twoD`, and a scene file's `settings.twoD` block
overrides them for that scene:

| Setting         | Default    | Meaning                                                             |
| --------------- | ---------- | ------------------------------------------------------------------- |
| `mode`          | `"sprite"` | `"sprite"` clears the frame; `"mixed"` composites over the 3D scene |
| `pixelsPerUnit` | `100`      | How many pixels one world metre spans                               |
| `ySort`         | `{}`       | Which sorting layers draw back-to-front by world Y                  |

Sorting layers themselves live in the **core** `sortingLayers` section, back to front, and the colour
a `"sprite"`-mode frame is cleared to is the core `rendering.clearColor` setting — see the Gotchas.

## Mental model

```
app.twoD (TwoDService)
 ├─ pixelsPerUnit · mode · sortingLayers
 ├─ mainCamera        the highest-priority enabled Camera2D
 ├─ pickAt(x, y)      CPU pick over the sprite layers → { entity, component, u, v }
 ├─ layers            one Lite Sprite2DLayer per (sortingLayer × atlas × blend × space)
 └─ registerTileObjectFactory(type, factory)

PostUpdate  → SpriteAnimator.advance + animated tiles   (ignifx's clock, so timeScale works)
PreRender   → camera view, sprite sync, tilemap chunks  (order -450)
```

World space is **metres, +Y up**. Lite draws in **pixels, +Y down**; the adapter is the only place
that flip lives. Z is never a draw order — sorting layers and `orderInLayer` are.

## First app

```ts
import { createApp, Vec2 } from "ignifx";
import { Camera2D, SpriteAnimator, SpriteRenderer, twoD } from "@ignifx/2d";
import type { SpriteAnimationAsset, SpriteAtlasAsset } from "@ignifx/2d";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [twoD({ pixelsPerUnit: 16 })] });

  const eye = app.world.createEntity("Camera");
  const camera = eye.addComponent(Camera2D);
  camera.orthographicSize = 5;

  const atlas = app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  const clips = app.assets.load<SpriteAnimationAsset>("2d/hero.spriteanim.json");
  await Promise.all([atlas.promise, clips.promise]);

  const hero = app.world.createEntity("Hero");
  hero.transform.position2D = new Vec2(0, 0);
  const sprite = hero.addComponent(SpriteRenderer);
  sprite.sprite = atlas.retain();
  sprite.sortingLayer = "Default";

  const animator = hero.addComponent(SpriteAnimator);
  animator.animations = clips.retain();
  animator.play("idle");

  await app.start();
}
```

Await the handles **before** `app.start()`, or pump frames after it: once the loop runs, a completed
load is delivered in `PreUpdate`.

## Core APIs

Full signatures: `skills/ignifx/references/api/2d.md`.

### `app.twoD` — `TwoDService`

| Member                                | Meaning                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `pixelsPerUnit` · `mode` · `settings` | The resolved `twoD` section, after any scene override      |
| `mainCamera`                          | The highest-priority enabled `Camera2D`, or `null`         |
| `pickAt(xPx, yPx)`                    | Topmost `SpriteRenderer` under a viewport pixel, or `null` |
| `screenToWorld` · `worldToScreen`     | Through the active camera                                  |
| `visibleWorldBounds(out)`             | The world rectangle the camera can see                     |
| `layers`                              | Diagnostics: every Lite layer in draw order                |
| `registerTileObjectFactory(type, fn)` | What a tilemap's objects layer spawns                      |
| `syncedLastFrame` · `spriteCount`     | How many sprites the last frame actually wrote             |
| `lite.renderer`                       | The Lite `SpriteRenderer`, or `null` headless              |

### Components

| Component (`typeId`)                             | Key fields                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `Camera2D` (`ignifx/Camera2D`)                   | `orthographicSize`, `pixelPerfect`, `referenceResolution`, `boundsMin`/`boundsMax`, `follow`, `deadZone`, `priority`    |
| `SpriteRenderer` (`ignifx/SpriteRenderer`)       | `sprite`, `color`, `flipX`/`flipY`, `sortingLayer`, `orderInLayer`, `blend`, `pivotOverride`, `screenSpace`, `pickable` |
| `SpriteAnimator` (`ignifx/SpriteAnimator`)       | `animations`, `defaultClip`, `playOnAwake`, `speed`; `play`/`stop`/`pause`/`resume`, `onClipEnded`, `onEvent`           |
| `Tilemap` (`ignifx/Tilemap`)                     | `map`, `chunkSize`; `getTile`/`setTile`, `worldToCell`/`cellToWorld`, `collisionData`, `onTileChanged`                  |
| `TilemapRenderer` (`ignifx/TilemapRenderer`)     | `atlas`, `sortingLayer`, `cullChunks`                                                                                   |
| `ParallaxLayer` (`ignifx/ParallaxLayer`)         | `sortingLayer`, `factor`, `repeatX`/`repeatY`, `repeatWidth`/`repeatHeight`                                             |
| `SpriteLayerEffect` (`ignifx/SpriteLayerEffect`) | `sortingLayer`, `kind`, `tint`, `params`, `shader`                                                                      |
| `Camera2DFollow` (`ignifx/Camera2DFollow`)       | A `Script`; reads `Camera2D`'s follow fields in `lateUpdate`                                                            |

### Importers

Pure functions, so a build step or a test can call them with no app:
`gridAtlas`, `importTexturePackerAtlas`, `importAsepriteAtlas`, `importAsepriteAnimations`,
`importTiledMap`, `importLdtkLevel`.

### Error codes

`IGX-1102` unextruded atlas frame (logged, not thrown) · `IGX-1103`/`IGX-1104`/`IGX-1105` unreadable
document · `IGX-1106` unknown frame · `IGX-1107` unknown sorting layer · `IGX-1108` unknown clip ·
`IGX-1109` unsupported import · `IGX-1110` duplicate object factory · `IGX-1111` cell out of range ·
`IGX-1112` duplicate extension · `IGX-1113` custom effect with no WGSL.

## Recipes

### Tilemap with spawned objects

```ts
import { createApp, Vec2 } from "ignifx";
import { Tilemap, TilemapRenderer, twoD } from "@ignifx/2d";
import type { SpriteAtlasAsset, TilemapAsset } from "@ignifx/2d";
import type { Entity } from "ignifx";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [twoD()] });

  app.twoD.registerTileObjectFactory("spawn", (context): Entity | null => {
    const player = context.world.createEntity(context.name);
    player.transform.position2D = new Vec2(context.position.x, context.position.y);
    return player;
  });

  const map = app.assets.load<TilemapAsset>("2d/level-1.tilemap.json");
  const tiles = app.assets.load<SpriteAtlasAsset>("2d/tiles.atlas.json");
  await Promise.all([map.promise, tiles.promise]);

  const level = app.world.createEntity("Level");
  level.addComponent(Tilemap).map = map.retain();
  level.addComponent(TilemapRenderer).atlas = tiles.retain();
  await app.start();
}
```

### Picking a sprite under the pointer

```ts run
import { Script } from "ignifx";

export class ClickToSelect extends Script {
  static typeId = "game/ClickToSelect";

  update(): void {
    const hit = this.app.twoD.pickAt(120, 80);
    if (hit !== null) {
      this.app.log.info(`picked ${hit.entity.name}`);
    }
  }
}
```

## File formats

Generated reference: `skills/ignifx/references/formats/`.

- **`.atlas.json`** (`ignifx.spriteatlas`) — `image` (an address relative to the document, resolved through the manifest; `/x.png` and URLs verbatim), `sampling`,
  `premultipliedAlpha`, and `frames: [{ name, x, y, w, h, pivot?, sourceSize? }]` in **image pixels
  with a top-left origin**. A pivot is `[x, y]` or `{ x, y }` in `[0, 1]` of the frame; `[0, 0]` is
  top-left. Address one frame with `"2d/hero.atlas.json#frame:idle_0"`.
- **`.spriteanim.json`** (`ignifx.spriteanimation`) — `atlas` plus
  `clips: [{ name, frames | from/to, fps, loop, events }]`. An event's `frame` is the index **within
  the clip**. `frames` is a list of frame names played in the order written and may skip around the
  sheet; `from`/`to` is an **inclusive range over atlas indices**, so every frame between the two
  endpoints plays — use `frames` when the run is not contiguous in the atlas.
- **`.tilemap.json`** (`ignifx.tilemap`) — tile size, `cellSize` in metres, tilesets with colliders
  and animations, layers of tile ids (dense or RLE, **top row first**), and an objects layer in
  world metres.

## Gotchas

- **`pixelsPerUnit` is 100 by default.** A 32-px sprite is 0.32 metres wide, so a camera with
  `orthographicSize = 5` shows about 31 sprites vertically. Set it to your art's pixel size (16, 32)
  for pixel art.
- **Cell `(0, 0)` is the bottom-left of a tilemap**, because the world is +Y up — but the file stores
  its rows **top first**, like every editor. `Tilemap` flips on load; `getTile` speaks cells.
- **`orderInLayer` only reorders inside a Y-sorted layer.** Without `ySort` for that sorting layer,
  Lite draws by insertion order. Turn Y-sort on, or use separate sorting layers.
- **A frame's pivot moves the sprite, not the layer.** Lite has one pivot per layer, so ignifx
  offsets each sprite instead. A `[0.5, 1]` pivot puts the entity's origin at the sprite's feet.
- **`pixelPerfect` ignores `orthographicSize`** and scales `referenceResolution` by a whole number
  instead. It does **not** change an atlas's sampling: write `"sampling": "nearest"` in the
  `.atlas.json`, because a texture's sampler is fixed at upload.
- **Tiles are not pickable.** They have no component, so `pickAt` skips them; use
  `Tilemap.worldToCell`, which is exact and free.
- **Register `SpriteLayerEffect` before the first sprite on its layer.** A Lite layer's shader is
  fixed at creation.
- **The sky of a `"sprite"`-mode frame is `rendering.clearColor`, and nothing else.** The sprite pass
  owns the frame and clears it, so neither `Camera.clearColor` nor `Environment.clearColor` reaches
  the screen in a 2D game — and `Camera2D` has no `clearColor` field. Set it in `ignifx.config.ts`
  under `rendering`, not per camera. In `"mixed"` mode the render scene clears instead and the 3D
  precedence applies as usual.
- **`clearColor` is sRGB and is presented as its linear value**, so a channel lands on screen at
  `srgbToLinear(value) * 255` rather than `value * 255`: `{ r: 0.6, g: 0.2, b: 0.9 }` reads back as
  bytes `81, 8, 201`, and a literal `#14181F` is almost black. That is the same in both 2D modes and
  on the 3D path — one setting, one colour — so pass the inverse if you are matching a page colour.
  Measured on 2026-09-08 (macOS arm64, SwiftShader, `packages/2d/test/clear-color.browser.test.ts`).
- **A world whose only camera is a `Camera2D` does not log `IGX-0706`.** Core's "no enabled camera"
  warning is suppressed while the sprite renderer has an active `Camera2D`, so a correct 2D-only
  scene is quiet. Build the camera **before** `app.start()`, as the templates do: a world that is
  still empty when the loop starts has no camera of any kind, and that does warn.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `docs/architecture/11-2d-toolkit.md` for
design rationale · `skills/ignifx/references/api/2d.md` for full signatures.

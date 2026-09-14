---
name: terrain
description: Builds heightmap and procedural terrains in ignifx with @ignifx/terrain: .terrain.json documents, 16-bit heightmaps and seeded noise, chunked geomipmapped level of detail with frustum culling, a splat surface shader on PBR, height/normal/raycast queries, HeightfieldCollider coupling, runtime sculpting, and seeded foliage scatter. Use when adding or editing outdoor ground in an ignifx project, or when the user mentions @ignifx/terrain, Terrain, TerrainScatter, .terrain.json, .r16, heightmaps, or splat maps.
license: Apache-2.0
metadata:
  ignifx-version: "0.2.1"
---

# @ignifx/terrain

## What this is / when to use

`@ignifx/terrain` is the ignifx extension that turns a heightmap — or a seed — into **ground**: a
chunked, level-of-detail mesh with blended texture layers, plus the queries a game asks of it
(`heightAt`, `normalAt`, `raycast`), a `HeightfieldCollider` by data, runtime sculpting, and seeded
foliage.

Use it for outdoor ground. Do **not** use it for interiors, a single flat plane (`MeshAsset.ground`
is core), or 2D tile maps (`@ignifx/2d`).

Everything except the draw works under `createApp({ headless: true })`: the height field, the splat
weights, every query, `colliderInit()`, and the whole scatter placement.

## Environment

- Engine: ignifx `0.2.1`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- WebGPU only, browser and Electron. Babylon Lite `1.27.0` is a peer dependency.
- Needs the `materialPlugins` rendering feature. `terrain()` declares it for you at registration.
- Nothing happens at import time.

```ts
import { createApp } from "ignifx";
import { terrain } from "@ignifx/terrain";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [terrain()] });
  await app.start();
}
```

## Mental model

| Thing              | What it is                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `.terrain.json`    | The document: size, resolution, heightmap or noise, chunking, layers, splat.              |
| `TerrainAsset`     | One loaded document: the height field, the splat weights, the layer textures, the shader. |
| `Terrain`          | The component on an entity: builds the chunk meshes and answers every query.              |
| `TerrainLodSystem` | One `PreRender` pass: builds terrains whose asset arrived, picks levels, culls chunks.    |
| `TerrainScatter`   | Seeded foliage on an `InstancedMeshRenderer`, placed once from the terrain and the rules. |

```
.terrain.json ─▶ TerrainAsset ─▶ Terrain ─▶ chunks x LODs (Babylon Lite meshes, not entities)
                     │                └─▶ heightAt / normalAt / raycast / colliderInit / setHeights
                     └─▶ terrainSplat surface shader on one PBR material
```

The field is centred on the entity: local X spans `-width/2 .. +width/2`, Z the same, heights run
`0 .. size.height`. Queries take **world** coordinates and honour the entity's position and scale.

| System             | Phase       | Order | Why there                                                                         |
| ------------------ | ----------- | ----- | --------------------------------------------------------------------------------- |
| `TerrainLodSystem` | `PreRender` | `10`  | After core's render sync, which is what writes the camera the frustum test reads. |

## First app

A seeded noise terrain, two layers blended by slope, and the height under the origin. Compiles and
runs headlessly.

```ts run
import { Camera, createApp, Light } from "@ignifx/core";
import { Terrain, terrain, terrainAssetFromDefinition } from "@ignifx/terrain";

const app = await createApp({ headless: true, extensions: [terrain()] });

const island = await terrainAssetFromDefinition(app, {
  size: { width: 256, depth: 256, height: 40 },
  resolution: 257,
  chunks: { size: 64, lodLevels: 3, lodDistance: 96, skirtDepth: 2 },
  noise: { seed: 7, octaves: 5, frequency: 0.01 },
  layers: [
    { name: "grass", color: [0.25, 0.6, 0.25] },
    { name: "rock", color: [0.5, 0.5, 0.5] },
    { name: "snow", color: [0.95, 0.97, 1] },
  ],
  // `slope` bands are degrees; `height` bands are metres of the terrain's `size.height` range.
  splatRules: [
    { layer: "grass", slope: [0, 30] },
    { layer: "rock", slope: [25, 90] },
    { layer: "snow", height: [22, 30], slope: [0, 35] },
  ],
});

const eye = app.world.createEntity("Main Camera");
eye.transform.localPosition.set(0, 60, -120);
eye.transform.lookAt({ x: 0, y: 0, z: 0 });
eye.addComponent(Camera, { near: 0.5, far: 1000, fov: 60 });

const sun = app.world.createEntity("Sun");
sun.transform.lookAt({ x: 1, y: -1, z: 1 });
sun.addComponent(Light, { type: "directional", intensity: 3 });

const ground = app.world.createEntity("Terrain");
const field = ground.addComponent(Terrain, { definition: island });

await app.start();
app.step(1 / 60);
app.log.info(`ground height at the origin: ${field.heightAt(0, 0).toFixed(2)} m`);
```

## Core APIs

### `Terrain`

| Field            | Type                        | Default | Meaning                                       |
| ---------------- | --------------------------- | ------- | --------------------------------------------- |
| `definition`     | `AssetHandle<TerrainAsset>` | `null`  | The document this terrain draws.              |
| `lodBias`        | `number`                    | `1`     | Multiplies every level threshold.             |
| `receiveShadows` | `boolean`                   | `true`  | Whether shadow maps darken the ground.        |
| `frustumCulling` | `boolean`                   | `true`  | Whether chunks outside the camera are hidden. |

| Member                                            | Answers                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `heightAt(x, z)`                                  | World Y of the surface under a world XZ, bilinear.                    |
| `normalAt(x, z, out)`                             | The unit surface normal, into `out`.                                  |
| `slopeAt(x, z)`                                   | Degrees from horizontal, `0` flat, `90` vertical.                     |
| `raycast(ray, out)`                               | `true` and fills a `TerrainHit` where a world ray meets the ground.   |
| `bounds(out)`                                     | The world box, as `[minX, minY, minZ, maxX, maxY, maxZ]`.             |
| `worldToSample(x, z, out)` / `sampleToWorld(...)` | The sample grid in both directions.                                   |
| `size` / `resolution` / `heights`                 | The document's extent, samples per side, and the live height array.   |
| `colliderInit(region?)`                           | The `HeightfieldCollider` init, by data.                              |
| `regionCenter(region, out)`                       | A region's centre, for the collider's child entity.                   |
| `setHeights(x, z, width, depth, heights)`         | Sculpts, rebuilds the chunks it touches, raises `onHeightsChanged`.   |
| `setSplat(layer, x, z, width, depth, weights)`    | Paints one layer's weights and re-uploads the control map.            |
| `onHeightsChanged`                                | `Signal<TerrainRegion>`, after every sculpt.                          |
| `chunkCount` / `visibleChunks` / `drawCalls`      | How many chunks exist, show, and cost a draw.                         |
| `lodOf(chunkX, chunkZ)`                           | The level a chunk is showing.                                         |
| `asset` / `material` / `isLoaded`                 | The loaded asset, the PBR material, and whether the document arrived. |

Every query allocates nothing: the vector answers take an `out` parameter, and the entity's matrix
is decoded only when it moves.

### `TerrainScatter`

| Field                                   | Default               | Meaning                                           |
| --------------------------------------- | --------------------- | ------------------------------------------------- |
| `mesh` / `material`                     | `null`                | What each instance draws.                         |
| `lodMesh` / `lodDistance`               | `null` / `40`         | A cheaper mesh past that many metres.             |
| `density`                               | `0.5`                 | Instances per square metre.                       |
| `layers` / `layerThreshold`             | `[]` / `0.5`          | Splat layers to stand on; empty means everywhere. |
| `slope` / `height`                      | `0..35` / all         | The bands a candidate must fall in.               |
| `scale` / `randomYaw` / `alignToNormal` | `0.8..1.2` / on / off | How each instance is turned and sized.            |
| `seed`                                  | `1`                   | The placement seed.                               |
| `maxInstances`                          | `50000`               | The cap, which also sizes the GPU buffer.         |
| `count` / `regenerate()`                | —                     | How many stand, and how to place them again.      |

### Diagnostics

`app.diagnostics.group("terrain")` publishes `chunks`, `visibleChunks`, `drawCalls`, and
`scatterInstances` every frame.

### Errors

| Code       | Means                                                             |
| ---------- | ----------------------------------------------------------------- |
| `IGX-1601` | The document is not a readable `ignifx.terrain`.                  |
| `IGX-1602` | `resolution` is not `2^n + 1`, or does not fit the chunking.      |
| `IGX-1603` | An 8-bit heightmap was loaded; it terraces. Logged, never thrown. |
| `IGX-1604` | The terrain's entity is rotated, which queries do not honour.     |
| `IGX-1605` | The document declares no layer, or more than eight.               |
| `IGX-1606` | An image is not one the built-in PNG decoder reads.               |
| `IGX-1607` | Two layer textures are different sizes.                           |
| `IGX-1608` | A heightmap decoded to the wrong number of samples.               |
| `IGX-1609` | A query ran before the document was delivered.                    |
| `IGX-1610` | A region falls outside the field or the control map.              |
| `IGX-1611` | A rule or a scatter names a layer the terrain does not declare.   |
| `IGX-1612` | A `TerrainScatter` found no `Terrain` on it or on any ancestor.   |

## Recipes

### Level of detail and culling

Each chunk is built at every level, and exactly one of them is visible. Level `n` samples every
`2^n`-th height, so a 64-quad chunk is 65, 33, 17 and 9 vertices per side. `TerrainLodSystem` picks
the level from the main camera's distance to the chunk's world box, with a ten per cent hysteresis
band so a camera sitting on a threshold does not flip every frame, then tests that box against the
camera's six frustum planes and hides what fails. Babylon Lite does not cull plain meshes, so this
is the only culling a terrain gets.

Every level of a chunk carries its **real** heights and a downward skirt on all four edges, which is
what hides the crack where two neighbours show different levels. Popping is bounded by the chunk
size: smaller chunks pop less and cost more draws.

```ts
import type { Terrain } from "@ignifx/terrain";

export function report(ground: Terrain): string {
  return `${String(ground.visibleChunks)}/${String(ground.chunkCount)} chunks, LOD ${String(ground.lodOf(0, 0))}`;
}
```

Raise `lodBias` above `1` to keep fine meshes further out; drop it below `1` for a quality slider.

### Physics, by data

`@ignifx/terrain` does not depend on `@ignifx/physics`: a terrain without physics costs no physics
code. `colliderInit()` returns the fields a `HeightfieldCollider` declares, in the terrain's local
frame, and the collider applies the entity's scale itself.

```ts
import { Script } from "@ignifx/core";
import { HeightfieldCollider } from "@ignifx/physics";
import { Terrain } from "@ignifx/terrain";

export class GroundCollider extends Script {
  static typeId = "game/GroundCollider";

  start(): void {
    const ground = this.entity.requireComponent(Terrain);
    const collider = this.entity.addComponent(HeightfieldCollider, ground.colliderInit());
    ground.onHeightsChanged.connect(
      () => {
        Object.assign(collider, ground.colliderInit());
        collider.rebuild();
      },
      { owner: this },
    );
  }
}
```

`rebuild()` is what pushes new heights into Havok; assigning the fields alone changes nothing that
is already simulating.

`colliderInit(region)` covers part of the field, which is what a terrain too large for one collider
wants. A `HeightfieldCollider` always centres its shape on its **own** entity and ignores
`Collider.center`, so a region collider goes on a child entity placed at `regionCenter(region, out)`.

### Sculpting

```ts
import type { Terrain } from "@ignifx/terrain";

export function raise(ground: Terrain, x: number, z: number, side: number, metres: number): void {
  const patch = new Float32Array(side * side);
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const at = (z + row) * ground.resolution + x + column;
      patch[row * side + column] = (ground.heights[at] ?? 0) + metres;
    }
  }
  ground.setHeights(x, z, side, side, patch);
}
```

`setHeights` rewrites the positions and normals of every chunk the rectangle touches — one sample
wider on each side, because a normal reads its neighbours — and raises `onHeightsChanged` so a
collider and a scatter follow. `setSplat` paints one layer's weights and re-uploads that rectangle
of the control map.

### Foliage

Placement is a pure function of the seed, the terrain, and the rules, so a headless test asserts the
same instances a device draws. It runs once, not per frame: change a rule and call `regenerate()`.

```ts
import { MeshAsset, TextureAsset } from "@ignifx/core";
import { createFoliageMaterial, TerrainScatter } from "@ignifx/terrain";
import type { App, Entity } from "@ignifx/core";

export async function addGrass(app: App, ground: Entity): Promise<TerrainScatter> {
  const albedo = await app.assets.loadAsync<TextureAsset>("terrain/grass_card.png");
  return ground.addComponent(TerrainScatter, {
    mesh: MeshAsset.plane(app, { width: 1, height: 1 }),
    material: await createFoliageMaterial(app, { albedo, wind: { strength: 0.3, frequency: 1.2 } }),
    density: 2,
    layers: ["grass"],
    slope: { x: 0, y: 25 },
    maxInstances: 20_000,
  });
}
```

`foliageMaterialDefinition({ albedo, wind })` is a **shader material**: it owns its vertex stage, so
the wind can read the clock. That is what it costs — see the gotchas.

### 16-bit heightmaps and the CLI

8-bit heightmaps terrace: 256 steps over an 80 m range is a 31 cm stair on every slope. `.r16` is
the canonical format — little-endian `uint16`, row-major, `resolution * resolution` samples, no
header — because it is exact in Node and in the browser alike. 16-bit PNG loads too, through the
package's own decoder, since no browser image API returns 16 bits.

```sh
ignifx import heightmap island.png island.r16
```

An 8-bit source converts, and the command says on stderr that the heights are already terraced
(`IGX-1406`). Loading one warns with `IGX-1603`.

## File formats

| Format           | Extension       | Reference                           |
| ---------------- | --------------- | ----------------------------------- |
| `ignifx.terrain` | `.terrain.json` | `skills/ignifx/references/formats/` |
| raw heightmap    | `.r16`          | This page, below.                   |

```jsonc
{
  "format": "ignifx.terrain",
  "formatVersion": 1,
  "name": "island",
  "size": { "width": 512, "depth": 512, "height": 80 }, // metres; height is the full range
  "resolution": 513, // samples per side, 2^n + 1
  "heightmap": { "source": "island.r16" }, // or omit it and give "noise"
  "chunks": { "size": 64, "lodLevels": 4, "lodDistance": 96, "skirtDepth": 2 },
  "layers": [
    { "name": "grass", "albedo": "grass.png", "normal": "grass_n.png", "tiling": 8 },
    { "name": "rock", "albedo": "rock.png", "tiling": 6, "triplanar": true },
  ],
  "splatRules": [
    { "layer": "grass", "slope": [0, 30] },
    { "layer": "rock", "slope": [25, 90] },
  ],
  "material": { "roughness": 0.9, "metallic": 0 },
}
```

Every address is read **relative to the document**. `splat: { "control": ["island_splat.png"] }`
paints the weights instead of generating them: one RGBA image per four layers, one channel each. A
document declares painted maps or rules, never both.

`.r16` is registered under the asset type `heightmap`; `.terrain.json` under `terrain`.

## Gotchas

- **PBR hosts only.** The splat is a surface shader, and a surface shader attaches to a PBR
  material. `terrain()` declares the `materialPlugins` rendering feature; without it the shader is
  inert and core reports `IGX-0716`.
- **Per-layer roughness is not available.** Babylon Lite's PBR template declares `roughness` as a
  `let`, so a plugin cannot drive it. `material.roughness` and `material.metallic` are shared by the
  whole surface.
- **Eight layers, two control maps.** Beyond that the document is refused with `IGX-1605`.
- **Chunks receive shadows but do not cast them.** Core collects shadow casters from renderer
  components, and chunk meshes are not components. A hill does not shadow the valley beside it.
- **Popping is bounded by chunk size.** Smaller chunks and a higher `lodBias` reduce it; both cost
  draw calls.
- **A rotated terrain is read as if it were not.** Queries honour translation and scale; a rotation
  logs `IGX-1604` once. Rotate the world, not the ground.
- **`maxInstances` sizes the GPU buffer.** Babylon Lite fixes an instance buffer before the scene is
  registered, so set it before `app.start()`; raising it afterwards is refused with `IGX-0717`.
- **Foliage is a shader material.** It casts shadows as a solid card and receives none, and gets no
  image-based lighting and no fog. A `displace` surface hook cannot replace it: plugin uniforms are
  fragment-stage only, so the hook has no clock.
- **A query before the document arrives throws `IGX-1609`.** Await the handle, or read `isLoaded`.
- **Queries need one stepped frame.** The height field is built by the LOD system in `PreRender`,
  so `heightAt` works after `app.start()` and one `app.step()`. Add the camera before that step, or
  core logs `IGX-0706` once for the frame without one. Everything placed on the ground — props, the
  player, the collider — is created after that first step.
- **Rule bands have units.** `splatRules[].slope` is degrees and `splatRules[].height` is metres of
  `size.height`; a `height: [0.8, 1]` meant as a fraction paints almost nothing and raises no error.
- **The scatter places once.** Changing `density` or `seed` at runtime needs `regenerate()`; a
  sculpt triggers one by itself.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `skills/ignifx/references/api/terrain.md` for
the generated API · `skills/ignifx/references/formats/` for the document schema ·
`docs/architecture/07-rendering.md` and `docs/adr/0023-terrain-chunked-geomipmapping.md` for the
design and what it costs.

`docs/migrations/` exists only after 1.0.

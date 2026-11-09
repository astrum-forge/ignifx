# Baked lighting

Three components light a 3D scene from data prepared ahead of time instead of from the frame:
`ReflectionProbe` (what shiny surfaces reflect), `LightProbeVolume` (the diffuse light that moving
and static objects receive) and a `MeshRenderer`'s `lightmap` record (baked light painted onto
static surfaces). All three are `@beta`, work at every quality tier, and load their GPU code only
once a world uses them. Field tables are in [`../formats/components.md`](../formats/components.md);
the per-component prose is in [`rendering.md`](rendering.md) §1. Rationale in
`docs/architecture/07-rendering.md` §2.15 and `docs/plan/2026-11-gi-phase-2-execution-plan.md`.

## 1. Which one to use

| Need                                                   | Use                                    | Costs                                                  | Data                              |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------ | --------------------------------- |
| Mirrors, metal and wet floors that show the room       | `ReflectionProbe`                      | Six scene passes per capture, nothing between captures | None: captured at run time        |
| Coloured, directional indirect light on moving objects | `LightProbeVolume`                     | Eight texel fetches per pixel (≤ 0.3 ms estimated)     | A `.probes.json` grid             |
| Soft baked shadows and bounce on static level geometry | `MeshRenderer.lightmap`                | One texture fetch per pixel (≤ 0.1 ms estimated)       | A `.lightmap.json` plus a texture |
| One bounce of the lit scene that follows the frame     | `PostProcessStack.ssgi` (screen space) | Desktop `"high"` tier only; misses what is off screen  | None                              |
| Contact darkening in creases                           | `rendering.ambientOcclusion` (GTAO)    | Half resolution from `"low"`, full at `"high"`         | None                              |

They combine. A typical level uses a lightmap on its static walls and floors, one light-probe volume
so characters walking through match them, and a reflection probe per room with `boxProjection` set
to the room's size. Baked lighting is the phone and low-end path; SSGI and full-resolution GTAO are
for desktops. Both kinds of probe replace part of the `Environment`'s image-based light, so they
need a loaded `Environment` cube map (an `.env` or `.environment.json`) to have anything to replace:
without one a `ReflectionProbe` loads nothing and a volume does nothing.

## 2. Reflection probes: no file

A `ReflectionProbe` renders six views from its entity's position into a cube map, builds a
box-filtered mip chain, and every lit PBR material reflects the nearest enabled probe instead of the
environment (a probe whose `boxProjection` box holds the mesh wins, then the closest). There is no
file and no bake: the capture is the bake. `refreshMode: "once"` (default) captures when the
environment is ready and again on `probe.refresh()`, so call `refresh()` after the static scene
around it changes (a door opens). `"onDemand"` captures only on `refresh()`; `"everyFrame"` captures
every frame and is for one probe on a desktop at `"high"`. `cullingMask` limits the capture to
layers; editor-only meshes (gizmos, grids) are never captured. Diffuse light is untouched: pair a
probe with a `LightProbeVolume` for that.

```ts
import type { World } from "@ignifx/core";
import { ReflectionProbe } from "@ignifx/core";

/** One probe in the middle of an 8 × 3 × 8 m room; reflections line up with its walls. */
export function addRoomProbe(world: World): ReflectionProbe {
  const entity = world.createEntity("Room probe", { position: { x: 0, y: 1.5, z: 0 } });
  return entity.addComponent(ReflectionProbe, { size: 128, boxProjection: { x: 8, y: 3, z: 8 } });
}
```

## 3. Light probes: `.probes.json`

A `LightProbeVolume` points at a `LightProbeAsset`: a regular grid of first-order spherical
harmonics. Every lit PBR material blends the eight probes around each pixel, so shared materials
and moving objects need nothing extra; outside the grid the edge probes apply. The probe term is
scaled by the material's `occlusion`, the same value GTAO darkens. When several volumes are
enabled the one created last wins; `intensity` scales the probes' light without a rebuild.

The file (`format: "ignifx-probes"`, `formatVersion: 1`; generated table:
[`../formats/ignifx-probes.md`](../formats/ignifx-probes.md)):

| Field          | Meaning                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `origin`       | World position of probe `(0, 0, 0)`                                                                                                |
| `cellSize`     | Metres between neighbouring probes per axis; positive                                                                              |
| `counts`       | Probes per axis, whole numbers; `counts.x` ≤ 1024 and `counts.y × counts.z` ≤ 4096                                                 |
| `coefficients` | 12 linear-RGB floats per probe, `c0, c1, c2, c3`, X fastest then Y then Z; light for normal `n` is `c0 + c1·n.y + c2·n.z + c3·n.x` |

Load it with `app.assets.loadAsync<LightProbeAsset>("lighting/hall.probes.json")`, or publish a grid
built in code with `createLightProbeAsset(app, data)`. `writeLightProbeFile(data)` gives the JSON to
save, and `sampleLightProbes(data, x, y, z, normal)` reads a grid on the CPU the way the shader does.
A malformed file is `IGX-0709`.

## 4. Lightmaps: `.lightmap.json`

A `MeshRenderer`'s `lightmap` record (`asset`, `mode`, `level`, `gamma`, `uv2`) samples a baked
texture through the mesh's second UV set (`uvs2`; `uv2: false` uses the first). Only a renderer on a
**static** entity (`entity.isStatic`, set in the file or before `awake`) with a **PBR** material
samples it; anything else draws without it and logs `IGX-0735` once. Such a renderer draws with its
own copy of its material, so later edits of the shared `MaterialAsset` do not reach it. `mode: "add"`
adds the baked light; `"shadowmap"` multiplies the shading by it (a baked shadow mask under
real-time lights). `rendering.features.lightmaps` is not needed.

The file (`format: "ignifx-lightmap"`, `formatVersion: 1`; generated table:
[`../formats/ignifx-lightmap.md`](../formats/ignifx-lightmap.md)) names the `texture` by asset
address, which the loader loads with it, and may give per-entity-uid `entries` of
`{ scale: { x, y }, offset: { x, y } }` for an atlas. Entries are validated, but only the identity is
drawn yet (§8). `createLightmapAsset(app, texture, entries?)` publishes one built in code, such as a
`TextureAsset.fromPixels` texture.

## 5. Baking light probes

`bakeLightProbes(world, options)` is the engine's only baker. It runs on the CPU with no device, so
it works in a Node tool, in an editor, in a test, or in the game while a level loads. It reads the
world **once**, when it starts:

- **Geometry.** The triangles of every enabled `MeshRenderer` whose mesh was built with
  `MeshAsset.fromData`. Primitives (`MeshAsset.box`, `ground`, …) and glTF models keep their
  triangles on the GPU only, so they neither block nor bounce light; `result.skipped` counts them.
  Give the bake `fromData` stand-ins for geometry that matters.
- **Surfaces.** A hit's colour is its first material's base colour (PBR, darkened by `metallic`) or
  diffuse colour (Standard); textures are not read.
- **Lights.** Every enabled `Light`: directional, point and spot (cones ignored) with a shadow ray;
  hemispheric unshadowed. Rays that miss return `sky` plus the hemispheric lights. One bounce.
- **Options.** The grid (`origin`, `cellSize`, `counts`, as in the file), `rays` per probe (1–4096,
  default 128), `maxDistance` (default 100 m) and `sky` (linear radiance, default black); see
  `LightProbeBakeOptions` in [`../api/core.md`](../api/core.md) for every bake option. A bad grid or
  option is `IGX-0734` before anything is traced.
- **Progress and abort.** It yields to the host about every 8 ms of work, calls
  `onProgress(done, total)` after each probe, and checks `signal` after each probe; an aborted bake
  rejects with the signal's reason.
- **Result.** `{ data, triangles, skipped }`. Use `data` at once with `createLightProbeAsset`, or
  save `JSON.stringify(writeLightProbeFile(data))` as a `.probes.json` under the asset root.

Cost grows with probes × rays × triangles: bake small, static scenes, never per frame.

```ts
import type { App } from "@ignifx/core";
import { LightProbeVolume, bakeLightProbes, createLightProbeAsset, writeLightProbeFile } from "@ignifx/core";

/** Bakes the loaded level, lights it with the result, and returns the file to save. Cancellable. */
export async function bakeLevel(app: App, signal: AbortSignal): Promise<string> {
  const baked = await bakeLightProbes(app.world, {
    origin: { x: -8, y: 0.5, z: -8 },
    cellSize: { x: 2, y: 2, z: 2 },
    counts: { x: 9, y: 3, z: 9 },
    rays: 256,
    signal,
    onProgress: (done, total) => {
      app.log.info(`probes ${String(done)}/${String(total)}`);
    },
  });
  if (baked.skipped > 0) {
    app.log.warn("renderers without CPU triangles were ignored:", baked.skipped);
  }
  const probes = createLightProbeAsset(app, baked.data);
  app.world.createEntity("Baked probes").addComponent(LightProbeVolume, { probes });
  return JSON.stringify(writeLightProbeFile(baked.data));
}
```

The recipe [`../recipes/bake-and-load-light-probes.md`](../recipes/bake-and-load-light-probes.md)
bakes in Node, writes the file, and loads it back; [`../recipes/assign-a-lightmap.md`](../recipes/assign-a-lightmap.md)
gives a static floor a lightmap. Reflection probes need no bake, and lightmaps have no baker in the
engine (§8).

## 6. Quality tiers

`rendering.quality` caps reflection probes only; light probes and lightmaps run unchanged at every
tier, because baked lighting is the low-end path.

| Tier       | Reflection probe `size` | `"everyFrame"`                    | Light probes, lightmaps | SSGI    | GTAO   |
| ---------- | ----------------------- | --------------------------------- | ----------------------- | ------- | ------ |
| `"low"`    | clamped to ≤ 64         | captures as `"once"`, one warning | on                      | off     | half   |
| `"medium"` | clamped to ≤ 128        | captures as `"once"`, one warning | on                      | off     | half   |
| `"high"`   | clamped to ≤ 256        | allowed                           | on                      | allowed | full   |
| `"custom"` | 16–1024, as authored    | allowed                           | on                      | as set  | as set |

The tier is read every frame: `size` is clamped to 16 and the tier's maximum, then rounded down to
a power of two.

## 7. Edit mode and headless

- **Edit mode** (`createApp({ editMode: true })`) renders, so an editor's scene view shows all
  three: probes capture as in a game (an `"everyFrame"` probe keeps costing six passes a frame), a
  volume lights the view, and lightmaps draw. `entity.isStatic` stays writable in edit mode, and a
  renderer picks its lightmap up or drops it on the next frame after the flag changes. Scripts do
  not run, so a bake is started by the tool (or a `runInEditMode` script), not by a game script.
  After moving static geometry, call `probe.refresh()` and bake the volume again: nothing re-bakes
  by itself.
- **Headless** apps load and validate both files, run `bakeLightProbes`, and answer
  `sampleLightProbes`; nothing captures or draws.
- **Device loss.** Reflection probes drop their cubes and capture again after recovery
  (`07-rendering.md` §4). Light-probe volumes and lightmaps have no device-loss handling of their
  own, and none of the three has a device-loss test.

## 8. Known gaps

- **Lightmap atlas transform.** Babylon Lite 1.34 samples `uv2` without a scale or offset, so an
  `entries` placement other than the identity logs `IGX-0735` and samples the whole texture, until
  spike P2 (GI plan §5) lands. Give each static renderer its own texture, or bake UV2 that already
  points into the shared texture.
- **No lightmap baker in the engine.** It needs a UV2 unwrap and a GPU path tracer; it is planned
  for the editor. Bring textures from an external tool, or build them in code.
- **No reflection probe blending (B1b).** A material reflects one probe, chosen per material (a
  material shared by several meshes follows the first); there is no blend across probe borders and
  no prefiltered (GGX) mip chain, so very rough surfaces look blurrier and blockier than with an
  `.env`. `ReflectionProbe.capture()` to a file is part of the same follow-up.
- **The light-probe bake** is first-order, one bounce, flat-coloured, and sees only
  `MeshAsset.fromData` geometry (§5).
- No Phase 2 cost has been measured on a device yet; the figures above are estimates.

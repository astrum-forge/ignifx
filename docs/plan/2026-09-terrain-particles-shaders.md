# Plan · Terrain, GPU particles, and custom shaders

**Status:** Executed on `feat/terrain-particles-shaders` (2026-09-08 to 2026-09-15; see §11) · Proposed v2 (2026-09-08) · **Owner:** Astrum Forge Studios · **Precedence:** below constitution, standards, architecture docs, ADRs (`CONSTITUTION.md` §10.1) · **Supersedes:** the "particles (Lite node particles)" and "instancing" lines of `engineering-plan.md` §8 · **Companion:** `website/plan/07-wishlist.md` rows W-R1, W-R2, W-R13, W-R14, W-R22, W-2D6

Three table-stakes systems the engine does not have: a terrain system, a GPU-driven particle and effects system, and a way to write custom shaders. This plan fixes what each one is, what it is built on, how the work is split between agents, and what "done" means, so execution can run end to end with the coordinator acting as quality control.

Every Babylon Lite claim below was verified against `@babylonjs/lite@1.27.0`'s `index.d.ts` and `lib/` sources on 2026-09-08 (`CONSTITUTION.md` §3.4, `AGENTS.md`). Three research reports fed the plan — a repository inventory, Lite's documentation and release history, and a cross-engine design survey — and their load-bearing claims were re-checked against primary sources (GitHub, the npm registry) before being used. §9 records what they found and what they changed.

---

## 1. What Babylon Lite 1.27.0 gives us, and what it does not

| Area                                  | Verified fact (`index.d.ts` line, or `lib/` file)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom WGSL materials                 | `createShaderMaterial(ShaderMaterialOptions)` (3071): the user supplies full `vertexSource`/`fragmentSource` with fixed entry points `mainVertex`/`mainFragment` (`lib/material/shader/shader-pipeline.js` 98–99). Lite prepends the scene UBO (`scene.viewProjection/view/vEyePosition/envRotationY/vSphericalL*/vImageInfos/vFogInfos/vFogColor/clipPlane` at `@group(0)@binding(0)`), `shaderSystem` (`@group(1)@binding(0)`, the declared system uniforms), `shaderUniforms` (`@group(1)@binding(1)`, custom uniforms), one `name`/`nameSampler` pair per sampler, `var<storage,read>` per storage buffer, a `const` per define, and a generated `struct VertexInput` from the `attributes` list (`shader-pipeline.js` 185–210). Attributes are the fixed set `position normal uv uv2 tangent color joints weights joints1 weights1` (11295); uniform types `f32 u32 i32 vec2/3/4<f32> mat4x4<f32>` (11445); system uniforms `world view projection viewProjection worldView worldViewProjection cameraPosition screenSize alphaCutoff` — **no time, no lights, no shadows**. Blend `alpha`/`additive` or an explicit `GPUBlendState`; `depthWrite`, `depthCompare`, `depthBias`, `backFaceCulling`; `transmissive` (scene-colour grab via `enableRenderTaskTransmission`, 4551); `depthOnlyFragment` for alpha-tested shadow casters. | A first-class `"shader"` material kind is a thin, safe wrapper. ignifx supplies what Lite does not — a `time` uniform, main-light uniforms, and a documented WGSL contract — and the shader file itself declares its uniforms (§3.1). Lit custom shaders are "unlit plus what you compute": SH ambient from `scene.vSphericalL*` and fog from `scene.vFogInfos` are readable; direct lights and shadows are not.                                                                                                                                                                                                                    |
| Thin instances with a custom material | `ShaderMaterialPipelineLayout = "mesh" \| "thin-instances" \| "thin-instances-color"` (11389); the thin-instance layout appends `world0..world3` (and `instanceColor`) to `VertexInput` (`shader-thin-instance.js` 26–28) and the shader composes `shaderSystem.world * mat4x4(world0..3)` itself; `setThinInstances` (11268), `enableThinInstanceGpuCulling` (4643, compute-based, opaque only, before `registerScene`), `setThinInstanceLodPartner` (11262), `enableThinInstanceDynamicDrawCount`/`setThinInstanceDrawCount` (4635, 11251).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | One `InstancedMeshRenderer` in core covers instancing, foliage, and the particle draw. A WGSL entry point may take `@builtin(instance_index)` as a second parameter, so a shader indexes a storage buffer per instance while Lite's matrix slab stays static (spike S0.1).                                                                                                                                                                                                                                                                                                                                                          |
| Storage buffers                       | `createStorageBuffer(engine, data, label)` (3211) — **read-only** in shaders; `updateStorageBuffer(engine, buffer, data, byteOffset)` (13373); `setShaderStorageBuffer` (10929). `StorageBuffer` is a branded opaque object.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The CPU streams particle spawn records into a ring buffer the vertex shader reads. Nothing on the GPU writes back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Compute                               | No `GPUComputePipeline`, `dispatchWorkgroups`, or compute task in `index.d.ts`; `EngineContext` (4676) exposes no `GPUDevice`. Lite's own thin-instance culling and IBL prefiltering use compute internally. Upstream PR #583 (open, changes requested, last pushed 2026-09-08) adds writable storage buffers and GPU-resident meshes; its compute-dispatch API was split out at review and no follow-up exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **A compute-driven particle simulation is not possible on 1.27.0 without touching internals**, and Lite's particle tracker (issue #43) plans none. The particle system is therefore _stateless_: the GPU evaluates each particle's closed-form state from its spawn record and the current time (§4).                                                                                                                                                                                                                                                                                                                               |
| Lite's own particles                  | `ParticleSystem` (8034) is a CPU structure-of-arrays runtime built from Babylon Node Particle Editor graphs (`parseNodeParticleSource`, `buildNodeParticleSet`), rendered by `createParticleBillboard` → `FacingBillboardSpriteSystem` or bridged into Sprite2D layers (`createParticleSprite2DBridge`); `registerNodeParticleSet` advances it from Lite's own frame hook. Lite's docs: "Simulation is CPU-only."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Not GPU-powered, not ignifx-clock-driven, tied to Babylon's block set. ignifx does not wrap it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Material plugins                      | `MaterialPlugin` (7053) injects WGSL into Lite's PBR and Standard shaders (10 points, 7084), with custom UBO fields and `texture_2d<f32>` samplers that are **fragment-stage only** (`lib/material/plugin/plugin-bridge-shared.js`, `_visibility: STAGE_FRAGMENT`); enabled by `rendering.features.materialPlugins`. Verified slot semantics in `lib/material/pbr/pbr-template.js`: `UPDATE_ALPHA` runs after `var baseColor`, `var alpha`, `let roughness`, `let metallic`, `var emissive`; `UPDATE_DIFFUSE` after `var N` (the shading normal); `BEFORE_LIGHTS` after `var colorF0`; `BEFORE_FINALCOLORCOMPOSITION` after `var color` (linear, pre-fog, pre-tone-map); `BEFORE_FRAGCOLOR` after tone mapping and gamma. Vertex: `UPDATE_WORLDPOS` runs after `var finalWorld = mesh.world` and before `worldPos4 = finalWorld * vec4(position, 1)`; `position` is an immutable entry parameter, `finalWorld` is a per-vertex `var`.                                                                                                                                                                                                                                                                                                                                                                                                      | Plugins can change base colour, alpha, emissive, the shading normal, F0, and the composited colour while keeping IBL, shadows, and fog — the terrain material and every "lit custom look" ride on this. They **cannot** change roughness or metallic (`let`), cannot read a texture in the vertex stage, and can displace a vertex **only by translation**, through `finalWorld[3]` — which is exactly what wind, waves and swaying need, so lit, shadowed foliage is possible (spike S0.2 confirms the shadow pass honours it). Plugin samplers are `texture_2d<f32>`, so v1 terrain splats four layers from one RGBA control map. |
| Full-screen custom passes             | `createEffectWrapper(engine, { fragmentWGSL, vertexWGSL?, bindings, blend })` (2461) and `createEffectRenderTask({ effect, target, clear })` (2452); render targets via `createRenderTarget`/`createRenderTargetTexture` (2989/2998).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `PostProcessStack` gains custom WGSL effects recorded into the existing offscreen chain (`07-rendering.md` §2.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Terrain primitives                    | `createGroundFromHeightMap(engine, url, GroundOptions)` (single mesh, URL only, luminance-based); `createMeshFromData(engine, name, positions, normals, indices, uvs?, uvs2?, tangents?, colors?)` (2694); `updateMeshPositions/Normals/Uvs/Colors/Geometry` (13290–13331); `Mesh.boundMin/boundMax` writable; `createTexture2DFromPixels` (rgba8, 3347), `updateTexture2DFromPixels` (13412), `createTexture2DArray*` (3288–3336).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Chunk geometry is built on the CPU per chunk and per LOD, uploaded once, re-uploaded for sculpting. Heights above 8 bits are decoded on the CPU. `@ignifx/physics` already ships `HeightfieldCollider { heights, samplesX, samplesZ, size }` (row-major, `samplesX * samplesZ`; `packages/physics/src/components/colliders.ts` 359–411).                                                                                                                                                                                                                                                                                            |
| Lite's direction                      | 1.28.0 (2026-09-07) reads "No notable changes since 1.27.0".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The pin stays at 1.27.0 (`CONSTITUTION.md` §4.6). Nothing here waits on an upgrade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 2. Scope and shape

Three deliverables, three new subsystem skills, one core enlargement, fourteen website examples. Names are final.

| Deliverable        | Where                                                                                                                                                                                                                                                                                                                                                                                          | Public surface (summary)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom shaders** | `@ignifx/core` (materials and the Lite adapter already live there; `MATERIAL_KINDS` already declares `"shader"` and rejects it with `IGX-0708`) and `@ignifx/vite-plugin` (build-time validation)                                                                                                                                                                                              | Three authoring forms, all in `.wgsl` files whose pragma comments **are** the declaration (§3): `ShaderMaterial` (full WGSL, unlit, you own everything), `SurfaceShader` (hooks into PBR/Standard: `displace`, `surface`, `composite` — lit, shadowed, IBL), and `PostEffect` (full-screen). Plus ignifx-provided uniforms (`time`, `deltaTime`, `mainLightDirection`, `mainLightColor`, `ambientColor`), `StorageBufferAsset`, `InstancedMeshRenderer`, `TextureAsset.fromPixels`, hot reload, and raw material-plugin points as a `@beta` escape hatch |
| **Particles**      | new `@ignifx/particles` (3D, GPU stateless) and `@ignifx/particles-2d` (sprite-layer renderer; needs `@ignifx/2d`), mirroring `physics`/`physics-2d`. **Neither imports `@babylonjs/lite`**: the GPU path is built on core's public shader, storage-buffer, texture and instancing API, the 2D path on a new `SpriteBatch` in `@ignifx/2d` — the proof that a third party could build the same | `ParticleSystem`, `ParticleSystem2D`; `.particles.json` (`ignifx.particles`) with a declarative module set; `particleDefinition("fire", overrides)` presets; `app.particles` (budget, quality scale, counters); `play/stop/pause/emit(n)/simulate(t)`, `onStopped`                                                                                                                                                                                                                                                                                       |
| **Terrain**        | new `@ignifx/terrain` (needs `materialPlugins`; physics coupling by data, not by dependency). Uses core's public API for the material, textures and scatter; keeps one small adapter (`src/lite/gpu/chunk-mesh.ts`) for chunk meshes, which are renderables that are not entities — the shape `@ignifx/2d` uses for tilemap tiles                                                              | `Terrain` + `.terrain.json` (`ignifx.terrain`): heightmap (`.r16` canonical, PNG accepted) or seeded noise, chunked geomipmapped LOD with skirts, four-layer splat as a `SurfaceShader` on PBR, `heightAt/normalAt/raycast`, `colliderInit()` for `HeightfieldCollider`, `setHeights()` for sculpting; `TerrainScatter` (seeded, rule-based foliage on `InstancedMeshRenderer` with LOD and a wind `SurfaceShader`)                                                                                                                                      |

Out of scope, recorded so nobody drifts into it, each with its blocker in §9: compute-driven simulation, particle collisions, sub-emitters, soft particles, per-particle depth sorting; terrain holes, more than four splat layers, texture-array splatting, terrain streaming, CDLOD morphing, terrain editor tooling; Babylon Node Material or Node Particle Editor importers; `ShaderMaterial`s that receive shadows; EXR heightmaps.

### 2.1 Layering

```
templates, examples, website                      (anything)
   ▲
ignifx (umbrella) · @ignifx/devtools · @ignifx/electron
   ▲
@ignifx/particles-2d ──▶ @ignifx/2d, @ignifx/particles
@ignifx/terrain      ──▶ @ignifx/core  (physics coupling by data only, §5.4)
@ignifx/particles    ──▶ @ignifx/core
@ignifx/input  physics  physics-2d  audio  2d  3d  ui
   ▲
@ignifx/core (+ shaders, InstancedMeshRenderer, StorageBufferAsset, TextureAsset.fromPixels, PostProcessStack.custom)
   ▲
@babylonjs/lite 1.27.0
```

Error-code ranges: `16xx` terrain, `17xx` particles (`1700–1749` 3D, `1750–1799` 2D), registered in `packages/core/src/errors/error-codes.ts` (`ErrorRange`), the lint rule `tools/eslint-plugin-ignifx/src/rules/error-code-format.ts` (`REGISTERED_CODE`, today `01`–`15`), and `15-devtools-and-diagnostics.md` §1. Core shader codes continue `07xx` from `IGX-0712`.

### 2.2 What core has to grow first (verified gaps)

None of the Lite calls the three systems need is wrapped today: no texture from pixels, no mesh vertex update, no thin instances, no storage buffers, no component-level asset-replacement hook, and `createWgslMaterial` is an `@internal` adapter function exercised by one unit test. Wave 1a adds exactly these primitives, each small and reusable by third parties:

| Addition                                                                                                                                                                  | Package                                                                                        | Why                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `TextureAsset.fromPixels(app, name, data, width, height, options)`; `textureAsset.update(data, x?, y?, w?, h?)`                                                           | core                                                                                           | particle lookup tables, terrain control maps, generated previews |
| `MeshAsset.fromData` accepts `uvs2`, `tangents`, `colors`; `meshAsset.updatePositions/updateNormals/updateColors(data, offset?)`                                          | core                                                                                           | terrain sculpting, vertex-colour effects                         |
| `StorageBufferAsset` (`createStorageBufferAsset(app, name, data)`, `update(data, byteOffset?)`, `byteLength`) and `ShaderMaterialAsset.setStorageBuffer(name, buffer)`    | core                                                                                           | particle spawn records; any per-instance data a shader reads     |
| `InstancedMeshRenderer` (§3.5)                                                                                                                                            | core                                                                                           | instancing, foliage, the particle draw                           |
| Shader materials, surface shaders, post effects (§3)                                                                                                                      | core, vite-plugin                                                                              | the whole shader story                                           |
| `SpriteBatch` — `app.twoD.createSpriteBatch({ sortingLayer, atlas, blend, capacity })` with `write(index, x, y, w, h, frame, rotation, r, g, b, a)`, `count`, `dispose()` | `@ignifx/2d` (`@beta`; wraps the `@internal` `SpriteLayerRegistry.placeRaw` path tilemaps use) | 2D particles; bullet hells and other entity-less sprite crowds   |

Hot reload of a `.wgsl` file cannot reuse a component hook, because none exists: today a `MeshRenderer` notices a swapped asset by comparing `mesh.value` identity in its `sync()`. The shader assets therefore connect to their source handle's `onReplaced` themselves and rebuild in place, so renderers keep the same material object; a compile failure keeps the last good material and reports through `app.onError` (`IGX-0715` with Lite's message).

## 3. Design: custom shaders (core)

### 3.1 The shader file is the declaration

The survey's clearest finding: the two engines whose shader uniforms reach an inspector for free — Godot and Unity — declare them **in the shader file**, and PlayCanvas's WebGPU path reflects bindings from WGSL source. ignifx does the same with pragma comments, so the file stays valid WGSL for every other tool, nothing has to be kept in sync with a JSON manifest, and the declaration doubles as the devtools inspector schema. A **material** is then values applied to a shader — the Unity/Godot split, and the same relationship a `.material.json` already has to Lite's PBR shader.

```wgsl
// shaders/dissolve.wgsl
// @ignifx shader
// @ignifx attributes position, normal, uv
// @ignifx system world, viewProjection, time
// @ignifx uniform progress: f32 = 0 range(0, 1)
// @ignifx uniform edgeColor: vec3<f32> = color(1.0, 0.45, 0.1)
// @ignifx uniform baseColor: vec3<f32> = color(0.2, 0.2, 0.25)
// @ignifx texture noiseTexture
// @ignifx blend opaque cull back

struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.viewProjection * shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let noise = textureSample(noiseTexture, noiseTextureSampler, input.uv * 4.0).r;
  if (noise < shaderUniforms.progress) { discard; }
  let edge = smoothstep(shaderUniforms.progress, shaderUniforms.progress + 0.08, noise);
  return vec4<f32>(mix(shaderUniforms.edgeColor, shaderUniforms.baseColor, edge), 1.0);
}
```

`VertexInput`, `shaderSystem`, `shaderUniforms`, `<name>`/`<name>Sampler`, `scene`, `mainVertex`, `mainFragment` are Lite's names, taught verbatim in the skill. The pragma grammar (one line each; a tiny hand-written parser at runtime, `wgsl_reflect` at build time):

| Pragma                                                                                                                                                                    | Meaning                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@ignifx shader` \| `surface` \| `post`                                                                                                                                   | which of the three forms this file is (§3.2, §3.3)                                                                                       |
| `@ignifx attributes a, b, …`                                                                                                                                              | Lite attribute names the vertex stage reads                                                                                              |
| `@ignifx system u, v, …`                                                                                                                                                  | Lite system uniforms plus ignifx's `time`, `unscaledTime`, `deltaTime`, `mainLightDirection`, `mainLightColor`, `ambientColor`           |
| `@ignifx uniform name: type = default [range(a, b)] [step(s)] [color] [tooltip("…")]`                                                                                     | a custom uniform; `color(r, g, b[, a])` marks sRGB-in, linear-up; hints map onto the schema `FieldOptions` the inspector already renders |
| `@ignifx texture name [srgb] [normal] [default white\|black\|transparent] [array]`                                                                                        | a sampler pair; `default` binds a 1×1 fallback when unset (Godot's `hint_default_*`); `array` declares `texture_2d_array`                |
| `@ignifx storage name: array<T>`                                                                                                                                          | a read-only storage buffer                                                                                                               |
| `@ignifx define NAME = true \| 3.0`                                                                                                                                       | a `const`; materials may override                                                                                                        |
| `@ignifx blend opaque\|alpha\|additive\|premultiplied  cull back\|front\|none  depthWrite on\|off  depthTest on\|off  transmissive  instancing matrices\|matrices-colors` | pipeline state                                                                                                                           |

The material side:

```jsonc
// materials/dissolve.material.json
{
  "format": "ignifx.material",
  "formatVersion": 1,
  "type": "shader",
  "name": "dissolve",
  "shader": "shaders/dissolve.wgsl",
  "values": { "progress": 0.25, "edgeColor": [1, 0.6, 0.2] },
  "textures": { "noiseTexture": "textures/noise.png" },
  "defines": { "SOFT_EDGE": true },
}
```

```ts
const dissolve = createMaterialAsset(
  app,
  shaderMaterialDefinition({ shader: dissolveShader, values: { progress: 0.25 } }),
  [noise],
);
dissolve.value.setUniform("progress", 0.4); // checked against the declaration; unknown name or wrong shape → IGX-0713
```

Rules the implementation enforces, each with a test and an error code:

- **Declared uniforms reuse the schema kinds** (`f32`, `u32`, `i32`, `vec2/3/4`, `mat4`, `color`), so the inspector, `ignifx.schemas.json`, and TSDoc come for free; `color` is declared sRGB and uploaded linear.
- **Time.** `time` is `app.time.time` (scaled; frozen by `app.pause()`), `unscaledTime`, `deltaTime`; uploaded once per frame per material that declares them, allocation-free, in a core `PreRender` system before the render sync.
- **Lights.** `mainLightDirection` (world, unit) and `mainLightColor` (linear × intensity) come from the highest-intensity enabled directional `Light`; `ambientColor` from the environment's SH L00. Declared with no light present: zeros and one `IGX-0714` warning.
- **Warm-up.** A `ShaderMaterial` is its own material family (ADR-0014); `app.renderer.warmUp` accepts it, and the skill recommends `asyncPipelines`.
- **Hot reload** as in §2.2. **Build-time validation** (standards §14): `@ignifx/vite-plugin` parses every `.wgsl` with `wgsl_reflect` (MIT, zero dependencies, 1.6.0 published 2026-09-05; the only maintained Node WGSL parser — §9) and reports, with file and line: syntax errors, a missing entry point for the declared form, a `shaderUniforms.<x>` or texture used but not declared, a hand-declared `@group(0)`/`@group(1)` binding, and a `textureSample` in the vertex stage (WGSL allows it only in fragment; vertex code must use `textureSampleLevel`/`textureLoad`). Full type checking stays with the browser compiler and surfaces as `IGX-0715`. The Dawn-based `webgpu` npm package (95 MB) is **not** a dependency; §9 records it as optional contributor tooling.
- **Two Lite traps the skill states outright** (from `docs/lite/architecture/24-shader-material.md`, verified against the pipeline source): under `rendering.useFloatingOrigin`, `cameraPosition` reads `(0,0,0)` and the world matrices are camera-relative; with instancing on, `world`/`worldView`/`worldViewProjection` are not instance-aware — the shader composes `shaderSystem.world * mat4x4(input.world0, input.world1, input.world2, input.world3)`.
- **Bundle cost.** Lite's shader-material pipeline code is unreachable in today's bundles. The `"shader"` branch of the material loader loads the adapter through a dynamic `import()` — the split that took Lite's error table out of `hello-cube` (`07-rendering.md` §5) — so `hello-cube` stays under its 295,497 B ceiling.
- Headless: a shader material holds its declaration and values and uploads nothing, as PBR does today (`07-rendering.md` §6).

### 3.2 Surface shaders — lit without rewriting lighting

Godot's `fragment()`-without-`light()` and Unity's surface `surf()` are documented as "the engine computes the lighting for you", and the survey's warning is that Babylon carries three mutually incompatible injection-point taxonomies while PlayCanvas maintains a per-release chunk-migration page. So ignifx's stable, public contract is three named hooks, and Lite's raw points stay a `@beta` escape hatch:

```wgsl
// shaders/snow.surface.wgsl
// @ignifx surface
// @ignifx uniform amount: f32 = 0.6 range(0, 1)
// @ignifx uniform snowColor: vec3<f32> = color(0.95, 0.97, 1.0)
// @ignifx texture snowNoise

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  let mask = smoothstep(0.55, 0.85, (*s).normal.y) * textureSample(snowNoise, snowNoiseSampler, in.uv * 8.0).r;
  (*s).baseColor = mix((*s).baseColor, surfaceUniforms.snowColor, mask * surfaceUniforms.amount);
}
```

| Hook                                                   | Runs at (Lite slot)                               | Reads                                                                                                                                                                                                                                          | Writes                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displace(in: DisplaceInput) -> vec3<f32>`             | `CUSTOM_VERTEX_UPDATE_WORLDPOS`                   | object position, normal, `uv`, `color`, the world matrix — **and nothing else**: Lite's plugin uniforms and samplers are fragment-stage only and a plugin has no vertex helper channel (W1-B, verified on a device), so `time` is not readable | a **world-space offset** added to `finalWorld[3]`; the shadow follows. Static displacement only; time-driven wind and waves need a `ShaderMaterial` |
| `surface(in: SurfaceInput, s: ptr<function, Surface>)` | `CUSTOM_FRAGMENT_UPDATE_ALPHA` + `UPDATE_DIFFUSE` | `uv`, `uv2`, world position, geometric normal, view direction                                                                                                                                                                                  | `baseColor`, `alpha`, `emissive`, `normal`; `roughness` and `metallic` are read-only (Lite `let`) and the skill says so                             |
| `composite(in, color: vec3<f32>) -> vec3<f32>`         | `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`    | the lit linear colour, `normal`, view direction                                                                                                                                                                                                | the colour — rim light, hit flash, toon quantisation, tints                                                                                         |

Surface shaders attach to **PBR hosts only in v1**: Lite bakes a Standard material's plugin signature once from `scene.meshes` when the feature is enabled, before ignifx has created any mesh, and the Standard template has no `composite` slot; a Standard host is refused with an actionable error. `SurfaceShader` uniforms live in a struct ignifx names `surfaceUniforms`; the adapter rewrites it to the accessor Lite expects for the host family (PBR appends fields to the material UBO, Standard uses its own `pluginUbo` — `lib/material/plugin/std-plugin-bridge.js`). A PBR or Standard definition takes `surfaces: [handle | "$asset"]` (ordered, each a `SurfaceShader` asset from a `.surface.wgsl`); per-material values are `material.value.surface("snow").set("amount", 0.8)`; `enabled` toggles rebuild pipelines. The `materialPlugins` rendering feature is required (`IGX-0716` without it). Under the hood every `SurfaceShader` is one Lite `MaterialPlugin`; `defineMaterialPlugin({ name, uniforms, textures, code: Partial<Record<LitePoint, string>> })` remains exported `@beta` for the raw points, marked as tracking Lite's template.

### 3.3 Post effects

`// @ignifx post` files supply a fragment that receives `inputTexture`/`inputTextureSampler` (the chain's current colour), `screenSize`, `time`, and declared uniforms. `PostProcessStack` gains `custom: CustomEffect[]` (`{ shader: asset(ShaderAsset), values, textures, enabled, order }`), ordered with the built-ins; ignifx records one `createEffectRenderTask` per effect into the offscreen chain of `07-rendering.md` §2.7 and ping-pongs targets. `imageProcessing` stays last; shape changes rebuild, value changes re-upload.

### 3.4 Kernel of the WGSL contract the skill teaches

Alignment (`vec3<f32>` is 16-aligned, 12 wide; arrays in uniform space stride at least 16; use `@align`/`@size`), `textureSample` fragment-only, WebGPU's top-left texture origin and `[0, 1]` clip depth, premultiplied alpha at upload, `enable f16` needs a device feature — each in `references/concepts/rendering.md` with the WGSL spec link, because the survey found these are precisely what coding agents get wrong.

### 3.5 `InstancedMeshRenderer`

```ts
class InstancedMeshRenderer extends Component.define({
  mesh: asset(MeshAsset),
  materials: array(asset(MaterialAsset)),
  capacity: u32(1024),
  gpuCulling: bool(true),
  castShadows: bool(true),
  receiveShadows: bool(true),
  renderOrder: i32(0),
  pickable: bool(false),
  lod: optional(record({ mesh: asset(MeshAsset), distance: f32(40), band: f32(6) })),
}) {
  setMatrices(matrices: Float32Array, count: number): void; // 16 floats per instance; caller-owned slab, uploaded next PreRender
  setColors(colors: Float32Array | null): void; // 4 floats per instance; needs a material that reads instanceColor
  setCount(count: number): void; // dynamic draw count without re-upload
  readonly count: number;
  readonly capacity: number;
}
```

Lite configures GPU culling and LOD partners before `registerScene`; the component applies both when it creates its meshes and refuses `gpuCulling`/`lod` edits after start with `IGX-0717`. Headless it holds the slab and count. `benchmarks/` gains a 20,000-instance scene.

## 4. Design: particles

### 4.1 Why stateless, and what it buys

Without compute, "GPU-powered" means the GPU does the per-particle work every frame and the CPU writes only what changed. Each particle is a **spawn record** the vertex shader turns into the particle's whole state at time `t` in closed form; dead particles collapse to a degenerate clip-space point. The CPU cost per frame is the emission logic and one `updateStorageBuffer` of the records emitted that frame.

The survey settled how this is done well (Latta 2004 defined the term; PlayCanvas's GPU path turned out to be a ping-pong render-to-texture Euler simulation, _not_ stateless, and its `sort` silently falls back to the CPU; Godot's post-mortem on maintaining CPU and GPU twins is "harder and harder to keep feature parity"). ignifx's rules:

- **One evaluator, two hosts.** `evaluateParticle(record, t) → { position, size, color, rotation, frame }` is written once in TypeScript and once in WGSL from the same specification, and a conformance test asserts agreement across a matrix of records and times (the CPU side runs in Node; the GPU side is read back through a Chromium test that renders single particles at known times). The 2D renderer _is_ the TypeScript evaluator.
- **Integer hashing.** Per-particle randomness is `pcg3d` (Jarzynski & Olano 2020), bit-identical in JavaScript (`Math.imul`, `>>> 0`) and WGSL (`u32`) — never a `sin`/`fract` float hash.
- **Closed forms only.** Gravity and linear drag: `p(t) = p₀ + (v₀ − g/k)(1 − e^{−kt})/k + (g/k)·t`, degenerating to `p₀ + v₀t + ½gt²` at `k = 0`. Orbit about a fixed axis: a rotation by `ωt`. Noise is a **positional offset** sampled at the analytic position, never an integrated force. Curves and gradients are 64-sample lookup rows in one texture, read with `textureSampleLevel` in the vertex stage and with a matching linear lerp on the CPU — the lookup is the contract between the two hosts.
- **Explicit layout.** The record is a WGSL struct with `@align(16)` on every member; `wgsl_reflect` computes offsets in a test that pins the TypeScript writer to them.
- **Exact pause and time scale** fall out of `age = clock − spawnTime` with the clock advancing by `dt` only while `time.paused` is false (`01-lifecycle-and-time.md` §7). Frame-rate independence and seed determinism are by construction.
- **Blending.** Default `premultiplied` (fire and smoke share one draw and blend front-to-back correctly, per the NVIDIA and RTCD references), `additive` and `alpha` available; `depthWrite` off; no per-particle sorting — `renderOrder` orders systems, and the skill says when to use which blend.

What stateless cannot do — collisions, sub-emitters, force fields with state — is documented in the skill and recorded in §9 with the reason "not a function of `t` alone". Trails are the one thing stateless does _better_ (sample `p(t − kΔ)` for a ribbon with no stored history) and are a v1.1 module.

### 4.2 The declarative module set (`ignifx.particles`)

| Module         | Fields (v1)                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`         | `capacity`, `duration`, `looping`, `prewarm`, `startDelay`, `simulationSpace: "local" \| "world"`, `seed`, `playOnAwake`, `timeScale`, `renderOrder`                                                                                                                |
| `emission`     | `rateOverTime`, `rateOverDistance`, `bursts: [{ time, count, cycles, interval, probability }]`                                                                                                                                                                      |
| `shape`        | `point`, `sphere`/`hemisphere` (radius, thickness, arc), `cone` (angle, radius, length, emitFrom), `box` (size, emitFrom), `circle`, `edge`, `mesh` (surface points sampled on the CPU); `randomDirection`, `spherizeDirection`                                     |
| `start`        | `lifetime`, `speed`, `size`, `rotation`, `color` — each a **value**: constant, random between two, curve, or gradient; `size3D` optional                                                                                                                            |
| `forces`       | `gravity` (world vec3 or a multiplier of the app's gravity), `drag`, `constantForce`, `orbit: { axis, speed }`, `noise: { strength, frequency, scroll, octaves ≤ 2, influenceOverLife }`                                                                            |
| `overLifetime` | `color` (gradient), `size` (curve, per axis optional), `rotation` (angular speed value)                                                                                                                                                                             |
| `renderer`     | `mode: "billboard" \| "stretched" (speedScale, lengthScale) \| "horizontal" \| "vertical" \| "mesh"`, `mesh`, `texture`, `sheet: { tiles, frameOverTime: value \| "random" \| { fps } }`, `blend`, `lit` (Lambert on `mainLightDirection` plus SH ambient), `pivot` |

### 4.3 Components and API

```ts
class ParticleSystem extends Component.define({
  definition: asset(ParticleAsset),
  playOnAwake: bool(true),
  seed: u32(0) /* 0 = random */,
}) {
  play(): void;
  stop(options?: { clear?: boolean }): void;
  pause(): void;
  resume(): void;
  emit(count: number): void;
  simulate(seconds: number): void; // fast-forward; what prewarm uses
  readonly isPlaying: boolean;
  readonly aliveCount: number; // exact on the CPU
  readonly onStopped: Signal<ParticleSystem>;
  readonly definition: ParticleAsset;
}
```

`ParticleSystem2D` (`@ignifx/particles-2d`) has the same API and format, evaluates records with the shared TypeScript evaluator into a `SpriteBatch` of `capacity` sprites, and so behaves identically to the 3D system for the same definition.

`app.particles`: `maxParticles` (global budget; over-budget emission is dropped and counted), `qualityScale` (0–1 multiplier on rates and bursts, for settings screens), `gravity` (from `@ignifx/physics` settings when present, else `(0, −9.81, 0)`), counters (`systems`, `alive`, `emitted`, `uploadBytes`, `drawCalls`).

Presets: `particleDefinition(preset, overrides?)` with `fire`, `smoke`, `sparks`, `explosion`, `dust`, `sparkle`, `rain`, `snow`, `leaves`, each a complete `.particles.json` shipped in the package, so `entity.addComponent(ParticleSystem, { definition: particleDefinition("fire") })` works in a fresh project.

Lifecycle: emission runs in `Update` late so a script's `emit()` lands in the same frame; the upload runs in `PreRender` before the render sync. Headless: everything minus the upload, asserted in Node; determinism: a seed hash test, as for physics.

### 4.4 GPU implementation (for the brief)

`@ignifx/particles` imports nothing from `@babylonjs/lite`. A `ParticleSystem` owns one `InstancedMeshRenderer` (a quad or the definition's mesh; `capacity` identity matrices set once; `gpuCulling: false`, particles are culled by the emitter's conservative bounds), one `ShaderMaterialAsset` per definition (shared by every system that uses it), one `StorageBufferAsset` per system for the spawn records, and one `TextureAsset.fromPixels` lookup texture per definition. The material declares `instancing matrices`, `storage particles: array<Particle>`, textures `sheet` and `lut`, system uniforms `time`, custom uniforms `emitterWorld`, `forces`, `renderer`; the vertex entry takes `@builtin(instance_index)` (spike S0.1). The ring buffer's head advances by emitted count; wrap produces two `update` calls; records older than their lifetime are skipped by the shader, so nothing is freed. Spike S0.1 measured that dead instances still cost vertex work (one million dead records ≈ 5 ms on an M1), so `capacity` defaults to 1,000 and the draw count follows the **live tail**: the shader maps instance `i` to record `(head − 1 − i) mod capacity`, newest first, and the renderer's count is the number of records whose lifetime has not elapsed — GPU cost scales with alive particles, not capacity. The whole `.wgsl` is passed as both stages (Lite prepends its prelude to each), and the particle renderer never casts shadows (shader materials cannot be ESM casters; alpha-tested casting is unverified on Metal). If a brief finds a Lite call the public API cannot express, the fix is a core addition with a test, never a Lite import in the particles package (standards §15).

## 5. Design: terrain

### 5.1 `.terrain.json` (`ignifx.terrain`)

```jsonc
{
  "format": "ignifx.terrain",
  "formatVersion": 1,
  "name": "island",
  "size": { "width": 512, "depth": 512, "height": 80 }, // metres; height is the full range
  "resolution": 513, // samples per side, 2ⁿ+1
  "heightmap": { "source": "terrain/island.r16" }, // .r16 (little-endian, canonical), .png 16-bit or 8-bit (8-bit logs IGX-1603: terracing); or omit for noise
  "noise": {
    "seed": 7,
    "octaves": 6,
    "frequency": 0.004,
    "lacunarity": 2,
    "persistence": 0.5,
    "ridged": false,
    "terraces": 0,
  },
  "chunks": { "size": 64, "lodLevels": 4, "lodDistance": 96, "skirtDepth": 2 },
  "layers": [
    // 1–8 in v1 (albedo and normal texture arrays; one RGBA control map per four layers)
    { "name": "grass", "albedo": "terrain/grass_albedo.png", "normal": "terrain/grass_normal.png", "tiling": 8 },
    {
      "name": "rock",
      "albedo": "terrain/rock_albedo.png",
      "normal": "terrain/rock_normal.png",
      "tiling": 6,
      "triplanar": true,
    },
    { "name": "sand", "albedo": "terrain/sand_albedo.png", "tiling": 10 },
    { "name": "snow", "albedo": "terrain/snow_albedo.png", "tiling": 12 },
  ],
  "splat": { "control": ["terrain/island_splat.png"] }, // RGBA weights, one channel per layer; a second map covers layers 5–8; or:
  "splatRules": [
    { "layer": "sand", "height": [0, 6] },
    { "layer": "grass", "height": [4, 40] },
    { "layer": "rock", "slope": [35, 90] },
    { "layer": "snow", "height": [55, 80], "slope": [0, 30] },
  ],
  "material": { "roughness": 0.9, "metallic": 0 },
}
```

Heightmap precision follows the survey's unanimous finding (Terrain3D: "8-bit will give you an ugly terraced terrain"): 16-bit is the floor. `.r16` is decoded by the loader in Node and the browser alike. Spike S0.3 showed that **no browser image API decodes 16-bit PNG losslessly** (`createImageBitmap`, the float16 canvas and `ImageDecoder` all return 8 bits), so the loader carries a minimal PNG decoder (non-interlaced greyscale and RGB(A), 8 and 16 bit, `DecompressionStream("deflate")`, the five filters) and an `ignifx import heightmap in.png out.r16` CLI command (`fast-png`, MIT) remains the batch conversion path; 8-bit sources load with a terracing warning. EXR is out of scope.

### 5.2 Rendering, and why not CDLOD

The survey recommends CDLOD (Strugar 2009): a quadtree of shared grids whose vertex shader morphs positions toward the coarser level, which removes cracks by construction. It cannot be built on Lite 1.27.0 with lighting intact: CDLOD reads the height texture in the vertex stage, plugin textures are fragment-only, and a full `ShaderMaterial` terrain would receive no shadows and no direct light. So v1 is **chunked geomipmapping with skirts** — de Boer 2000 for the blocks, Ulrich 2002 for the skirts — with CPU-baked positions:

- The terrain owns `chunks × chunks` Lite meshes through its one adapter file (`src/lite/gpu/chunk-mesh.ts`: create from data, update positions and normals, parent under the entity node, `addToScene`, visibility, dispose — the six calls core's own `mesh.ts` makes). Each chunk is built at every LOD as a separate mesh with a downward skirt on its four edges; only one LOD per chunk is visible. `TerrainLodSystem` picks it in `PreRender` from the main camera's distance with a hysteresis band, allocation-free, and **owns frustum culling**: spike S0.3 confirmed Lite does not cull plain meshes (`lib/frame-graph/render-task.js` 385–391 skips only `visible === false`), so the system tests each chunk's world box against the camera's six planes. Visibility goes through Lite's `setSubtreeVisible` (a direct `visible` write takes no effect until the visibility epoch bumps). Draw calls for a 512 m terrain with 64 m chunks: at most 64, fewer when culled; `Terrain.drawCalls` counts them itself because `engine.drawCallCount` includes hidden bindings. Popping is bounded by chunk size and the hysteresis band; CDLOD-style morphing through a `displace` hook that reads the parent LOD's height from a `uv2` vertex attribute (no texture needed) is the recorded v1.1 upgrade if popping proves visible.
- Normals are precomputed on the CPU (central differences) into vertex normals and regenerated only for an edited region — the survey's recommendation, because per-pixel derivation costs samples every frame for a benefit only editable terrain needs.
- **One PBR material with the `terrainSplat` surface shader**, so shadows, IBL, fog and tone mapping are the engine's. `surface()` samples one or two RGBA control maps and one albedo **texture array** plus one optional normal array (spike S0.2 proved `texture_2d_array<f32>` plugin samplers work in 1.27.0 behind a type cast, and that nine plugin samplers fit beside a fully textured PBR with IBL and one shadow light), with world-space UVs (`worldPosition.xz / tiling`), blends albedo into `baseColor` and perturbs `normal`, and uses triplanar sampling (Palko; Golus for the normal blend) for layers that ask for it. That gives **up to eight layers** in v1 with four texture bindings; Terrain3D's 32-layer index-plus-weight control word stays the v2 design. Per-layer roughness is unavailable (Lite `let roughness`).
- Runtime sculpting: `terrain.setHeights(x, z, width, depth, heights)` rewrites the affected chunks' positions and normals and raises `onHeightsChanged(region)`; painting is `terrain.setSplat(...)` via `TextureAsset.update`.

### 5.3 Queries and gameplay

`heightAt(x, z)` (bilinear on the height field), `normalAt(x, z)`, `raycast(ray, out)` (height-field march, CPU), `bounds`, `size`, `resolution`, `heights` (read-only `Float32Array` view), `worldToSample`/`sampleToWorld`. All allocation-free with `out` parameters (standards §7), and all reading the source height field so gameplay never depends on a collider being present.

### 5.4 Physics

`terrain.colliderInit(region?)` returns a `HeightfieldCollider` init in the exact shape `@ignifx/physics` expects (row-major `heights` of `samplesX * samplesZ`, height scaled by `|scale.y|`, `size.x/z` by `|scale.x/z|`), so the one obvious way is

```ts
const collider = terrainEntity.addComponent(HeightfieldCollider, terrain.colliderInit());
terrain.onHeightsChanged.connect(() => collider.setHeights(terrain.colliderInit()), { owner: this });
```

`@ignifx/terrain` does not import `@ignifx/physics`: a terrain without physics costs no physics code (`CONSTITUTION.md` §2.5), and the layering stays acyclic. `region` exists for terrains large enough that a player-radius collider is wiser than a full one (the Godot warning).

### 5.5 `TerrainScatter`

```ts
class TerrainScatter extends Component.define({
  mesh: asset(MeshAsset),
  material: asset(MaterialAsset),
  lodMesh: optional(asset(MeshAsset)),
  lodDistance: f32(40),
  density: f32(0.5), // instances per m²
  layers: array(str(), []), // splat layers to place on (weight ≥ threshold); empty = everywhere
  layerThreshold: f32(0.5),
  slope: vec2({ x: 0, y: 35 }),
  height: vec2({ x: -Infinity, y: Infinity }),
  scale: vec2({ x: 0.8, y: 1.2 }),
  randomYaw: bool(true),
  alignToNormal: bool(false),
  seed: u32(1),
  maxInstances: u32(50000),
}) {
  readonly count: number;
  regenerate(): void;
}
```

Placement is generated once (seeded, headless-capable; tests assert counts and layer adherence — Unity's `DetailPrototype` is the model) and fed to an `InstancedMeshRenderer` with GPU culling and the LOD partner. `foliageMaterialDefinition({ albedo, wind })` is a **`ShaderMaterial`** — vertex wind from the `time` uniform, Lambert on `mainLightDirection`/`mainLightColor` plus `ambientColor`, alpha test — because a surface shader's `displace` hook cannot read `time` (W1-B, above). It casts PCF shadows unflagged and receives none; the skill says so. Lit, shadow-receiving foliage waits on vertex-stage plugin uniforms upstream (§9.2).

## 6. Website, skills, recipes, benchmarks

### 6.1 Website examples (kit-based, under 200 lines, poster + golden + catalogue entry; `04-examples-platform.md` §9)

Three new gallery categories — `Shaders`, `Particles`, `Terrain` — appended to `CATEGORIES`, each with an `entries/*.ts` file, a feature block in `website/scripts/copy-features.ts`, and chips in `copy.ts`.

| Slug                  | Category  | Shows                                                                                                                                                                                                                              | Priority |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `custom-shader`       | Shaders   | One mesh, a select of four `ShaderMaterial`s (toon, dissolve, hologram, force field), live uniforms from the file's declarations, `time`                                                                                           | P0       |
| `surface-shaders`     | Shaders   | Snow, wetness, rim light and hit flash as `SurfaceShader`s on the Corset and the ship, IBL and shadows intact, per-shader toggles                                                                                                  | P0       |
| `vertex-animation`    | Shaders   | A flag, a jelly cube and wind-blown grass through `ShaderMaterial` vertex stages, plus a static `displace` surface-shader bulge on a lit, shadowed PBR mesh — the two routes to vertex motion and what each keeps; strength slider | P0       |
| `custom-post-process` | Shaders   | Vignette, grain, pixelate, CRT, colour LUT as `PostProcessStack.custom`, reorderable                                                                                                                                               | P1       |
| `instancing`          | Rendering | 20,000 asteroids through `InstancedMeshRenderer`, GPU culling on/off, LOD partner distance, draw-call and instance counters                                                                                                        | P0       |
| `particles`           | Particles | The presets on a select; rate, size, gravity, drag, noise sliders; alive and upload counters                                                                                                                                       | P0       |
| `explosion`           | Particles | Click to detonate: bursts, stretched sparks, a shockwave ring, mesh debris; a seed field for determinism                                                                                                                           | P0       |
| `weather`             | Particles | Rain and snow volumes following the camera, wind, a lit-particle toggle                                                                                                                                                            | P1       |
| `particles-2d`        | Particles | Torch fire, footstep dust and coin sparkle over the tilemap example's scene, Y-sorted with sprites                                                                                                                                 | P0       |
| `terrain`             | Terrain   | A 16-bit island, four-layer splat, LOD wireframe toggle, chunk and draw-call readouts, fly camera                                                                                                                                  | P0       |
| `terrain-procedural`  | Terrain   | Seeded noise terrain regenerated live (seed, octaves, ridged, terraces), rule-based splat, fog                                                                                                                                     | P0       |
| `terrain-foliage`     | Terrain   | Grass and trees from `TerrainScatter` with GPU culling and LOD, wind, density slider, instance counters                                                                                                                            | P0       |
| `terrain-walk`        | Terrain   | The third-person character on the terrain with a `HeightfieldCollider` from `colliderInit()`, footstep dust from `ParticleSystem`                                                                                                  | P1       |
| `terrain-sculpt`      | Terrain   | Raise and lower under the pointer; the collider and the grass follow `onHeightsChanged`                                                                                                                                            | P2       |

Sample assets: heightmap and splat textures are **generated by a repository tool** (`website/examples/_tools/make-terrain-assets.ts`, like `make-grid-texture.ts`), so nothing needs a licence; the Corset, ship and Kenney assets are reused. `07-wishlist.md` rows graduate and are deleted as each example lands (its §1 rule).

### 6.2 Skills and recipes

- New subsystem skills in the ten-section shape of `16-docs-harness-and-skill.md` §2: `packages/particles/skills/particles/SKILL.md`, `packages/particles-2d/skills/particles-2d/SKILL.md`, `packages/terrain/skills/terrain/SKILL.md`; registered by the `ignifx.skill` manifest field alone.
- Entry skill (`skills/ignifx/SKILL.md`, 490/500 lines): the extensions table gains three rows; "Meshes and materials in code" gains `shaderMaterialDefinition`, `surfaces`, `InstancedMeshRenderer`; one gotcha is replaced to stay under the cap; `references/concepts/rendering.md` gains "Custom shaders" (the WGSL contract of §3.1–§3.4); `references/formats/` gains the shader fields of `material.md`, `ignifx.particles.md`, `ignifx.terrain.md` (generated) and a hand-written `wgsl.md` (the pragma grammar).
- Recipes (`examples/recipes/`, compiled by the harness): `write-a-custom-shader`, `add-a-surface-shader`, `add-a-custom-post-process`, `instance-many-meshes`, `play-a-particle-effect`, `burst-particles-on-hit`, `particles-in-2d`, `load-a-heightmap-terrain`, `walk-on-terrain`, `scatter-foliage` — each with its row in `references/recipes/README.md` and its group in `website/scripts/repo-content.ts`.

### 6.3 Benchmarks and budgets (`CONSTITUTION.md` §6.4)

| Scene                                    | Asserts                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `particles-10k` (headless)               | CPU ms per frame for one system at 10,000 alive and 2,000 emitted per second ≤ 0.5 ms; heap growth over 600 steps bounded |
| `particles-2d-5k` (Chromium, `app.step`) | ≤ 1.5 ms for 5,000 alive sprites in one batch                                                                             |
| `terrain-512` (headless)                 | LOD selection for 64 chunks ≤ 0.05 ms; 10,000 `heightAt` ≤ 1 ms; load-time build of 513² × 4 LODs recorded                |
| `instancing-20k` (Chromium)              | ≤ 0.1 ms CPU with a static slab; draw calls 1 (+1 with LOD)                                                               |
| bundles                                  | `hello-cube` under its 295,497 B ceiling; the four templates unchanged                                                    |
| visual                                   | one golden per example above at 640×360 with a stated tolerance; the four template goldens untouched                      |

## 7. Execution plan

Agents: research on Sonnet and Opus (done; §9), implementation on Opus with Fable for the two hardest bricks (the particle evaluator pair and the terrain package), the coordinator verifying every claim, re-running every gate, and owning root files, barrels, manifests, the single `pnpm install`, ADRs and commits. Each brief carries a disjoint file-ownership list and the required report format (files, PASS/FAIL per command, deviations, unverified claims).

### Wave 0 · Spikes (coordinator + one Fable agent, ~1 day)

| Spike                 | Retires                                                                                                                                                                                                                                                                                                                                                           | Exit                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| S0.1 shader materials | A `ShaderMaterial` with `instancing matrices` whose `mainVertex` takes `@builtin(instance_index)` and reads a storage buffer draws 100,000 quads on a real device and on SwiftShader; `updateStorageBuffer` of a 1 KB slice per frame costs what; `depthOnlyFragment` lets a shader material cast; frame cost at 10k/100k/1M degenerate instances                 | numbers in `baselines.json` notes; ADR-0025 drafted                                       |
| S0.2 plugins          | A PBR plugin rewriting `baseColor` and `N` compiles with shadows and IBL on; `finalWorld[3]` displacement in `UPDATE_WORLDPOS` moves vertices **and the shadow-caster pass follows**; `uv2`/`color` readable there; how many plugin samplers fit beside PBR's own; whether `textureType: "texture_2d_array<f32>"` passes the bridge; Standard vs PBR UBO accessor | the `surfaceUniforms` rewrite rule and the layer cap fixed in §3.2/§5.2; ADR-0024 drafted |
| S0.3 terrain          | 64 chunks × 4 LODs with skirts on a 513² field: build time, GPU memory, draw-call count with half the terrain behind the camera (does Lite frustum-cull plain meshes?); `.r16` and PNG16 decoding in the browser and Node                                                                                                                                         | chunk size and format decisions confirmed in §5; ADR-0026 drafted                         |
| S0.4 WGSL tooling     | `wgsl_reflect` parses Lite's grid shader and ours, reports a line for a syntax error and for a vertex-stage `textureSample`, computes the particle record's offsets, and adds an acceptable time to `vite build`                                                                                                                                                  | the dependency paragraph for the standards (§13) written                                  |

### Wave 1a · Core primitives (three agents in parallel, ~2 days of agent time)

| Brief                                 | Model | Owns                                                                                                                                                                                                                                         | Delivers                                                                                                                                                                                                                                                  |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1-A shader assets and materials      | Opus  | `packages/core/src/render/shader-*.ts`, `storage-buffer-asset.ts`, `src/lite/gpu/shader-material.ts`, `loaders/shader-loader.ts`, material-asset additions, tests; `packages/vite-plugin/src/wgsl-validate.ts` + `.wgsl` in `asset-types.ts` | §3.1 and §3.4: the pragma parser, `ShaderAsset`, `"shader"` materials, system and ignifx uniforms, `setUniform/setTexture/setDefine/setStorageBuffer`, `StorageBufferAsset`, warm-up, hot reload, headless, the lazy adapter chunk, build-time validation |
| W1-B surface shaders and post effects | Opus  | `src/render/surface-shader*.ts`, `src/lite/gpu/material-plugin.ts`, `post-process-stack.ts` custom effects, `src/lite/gpu/post-process.ts` additions, tests                                                                                  | §3.2 and §3.3, `defineMaterialPlugin` (`@beta`)                                                                                                                                                                                                           |
| W1-C instancing and data primitives   | Opus  | `src/render/instanced-mesh-renderer.ts`, `src/lite/gpu/thin-instances.ts`, `TextureAsset.fromPixels/update`, `MeshAsset.fromData` extras and `update*`, tests, `benchmarks/scenes/instancing-20k`                                            | §3.5 and the first three rows of §2.2                                                                                                                                                                                                                     |

The coordinator owns `packages/core/src/index.ts`, `core-extension.ts`, the error-code tables and the umbrella; agents report the exports and codes they need. Wave 1a ends with `pnpm check` green and the three API reports reviewed.

### Wave 1b · The packages (parallel, ~3 days of agent time)

| Brief                              | Model                                                                                                      | Owns                                                                                           | Delivers                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1-D particles                     | **Fable**                                                                                                  | `packages/particles/**`                                                                        | `ParticleAsset` + format + schema, `ParticleEmitterCore`, the TypeScript and WGSL evaluators and their conformance test, `pcg3d`, presets, `ParticleSystem` on the wave-1a API, `app.particles`, headless tests, determinism hash, skill                                                                                         |
| W1-E terrain                       | **Fable**                                                                                                  | `packages/terrain/**`                                                                          | `TerrainAsset` + format + schema, height field (`.r16`, PNG, noise), chunk/LOD geometry with skirts, `TerrainLodSystem`, queries, `colliderInit`, `setHeights`, the `terrainSplat` and `wind` surface shaders, `TerrainScatter`, `foliageMaterialDefinition`, headless tests, skill; `ignifx import heightmap` in `packages/cli` |
| W1-F sprite batch and particles-2d | Opus (starts with `SpriteBatch` in `@ignifx/2d` while D runs; `ParticleSystem2D` once D's evaluator lands) | `packages/2d/src/service/sprite-batch.ts` + registry hooks + tests; `packages/particles-2d/**` | `SpriteBatch` (§2.2), `ParticleSystem2D`, tests, skill                                                                                                                                                                                                                                                                           |

Terrain's geometry, queries, noise, scatter placement and LOD selection are headless and start on day one; only its material work waits for wave 1a. Contracts fixed in the briefs before fan-out (the Phase 1 lesson): the pragma grammar and `ShaderAsset` declaration type; the `SurfaceShader` hook signatures; the `ParticleDefinition` type and record layout; the `InstancedMeshRenderer`, `StorageBufferAsset` and `SpriteBatch` APIs; the `HeightfieldCollider` init shape. Package skeletons are written by the coordinator and installed **once** before the agents start; agents never install or add dependencies.

### Wave 2 · Integration, examples, docs (~2 days)

1. Coordinator: the registration checklist in §7.2, `pnpm check`, browser and visual suites, API reports, changesets (one `minor` per package; the `IGX-0708` removal is a feature, not a break).
2. Three example agents in parallel (Opus), one per category, owning `website/examples/<slug>/**`, their `entries/*.ts`, posters and `GOLDENS` rows; the coordinator owns `catalogue.ts`.
3. One docs agent (Opus): the ten recipes, entry-skill edits, `references/concepts/rendering.md`, formats pages; the coordinator runs `pnpm docs:harness` and reads every generated page.
4. Benchmarks and `baselines.json` rows recorded on the reference machine by the coordinator.

#### 7.2 Registration checklist for a new package (verified against the tree on 2026-09-08; executed by the coordinator)

Inside `packages/<name>/`, copied from `packages/3d`: `package.json` (name, `keywords: ["ignifx", "ignifx-extension"]`, `files: ["dist", "skills"]`, the seven scripts, `catalog:`/`workspace:*` dependencies, the `ignifx` manifest with `skill`), `tsconfig.json`, `tsconfig.test.json`, `test/tsconfig.json`, `tsdown.config.ts`, `api-extractor.json` (`reportFileName`), `typedoc.json` (`entryFileName`), `src/{index,extension,errors,version,schemas,file-schemas,settings,augmentation}.ts`, `skills/<name>/SKILL.md`, and — terrain only — `src/lite/gpu/`.

Root and cross-package files that must change: root `tsconfig.json` `references`; `.dependency-cruiser.cjs` `ALLOWED_IMPORTS` (a key per package, plus the `ignifx:` list); `commitlint.config.ts` `scope-enum`; `packages/ignifx/package.json` `dependencies`, `tsdown.config.ts` `neverBundle`, `src/index.ts` re-export block, `test/index.test.ts` surface assertion; `packages/vite-plugin/src/asset-types.ts` (`.particles.json`, `.terrain.json`, `.surface.wgsl` in `ASSET_TYPE_BY_SUFFIX`; `.wgsl`, `.r16` in `ASSET_TYPE_BY_EXTENSION`); the error-code range in three places (§2.1); `skills/ignifx/SKILL.md` extensions table; `skills/ignifx/references/recipes/README.md` rows and `website/scripts/repo-content.ts` `GUIDE_GROUPS`; `website/scripts/copy-features.ts` and `copy.ts`; `website/examples/catalogue.ts` `CATEGORIES` and one `entries/<category>.ts` per category; `tests/visual/tests/examples.spec.ts` `GOLDENS`; `docs/architecture/00-overview.md` §2/§2.1, `AGENTS.md`; a changeset per package; `THIRD_PARTY_NOTICES.md` regenerated (`wgsl_reflect`, `fast-png`). `packages/devtools` gains no panel in v1, so its optional-peer lists are untouched. Nothing else holds a package list: `vitest.config.ts`, `turbo.json`, `pnpm-workspace.yaml`, `.changeset/config.json`, the workflows, every `scripts/*.ts`, and the CLI's template resolution are glob- or manifest-driven.

### Wave 3 · Quality control (~1–2 days)

- Every gate re-run from a clean state: `pnpm check`, `pnpm test:browser`, `pnpm test:visual`, `pnpm test:frame-budget`, `pnpm pack-check`, `pnpm deps`, `pnpm release:verify` dry run. Results pasted into the PR description (standards §15).
- API review of the three new reports against §2's public surface: nothing exported that §2 does not name; every symbol tagged; `@internal` kept out of the umbrella.
- Agent evaluation (Phase 11's method): a fresh agent given only the skills builds "a campfire with fire, smoke and sparks on a heightmap terrain the player walks on, with a snow surface shader on the rocks" in a scaffolded template, with zero source reads. Its report drives documentation fixes before merge.
- ADRs 0024–0026 finalised with the spike measurements; `engineering-plan.md` §8 amended; `07-wishlist.md` rows deleted; this document's status line updated with what shipped and what did not.
- Commits: one per wave on a `feat/…` branch, Conventional Commits with package scopes, no trailer, no push until asked.

## 8. Definition of done (per `CONSTITUTION.md` §6.6, restated)

For each system: code with TSDoc and release tags; unit tests headless at the package floor of 80% (core above 90%); Chromium tests for every GPU path; a visual golden per example; determinism tests where §2.1 applies (particle records, terrain noise, scatter placement); `api/*.api.md` regenerated with no warnings; the subsystem skill and entry-skill edits compiling under `pnpm docs:harness` with `ts run` blocks executed; recipes compiled; `ignifx.schemas.json` regenerated; benchmarks with committed baselines; bundle ceilings unchanged for scenes that use none of it; changesets; the website examples with posters, goldens and catalogue entries; `THIRD_PARTY_NOTICES.md` regenerated.

## 9. Research findings, upstream asks, and open items

### 9.1 What the research changed in this plan

| Finding (source)                                                                                                                                                                                                                                        | Effect                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Godot and Unity declare shader uniforms in the shader file and get inspector exposure for free; PlayCanvas reflects WGSL bindings from source (Godot shading-language reference; Unity `SL-Properties`; PlayCanvas WGSL reflection page)                | §3.1: pragma declarations in `.wgsl` are the schema; `.material.json` holds values only                                         |
| Babylon.js has three incompatible injection-point taxonomies; PlayCanvas keeps a per-release chunk-migration page (Babylon `materialPlugins.md` and `custom/readme.md`; PlayCanvas shader-chunk-migrations)                                             | §3.2: three named hooks are the public contract; raw points are `@beta`                                                         |
| Lite plugin textures are fragment-only and `position` is immutable, but `finalWorld` is a per-vertex `var` (`plugin-bridge-shared.js`, `pbr-template.js`)                                                                                               | translation-only vertex displacement through `finalWorld[3]`: lit foliage wind via `displace`; CDLOD not buildable on PBR       |
| PlayCanvas's GPU particles are a ping-pong RTT Euler simulation whose `sort` forces the CPU path; Godot's CPU/GPU twins lost parity ("harder and harder to keep feature parity", Godot progress report)                                                 | §4.1: one evaluator specification in two hosts with a conformance test; no per-particle sorting                                 |
| Integer hashes reproduce bit-for-bit across JS and WGSL, trig hashes do not (Jarzynski & Olano, JCGT 2020)                                                                                                                                              | `pcg3d` for all per-particle randomness                                                                                         |
| `textureSample` is fragment-only in WGSL (gpuweb #4814)                                                                                                                                                                                                 | lookup rows read with `textureSampleLevel` in the vertex stage; a build-time check in the Vite plugin                           |
| Premultiplied alpha lets additive and over-blended particles share a draw (NVIDIA, RTCD)                                                                                                                                                                | default blend `premultiplied`                                                                                                   |
| 8-bit heightmaps terrace; 16-bit is the floor; R16 raw is the common import (Terrain3D, Unity)                                                                                                                                                          | `.r16` canonical, PNG16 via CLI import, PNG8 warns                                                                              |
| Unity built-in and URP terrains use RGBA weights for four layers per pass; Terrain3D packs index plus weight into one 32-bit word for 32 layers over two texture arrays                                                                                 | four layers in v1; the packed control word is v2 once Lite plugins accept `texture_2d_array`                                    |
| Terrain normals: precompute, regenerate on edit (Terrain3D, Unity default)                                                                                                                                                                              | §5.2                                                                                                                            |
| `wgsl_reflect` 1.6.0 (MIT, zero deps, 2026-09-05) is the only maintained Node WGSL parser; `naga-wasm`, `wgsl-validator`, `@webgpu/wgsl-validator` do not exist on npm; the Dawn-based `webgpu` (MIT, 95 MB, 2026-08-28) gives browser-grade validation | `wgsl_reflect` in the Vite plugin; `webgpu` optional contributor tooling, not a dependency                                      |
| Lite 1.28.0 is unchanged in these areas; PR #583 (writable storage buffers, GPU meshes) is open with its compute half split out; Lite's particle roadmap is CPU-only                                                                                    | nothing waits on upstream; §4's record layout lets a compute evaluator replace the vertex evaluator later without an API change |

### 9.2 Upstream asks for Babylon Lite (to be filed; tracked in `engineering-plan.md` §4 "Upstream")

A compute task in the frame graph or a public `GPUDevice`/`GPUCommandEncoder` path (follows PR #583); `var roughness`/`var metallic` in the PBR template so plugins can drive them (wetness, damage); vertex-stage plugin uniforms, samplers and helper functions (time-driven `displace`, CDLOD); a `composite` slot and a re-bakeable plugin signature for Standard materials; a `time` system uniform; light and shadow bindings for `ShaderMaterial`; a mesh-removal path that does not dispose.

### 9.3 Not in v1, and why

Soft particles (need the scene depth as a sampleable texture: `enableRenderTaskTransmission({ grabDepth })` exists but retargets the task — evaluate for v1.1); per-particle sorting (stateless; CPU sort would defeat the design); trails (feasible statelessly and cheap — v1.1 module); sub-emitters and collisions (not functions of `t` alone); terrain holes (an `alpha` write in `surface()` plus a heightfield mask — feasible v1.1); more than eight layers and the packed control word (a v2 design; texture arrays already work); CDLOD morphing (vertex-stage textures; the `uv2` route is v1.1); streaming terrains (one terrain per world); EXR heightmaps (a decoder dependency for little gain over `.r16`); NPE and NME importers (Lite covers 34 NPE block classes; NME JSON has no documented schema).

## 10. Risks

| Id   | Risk                                                                                                                              | Mitigation                                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-S1 | `@builtin(instance_index)` or storage-buffer indexing behaves differently on SwiftShader than on hardware, breaking goldens in CI | S0.1 runs on both; goldens are captured on SwiftShader as today                                                                                        |
| R-S2 | Shader materials appear frames late at runtime (ADR-0014) and users blame the API                                                 | `warmUp` support and the gotcha; presets pre-registered by `app.particles` at start                                                                    |
| R-S3 | The shadow-caster pass ignores plugin vertex displacement, so wind-blown foliage casts a still shadow                             | S0.2 checks it first; fallback is a `ShaderMaterial` with `depthOnlyFragment`                                                                          |
| R-P1 | Alpha-blended particle order looks wrong in some compositions                                                                     | premultiplied default; the skill says when to use which blend                                                                                          |
| R-P2 | The TypeScript and WGSL evaluators drift                                                                                          | the conformance matrix test and the shared lookup rows; the `pcg3d` hash                                                                               |
| R-T1 | Confirmed by S0.3: Lite does not frustum-cull plain meshes                                                                        | S0.3 measures; `TerrainLodSystem` adds a 64-box frustum test if needed                                                                                 |
| R-T2 | LOD popping is visible on the goldens                                                                                             | small chunks and hysteresis in v1; the `uv2` morph path recorded for v1.1                                                                              |
| R-C1 | Core bundle grows for games that use none of this                                                                                 | the shader adapter is a dynamic `import()` chunk reached only from the `"shader"` loader branch; `bundle-size.test.ts` enforces `hello-cube`'s ceiling |
| R-C2 | Three new packages triple the registration surface and one missed list breaks `pnpm check`                                        | §7.2 is executed by the coordinator, not by agents                                                                                                     |
| R-D1 | New runtime dependencies (`wgsl_reflect` in the Vite plugin, `fast-png` in the CLI)                                               | both MIT, small, Node-only, licence notices regenerated; the ADR dependency paragraph (standards §13)                                                  |

## 11. Execution record (2026-09-15)

Shipped on the branch, all gates green locally (`pnpm check`, browser, visual, frame budgets, `pnpm deps` under Node 24, `pnpm pack-check`): the core additions of §2.2 and §3 (with `parseShaderDeclaration`, `attachSurfaceShaders` and the binding helpers kept off the public barrel — the public path is `surfaces` on a PBR definition and `material.surface(name)`, which keeps Lite's plugin, thin-instance, storage-buffer and effect-task code out of `hello-cube`'s entry chunk: 282.5 KB gzipped against the 295,497 B ceiling); `@ignifx/particles`, `@ignifx/particles-2d` and `@ignifx/terrain` as designed in §4 and §5; `SpriteBatch`; `.wgsl` validation; `ignifx import heightmap`; the fourteen examples of §6.1; the ten recipes and skill pages of §6.2; the benchmark rows of §6.3.

Deviations recorded during execution: `TerrainLodSystem` runs after core's render sync (`PreRender` order 10), because `Camera.getViewMatrix` reads the Lite camera the sync writes; `TerrainColliderInit` carries no `center` — `HeightfieldCollider` always centres on its entity, so a sub-region collider goes on a child entity placed with `Terrain.regionCenter`; Babylon Lite reads heightfield rows from the largest Z, which `colliderInit()` now honours (an integration test lives in `packages/physics/test`, allowed by a test-only layering rule); `InstancedMeshRenderer` also carries `renderOrder` and `pickable`; surface shaders' `surface` hook has no `uv2`; `f16` is unreachable because Lite exposes no optional device features; `terrain-foliage` and `terrain-sculpt` use a small meadow rather than the island so the scatter density reads as grass; the LOD readout in `terrain` is an instanced marker per chunk, because chunks share one material.

Defects found and fixed along the way: `Environment.fog` had never reached the shader; two renderable rebuilds could overlap during Lite's frame-graph rebuild and leave a render pass without a colour attachment (a black canvas after a material swap); a prewarmed world-space particle system spawned its first cycle at the origin; five particle presets were unloadable; the particle census aged records at f64 against f32 spawn times, so rate-driven systems reported nothing alive.

Not done, for the follow-up list: the agent-evaluation gaps of Wave 3 as reported (see the pull request); lit, shadow-receiving foliage and time-driven `displace` still wait on vertex-stage plugin uniforms upstream (§9.2); the packages are unpublished until the next release.

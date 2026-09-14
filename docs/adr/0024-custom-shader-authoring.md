# ADR-0024 · Custom shaders: the WGSL file is the declaration, and lit shaders are hooks

**Status:** Proposed · **Date:** 2026-09-08 · **Deciders:** Astrum Forge Studios

## Context

ignifx renders through Babylon Lite 1.27.0, whose custom-material path is `createShaderMaterial` (`index.d.ts` 3071): the author supplies complete `mainVertex`/`mainFragment` WGSL entry points, and Lite generates the bindings — a scene UBO at `@group(0)`, `shaderSystem` and `shaderUniforms` structs, one `name`/`nameSampler` pair per sampler, `var<storage, read>` buffers, `const` defines and a `VertexInput` struct (`lib/material/shader/shader-pipeline.js` 185–210). Such a material receives no lights and no shadows. Lite's other extension point is the material plugin (`MaterialPlugin`, 7053): WGSL spliced into ten fixed points of the PBR and Standard shaders, with fragment-only samplers, writable `baseColor`/`alpha`/`emissive`/`N`/`color`, read-only `roughness`/`metallic`, and a per-vertex `var finalWorld` the vertex slot may edit (`lib/material/pbr/pbr-template.js`).

The engine's material format already declared `"type": "shader"` and rejected it (`IGX-0708`). `CONSTITUTION.md` §2.2 asks for one obvious way per task and for APIs an agent can use from the skill alone; §2.5 forbids paying for unused features; §5.4 requires every public surface to be documented. The survey of Bevy, three.js, Babylon.js, Godot, Unity and PlayCanvas (plan §9.1) found that the two engines whose shader parameters reach an inspector automatically declare them in the shader file, and that Babylon.js carries three incompatible injection-point vocabularies while PlayCanvas maintains a per-release chunk-migration page.

## Options considered

1. **Declare uniforms in `.material.json`, shader in `.wgsl`** — two files to keep in sync; the inspector needs the JSON; agents forget one of the two.
2. **Declare in the `.wgsl` through comment pragmas** (`// @ignifx uniform …`) — one file, still valid WGSL for other tools, parsed at build (`wgsl_reflect`) and at load (a small parser); the material file holds values only.
3. **Extended WGSL syntax** (PlayCanvas style `uniform x: f32;`) — needs a preprocessor before every other tool can read the file.
4. **Expose Lite's raw injection points as the lit-shader API** — ties the public surface to Lite's template variable names and slot list.
5. **Three named hooks (`displace`, `surface`, `composite`) compiled onto the plugin points** — a stable contract owned by ignifx; the raw points stay `@beta`.

## Decision

- A shader lives in one `.wgsl` file whose `// @ignifx …` pragma lines are its declaration: kind (`shader`, `surface`, `post`), attributes, system uniforms, custom uniforms with schema hints, textures, storage buffers, defines and pipeline state. A `MaterialAsset` of kind `"shader"` is values applied to a shader asset.
- Lit custom looks are **surface shaders**: plain WGSL functions `displace(in) -> vec3<f32>`, `surface(in, s: ptr<function, Surface>)`, `composite(in, color) -> vec3<f32>` that ignifx compiles into one Lite material plugin on a PBR or Standard material. `roughness` and `metallic` are read-only in this Lite version and the skill says so. Raw injection points remain available through `defineMaterialPlugin` tagged `@beta` and documented as tracking Lite's template.
- Full-screen effects are `post` shaders recorded into the existing offscreen post-process chain.
- ignifx supplies the uniforms Lite does not: `time`, `unscaledTime`, `deltaTime`, `mainLightDirection`, `mainLightColor`, `ambientColor`, appended to the custom uniform block and written once per frame.
- `@ignifx/vite-plugin` validates every `.wgsl` at build time with `wgsl_reflect` (MIT, zero dependencies): syntax, entry points per kind, undeclared names, hand-declared bindings, vertex-stage `textureSample`. The Dawn-based `webgpu` package is not a dependency.
- The shader-material adapter is a dynamic `import()` so a game with no shader material pays nothing (`hello-cube` ceiling unchanged).

## Consequences

- Authors and agents learn Lite's names once (`VertexInput`, `shaderSystem.x`, `shaderUniforms.x`, `<name>Sampler`, `mainVertex`, `mainFragment`) and ignifx's pragma grammar; nothing has to be mirrored in JSON.
- A `ShaderMaterial` receives no shadows and no direct light; the skill routes lit needs to surface shaders. Vertex displacement through plugins is translation-only (`finalWorld[3]`) and **static**: Lite's plugin uniforms, samplers and helper functions are fragment-stage only (verified 2026-09-09), so `displace` reads position, normal, `uv`, `color` and the world matrix and nothing else; time-driven wind and waves are `ShaderMaterial`s. Surface shaders attach to PBR hosts only in v1 (Lite bakes a Standard material's plugin signature before ignifx creates its meshes, and the Standard template has no `composite` slot).
- Lite template changes can break raw-point plugins; surface shaders absorb them in the compiler. Upstream asks recorded in the plan (§9.2): writable `roughness`/`metallic`, vertex-stage and `texture_2d_array` plugin samplers, a `time` system uniform, light bindings for shader materials.
- Validation (spikes S0.1/S0.2, 2026-09-08, Apple M1 Metal, Lite 1.27.0): a `ShaderMaterial` with `@builtin(instance_index)` reading a read-only storage buffer compiled and drew; Lite prepends its prelude to both stages, so one `.wgsl` file is passed as both sources. Shader materials cast PCF shadows unflagged but cannot be ESM casters (Lite writes fragment colour into the ESM map — `lib/shadow/esm-directional-shadow-generator.js` 230–245); the renderer excludes them from ESM caster lists (`IGX-0724`; `packages/core/test/render/shader-esm-casters.browser.test.ts` shows the shader box darkening the ground under PCF and leaving the ESM frame unchanged with one warning — measured beside a PBR caster, because with an empty caster list Lite skips the shadow pass and the previous map stays). A PBR plugin rewriting `baseColor` and `N` compiled with IBL and PCF shadows; `finalWorld[3]` displacement moved the mesh and its PCF and ESM shadows; `uv2` is unavailable to plugins without a private mask; nine plugin samplers fit beside a fully textured PBR with IBL and one shadow light under the 16-texture device default; `texture_2d_array<f32>` plugin samplers work behind a type cast; PBR plugin values re-upload only after `markMaterialUboDirty`, Standard `dynamic: true` re-uploads every frame.

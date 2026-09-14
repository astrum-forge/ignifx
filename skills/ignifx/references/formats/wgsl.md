# Shader files (`.wgsl`)

<!-- Hand-written, not generated: a shader's declaration lives in comments inside the file, so there is no schema for `pnpm docs:schemas` to render. -->

A shader is a WGSL file whose `// @ignifx …` comment lines **are** its declaration. Nothing outside
the file has to be kept in sync with it: the pragmas say which form the file is, what the vertex
stage reads, and which uniforms, textures, storage buffers and defines a material may set — and the
same lines are what the devtools inspector renders and what `setUniform` is checked against. The file
stays valid WGSL for every other tool, because a pragma is a comment.

How the three forms behave, and the WGSL rules that trip agents up, are in
[`../concepts/rendering.md`](../concepts/rendering.md) § "Custom shaders". Worked examples:
[`write-a-custom-shader`](../recipes/write-a-custom-shader.md),
[`add-a-surface-shader`](../recipes/add-a-surface-shader.md),
[`add-a-custom-post-process`](../recipes/add-a-custom-post-process.md).

## The three forms

| First pragma      | The file is                                       | It provides                                                                | Lit by the engine                    |
| ----------------- | ------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| `@ignifx shader`  | A whole material family (`type: "shader"`)        | `@vertex fn mainVertex`, `@fragment fn mainFragment`                       | No — you own every pixel             |
| `@ignifx surface` | A layer on a **PBR** material (`.surface.wgsl`)   | any of `fn displace`, `fn surface`, `fn composite`                         | Yes — shadows, IBL, fog, tone mapping |
| `@ignifx post`    | One full-screen pass (`.post.wgsl`)               | `fn mainFragment(in: PostInput) -> vec4<f32>`                              | Not applicable                       |

Exactly one form line per file. The suffix is a convention for people; the pragma is what decides.

## Pragma grammar

One directive per line, anywhere in the file, in any order. A name may be claimed once: a uniform, a
texture (which also claims `<name>Sampler`), a storage buffer and a define share one namespace.

| Directive                                                                                                 | Example                                                             | Meaning                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ignifx shader` \| `surface` \| `post`                                                                   | `// @ignifx shader`                                                 | The form. Takes no arguments; a second one is `IGX-0719`                                                                                               |
| `@ignifx attributes a, b, …`                                                                              | `// @ignifx attributes position, normal, uv`                        | The Babylon Lite attributes `VertexInput` carries: `position normal uv uv2 tangent color joints weights joints1 weights1`. A `shader` file must include `position` |
| `@ignifx system u, v, …`                                                                                  | `// @ignifx system worldViewProjection, time`                       | Engine uniforms. Lite's are `world view projection viewProjection worldView worldViewProjection cameraPosition screenSize alphaCutoff`; ignifx adds `time unscaledTime deltaTime mainLightDirection mainLightColor ambientColor` |
| `@ignifx uniform name: type [= default] [modifiers]`                                                      | `// @ignifx uniform tint: vec3<f32> = color(1, 0.4, 0.1)`           | A settable uniform. Types: `f32 u32 i32 vec2<f32> vec3<f32> vec4<f32> mat4x4<f32>`. Modifiers: `range(a, b)`, `step(s)`, `color`, `tooltip("…")`      |
| `@ignifx texture name [srgb] [normal] [default white\|black\|transparent] [array]`                        | `// @ignifx texture albedo srgb default white`                      | A `texture_2d<f32>` and its `<name>Sampler`. `default` binds a 1×1 texel while nothing is bound; `array` declares `texture_2d_array<f32>`              |
| `@ignifx storage name: array<T>`                                                                          | `// @ignifx storage particles: array<Particle>`                     | A read-only storage buffer, bound with `material.setStorageBuffer(name, buffer)`                                                                        |
| `@ignifx define NAME = true \| false \| number`                                                           | `// @ignifx define SOFT_EDGE = true`                                | A WGSL `const`; a material may override it with `setDefine`, which recompiles                                                                           |
| `@ignifx blend … cull … depthWrite … depthTest … transmissive instancing …`                               | `// @ignifx blend additive cull none depthWrite off`                | Pipeline state, several keywords per line or one line each                                                                                              |

Pipeline keywords and their values: `blend opaque|alpha|additive|premultiplied`,
`cull back|none`, `depthWrite on|off`, `depthTest on|off`, `transmissive` (no value, and it needs a
blended surface), `instancing none|matrices|matrices-colors`.

What an omitted directive means:

| Omitted           | Effective value                                                                     |
| ----------------- | ----------------------------------------------------------------------------------- |
| `attributes`      | `position` for a `shader` file, nothing for `surface` and `post`                    |
| `blend`           | `opaque`                                                                            |
| `cull`            | `back`. Babylon Lite 1.27.0 has no front-face culling: `cull front` is `IGX-0719`   |
| `depthWrite`      | On for `opaque`, off for every blended mode — Lite's own rule                       |
| `depthTest`       | On                                                                                  |
| `instancing`      | `none`                                                                              |
| A uniform default | `0` (or the identity, for `mat4x4<f32>`)                                            |
| A texture default | Nothing is bound until the material binds it                                        |

A `color(r, g, b[, a])` default — and the bare `color` modifier — marks the uniform **sRGB**: the
numbers stay as authored in the file and in `.material.json`, and are uploaded linear.

## The material side (`.material.json`)

A material is *values applied to a shader*, the same relationship a PBR material has to the engine's
own. The generated field table is [`ignifx.material.md`](ignifx.material.md).

```jsonc
{
  "format": "ignifx.material",
  "formatVersion": 1,
  "type": "shader",
  "name": "dissolve",
  "shader": "shaders/dissolve.wgsl", // the file whose pragmas declare the layout
  "values": { "progress": 0.25, "edgeColor": [1, 0.6, 0.2] }, // by declared uniform name
  "textures": { "noiseTexture": { "$asset": "textures/noise.png" } }, // by declared sampler name
  "defines": { "SOFT_EDGE": true },
}
```

A PBR material carries its surface shaders instead, in the order they run:

```jsonc
{
  "format": "ignifx.material",
  "formatVersion": 1,
  "type": "pbr",
  "name": "rock",
  "roughness": 0.85,
  "surfaces": [
    "shaders/snow.surface.wgsl", // an address on its own, or the long form:
    {
      "shader": "shaders/wet.surface.wgsl",
      "name": "wet", // what `material.surface(name)` answers to; "" takes the file's basename
      "values": { "amount": 0.4 },
      "textures": { "puddles": { "$asset": "textures/puddles.png" } },
      "enabled": true,
      "priority": 500, // lower runs first
    },
  ],
}
```

In code the same two shapes are `shaderMaterialDefinition({ shader, values, textures, defines })` and
`pbrMaterialDefinition({ surfaces: [...] })`, where a definition's `surfaces` entries carry
**addresses** and every shader they name has to be loaded first (`IGX-0501` otherwise). Live edits
go through the material: `material.setUniform/setTexture/setDefine/setStorageBuffer`, and
`material.surface(name).set(…)` / `.setTexture(…)` / `.enabled`.

In code a `surfaces` entry is a `SurfaceShaderReference`, and **every field is required**: `shader`,
`name`, `values`, `textures`, `enabled`, `priority`. The bare-address short form and the optional
fields belong to the file format only. A shader that declares no textures still takes `textures: {}`.

## `.surface.wgsl`

A surface shader writes plain functions; `SurfaceInput`, `Surface` and `DisplaceInput` are generated
for it, and its own uniforms are read from `surfaceUniforms`, which the compiler rewrites into the
host material's uniform block so two shaders on one material never collide.

| Hook                                                   | Runs                                | Reads                                                                     | Writes                                                                     |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `displace(in: DisplaceInput) -> vec3<f32>`             | Vertex stage, per vertex            | `in.position`, `in.normal`, `in.uv`, `in.color`, `in.world` — nothing else | A **world-space offset**; the shadow pass follows it                        |
| `surface(in: SurfaceInput, s: ptr<function, Surface>)` | Fragment, before lighting           | `in.uv`, `in.worldPosition`, `in.geometricNormal`, `in.viewDirection`, `in.color` | `(*s).baseColor`, `.alpha`, `.emissive`, `.normal`                  |
| `composite(in: SurfaceInput, color: vec3<f32>) -> vec3<f32>` | Fragment, after lighting, before fog and tone mapping | the same `SurfaceInput`, plus the lit linear colour           | The returned colour                                                        |

- `(*s).roughness` and `(*s).metallic` are readable and **ignored on write**: Babylon Lite's PBR
  template declares them `let`.
- `displace` cannot read a uniform, a texture or a helper function, and cannot loop or switch: Lite's
  plugin uniforms and samplers are fragment-visible only, and the hook is inlined. Time-driven wind
  is a `@ignifx shader` file, not a hook.
- `in.color` reads white and there is no `uv2`: Lite gates both behind material state a plugin
  cannot see.
- A write to `alpha` reaches blending, not the cutout test — an `alphaMode: "mask"` host has already
  discarded by the time the hook runs.
- One material's surface shaders share a budget of **nine** samplers (`IGX-0726`), measured beside a
  fully textured PBR material with image-based lighting and a shadow light.

## `.post.wgsl`

```wgsl
// @ignifx post
// @ignifx uniform amount: f32 = 1 range(0, 1)

fn mainFragment(in: PostInput) -> vec4<f32> {
  let source = textureSample(inputTexture, inputTextureSampler, in.uv);
  return vec4<f32>(mix(source.rgb, vec3<f32>(1.0) - source.rgb, shaderUniforms.amount), source.a);
}
```

`PostInput` carries `uv` and `position` (the fragment's pixel coordinates). `inputTexture` and
`inputTextureSampler` are the chain's current colour, bound by the engine, and `shaderUniforms`
already holds `screenSize`, `time`, `unscaledTime` and `deltaTime` — none of which is declared. A
post file declares no attributes and no `@ignifx system` line. Effects are attached through
`PostProcessStack.custom` with `customEffect({ shader, values, textures, order, enabled })`.

## What is checked, and when

| When                     | Checked by                       | Reports                                                                                                                                                                                                       |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite dev` / `vite build` | `@ignifx/vite-plugin`, with file and line | `IGX-0654` — the file does not parse as WGSL. `IGX-0655` — it parses but breaks the contract: no form line or two of them, a missing entry point for the declared form, a `shaderUniforms.x`/`surfaceUniforms.x` or texture that is not declared, a hand-declared `@group`/`@binding`, or a `textureSample` outside the fragment stage |
| Load                     | The pragma parser                | `IGX-0719`, with the line: an unknown or malformed directive, a duplicate name, a type Babylon Lite does not have, or a combination it cannot express                                                          |
| Material build           | `MaterialAsset`                  | `IGX-0712` (a name the file never declared), `IGX-0713` (right name, wrong shape), `IGX-0716` (a surface shader without `rendering.features.materialPlugins`), `IGX-0723` (a Standard host, or no hook at all) |
| First draw               | The browser's WGSL compiler      | `IGX-0715` on `app.onError`, carrying Babylon Lite's message; the last good material keeps drawing                                                                                                             |

Full type checking stays with the browser: the build-time rules exist to give a failure a file and a
line, because the compiler sees Lite's generated module — your source with a scene UBO,
`shaderSystem`, `shaderUniforms`, the sampler pairs and `VertexInput` in front of it — and numbers
its lines accordingly.

Outside a Vite project — a headless Node game, a library, a test — the same checks are one call:
`validateWgslSource` from `@ignifx/vite-plugin` (see [`api/vite-plugin.md`](../api/vite-plugin.md))
takes the file's text and reports the `IGX-0654`/`IGX-0655` problems with their lines. It does not
compile the WGSL; only a browser does that.

# File formats

Every ignifx JSON file carries a `format` string and a positive integer `formatVersion`, and
`@ignifx/vite-plugin` validates every one of them at build time. A "generated" page is a field table
written from the schema the owning package exports, so it cannot disagree with the validator; a
"prose" page explains how the file is used.

| Page | Kind | File | Covers |
| --- | --- | --- | --- |
| [`scene.md`](scene.md) | prose | `.scene.json`, `.prefab.json` | Entities, instances, overrides, nested prefabs |
| [`ignifx.scene.md`](ignifx.scene.md) | generated | the same | The scene file's top-level fields |
| [`components.md`](components.md) | generated | inside a scene file | Every built-in component's serialized fields and defaults |
| [`material.md`](material.md) | prose | `.material.json` | PBR and Standard materials, texture slots |
| [`ignifx.material.md`](ignifx.material.md) | generated | the same | The material file's fields, shader materials included |
| [`wgsl.md`](wgsl.md) | prose | `.wgsl`, `.surface.wgsl`, `.post.wgsl` | The `// @ignifx` pragma grammar, surface hooks, post effects |
| [`ignifx.mesh.md`](ignifx.mesh.md) | generated | `.mesh.json` | One primitive mesh and its options |
| [`ignifx.environment.md`](ignifx.environment.md) | generated | `.environment.json` | Image-based lighting, the BRDF table, the skybox |
| [`ignifx-probes.md`](ignifx-probes.md) | generated | `.probes.json` | A baked light-probe grid (`LightProbeVolume`) |
| [`ignifx-lightmap.md`](ignifx-lightmap.md) | generated | `.lightmap.json` | A lightmap texture and per-entity atlas entries |
| [`inputactions.md`](inputactions.md) | prose | `.input.json` | Maps, actions, binding paths, composites, processors (`@ignifx/input`) |
| [`ignifx.inputactions.md`](ignifx.inputactions.md) | generated | the same | The input actions file's top-level fields |
| [`ignifx.audiobuses.md`](ignifx.audiobuses.md) | generated | `.audio.json` | The mixer's bus tree (`@ignifx/audio`) |
| [`ignifx.physicsmaterial.md`](ignifx.physicsmaterial.md) | generated | `.physicsmaterial.json` | Friction, static friction, restitution (`@ignifx/physics`, `@ignifx/physics-2d`) |
| [`ignifx.spriteatlas.md`](ignifx.spriteatlas.md) | generated | `.atlas.json` | An image and its frame rectangles (`@ignifx/2d`) |
| [`ignifx.spriteanimation.md`](ignifx.spriteanimation.md) | generated | `.spriteanim.json` | Clips of atlas frames, rates, frame events (`@ignifx/2d`) |
| [`ignifx.tilemap.md`](ignifx.tilemap.md) | generated | `.tilemap.json` | Tile layers, tilesets with colliders, an objects layer (`@ignifx/2d`) |
| [`ignifx.animator.md`](ignifx.animator.md) | generated | `.animator.json` | Parameters, layers, states, transitions, 1D blend trees (`@ignifx/3d`) |
| [`ignifx.particles.md`](ignifx.particles.md) | generated | `.particles.json` | A particle effect's modules (`@ignifx/particles`) |
| [`ignifx.terrain.md`](ignifx.terrain.md) | generated | `.terrain.json` | Size, heightmap or noise, chunks, layers, splat (`@ignifx/terrain`) |
| [`ignifx.i18n.md`](ignifx.i18n.md) | generated | `.i18n.json` | Message tables per locale, ICU-style plurals (`@ignifx/ui`) |
| [`ignifx.schemas.json`](ignifx.schemas.json) | generated | — | Every schema above in one JSON file (ignifx's own descriptor format, not JSON Schema), for tools |

The asset manifest (`assets.manifest.json`, format `ignifx.manifest`, version 1) is written by
`@ignifx/vite-plugin`. Its entries and the `.meta.json` sidecars are documented in that package's
`README.md`, with `virtual:ignifx/manifest` and `virtual:ignifx/scripts`.

In the engine repository the generated pages are written by `pnpm docs:schemas`; edit the schema, not
the page.

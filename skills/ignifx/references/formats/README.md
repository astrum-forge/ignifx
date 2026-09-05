# File formats

Every ignifx JSON file carries a `format` string and a positive integer `formatVersion`, and every
one of them is validated at build time by `@ignifx/vite-plugin`. The field tables here are generated
by `pnpm docs:schemas` from the schemas the packages export — never edit those by hand; the prose
pages beside them are maintained alongside `docs/architecture/06-serialization-and-scene-format.md`.

| Page                                             | Kind      | Covers                                                             |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------- |
| [`scene.md`](scene.md)                           | prose     | `.scene.json` / `.prefab.json`: entities, instances, overrides      |
| [`ignifx.scene.md`](ignifx.scene.md)             | generated | The scene file's top-level fields                                   |
| [`material.md`](material.md)                     | prose     | `.material.json`: PBR and Standard, texture slots                   |
| [`ignifx.material.md`](ignifx.material.md)       | generated | The material file's fields                                          |
| [`ignifx.environment.md`](ignifx.environment.md) | generated | `.environment.json`: IBL, BRDF table, skybox                        |
| [`inputactions.md`](inputactions.md)             | prose     | `.input.json`: maps, actions, binding paths, composites, processors |
| [`ignifx.inputactions.md`](ignifx.inputactions.md) | generated | The input actions file's top-level fields                         |
| [`components.md`](components.md)                 | generated | Every built-in component's serialized fields and defaults           |
| [`ignifx.schemas.json`](ignifx.schemas.json)     | generated | All of the above in one bundle, for tools and validators            |

The asset **manifest** (`assets.manifest.json`, format `ignifx.manifest`, version 1) is produced by
`@ignifx/vite-plugin`; its entries and `.meta.json` sidecars are documented in that package's
`README.md`.

Formats that arrive with later phases — atlas, tilemap, animator, audio buses — are listed in
`docs/architecture/06-serialization-and-scene-format.md` §6.

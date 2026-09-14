# Example asset attribution

Every file in this directory is redistributed under the licence recorded below, with the copyright
line its upstream project requires (`CONSTITUTION.md` §11.3). The site renders this file as
[/examples/attribution/](https://ignifx.com/examples/attribution/), and every example page names
the assets it loads.

Only **CC0** and **CC-BY** third-party assets may appear here
(`website/plan/04-examples-platform.md` §5.1): no NonCommercial, no NoDerivatives, no bespoke
licences. Each third-party licence below was confirmed from the asset's own `metadata.json`,
`README.md` or repository `LICENSE` **at download time**, on the date given, at the URL given.

Two kinds of file are not third-party assets and are not bound by that rule: the repository's own
generated art, which is Apache-2.0 like the rest of the repository, and **`models/ignifx-ship.glb`,
which is a brand asset the owner supplied** — it is here to be shown, not to be reused.

Downloaded and compressed 2026-09-07. Re-create every file from the commands in
[Provenance](#provenance) and compare the SHA-256 digests before replacing one.

| File                                              | Bytes     | Licence             | Used by                                                                                   |
| ------------------------------------------------- | --------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `models/ignifx-ship.glb`                          | 3 057 368 | proprietary         | `pbr-model` (the default)                                                                 |
| `models/corset.glb`                               | 1 599 040 | CC0 1.0             | `pbr-model` (Model select)                                                                |
| `models/lantern.glb`                              | 851 508   | CC0 1.0             | `model-loading` (the default)                                                             |
| `models/water-bottle.glb`                         | 570 720   | CC0 1.0             | `model-loading`                                                                           |
| `models/avocado.glb`                              | 364 960   | CC0 1.0             | `model-loading`                                                                           |
| `models/fox.glb`                                  | 162 852   | CC0 1.0 + CC-BY 4.0 | `skinned-animation`, `animator`                                                           |
| `models/emissive-strength-test.glb`               | 10 668    | CC-BY 4.0           | `bloom` (the back row)                                                                    |
| `models/rig.glb`                                  | 10 152    | Apache-2.0          | `third-person`                                                                            |
| `environments/studio.env`                         | 205 260   | CC-BY 4.0           | `pbr-model`, `model-loading`, `material-grid`, `skinned-animation`, `ibl`, `tone-mapping` |
| `environments/studio.environment.json`            | 129       | Apache-2.0          | `pbr-model`, `model-loading`, `material-grid`, `skinned-animation`, `ibl`, `tone-mapping` |
| `environments/sanGiuseppeBridge.env`              | 1 009 720 | CC-BY 4.0           | `ibl` (Bridge)                                                                            |
| `environments/sanGiuseppeBridge.environment.json` | 140       | Apache-2.0          | `ibl` (Bridge)                                                                            |
| `environments/ulmerMuenster.env`                  | 945 132   | CC-BY 4.0           | `ibl` (Cathedral)                                                                         |
| `environments/ulmerMuenster.environment.json`     | 136       | Apache-2.0          | `ibl` (Cathedral)                                                                         |
| `environments/brdf-lut.png`                       | 23 494    | Apache-2.0          | `pbr-model` (every `.env`)                                                                |
| `textures/backdrop.png`                           | 2 291     | Apache-2.0          | `pbr-model`                                                                               |
| `textures/grid.png`                               | 189       | Apache-2.0          | the kit's grid ground                                                                     |
| `fonts/share-tech-mono.ttf`                       | 43 272    | OFL-1.1             | `ui-overlay` (`HudText`)                                                                  |
| `audio/ambient.wav`                               | 57 644    | Apache-2.0          | `audio-mixer` (the loop)                                                                  |
| `audio/pickup.wav`                                | 14 156    | Apache-2.0          | `audio-mixer` (SFX bus)                                                                   |
| `audio/land.wav`                                  | 8 864     | Apache-2.0          | `audio-mixer` (SFX bus)                                                                   |
| `audio/jump.wav`                                  | 7 100     | Apache-2.0          | `audio-mixer` (SFX bus)                                                                   |
| `audio/ui-click.wav`                              | 2 470     | Apache-2.0          | `audio-mixer` (UI bus)                                                                    |

| `2d/tiny-town.png` | 3 799 | CC0 1.0 | `tilemap` |
| `2d/tiny-town.atlas.json` | 15 371 | Apache-2.0 | `tilemap` |
| `2d/village.tilemap.json` | 25 725 | Apache-2.0 | `tilemap` |
| `2d/villager.png` | 1 047 | Apache-2.0 | `tilemap` |
| `2d/villager.atlas.json` | 6 147 | Apache-2.0 | `tilemap` |
| `2d/villager.spriteanim.json` | 1 840 | Apache-2.0 | `tilemap` |
| `2d/runner.png` | 688 | Apache-2.0 | `sprite-animation`, `platformer-controller` |
| `2d/runner.atlas.json` | 2 168 | Apache-2.0 | `sprite-animation`, `platformer-controller` |
| `2d/runner.spriteanim.json` | 738 | Apache-2.0 | `sprite-animation`, `platformer-controller` |
| `2d/terrain.png` | 685 | Apache-2.0 | `sprite-animation`, `platformer-controller` |
| `2d/terrain.atlas.json` | 1 432 | Apache-2.0 | `sprite-animation`, `platformer-controller` |
| `2d/course.tilemap.json` | 3 979 | Apache-2.0 | `platformer-controller` |
| `2d/props.png` | 3 492 | CC0 1.0 | `physics-2d` |
| `2d/props.atlas.json` | 15 463 | Apache-2.0 | `physics-2d` |

**Total: 9 029 839 bytes** against the 48 MB launch cap, and the largest file is 2.92 MiB against
the 4 MB per-file cap (`04-examples-platform.md` §5.1 rule 4).

---

## `models/ignifx-ship.glb` — 3 057 368 bytes

The ignifx mascot ship, and the default subject of `pbr-model`: one mesh, one metal material with
base-colour, packed occlusion/roughness/metalness and normal maps, hovering over the studio floor.

> ignifx mascot ship — © 2026 Astrum Forge Studios Pty Ltd. A brand asset supplied by the owner on
> 2026-09-07 (original: `website/brand/source/spaceship.glb`), used under the ignifx trademark rules
> of Astrum Forge Studios; not a sample asset for reuse.

**Hero only.** `pbr-model` is the one example that may load it, and therefore the one poster and the
social card that may show it. No other example, template or recipe loads `models/ignifx-ship.glb`.

Derived from that original, which is **never modified**. The source arrives meshopt-compressed and
quantised at **1 942 544 triangles / 1 036 134 vertices** with three 4096px JPEG textures; dequantised
and uncompressed that is 59 462 228 bytes, so it cannot be shipped as it stands. The committed file
is **67 983 triangles / 50 317 vertices** — 3.5% of the original — with the normal map carrying the
detail the collapsed edges gave up, and it renders at 12 draw calls. `EXT_meshopt_compression` and
`KHR_mesh_quantization` are read at build time and **not** written: the meshopt runtime decoder would
be a CDN fetch, which `CONSTITUTION.md` §9.1 forbids, and nothing in this repository has verified
Lite against a quantised file.

- **Licence:** proprietary; © 2026 Astrum Forge Studios Pty Ltd. Not CC0 and not CC-BY, and
  therefore not a sample asset: an example may show it, and nothing may copy it out.
- **Source:** this repository, `website/brand/source/spaceship.glb`
  (SHA-256 `4d164cf09303b60b5ba1d3c06319da7d86e4c5b7ffe26ba50fdb4bcc5d80794e`, 14 493 100 bytes)
- **SHA-256:** `ce71555f6a6f62e5527453effe9f223768f536382d42efa2e4f112a0a72c1837`
- **Bounds:** 0.488464 × 0.503845 × 0.980164 metres, long axis Z, centred on its origin

## `models/corset.glb` — 1 599 040 bytes

A fabric mannequin wearing a corset with a printed pattern, brass eyelets and a leather trim: cloth,
metal and fine normal detail in one small model. It was the hero until the owner supplied the ship,
and it stays as the `pbr-model` panel's second subject, because swapping a loaded model at runtime
is one assignment and that is worth showing. Compressed from
the Khronos sample's 13 491 364 bytes with `_tools/compress-model.ts` — 11.9% of the original — by
welding the geometry and re-encoding the textures (base colour to 1024px JPEG at quality 84, the
normal and packed occlusion/roughness maps to 512px PNG). Not Draco, not meshopt, not WebP, and not
quantised: see [Provenance](#provenance).

- **Licence:** [Creative Commons Zero v1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (`CC0-1.0`)
- **Copyright:** © 2017, UX3D — "Microsoft for Everything"
- **Source:** <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Corset>
- **Licence confirmed:** 2026-09-07, from the model's own
  <https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Corset/metadata.json>
  (`"license": "CC0-1.0"`) and its generated `README.md`
- **SHA-256:** `09552fc5af44c62bf68c2413d3c841d36d0e5eb48496ed49192f3c4e684c509c`
- **SHA-256 of the upstream `Corset.glb`:** `9582c0dc0dee813be77f60e6ddf7213987c7e11497bf3cc66fd7b18957ae0d26`
- **Geometry extent:** 0.038950 × 0.057842 × 0.038950 glTF units. The sample is authored in
  centimetres, which is why `pbr-model/main.ts` scales its entity by 16.

## `models/lantern.glb` — 851 508 bytes

An old wooden street lamp: a post, a curved arm, an iron-banded base and a glass lantern hanging
from a chain, in three meshes and one material. It is the subject `model-loading` opens on, because
its silhouette still reads at the size the gallery draws a poster and its authored scale — 25.66
units tall — is the clearest possible demonstration that borrowed art does not arrive in metres.
Compressed from the Khronos sample's 9 564 264 bytes with `_tools/compress-model.ts` — 8.9% of the
original — by welding the geometry and re-encoding its four textures (base colour and emissive to
1024px JPEG at quality 84, the normal and packed occlusion/roughness maps to 512px PNG). Not Draco,
not meshopt, not WebP, and not quantised: see [Provenance](#provenance).

- **Licence:** [Creative Commons Zero v1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (`CC0-1.0`)
- **Copyright:** © 2017 Microsoft, model by sbtron; © 2018 Frank Galligan for the Draco variant,
  which is not the variant used here
- **Source:** <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern>
- **Licence confirmed:** 2026-09-08, from the model's own
  <https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Lantern/metadata.json>
  (both `legal` entries `"license": "CC0-1.0"`)
- **SHA-256:** `19129ef1dafdaf1f32fb7afb4f13d98799d3ff878987c6cedb2f26d583a3dbfd`
- **SHA-256 of the upstream `Lantern.glb`:** `a79458c4b02d695187a952f23a63b8bf278e7bc3d316a3c2a314f2d6974181f1`
- **Assembled extent:** 15.4912 × 25.6642 × 4.6314 glTF units, its box centred at
  (3.823, 13.016, 0). `model-loading/subjects.ts` holds those numbers and derives the scale and the
  offset that stand it on the floor.

## `models/water-bottle.glb` — 570 720 bytes

A brushed-metal sports bottle with a printed label and a plastic cap: one mesh, one material, and
the canonical metal-roughness test object. Compressed from the Khronos sample's 8 966 700 bytes
with `_tools/compress-model.ts` — 6.4% of the original — by welding the geometry and re-encoding
its four textures the same way as the lantern above.

- **Licence:** [Creative Commons Zero v1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (`CC0-1.0`)
- **Copyright:** © 2017 Microsoft
- **Source:** <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/WaterBottle>
- **Licence confirmed:** 2026-09-08, from the model's own
  <https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/WaterBottle/metadata.json>
  (`"license": "CC0-1.0"`)
- **SHA-256:** `737f59fb58410e9e4c9859127546747bd3367fca6d7cff2efc1a98120426c631`
- **SHA-256 of the upstream `WaterBottle.glb`:** `b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b`
- **Extent:** 0.1089 × 0.260441 × 0.1089 glTF units, its origin in the middle of the bottle

## `models/avocado.glb` — 364 960 bytes

Half an avocado with its stone: the smallest real PBR object in the Khronos set, and the one whose
authored scale is furthest from a metre. Compressed from the sample's 8 110 040 bytes with
`_tools/compress-model.ts` — 4.5% of the original — the same way as the two above.

- **Licence:** [Creative Commons Zero v1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (`CC0-1.0`)
- **Copyright:** © 2017 Microsoft
- **Source:** <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado>
- **Licence confirmed:** 2026-09-08, from the model's own
  <https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Avocado/metadata.json>
  (`"license": "CC0-1.0"`)
- **SHA-256:** `438b040780701a95d19a6d8de805933a4e3f11f3f9a5087e447778d609e97062`
- **SHA-256 of the upstream `Avocado.glb`:** `ccc9c3ce56423720b09399c2351537207cd5a65f859f9e6e2f30922762f3abd4`
- **Extent:** 0.042562 × 0.062896 × 0.027618 glTF units, standing on its own origin

## `models/fox.glb` — 162 852 bytes

A low-polygon fox on a 24-joint skeleton with three animation clips — `Survey` (3.42 s), `Walk`
(0.71 s) and `Run` (1.16 s) — one mesh and one 1024px PNG texture. **Two examples load this file:**
`skinned-animation`, which drives the clips directly through a two-state animator document, and
`animator`, which drives the same three clips from a state machine with a trigger and an event.

Committed **byte for byte as Khronos publishes it**: at 162 852 bytes it is already a fortieth of
the per-file cap, it declares no glTF extension at all, and `_tools/compress-model.ts` would run
`resample()` over its animation channels for no gain. The digest below is therefore also the
upstream digest, which is how the download was cross-checked.

Three parties hold rights in it and the model's own `metadata.json` lists all three; all three
lines are required wherever it is shown:

> Fox — model © 2014 PixelMannen (CC0 1.0); rigging and animation © 2014 tomkranis (CC-BY 4.0);
> conversion to glTF © 2017 @AsoboStudio and @scurest (CC-BY 4.0).

- **Licence:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) for the model;
  [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) for the rig and animation and
  for the glTF conversion
- **Copyright:** © 2014 PixelMannen · © 2014 tomkranis · © 2017 @AsoboStudio and @scurest
- **Source:** <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox>
- **Licence confirmed:** 2026-09-08, from the model's own
  <https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/metadata.json>
  (three `legal` entries: `CC0-1.0` for "Model", `CC-BY-4.0` for "Rigging & Animation" and
  `CC-BY-4.0` for "Conversion to glTF"), which the file's own `asset.copyright` string repeats
- **SHA-256:** `d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7`
  (identical upstream: the file is unmodified)
- **Bind-pose extent:** 25.185 × 79.029 × 154.72 glTF units, its box centred at
  (0, 39.39, −10.735); `skinned-animation/main.ts` draws it at 0.01, which makes it a 0.79 m animal

## `models/rig.glb` — 10 152 bytes

The repository's own skinned "box-man": four joints (`hips`, `torso`, `armL`, `armR`), 32 vertices
across four boxes, four clips (`idle`, `walk`, `run`, `jump`) and a geometry-free `hand` node for
`Model.attachToNode`. `third-person` uses it as the thing the camera follows; the example itself is
about `ThirdPersonController` and `ThirdPersonCamera`, not about the model, and a rig this small
keeps it that way.

It is **original work by Astrum Forge Studios**, not a third-party asset: the glTF container is
written from arithmetic by a generator committed beside it, with no exporter and no third-party
model, texture, rig or animation involved (`CONSTITUTION.md` §11.3). The copy here is byte for byte
the repository fixture, which the two 3D templates also ship.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Astrum Forge Studios Pty Ltd
- **Source:** this repository, `tests/fixtures/assets/3d/rig.glb` (generator:
  `tests/fixtures/assets/3d/make-rig.mjs`)
- **SHA-256:** `93c9a673579f4c1346a693e6f8a832da114cac22e9e36e51290cc1b483884f21` (identical to
  `tests/fixtures/assets/3d/rig.glb` and to `templates/3d-third-person/assets/player.glb`)
- **Bind-pose extent:** the 32 vertices span 1.0 × 1.1 × 0.3 metres, from `y = 0.35` to `y = 1.45`,
  with the origin on the ground below them; the rig is a torso, hips and two arms, and has no legs.
  48 triangles.

## `models/emissive-strength-test.glb` — 10 668 bytes

Five unit cubes in a row on a reference card, three units apart. Every cube's material declares the
same emissive colour, `[0.1, 0.5, 0.9]`; the leftmost carries no extension and the four to its right
carry `KHR_materials_emissive_strength` at 2x, 4x, 8x and 16x, so their emissive runs far past 1.0.
That is what `bloom` needs and what no hand-written ignifx material can express — the material
format's `emissive` is sRGB and `Color.srgbToLinear` clamps it — so the example draws a second,
generated row beside it to show the difference. `bloom` overrides the card's `FlatBackdrop` material
with a near-black of its own through `Model.materialOverrides`.

**Vendored unmodified**, byte for byte as Khronos publishes it, which is the one deviation from
`04-examples-platform.md` §5.1 rule 5 in this file besides `models/fox.glb`'s. Running it through
`_tools/compress-model.ts` _grew_ it to 11 488 bytes: the file's only image is a 741-byte grid
texture that the pipeline re-encodes to a 1024-pixel JPEG, and JPEG rings on grid lines. There is
nothing else for the pipeline to do — the model carries no meshopt compression, no quantisation and
90 triangles.

- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode) (`CC-BY-4.0`)
- **Copyright:** © 2022, AGI — Ed Mackey for Everything
- **Source:** <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/EmissiveStrengthTest>
- **Licence confirmed:** 2026-09-08, from the model's own
  <https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/EmissiveStrengthTest/metadata.json>
  (`"license": "CC-BY-4.0"`, `"owner": "AGI"`, `"artist": "Ed Mackey"`) and its generated
  `README.md`. `04-examples-platform.md` §5.3 lists this model as CC0; the model's own metadata
  says CC-BY-4.0, and the metadata is the record (§5.1 rule 2).
- **SHA-256:** `074898ec4c3636230faffe0cacac7403c3f6135db61f943da28ffaa88ca2a39f` (identical to the
  upstream `EmissiveStrengthTest.glb`)
- **Geometry extent:** 16.003727 × 10.010465 × 4.498933 glTF units, cubes of 1 unit at x = −6, −3,
  0, 3, 6. `bloom` draws it at a scale of 0.18.

## `environments/studio.env` — 205 260 bytes

A prefiltered softbox studio environment — a specular cube map plus spherical harmonics — in
Babylon's `.env` container. It is the image-based lighting the hero is lit by and the skybox behind
it. Byte-identical to the copy the repository already vendors at `tests/fixtures/assets/studio.env`,
which is how the download was cross-checked.

- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode) (`CC-BY-4.0`)
- **Copyright:** © Babylon.js contributors (the `BabylonJS/Assets` repository)
- **Source:** <https://github.com/BabylonJS/Assets/blob/master/environments/studio.env>
- **Licence confirmed:** 2026-09-07, from the repository's own
  <https://raw.githubusercontent.com/BabylonJS/Assets/master/README.md> ("This work is licensed
  under a Creative Commons Attribution 4.0 International License") and
  <https://github.com/BabylonJS/Assets/blob/master/LICENSE>. `environments/README.md` in that
  repository declares no override.
- **SHA-256:** `88639560e8e444eea5ebb15f0f97896f549f469f90afd6839f6ac9f67a40c9e1`

## `environments/studio.environment.json` — 129 bytes

The ignifx environment description that loads the `.env` above **with its skybox turned off**. The
probe's cube map is a mid-grey softbox room: correct as image-based lighting, wrong as a backdrop
behind a product shot, and `Environment.blur` cannot darken one without softening the other. So the
IBL is installed and the background is left to the example, which draws `textures/backdrop.png` on
an inverted sphere. The repository's own file.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Astrum Forge Studios
- **Source:** this repository, `website/examples/assets/environments/studio.environment.json`
- **SHA-256:** `70edde7460d2263b1b0b17652968f1b45a3a12702b1baf7d8d430d6bdcdede54`

## `environments/sanGiuseppeBridge.env` — 1 009 720 bytes

A prefiltered outdoor environment — a specular cube map plus spherical harmonics — in Babylon's
`.env` container: a canal at the San Giuseppe bridge under a low sun, which is the warm probe in
`ibl`'s Probe select.

- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode) (`CC-BY-4.0`)
- **Copyright:** © Babylon.js contributors (the `BabylonJS/Assets` repository)
- **Source:** <https://github.com/BabylonJS/Assets/blob/master/environments/sanGiuseppeBridge.env>
- **Licence confirmed:** 2026-09-08, from the repository's own
  <https://raw.githubusercontent.com/BabylonJS/Assets/master/README.md> ("This work is licensed
  under a Creative Commons Attribution 4.0 International License"). `environments/README.md` in that
  repository declares no override.
- **SHA-256:** `2f0415a106e19c3dbc70f5a5a037d2c0fa1f712a8f0140102adf7925ea49006f`

## `environments/sanGiuseppeBridge.environment.json` — 140 bytes

The description that loads the file above with **no skybox**, for the reason
`studio.environment.json` gives: Lite builds a background inside `loadEnvironment` as a renderable
it owns and offers no way to remove one, so an example that switches probes must load every one of
them without a background and draw its own.

- **Licence:** Apache-2.0 (this repository's own file)
- **SHA-256:** `edcee59a4bf72907798772480cc823366f1df18553d514d2ab389cb9512af6db`

## `environments/ulmerMuenster.env` — 945 132 bytes

A prefiltered outdoor environment in the same container: the overcast square in front of Ulm
Minster, pale stone under a cool sky, which is the cool probe in `ibl`'s Probe select.

- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode) (`CC-BY-4.0`)
- **Copyright:** © Babylon.js contributors (the `BabylonJS/Assets` repository)
- **Source:** <https://github.com/BabylonJS/Assets/blob/master/environments/ulmerMuenster.env>
- **Licence confirmed:** 2026-09-08, from the same README and with the same absence of a per-folder
  override.
- **SHA-256:** `fd05a0d0e8708225ac36129e28e50cdfeba9651a7e66aa94bec9e550d59fefcc`

## `environments/ulmerMuenster.environment.json` — 136 bytes

The description that loads the file above with no skybox.

- **Licence:** Apache-2.0 (this repository's own file)
- **SHA-256:** `59fb635f4df8e565cfcd731655c7dbcb31f45fcc19721c0a065273b893bc086b`

## `environments/brdf-lut.png` — 23 494 bytes, 256×256 RGBA8

The split-sum BRDF lookup table Babylon Lite's `loadEnvironment` takes as a **required**
parameter — it decodes the table from a pre-baked RGBD PNG rather than computing it, "matching
BJS's embedded `environmentBRDFTexture`, for pixel-perfect parity". `rendering.brdfLut` defaults to
this exact address (`environments/brdf-lut.png`, `DEFAULT_BRDF_LUT_ADDRESS`), so no example has to
name it. This file is the base64 payload of Babylon.js's `_environmentBRDFBase64Texture`, decoded
byte for byte, with nothing re-encoded; it is byte-identical to
`tests/fixtures/assets/brdf-lut.png`.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Babylon.js contributors
- **Source:** `packages/dev/core/src/Misc/brdfTextureTools.ts` in
  <https://github.com/BabylonJS/Babylon.js>
- **Licence confirmed:** 2026-09-07, from `LICENSE.md` in that repository (Apache-2.0)
- **SHA-256:** `f10818901fccd58cd708fef7979daa3a37294b0bca53f450dc37e1589419813d`

## `textures/backdrop.png` — 2 291 bytes, 512×512 RGB

One soft elliptical pool of light, painted into the texture and drawn `unlit` and `doubleSided` on
the inside of a 20-metre sphere that `pbr-model` turns so the pool sits behind the subject.
Everything outside the pool is near-black, which is how the hero's frame gets quiet edges: the
engine has no vignette pass, so the falloff is in the scene. Its bytes look far too dark on paper —
`#040507` at the edges and `#0D1017` at the centre — because the generator states the tones it
wants **on screen**, `#0D1015` and `#1F2530`, and solves for the bytes that produce them: an unlit
surface is sampled as linear data, multiplied by the exposure and lifted hard by the shadow end of
ACES, which was measured as `frame = 4.983 × byte ** 0.721` at this scene's exposure of 0.8 (a
staircase of known bytes rendered into the scene and read off the frame at 1280×720, 2026-09-07).
Generated by a committed script, the way the templates generate all of their art; no upstream.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Astrum Forge Studios
- **Source:** this repository, `website/examples/_tools/make-backdrop-texture.ts`
- **SHA-256:** `74bddd919cb3baa320180e751cf7f4a422d9f009f15cff4abb415cde721f0846`

## `textures/grid.png` — 189 bytes, 128×128 RGB

One tile of the grid the kit's ground plane is covered with: a white cell with a two-pixel darker
line on its low edges, repeated one tile per metre by `MeshAsset.ground`'s `uvScale`. It is a
texture rather than a shader because ignifx declares `"type": "shader"` in the material format and
rejects it at runtime with `IGX-0708`. Generated by a committed script, the way the templates
generate all of their art; no upstream.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Astrum Forge Studios
- **Source:** this repository, `website/examples/_tools/make-grid-texture.ts`
- **SHA-256:** `de07d7757776fa844875562a3d795371cef30e0f75e3822af54ed2057aad1098`

## `fonts/share-tech-mono.ttf` — 43 272 bytes

A single-weight monospaced TrueType face, version 1.003. `ui-overlay` shapes its `HudText` score
with it. Monospace is deliberate: `HudText` is GPU text positioned in backing-store pixels, and a
uniform advance keeps a counter's width from changing as its digits do. Byte for byte the copy the
repository already vendors at `tests/fixtures/assets/ui/ShareTechMono-Regular.ttf`, renamed to the
kebab-case this directory uses; that file's own
[`ATTRIBUTION.md`](../../../tests/fixtures/assets/ui/ATTRIBUTION.md) records the licence lines read
out of the font's `name` table.

- **Licence:** [SIL Open Font License 1.1](https://openfontlicense.org) (`OFL-1.1`) — the font's own
  `name` table, entry 13
- **Copyright:** Copyright (c) 2012, Carrois Type Design, Ralph du Carrois
  (post@carrois.com www.carrois.com), with Reserved Font Name 'Share'
- **Reserved Font Name:** `Share`. The OFL forbids distributing a _modified_ version under a name
  containing "Share"; this file is unmodified, and only its file name differs.
- **Source:** <https://github.com/google/fonts/tree/main/ofl/sharetechmono>
- **Licence confirmed:** 2026-09-06 for the fixture, from the downloaded file's own `name` table
  (entries 0, 13 and 14); re-checked 2026-09-08 against the same digest.
- **SHA-256:** `9ceab1f87414829af259c0f537573ae03ef7dd3147c0b27a36a1a0beb6732677`

## `audio/*.wav` — five clips, 90 234 bytes

Everything `audio-mixer` plays. They are the repository's **own synthesised audio**: sines, seeded
white noise and a one-pole low-pass computed by `tests/fixtures/assets/audio-templates/make-template-audio.mjs`
and written through that script's hand-written RIFF/WAVE encoder. Nothing here was downloaded, no
audio library is involved, and no third-party sound library is copied, derived from or redistributed
(`CONSTITUTION.md` §11.3). The five files are byte-identical copies of the set the `2d-topdown`
template ships, which is the A-minor set of the four — so the mixer's pads, its UI click and its
music pad are all in one key.

Mono 16-bit PCM WAV. `@ignifx/audio` decodes `.mp3`, `.ogg`, `.wav`, `.webm` and `.flac`
(`AUDIO_FILE_EXTENSIONS`); WAV is used because these files are already small enough that a lossy
re-encode would only cost quality, and because a WAV's duration is readable under Node, which
`.mp3`/`.ogg` are not.

| File                 | Bytes  | Rate      | Length | What it is                                             | SHA-256                                                            |
| -------------------- | ------ | --------- | ------ | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `audio/ambient.wav`  | 57 644 | 8 kHz     | 3.6 s  | A seamlessly looping A-minor-add9 chord pad            | `f6913efaf1dabfc31ed26ea64672102b71aef7ea1fd6ba36ba9ca3189c3a8861` |
| `audio/pickup.wav`   | 14 156 | 22.05 kHz | 320 ms | Three struck bells 60 ms apart: root, third, octave    | `fbf980c50786741bb3d79f3c5838a6124ca78a1560d7683bab58b0fa43f77dfc` |
| `audio/land.wav`     | 8 864  | 22.05 kHz | 200 ms | Noise twice low-passed over a sine three octaves down  | `2cabc1578b2137ec4826da883827c1ca74d6492c736bb84c43444afbb08190a4` |
| `audio/jump.wav`     | 7 100  | 22.05 kHz | 160 ms | A sine sweeping an octave up, plus its second harmonic | `bf3bfd575a436bcdd64e3a0addc91093638e5ef22e86aa0d11cce4c0493c4e8a` |
| `audio/ui-click.wav` | 2 470  | 22.05 kHz | 55 ms  | Bright noise with a very fast decay over a sine        | `905adb22c7cd57e39f13f3890e9cf6252a3eb094dc70edb1a0c12e8a7aa9293d` |

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Astrum Forge Studios
- **Source:** this repository, `templates/2d-topdown/assets/*.wav`, written by
  `tests/fixtures/assets/audio-templates/make-template-audio.mjs`
- **Licence confirmed:** 2026-09-08, from `tests/fixtures/assets/audio-templates/ATTRIBUTION.md`
  ("an original work created for this repository … covered by the repository's Apache-2.0 licence")

---

## The 2D examples' sheets and documents — `2d/*`

Four examples share one small set of files: `tilemap`, `sprite-animation`, `platformer-controller`
and `physics-2d`. Two of the sheets are Kenney's, cropped; three are the repository's own generated
template art, copied; and every `.atlas.json`, `.tilemap.json` and `.spriteanim.json` beside them is
**generated from those sheets and from the two hand-authored Tiled maps** by
`examples/tilemap/tools/build-2d-assets.ts` (see [Provenance](#provenance)).

### `2d/tiny-town.png` — 3 799 bytes, 203×135, and `2d/tiny-town.atlas.json`

Kenney's **Tiny Town** tile sheet, cropped to its first eight rows: grass, dirt, trees, roofs,
walls, doors and fences — the ninety-six tiles the village in `tilemap` is built from. The three
rows left behind are castle walls, arches and inventory props, and are not shipped. Nothing else in
the 130-file pack is here: not the per-tile PNGs, not the previews, not the samples.

The crop is rectangular and on the grid, which is what lets `gridAtlas` cut it: the atlas beside it
names the frames `town_0` to `town_95`, which is exactly the naming `@ignifx/2d`'s Tiled importer
gives a tileset called `town`.

- **Licence:** [Creative Commons Zero v1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (`CC0-1.0`)
- **Copyright:** Kenney (www.kenney.nl); crediting is requested, not required
- **Source:** <https://kenney.nl/assets/tiny-town> (download
  `https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip`,
  SHA-256 `9768692dccff1d706408a5aedd6ca4f6cd1409506cbc84cb2f862919764be977`, 182 243 bytes)
- **Licence confirmed:** 2026-09-08, from the pack's own `License.txt` — "Tiny Town (1.1) …
  License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ … This
  content is free to use in personal, educational and commercial projects. Support us by crediting
  Kenney or www.kenney.nl (this is not mandatory)" — and from the asset page, which reads
  "Creative Commons CC0"
- **SHA-256:** `e114e89f436e6618b4fb966877e10e75fb59a6642ba295f7a32433469c4d5d3f` (the crop);
  the sheet it was cut from, `Tilemap/tilemap.png`, is
  `b9e9fb80b95d0b90b52f12d914f000cf16f8b22c1faa815aa94500abfa57bc50`, 5 392 bytes
- **Geometry:** 16×16 tiles, 1 px transparent spacing, no margin, 12 columns × 8 rows

### `2d/props.png` — 3 492 bytes, 227×151, and `2d/props.atlas.json`

Kenney's **Pixel Platformer** tile sheet, cropped to the first twelve columns of its first eight
rows: the ground tiles, the crates and the coin `physics-2d` throws. The eight columns left behind
are water, foliage and a number font. Frames are `props_0` to `props_95`.

- **Licence:** [Creative Commons Zero v1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (`CC0-1.0`)
- **Copyright:** Kenney (www.kenney.nl); crediting is requested, not required
- **Source:** <https://kenney.nl/assets/pixel-platformer> (download
  `https://kenney.nl/media/pages/assets/pixel-platformer/33bb4921eb-1696667883/kenney_pixel-platformer.zip`,
  SHA-256 `d01a196dbe3cc964e00d83ba3b987df62f332dc9260c9f941b4fbcc9047130f4`, 260 312 bytes)
- **Licence confirmed:** 2026-09-08, from the pack's own `License.txt` — "Pixel Platformer (1.2) …
  License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ … You can
  use this content for personal, educational, and commercial purposes. Support by crediting
  'Kenney' or 'www.kenney.nl' (this is not a requirement)" — and from the asset page, which reads
  "Creative Commons CC0"
- **SHA-256:** `107ada2ea77ef377b20ae0f92c6f2a21f2a4a564607214f888c7dd64595a0d98` (the crop);
  the sheet it was cut from, `Tilemap/tilemap.png`, is
  `75c4eb86e8ceba008cd73bfd839609e91de1ab32686ccd34dff904cfd39883ed`, 6 180 bytes
- **Geometry:** 18×18 tiles, 1 px transparent spacing, no margin, 12 columns × 8 rows

### `2d/villager.png`, `2d/runner.png`, `2d/terrain.png` and their documents

The repository's **own generated 2D template art**, copied byte for byte out of
`templates/2d-topdown/assets/` and `templates/2d-sidescroller/assets/`, where
`tests/fixtures/assets/2d-templates/make-template-art.mjs` writes them. No image library, no
exporter and no third-party pack is involved: every pixel comes out of arithmetic in that generator
(`CONSTITUTION.md` §11.3).

- `villager.png` — 40 frames: an eight-frame walk and a two-frame idle in four facings. Its
  `.atlas.json` and `.spriteanim.json` are the template's own, copied with the `image` and `atlas`
  references renamed; the frame names and clips are unchanged, because they carry meaning a grid
  atlas would throw away.
- `runner.png` — 14 frames: a four-frame idle, an eight-frame run, and a jump and a fall pose.
  Same treatment.
- `terrain.png` — eight side-on tiles: ground, dirt, two 45-degree slopes, a one-way plank, brick
  and two cliff edges. Its atlas **is** generated with `gridAtlas`, as `terrain_0` to `terrain_7`,
  because the Tiled map in `platformer-controller` addresses it by index.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Astrum Forge Studios Pty Ltd
- **Source:** this repository, `tests/fixtures/assets/2d-templates/` (the generator) and
  `templates/2d-{topdown,sidescroller}/assets/` (its output)
- **SHA-256:** `villager.png` `46288180ea8b2e768587a0f1f5ac7f2be6b6efb444b64c4a1a856ef30a7b9652`
  (identical to `templates/2d-topdown/assets/hero.png`) · `runner.png`
  `9a984eb592a3ae2a96616dca0a8f3e532b52888af278eeb9232129fc2ba9b7ab` (identical to
  `templates/2d-sidescroller/assets/hero.png`) · `terrain.png`
  `74c8f0475a2172b09fe0aecec21830b7f7b29124a37150ad289bc09cbcecd78c` (identical to
  `templates/2d-sidescroller/assets/tiles.png`)

### `2d/village.tilemap.json` and `2d/course.tilemap.json`

Two **hand-authored Tiled maps**, converted. The `.tmj.json` sources are committed beside the
examples that load them — `examples/tilemap/village.tmj.json`, forty by twenty cells in three tile
layers and an objects layer, and `examples/platformer-controller/course.tmj.json`, fifty-six by
sixteen with two ramps, a pit, one-way planks and a one-metre ledge — and the generator runs each
through `@ignifx/2d`'s `importTiledMap` and run-length encodes the result. No map from a third
party is involved.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Astrum Forge Studios Pty Ltd
- **Source:** this repository, `website/examples/{tilemap,platformer-controller}/*.tmj.json`
- **SHA-256:** `village.tilemap.json`
  `75248a4ebdfe9a0ab7539498dabfb9e4041e39b182cede72819cda38d8ade023` · `course.tilemap.json`
  `76906e805c37e78094abcdc48f5793ec09ba7a9fbcca1883623a08e83bd402b8`

## Note on CC-BY-4.0

`docs/standards/coding-standards.md` §13 lists the licences ignifx accepts **for dependencies**
(Apache-2.0, MIT, BSD-2/3, ISC, 0BSD, Unlicense, Zlib). CC-BY-4.0 is not on that list, and
`studio.env` is CC-BY-4.0. It is a redistributed sample asset rather than a dependency, and
`CONSTITUTION.md` §11.3 asks only that such an asset be licensed for redistribution with its
attribution recorded — which this file does, and which the site republishes at
`/examples/attribution/`. The same reasoning, and the same two files, are already recorded in
`tests/fixtures/assets/ATTRIBUTION.md`. Nothing here reaches a `create-ignifx` template, so no
attribution requirement travels to a game made from one.

## Note on the SIL Open Font License

`fonts/share-tech-mono.ttf` is OFL-1.1, which is not on coding standards §13's dependency list
either, and the same reasoning applies: it is a redistributed sample asset, not a dependency. Two
of the licence's conditions travel with the file and would bind anyone who copied it further — the
font may not be sold on its own, and a _modified_ copy may not carry the reserved name "Share".
Nothing here reaches a `create-ignifx` template.

## Provenance

Run from the `website` package. Every command is reproducible and every output is committed, so a
site build never fetches from a third party (`04-examples-platform.md` §5.1 rule 4).

```sh
# models/ignifx-ship.glb — decode meshopt, weld, simplify to 3.5% of the triangles, dequantize,
# drop both extensions, re-encode the textures, write, digest.
pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
  --in brand/source/spaceship.glb --out assets/models/ignifx-ship.glb \
  --simplify 0.035 --simplify-error 0.002 --textures 1024 --linear-textures 512 --quality 84

# models/corset.glb — download, weld, re-encode textures, write, digest.
pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
  --url https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Corset/glTF-Binary/Corset.glb \
  --out assets/models/corset.glb --textures 1024 --linear-textures 512 --quality 84

# environments/studio.env
curl -L -o examples/assets/environments/studio.env \
  https://raw.githubusercontent.com/BabylonJS/Assets/master/environments/studio.env

# environments/brdf-lut.png — the same file the repository already vendors.
cp ../tests/fixtures/assets/brdf-lut.png examples/assets/environments/brdf-lut.png

# models/lantern.glb, models/water-bottle.glb, models/avocado.glb — download, weld, re-encode
# textures, write, digest. One command each; the tool prints the digest recorded above.
for m in Lantern:lantern WaterBottle:water-bottle Avocado:avocado; do
  pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
    --url https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/${m%%:*}/glTF-Binary/${m%%:*}.glb \
    --out assets/models/${m##*:}.glb --textures 1024 --linear-textures 512 --quality 84
done

# models/fox.glb — unmodified: 162 KB as published, no extensions, nothing for the pipeline to do.
curl -L -o examples/assets/models/fox.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb

# models/rig.glb — the repository's own generated rig, copied byte for byte. Rebuild the fixture
# itself from its generator: `node tests/fixtures/assets/3d/make-rig.mjs`.
cp ../tests/fixtures/assets/3d/rig.glb examples/assets/models/rig.glb

# models/emissive-strength-test.glb — unmodified: 10 KB as published, and the pipeline would only
# re-encode its one grid texture to JPEG and grow the file (see the entry above).
curl -L -o examples/assets/models/emissive-strength-test.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/EmissiveStrengthTest/glTF-Binary/EmissiveStrengthTest.glb

# fonts/share-tech-mono.ttf — the repository's own vendored face, copied byte for byte.
cp ../tests/fixtures/assets/ui/ShareTechMono-Regular.ttf examples/assets/fonts/share-tech-mono.ttf

# textures/grid.png and textures/backdrop.png
pnpm --filter @ignifx/website exec node examples/_tools/make-grid-texture.ts
pnpm --filter @ignifx/website exec node examples/_tools/make-backdrop-texture.ts

# audio/*.wav — the templates' own synthesised clips, copied byte for byte. Regenerate the source
# set with `pnpm assets:audio` from the repository root first if the generator has changed.
for f in ambient pickup jump land ui-click; do
  cp ../templates/2d-topdown/assets/$f.wav examples/assets/audio/$f.wav
done
# The 2D examples' art: fetch the two Kenney sheets, then generate every sheet and document.
# The zips are not committed; only the two crops the generator writes are.
mkdir -p /tmp/kenney && cd /tmp/kenney
curl -L -o tiny-town.zip \
  https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip
curl -L -o pixel-platformer.zip \
  https://kenney.nl/media/pages/assets/pixel-platformer/33bb4921eb-1696667883/kenney_pixel-platformer.zip
unzip -o tiny-town.zip -d tiny-town && unzip -o pixel-platformer.zip -d pixel-platformer
cd -
pnpm --filter @ignifx/website exec node examples/tilemap/tools/build-2d-assets.ts \
  --tiny-town /tmp/kenney/tiny-town/Tilemap/tilemap.png \
  --pixel-platformer /tmp/kenney/pixel-platformer/Tilemap/tilemap.png
```

### What the model pipeline deliberately does not do

Babylon Lite 1.27.0's glTF loader declares `KHR_texture_basisu`, `KHR_texture_transform`,
`EXT_meshopt_compression` and the `KHR_materials_*` set, and declares **no**
`KHR_draco_mesh_compression` and **no** `EXT_texture_webp` (checked against
`packages/core/node_modules/@babylonjs/lite/index.d.ts`). So:

- **No Draco.** The loader cannot read it.
- **No WebP textures.** The loader cannot read them.
- **No meshopt.** It is declared, but its runtime decoder is normally fetched from a CDN and
  `CONSTITUTION.md` §9.1 forbids a third-party request at runtime.
- **No `KHR_mesh_quantization`.** Nothing in this repository exercises it, and shipping an asset
  whose accessors are a different component type on the strength of a declaration is not a thing to
  discover on a visitor's machine.
- **No KTX2.** `KHR_texture_basisu` _is_ declared, so this is worth revisiting when a `toktx`
  binary is on the machine that runs the pipeline. Resized PNG and JPEG got the hero to 12% of its
  original size, which was enough.

`_tools/compress-model.ts` prints the before and after sizes, the texture count and format, the
SHA-256, and the geometry extent on every run. The extent is what the example's `MODEL_SCALE`
constant is derived from, so it is worth reading.

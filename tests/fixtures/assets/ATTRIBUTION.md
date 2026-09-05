# Sample asset attribution

Every file in this directory is redistributed under the licence recorded below, with the copyright
line its upstream project requires (`CONSTITUTION.md` §11.3). Tests, examples, and benchmarks share
these files; nothing here is published in an `@ignifx/*` package.

Downloaded 2026-09-05 for Phase 2 (spikes S2.2–S2.4). Re-download with the commands in
[Provenance](#provenance) and compare the SHA-256 digests before replacing a file.

---

## `Box.glb` — 1 664 bytes

The Khronos glTF sample cube: one mesh, one metallic-roughness material. Used as the smallest real
`.glb` the loader and the model-instancing tests can work on.

- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode)
- **Copyright:** © 2017, Cesium — "Cesium for Everything"
- **Source:** <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box>
- **SHA-256:** `ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e`

## `studio.env` — 205 260 bytes

A prefiltered studio environment (specular cube map plus spherical harmonics) in Babylon's `.env`
container. Used to prove that image based lighting works end to end: a metal box is invisible
without it.

- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode)
- **Copyright:** © Babylon.js contributors (the `BabylonJS/Assets` repository)
- **Source:** <https://assets.babylonjs.com/environments/studio.env>, mirrored from
  <https://github.com/BabylonJS/Assets>
- **SHA-256:** `88639560e8e444eea5ebb15f0f97896f549f469f90afd6839f6ac9f67a40c9e1`

## `brdf-lut.png` — 23 494 bytes, 256×256 RGBA8

The split-sum BRDF lookup table `loadEnvironment` requires as its `brdfUrl`. Babylon Lite decodes it
from a pre-baked RGBD PNG rather than computing it, "matching BJS's embedded
`environmentBRDFTexture`, for pixel-perfect parity" (`@babylonjs/lite@1.27.0`, `loadEnvironment`
doc comment). This file is that texture: the base64 payload of `_environmentBRDFBase64Texture`,
base64-decoded byte for byte, with nothing re-encoded.

- **Licence:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- **Copyright:** © Babylon.js contributors
- **Source:** `packages/dev/core/src/Misc/brdfTextureTools.ts` in
  <https://github.com/BabylonJS/Babylon.js>
- **SHA-256:** `f10818901fccd58cd708fef7979daa3a37294b0bca53f450dc37e1589419813d`

---

## Note on CC-BY-4.0

`docs/standards/coding-standards.md` §13 lists the licences ignifx accepts **for dependencies**
(Apache-2.0, MIT, BSD-2/3, ISC, 0BSD, Unlicense, Zlib). CC-BY-4.0 is not on that list, and both
`Box.glb` and `studio.env` are CC-BY-4.0. They are test fixtures rather than dependencies, and
`CONSTITUTION.md` §11.3 asks only that a sample asset be licensed for redistribution with its
attribution recorded — which this file does. Reusing either of them inside a **template** shipped by
`create-ignifx` is a separate decision that needs the owner's sign-off, because the attribution
requirement would then travel to every game made from that template.

## Provenance

```sh
curl -L -o Box.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Box/glTF-Binary/Box.glb
curl -L -o studio.env https://assets.babylonjs.com/environments/studio.env
# brdf-lut.png is the base64 payload of `_environmentBRDFBase64Texture`, decoded:
curl -L https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/core/src/Misc/brdfTextureTools.ts \
  | sed -n 's/.*"data:image\/png;base64,\([A-Za-z0-9+/=]*\)".*/\1/p' \
  | base64 -d > brdf-lut.png
```

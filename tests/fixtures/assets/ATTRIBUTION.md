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

## `ui/ShareTechMono-Regular.ttf` — 43 272 bytes

Added 2026-09-06 for Phase 8. A single-weight monospaced TrueType face, used by the `@ignifx/ui`
text tests. It lives in the `ui/` subdirectory and its full entry — licence text, reserved font
name, provenance command — is in [`ui/ATTRIBUTION.md`](ui/ATTRIBUTION.md), alongside the sibling
`2d/` and `2d-templates/` files.

- **Licence:** [SIL Open Font License 1.1](https://openfontlicense.org)
- **Copyright:** Copyright (c) 2012, Carrois Type Design, Ralph du Carrois
  (post@carrois.com www.carrois.com), with Reserved Font Name 'Share'
- **Source:** <https://github.com/google/fonts/tree/main/ofl/sharetechmono>
- **SHA-256:** `9ceab1f87414829af259c0f537573ae03ef7dd3147c0b27a36a1a0beb6732677`

## `ktx2/` — `quadrants.png` (108 bytes) and two ETC1S `.ktx2` files (710 and 709 bytes)

Added 2026-10-19 for engine ask E13 (KTX2 in games). One 32×32 image with four solid quadrants —
red top-left, green top-right, blue bottom-left, white bottom-right, top row first — as a PNG and
as two ETC1S (BasisLZ) KTX2 files with sRGB transfer and a full six-level mip chain:
`quadrants-etc1s.ktx2` is encoded from the image flipped vertically (bottom row first), which is
how a `.ktx2` must be stored to draw like the PNG under the default `invertY: true`, and
`quadrants-etc1s-top-first.ktx2` from the image as is. `packages/core/test/assets/ktx2.browser.test.ts`
draws all three.

All three are original files made for this repository, not downloads. The PNG is written by hand
(one `IHDR`, one zlib `IDAT`); the KTX2 files are the ignifx editor importer's own output:
`encodeKtx2(source, { mode: "etc1s", mipmaps: true, srgb: true })` from
`ignifx-editor/packages/importers/src/ktx2/encoder.ts` at `a50fb80`, which wraps `ktx2-encoder`
0.6.0 (Basis Universal v2.5). Re-encoding with another encoder version may change the bytes.

- **Licence:** Apache License 2.0, as the rest of this repository
- **Copyright:** © 2026 Astrum Forge Studios
- **SHA-256:** `cd1b81c1311a4309d0f677c9c0f326b220278ebd6df8a8fdc085507414f67652`
  (`quadrants-etc1s.ktx2`), `7f1affb0b02527774a13b9044d0bb46e5a5cbcfed3fdfeb788d08ffa0561d8e1`
  (`quadrants-etc1s-top-first.ktx2`),
  `44287e3f4bee1a3a0a5a4b497646b39fbcb9aeb2fbae02210c83556de9f3a312` (`quadrants.png`)

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

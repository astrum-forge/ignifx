# Example assets

Everything the examples on ignifx.com load, vendored. Licences, copyright lines and SHA-256 digests
are in [`ATTRIBUTION.md`](ATTRIBUTION.md), which the site renders as `/examples/attribution/`; this
file is the operating manual.

```
assets/
  models/ignifx-ship.glb                 the mascot ship: the hero, and a brand asset (not CC0)
  models/corset.glb                      the second subject of the Model select
  models/lantern.glb                     the subject `model-loading` opens on
  models/water-bottle.glb                the second subject of the Model select in `model-loading`
  models/avocado.glb                     the third, and the smallest
  models/fox.glb                         the rigged fox with three clips, unmodified from Khronos
  models/rig.glb                         the repository's own four-joint rig, for `third-person`
  environments/studio.env                the image-based lighting
  environments/studio.environment.json   loads it with its skybox off; the example draws its own
  environments/sanGiuseppeBridge.env     the warm outdoor probe in `ibl`'s Probe select
  environments/ulmerMuenster.env         the cool outdoor probe in `ibl`'s Probe select
  environments/*.environment.json        one per `.env`, each with `skyboxEnabled: false`
  environments/brdf-lut.png              the BRDF table every .env load requires
  textures/backdrop.png                  the pool of light the kit's studio backdrop is painted with
  textures/grid.png                      one tile of the kit's ground grid
  2d/tiny-town.png                       Kenney's Tiny Town tiles, cropped to the eight rows used
  2d/props.png                           Kenney's Pixel Platformer tiles, cropped to twelve columns
  2d/villager.png · runner.png           the repository's own generated characters
  2d/terrain.png                         the repository's own generated side-on tiles
  2d/*.atlas.json · *.spriteanim.json    cut from those sheets; see `build-2d-assets.ts`
  2d/village.tilemap.json                the Tiled map in `examples/tilemap/village.tmj.json`
  2d/course.tilemap.json                 the Tiled map in `examples/platformer-controller/`
  audio/*.wav                            the five clips `audio-mixer` plays, on three buses
```

## Rules

1. **CC0 or CC-BY only** for third-party assets, and the licence is confirmed from the asset's own
   `metadata.json`, `README.md` or repository `LICENSE` **at download time**, with the date and the
   URL written into `ATTRIBUTION.md` (`website/plan/04-examples-platform.md` §5.1).
2. **4 MB per file, 48 MB in total** at launch. Cloudflare Pages refuses a file over 25 MiB.
   `_tools/compress-model.ts` exits non-zero when it writes a file over the per-file cap.
3. **Committed, not fetched.** A site build never depends on a third party being up. Every command
   below is reproducible; none of them runs during a build.
4. **Every file appears in `ATTRIBUTION.md`** with a matching digest. `website/test/site.test.ts`
   asserts it.
5. **Addresses, not paths.** An example names `models/corset.glb`; the manifest
   `@ignifx/vite-plugin` writes maps it to the hashed URL under `/examples/assets/`, which is why
   the build works under a sub-path with nothing in the example to say so.

## Reproducing every file

Run from the `website` package. `ATTRIBUTION.md`'s Provenance section is the same list with the
digests to compare against.

```sh
# The hero: the owner's ship, derived from `brand/source/spaceship.glb`, which is never modified.
# 1.94M triangles in, 68k out; meshopt and quantisation decoded at build time and dropped.
pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
  --in brand/source/spaceship.glb --out assets/models/ignifx-ship.glb \
  --simplify 0.035 --simplify-error 0.002 --textures 1024 --linear-textures 512 --quality 84

# The second subject: download, weld, resize and re-encode its textures, write, digest.
pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
  --url https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Corset/glTF-Binary/Corset.glb \
  --out assets/models/corset.glb --textures 1024 --linear-textures 512 --quality 84

# The three subjects of `model-loading`: download, weld, resize and re-encode textures, digest.
for m in Lantern:lantern WaterBottle:water-bottle Avocado:avocado; do
  pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
    --url https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/${m%%:*}/glTF-Binary/${m%%:*}.glb \
    --out assets/models/${m##*:}.glb --textures 1024 --linear-textures 512 --quality 84
done

# The rigged fox, unmodified: 162 KB as Khronos publishes it, no extensions, nothing to compress.
curl -L -o examples/assets/models/fox.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb

# The repository's own rig, copied byte for byte from the fixture the two 3D templates also ship.
# Rebuild the fixture itself with `node tests/fixtures/assets/3d/make-rig.mjs` from the repo root.
cp ../tests/fixtures/assets/3d/rig.glb examples/assets/models/rig.glb

# The five emissive cubes `bloom` shows, unmodified: 10 KB as Khronos publishes it, 90 triangles,
# no meshopt and no quantisation. `compress-model.ts` would re-encode its one 741-byte grid texture
# to a 1024px JPEG and grow the file to 11 488 bytes, so it is not used here.
curl -L -o examples/assets/models/emissive-strength-test.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/EmissiveStrengthTest/glTF-Binary/EmissiveStrengthTest.glb

# The face `ui-overlay`'s `HudText` shapes with, copied byte for byte from the fixture the
# `@ignifx/ui` text tests already use; only the file name is kebab-cased.
cp ../tests/fixtures/assets/ui/ShareTechMono-Regular.ttf examples/assets/fonts/share-tech-mono.ttf

# The environment. `studio.environment.json` is hand-written and committed; it loads the `.env` with
# its skybox off, because the probe's own cube map is a mid-grey room and the hero wants a dark one.
curl -L -o examples/assets/environments/studio.env \
  https://raw.githubusercontent.com/BabylonJS/Assets/master/environments/studio.env

# The two probes `ibl` switches to. Same repository, same CC-BY-4.0 licence, same hand-written
# sidecars: every one of them loads with `skyboxEnabled: false`, because Lite builds a background
# inside `loadEnvironment` and offers no way to remove one, so an example that switches probes has
# to load them all without a background and draw its own floor.
curl -L -o examples/assets/environments/sanGiuseppeBridge.env \
  https://raw.githubusercontent.com/BabylonJS/Assets/master/environments/sanGiuseppeBridge.env
curl -L -o examples/assets/environments/ulmerMuenster.env \
  https://raw.githubusercontent.com/BabylonJS/Assets/master/environments/ulmerMuenster.env

# The BRDF lookup table: the copy the repository already vendors for its own fixtures.
cp ../tests/fixtures/assets/brdf-lut.png examples/assets/environments/brdf-lut.png

# The ground grid and the studio backdrop.
pnpm --filter @ignifx/website exec node examples/_tools/make-grid-texture.ts
pnpm --filter @ignifx/website exec node examples/_tools/make-backdrop-texture.ts

# The five clips the mixer plays: the repository's own synthesised audio, copied byte for byte from
# the 2d-topdown template. `pnpm assets:audio` (repository root) rewrites the source set.
for f in ambient pickup jump land ui-click; do
  cp ../templates/2d-topdown/assets/$f.wav examples/assets/audio/$f.wav
done
```

## `compress-model.ts`

| Flag                | Default | What it does                                                     |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `--url` / `--in`    | —       | The source: an `https:` URL, or a path on disk. One is required. |
| `--out`             | —       | Where to write, relative to `website/examples`. Required.        |
| `--textures`        | `1024`  | Edge length of the base-colour and emissive maps, in pixels      |
| `--linear-textures` | `512`   | Edge length of the normal and packed occlusion/roughness maps    |
| `--quality`         | `84`    | JPEG quality for the colour maps, 1 to 100                       |

The transforms are `dedup`, `prune`, `weld`, `resample`, then two `textureCompress` passes: the
linear maps stay lossless PNG (JPEG's chroma subsampling shows as blotches in a normal map's blue
channel and as banding in roughness), and the colour maps go to JPEG — but only when every material
in the file is `OPAQUE`, because JPEG has no alpha channel and a masked material would lose its
cut-out. It prints the before and after sizes, the texture inventory, the SHA-256, and the geometry
extent.

**Why the linear maps are half the size of the colour maps.** A noisy normal map is the one image
PNG cannot compress: at 1024px the Corset's normal map alone is 1448 KiB, more than the whole rest
of the file, and the packed occlusion/roughness map is another 1262 KiB. At 512px they are 1.53 MiB
together with everything else, and the difference is not visible on an object that fills half a
1280×720 frame. The measured sizes:

| Setting                         | `corset.glb`    |
| ------------------------------- | --------------- |
| Upstream                        | 13 491 364 B    |
| 1024px colour, 1024px linear    | 3 593 056 B     |
| **1024px colour, 512px linear** | **1 599 040 B** |

`BoomBox` was measured the same way as the fallback hero and came out at 660 140 bytes — smaller,
but it is a 2 cm plastic radio rather than cloth, metal and leather, so the Corset won on what it
shows rather than on size. Both fit the cap.

**meshopt and quantisation are read, never written.** A source may arrive
`EXT_meshopt_compression`-compressed and `KHR_mesh_quantization`-quantised — the owner's ship does —
so the reader registers `MeshoptDecoder` and decodes at build time. Every output is `dequantize()`d
and both extensions are dropped, because the meshopt runtime decoder would be a CDN fetch
(`CONSTITUTION.md` §9.1) and nothing here has verified Lite against a quantised file. The
simplifier is `MeshoptSimplifier` through `@gltf-transform/functions`' `simplify()`, and it stops at
whichever of `--simplify` and `--simplify-error` it reaches first — so read the ratio the run
_prints_, not the one you asked for.

**What the pipeline will not do, and why**, is in
[`ATTRIBUTION.md`](ATTRIBUTION.md#what-the-model-pipeline-deliberately-does-not-do): no Draco, no
WebP textures, no meshopt, no quantisation, and KTX2 only once a `toktx` binary is on the machine.

## `make-backdrop-texture.ts`

Writes `textures/backdrop.png`: 512×512, one soft elliptical pool of light drawn `unlit` and
`doubleSided` on the inside of a 20-metre sphere by the kit's `createBackdrop`. Four things about it
are worth knowing.

It states the tones it wants **on screen** — `#0D1015` at the frame's edges and `#1F2530` behind the
subject, which are the site's own `--bg` and a shade past `--sunk` — and solves for the bytes that
produce them, because an unlit surface is sampled as linear data, multiplied by the exposure and
lifted hard by the shadow end of ACES. The transfer was measured rather than derived: a staircase of
known bytes rendered into this scene at `SHOT.exposure` and read off a 1280×720 frame gives
`frame = 4.983 × byte ** 0.721`, neutral in every channel, to within half a level from byte 3 to 36
(2026-09-07). Change `SHOT.exposure` and that constant has to be measured again.

The sphere is small on purpose: a camera two metres from the origin inside a 200-metre sphere sees a
few degrees of the texture and therefore a flat wall.

The pool has to be **wider than the subject and narrower than three frames**, which is a narrower
window than it sounds. At a half-width of 0.42 of the texture (150° of azimuth) every edge of the
frame measured `#515B75` and the vignette did not exist; at 0.06 and then 0.072 the pool's bright
centre was hidden behind the hull and the whole visible backdrop was flat at the edge tone, two
levels of lift across the frame. It is 0.085 by 0.13 (31° by 23°), which puts the halo around the
hull at about two thirds of the pool's lift and the corners at 0.02.

And the pool's centre is at `v = 0.563`, not the equator, because the hero's camera sits below its
subject and looks upward: calibrated by rendering marker bands into the texture and reading the rows
they landed on, v runs _upward_ at 4,588 rows per unit at this lens, so the equator would sit near
the bottom edge of the frame. `pbr-model`'s `SHOT.pitch` and the subject's `height` are therefore
inputs to this file, and `backdropYaw` turns the sphere until the pool is centred behind the subject.

## `make-grid-texture.ts`

Writes `textures/grid.png`: 128×128, a white cell with a two-pixel line at value 199 on its low
edges, so two neighbouring tiles share one line. `MeshAsset.ground`'s `uvScale` repeats it once per
metre, which is why the lines are exactly a metre apart at any ground size and why the file is
189 bytes rather than a baked 2048px grid.

## `2d/` — the four 2D examples' art

`tilemap`, `sprite-animation`, `platformer-controller` and `physics-2d` share one pipeline, and it
is one script: `examples/tilemap/tools/build-2d-assets.ts`. It lives in an example directory rather
than in `_tools/` because `_tools/` belongs to the examples pipeline rather than to an example
author (`08-execution.md` §5), and a new directory directly under `website/examples/` is refused by
`website/test/site.test.ts`.

It does three things and nothing else:

1. **Crops** each Kenney sheet to the rectangular sub-grid the examples draw from, so only the
   tiles in use are vendored. A rectangular crop keeps the grid intact, which is what lets
   `gridAtlas` address it. No pixel is resampled, recoloured or repacked.
2. **Cuts** every grid sheet into an `ignifx.spriteatlas` document with `gridAtlas`, naming the
   frames `<prefix>_<index>` — the naming `@ignifx/2d`'s Tiled importer gives a tileset of that
   name, which is what lets `TilemapRenderer` resolve a tile's sprite with no side table. The two
   character atlases are **copied** instead, because their frame names (`idle_0`, `run_3`, `jump`)
   carry meaning a grid atlas would throw away.
3. **Converts** each hand-authored Tiled `.tmj.json` with `importTiledMap` and run-length encodes
   its layers. The importer is a pure function over parsed JSON with no file system, no network and
   no asset system, so it belongs in a build step rather than in a game's first frame; the runtime
   loads the `ignifx.tilemap` document it produced.

The two Kenney zips are **not** committed — only the two crops are. The download and the generator
command are in [`ATTRIBUTION.md`](ATTRIBUTION.md#provenance); the digests to compare against are
beside each file's entry there.

The maps themselves are hand-written and committed next to the example that loads them, and both
are listed in that example's `sourceFiles`, so a visitor reads the same Tiled document the build
consumed.

## Adding an asset

1. Confirm the licence at the source, and note the URL and the date.
2. Compress it, under the caps.
3. Add its section to `ATTRIBUTION.md`: what it is, licence with a link, copyright line, source URL,
   how the licence was confirmed, and the SHA-256. Update the table at the top.
4. Add it to the `assets` array of every catalogue entry that loads it, so the example page's
   footer names it.
5. Recapture the affected posters (`_tools/capture-posters.ts <slug>`) and regenerate the affected
   goldens.

# 2D template art — attribution

Every image, sound, atlas and level document the two 2D templates ship is an **original work
created for this repository** by Astrum Forge Studios and is covered by the repository's Apache-2.0
licence. Nothing here is copied from, derived from, or redistributed out of a third-party asset
pack, and no file was downloaded (`CONSTITUTION.md` §11.3).

This directory holds the **generators**, not the output: the files they write land in
`templates/2d-topdown/` and `templates/2d-sidescroller/`, because a template has to be
self-contained — `create-ignifx` copies the directory verbatim into a player's project and cannot
reference a path in this repository.

```sh
node tests/fixtures/assets/2d-templates/make-template-art.mjs      # sheets, atlases, sounds
node tests/fixtures/assets/2d-templates/make-template-levels.mjs   # the two .tilemap.json levels
```

Both are deterministic — every random value comes from the seeded generator in `png.mjs` — so a
regenerated file is byte for byte the file that is committed.

| File                       | What it does                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `png.mjs`                  | A `Canvas`, a colour-type-6 PNG encoder (`node:zlib` and a hand-written chunk writer), a RIFF/WAVE encoder, and a seeded LCG.                                                                             |
| `make-template-art.mjs`    | Draws every tile, character frame, coin frame and parallax band; packs each sheet with one pixel of padding and an extruded border; writes the `.atlas.json` alongside; synthesises the two chime sounds. |
| `make-template-levels.mjs` | Turns a rectangle list (top-down) and a column profile (side-scroller) into `ignifx.tilemap` documents with run-length-encoded layers, tile colliders and an objects layer.                               |

No image library, no audio library and no editor file is involved. The two 45-degree slope
colliders and the one-way plank collider are written directly in the format's authoring space
(cell-normalised, top-left origin), and the Tiled and LDtk importers in `@ignifx/2d` are not used.

## Why the sheets live in `public/`

A `.atlas.json` names its image **relative to the document**, and `@ignifx/vite-plugin`
content-hashes everything under a project's asset root on a production build — so a hashed
`assets/tiles.<hash>.atlas.json` would look for `assets/tiles.png`, a name that no longer exists,
and the load would fail with `IGX-0505`. Vite's `public/` directory is copied verbatim and
unhashed, so the documents name `/tiles.png` and resolve in `pnpm dev` and `pnpm build` alike.

## Sizes

Every generated file is well inside the 20 KB per-file budget the Phase 6 brief sets. The largest is
a 0.35-second 22.05 kHz mono chime at 15,478 bytes; the largest image is the side-scroller's
three-band parallax sheet at 5,607 bytes.

| File                                        | Bytes | What it holds                                                                |
| ------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `2d-topdown/public/tiles.png`               | 1,275 | 16 frames of 16x16: eight terrain tiles and eight props                      |
| `2d-topdown/public/hero.png`                | 842   | 32 frames: an eight-frame walk cycle in four facings                         |
| `2d-topdown/assets/level.tilemap.json`      | 6,618 | A 40x24 walled garden, two layers, nine objects                              |
| `2d-sidescroller/public/tiles.png`          | 683   | Eight frames: ground, dirt, two slopes, a plank, brick, two edges            |
| `2d-sidescroller/public/hero.png`           | 690   | 14 frames: idle, jump, fall and an eight-frame run                           |
| `2d-sidescroller/public/coin.png`           | 305   | Six spin frames                                                              |
| `2d-sidescroller/public/parallax.png`       | 5,607 | A 640x384 sky, a 320x112 hill band, a 320x176 treeline                       |
| `2d-sidescroller/assets/level.tilemap.json` | 5,935 | A 64x20 course: two slopes each way, two pits, five one-way planks, 18 coins |

# Brand source files

`ignifx-mark.png` is the source of truth for the ignifx mark: a 1024×1024 RGBA PNG of the
professionally designed crystal flame, extracted byte for byte from the designer's delivery
`source/pro_icon.svg` (an SVG wrapper around that one PNG; SHA-256 of the wrapper
`da3647e7683072942ace83241b3daf35dd8168344b795a6fe3f966ce37099cb0`, received 2026-09-07).

Nothing here is edited by hand and nothing here is served directly. `pnpm --filter @ignifx/website
press-kit` (`../press/build.ts`) derives every brand file from the master — the press kit under
`../public/press/`, the favicons under `../public/`, and the header marks under `../public/brand/` —
so a new master means rerunning that one command. The construction rules are in
`../plan/02-design-system.md` §2.1–§2.2 and the measured numbers in `../press/README.md`.

The artwork is raster, so single-colour uses go through a traced silhouette, never a recolour of the
master; see `../plan/08-execution.md` §9.

## The mascot

`source/spaceship.glb` is the ignifx mascot: a spaceship with physically based materials, supplied by
the owner on 2026-09-07 as `unique_glb.glb` (14,493,100 bytes, SHA-256
`4d164cf09303b60b5ba1d3c06319da7d86e4c5b7ffe26ba50fdb4bcc5d80794e`). It is one mesh of 1.94 million
triangles with 4096² colour, occlusion-roughness-metalness and normal textures, meshopt-compressed
and quantised. It is never served as is: `../examples/_tools/compress-model.ts` decodes, simplifies
and re-encodes it into `../examples/assets/models/ignifx-ship.glb` for the hero example and the
social image, and the exact invocation is recorded in `../examples/assets/README.md`.

It is a brand asset of Astrum Forge Studios Pty Ltd, used under the trademark rules on `/press/`,
not a sample asset for reuse.

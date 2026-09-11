# Site identity

`ignifx-mark.svg` is the current vector master, introduced on 2026-09-11. It simplifies the
previous faceted crystal into a single burnt-orange (`#D85A16`) flame with an open centre.
The wordmark uses lowercase Archivo SemiBold with −0.02 em tracking.

Run `pnpm --filter @ignifx/website brand` to regenerate the site marks, outlined logo SVGs,
favicons and social card under `public/`, plus `preview.png` here. All exports derive from
the vector master; edit the master or generator, never the generated files. The generator
reuses the existing font-outline and ICO helpers without invoking the old press build.

The original `ignifx-mark.png` and `source/pro_icon.svg` remain unchanged for reference.
The former public press kit is archived in `../press/legacy-assets/` and is not served.
The historical design plan and press generator describe the previous identity.

## The mascot

`source/spaceship.glb` is the ignifx mascot: a spaceship with physically based materials, supplied by
the owner on 2026-09-07 as `unique_glb.glb` (14,493,100 bytes, SHA-256
`4d164cf09303b60b5ba1d3c06319da7d86e4c5b7ffe26ba50fdb4bcc5d80794e`). It is one mesh of 1.94 million
triangles with 4096² colour, occlusion-roughness-metalness and normal textures, meshopt-compressed
and quantised. It is never served as is: `../examples/_tools/compress-model.ts` decodes, simplifies
and re-encodes it into `../examples/assets/models/ignifx-ship.glb` for the hero example, and the exact invocation is recorded in `../examples/assets/README.md`.

It is a brand asset of Astrum Forge Studios Pty Ltd, not a sample asset for reuse.

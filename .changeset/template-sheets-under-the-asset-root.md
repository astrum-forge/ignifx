---
"@ignifx/cli": patch
---

A scaffolded 2D project keeps its sprite sheets beside its atlas documents, so it deploys under a sub-path

`create-ignifx --template 2d-topdown` and `--template 2d-sidescroller` used to copy a project whose
sheet images sat in `public/` and whose `.atlas.json` documents named them root-relatively
(`"image": "/tiles.png"`). That was a workaround for a Phase 6 loader that resolved a relative
`image` against the document's own URL, which a content-hashed build breaks. It only ever resolved
at a site's root: the same project built for a sub-path — a project page, for one — asked the
origin's root for a sheet that was not there and got a 404.

`@ignifx/2d` resolves a relative `image` as an address through the asset manifest
(`resolveAtlasImageUrl`), so both templates now write their sheets into `assets/` next to the
documents that name them and reference them as `"image": "tiles.png"`. The images are byte for byte
what they were; only their location and the eight `image` fields changed, and neither template has a
`public/` directory any more. No CLI code changed.

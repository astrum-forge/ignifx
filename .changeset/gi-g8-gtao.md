---
"@ignifx/core": minor
---

New `rendering.ambientOcclusion` setting (off by default): screen-space ambient occlusion (GTAO) computed from a shared depth and normal pass, at half or full resolution, with `radius`, `intensity` and `falloff`. It darkens the environment light of lit PBR materials in corners and creases, leaves direct lights unchanged, and works with or without `rendering.hdr`. A project that leaves it off loads none of it.

---
"@ignifx/core": minor
"ignifx": minor
"@ignifx/vite-plugin": patch
---

`bakeLightProbes` now traces primitive meshes and, under a headless app, glTF `Model`s, and lists everything it leaves out with the reason in `result.skips`.

`Light.bakeMode` (`"realtime"`, `"mixed"`, `"baked"`) decides whether the probes also store a light's direct light; a `"baked"` light no longer draws at run time.

A hemispheric light that still draws is no longer stored in the probes as well, so it no longer lights a volume about twice; probes baked before come out darker for it unless the light is set to `"baked"`.

`bakeLightProbes({ sky })` also takes a sky/horizon/ground gradient or nine spherical-harmonic coefficients.

The Vite plugin types `.probes.json` assets as `lightprobes` and `.lightmap.json` as `lightmap` in the manifest.

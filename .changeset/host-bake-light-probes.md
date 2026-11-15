---
"@ignifx/core": minor
"@ignifx/editor-host": minor
---

`bakeLightProbes` traces `Model`s in an app with a device too, reading the triangles of their drawn meshes instead of skipping them.
The scene host answers `bakeLightProbes` (capability `bakeLightProbes`): it bakes a `LightProbeVolume` over its live edit-mode world, with the environment's harmonics as the default sky, reports `bakeProgress`, stops on `cancelBake` or a document change, and answers the `.probes.json` document for the editor to write.

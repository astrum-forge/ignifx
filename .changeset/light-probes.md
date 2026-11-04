---
"@ignifx/core": minor
---

Add light probes (beta): a `LightProbeVolume` component lights PBR materials from a baked `.probes.json` grid (`LightProbeAsset`) instead of the environment's diffuse light, and `createLightProbeAsset` publishes a grid built in code. It needs a loaded `Environment`.

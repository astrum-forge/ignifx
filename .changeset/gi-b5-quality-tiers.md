---
"@ignifx/core": minor
---

`rendering.quality` now caps `ReflectionProbe`: faces are at most 64 pixels at `low`, 128 at `medium` and 256 at `high`, and `refreshMode: "everyFrame"` runs only at `high` (below, the probe captures on `refresh()` and logs one warning). A removed reflection probe frees its cube map, probes capture again after a recovered device loss, and a probe waits for an environment map before capturing. `bakeLightProbes` yields to the page every ~8 ms instead of after every probe, so large bakes finish much sooner. The 3D desktop templates add one reflection probe at the `high` tier.

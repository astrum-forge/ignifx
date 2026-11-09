---
"@ignifx/core": minor
"ignifx": minor
---

Add `directLight: "include" | "exclude"` to `bakeLightProbes` (`LightProbeBakeDirectLight`). It defaults to `"exclude"`, so a baked `LightProbeVolume` no longer doubles the direct light of the directional, point and spot lights that still light the scene in real time; the bounce off surfaces they light is still baked. Pass `"include"` for the previous result.

---
"@ignifx/core": minor
"@ignifx/cli": minor
---

`Light.shadows` gains three cascaded-shadow knobs: `stabilizeCascades` (stops shadow edges shimmering as the camera moves), `cascadeLambda` (split spacing, default `0.5`) and `cascadeBlend` (cross-fade between cascades, default `0.1`). They apply to `technique: "csm"` only.
The 3D templates' sun now uses cascaded shadows (`csm`, stabilized) instead of ESM, which still survive a lost GPU device.

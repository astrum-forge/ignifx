---
"@ignifx/core": patch
---

Changing a `Light`'s shadow settings (`technique`, `mapSize`, `bias`, `darkness`, `cascades`, `stabilizeCascades`, `cascadeLambda`, `cascadeBlend` and the rest of `shadows`) while it already casts now rebuilds its shadow generator on the next frame. Before, only `shadows.enabled` was compared, so an edit showed only after shadows were turned off and on again.

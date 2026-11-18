---
"@ignifx/core": minor
---

- **Fix:** `PostProcessStack.ssgi` no longer washes the frame out. The bounce is now multiplied by the diffuse colour of the PBR surface it lands on, so a dark surface stays dark and a metal gains nothing; before, it was added to every surface alike. A Standard material's `diffuse` colour and an unlit PBR material are not accounted for yet.
- **Feature:** `ssgi.denoisePasses` (0 to 4, default 4) smooths the bounce with edge-aware blur passes, and `ssgi.rays` (1 to 8, default 2) sets the rays traced per pixel. `ssgi.samples` is the march steps per ray, as before, and does not reduce grain.

### Breaking

`ssgi.environmentDiffuse` now defaults to 1, which leaves the environment's diffuse light whole. Set it to 0.5 to keep the previous default.

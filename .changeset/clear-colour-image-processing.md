---
"@ignifx/core": minor
---

The clear colour now goes through `Environment.imageProcessing` (exposure, contrast and the tone-mapping curve) exactly as a fully fogged fragment does, so fog whose colour matches the clear colour fades into the background with no band, under any curve. It follows image-processing changes at runtime.

### Breaking

A scene with exposure, contrast or a tone-mapping curve set presents a different background: under ACES an sRGB `0.5` clear colour now presents as byte `104` instead of `128`. Scenes without image processing are unchanged. If you tuned a clear colour by eye under tone mapping, check it again.

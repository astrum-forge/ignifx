---
"@ignifx/core": minor
---

`rendering.hdr` now covers every colour writer: fog, Standard and unlit materials, custom `.wgsl` materials such as particles, and the `.env` skybox write linear colour, and sprites are unaffected, so a scene with default image processing looks the same with HDR on. Custom post effects ordered before any built-in one now run on linear colour ahead of the output pass. Lite's six-face `loadSkybox` cube is not yet supported.

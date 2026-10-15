---
"@ignifx/core": patch
---

Fix WebGPU rejecting frames ("used in submit while destroyed") while a scene with both Standard and PBR materials rebuilds after a light or shadow change on a slow machine.

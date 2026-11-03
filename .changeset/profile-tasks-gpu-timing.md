---
"@ignifx/core": patch
---

`renderer.profileTasks` now turns on per-task GPU timing as well as whole-frame timing, so `renderer.taskTimings()` reports each render task (status `"available"` once the first readback lands) instead of `"disabled"`. The `RenderTaskTimings.status` docs now name `"available"`, the value Babylon Lite reports, instead of `"ok"`.

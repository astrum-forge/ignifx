---
"@ignifx/core": patch
---

A renderable rebuild that a material swap lands in now finishes instead of reporting `Cannot read properties of undefined (reading '0')`, and a shadow switched on during a rebuild waits for it to end instead of failing WebGPU validation.

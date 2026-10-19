---
"@ignifx/core": patch
---

A renderable rebuild that a material swap lands in now finishes instead of reporting `Cannot read properties of undefined (reading '0')`, and a shadow-casting light switched on, off, retyped or destroyed during a rebuild changes the scene once the rebuild has finished instead of failing WebGPU validation.

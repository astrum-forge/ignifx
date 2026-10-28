---
"@ignifx/editor-host": patch
---

The scene view reports a component that throws while taking a hot-reloaded default as a `hostError`, and still gives the other components their defaults and rebuilds prefab instances.

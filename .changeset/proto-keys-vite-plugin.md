---
"@ignifx/vite-plugin": patch
---

Fix a sidecar (`*.meta.json`) key named `__proto__`: it is now kept as data in the scanned asset's `meta` and in the manifest entry, instead of changing the prototype of the `meta` object and disappearing from the manifest.

---
"@ignifx/vite-plugin": minor
---

A `.meta.json` sidecar with `"publish": false` keeps its asset out of the manifest, `dist/` and validation, in `vite dev` and in a build; a `publish` value that is not a boolean is `IGX-0551`.
The editor-owned sidecar keys `guid`, `importer`, `source`, `outputs` and `options` (exported as `EDITOR_SIDECAR_KEYS`) no longer reach a manifest entry's `meta`; every other key still does.

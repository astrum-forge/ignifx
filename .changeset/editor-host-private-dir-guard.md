---
"@ignifx/editor-host": patch
---

`editorHostPlugin()` now answers 404 to requests into the editor-private `.ignifx/` directory under `vite dev` and `vite preview`, by path or through a symbolic link, even in a Vite config without `ignifx()`.

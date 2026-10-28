---
"@ignifx/editor-host": patch
---

`editorHostPlugin()` now fails a `vite build`, and removes the copies, when the output holds files from the editor-private `.ignifx/` directory (such as a link under `public/` into it), as `ignifx()` already does, so a config without `ignifx()` cannot ship the editor's MCP token.

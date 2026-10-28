---
"@ignifx/editor-host": minor
---

The editor host clips each string in a `log`, `hostError` or `hotReloaded` report to the new `HOST_TEXT_MAX_LENGTH` (1 MiB, ending `… [clipped]`) and each list to the new `HOST_LIST_MAX_LENGTH` (4096), so the editor no longer drops an oversized report. The wire stays protocol 0.3.

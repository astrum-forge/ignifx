---
"@ignifx/core": patch
"@ignifx/editor-host": patch
"ignifx": patch
---

Fix loading a scene file that lists a component before one its class `requires`: the file's own record is used instead of a second, auto-added instance (or an `IGX-0202` error).

`describeRegisteredSchemas` and the editor host's schema descriptions now list each component's `requires` as type ids.

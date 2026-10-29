---
"@ignifx/editor-host": patch
---

A component that an instance's `add` override gives the root of a one-root prefab now follows a default changed by a script's hot reload.

`openScene` keeps an instance root's own component when an `add` on another member reuses its uid, and warns with `IGX-0608` that the file uses the uid twice, instead of dropping the component as an older editor's double form.

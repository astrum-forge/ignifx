---
"@ignifx/core": patch
"@ignifx/editor-host": patch
---

Fix a prefab instance member's overridden reference into another instance becoming `null` in the scene view when that other instance is rebuilt (an override edit, an asset reload or a changed default); it now points at the rebuilt entity or component, as it does when the scene opens.

A reference that resolves nowhere is no longer reported again each time a reference beside it in the same field is resolved after a rebuild.

The `outsideReferences` documentation of `instantiateScene` now says it also resolves a reference to a component an instance's `remove` override deleted.

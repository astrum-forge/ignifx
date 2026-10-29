---
"@ignifx/core": minor
"@ignifx/editor-host": patch
"ignifx": minor
---

Fix a reference that a prefab instance's override holds in the scene view becoming `null` after an override edit, an asset reload or a changed default; it now resolves as it does when the scene opens.

A component added to the root of a one-root prefab instance is no longer built twice when the scene view rebuilds the instance.

`instantiateScene` takes `outsideReferences`, which resolves a reference to a uid the file does not declare.

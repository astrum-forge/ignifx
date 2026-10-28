---
"@ignifx/editor-host": patch
---

Fix a prefab instance in the scene view drifting from the document after an override edit: a component the instance adds now follows a changed script default, and removing an override that equals the prefab's value no longer fails.

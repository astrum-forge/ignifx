---
"@ignifx/core": minor
"@ignifx/editor-host": patch
---

Add `instanceEntityAt` and `instanceComponentAt`, which find the live entity or component an instance path names inside a built prefab instance.
The scene view keeps a reference by instance path (`"<instanceRootUid>/<uid>"`) when the instance it points into is rebuilt after an override edit or a prefab reload; it no longer clears it and saves `null`.

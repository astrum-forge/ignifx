---
"@ignifx/editor-host": patch
---

Fix the editor's scene mirror check failing for a prefab instance whose overrides are not in the serializer's order (a member's prop override set before its transform override), include one equal to the prefab's value, or were sent as `op: "replace"` or with unrounded transform numbers: `readBack` now returns the instance's override list as the document holds it while its members are unchanged.

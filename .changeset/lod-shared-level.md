---
"@ignifx/3d": minor
"ignifx": patch
---

In an edit-mode app a `MeshRenderer` listed as a level by two `LodGroup`s belongs to the first: the other group leaves it alone and warns once with the new `IGX-1217` (`ThreeDErrorCode.sharedLodLevel`), so removing or disabling one group no longer shows a level the other still hides.

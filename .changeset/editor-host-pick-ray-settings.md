---
"@ignifx/editor-host": minor
---

The scene view's `pick` answer carries the editor camera's ray through the point, and the point where it meets `z = 0`, so the editor can drop an asset on the ground where nothing was hit.
A new `describeSettings` request answers the project's settings sections and their current values, and the exported protocol types declare it, `PickRay`, and a schema's `allowMultiple` and `package`.

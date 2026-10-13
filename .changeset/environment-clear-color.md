---
"@ignifx/core": minor
---

An `Environment` that becomes the winner again, after a newer one is disabled or removed, now restores its own fog, clear colour and image processing instead of leaving the newer one's.

### Breaking

`Environment.clearColor` is now `ColorLike | null` and defaults to `null`, like `Camera.clearColor`: an `Environment` no longer paints the background black over the `rendering.clearColor` setting unless you set its `clearColor`. Set `clearColor` explicitly where you relied on the black default, and handle `null` where you read the field.

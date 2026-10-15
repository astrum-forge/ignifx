---
"@ignifx/2d": minor
---

- Add `SpriteRenderer.frameName`, a saved field that names the frame a sprite draws, so a scene file can choose a still sprite's frame. Setting `frame`, as `SpriteAnimator` does, still takes over until `frameName` is set again.
- An unknown `frameName` reports `IGX-1106` once and draws the first frame.
- A `#frame:` address in `SpriteRenderer.sprite` now reports `IGX-1118` once and draws nothing, instead of throwing in the 2D sync every frame. Name the atlas in `sprite` and the frame in `frameName`.

---
"@ignifx/2d": minor
---

- Add `app.twoD.createSpriteBatch({ atlas, capacity, sortingLayer, blend })` (beta): a fixed number of sprite slots on one sorting layer written directly with `write(index, x, y, width, height, frame, rotation, r, g, b, a)`, with no entity per sprite. Use it for bullets, debris and 2D particles.
- `count` hides the tail of the batch, `hide(index)` hides one slot, and `dispose()` returns the slots. Slots are centred on their position and a batch does not Y-sort against other sprites.
- New codes: `IGX-1114` bad capacity, `IGX-1115` index or count outside the slots, `IGX-1116` write after `dispose()`, `IGX-1117` atlas not loaded.

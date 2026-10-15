---
"@ignifx/physics-2d": minor
---

`TilemapCollider2D` reads the `Tilemap` on its own entity, so a scene file that holds both components has tile collision with no code after `loadScene`, and tile edits reach physics at the next fixed step. Assign `collisionData` only to use other geometry; assigning `null` goes back to the tilemap.

---
"@ignifx/2d": patch
---

Fix tilemap layers swapping their draw order after a chunk is rebuilt (by `setCells`, `setTile` or a camera pan), which drew ground over walls. A tilemap layer's `orderInLayer` now applies, then its place in the file. On a sorting layer without Y-sort, tiles draw behind that layer's sprites when the orders tie.

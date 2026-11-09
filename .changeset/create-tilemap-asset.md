---
"@ignifx/2d": minor
"ignifx": minor
---

Add `createTilemapAsset(app, input, { address })`, which publishes a tilemap built in code at run time as an asset a `Tilemap` can hold. It takes the `.tilemap.json` shape and checks it the way the loader does, so a malformed map throws `IGX-1105`.

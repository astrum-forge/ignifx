---
"@ignifx/cli": minor
---

Add `ignifx import tilemap <map.tilemap.json> <scene.scene.json> [--parent <entity>]`, which moves a tilemap's objects into a scene file as entities, tagged with their type, and removes them from the map. It prints each object's size and properties for you to put on the components you add. A file that is not the expected document reports `IGX-1407`.

---
"@ignifx/vite-plugin": patch
---

Under `vite dev`, an asset the manifest does not list (one added after the page loaded, such as a prefab the editor just created) now loads from the served asset root (`/assets/…`, `base` included) instead of a path relative to the page, which failed with `IGX-0505` on any page below the root, the editor's scene view among them. A request under the asset root for a file that does not exist is now answered 404 rather than with Vite's HTML page. Builds are unchanged.

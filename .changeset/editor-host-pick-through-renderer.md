---
"@ignifx/editor-host": patch
---

The scene view's `pick` uses `app.renderer.pickAsync` alone and converts the point to backing-store
pixels once, so glTF models are picked without the host's own Lite fallback.

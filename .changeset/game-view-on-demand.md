---
"@ignifx/core": minor
"@ignifx/editor-host": minor
---

Add `maxWaitMs` to `app.renderer.renderToTexture` and a new `app.renderer.nextFrame`, so a page that gets no animation frames (a hidden tab or iframe) still renders the frame a request waits for.

The editor host's game view now answers at full rate while hidden (`gameViewOnDemand`), takes the image size in `gameViewFrame` (`gameViewSize`), and renders a 2D scene through its `Camera2D` (`gameView2d`).

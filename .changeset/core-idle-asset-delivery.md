---
"@ignifx/core": patch
---

Asset loads settle while the app is not running

Before `app.start()` and after `app.stop()` there is no frame to deliver a completed load in, so `app.assets` now delivers it as soon as it finishes: a game can `await` its preloads and then start, and a headless test can `await` a handle without stepping. Once the loop runs, delivery stays in `PreUpdate`, as before. Retry backoff before `start()` runs on the wall clock. An abort during a retry backoff now cancels the retry and fails the handle with `IGX-0502`; previously the next attempt ran anyway.

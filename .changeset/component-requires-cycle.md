---
"@ignifx/core": minor
---

A component class whose `static requires` chain loops, through the class itself or a class it requires, is now refused at registration or first `addComponent` with the new error code `IGX-0209` (`CoreErrorCode.requiresCycle`) instead of overflowing the stack. `app.hotReload.apply()` reports such a replacement in `errors` and keeps the previous class.

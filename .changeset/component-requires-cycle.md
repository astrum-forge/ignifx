---
"@ignifx/core": minor
---

A component class whose `static requires` reaches itself, directly or through other classes, is now refused at registration or first `addComponent` with the new error code `IGX-0209` (`CoreErrorCode.requiresCycle`) instead of overflowing the stack.

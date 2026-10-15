---
"@ignifx/audio": patch
"@ignifx/ui": patch
---

The built `AudioService` and `TextComponent` code no longer contains a raw NUL byte, so `grep` and other text tools read those files as text.

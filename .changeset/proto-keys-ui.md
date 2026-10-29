---
"@ignifx/ui": patch
---

Fix `__proto__` keys in `.i18n.json` files: a locale tag or a message key named `__proto__` is now kept as data by `parseLocaleFile` instead of changing an object's prototype and disappearing.

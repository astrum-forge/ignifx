---
"@ignifx/core": patch
---

`defineExtension` factories see `undefined`

`defineExtension`'s factory parameter is typed `(options: O | undefined) => Extension`, which is what the caller can actually pass; the unsafe cast is gone. Factories written as `(options = {}) => …` are unchanged; a factory that read `options.x` without a default now fails to typecheck instead of throwing at runtime.

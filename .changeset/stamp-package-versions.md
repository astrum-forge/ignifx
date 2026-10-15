---
"@ignifx/cli": patch
"@ignifx/core": patch
"@ignifx/2d": patch
"@ignifx/3d": patch
"@ignifx/audio": patch
"@ignifx/devtools": patch
"@ignifx/electron": patch
"@ignifx/input": patch
"@ignifx/particles": patch
"@ignifx/particles-2d": patch
"@ignifx/terrain": patch
"@ignifx/ui": patch
---

- `create-ignifx` now pins a new project's `@ignifx/*` dependencies to its own release (for example `^0.9.1`) instead of `^0.0.0`, which installed the empty 0.0.0 packages.
- `VERSION`, `app.version`, each extension's `version` and the `engineVersion` written into saved scenes now report the installed release instead of `"0.0.0"` (or `"0.2.1"`). `VERSION` is typed `string` instead of a fixed literal.

---
"@ignifx/cli": patch
"@ignifx/electron": patch
---

`pnpm dev:desktop` in a desktop project now downloads the Electron binary on its first run, instead of failing with `Error: Electron uninstall` after a fresh install. The download runs from the `dev:desktop` script, not from an install script, so `pnpm install` still runs no unreviewed install scripts.

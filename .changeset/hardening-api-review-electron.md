---
"@ignifx/electron": minor
---

API review: `HostFileFilter` reaches the `/main` and `/preload` type surfaces

**Added.** `@ignifx/electron/main` and `@ignifx/electron/preload` now export `HostFileFilter`.
`HostOpenDialogOptions.filters` is typed with it on both entry points, but the type itself was
exported only from the package root, so both subpath declaration files were incomplete — API
Extractor reported an `ae-forgotten-export` on each. It is the same declaration in
`src/host-contract.ts` that the root entry already exported; no shape changed.

---
"@ignifx/electron": minor
---

Let a window frame other origins safely: `cspFor({ frameSources })` adds validated `frame-src` origins, `installCspHeader(session, csp, scope)` limits the header to the app's own responses, and `lockNavigation(contents, origin, { frameOrigins })` locks sub-frames to an allow-list read on every navigation.
`createGameWindow` now scopes its CSP header to the window's origin and accepts `frameOrigins`; the default policy is unchanged.

### Breaking

`@ignifx/electron/main` no longer imports `@ignifx/core`, so its errors are `ElectronMainError`s with the same `IGX-####` codes and messages. Check `error.code` instead of `isIgnifxError(error)` in main-process code.

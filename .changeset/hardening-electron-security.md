---
"@ignifx/electron": minor
---

Electron security review: navigation, protocol authority, IPC sender validation

The September 2026 review of the desktop host (`docs/security/electron-review-2026-09.md`) closed two real defects and five defence-in-depth gaps.

**Breaking:** none of the API is removed, but two behaviours a game could have been relying on are now refused. `ignifx://` serves only the authority `app` — any other authority answers `403` with `IGX-1465` — and every `installHostHandlers` handler refuses a request that is not from the game window's own **top-level** document on an allowed origin, with the new code `IGX-1467`. A development build served from a Vite dev server must pass the same `entry` it gave `createGameWindow`: `installHostHandlers({ window, entry })`. `HostHandlerOptions` gains `entry` and `origins`; the four templates' `desktop/main.ts` already pass `entry`.

`lockNavigation`'s origin check was inert for a packaged window. It compared `new URL(url).origin`, and `ignifx` is not a *special* scheme to the WHATWG URL parser, so every `ignifx://…` URL — including the window's own — has the opaque origin `"null"` and the comparison always passed. The new `originOfUrl` rebuilds the tuple from `protocol` and `host` and returns `null` for anything with no tuple origin, so `data:`, `blob:`, `javascript:` and `file:` are refusals rather than matches. `lockNavigation` also now guards `will-redirect` and `will-frame-navigate` — a server-side redirect never fires `will-navigate` — and refuses `will-attach-webview`.

`restrictPermissions` adds `setDevicePermissionHandler`, the per-device grant WebHID, WebUSB and Web Serial consult, denying every device. `ENFORCED_WEB_PREFERENCES` gains `enableBlinkFeatures: ""` and `enableWebSQL: false`, neither of which changes behaviour: they write down a default so a change to it is a diff.

New exports from `@ignifx/electron/main`: `allowedSenderOrigins`, `isTrustedSender`, `SenderIdentity`, `originOfUrl`. New error code `IGX-1467`.

The templates' `electron-builder.yml` flips the Electron Fuses — `runAsNode`, `NODE_OPTIONS`, `--inspect` and `file://` extra privileges off, `onlyLoadAppFromAsar` and cookie encryption on — through `electron-builder`'s own `electronFuses` key, with no new dependency.

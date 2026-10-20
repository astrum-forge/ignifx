---
"@ignifx/editor-host": minor
---

The play controls relay the game's log lines, `app.onError` reports and hot reloads to the editor as `log`, `hostError` and `hotReloaded` play notifications, with the scene view's shapes; what the game reports before the handshake is kept (the newest 256) and sent right after `ready`.
Both views list the new `logRelay` capability, a `hostError` for an app error carries `AppErrorData` (phase name, entity name, component `typeId`, stack), a `log` line carries the first `Error` it was given as `error: { message, code, stack }`, and each hot-reload error has its `stack`; all additive to protocol 0.3.

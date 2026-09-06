---
"@ignifx/electron": minor
"@ignifx/cli": minor
---

Ship the Electron desktop target.

`@ignifx/electron` is no longer a skeleton. It has three entry points, one per Electron process:

- **`@ignifx/electron/main`** — `createGameWindow` builds a window with `contextIsolation`,
  `sandbox`, `nodeIntegration: false` and `webSecurity` fixed as `CONSTITUTION.md` §9.2 requires,
  a strict Content-Security-Policy injected as a response header, every navigation and
  `window.open` refused, and every permission but pointer lock and full screen denied.
  `applyWebGpuSwitches()` turns WebGPU on, `registerIgnifxScheme()` and `serveIgnifxProtocol()`
  serve a packaged build from the secure `ignifx://app` origin — with a real MIME table and real
  `Range` support, which `net.fetch` of a `file://` URL does not provide — and
  `installHostHandlers()` registers the typed IPC surface behind the bridge. `windowOptionsFor`,
  `cspFor`, `protocolPathFor` and `parseRangeHeader` are exported as pure builders so the security
  checklist is a unit test rather than a manual review.
- **`@ignifx/electron/preload`** — `exposeIgnifxHost()`, the one call a preload script makes. It
  exposes storage, paths, window controls, dialogs, the shell and the runtime versions through
  `contextBridge`, `invoke`-based, with no `ipcRenderer` reaching the page.
- **`@ignifx/electron`** — the `electron()` extension. It finds the bridge, records
  `app.platform.kind = "electron"`, installs a file-system `StorageBackend` that writes
  `@ignifx/core`'s own on-disk layout, forwards the host's focus events to `onApplicationFocus`,
  and defines `app.desktop`. Registered in a browser tab it is inert, so one renderer bundle serves
  both builds.

`create-ignifx --desktop` is real: it copies the template's `desktop/` directory,
`electron.vite.config.ts` and `electron-builder.yml`. Without the flag the scaffold is browser-only
and the three Electron build tools are stripped from its `package.json`, so a browser game does not
download an Electron binary it never runs.

All four templates gain a desktop variant with `dev:desktop`, `build:desktop` and `dist:desktop`.

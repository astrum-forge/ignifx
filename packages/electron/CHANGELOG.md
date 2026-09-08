# @ignifx/electron

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0

## 0.1.0

### Minor Changes

- 5bf13be: API review: `HostFileFilter` reaches the `/main` and `/preload` type surfaces
  
  **Added.** `@ignifx/electron/main` and `@ignifx/electron/preload` now export `HostFileFilter`.
  `HostOpenDialogOptions.filters` is typed with it on both entry points, but the type itself was
  exported only from the package root, so both subpath declaration files were incomplete — API
  Extractor reported an `ae-forgotten-export` on each. It is the same declaration in
  `src/host-contract.ts` that the root entry already exported; no shape changed.
- 85b9642: Electron security review: navigation, protocol authority, IPC sender validation
  
  The September 2026 review of the desktop host (`docs/security/electron-review-2026-09.md`) closed two real defects and five defence-in-depth gaps.
  
  **Breaking:** none of the API is removed, but two behaviours a game could have been relying on are now refused. `ignifx://` serves only the authority `app` — any other authority answers `403` with `IGX-1465` — and every `installHostHandlers` handler refuses a request that is not from the game window's own **top-level** document on an allowed origin, with the new code `IGX-1467`. A development build served from a Vite dev server must pass the same `entry` it gave `createGameWindow`: `installHostHandlers({ window, entry })`. `HostHandlerOptions` gains `entry` and `origins`; the four templates' `desktop/main.ts` already pass `entry`.
  
  `lockNavigation`'s origin check was inert for a packaged window. It compared `new URL(url).origin`, and `ignifx` is not a *special* scheme to the WHATWG URL parser, so every `ignifx://…` URL — including the window's own — has the opaque origin `"null"` and the comparison always passed. The new `originOfUrl` rebuilds the tuple from `protocol` and `host` and returns `null` for anything with no tuple origin, so `data:`, `blob:`, `javascript:` and `file:` are refusals rather than matches. `lockNavigation` also now guards `will-redirect` and `will-frame-navigate` — a server-side redirect never fires `will-navigate` — and refuses `will-attach-webview`.
  
  `restrictPermissions` adds `setDevicePermissionHandler`, the per-device grant WebHID, WebUSB and Web Serial consult, denying every device. `ENFORCED_WEB_PREFERENCES` gains `enableBlinkFeatures: ""` and `enableWebSQL: false`, neither of which changes behaviour: they write down a default so a change to it is a diff.
  
  New exports from `@ignifx/electron/main`: `allowedSenderOrigins`, `isTrustedSender`, `SenderIdentity`, `originOfUrl`. New error code `IGX-1467`.
  
  The templates' `electron-builder.yml` flips the Electron Fuses — `runAsNode`, `NODE_OPTIONS`, `--inspect` and `file://` extra privileges off, `onlyLoadAppFromAsar` and cookie encryption on — through `electron-builder`'s own `electronFuses` key, with no new dependency.
- b511cad: Ship the Electron desktop target.
  
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

### Patch Changes

- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [7ca9efe]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0

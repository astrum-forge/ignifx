# ADR-0018 · Electron, electron-vite, and electron-builder

**Status:** Accepted · **Date:** 2026-09-06 · **Supersedes:** none
**Related:** `CONSTITUTION.md` §9.2 (renderer security), §9.3 (dependencies) · `docs/architecture/14-platform-electron.md` §3

## Context

`@ignifx/electron` and the `desktop/` variant of each game template need three things the browser build does not: a runtime that gives a page a real window and a file system, a way to build the three process entries an Electron app has, and a way to turn the result into something a player can install. `CONSTITUTION.md` §9.3 requires that every dependency be justified, so this ADR justifies the three.

## Decision

### 1. `electron` — the runtime, an optional peer

`electron` is a **peer dependency** of `@ignifx/electron`, marked optional, and a dev dependency of the templates. It is a peer because the app being packaged owns the Electron version — two copies in one tree would mean the preload script and the main process disagreeing about `contextBridge` — and optional because the package's **root** export runs in a browser too: a game registers `electron()` unconditionally and gets an inert extension where there is no bridge.

There is no alternative worth listing. Tauri and Wails do not ship a Chromium, and ignifx is WebGPU-only: the system WebView on Windows and Linux is not a target we can state a version for. Electron is the only runtime that lets one renderer bundle serve both builds.

**Quarterly bump.** Electron majors ship roughly every eight weeks and only the last three receive security fixes, so a build pinned for a year is a build shipping known Chromium vulnerabilities. Electron is bumped every quarter; the `desktop-build` CI job is what proves a bump has not broken packaging on all three platforms.

### 2. `electron-vite` — the build, pinned to a beta

An Electron app is three builds — main, preload, renderer — with different targets, formats and externals. `electron-vite` runs all three from one config and, in `dev`, starts the renderer's Vite dev server, publishes its URL as `ELECTRON_RENDERER_URL`, and launches Electron against the built main process. Hand-rolling that means three Vite configs, a watcher, and a process supervisor.

**Why a beta.** `6.0.0-beta.1` is the first `electron-vite` whose peer range declares Vite 8, which this workspace uses; the last stable line stops at Vite 7 and installs only with a peer warning. The beta is chosen so `pnpm install` is clean and a future Vite bump fails loudly rather than silently. The fallback, if the beta regresses, is plain Vite library builds plus the `electron` CLI against the template's own dev server; it is not implemented.

**Risk accepted:** a beta in the build path of four templates. It is confined to `dev:desktop` and `build:desktop`; nothing it produces is a runtime dependency, and `pnpm build` (the browser build) does not use it at all.

### 3. `electron-builder` — the installers

`electron-builder` produces the platform packages. The templates' `dist:desktop` runs `electron-builder --dir`, which produces an **unpacked, unsigned** application and invokes no platform installer tooling, so it runs anywhere and in CI. Platform flags (`--mac`, `--win`, `--linux`) build real installers on a runner of that platform.

**Windows is NSIS, not Squirrel.** `electron-winstaller` (the Squirrel target) has an install script that downloads a toolchain, and this workspace does not allow it (`pnpm-workspace.yaml` lists `electron-winstaller: false`). NSIS needs no install script.

**Signing and auto-update are out of scope.** Both need credentials belonging to whoever ships the game. `mac.identity: null` and `win.signAndEditExecutable: false` make the unsigned path explicit rather than a failure.

## Validation

Measured on macOS arm64 with Electron 44, driven by Playwright's `_electron` fixture; `tests/visual/tests/desktop.spec.ts` and `packages/electron/test/**` pin the results. (carried over; no Electron run was made when this list was condensed)

- WebGPU needs the `enable-unsafe-webgpu` switch: Chrome's default-on WebGPU comes from a server-side rollout Electron does not receive, and without the switch there is no `navigator.gpu`.
- `navigator.gpu` needs a secure context. A `file://` page has an opaque origin, so the packaged build is served by `protocol.handle` on the `ignifx://` scheme, registered `standard` and `secure`. The scheme's privileges are load-bearing and the desktop suite asserts them at run time.
- `net.fetch` ignores `Range` and returns the whole file, so the protocol handler parses `Range` itself and streams the slice.
- Chromium collapses `..` and `%2e%2e` in a `standard` scheme's URL before dispatch. A percent-encoded separator survives, and the handler refuses it with `IGX-1465`.
- A sandboxed preload cannot be an ES module: an `.mjs` preload exposes no bridge and logs no error.
- The renderer receives no DOM focus or visibility events. Minimise, restore, focus and blur fire on the `BrowserWindow` in the main process; `document.hidden` stays `false` in the page.
- `webContents.getWebPreferences()` does not exist. `getLastWebPreferences()` exists at run time and is absent from Electron's typings, so the desktop suite reaches it through an index.
- Pointer lock works in a sandboxed `ignifx://` window, and gamepads are visible with no permission prompt.

## Consequences

### The preload script is CommonJS

`CONSTITUTION.md` §9.2 fixes `sandbox: true`, and a sandboxed preload cannot be an ES module. `@ignifx/electron` publishes ESM like every other package in this repository, so the **app's build** is what converts it: each template's `electron.vite.config.ts` builds `desktop/preload.ts` with `format: "cjs"` and the file name `index.cjs` (the `.cjs` extension because the project is `"type": "module"`), and that file is what `createGameWindow`'s `preload` option points at. `desktop/main.ts` is built as an ES module.

### `onApplicationPause` has no desktop path

Because the renderer receives no DOM focus or visibility events, `electron()` forwards the host's window events itself. `focus` and `blur` map onto `onApplicationFocus`: `App` dispatches that callback with a literal `true` or `false` taken from which listener fired, so a synthetic `focus` or `blur` `Event` on `window` delivers the right value through core's own code.

`onApplicationPause` cannot be reached the same way: `App` dispatches it with `globalThis.document.hidden`, which a synthetic event cannot influence and which is permanently `false` in an Electron window. **`minimize` and `restore` therefore reach games only through `app.desktop.onWindowEvent`.** The fix is a kernel seam that lets an extension dispatch `onApplicationPause(boolean)`, alongside the `platformInternals` and `storageInternals` that already exist. It is open work (`docs/plan/engineering-plan.md`).

### Device-loss recovery needs ESM or CSM shadows

The pinned Babylon Lite version rebuilds only **ESM** and **CSM** directional shadow generators after a device loss; a PCF generator fails recovery and the frame loop stops. A game that wants to survive a device loss on desktop uses `technique: "esm"` or `"csm"`. The 3D templates' sun ships CSM, `packages/core/test/render/csm-device-loss.browser.test.ts` pins the CSM path, and the desktop probe (`templates/3d-third-person/src/desktop-probe.ts`) forces a loss through the `@internal` `forceRendererDeviceLossForTesting` seam.

Recovery logs WebGPU validation warnings about a texture still associated with the destroyed device before it settles. Recovery succeeds regardless; it is a Lite imperfection, not an ignifx one. (carried over)

### Storage file names have no length cap

Neither core's file backend nor this package's caps an encoded file name's length, so a 512-character key (the maximum the `Storage` facade allows) can exceed the 255-byte name limit every target file system shares. It is open work (`docs/plan/engineering-plan.md`).

## Unverified

Nothing below has been executed. It is listed so that nobody reads the passing macOS suite as a claim about three platforms.

- **Windows and Linux.** The `desktop-build` CI job builds and packages the desktop variant with `--dir` on macOS, Windows and Linux, and runs the desktop suite on macOS only. No Windows or Linux build has been launched.
- **Installers.** No `.dmg`, `.exe`, `.deb` or `.AppImage` has been produced; `electron-builder` can only produce a platform's installer on that platform.
- **Code signing, notarization, and auto-update.** Out of scope before 1.0, and none of the three has been exercised.
- **Electron Fuses on Windows and Linux.** The `electronFuses` block in each `electron-builder.yml` was read back from a packaged macOS arm64 `.app`; whether the same flips land in a Windows or Linux binary is untested.

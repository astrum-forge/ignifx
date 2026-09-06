# ADR-0018 · Electron, electron-vite, and electron-builder

**Status:** Accepted · **Date:** 2026-09-06 · **Phase:** 9 · **Supersedes:** none
**Related:** `CONSTITUTION.md` §9.2 (renderer security), §9.3 (dependencies) · `docs/architecture/14-platform-electron.md` §3 · `docs/plan/engineering-plan.md` Phase 9 (S9.1)

---

## Context

Phase 9 ships `@ignifx/electron` and a `desktop/` variant of each game template. A desktop build needs three things the browser build does not: a runtime that gives a page a real window and a file system, a way to build the three process entries an Electron app has, and a way to turn the result into something a player can install. `CONSTITUTION.md` §9.3 requires that every dependency be justified, so this ADR justifies the three and records what the S9.1 spike measured about each.

---

## Decision

### 1. `electron` — the runtime, pinned to 44.x, peer + dev

`electron` is a **peer dependency** of `@ignifx/electron`, marked optional, and a dev dependency of the templates. It is a peer because the app being packaged owns the Electron version — two copies in one tree would mean the preload script and the main process disagreeing about `contextBridge` — and optional because the package's **root** export runs in a browser too: a game registers `electron()` unconditionally and gets an inert extension where there is no bridge.

There is no alternative worth listing. Tauri and Wails do not ship a Chromium, and ignifx is WebGPU-only: the system WebView on Windows and Linux is not a target we can state a version for. Electron is the only runtime that lets one renderer bundle serve both builds.

**Quarterly bump.** Electron majors ship roughly every eight weeks and only the last three receive security fixes, so a build pinned for a year is a build shipping known Chromium vulnerabilities. The plan schedules a bump every quarter; the `desktop-build` CI job is what proves a bump has not broken packaging on all three platforms.

### 2. `electron-vite` — the build, at `6.0.0-beta.1`

An Electron app is three builds — main, preload, renderer — with different targets, formats and externals. `electron-vite` runs all three from one config and, in `dev`, starts the renderer's Vite dev server, publishes its URL as `ELECTRON_RENDERER_URL`, and launches Electron against the built main process. Hand-rolling that means three Vite configs, a watcher, and a process supervisor.

**Why a beta.** This workspace pins Vite 8.2.2. `electron-vite@5.0.0` declares `vite ^5 || ^6 || ^7` and installs against Vite 8 only with a peer warning; `6.0.0-beta.1` declares `vite ^6 || ^7 || ^8` and installs cleanly. Both were probed against a trivial main/preload/renderer project in `templates/3d-third-person`:

```
# electron-vite@5.0.0 (peer warning, Vite 8.2.2)
vite v8.2.2 building ssr environment for production...
✓ 2 modules transformed.
out/main/index.js  0.07 kB
✓ built in 52ms
… preload and renderer likewise, exit 0

# electron-vite@6.0.0-beta.1 (no peer warning, Vite 8.2.2)
vite v8.2.2 building ssr environment for production...
✓ 2 modules transformed.
out/main/index.js  0.11 kB
✓ built in 51ms
… preload and renderer likewise, exit 0
```

Both work. The beta is chosen because it is the one whose declared peer range is honest about Vite 8, so `pnpm install` is clean and a future Vite bump fails loudly rather than silently. The fallback — plain Vite 8 library builds plus the `electron` CLI against the template's own dev server — was not needed and is not implemented; if the beta regresses, that is the escape route.

**Risk accepted:** a beta in the build path of four templates. It is confined to `dev`/`build:desktop`; nothing it produces is a runtime dependency, and `pnpm build` (the browser build) does not use it at all.

### 3. `electron-builder` — the installers, `26.15.3`

`electron-builder` produces the platform packages. The templates' `dist:desktop` runs `electron-builder --dir`, which produces an **unpacked, unsigned** application and invokes no platform installer tooling, so it runs anywhere and in CI. Platform flags (`--mac`, `--win`, `--linux`) build real installers on a runner of that platform.

**Windows is NSIS, not Squirrel.** `electron-winstaller` (the Squirrel target) has an install script that downloads a toolchain, and this workspace does not allow install scripts (`pnpm-workspace.yaml` lists `electron-winstaller: false`). NSIS needs no install script. The Windows configuration in each template's `electron-builder.yml` is therefore **written but never executed here** — see "Unverified" below.

**Signing and auto-update are out of scope.** Both need credentials belonging to whoever ships the game. `mac.identity: null` and `win.signAndEditExecutable: false` make the unsigned path explicit rather than a failure.

---

## S9.1 spike — what was measured

All on **macOS 15 (Darwin 25.5.0), arm64, Electron 44.2.0**, driven by Playwright's `_electron` fixture. Every Electron API cited is from `packages/electron/node_modules/electron/electron.d.ts` at the line given.

| Question                                                | Answer                                                                                                                                                                                                                                                                                                                                                                               | Evidence                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Does WebGPU work with `enable-unsafe-webgpu`?           | **Yes.** `navigator.gpu.requestAdapter()` resolved an adapter reporting `vendor: "apple"`, `architecture: "metal-3"`, 25 features; a cleared frame presented through a configured canvas context.                                                                                                                                                                                    | `app.commandLine.appendSwitch` — `electron.d.ts` 7112                                  |
| Is the switch needed at all?                            | **Yes.** Chrome's default-on WebGPU comes from a server-side rollout Electron does not receive. Without the switch there is no `navigator.gpu`.                                                                                                                                                                                                                                      | —                                                                                      |
| Does `protocol.handle` serve a packaged build?          | **Yes.** `ignifx://app/index.html` loaded; `window.location.origin === "ignifx://app"`, `window.isSecureContext === true`; `fetch("ignifx://app/assets.manifest.json")` returned `200` with `application/json`.                                                                                                                                                                      | `protocol.handle` — 11561; `registerSchemesAsPrivileged` — 11702; `Privileges` — 23336 |
| Is a secure context required?                           | **Yes**, for `navigator.gpu`. A `file://` page has an opaque origin, so `'self'` matches nothing and there is no secure context. This is why the scheme is `standard: true, secure: true`.                                                                                                                                                                                           | —                                                                                      |
| Does `net.fetch` honour `Range`?                        | **No.** A `bytes=100-199` request against a 2000-byte file returned `200` with all 2000 bytes and no `Content-Range`. The protocol handler therefore parses `Range` itself and streams the slice.                                                                                                                                                                                    | measured; `respondToProtocolRequest` in `src/main/protocol.ts`                         |
| Is path traversal reachable?                            | **Not through Chromium.** A `standard` scheme's URL parser collapses `..` and `%2e%2e` before dispatch: `ignifx://app/../outside.txt` arrives as `/outside.txt`. A percent-encoded separator (`..%2f..%2f`) survives, and `protocolPathFor` refuses it with `IGX-1465`.                                                                                                              | measured, both layers unit-tested                                                      |
| Does pointer lock work?                                 | **Yes.** `document.body.requestPointerLock` is present in a sandboxed `ignifx://` window. `restrictPermissions` grants `pointerLock` and `fullscreen` and denies everything else.                                                                                                                                                                                                    | `setPermissionRequestHandler` — 13426                                                  |
| Are gamepads visible?                                   | **Yes.** `navigator.getGamepads()` returned its four slots with no permission prompt.                                                                                                                                                                                                                                                                                                | measured                                                                               |
| Can the preload script be an ES module?                 | **No, not under `sandbox: true`.** A `preload.mjs` containing `import { contextBridge } from "electron"` left `window.ignifxHost === undefined` with **no error logged anywhere**; the byte-identical CommonJS `preload.cjs` exposed the bridge. Both runs confirmed `sandbox: true` at runtime.                                                                                     | measured; see doc correction below                                                     |
| Does the renderer receive DOM focus/visibility events?  | **No.** Minimising, restoring and blurring the window fired `minimize`, `blur`, `restore`, `focus` on the `BrowserWindow` in the **main** process and delivered nothing at all to the page: no `visibilitychange`, no window `focus`/`blur`, `document.hidden` stayed `false` and `document.hasFocus()` stayed `true` throughout.                                                    | measured; see "Consequences"                                                           |
| Can the running window's security options be read back? | **Yes, but not through the typed surface.** `webContents.getWebPreferences()` does **not** exist in Electron 44 — absent from `electron.d.ts` and `undefined` at runtime. `webContents.getLastWebPreferences()` exists at runtime and returns the resolved values, but is **also absent from `electron.d.ts`**, so the desktop suite reaches it through an index rather than a call. | measured                                                                               |
| Does a forced device loss recover?                      | **Yes, with ESM shadows only.** See "Consequences".                                                                                                                                                                                                                                                                                                                                  | measured                                                                               |

---

## Consequences

### The preload script is CommonJS

`CONSTITUTION.md` §9.2 fixes `sandbox: true`, and a sandboxed preload cannot be an ES module. `@ignifx/electron` publishes ESM like every other package in this repository, so the **app's build** is what converts it: each template's `electron.vite.config.ts` builds `desktop/preload.ts` with `format: "cjs"` and the file name `index.cjs` (the `.cjs` extension because the project is `"type": "module"`), and that file is what `createGameWindow`'s `preload` option points at. `desktop/main.ts` is built as an ES module, which Electron 44 loads.

### `onApplicationPause` has no desktop path yet

Because the renderer receives no DOM focus or visibility events, `electron()` forwards the host's window events itself. `focus`/`blur` map cleanly onto `onApplicationFocus`, because `App` dispatches that callback with a literal `true`/`false` taken from which listener fired — so a synthetic `focus`/`blur` `Event` on `window` delivers the right value through core's own code, with no double delivery.

`onApplicationPause` cannot be reached the same way: `App` dispatches it with `globalThis.document.hidden`, which a synthetic event cannot influence and which is permanently `false` in an Electron window. **`minimize` and `restore` therefore reach games only through `app.desktop.onWindowEvent`.** The fix is a small kernel seam — an internals accessor that dispatches `onApplicationPause(boolean)`, alongside the `platformInternals` and `storageInternals` that already exist — and it is a `@ignifx/core` change, requested rather than made here.

### Device-loss recovery needs ESM shadows

Babylon Lite 1.27.0 can only rebuild an **ESM** directional shadow generator after a device loss. `lib/shadow/shadow-recovery.js` opens with `if (generator._shadowType !== "esm") ThrowLiteError(463, generator._shadowType)`, and error 463 reads _"Device-lost Scene recovery does not support shadow generator type `${a0}`"_.

Measured with `templates/3d-third-person` on Electron 44.2.0: with the level's shipped `technique = "pcf"`, a forced loss fired `onDeviceLost` and then `onDeviceRecoveryFailed`, and the frame loop stopped. With the sun switched to `"esm"`, the same forced loss recovered — `deviceLost: 1`, `deviceRecovered: 1`, `deviceRecoveryFailed: 0`, the coroutine counter climbing from 74 to 795 across twelve seconds, the crate's height unchanged to seven decimal places, `app.audio.state === "running"`, and 76 draw calls after recovery.

The template still ships PCF, because that is what its committed visual golden was taken with; the desktop suite's `?probe=1` path switches the sun to ESM before `app.start()` and says so. **A game that wants to survive a device loss on desktop should use `technique: "esm"`.** Whether the templates should switch — and their goldens be regenerated — is a decision for the phase that owns them.

Recovery also logs WebGPU validation warnings about a texture still associated with the destroyed device (`[Texture …] is associated with [Device], and cannot be used with [Device]`) before settling. Recovery succeeds regardless; it is recorded here as a Lite imperfection, not an ignifx one.

### The `ignifx://` protocol is not optional

Serving a packaged build over `file://` would cost it `navigator.gpu` outright. The scheme's four privileges are load-bearing and are asserted at runtime by the desktop suite.

---

## Unverified

Everything below is **documented from upstream sources and not executed in this repository**. It is listed so that nobody reads the passing macOS suite as a claim about three platforms.

- **Windows.** The `win` block in each `electron-builder.yml` (NSIS target, `signAndEditExecutable: false`) is configuration only. No Windows build has been run. Squirrel installers are unreachable here at all, because `electron-winstaller`'s install script is not allowed.
- **Linux.** `enable-features=Vulkan` is written from Chromium's own flag list. No Linux build has been run, and no Linux runner with a display has executed the desktop suite. Linux CI needs `xvfb-run`.
- **Cross-compilation.** `electron-builder` can only produce a macOS `.dmg` on macOS; the `desktop-build` CI matrix exists to build each platform on its own runner.
- **Code signing, notarization, and auto-update.** Out of scope before 1.0, and none of the three has been exercised.
- **Electron Fuses on Windows and Linux.** The `electronFuses` block in each `electron-builder.yml` was read back from a packaged macOS arm64 `.app` on 2026-09-07 (`RunAsNode` off, `OnlyLoadAppFromAsar` on, and the rest as configured); whether the same flips land in a Windows or Linux binary is untested.
- **Installer sizes.** Only the macOS arm64 `--dir` output has been measured: a 303 MB unpacked `.app` around a 15.8 MB `app.asar`. No `.dmg`, `.exe`, `.deb` or `.AppImage` has been produced.

## Requested of `@ignifx/core`

Two seams would delete code from this package and one from a template:

1. **`forceDeviceLossForTesting(engine)`** — core already has the wrapper (`src/lite/gpu/device-loss.ts`, `@internal`, not exported). Exporting it would let `templates/3d-third-person/src/desktop-probe.ts` stop reaching two underscore-prefixed Lite fields (`engine._deviceLostRecovery._forceNextLoss`, `engine._device.destroy()`) through the `app.lite` escape hatch.
2. **An application-lifecycle dispatch seam** — so `electron()` can deliver `onApplicationPause(true)` on `minimize`, as `14-platform-electron.md` §3 specifies.

A third, smaller one: neither core's file backend nor this package's caps an encoded file name's length, so a 512-character key (the maximum the `Storage` facade allows) encodes to as much as 1536 characters and would exceed the 255-byte name limit every target file system shares. Both copies of the codec have the same gap; it is not desktop-specific.

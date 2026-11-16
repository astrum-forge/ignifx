# 14 · Platform: Browser, Electron, Headless

**Status:** Implemented; describes the code on `main` · **Packages:** `@ignifx/core` (platform service, storage), `@ignifx/electron` · **Related:** `05-assets-and-loading.md` §8, `CONSTITUTION.md` §9.2, ADR-0018

**Source map**

- `packages/core/src/platform/` — `platform.ts` (detection as a pure function of a host scrape), `webgpu.ts`, `web/adapter-probe.ts` (`app.platform`, §1).
- `packages/core/src/storage/` — `storage.ts` (`app.storage`), `backend.ts` (the `StorageBackend` contract), `names.ts` and `values.ts` (validation, canonical JSON, bytes), `file-names.ts` (key encoding), `memory-backend.ts`, `web/indexeddb-backend.ts`, `node/file-backend.ts` (§2).
- `packages/electron/src/main/` — `window.ts` (`createGameWindow`, `ENFORCED_WEB_PREFERENCES`, navigation lock, permissions), `csp.ts`, `protocol.ts` (`ignifx://`), `ipc.ts` (`installHostHandlers`, the sender check), `origin.ts`, `switches.ts`, `storage-fs.ts`.
- `packages/electron/src/preload/bridge.ts` — `exposeIgnifxHost`; `host-contract.ts` — the versioned IPC surface both sides share.
- `packages/electron/src/renderer/` — `extension.ts` (`electron()`), `desktop.ts` (`app.desktop`), `storage-backend.ts`, `host.ts`.
- Packaging and fuses: `templates/*/electron-builder.yml`; the desktop variant of a template is its `desktop/` directory and `electron.vite.config.ts`.
- Error codes: `IGX-1420`–`IGX-1426` (storage, core), `IGX-1460`–`IGX-1467` (`packages/electron/src/error-codes.ts`).

Invariants to keep:

- `ENFORCED_WEB_PREFERENCES` is spread last over whatever the caller passed; a deviation needs an ADR (`CONSTITUTION.md` §9.2; §3).
- `script-src` never gets `'unsafe-inline'` or `'unsafe-eval'`, and the policy is a response header, not a `<meta>` tag (§3.2).
- IPC is answered only for the top frame of the game window on an allowed origin, checked before any argument is read (§3, §3.2).
- The preload builds to CommonJS; a sandboxed preload cannot be an ES module (§3).
- `applyWebGpuSwitches()` and `registerIgnifxScheme()` run before `app.whenReady()` (§3).
- `@ignifx/electron/main` imports nothing from `@ignifx/core` (§3.2).
- A storage namespace is a backend scope, keys are opaque and encoded, and backends reject only with `IGX-142x` errors (§2).
- `@ignifx/core` names no Node type in its published `.d.ts` (§5).

Not built: an `onApplicationPause` path on desktop, code signing, notarization and auto-update, storage migration hooks, and CLI commands beyond scaffolding and `ignifx import` (`11-2d-toolkit.md` §2.5).

---

## 1. Platform service (`app.platform`)

`{ kind: "browser" | "electron" | "node", os, isMobile, hasPointerLock, hasGamepads, webgpu: { adapterInfo, features, limits } | null, locale, reducedMotion }`. Populated at `createApp`; extensions branch on it, game code rarely should.

- `os` is `"macos" | "windows" | "linux" | "ios" | "android" | "unknown"`. Under Node it comes from `process.platform`; in a browser from `navigator.userAgentData.platform`, then `navigator.platform`, then the user agent. A "Macintosh" with more than one touch point is an iPad, so it reports `"ios"`.
- `webgpu` is **`null`** in a headless app and on a host with no `navigator.gpu`. It describes the **adapter**, not Babylon Lite's device: Lite's `EngineContext` exposes neither the `GPUAdapter` nor the `GPUDevice` it acquired, so `createApp` asks `navigator.gpu` for its own adapter — which allocates nothing. `features` is a sorted string array and `limits` a number record, both plain data, so the record survives `JSON.stringify` into a bug report.
- `kind` starts at `"browser"` wherever there is a `document`: an Electron renderer is a browser as far as the kernel can tell. `@ignifx/electron` detects its own preload bridge and calls the `@internal` `platformInternals(app.platform).setKind("electron")`. The record is mutable for exactly that reason.
- Detection is a pure function of a host scrape, so every branch is unit-tested under Node against a fabricated host.

## 2. Storage (`app.storage`)

```ts
interface Storage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<readonly string[]>;
  namespace(name: string): Storage; // "saves", "settings", "input-overrides"
}
```

Backends: IndexedDB (browser), file system through the Electron bridge (`userData/<namespace>/<key>.json`), in-memory (headless), and a directory tree under Node (`createApp({ storage: { directory } })`). Values are JSON; large binary saves use `Blob`/`ArrayBuffer` support in every backend.

The rules every backend follows:

- **A namespace is a backend scope, not a key prefix.** `keys()` on `"saves"` never returns a key of `"saves-old"`, a directory backend gets one directory per namespace, and clearing a namespace is one operation. Nested namespaces join with `/`: `namespace("saves").namespace("coop")` is the scope `"saves/coop"`, whose keys `"saves"` does not list. `app.storage` itself is the namespace `"default"`, because every backend call carries one. `namespace(name)` is memoized, so two calls with the same name return the same object.
- **Namespace names** are 1–64 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`, `-`, and are never `.` or `..` (`IGX-1421`). **Keys** are opaque: 1–512 characters of any printable Unicode, `/` and `..` included, with no control characters (`IGX-1422`). Backends encode keys; they never resolve them.
- **JSON values are canonicalized** the way `06-serialization-and-scene-format.md` §2 canonicalizes scene files — every number rounded through `canonicalizeNumber` — so writing the same state twice produces the same bytes. Object key order is the value's own insertion order; it is not sorted.
- **Binary values round-trip as octets, not as wrappers.** A `Blob`, an `ArrayBuffer`, or any typed array is stored as bytes and read back as a `Uint8Array`. A view contributes only the window it describes.
- **`keys()` is sorted ascending** (UTF-16 code unit order) on every backend, and lists only that namespace — not its children.
- **The backend contract** is `StorageBackend`: `get`/`set`/`delete`/`keys`/`clear` over `(namespace, key)` pairs and a `StoredValue` that is either `{ kind: "json", json }` or `{ kind: "bytes", bytes }`, plus an optional `dispose()`. `@ignifx/electron` implements it, and `storageInternals(app.storage).setBackend(…)` is the `@internal` seam its renderer extension installs through after `createApp`.
- **Error codes** come from the platform block: `IGX-1420` no Web Crypto available (the id and hashing helpers the storage and scene layers share), `IGX-1421` namespace, `IGX-1422` key, `IGX-1423` value with no JSON form, `IGX-1424` quota or disk full, `IGX-1425` any other backend failure, `IGX-1426` a stored value that cannot be read back. Backends never reject with a raw `DOMException` or a Node `SystemError`.
- **IndexedDB layout**: one database `ignifx`, one object store `values`, out-of-line compound keys `[namespace, key]`. One store rather than one per namespace, because a store per namespace needs a version upgrade the first time a game names a new one — and an upgrade blocks while another tab holds the database open. The database is opened _without_ a version so an older build still reads a newer one; a missing `values` store triggers one upgrade that creates it.
- **The directory backend** writes `<directory>/<namespace>/<encoded-key>.json` or `.bin`, always through a temporary file and a `rename`, so a crash leaves the whole previous value or the whole new one. Keys are percent-encoded onto a **lower-case-only** alphabet (`a`–`z`, `0`–`9`, `.`, `_`, `-`), which makes path traversal, Windows-illegal characters, and case-insensitive collisions between `Slot1` and `slot1` all impossible at once; a leading or trailing dot and the Windows device names (`con`, `nul`, `com1`…) are escaped by writing one already-safe character as an escape.

## 3. Electron (`@ignifx/electron`)

Three parts, mirroring Electron's process model:

- **Main** (`@ignifx/electron/main`): `createGameWindow({ entry, preload, width, height, fullscreen, frame, title, icon })`. Two calls must come **before** `app.whenReady()`, because Chromium reads both while it initialises and a later call is silently inert: `applyWebGpuSwitches()` appends `enable-unsafe-webgpu` (WebGPU is never default-on in Electron; Chrome's default-on comes from a server-side rollout Electron does not receive) and, on Linux, `enable-features=Vulkan`; `registerIgnifxScheme()` declares `ignifx://` as `standard, secure, supportFetchAPI, stream`. After ready: `serveIgnifxProtocol(dir)` serves the built renderer so the same manifest and loaders work unchanged, `createGameWindow` opens the window, and `installHostHandlers({ window, entry })` registers the IPC handlers — `entry` is what the sender check derives the allowed origins from, so a dev-server build without it is refused with `IGX-1467`. Window options enforce `ENFORCED_WEB_PREFERENCES` (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`, `enableBlinkFeatures: ""`, `enableWebSQL: false` and the rest; the constant in `packages/electron/src/main/window.ts` holds every value, and `packages/electron/test/security.test.ts` asserts them) and a strict CSP header; deviations require an ADR (`CONSTITUTION.md` §9.2). `minimize/restore/focus/blur` and the full-screen pair are forwarded to the renderer.
- **Preload** (`@ignifx/electron/preload`): `exposeIgnifxHost()` calls `contextBridge.exposeInMainWorld("ignifxHost", { version, versions, storage, paths, window, dialogs, shell })` with a typed, versioned IPC surface (`invoke`-based, no raw `ipcRenderer` exposure). **The app builds this entry to CommonJS**, not `.mjs`: a sandboxed preload script cannot be an ES module. Measured on Electron 44.2.0 / macOS arm64 (ADR-0018), an `.mjs` preload under `sandbox: true` left `window.ignifxHost` undefined and logged nothing at all, while the byte-identical CommonJS build worked. The templates' `electron.vite.config.ts` therefore emits `out/preload/index.cjs`.
- **Renderer** (`electron()` extension, the package root export): detects `window.ignifxHost`, refuses a major-version mismatch with `IGX-1460` and an incomplete bridge with `IGX-1461`, installs the file-system storage backend through `storageInternals`, sets `app.platform.kind = "electron"` through `platformInternals`, forwards the host's `focus`/`blur` to `onApplicationFocus`, and exposes `app.desktop` (`isElectron`, `versions`, `onWindowEvent`, `paths`, `setFullscreen`, `isFullscreen`, `setWindowTitle`, `quit`, `showOpenDialog`, `openExternal`). Registered in a browser tab it is **inert**: one debug line, and an `app.desktop` that answers `isElectron === false` and rejects every call with `IGX-1462`. That is what lets one renderer bundle serve both builds, and it is why the templates register `electron()` unconditionally.

**`onApplicationPause` has no desktop path.** An Electron renderer receives no DOM lifecycle events at all: measured on Electron 44.2.0, minimising, restoring and blurring the window fired the matching `BrowserWindow` events in the main process and delivered no `visibilitychange` and no window `focus`/`blur` to the page, with `document.hidden` staying `false` throughout. `onApplicationFocus` is reachable anyway, because `App` dispatches it with a literal `true`/`false`; `onApplicationPause` is not, because `App` dispatches it with `document.hidden`. Until the kernel grows a dispatch seam for it, `minimize` and `restore` reach games through `app.desktop.onWindowEvent` (ADR-0018).

Packaging: `electron-vite` for dev/build (main, preload, renderer projects) and `electron-builder` for installers. Each game template has a `desktop/` variant, copied by the scaffolder's `--desktop` flag (`npx @ignifx/cli`, whose bin is named `create-ignifx`); without the flag the scaffold is browser-only and the Electron build tools are stripped from its `package.json`. `dist:desktop` runs `electron-builder --dir` — unpacked and **unsigned**. There is no auto-update and no signing recipe. Electron majors ship every eight weeks and only the last three receive security fixes; ADR-0018 sets a quarterly Electron bump.

**What else is locked down** (all in `packages/electron/src/main/`, asserted by `packages/electron/test/security.test.ts` and `window.test.ts`):

- Permissions: `ALLOWED_PERMISSIONS` is `pointerLock`, `fullscreen` and `automatic-fullscreen`; every other request and check is denied, and `setDevicePermissionHandler` answers `false` for every device.
- `window.open` is denied (`setWindowOpenHandler`) and `will-attach-webview` is refused.
- `ignifx://` serves one authority, `app`; any other is `IGX-1465`, answered `403` (§3.1). Paths are decoded, checked for NUL and contained in the served root.
- `openExternal` hands only `https:` and `mailto:` URLs to the system (`DEFAULT_EXTERNAL_PROTOCOLS`), judged on the parsed protocol; anything else is `IGX-1464`.
- Fuses, in each template's `electron-builder.yml`: `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` and `grantFileProtocolExtraPrivileges` off; `onlyLoadAppFromAsar` and `enableCookieEncryption` on.

**Accepted risks.** Each is deliberate; do not "fix" one without the design change it names.

- `style-src 'unsafe-inline'`: `@ignifx/ui` and every template's `index.html` install a `<style>` element. Inline styles cannot run script under this policy. Removing it needs nonces threaded through the UI package.
- The development policy admits the dev-server origin in `script-src`. It applies only when `entry` is an `http(s):` URL, which is `electron-vite dev` on the developer's own machine; a packaged build never takes it.
- `setUSBProtectedClassesHandler` and `setBluetoothPairingHandler` are unset. Both matter only after a device permission is granted, and USB, HID, serial and Bluetooth are denied on every path.
- ASAR integrity validation is off (`enableEmbeddedAsarIntegrityValidation: false`). It needs the resource hashes a signing step writes; with no signing identity, turning it on makes the packaged app refuse to start.
- Builds are unsigned and not notarized. The credentials belong to whoever ships the game, not to a template (ADR-0018); `identity: null` and `signAndEditExecutable: false` make that an explicit configuration.
- No auto-update, so there is no update channel to attack; the cost is that a shipped game gets Chromium fixes only by a rebuild, which is what the quarterly bump is for.
- Symbolic links inside the served directory are followed: the path is resolved lexically, not with `realpath`. The directory is the game's own build output.
- `devTools` stays at Chromium's default (on). It is a debugging affordance in the player's own sandboxed process, not a privilege boundary.

### 3.1 The `ignifx://` protocol

A packaged renderer is served from `ignifx://app/index.html` rather than `file://`, and the difference is not cosmetic: a `file://` page has an **opaque origin**, so relative `fetch` fails, `'self'` in a CSP matches nothing, and the page is not a secure context — and without a secure context there is no `navigator.gpu` at all. The scheme's four privileges are each load-bearing: `standard` gives it a real hierarchical origin, `secure` puts it in a secure context, `supportFetchAPI` lets the asset loaders reach it, `stream` lets media elements range-request it.

The handler serves the build output with an explicit MIME table (`.wasm` must be `application/wasm` or `WebAssembly.instantiateStreaming` refuses it) and implements `Range` itself: `net.fetch` of a `file://` URL does **not** honour a `Range` header — measured, a `bytes=100-199` request against a 2000-byte file returned `200` with all 2000 bytes — so a seeking media element would otherwise never get a `206`.

### 3.2 The Content-Security-Policy

Injected as a **response header** through `session.webRequest.onHeadersReceived`, not as a `<meta>` tag: `frame-ancestors` is ignored in a `<meta>` policy by specification, and a `<meta>` policy only applies from the point the parser reaches it. The packaged policy is

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:;
connect-src 'self' data: blob:; worker-src 'self' blob:; child-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; manifest-src 'self'
```

`script-src` never gets `'unsafe-inline'` or `'unsafe-eval'`. It does get `'wasm-unsafe-eval'`, because Chromium refuses `WebAssembly.instantiate` under a CSP without it and both physics extensions need it. `style-src` gets `'unsafe-inline'` because `@ignifx/ui` installs its stylesheet as a `<style>` element and every template's `index.html` carries one.

`createGameWindow` installs the header for the window's **own origin only** (`installCspHeader(session, policy, origin)`): a document from another origin keeps its own headers, which matters only to a window that frames one — given the game's `frame-ancestors 'none'`, a framed page would refuse to load. `installCspHeader` without its third argument still covers every response in the session.

**Framing another origin** (a tool window such as the ignifx editor, which frames its scene view from a loopback dev server) takes three things together, none of which loosens the default policy:

- `cspFor({ frameSources })` replaces `frame-src 'none'` with the listed sources. Each must be one `scheme://host` with an optional `:port` or `:*` (`isFrameSource`); a keyword, a bare scheme, a path, a `*` host, or a list smuggled into one entry throws `IGX-1466`.
- `installCspHeader(session, policy, scope)` with `scope` the app's origin, or a predicate over the response URL (for a custom scheme), so the framed document is not served the app's `frame-ancestors 'none'`.
- `lockNavigation(contents, appOrigin, { frameOrigins })` keeps the main frame on the app's origin and lets a sub-frame navigate only to an origin in `frameOrigins`. A function is called on every sub-frame navigation, `will-redirect` included, so the allow-list follows a dev server that moved ports after the document loaded — which the header cannot do, since a loaded document keeps the policy it was served with. `isNavigationAllowed` is the pure rule. `createGameWindow({ frameOrigins, csp: { frameSources } })` wires both.

IPC stays top-frame only: `installHostHandlers` refuses a sub-frame sender with `IGX-1467` whatever the frame allow-list says.

`@ignifx/electron/main` imports nothing from `@ignifx/core`: its errors are `ElectronMainError`s, carrying the same `IGX-####` codes and core's development message format, and `isIgnifxError` is `false` for them.

## 4. Browser

- Capability page: each template ships its fallback **inside its own `index.html`** — a `#unsupported` block revealed by `document.body.dataset.webgpu = "unavailable"` — rather than as a separate `webgpu-unsupported.html` file. It is shown when `createApp` rejects with `IgnifxError` code `IGX-0701` (WebGPU unavailable), and also when startup fails for any other reason, so a broken build is never a blank window. There is no shared `templates/_shared/` directory and no exported markup helper: the panel is three elements and a stylesheet rule, and every template already styles its own.
- Headers: `SharedArrayBuffer` is not required (no threaded physics), so no COOP/COEP headers are needed; if a future extension needs them the Vite plugin adds dev-server headers and documents hosting requirements.
- Mobile: supported where WebGPU is (Chrome Android on qualifying GPUs, Safari 26+); touch input and `VirtualJoystick` cover controls; `resolutionScale` and `maxDevicePixelRatio` handle performance.

## 5. Headless (Node)

`createApp({ headless: true })` uses Lite's null engine, the memory storage backend — or the directory backend when `createApp({ storage: { directory } })` asks for one — stub input and audio, and Node `fetch`/`fs` for assets. Used by unit tests, CI and tooling.

`@ignifx/core` compiles without `@types/node` and must not name a Node type in its published `.d.ts`, so the directory backend loads `node:fs/promises` through a **computed** specifier and narrows it to a six-call interface it declares itself. No bundler follows the import, and a browser build of a game that never calls `createFileStorageBackend` pays nothing for it.

## 6. Supported matrix (to be re-verified at each release)

- **Chrome / Edge 113+ (desktop):** supported.
- **Safari 26+ (macOS 26, iOS/iPadOS 26):** supported.
- **Firefox 141+ Windows, 145+ macOS Apple Silicon:** supported; Linux and Android Firefox are pending upstream WebGPU.
- **Chrome Android 121+ (Android 12+, Qualcomm/ARM GPUs):** supported, with reduced budgets.
- **Electron 44+, macOS arm64:** supported. `tests/visual/tests/desktop.spec.ts` asserts the window, `ignifx://`, the CSP, the storage bridge and device-loss recovery; the `desktop-build` CI job runs it on macOS.
- **Electron 44+, Windows:** packaged unpacked and unsigned by the `desktop-build` CI job, never launched. NSIS is the installer target; Squirrel is unreachable (`electron-winstaller`'s install script is not allowed).
- **Electron 44+, Linux:** packaged unpacked by the `desktop-build` CI job, never launched. Needs `enable-features=Vulkan` (appended automatically) and a display (`xvfb-run`) on CI.
- **Node 24 LTS (headless):** supported.

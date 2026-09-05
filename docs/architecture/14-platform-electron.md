# 14 · Platform: Browser, Electron, Headless

**Status:** Design standard (pre-1.0) · **Packages:** `@ignifx/core` (platform service, storage), `@ignifx/electron` · **Related:** `05-assets-and-loading.md` §8, `CONSTITUTION.md` §9.2

---

## 1. Platform service (`app.platform`)

`{ kind: "browser" | "electron" | "node", os, isMobile, hasPointerLock, hasGamepads, webgpu: { adapterInfo, features, limits }, locale, reducedMotion }`. Populated at `createApp`; extensions branch on it, game code rarely should.

## 2. Storage (`app.storage`)

```ts
interface Storage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  namespace(name: string): Storage; // "saves", "settings", "input-overrides"
}
```

Backends: IndexedDB (browser), file system through the Electron bridge (`userData/<namespace>/<key>.json`), in-memory (headless, with an optional directory in Node). Values are JSON; large binary saves use `Blob`/`ArrayBuffer` support in both backends. `MigrationHooks` allow key upgrades after 1.0.

## 3. Electron (`@ignifx/electron`)

Three parts, mirroring Electron's process model:

- **Main** (`@ignifx/electron/main`): `createGameWindow({ entry, width, height, fullscreen, frame, webgpu: true })`. Before `app.whenReady()` it appends `enable-unsafe-webgpu` (WebGPU is never default-on in Electron; Chrome's default-on comes from a server-side rollout Electron does not receive) and, on Linux, `enable-features=Vulkan`. Window options enforce `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a strict CSP; deviations require an ADR (`CONSTITUTION.md` §9.2). It registers the `ignifx://` protocol that serves packaged assets so the same manifest and loaders work unchanged, and forwards `minimize/restore/focus/blur` to the renderer.
- **Preload** (`@ignifx/electron/preload`, `.mjs`): `contextBridge.exposeInMainWorld("ignifxHost", { storage, paths, window, dialogs, version })` with a typed, versioned IPC surface (`invoke`-based, no raw `ipcRenderer` exposure).
- **Renderer** (`electron()` extension): detects `window.ignifxHost`, installs the file-system storage backend, sets `app.platform.kind = "electron"`, wires window events to `onApplicationPause/Focus`, and exposes `app.desktop` (`setFullscreen`, `setWindowTitle`, `quit`, `showOpenDialog`, `openExternal`).

Packaging: `electron-vite` for dev/build (main, preload, renderer projects) and `electron-builder` for installers. Each game template has a `desktop/` variant produced by `create-ignifx --desktop`. Auto-update and code signing recipes are documented after 1.0. Electron majors ship every eight weeks and only the last three receive security fixes; the plan schedules a quarterly Electron bump.

## 4. Browser

- Capability page: templates ship a static fallback (`webgpu-unsupported.html` content) shown when `createApp` rejects with `IgnifxError` code `IGX-0701` (WebGPU unavailable).
- Headers: `SharedArrayBuffer` is not required by the MVP (no threaded physics), so no COOP/COEP headers are needed; if a future extension needs them the Vite plugin adds dev-server headers and documents hosting requirements.
- Mobile: supported where WebGPU is (Chrome Android on qualifying GPUs, Safari 26+); touch input and `VirtualJoystick` cover controls; `resolutionScale` and `maxDevicePixelRatio` handle performance.

## 5. Headless (Node)

`createApp({ headless: true })` uses Lite's null engine, the memory/file storage backend, stub input and audio, and Node `fetch`/`fs` for assets. Used by unit tests, CI, tooling (`ignifx bake`, `ignifx validate`), and future authoritative servers.

## 6. Supported matrix (to be re-verified at each release)

| Platform                                             | Status                                                   |
| ---------------------------------------------------- | -------------------------------------------------------- |
| Chrome / Edge 113+ (desktop)                         | Supported                                                |
| Safari 26+ (macOS 26, iOS/iPadOS 26)                 | Supported                                                |
| Firefox 141+ Windows, 145+ macOS Apple Silicon       | Supported; Linux/Android Firefox pending upstream WebGPU |
| Chrome Android 121+ (Android 12+, Qualcomm/ARM GPUs) | Supported, reduced budgets                               |
| Electron 44+ (current stable)                        | Supported with the flags above; Linux best-effort        |
| Node 24 LTS (headless)                               | Supported                                                |

---
name: electron
description: Ships an ignifx game as an Electron desktop app with @ignifx/electron: the main-process window factory that enables WebGPU, a typed and sandboxed preload bridge, the ignifx:// asset protocol, the file-system storage backend, and the renderer-side extension that exposes app.desktop. Use when packaging, configuring, or debugging an ignifx desktop build, or when the user mentions @ignifx/electron, createGameWindow, the preload bridge, or desktop templates.
license: Apache-2.0
metadata:
  ignifx-version: "0.0.0-unreleased"
---

# @ignifx/electron

## What this is / when to use

The Electron half of ignifx. It turns a game that already runs in a browser into a desktop app, without a second copy of the game: one renderer bundle serves both builds.

Three entry points, one per Electron process:

| Import                     | Runs in  | Gives you                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------- |
| `@ignifx/electron`         | renderer | the `electron()` extension and `app.desktop`                                    |
| `@ignifx/electron/main`    | main     | `createGameWindow`, the `ignifx://` protocol, the WebGPU switches, IPC handlers |
| `@ignifx/electron/preload` | preload  | `exposeIgnifxHost()` — the one call the preload script makes                    |

Use it when you are packaging a game, or debugging one that behaves differently on the desktop.

## Environment

Engine `>=0.0.0 <1.0.0` · Electron 44.x (peer, optional) · Babylon Lite 1.27.0 through `@ignifx/core`.

The fastest way in is the scaffolder — it writes everything below for you:

```sh
npx @ignifx/cli my-game --template 3d-third-person --desktop
cd my-game && pnpm install && pnpm dev:desktop
```

## Mental model

```
main process                       renderer (sandboxed, context-isolated)
────────────                       ──────────────────────────────────────
applyWebGpuSwitches()   ─┐
registerIgnifxScheme()   │ before app.whenReady()
                        ─┘
await app.whenReady()
serveIgnifxProtocol(dir) ──────►   ignifx://app/index.html   (secure origin)
createGameWindow({…})    ──────►   window, strict CSP header
installHostHandlers({window})
        ▲                                  │
        └────── ipcMain.handle ◄─── preload: exposeIgnifxHost()
                                           │  window.ignifxHost
                                           ▼
                                    electron() extension
                                      → app.platform.kind = "electron"
                                      → app.storage on the file system
                                      → app.desktop
```

The renderer never imports `electron`. It has no Node, no `require`, and no module system — `window.ignifxHost` is the entire interface, and `electron()` is what turns it into `app.desktop` and a `StorageBackend`.

## First app

**`desktop/main.ts`** — the Electron entry. The order is Chromium's, not a preference: a switch appended after `whenReady` is inert, and the symptom is `navigator.gpu === undefined` with no error anywhere.

<!-- `ignore-check`: main-process code. The docs harness compiles snippets against a DOM-only
     project with no Node types and no `electron` module, which is exactly the environment this
     file must never run in. It is compiled for real by each template's `tsconfig.desktop.json`. -->

```ts ignore-check
import { join } from "node:path";
import {
  applyWebGpuSwitches,
  createGameWindow,
  installHostHandlers,
  registerIgnifxScheme,
  serveIgnifxProtocol,
} from "@ignifx/electron/main";
import { app } from "electron";

const DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"];

applyWebGpuSwitches();
registerIgnifxScheme();

await app.whenReady();
if (DEV_SERVER_URL === undefined) {
  serveIgnifxProtocol(join(import.meta.dirname, "../renderer"));
}
const window = createGameWindow({
  entry: DEV_SERVER_URL ?? "index.html",
  preload: join(import.meta.dirname, "../preload/index.cjs"),
  width: 1600,
  height: 900,
  title: "My Game",
});
installHostHandlers({ window });
```

**`desktop/preload.ts`** — two lines, and it must be built to CommonJS (see Gotchas).

<!-- `ignore-check`: preload-process code; see the note above. -->

```ts ignore-check
import { exposeIgnifxHost } from "@ignifx/electron/preload";

exposeIgnifxHost();
```

**`src/main.ts`** — the game, unchanged apart from one extension:

```ts
import { createApp } from "@ignifx/core";
import { electron } from "@ignifx/electron";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("the game needs a <canvas> on the page");
}

const app = await createApp({
  canvas,
  // First in the list: it only needs core, and `app.storage` should be the file backend before
  // anything else reads a setting from it. A real game adds physics(), input(), audio() and the
  // rest of its extensions after it.
  extensions: [electron()],
});

app.log.info("desktop:", app.desktop.isElectron);
```

Register `electron()` **unconditionally**. Without a preload bridge it logs one debug line and gives you an `app.desktop` that answers `isElectron === false`, so the browser build is unchanged.

## Core APIs

### `app.desktop`

| Member                                 | Does                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `isElectron`                           | The only member that answers in a browser build. Branch on it.                                       |
| `versions`                             | `{ electron, chrome, node }`, or `null` in a browser build.                                          |
| `onWindowEvent`                        | `Signal<"minimize" \| "restore" \| "focus" \| "blur" \| "enter-full-screen" \| "leave-full-screen">` |
| `paths()`                              | `{ userData, appData, temp, home, downloads, documents, appPath }`                                   |
| `setFullscreen(on)` / `isFullscreen()` | Full screen.                                                                                         |
| `setWindowTitle(title)`                | The window title.                                                                                    |
| `quit()`                               | Closes the window and quits.                                                                         |
| `showOpenDialog(options?)`             | `{ canceled, paths }`. Options are booleans, not Electron's `properties`.                            |
| `openExternal(url)`                    | `https:` and `mailto:` only; anything else rejects with `IGX-1464`.                                  |

Everything but `isElectron` and `versions` rejects with `IGX-1462` in a browser build.

### `@ignifx/electron/main`

| Symbol                                   | Does                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `applyWebGpuSwitches()`                  | `enable-unsafe-webgpu`, plus `enable-features=Vulkan` on Linux. **Before `whenReady`.** |
| `registerIgnifxScheme()`                 | `ignifx://` as standard + secure + fetchable + streamable. **Before `whenReady`.**      |
| `serveIgnifxProtocol(dir)`               | Serves a directory; returns a function that stops it. **After `whenReady`.**            |
| `createGameWindow(options)`              | The window, hardened. Returns a `BrowserWindow`.                                        |
| `installHostHandlers({ window })`        | The IPC handlers; returns a function that removes them.                                 |
| `windowOptionsFor(options)` / `cspFor()` | Pure builders, so a test can assert the security options.                               |
| `FileStorage`                            | The file-system store, in `@ignifx/core`'s own on-disk layout.                          |

### `app.storage` on the desktop

Unchanged API, different backend: `userData/<namespace>/<encoded key>.json` (or `.bin`), written through a temporary file and a `rename` so a crash leaves the whole old value or the whole new one. The names are byte-identical to `@ignifx/core`'s Node file backend, so the same save file reads back outside Electron.

## Recipes

### Building and shipping

| Command              | Does                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `pnpm dev:desktop`   | `electron-vite dev` — the game in a window, hot reload in the renderer. |
| `pnpm build:desktop` | `electron-vite build` — `out/{main,preload,renderer}`.                  |
| `pnpm dist:desktop`  | `electron-builder --dir` — an unpacked, **unsigned** app in `release/`. |

Add `--mac`, `--win`, or `--linux` to `electron-builder` for a real installer, on a runner of that platform: cross-compilation is not available for most targets. Code signing, notarization, and auto-update are documented after 1.0.

**Per-OS caveats.** macOS arm64 is verified end to end. Windows is NSIS (Squirrel needs `electron-winstaller`, whose install script this repository does not allow) and is **configuration only** — written, never built. Linux is likewise configuration only; it needs `enable-features=Vulkan`, which `applyWebGpuSwitches` appends, and a display (`xvfb-run`) on CI.

## File formats

None of its own. It serves whatever `@ignifx/vite-plugin` built — the manifest and the content-hashed assets — over `ignifx://`, unchanged.

## Gotchas

| Trap                                                                                                                                                                                                           | Use instead                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Building the preload script as an ES module. Under `sandbox: true` — which `CONSTITUTION.md` §9.2 fixes — `window.ignifxHost` is silently `undefined`, with no error anywhere.                                 | Build `desktop/preload.ts` with `format: "cjs"` and the file name `index.cjs`. The templates' `electron.vite.config.ts` already does. |
| Calling `applyWebGpuSwitches()` or `registerIgnifxScheme()` after `app.whenReady()`. Both are inert, and the symptom is no `navigator.gpu`.                                                                    | Call both at the top of `desktop/main.ts`, before the `whenReady` await.                                                              |
| Loading the packaged renderer over `file://`. Opaque origin: no secure context, so no WebGPU; `'self'` matches nothing; relative `fetch` fails.                                                                | `serveIgnifxProtocol(dir)` and `entry: "index.html"`.                                                                                 |
| Expecting `onApplicationPause` when the window is minimised. An Electron renderer receives **no** DOM lifecycle events — no `visibilitychange`, no window `focus`/`blur`, and `document.hidden` never changes. | `onApplicationFocus` works (`electron()` forwards it). For minimise, subscribe to `app.desktop.onWindowEvent`.                        |
| Expecting device-loss recovery with PCF or CSM shadows. Babylon Lite 1.27.0 rebuilds **only** ESM directional shadow generators; anything else fails recovery and the frame loop stops.                        | `light.shadows.technique = "esm"` on a game that must survive a lost device.                                                          |
| Importing `@ignifx/electron/main` from the renderer. It pulls `electron` and Node built-ins into a bundle that has neither.                                                                                    | Import the root `@ignifx/electron` in the renderer; `/main` and `/preload` belong to their own processes.                             |
| Expecting `webContents.getWebPreferences()`. It does not exist in Electron 44.                                                                                                                                 | `getLastWebPreferences()` exists at runtime (though not in `electron.d.ts`), or assert `windowOptionsFor(...)` — it is pure.          |
| Scaffolding with `--desktop` you did not want. The three Electron build tools are large binary downloads.                                                                                                      | Leave `--desktop` off; the scaffold stays browser-only and `electron()` is still there, inert.                                        |

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `docs/architecture/14-platform-electron.md` for the design · `docs/adr/0018-electron-tooling.md` for what the S9.1 spike measured, and for what is still unverified.

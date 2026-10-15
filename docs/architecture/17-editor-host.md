# 17 · Editor Host

**Status:** Design standard (pre-1.0) · **Packages:** `@ignifx/editor-host` · **Related:** `00-overview.md` §2, `15-devtools-and-diagnostics.md` §5, `14-platform-electron.md` §3; in `astrum-forge/ignifx-editor`: the editor plan §3.1–§3.6 and §5 (ask E0), ADR-E001, ADR-E008, spike S0.1

---

## 1. What it is

The ignifx editor (a separate application, `astrum-forge/ignifx-editor`) never bundles the engine. It runs the **project's own** engine instead: it starts the project's Vite dev server and embeds two pages from it in `<iframe>`s.

- The **scene view** is `/__ignifx_editor__/`, a page this package's Vite plugin adds. Its module creates an app from the project's `@ignifx/core`, with the project's extensions and scripts.
- The **play view** is the project's own `index.html`, unchanged, plus one call in `main.ts` that hands the app to the editor in development.

Both pages import the project's single copy of `@ignifx/core`, so a project script's `Component` is the same class the host sees, and the engine version is whatever the project installed. The editor talks to each page over a versioned JSON-RPC protocol on a `MessagePort`.

`@ignifx/editor-host` is an extension-layer package beside `@ignifx/devtools` (`00-overview.md` §2.1). It imports `@ignifx/core`, and its Vite entry imports `@ignifx/vite-plugin`'s module ids; both are peer dependencies, so the project's copies are the ones used. A project adds it as a development dependency at the same version as its `@ignifx/core`. It is on the engine's version line, not the editor's.

This release is the first slice: the page, the handshake, liveness, and the play controls. It has no `src/lite/**` and no Babylon Lite import.

## 2. Two entries

| Entry                        | Runs in                                 | Exports                                                                                         |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@ignifx/editor-host`        | The scene view and the play view (page) | `startEditorHost`, `startEditorPlayControls`, the protocol types and constants, the error codes |
| `@ignifx/editor-host/vite`   | The dev server's Node process           | `editorHostPlugin`, the module ids, and the source generators the plugin uses                   |
| `@ignifx/editor-host/client` | Type checking only                      | The ambient declaration of `virtual:ignifx/editor`                                              |

Importing either entry does nothing (`CONSTITUTION.md` §3.5). The only code with an import-time effect is the module the plugin generates for the scene view's page, which calls `startEditorHost`.

## 3. The Vite plugin

`editorHostPlugin({ editorOrigin, extensions?, bootScene?, heartbeatIntervalMs? })` returns two plugins. List them after `ignifx()` from `@ignifx/vite-plugin`, which serves `virtual:ignifx/scripts` and `virtual:ignifx/manifest`.

**`ignifx-editor-host`** (`apply: "serve"`, so a build never contains the scene view):

- A connect middleware, registered directly in `configureServer` so it answers before Vite's HTML fallback, serves `<base>__ignifx_editor__/` through `server.transformIndexHtml` (which adds Vite's HMR client) and redirects the path without its trailing slash. Every other request goes to Vite untouched.
- The page loads `virtual:ignifx/editor-host-entry`, a generated module that imports `startEditorHost` from `@ignifx/editor-host`, `scripts` and `acceptHotReload` from `virtual:ignifx/scripts`, `manifest` from `virtual:ignifx/manifest`, and `extensions` from the project's extensions module. It passes `import.meta.env.IGNIFX_CONFIG` as the settings, exactly as a template's `main.ts` does, then calls `acceptHotReload(host.app)`. Every bare import resolves from the project root, so the host joins the project's module graph.
- **The extensions seam.** A template builds its extension list inline in `main.ts`, where nothing else can import it. The plugin imports `extensions()` from `src/extensions.ts` (the `extensions` option changes the path) when that file exists, and passes no extensions when it does not. The editor-ready templates (ask E2) move the list there so `main.ts` and the scene view share it.
- **Pre-bundling.** Setting `optimizeDeps.entries` replaces Vite's default crawl of every HTML file, and Vite concatenates arrays when it merges a plugin's config. So when the extensions module exists, the plugin adds it to `entries`, restating `**/*.html` only if the project set no entries of its own. It also adds `@ignifx/editor-host` to `optimizeDeps.exclude`: served as it is, its `@ignifx/core` import resolves to the same pre-bundled core the game uses, rather than a second copy inside a pre-bundled host.
- **The engine version.** Core's `VERSION` constant is `"0.0.0"` in every build today; nothing stamps it. The plugin reads `version` from the project's resolved `@ignifx/core/package.json` and passes it to the host as `engineVersion`. The host reports core's `VERSION` instead once it is stamped.

**`ignifx-editor-host:play-controls`** (every command) serves `virtual:ignifx/editor`. Under `vite dev` it exports `attachEditorPlayControls(app)`, which calls `startEditorPlayControls(app, …)` and disposes the controls when Vite replaces the module; the `import.meta.hot` calls are written out literally, because Vite finds them by reading the source. Under `vite build` it exports an empty function and imports nothing — the same shape as `acceptHotReload` (`15-devtools-and-diagnostics.md` §5). A project whose `main.ts` imports `virtual:ignifx/editor` therefore needs the plugin in `vite.config.ts` for both commands.

## 4. The scene view's host

`startEditorHost(options)` opens the channel **before its first `await`** (the editor posts the port on the iframe's `load` event, which can fire while `createApp` is still running), then creates the app with the project's extensions, settings and manifest, calls `app.registerComponents(scripts)`, loads `bootScene` through `app.world.loadScene` if one is given, and starts the app. It resolves to an `EditorHost` handle that owns the app: `dispose()` stops the heartbeat, closes the port, removes the window listener and disposes the app. If creation, the scene load or `start()` fails, the channel is closed and the error is rethrown.

The app is reached only through that handle, which lives in the generated module's scope. Nothing is global, so two apps (the scene view and the play view) stay independent even when Chromium puts both documents in one process (`CONSTITUTION.md` §3.6).

## 5. The play view

The game's `main.ts` calls `attachEditorPlayControls(app)` from `virtual:ignifx/editor`; the app stays reachable only through the entry's own reference. `startEditorPlayControls` never disposes the game's app. It answers four methods after the handshake, each with `{ isRunning, isPaused, frameCount }`:

| Method  | Effect                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `play`  | Clears `app.time.paused` and calls `app.start()` (a no-op when running)                                                  |
| `pause` | Sets `app.time.paused`; `updateWhenPaused` scripts and systems keep running                                              |
| `step`  | `app.stop()`, then one `app.step(deltaSeconds)` unpaused, then paused again; `deltaSeconds` defaults to `fixedDeltaTime` |
| `stop`  | `app.stop()`. The editor resets the game by reloading the view                                                           |

`app.step()` refuses to run beside the render loop, which is why `step` stops the loop first; `play` restarts it.

## 6. The protocol

The host speaks protocol **0.1** of `@ignifx/editor-protocol`, which the editor repository publishes on its own version line (ADR-E008). Until that package is on npm, `src/protocol.ts` is a copy of its `rpc.ts`, `handshake.ts` and `version.ts`, kept identical; afterwards the host depends on it.

1. **Connect.** The editor posts `{ type: "ignifx-editor/connect" }` to the view's window with a `MessagePort` as the one transferred object. The host accepts it only when `event.origin` equals `editorOrigin` (§7). A view reload is a new document that needs a new port, and the editor sends a fresh one on every `load`; the host also accepts a new port at any time, closing the previous one and stopping its heartbeat.
2. **Handshake.** The editor sends `hello { editorVersion, protocol }`. A host whose protocol major matches answers `ready { engineVersion, protocol, capabilities, hostKind }`; otherwise it answers `incompatibleProtocol` with its own version in `data`. Malformed parameters get `invalidParams`.
3. **Liveness.** `ping` is answered with `"pong"` at any time. After `ready`, the host sends a `heartbeat` notification every `heartbeatIntervalMs` (default 1000). Chromium reports nothing to the parent when an out-of-process iframe's renderer dies, so a stopped heartbeat is how the editor finds a dead view.
4. **Everything else.** A method the host does not have gets `methodNotFound`; a known method before `hello` gets `notReady`; a message that is not a JSON-RPC envelope gets `invalidRequest` with `id: null`. A failing method gets `internalError`, with the `IgnifxError` code in `data.code` when there is one.

The connect message, `heartbeat`, the capability names (`heartbeat`, `playControls`) and the play methods are not in protocol 0.1 yet. They are declared in `src/messages.ts` and proposed for the next protocol minor.

## 7. Security

The host page drives a live engine, so two independent checks keep other pages away from it:

- **`frame-ancestors`.** The scene view is served with `Content-Security-Policy: frame-ancestors <editorOrigin>`. A website the developer has open cannot frame `127.0.0.1:<port>/__ignifx_editor__/`. Vite sends no policy on the play view, the project's own `index.html`; the plugin leaves it unchanged.
- **The origin check.** Both hosts ignore a connect message whose `event.origin` is not exactly `editorOrigin`, so only the editor can hand either view a port, framed or not.

`editorOrigin` must be `scheme://host[:port]` with no path, wildcard, quote, comma or semicolon (`IGX-1801`), which also keeps it from ending the CSP directive early. The editor passes it when it spawns the dev server; it differs between the packaged editor (`ignifx://app`) and the editor's own development server, so it is never hard-coded. Keep the dev server on loopback. Production builds contain no host code at all.

## 8. Errors

The package owns `IGX-1800`–`IGX-1899`. `IGX-1801`: `editorOrigin` is not an origin. `IGX-1802`: no `window` and no `messageTarget` (Node). `IGX-1803`: an option outside its domain. The page half throws `IgnifxError`; the Vite plugin throws `EditorHostPluginError` with the same codes, because it runs without `@ignifx/core`, as `@ignifx/vite-plugin` does.

## 9. Not in this release

- **Edit mode** (ask E1): `createApp({ editMode: true })`, so the scene view runs no script callbacks, physics or coroutines. Until then the scene view runs the game's scripts.
- **Document ops, gizmos, editor cameras, picking and screenshots** (editor Phase 2, with asks E3 and E4): the scene view has no methods beyond the handshake yet.
- **Editor-ready templates** (ask E2): `src/extensions.ts`, scenes as files, and no static imports of `src/scripts/**` from `main.ts`, without which a script edit reloads both views.
- **Script hot reload in the scene view** depends on `virtual:ignifx/scripts` becoming a real HMR boundary, a separate `@ignifx/vite-plugin` fix.

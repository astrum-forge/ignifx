# @ignifx/electron

`@ignifx/electron/main` public barrel: the Electron main-process surface — the game window
factory that turns WebGPU on, the `ignifx://` protocol that serves packaged assets, the typed IPC
handlers behind the preload bridge, and the file-system store `app.storage` writes through
(`docs/architecture/14-platform-electron.md` §3).

This entry imports `electron` and Node built-ins. A renderer bundle must never reach it; the
renderer's half of the package is the root export.

The ordering the main process must follow is a property of Chromium's initialisation, not of this
package:

```ts
import { app } from "electron";
import { applyWebGpuSwitches, createGameWindow, installHostHandlers, registerIgnifxScheme,
  serveIgnifxProtocol } from "@ignifx/electron/main";

applyWebGpuSwitches();   // before whenReady: a switch appended later is inert
registerIgnifxScheme();  // before whenReady: privileges are read while the net stack is built
await app.whenReady();
serveIgnifxProtocol(rendererDirectory);
const window = createGameWindow({ entry: "index.html", preload });
installHostHandlers({ window });
```

## Classes

### FileStorage

The file-system store a desktop build's `app.storage` is backed by.

#### Remarks

It is not itself a `StorageBackend`: that contract is a renderer-side interface, and this object
lives in the main process behind the IPC bridge. `renderer/storage-backend.ts` holds the
`StorageBackend` that calls it.

#### Example

```ts
const storage = new FileStorage(app.getPath("userData"));
await storage.set("saves", "slot1", { kind: "json", json: '{"level":3}' });
await storage.keys("saves"); // ["slot1"]
```

#### Constructors

##### Constructor

> **new FileStorage**(`root`): [`FileStorage`](#filestorage)

Builds a store rooted at a directory.

###### Parameters

###### root

`string`

The `userData` directory, from `app.getPath("userData")`.

###### Returns

[`FileStorage`](#filestorage)

#### Properties

##### root

> `readonly` **root**: `string`

The `userData` directory every namespace hangs below.

#### Methods

##### clear()

> **clear**(`namespace`): `Promise`\<`void`\>

Removes every value of one namespace, leaving other namespaces untouched.

###### Parameters

###### namespace

`string`

The namespace path.

###### Returns

`Promise`\<`void`\>

A promise that settles once the namespace is empty.

###### Remarks

The value files are removed rather than the directory, so a nested namespace — `saves/coop`
under `saves` — survives its parent being cleared, which rule 7 requires.

##### delete()

> **delete**(`namespace`, `key`): `Promise`\<`void`\>

Removes one value under either extension.

###### Parameters

###### namespace

`string`

The namespace path.

###### key

`string`

The key inside it.

###### Returns

`Promise`\<`void`\>

A promise that settles once the value is gone.

##### get()

> **get**(`namespace`, `key`): `Promise`\<[`HostStoredValue`](#hoststoredvalue) \| `null`\>

Reads one value.

###### Parameters

###### namespace

`string`

The namespace path.

###### key

`string`

The key inside it.

###### Returns

`Promise`\<[`HostStoredValue`](#hoststoredvalue) \| `null`\>

The stored value, or `null` when there is none.

##### keys()

> **keys**(`namespace`, `prefix?`): `Promise`\<readonly `string`[]\>

Lists the keys of one namespace.

###### Parameters

###### namespace

`string`

The namespace path.

###### prefix?

`string`

When given, only keys starting with it are returned.

###### Returns

`Promise`\<readonly `string`[]\>

The matching keys, sorted ascending; `[]` for an unknown namespace.

##### set()

> **set**(`namespace`, `key`, `value`): `Promise`\<`void`\>

Writes one value, replacing whatever was there under either extension.

###### Parameters

###### namespace

`string`

The namespace path, created on demand.

###### key

`string`

The key inside it.

###### value

[`HostStoredValue`](#hoststoredvalue)

The JSON text or the octets to persist.

###### Returns

`Promise`\<`void`\>

A promise that settles once the value is durable.

## Interfaces

### ByteRange

One byte range, resolved against a known file size.

#### Properties

##### end

> `readonly` **end**: `number`

The last byte served, inclusive.

##### start

> `readonly` **start**: `number`

The first byte served, inclusive.

***

### CommandLineLike

The subset of `app.commandLine` [applyWebGpuSwitches](#applywebgpuswitches) touches.

#### Remarks

An interface rather than the Electron type, so the unit suite can record the calls without an
Electron process. `app.commandLine.appendSwitch` is `electron.d.ts` 7112.

#### Methods

##### appendSwitch()

> **appendSwitch**(`the_switch`, `value?`): `void`

Appends a switch to Chromium's command line.

###### Parameters

###### the\_switch

`string`

The switch name, without leading dashes.

###### value?

`string`

The switch's value, when it takes one.

###### Returns

`void`

***

### CspOptions

What [cspFor](#cspfor) accepts.

#### Properties

##### connectSources?

> `readonly` `optional` **connectSources?**: readonly `string`[]

Extra origins added to `connect-src`, for a game that talks to a backend.

###### Default Value

`[]` — a desktop build reaches nothing but itself.

##### devServerOrigin?

> `readonly` `optional` **devServerOrigin?**: `string` \| `null`

The dev server's origin, for example `"http://localhost:5173"`. Only consulted when `mode` is
`"development"`, where it is added to `default-src`, `script-src`, `style-src`, `img-src`,
`media-src`, `font-src`, and `connect-src`, and its `ws:`/`wss:` twin is added to
`connect-src` so that hot reload's socket connects.

###### Default Value

`null` — no dev server.

##### mode?

> `readonly` `optional` **mode?**: `"production"` \| `"development"`

Where the renderer is loaded from.

###### Default Value

`"production"` — the packaged `ignifx://app` origin and nothing else.

##### wasm?

> `readonly` `optional` **wasm?**: `boolean`

Whether `script-src` carries `'wasm-unsafe-eval'`.

###### Default Value

`true` — the physics extensions need it, and it does not permit `eval`.

***

### GameWindowOptions

What [createGameWindow](#creategamewindow) and [windowOptionsFor](#windowoptionsfor) accept.

#### Properties

##### backgroundColor?

> `readonly` `optional` **backgroundColor?**: `string`

The colour painted before the first frame, which is what the user sees instead of a white
flash.

###### Default Value

`"#000000"`

##### csp?

> `readonly` `optional` **csp?**: `string` \| [`CspOptions`](#cspoptions) \| `null`

The Content-Security-Policy header value, or the options to build one from, or `null` to inject
none (for a host that already sends its own).

###### Default Value

the policy `cspFor()` builds, in development mode when `entry` is an `http(s):`
URL.

##### entry

> `readonly` **entry**: `string`

What the window loads.

###### Remarks

A bare document name such as `"index.html"` is served over `ignifx://app`, which is what a
packaged build wants. An absolute `http://` or `https://` URL is loaded as given, which is what
`electron-vite dev` needs while the renderer lives on a dev server.

##### externalProtocols?

> `readonly` `optional` **externalProtocols?**: readonly `string`[]

Protocols `shell.openExternal` may hand to the OS.

###### Default Value

[DEFAULT\_EXTERNAL\_PROTOCOLS](#default_external_protocols)

##### frame?

> `readonly` `optional` **frame?**: `boolean`

Whether the window has the platform's frame and title bar.

###### Default Value

`true`

##### fullscreen?

> `readonly` `optional` **fullscreen?**: `boolean`

Whether the window opens full screen.

###### Default Value

`false`

##### height?

> `readonly` `optional` **height?**: `number`

Window height in logical pixels.

###### Default Value

`720`

##### icon?

> `readonly` `optional` **icon?**: `string`

Absolute path of the window icon, where the platform uses one.

##### minHeight?

> `readonly` `optional` **minHeight?**: `number`

Smallest height the user may drag to.

###### Default Value

`360`

##### minWidth?

> `readonly` `optional` **minWidth?**: `number`

Smallest width the user may drag to.

###### Default Value

`640`

##### preload

> `readonly` **preload**: `string`

Absolute path of the preload script. Must be CommonJS — see the module comment.

##### show?

> `readonly` `optional` **show?**: `boolean`

Whether the window is shown immediately.

###### Default Value

`false` — [createGameWindow](#creategamewindow) shows it on `ready-to-show`, which is what
removes the blank-window flash.

##### title?

> `readonly` `optional` **title?**: `string`

The window title.

###### Default Value

`"ignifx"`

##### webgpu?

> `readonly` `optional` **webgpu?**: `boolean`

Whether WebGPU is expected. Only documentation today: the switch that turns WebGPU on is a
process-wide command-line switch applied by `applyWebGpuSwitches` before `app.whenReady()`,
not a per-window preference.

###### Default Value

`true`

##### width?

> `readonly` `optional` **width?**: `number`

Window width in logical pixels.

###### Default Value

`1280`

***

### HostFileFilter

One file-type row of an open dialog.

#### Properties

##### extensions

> `readonly` **extensions**: readonly `string`[]

Extensions without a leading dot, for example `["sav", "json"]`.

##### name

> `readonly` **name**: `string`

The row's label, for example `"Saved games"`.

***

### HostHandlerOptions

What [installHostHandlers](#installhosthandlers) accepts.

#### Properties

##### entry?

> `readonly` `optional` **entry?**: `string`

The same `entry` the window was created with, so a development build's dev-server origin is
accepted by the sender check as well as the packaged `ignifx://app` one.

###### Default Value

`undefined` — only `ignifx://app` may call.

##### externalProtocols?

> `readonly` `optional` **externalProtocols?**: readonly `string`[]

Protocols `shell.openExternal` may hand to the OS.

###### Default Value

`DEFAULT_EXTERNAL_PROTOCOLS`

##### origins?

> `readonly` `optional` **origins?**: readonly `string`[]

The origins the game window's document may invoke from, overriding what `entry` implies.

###### Default Value

[allowedSenderOrigins](#allowedsenderorigins) of `entry`.

##### storage?

> `readonly` `optional` **storage?**: [`FileStorage`](#filestorage)

Where `app.storage` writes.

###### Default Value

a [FileStorage](#filestorage) rooted at `app.getPath("userData")`.

##### window

> `readonly` **window**: `BrowserWindow`

The game window the window controls and the dialogs act on.

###### Remarks

Captured rather than derived from the IPC event's sender, so a handler cannot be talked into
acting on some other window.

***

### HostOpenDialogOptions

What `HostDialogs.showOpenDialog` accepts. A deliberate subset of Electron's
`OpenDialogOptions` (`electron.d.ts` 15318): everything here is a plain value, so nothing about
the main process leaks into the renderer's types.

#### Properties

##### buttonLabel?

> `readonly` `optional` **buttonLabel?**: `string`

The confirm button's label.

##### defaultPath?

> `readonly` `optional` **defaultPath?**: `string`

The directory the dialog opens in.

##### directories?

> `readonly` `optional` **directories?**: `boolean`

Whether directories may be chosen. Defaults to `false`.

##### files?

> `readonly` `optional` **files?**: `boolean`

Whether files may be chosen. Defaults to `true`.

##### filters?

> `readonly` `optional` **filters?**: readonly [`HostFileFilter`](#hostfilefilter)[]

The file-type rows.

##### multiple?

> `readonly` `optional` **multiple?**: `boolean`

Whether more than one entry may be chosen. Defaults to `false`.

##### title?

> `readonly` `optional` **title?**: `string`

The dialog's title, where the platform shows one.

***

### HostOpenDialogResult

What an open dialog returned.

#### Properties

##### canceled

> `readonly` **canceled**: `boolean`

Whether the user dismissed the dialog.

##### paths

> `readonly` **paths**: readonly `string`[]

The absolute paths chosen; empty when the dialog was dismissed.

***

### HostPaths

The directories a desktop build is allowed to know about, resolved once at startup.

#### Remarks

Read-only strings, not handles: a game that wants to *write* somewhere uses `app.storage`, which
goes through the same bridge and cannot escape `userData`.

#### Properties

##### appData

> `readonly` **appData**: `string`

The platform's roaming application-data directory.

##### appPath

> `readonly` **appPath**: `string`

The directory the packaged application resources were loaded from.

##### documents

> `readonly` **documents**: `string`

The current user's documents directory, or `""` where the platform has none.

##### downloads

> `readonly` **downloads**: `string`

The current user's downloads directory, or `""` where the platform has none.

##### home

> `readonly` **home**: `string`

The current user's home directory.

##### temp

> `readonly` **temp**: `string`

The platform's temporary directory.

##### userData

> `readonly` **userData**: `string`

The per-user, per-app directory Electron gives the app; where `app.storage` lives.

***

### SenderIdentity

As much of an IPC sender as the trust decision depends on.

#### Remarks

A plain record rather than the `IpcMainInvokeEvent` itself, so [isTrustedSender](#istrustedsender) is pure
and the unit suite can state each of the three ways a sender fails without an Electron process.

#### Properties

##### isGameWindow

> `readonly` **isGameWindow**: `boolean`

Whether the message came from the game window's own `WebContents`.

##### isMainFrame

> `readonly` **isMainFrame**: `boolean`

Whether the frame is the top frame of its document tree, rather than an embedded one.

##### origin

> `readonly` **origin**: `string` \| `null`

The frame's origin, or `null` when the frame is gone or has an opaque origin.

## Type Aliases

### HostStoredValue

> **HostStoredValue** = \{ `json`: `string`; `kind`: `"json"`; \} \| \{ `bytes`: `Uint8Array`; `kind`: `"bytes"`; \}

A stored value as it crosses the bridge: the wire form of `@ignifx/core`'s `StoredValue`
(`docs/architecture/14-platform-electron.md` §2).

#### Union Members

##### Type Literal

\{ `json`: `string`; `kind`: `"json"`; \}

###### json

> `readonly` **json**: `string`

The canonical JSON text of the value.

###### kind

> `readonly` **kind**: `"json"`

Discriminant: this value is JSON text.

***

##### Type Literal

\{ `bytes`: `Uint8Array`; `kind`: `"bytes"`; \}

###### bytes

> `readonly` **bytes**: `Uint8Array`

The octets. May be empty.

###### kind

> `readonly` **kind**: `"bytes"`

Discriminant: this value is a byte array.

***

### HostWindowEvent

> **HostWindowEvent** = `"minimize"` \| `"restore"` \| `"focus"` \| `"blur"` \| `"enter-full-screen"` \| `"leave-full-screen"`

The window lifecycle events the main process forwards to the renderer.

#### Remarks

`minimize`/`restore` and `focus`/`blur` are the four `14-platform-electron.md` §3 names; the
full-screen pair is carried too because `app.desktop.setFullscreen` is asynchronous and a game
that wants to reflect the state in its own menu needs to hear about the platform's own
full-screen gesture as well.

***

### RangeDecision

> **RangeDecision** = \{ `kind`: `"ignored"`; \} \| \{ `kind`: `"unsatisfiable"`; \} \| \{ `kind`: `"range"`; `range`: [`ByteRange`](#byterange); \}

What [parseRangeHeader](#parserangeheader) decided.

#### Remarks

Three outcomes, not two: a header this handler does not implement (multiple ranges, a unit other
than `bytes`) is `"ignored"` and answered with a normal `200`, which RFC 9110 §14.2 explicitly
permits; a syntactically fine header that names bytes past the end of the file is
`"unsatisfiable"` and must be answered `416`.

## Variables

### ALLOWED\_PERMISSIONS

> `const` **ALLOWED\_PERMISSIONS**: readonly `string`[]

The permissions a game window is allowed to ask Chromium for.

#### Remarks

Pointer lock and full screen are the two a game genuinely needs; measured on Electron 44.2.0
(S9.1), `document.body.requestPointerLock` is present in a sandboxed `ignifx://` window and
`navigator.getGamepads()` returns its four slots without any permission at all. Everything else —
the camera, the microphone, geolocation, USB, HID, serial, notifications — is denied, because a
game that has not asked for them has no business being able to prompt for them.

***

### BYTES\_EXTENSION

> `const` **BYTES\_EXTENSION**: `".bin"` = `".bin"`

The extension a byte value is written under.

***

### CSP\_ASSET\_SCHEMES

> `const` **CSP\_ASSET\_SCHEMES**: readonly `string`[]

The protocols a game window may load a subresource from, beyond its own origin.

#### Remarks

`data:` covers the inline fonts and the one-pixel textures a template embeds; `blob:` covers the
object URLs `@ignifx/audio` and the glTF loader create for decoded buffers. Neither can execute
script under this policy, because `script-src` does not list them.

***

### CSP\_DIRECTIVE\_ORDER

> `const` **CSP\_DIRECTIVE\_ORDER**: readonly `string`[]

The directive names [cspFor](#cspfor) emits, in the order it emits them.

#### Remarks

The order is fixed so that two calls with the same options produce byte-identical strings, which
is what lets the security-checklist test compare against a literal.

***

### DEFAULT\_EXTERNAL\_PROTOCOLS

> `const` **DEFAULT\_EXTERNAL\_PROTOCOLS**: readonly `string`[]

The protocols [createGameWindow](#creategamewindow) lets `shell.openExternal` hand to the OS.

#### Remarks

An allow-list, not a deny-list: `file:`, `javascript:`, and every custom protocol some other
installed application registered are all things an `openExternal` call must never reach.

***

### DEFAULT\_WINDOW\_SIZE

> `const` **DEFAULT\_WINDOW\_SIZE**: `Readonly`\<\{ `height`: `number`; `width`: `number`; \}\>

The window size a template opens at when it asks for none.

***

### ENFORCED\_WEB\_PREFERENCES

> `const` **ENFORCED\_WEB\_PREFERENCES**: `Readonly`\<\{ `allowRunningInsecureContent`: `false`; `contextIsolation`: `true`; `enableBlinkFeatures`: `""`; `enableWebSQL`: `false`; `experimentalFeatures`: `false`; `nodeIntegration`: `false`; `nodeIntegrationInSubFrames`: `false`; `nodeIntegrationInWorker`: `false`; `sandbox`: `true`; `spellcheck`: `false`; `webSecurity`: `true`; `webviewTag`: `false`; \}\>

The `webPreferences` every ignifx game window is built with, whatever the caller asked for
(`CONSTITUTION.md` §9.2).

#### Remarks

Exported as data so the security checklist can assert the values without constructing a window.

***

### FORWARDED\_WINDOW\_EVENTS

> `const` **FORWARDED\_WINDOW\_EVENTS**: readonly [`HostWindowEvent`](#hostwindowevent)[]

The `BrowserWindow` events forwarded to the renderer. Electron's own event names and the
contract's are deliberately the same string.

#### Remarks

`restore` is Electron's name for "came back from minimised"; the contract keeps it. The
full-screen pair carries the platform's own full-screen gesture, which `app.desktop.setFullscreen`
would otherwise be the only source of.

***

### HOST\_CHANNELS

> `const` **HOST\_CHANNELS**: `object`

The IPC channel names the preload script invokes and the main process handles.

#### Type Declaration

##### dialogsShowOpen

> `readonly` **dialogsShowOpen**: `"ignifx:dialogs.showOpenDialog"` = `"ignifx:dialogs.showOpenDialog"`

`dialogs.showOpenDialog(options)`.

##### paths

> `readonly` **paths**: `"ignifx:paths"` = `"ignifx:paths"`

`paths()`.

##### shellOpenExternal

> `readonly` **shellOpenExternal**: `"ignifx:shell.openExternal"` = `"ignifx:shell.openExternal"`

`shell.openExternal(url)`.

##### storageClear

> `readonly` **storageClear**: `"ignifx:storage.clear"` = `"ignifx:storage.clear"`

`storage.clear(namespace)`.

##### storageDelete

> `readonly` **storageDelete**: `"ignifx:storage.delete"` = `"ignifx:storage.delete"`

`storage.delete(namespace, key)`.

##### storageGet

> `readonly` **storageGet**: `"ignifx:storage.get"` = `"ignifx:storage.get"`

`storage.get(namespace, key)`.

##### storageKeys

> `readonly` **storageKeys**: `"ignifx:storage.keys"` = `"ignifx:storage.keys"`

`storage.keys(namespace, prefix)`.

##### storageSet

> `readonly` **storageSet**: `"ignifx:storage.set"` = `"ignifx:storage.set"`

`storage.set(namespace, key, value)`.

##### windowIsFullscreen

> `readonly` **windowIsFullscreen**: `"ignifx:window.isFullscreen"` = `"ignifx:window.isFullscreen"`

`window.isFullscreen()`.

##### windowQuit

> `readonly` **windowQuit**: `"ignifx:window.quit"` = `"ignifx:window.quit"`

`window.quit()`.

##### windowSetFullscreen

> `readonly` **windowSetFullscreen**: `"ignifx:window.setFullscreen"` = `"ignifx:window.setFullscreen"`

`window.setFullscreen(fullscreen)`.

##### windowSetTitle

> `readonly` **windowSetTitle**: `"ignifx:window.setTitle"` = `"ignifx:window.setTitle"`

`window.setTitle(title)`.

#### Remarks

One flat `as const` table rather than a nested one: the values are what both processes must agree
on literally, and a flat table is what a `switch` over channels can be exhaustive against
(coding standards §5.2).

***

### HOST\_CONTRACT\_VERSION

> `const` **HOST\_CONTRACT\_VERSION**: `"1.0.0"` = `"1.0.0"`

The version of this contract that the preload bridge announces as `window.ignifxHost.version`.

#### Remarks

Semver over the *bridge*, not over the package: the renderer refuses a host whose major differs
from its own, because a preload script from a different install is the one thing a packaged app
can genuinely end up with (an `asar` from a previous build, a partially applied update).

***

### HOST\_WINDOW\_EVENT\_CHANNEL

> `const` **HOST\_WINDOW\_EVENT\_CHANNEL**: `"ignifx:window-event"` = `"ignifx:window-event"`

The one main-to-renderer channel: window lifecycle events, pushed rather than polled.

***

### IGNIFX\_HOST\_AUTHORITY

> `const` **IGNIFX\_HOST\_AUTHORITY**: `"app"` = `"app"`

The authority the packaged renderer is served under, so the whole origin reads
`ignifx://app`.

#### Remarks

A privileged `standard` scheme has a real origin, and a real origin is what makes `'self'` in the
Content-Security-Policy mean "the packaged app" rather than nothing at all.

***

### IGNIFX\_ORIGIN

> `const` **IGNIFX\_ORIGIN**: `string`

The origin the packaged renderer runs on: `ignifx://app`.

***

### IGNIFX\_SCHEME

> `const` **IGNIFX\_SCHEME**: `"ignifx"` = `"ignifx"`

The `ignifx://` scheme the packaged renderer is served from.

***

### IGNIFX\_SCHEME\_PRIVILEGES

> `const` **IGNIFX\_SCHEME\_PRIVILEGES**: `Readonly`\<\{ `secure`: `true`; `standard`: `true`; `stream`: `true`; `supportFetchAPI`: `true`; \}\>

The privileges the `ignifx` scheme is registered with.

#### Remarks

The four that matter, in the order `14-platform-electron.md` §3 lists them:

- `standard` — gives the scheme a parsed, hierarchical origin, which is what makes relative URLs
  and `'self'` work. It also normalises `..` segments away in the URL parser before a request is
  ever dispatched.
- `secure` — puts the origin in a secure context, without which there is no `navigator.gpu`.
- `supportFetchAPI` — lets `fetch()` and the asset loaders reach it.
- `stream` — lets media elements range-request it.

***

### JSON\_EXTENSION

> `const` **JSON\_EXTENSION**: `".json"` = `".json"`

The extension a JSON value is written under.

***

### LINUX\_FEATURES\_SWITCH

> `const` **LINUX\_FEATURES\_SWITCH**: `Readonly`\<\{ `name`: `string`; `value`: `string`; \}\>

The switch and value that point Chromium at Vulkan, needed on Linux where the default backend
has no WebGPU implementation.

#### Remarks

**Documented, not verified.** This machine is macOS arm64; the Linux path is written from
Chromium's own flag list and is unverified in this repository until CI runs a Linux desktop job
with a display.

***

### PACKAGED\_ORIGIN

> `const` **PACKAGED\_ORIGIN**: `string` = `IGNIFX_ORIGIN`

The origin `'self'` resolves to in a packaged game window, quoted here so a test can say what it
is asserting.

***

### PROTOCOL\_COMMON\_HEADERS

> `const` **PROTOCOL\_COMMON\_HEADERS**: `Readonly`\<`Record`\<`string`, `string`\>\>

The headers every `ignifx://` response carries, whatever its status.

#### Remarks

`Accept-Ranges: bytes` is what tells a media element it may seek at all, and
`Cross-Origin-Resource-Policy: same-origin` keeps a packaged asset from being pulled into any
other origin that somehow gets loaded.

***

### PROTOCOL\_FALLBACK\_MIME\_TYPE

> `const` **PROTOCOL\_FALLBACK\_MIME\_TYPE**: `"application/octet-stream"` = `"application/octet-stream"`

The type served for an extension the table does not know.

***

### PROTOCOL\_INDEX\_FILE

> `const` **PROTOCOL\_INDEX\_FILE**: `"index.html"` = `"index.html"`

The document served when a request names a directory.

***

### PROTOCOL\_MIME\_TYPES

> `const` **PROTOCOL\_MIME\_TYPES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The MIME type served for each file extension a build can contain.

#### Remarks

An explicit table rather than a lookup library: the set of things `@ignifx/vite-plugin` emits is
known, a wrong `Content-Type` on a `.js` chunk stops a module graph dead, and `.wasm` must be
`application/wasm` or `WebAssembly.instantiateStreaming` refuses it.

***

### QUOTA\_MESSAGE\_PREFIX

> `const` **QUOTA\_MESSAGE\_PREFIX**: `"IGNIFX_STORAGE_QUOTA: "` = `"IGNIFX_STORAGE_QUOTA: "`

The marker a main-process quota failure is re-thrown with, so the renderer can tell `IGX-1424`
from `IGX-1425` after the error has crossed IPC.

#### Remarks

Electron flattens an error thrown inside `ipcMain.handle` down to its message by the time it
reaches the renderer: neither a `code` property nor the prototype survives the trip. A prefix on
the message does, and it is the only channel available without wrapping every reply in an
envelope. It lives in the contract module because both processes have to agree on the string, and
this is the one module both of them import.

***

### WEBGPU\_SWITCH

> `const` **WEBGPU\_SWITCH**: `"enable-unsafe-webgpu"` = `"enable-unsafe-webgpu"`

The switch that turns WebGPU on in an Electron renderer.

## Functions

### allowedSenderOrigins()

> **allowedSenderOrigins**(`entry?`): readonly `string`[]

The origins a game window's document may invoke the bridge from.

#### Parameters

##### entry?

`string`

The `entry` given to `createGameWindow`, when the caller knows it.

#### Returns

readonly `string`[]

The allowed origins, sorted, with no duplicates.

#### Remarks

A packaged build has exactly one: `ignifx://app`. A development build is loaded from the Vite dev
server instead, so the origin of the `entry` URL is added — the same rule `cspValueFor` uses to
pick the development policy, and for the same reason.

#### Example

```ts
allowedSenderOrigins();                          // ["ignifx://app"]
allowedSenderOrigins("http://localhost:5173/");  // ["http://localhost:5173", "ignifx://app"]
```

***

### applyWebGpuSwitches()

> **applyWebGpuSwitches**(`commandLine?`, `platform?`): readonly `string`[]

Appends the switches a WebGPU game window needs. **Call before `app.whenReady()`.**

#### Parameters

##### commandLine?

[`CommandLineLike`](#commandlinelike) = `app.commandLine`

Where to append; defaults to the running app's command line.

##### platform?

`string` = `process.platform`

The platform to decide the Linux switch on; defaults to `process.platform`.

#### Returns

readonly `string`[]

The switches appended, as `name` or `name=value`, in order — so a test can assert them.

#### Example

```ts
import { app } from "electron";
import { applyWebGpuSwitches, registerIgnifxScheme } from "@ignifx/electron/main";

applyWebGpuSwitches();
registerIgnifxScheme();
await app.whenReady();
```

***

### createGameWindow()

> **createGameWindow**(`options`): `BrowserWindow`

Creates the game window: WebGPU-ready, sandboxed, context-isolated, served a strict CSP, with its
lifecycle events forwarded to the renderer.

#### Parameters

##### options

[`GameWindowOptions`](#gamewindowoptions)

What the game asked for.

#### Returns

`BrowserWindow`

The window, with its first load already started.

#### Remarks

The window is created hidden and shown on `ready-to-show` unless `show: true` was passed, which
is what keeps a user from watching an empty rectangle while the first scene loads.

`applyWebGpuSwitches()` and `registerIgnifxScheme()` must already have run, and `app.whenReady()`
must already have resolved; both are ordering constraints of Chromium's own initialisation rather
than of this function.

#### Example

```ts
const window = createGameWindow({
  entry: "index.html",
  preload: join(import.meta.dirname, "../preload/index.cjs"),
  width: 1600,
  height: 900,
  title: "My Game",
});
```

***

### cspFor()

> **cspFor**(`options?`): `string`

Builds the Content-Security-Policy header value for a game window.

#### Parameters

##### options?

[`CspOptions`](#cspoptions) = `{}`

The mode, the dev server, and the two widening switches.

#### Returns

`string`

The header value, directives separated by `"; "`, with no trailing semicolon.

#### Remarks

Pure: it reads nothing from Electron and nothing from the file system, which is what lets the
security checklist assert the exact policy without launching a browser.

#### Example

```ts
cspFor();
// "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; …"
```

***

### cspValueFor()

> **cspValueFor**(`options`): `string` \| `null`

Resolves the Content-Security-Policy header value for a set of options.

#### Parameters

##### options

[`GameWindowOptions`](#gamewindowoptions)

What the game asked for.

#### Returns

`string` \| `null`

The header value, or `null` when the caller asked for no header.

#### Example

```ts
cspValueFor({ entry: "http://localhost:5173/", preload: "/p.cjs" });
// …a development policy that also allows http://localhost:5173 and ws://localhost:5173
```

***

### decodeStorageFileName()

> **decodeStorageFileName**(`encoded`): `string` \| `null`

Reverses [encodeStorageFileName](#encodestoragefilename).

#### Parameters

##### encoded

`string`

A base name read back from a directory listing.

#### Returns

`string` \| `null`

The original key, or `null` when the name is not something the encoder produced — a
stray file, a half-written temporary, or a truncated escape. Callers skip those rather than fail
a listing (`StorageBackend` contract, rule 6).

#### Example

```ts
decodeStorageFileName("saves%2fslot%201"); // "saves/slot 1"
decodeStorageFileName("%zz");              // null
```

***

### defaultCsp()

> **defaultCsp**(): `string`

The policy a packaged build is served under: [cspFor](#cspfor) with every default.

#### Returns

`string`

The header value.

#### Remarks

A function rather than a constant, because a constant would have to call `cspFor()` at module
scope and coding standards §4 keeps module scope to declarations and immutable literals. It is
cheap: string concatenation over a fixed table, called once per window.

`'self'` resolves to [PACKAGED\_ORIGIN](#packaged_origin) in a packaged window, because that is the origin the
document was loaded from.

#### Example

```ts
installCspHeader(window.webContents.session, defaultCsp());
```

***

### encodeStorageFileName()

> **encodeStorageFileName**(`key`): `string`

Turns a storage key or namespace segment into a file name legal on every supported file system
and unique per key on case-insensitive ones.

#### Parameters

##### key

`string`

Any key that passed the `Storage` facade's validation.

#### Returns

`string`

The encoded base name, without the `.json` or `.bin` extension.

#### Remarks

Byte-for-byte identical to `@ignifx/core`'s `encodeStorageFileName`; see the module comment for
why the codec is duplicated rather than imported.

#### Example

```ts
encodeStorageFileName("saves/Slot 1"); // "saves%2f%53lot%201"
encodeStorageFileName("..");           // "%2e%2e"
encodeStorageFileName("con");          // "%63on"
```

***

### forwardWindowEvents()

> **forwardWindowEvents**(`window`): `void`

Forwards a window's lifecycle events to its renderer over [HOST\_WINDOW\_EVENT\_CHANNEL](#host_window_event_channel).

#### Parameters

##### window

`BrowserWindow`

The window to watch.

#### Returns

`void`

#### Example

```ts
forwardWindowEvents(window);
```

***

### installCspHeader()

> **installCspHeader**(`session`, `csp`): `void`

Injects a Content-Security-Policy response header into every response a session serves.

#### Parameters

##### session

`Session`

The session to filter, normally the window's own.

##### csp

`string`

The header value to inject.

#### Returns

`void`

#### Remarks

`session.webRequest.onHeadersReceived` (`electron.d.ts` 19657) is the documented hook. The
listener replaces any policy the response already carried rather than appending one, because two
`Content-Security-Policy` headers intersect and the result is whichever is stricter — which makes
the effective policy something no single file states.

#### Example

```ts
installCspHeader(window.webContents.session, cspFor());
```

***

### installHostHandlers()

> **installHostHandlers**(`options`): () => `void`

Installs every `ipcMain.handle` the preload bridge invokes.

#### Parameters

##### options

[`HostHandlerOptions`](#hosthandleroptions)

The window, the store, the `openExternal` allow-list, and the entry the window
was created with.

#### Returns

A function that removes every handler this call installed.

() => `void`

#### Remarks

Call once, after `app.whenReady()` and after the window exists. The returned function removes the
handlers again, which matters when a window is recreated on macOS `activate`: a second
`ipcMain.handle` on the same channel throws.

#### Example

```ts
const entry = process.env["ELECTRON_RENDERER_URL"] ?? "index.html";
const window = createGameWindow({ entry, preload });
const removeHandlers = installHostHandlers({ window, entry });
```

***

### isAllowedExternalUrl()

> **isAllowedExternalUrl**(`url`, `protocols`): `boolean`

Reports whether a URL may be handed to the OS shell.

#### Parameters

##### url

`string`

The URL the renderer asked to open.

##### protocols

readonly `string`[]

The allow-list, for example `["https:", "mailto:"]`.

#### Returns

`boolean`

`true` when the URL parses and its protocol is on the list.

#### Remarks

Pure, and exported so the unit suite can assert the allow-list without a shell. The check is on
the parsed protocol, not on a prefix match: `https://evil` and `javascript:` both fail here, and
a URL that does not parse at all fails too.

#### Example

```ts
isAllowedExternalUrl("https://ignifx.com", DEFAULT_EXTERNAL_PROTOCOLS); // true
isAllowedExternalUrl("file:///etc/passwd", DEFAULT_EXTERNAL_PROTOCOLS); // false
```

***

### isDevServerEntry()

> **isDevServerEntry**(`entry`): `boolean`

Reports whether an entry is a dev-server URL rather than a packaged document.

#### Parameters

##### entry

`string`

The `entry` option.

#### Returns

`boolean`

`true` for an `http:` or `https:` URL.

#### Example

```ts
isDevServerEntry("http://localhost:5173/"); // true
isDevServerEntry("index.html"); // false
```

***

### isMissingFileError()

> **isMissingFileError**(`error`): `boolean`

Reports whether a caught failure means "there is no such file".

#### Parameters

##### error

`unknown`

The caught value.

#### Returns

`boolean`

`true` for `ENOENT` and `ENOTDIR`.

***

### isQuotaError()

> **isQuotaError**(`error`): `boolean`

Reports whether a caught failure means the disk or the user's quota is full.

#### Parameters

##### error

`unknown`

The caught value.

#### Returns

`boolean`

`true` for `ENOSPC`, `EDQUOT`, and `EFBIG`.

#### Remarks

The renderer turns this into `IGX-1424`, which is the code `StorageBackend`'s rule 8 reserves for
"out of quota"; everything else becomes `IGX-1425`.

***

### isTrustedSender()

> **isTrustedSender**(`sender`, `origins`): `boolean`

Reports whether an IPC message may be acted on.

#### Parameters

##### sender

[`SenderIdentity`](#senderidentity)

Who sent the message.

##### origins

readonly `string`[]

The origins the window may be loaded from, from [allowedSenderOrigins](#allowedsenderorigins).

#### Returns

`boolean`

`true` when the message came from the game window's own top-level document.

#### Remarks

Pure, and exported so the checklist test can state every way a sender is refused. All three
conditions have to hold: a message from another window, from a subframe, or from an origin the
window was not built to load is refused even when the other two are satisfied.

#### Example

```ts
isTrustedSender({ origin: "ignifx://app", isMainFrame: true, isGameWindow: true }, ["ignifx://app"]);
// true
```

***

### lockNavigation()

> **lockNavigation**(`contents`, `allowedOrigin`): `void`

Refuses every navigation and every new window a page tries to open.

#### Parameters

##### contents

`WebContents`

The window's web contents.

##### allowedOrigin

`string`

The one origin a navigation may stay on; anything else is blocked.

#### Returns

`void`

#### Remarks

A packaged game navigates nowhere: its only document is the one it was loaded with, and anything
that tries to replace it — a stray `<a href>`, a `window.open`, an injected script — is a bug at
best. Outbound links go through `app.desktop.openExternal`, which checks the protocol against an
allow-list and hands the URL to the OS browser instead of loading it in the game window.

Four hooks, because a navigation has four ways in and blocking one of them is not blocking the
navigation:

- `setWindowOpenHandler` (`electron.d.ts` 18632) — `window.open`, `target="_blank"`, and every
  other request for a second window. Denied outright.
- `will-navigate` (`electron.d.ts` 17671) — the top-level document being replaced.
- `will-redirect` (`electron.d.ts` 17802) — a **server-side** redirect mid-navigation, which
  `will-navigate` never sees: the first hop passes the origin check and the redirect target is
  what actually loads.
- `will-frame-navigate` (`electron.d.ts` 17652) — the same for a subframe. The policy forbids
  frames (`frame-src 'none'`), so this is the layer that says so when the policy is not there —
  a development window whose CSP the game replaced, for instance.

The origin is read with [originOfUrl](#originofurl), not with `URL.origin`: `ignifx` is not a *special*
scheme to the WHATWG parser, so `new URL("ignifx://evil/x").origin` is the string `"null"` and an
equality test written on it admits every authority. See `main/origin.ts`.

`will-attach-webview` (`electron.d.ts` 17579) is refused for the same reason `webviewTag: false`
is set: two independent layers, because a `<webview>` that attaches is a second renderer with its
own preferences.

#### Example

```ts
lockNavigation(window.webContents, "ignifx://app");
```

***

### mimeTypeFor()

> **mimeTypeFor**(`pathOrExtension`): `string`

Maps a file extension to the `Content-Type` header the protocol serves it with.

#### Parameters

##### pathOrExtension

`string`

A file name, a path, or a bare extension including the dot.

#### Returns

`string`

The MIME type, or [PROTOCOL\_FALLBACK\_MIME\_TYPE](#protocol_fallback_mime_type) for an unknown extension.

#### Example

```ts
mimeTypeFor("assets/crate-a1b2c3.png"); // "image/png"
mimeTypeFor(".wasm"); // "application/wasm"
```

***

### openDialogOptionsFor()

> **openDialogOptionsFor**(`options?`): `OpenDialogOptions`

Maps the bridge's open-dialog options onto Electron's.

#### Parameters

##### options?

[`HostOpenDialogOptions`](#hostopendialogoptions) = `{}`

What the game asked for.

#### Returns

`OpenDialogOptions`

Electron's `OpenDialogOptions` (`electron.d.ts` 23045).

#### Remarks

Pure, and the reason the contract's options are booleans rather than Electron's `properties`
array: a renderer that could pass `properties` straight through could pass
`"promptToCreate"` or `"showHiddenFiles"`, neither of which a game window has any business
turning on by itself.

#### Example

```ts
openDialogOptionsFor({ directories: true, multiple: true }).properties;
// ["openDirectory", "multiSelections"]
```

***

### originOfUrl()

> **originOfUrl**(`url`): `string` \| `null`

The origin of a URL, as `scheme://host[:port]`.

#### Parameters

##### url

`string`

The URL to read.

#### Returns

`string` \| `null`

The origin, or `null` when the URL has no tuple origin.

#### Remarks

Returns `null` — never a guess — for anything with no tuple origin: a URL that does not parse, an
opaque-origin URL such as `data:`, `blob:`, `javascript:` or `file:`, and a scheme-relative
reference. A `null` result is a refusal at every call site, so a new URL form is denied rather
than quietly admitted.

#### Example

```ts
originOfUrl("ignifx://app/index.html"); // "ignifx://app"
originOfUrl("http://localhost:5173/");  // "http://localhost:5173"
originOfUrl("file:///etc/passwd");      // null
```

***

### packagedEntryUrl()

> **packagedEntryUrl**(`entry`): `string`

The URL a packaged game window loads.

#### Parameters

##### entry

`string`

The document inside the served directory, for example `"index.html"`.

#### Returns

`string`

The absolute `ignifx://app/…` URL.

#### Example

```ts
packagedEntryUrl("index.html"); // "ignifx://app/index.html"
```

***

### parseRangeHeader()

> **parseRangeHeader**(`header`, `size`): [`RangeDecision`](#rangedecision)

Parses a `Range` request header against a known file size.

#### Parameters

##### header

`string` \| `null`

The header value, or `null` when the request carried none.

##### size

`number`

The file's size in bytes.

#### Returns

[`RangeDecision`](#rangedecision)

What to do: serve everything, serve a slice, or refuse.

#### Remarks

Implements the three single-range forms of RFC 9110 §14.1.2: `bytes=a-b`, `bytes=a-` (to the
end), and `bytes=-n` (the last `n` bytes). Multiple ranges are declined rather than
mis-implemented, because a `multipart/byteranges` response is the only correct answer to one and
no media element in Chromium asks for it.

#### Example

```ts
parseRangeHeader("bytes=100-199", 2000); // { kind: "range", range: { start: 100, end: 199 } }
parseRangeHeader("bytes=-64", 2000);     // { kind: "range", range: { start: 1936, end: 1999 } }
parseRangeHeader("bytes=5000-", 2000);   // { kind: "unsatisfiable" }
```

***

### protocolPathFor()

> **protocolPathFor**(`url`, `root`): `string`

Turns an `ignifx://` URL into the absolute file path it names.

#### Parameters

##### url

`string`

The request URL, as `request.url` gives it.

##### root

`string`

The absolute directory the protocol serves.

#### Returns

`string`

The absolute path of the file to serve.

#### Remarks

Two layers of defence, because one of them is a property of the URL parser rather than of this
code and could in principle change:

1. The `standard` privilege makes Chromium normalise `..` segments away before the request is
   dispatched — measured on Electron 44.2.0 (S9.1), `fetch("ignifx://app/../outside.txt")`
   reached the handler as `ignifx://app/outside.txt` and 404ed rather than escaping.
2. This function resolves the path anyway and refuses anything that does not land inside `root`,
   which is what catches an encoded separator, a request that never went through Chromium, and
   any future parser change.

A request for the origin itself, or for a path ending in `/`, resolves to
[PROTOCOL\_INDEX\_FILE](#protocol_index_file) inside that directory, which is what makes `ignifx://app/` load the
game.

#### Throws

An `IgnifxError` with code `IGX-1465` when the path resolves outside `root`, cannot be
decoded, or names an authority other than `app`, and one with code `IGX-1466` when `url` is not an
`ignifx://` URL.

#### Example

```ts
protocolPathFor("ignifx://app/assets/crate.png", "/Applications/Game.app/dist");
// "/Applications/Game.app/dist/assets/crate.png"
```

***

### registerIgnifxScheme()

> **registerIgnifxScheme**(): `void`

Declares the `ignifx` scheme's privileges. **Must run before `app.whenReady()`**.

#### Returns

`void`

#### Remarks

`protocol.registerSchemesAsPrivileged` (`electron.d.ts` 11702) is only read while Chromium's
network stack is being set up; calling it after the app is ready does nothing at all, and the
symptom is a page with an opaque origin and no `navigator.gpu`. Call it at the top of the main
entry, beside `applyWebGpuSwitches`.

#### Example

```ts
import { app } from "electron";
import { registerIgnifxScheme } from "@ignifx/electron/main";

registerIgnifxScheme();
await app.whenReady();
```

***

### resolveHostPaths()

> **resolveHostPaths**(): [`HostPaths`](#hostpaths)

Resolves the platform directories the bridge reports.

#### Returns

[`HostPaths`](#hostpaths)

The directories.

#### Remarks

`app.getPath` (`electron.d.ts` 1301) throws for a name the platform has none of — `downloads` and
`documents` on a bare Linux container, for instance — so each optional one is read defensively and
reported as `""`.

#### Example

```ts
const { userData } = resolveHostPaths();
```

***

### respondToProtocolRequest()

> **respondToProtocolRequest**(`request`, `root`): `Promise`\<`Response`\>

Answers one `ignifx://` request out of a directory.

#### Parameters

##### request

`Request`

The request, as `protocol.handle` delivers it.

##### root

`string`

The absolute directory being served.

#### Returns

`Promise`\<`Response`\>

The response: `200`, `206` for an honoured range, `403` for a path that escapes the
root, `404` for a missing file, `405` for a method other than `GET` or `HEAD`, and `416` for an
unsatisfiable range.

#### Remarks

Exported so the protocol can be exercised without registering it on a real Electron session: the
unit suite calls this with a temporary directory and a plain `Request`.

#### Example

```ts
const response = await respondToProtocolRequest(
  new Request("ignifx://app/assets.manifest.json"),
  "/path/to/dist",
);
```

***

### restrictPermissions()

> **restrictPermissions**(`session`, `allowed?`): `void`

Denies every permission a game window has no business asking for.

#### Parameters

##### session

`Session`

The window's session.

##### allowed?

readonly `string`[] = `ALLOWED_PERMISSIONS`

The permissions to grant; defaults to [ALLOWED\_PERMISSIONS](#allowed_permissions).

#### Returns

`void`

#### Remarks

Three handlers, because Electron asks three different questions and answering one of them leaves
the other two on their defaults:

- `setPermissionRequestHandler` (`electron.d.ts` 13426) — the prompt path, `navigator.*.request*`.
- `setPermissionCheckHandler` (`electron.d.ts` 13417) — the silent path, `permissions.query` and
  every API that checks before asking. Electron's own documentation says both are needed for
  "complete permission handling".
- `setDevicePermissionHandler` (`electron.d.ts` 13383) — the per-**device** grant that WebHID,
  WebUSB and Web Serial consult once a chooser has run. `false` for everything, which is the
  second lock on a door the two handlers above already keep shut.

#### Example

```ts
restrictPermissions(window.webContents.session);
```

***

### serveIgnifxProtocol()

> **serveIgnifxProtocol**(`root`): () => `void`

Installs the `ignifx://` handler. **Must run after `app.whenReady()`**.

#### Parameters

##### root

`string`

The absolute directory to serve, normally the packaged renderer's build output.

#### Returns

A function that removes the handler again.

() => `void`

#### Example

```ts
await app.whenReady();
const stop = serveIgnifxProtocol(join(import.meta.dirname, "../renderer"));
```

***

### storageDirectoryFor()

> **storageDirectoryFor**(`root`, `namespace`): `string`

Maps a namespace path onto the directory its files live in.

#### Parameters

##### root

`string`

The `userData` directory.

##### namespace

`string`

The `/`-joined namespace path.

#### Returns

`string`

The directory path, `/`-joined.

#### Remarks

One directory level per namespace segment, each encoded the same way a key is, which is what
keeps `"saves"` and `"saves/coop"` two separate scopes rather than a prefix relationship
(`StorageBackend` contract, rule 3).

#### Example

```ts
storageDirectoryFor("/Users/me/Library/Application Support/Game", "saves/coop");
// ".../Game/saves/coop"
```

***

### windowOptionsFor()

> **windowOptionsFor**(`options`): `BrowserWindowConstructorOptions`

Builds the `BrowserWindow` constructor options for a game window.

#### Parameters

##### options

[`GameWindowOptions`](#gamewindowoptions)

What the game asked for.

#### Returns

`BrowserWindowConstructorOptions`

The constructor options, with `CONSTITUTION.md` §9.2's preferences forced on.

#### Remarks

Pure, and exported for exactly that reason: the security checklist test (`test/security.test.ts`)
asserts the whole `webPreferences` object against [ENFORCED\_WEB\_PREFERENCES](#enforced_web_preferences) without
launching Electron, so the invariant is checked on every `pnpm test` rather than only on a
machine with a display.

#### Example

```ts
const options = windowOptionsFor({ entry: "index.html", preload: "/app/preload.cjs" });
options.webPreferences?.sandbox; // true
```

# @ignifx/electron

`@ignifx/electron/preload` public barrel: the typed, versioned bridge exposed to the renderer
through `contextBridge` as `window.ignifxHost` — storage, paths, window controls, dialogs, the
shell, and the contract version (`docs/architecture/14-platform-electron.md` §3).

A desktop app's preload entry is two lines:

```ts
// desktop/preload.ts
import { exposeIgnifxHost } from "@ignifx/electron/preload";

exposeIgnifxHost();
```

**That file has to be built to CommonJS.** A sandboxed preload script cannot be an ES module —
measured on Electron 44.2.0 / macOS arm64, an `.mjs` preload under `sandbox: true` left
`window.ignifxHost` undefined with no error anywhere — and `CONSTITUTION.md` §9.2 fixes
`sandbox: true`. The templates' `electron.vite.config.ts` builds the preload with
`format: "cjs"` and an `index.cjs` file name for exactly this reason.

## Interfaces

### HostDialogs

The dialogs the bridge exposes.

#### Methods

##### showOpenDialog()

> **showOpenDialog**(`options?`): `Promise`\<[`HostOpenDialogResult`](#hostopendialogresult)\>

Shows a modal open dialog over the game window.

###### Parameters

###### options?

[`HostOpenDialogOptions`](#hostopendialogoptions)

What the dialog offers.

###### Returns

`Promise`\<[`HostOpenDialogResult`](#hostopendialogresult)\>

What the user chose.

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

### HostShell

The shell half of the bridge.

#### Methods

##### openExternal()

> **openExternal**(`url`): `Promise`\<`void`\>

Opens a URL in the user's browser or mail client.

###### Parameters

###### url

`string`

The absolute URL to open.

###### Returns

`Promise`\<`void`\>

A promise that settles once the OS accepted it.

###### Remarks

The main process checks the protocol against an allow-list before handing it to the OS; a
refusal rejects rather than silently doing nothing.

***

### HostStorage

The storage half of the bridge. Namespaces and keys arrive already validated by the `Storage`
facade, so the main process treats a key as opaque text and encodes it for the file system.

#### Methods

##### clear()

> **clear**(`namespace`): `Promise`\<`void`\>

Removes every value of one namespace.

###### Parameters

###### namespace

`string`

The namespace path.

###### Returns

`Promise`\<`void`\>

A promise that settles once the namespace is empty.

##### delete()

> **delete**(`namespace`, `key`): `Promise`\<`void`\>

Removes one value.

###### Parameters

###### namespace

`string`

The namespace path.

###### key

`string`

The key inside that namespace.

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

The key inside that namespace.

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

When given, only keys that start with this string are returned.

###### Returns

`Promise`\<readonly `string`[]\>

The matching keys, sorted ascending.

##### set()

> **set**(`namespace`, `key`, `value`): `Promise`\<`void`\>

Writes one value, replacing whatever was there.

###### Parameters

###### namespace

`string`

The namespace path.

###### key

`string`

The key inside that namespace.

###### value

[`HostStoredValue`](#hoststoredvalue)

The JSON text or the octets to persist.

###### Returns

`Promise`\<`void`\>

A promise that settles once the value is durable.

***

### HostVersions

The runtime versions the bridge reports, read from `process.versions` in the preload script.

#### Properties

##### chrome

> `readonly` **chrome**: `string`

The Chromium version.

##### electron

> `readonly` **electron**: `string`

The Electron version, for example `"44.2.0"`.

##### node

> `readonly` **node**: `string`

The Node version bundled with Electron.

***

### HostWindow

The window controls the bridge exposes.

#### Methods

##### isFullscreen()

> **isFullscreen**(): `Promise`\<`boolean`\>

Reports whether the window is full screen.

###### Returns

`Promise`\<`boolean`\>

`true` when it is.

##### onEvent()

> **onEvent**(`listener`): () => `void`

Subscribes to the window lifecycle events the main process forwards.

###### Parameters

###### listener

(`event`) => `void`

Called with each event name.

###### Returns

A function that unsubscribes.

() => `void`

##### quit()

> **quit**(): `Promise`\<`void`\>

Closes the window and quits the application.

###### Returns

`Promise`\<`void`\>

A promise that settles once the quit has been requested.

##### setFullscreen()

> **setFullscreen**(`fullscreen`): `Promise`\<`void`\>

Enters or leaves full screen.

###### Parameters

###### fullscreen

`boolean`

`true` to enter, `false` to leave.

###### Returns

`Promise`\<`void`\>

A promise that settles once the main process has applied it.

##### setTitle()

> **setTitle**(`title`): `Promise`\<`void`\>

Sets the window's title.

###### Parameters

###### title

`string`

The new title.

###### Returns

`Promise`\<`void`\>

A promise that settles once the main process has applied it.

***

### IgnifxHost

`window.ignifxHost`: everything the preload script exposes to the renderer
(`docs/architecture/14-platform-electron.md` §3).

#### Remarks

Every member is a function or a plain value. No `ipcRenderer`, no `Electron` object, and nothing
with a prototype the renderer could walk back to Node — `contextBridge` would refuse most of that
anyway, and the ones it would allow are exactly the ones `CONSTITUTION.md` §9.2 forbids.

#### Example

```ts
if (window.ignifxHost !== undefined) {
  const { userData } = await window.ignifxHost.paths();
}
```

#### Properties

##### dialogs

> `readonly` **dialogs**: [`HostDialogs`](#hostdialogs)

Native dialogs.

##### shell

> `readonly` **shell**: [`HostShell`](#hostshell)

The OS shell.

##### storage

> `readonly` **storage**: [`HostStorage`](#hoststorage)

Reference-counted key/value storage under `userData`.

##### version

> `readonly` **version**: `string`

The [HOST\_CONTRACT\_VERSION](#host_contract_version) this bridge was built from.

##### versions

> `readonly` **versions**: [`HostVersions`](#hostversions)

The Electron, Chromium, and Node versions the app is running on.

##### window

> `readonly` **window**: [`HostWindow`](#hostwindow)

Window controls and window lifecycle events.

#### Methods

##### paths()

> **paths**(): `Promise`\<[`HostPaths`](#hostpaths)\>

Resolves the platform directories.

###### Returns

`Promise`\<[`HostPaths`](#hostpaths)\>

The directories, resolved by the main process.

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

## Variables

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

### HOST\_GLOBAL\_NAME

> `const` **HOST\_GLOBAL\_NAME**: `"ignifxHost"` = `"ignifxHost"`

The property `contextBridge` exposes the host under.

***

### HOST\_WINDOW\_EVENT\_CHANNEL

> `const` **HOST\_WINDOW\_EVENT\_CHANNEL**: `"ignifx:window-event"` = `"ignifx:window-event"`

The one main-to-renderer channel: window lifecycle events, pushed rather than polled.

## Functions

### createIgnifxHost()

> **createIgnifxHost**(): [`IgnifxHost`](#ignifxhost)

Builds the object the bridge exposes.

#### Returns

[`IgnifxHost`](#ignifxhost)

The host object.

#### Remarks

Exported separately from [exposeIgnifxHost](#exposeignifxhost) so the unit suite can assert the contract's
shape — every member present, every one a function or a plain value — without a `contextBridge`.

#### Example

```ts
const host = createIgnifxHost();
host.version; // "1.0.0"
```

***

### exposeIgnifxHost()

> **exposeIgnifxHost**(): `void`

Exposes the bridge as `window.ignifxHost`.

#### Returns

`void`

#### Remarks

The one call a desktop app's `desktop/preload.ts` has to make. It runs at import time by
design — a preload script *is* an application entry point, which is the one place
`CONSTITUTION.md` §3.5's no-side-effects rule does not reach — so this package exports the
function and lets the app's own entry call it.

#### Example

```ts
// desktop/preload.ts
import { exposeIgnifxHost } from "@ignifx/electron/preload";

exposeIgnifxHost();
```

***

### readHostVersions()

> **readHostVersions**(): [`HostVersions`](#hostversions)

Reads the runtime versions from the `process` shim a sandboxed preload is given.

#### Returns

[`HostVersions`](#hostversions)

The Electron, Chromium, and Node versions, each `""` when unavailable.

#### Remarks

A sandboxed preload has no Node, but Electron still injects a small `process` with `versions`,
`platform`, and a handful of other read-only fields. It is read defensively anyway, so that this
module can be imported in a unit test where no such global exists.

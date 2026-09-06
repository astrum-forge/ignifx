# @ignifx/electron

`@ignifx/electron` public barrel: the renderer half — the `electron()` extension, `app.desktop`,
the file-system storage backend, and the typed host contract both processes share
(`docs/architecture/14-platform-electron.md` §3).

This entry imports no `electron` and no Node built-in, so a browser build can bundle it: a game
that registers `electron()` and is opened in a browser tab finds no bridge, logs one debug line,
and gets an `app.desktop` that reports `isElectron === false`. The main-process and preload halves
live behind the `@ignifx/electron/main` and `@ignifx/electron/preload` subpaths, which a renderer
bundle must never import.

## Classes

### ElectronStorageBackend

`app.storage`'s desktop backend: the preload bridge, wearing core's `StorageBackend` interface.

#### Example

```ts
const backend = new ElectronStorageBackend(window.ignifxHost);
await backend.set("saves", "slot1", { kind: "json", json: '{"level":3}' });
```

#### Implements

- `StorageBackend`

#### Constructors

##### Constructor

> **new ElectronStorageBackend**(`host`): [`ElectronStorageBackend`](#electronstoragebackend)

Builds a backend over a bridge.

###### Parameters

###### host

[`IgnifxHost`](#ignifxhost)

The validated `window.ignifxHost`.

###### Returns

[`ElectronStorageBackend`](#electronstoragebackend)

#### Properties

##### name

> `readonly` **name**: `string` = `ELECTRON_STORAGE_BACKEND_NAME`

The identifier that appears in error context.

###### Implementation of

`StorageBackend.name`

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

###### Implementation of

`StorageBackend.clear`

##### delete()

> **delete**(`namespace`, `key`): `Promise`\<`void`\>

Removes one value.

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

###### Implementation of

`StorageBackend.delete`

##### get()

> **get**(`namespace`, `key`): `Promise`\<`StoredValue` \| `null`\>

Reads one value.

###### Parameters

###### namespace

`string`

The namespace path.

###### key

`string`

The key inside it.

###### Returns

`Promise`\<`StoredValue` \| `null`\>

The stored value, or `null` when the namespace has no such key.

###### Implementation of

`StorageBackend.get`

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

###### Implementation of

`StorageBackend.keys`

##### set()

> **set**(`namespace`, `key`, `value`): `Promise`\<`void`\>

Writes one value, replacing whatever was there.

###### Parameters

###### namespace

`string`

The namespace path.

###### key

`string`

The key inside it.

###### value

`StoredValue`

The JSON text or the octets to persist.

###### Returns

`Promise`\<`void`\>

A promise that settles once the value is durable.

###### Implementation of

`StorageBackend.set`

***

### HostDesktop

The `Desktop` a desktop build gets: every call forwarded over the preload bridge.

#### Implements

- [`Desktop`](#desktop)

#### Constructors

##### Constructor

> **new HostDesktop**(`host`): [`HostDesktop`](#hostdesktop)

Builds a desktop service over a bridge.

###### Parameters

###### host

[`IgnifxHost`](#ignifxhost)

The validated `window.ignifxHost`.

###### Returns

[`HostDesktop`](#hostdesktop)

#### Properties

##### isElectron

> `readonly` **isElectron**: `boolean` = `true`

Always `true`.

###### Implementation of

[`Desktop`](#desktop).[`isElectron`](#iselectron)

##### onWindowEvent

> `readonly` **onWindowEvent**: `SignalLike`\<[`HostWindowEvent`](#hostwindowevent)\>

The host window's lifecycle events.

###### Implementation of

[`Desktop`](#desktop).[`onWindowEvent`](#onwindowevent)

##### versions

> `readonly` **versions**: [`HostVersions`](#hostversions) \| `null`

What the bridge reported at load time.

###### Implementation of

[`Desktop`](#desktop).[`versions`](#versions)

#### Methods

##### dispose()

> **dispose**(): `void`

Removes the window-event subscription and clears the signal. Safe to call twice.

###### Returns

`void`

##### isFullscreen()

> **isFullscreen**(): `Promise`\<`boolean`\>

Reports whether the window is full screen.

###### Returns

`Promise`\<`boolean`\>

`true` when it is.

###### Implementation of

[`Desktop`](#desktop).[`isFullscreen`](#isfullscreen)

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

###### Implementation of

[`Desktop`](#desktop).[`openExternal`](#openexternal)

##### paths()

> **paths**(): `Promise`\<[`HostPaths`](#hostpaths)\>

Resolves the platform directories.

###### Returns

`Promise`\<[`HostPaths`](#hostpaths)\>

The directories the host reported.

###### Implementation of

[`Desktop`](#desktop).[`paths`](#paths)

##### quit()

> **quit**(): `Promise`\<`void`\>

Closes the window and quits the application.

###### Returns

`Promise`\<`void`\>

A promise that settles once the quit has been requested.

###### Implementation of

[`Desktop`](#desktop).[`quit`](#quit)

##### setFullscreen()

> **setFullscreen**(`fullscreen`): `Promise`\<`void`\>

Enters or leaves full screen.

###### Parameters

###### fullscreen

`boolean`

`true` to enter, `false` to leave.

###### Returns

`Promise`\<`void`\>

A promise that settles once the host applied it.

###### Implementation of

[`Desktop`](#desktop).[`setFullscreen`](#setfullscreen)

##### setWindowTitle()

> **setWindowTitle**(`title`): `Promise`\<`void`\>

Sets the window title.

###### Parameters

###### title

`string`

The new title.

###### Returns

`Promise`\<`void`\>

A promise that settles once the host applied it.

###### Implementation of

[`Desktop`](#desktop).[`setWindowTitle`](#setwindowtitle)

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

###### Implementation of

[`Desktop`](#desktop).[`showOpenDialog`](#showopendialog)

##### watchWindowEvents()

> **watchWindowEvents**(`listener`): `void`

Subscribes to the host's window lifecycle events and re-emits them on
[HostDesktop.onWindowEvent](#onwindowevent-1).

###### Parameters

###### listener

(`event`) => `void`

Called with each event name before the signal is emitted, so `electron()`
can map `focus` and `blur` onto `onApplicationFocus`.

###### Returns

`void`

***

### UnavailableDesktop

The `Desktop` a browser build gets: `isElectron === false`, and every call refused.

#### Remarks

A refusing implementation rather than an absent property, because the alternative — leaving
`app.desktop` undefined outside Electron — turns a portable game's every desktop call into an
optional-chaining exercise and hides the mistake of calling one unconditionally.

#### Implements

- [`Desktop`](#desktop)

#### Constructors

##### Constructor

> **new UnavailableDesktop**(): [`UnavailableDesktop`](#unavailabledesktop)

###### Returns

[`UnavailableDesktop`](#unavailabledesktop)

#### Properties

##### isElectron

> `readonly` **isElectron**: `boolean` = `false`

Always `false`.

###### Implementation of

[`Desktop`](#desktop).[`isElectron`](#iselectron)

##### onWindowEvent

> `readonly` **onWindowEvent**: `SignalLike`\<[`HostWindowEvent`](#hostwindowevent)\>

Never emits: a browser build has no host window to report on.

###### Implementation of

[`Desktop`](#desktop).[`onWindowEvent`](#onwindowevent)

##### versions

> `readonly` **versions**: [`HostVersions`](#hostversions) \| `null` = `null`

Always `null`.

###### Implementation of

[`Desktop`](#desktop).[`versions`](#versions)

#### Methods

##### isFullscreen()

> **isFullscreen**(): `Promise`\<`boolean`\>

Refuses.

###### Returns

`Promise`\<`boolean`\>

Never; the promise rejects with `IGX-1462`.

###### Implementation of

[`Desktop`](#desktop).[`isFullscreen`](#isfullscreen)

##### openExternal()

> **openExternal**(`_url`): `Promise`\<`void`\>

Refuses.

###### Parameters

###### \_url

`string`

Ignored.

###### Returns

`Promise`\<`void`\>

Never; the promise rejects with `IGX-1462`.

###### Implementation of

[`Desktop`](#desktop).[`openExternal`](#openexternal)

##### paths()

> **paths**(): `Promise`\<[`HostPaths`](#hostpaths)\>

Refuses.

###### Returns

`Promise`\<[`HostPaths`](#hostpaths)\>

Never; the promise rejects with `IGX-1462`.

###### Implementation of

[`Desktop`](#desktop).[`paths`](#paths)

##### quit()

> **quit**(): `Promise`\<`void`\>

Refuses.

###### Returns

`Promise`\<`void`\>

Never; the promise rejects with `IGX-1462`.

###### Implementation of

[`Desktop`](#desktop).[`quit`](#quit)

##### setFullscreen()

> **setFullscreen**(`_fullscreen`): `Promise`\<`void`\>

Refuses.

###### Parameters

###### \_fullscreen

`boolean`

Ignored.

###### Returns

`Promise`\<`void`\>

Never; the promise rejects with `IGX-1462`.

###### Implementation of

[`Desktop`](#desktop).[`setFullscreen`](#setfullscreen)

##### setWindowTitle()

> **setWindowTitle**(`_title`): `Promise`\<`void`\>

Refuses.

###### Parameters

###### \_title

`string`

Ignored.

###### Returns

`Promise`\<`void`\>

Never; the promise rejects with `IGX-1462`.

###### Implementation of

[`Desktop`](#desktop).[`setWindowTitle`](#setwindowtitle)

##### showOpenDialog()

> **showOpenDialog**(`_options?`): `Promise`\<[`HostOpenDialogResult`](#hostopendialogresult)\>

Refuses.

###### Parameters

###### \_options?

[`HostOpenDialogOptions`](#hostopendialogoptions)

Ignored.

###### Returns

`Promise`\<[`HostOpenDialogResult`](#hostopendialogresult)\>

Never; the promise rejects with `IGX-1462`.

###### Implementation of

[`Desktop`](#desktop).[`showOpenDialog`](#showopendialog)

## Interfaces

### Desktop

The desktop service reached as `app.desktop`.

#### Example

```ts
class PauseMenu extends Script {
  async toggleFullscreen(): Promise<void> {
    if (this.app.desktop.isElectron) {
      await this.app.desktop.setFullscreen(!(await this.app.desktop.isFullscreen()));
    }
  }
}
```

#### Properties

##### isElectron

> `readonly` **isElectron**: `boolean`

Whether a preload bridge was found — that is, whether this really is a desktop build.

###### Remarks

The one member that works everywhere. Everything else rejects with `IGX-1462` when this is
`false`.

##### onWindowEvent

> `readonly` **onWindowEvent**: `SignalLike`\<[`HostWindowEvent`](#hostwindowevent)\>

The host window's lifecycle events, as the main process reports them.

###### Remarks

This signal is the **only** source of `minimize` and `restore` in an Electron renderer.
Measured on Electron 44.2.0 / macOS arm64 (S9.1): minimising, restoring, and blurring the
window fired the matching `BrowserWindow` events in the main process and delivered **nothing**
to the page — no `visibilitychange`, no window `focus`/`blur`, and `document.hidden` stayed
`false` throughout. `electron()` turns `focus` and `blur` into `onApplicationFocus`, which
needs no `document` reading; `minimize` and `restore` have no `onApplicationPause` path today,
so a game that must pause on minimise subscribes here.

###### Example

```ts
app.desktop.onWindowEvent.connect((event) => {
  if (event === "minimize") {
    app.time.timeScale = 0;
  }
}, { owner: this });
```

##### versions

> `readonly` **versions**: [`HostVersions`](#hostversions) \| `null`

The Electron, Chromium, and Node versions, or `null` in a browser build.

#### Methods

##### isFullscreen()

> **isFullscreen**(): `Promise`\<`boolean`\>

Reports whether the window is full screen.

###### Returns

`Promise`\<`boolean`\>

`true` when it is.

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

The main process checks the protocol against an allow-list — `https:` and `mailto:` by default
— and rejects with `IGX-1464` for anything else, rather than silently doing nothing.

##### paths()

> **paths**(): `Promise`\<[`HostPaths`](#hostpaths)\>

Resolves the platform directories.

###### Returns

`Promise`\<[`HostPaths`](#hostpaths)\>

The directories the host reported.

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

A promise that settles once the host applied it.

##### setWindowTitle()

> **setWindowTitle**(`title`): `Promise`\<`void`\>

Sets the window title.

###### Parameters

###### title

`string`

The new title.

###### Returns

`Promise`\<`void`\>

A promise that settles once the host applied it.

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

### ElectronErrorOptions

Options accepted by [electronError](#electronerror): the same subset of `IgnifxErrorOptions` this package
uses.

#### Properties

##### cause?

> `readonly` `optional` **cause?**: `unknown`

The failure being wrapped, when there is one.

##### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>\>

Identifiers that locate the failure.

##### hint?

> `readonly` `optional` **hint?**: `string`

One sentence telling the developer what to do about it.

***

### ElectronOptions

What `electron()` accepts.

#### Properties

##### applicationEvents?

> `readonly` `optional` **applicationEvents?**: `boolean`

Whether the host's `focus` and `blur` events are delivered as `onApplicationFocus`.

###### Default Value

`true`

##### hostScope?

> `readonly` `optional` **hostScope?**: `unknown`

Where to look for the bridge. Tests pass a fake global; a game never sets this.

###### Default Value

`globalThis`

##### storage?

> `readonly` `optional` **storage?**: `boolean`

Whether the file-system storage backend replaces whatever `createApp` installed.

###### Default Value

`true`

***

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

### ElectronErrorCode

> **ElectronErrorCode** = *typeof* [`ElectronErrorCode`](#electronerrorcode)\[keyof *typeof* [`ElectronErrorCode`](#electronerrorcode)\]

The union of the codes the `ElectronErrorCode` table declares.

***

### HostChannel

> **HostChannel** = *typeof* [`HOST_CHANNELS`](#host_channels)\[keyof *typeof* [`HOST_CHANNELS`](#host_channels)\]

The union of the channel names [HOST\_CHANNELS](#host_channels) declares.

***

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

### electron

> `const` **electron**: (`options?`) => `Extension`

The `@ignifx/electron` extension factory.

#### Parameters

##### options?

[`ElectronOptions`](#electronoptions)

The three switches in [ElectronOptions](#electronoptions); a game passes none.

#### Returns

`Extension`

The extension descriptor to pass to `createApp`.

#### Example

```ts
import { createApp } from "@ignifx/core";
import { electron } from "@ignifx/electron";

const app = await createApp({
  canvas,
  extensions: [physics(), input(), audio(), electron()],
});
app.desktop.isElectron; // true in a desktop build, false in a browser tab
```

***

### ELECTRON\_ERROR\_MESSAGES

> `const` **ELECTRON\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### ELECTRON\_STORAGE\_BACKEND\_NAME

> `const` **ELECTRON\_STORAGE\_BACKEND\_NAME**: `"electron-file"` = `"electron-file"`

The name this backend reports, as `StorageBackend.name` requires.

***

### ElectronErrorCode

> `const` **ElectronErrorCode**: `object`

Every diagnostic code `@ignifx/electron` can throw, keyed by an intention-revealing name so call
sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### externalUrlRefused

> `readonly` **externalUrlRefused**: `"IGX-1464"` = `"IGX-1464"`

`openExternal` was handed a URL whose protocol is not on the allow-list.

##### hostCallFailed

> `readonly` **hostCallFailed**: `"IGX-1463"` = `"IGX-1463"`

The main process refused an IPC request, or the handler threw.

##### hostContractIncomplete

> `readonly` **hostContractIncomplete**: `"IGX-1461"` = `"IGX-1461"`

`window.ignifxHost` exists but is missing a method the renderer needs.

##### hostSenderRefused

> `readonly` **hostSenderRefused**: `"IGX-1467"` = `"IGX-1467"`

An IPC request arrived from a frame that is not the game window's own document.

##### hostUnavailable

> `readonly` **hostUnavailable**: `"IGX-1462"` = `"IGX-1462"`

`app.desktop` was used on an app whose Electron extension found no host bridge.

##### hostVersionMismatch

> `readonly` **hostVersionMismatch**: `"IGX-1460"` = `"IGX-1460"`

`window.ignifxHost` exists but announces a major version this build cannot talk to.

##### invalidWindowOptions

> `readonly` **invalidWindowOptions**: `"IGX-1466"` = `"IGX-1466"`

`createGameWindow` was given options that cannot be honoured together.

##### protocolPathEscaped

> `readonly` **protocolPathEscaped**: `"IGX-1465"` = `"IGX-1465"`

An `ignifx://` request resolved outside the directory the protocol serves.

#### Example

```ts
throw electronError(ElectronErrorCode.hostVersionMismatch, "The preload bridge is too old.", {
  context: { host: "2.0.0", expected: "1.x" },
});
```

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

### HOST\_CONTRACT\_MAJOR

> `const` **HOST\_CONTRACT\_MAJOR**: `1` = `1`

The major component of [HOST\_CONTRACT\_VERSION](#host_contract_version), which is what compatibility is decided on.

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

### REQUIRED\_HOST\_MEMBERS

> `const` **REQUIRED\_HOST\_MEMBERS**: readonly `string`[]

The members [assertHostContract](#asserthostcontract) requires, as `"path.name"` strings.

#### Remarks

Checked by name rather than by counting: a bridge from a newer minor version has members this
build does not know about, and that is fine; a bridge missing one this build calls is not.

***

### STORAGE\_BACKEND\_FAILED\_CODE

> `const` **STORAGE\_BACKEND\_FAILED\_CODE**: `"IGX-1425"` = `"IGX-1425"`

`IGX-1425` — the backend failed for any other reason.

***

### STORAGE\_QUOTA\_CODE

> `const` **STORAGE\_QUOTA\_CODE**: `"IGX-1424"` = `"IGX-1424"`

`IGX-1424` — the host is out of quota.

#### Remarks

Quoted as a literal because `@ignifx/core`'s `CoreErrorCode` table is not reachable from an
extension by design (`04-extensions.md` §3): an extension owns its own codes and is handed
core's as documented constants.

***

### STORAGE\_VALUE\_CORRUPT\_CODE

> `const` **STORAGE\_VALUE\_CORRUPT\_CODE**: `"IGX-1426"` = `"IGX-1426"`

`IGX-1426` — a stored value could not be read back.

***

### VERSION

> `const` **VERSION**: `"0.0.0"` = `"0.0.0"`

The `@ignifx/electron` version this build was cut from.

## Functions

### assertHostContract()

> **assertHostContract**(`host`): `void`

Checks that a bridge is one this build can talk to.

#### Parameters

##### host

[`IgnifxHost`](#ignifxhost)

The bridge found on the window.

#### Returns

`void`

#### Remarks

Two checks, and they fail differently on purpose. A **major** version mismatch (`IGX-1460`) means
the preload script and the renderer bundle came from different installs — a partially applied
update, a stale `asar` — and the message says so. A **missing member** (`IGX-1461`) means the
bridge is the right generation but incomplete, which is what a hand-written preload script that
forgot `exposeIgnifxHost()` and rolled its own looks like.

#### Throws

An `IgnifxError` with code `IGX-1460` when the major versions differ, or `IGX-1461` when a
member this build calls is absent.

#### Example

```ts
const host = findIgnifxHost();
if (host !== null) {
  assertHostContract(host);
}
```

***

### electronError()

> **electronError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`ElectronErrorCode`](#electronerrorcode-1)

The code from the `ElectronErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`ElectronErrorOptions`](#electronerroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to reject with.

#### Example

```ts
throw electronError(ElectronErrorCode.externalUrlRefused, "file: links are not opened.", {
  context: { url: "file:///etc/passwd" },
});
```

***

### findIgnifxHost()

> **findIgnifxHost**(`scope?`): [`IgnifxHost`](#ignifxhost) \| `null`

Finds the preload bridge on a global scope.

#### Parameters

##### scope?

`unknown` = `globalThis`

The global to look on; defaults to `globalThis`. Tests pass a fake.

#### Returns

[`IgnifxHost`](#ignifxhost) \| `null`

The bridge, or `null` when there is none.

#### Remarks

The absence of a bridge is not an error: the same renderer bundle runs in a browser tab, in a
headless Node test, and in an Electron window, and only the third has one. `electron()` logs one
debug line and stays inert in the other two.

#### Example

```ts
const host = findIgnifxHost();
if (host === null) {
  // a browser build
}
```

***

### hostCallError()

> **hostCallError**(`channel`, `error`): `Error`

Turns a rejection that came back over IPC into an `IgnifxError` naming the channel.

#### Parameters

##### channel

`string`

The bridge member that failed, for example `"storage.set"`.

##### error

`unknown`

What the invoke rejected with.

#### Returns

`Error`

The error to reject with.

#### Remarks

Electron flattens an error thrown inside `ipcMain.handle` to its message by the time it reaches
the renderer, so nothing but the text survives. Wrapping it keeps the original as `cause` and
gives the failure a code a game can branch on.

***

### isCompatibleHostVersion()

> **isCompatibleHostVersion**(`version`): `boolean`

Reports whether a bridge's announced version is one this build can talk to.

#### Parameters

##### version

`string`

The value of `window.ignifxHost.version`.

#### Returns

`boolean`

`true` when the majors match.

#### Remarks

Major equality, nothing else: a bridge with a newer minor has methods this renderer does not
call, and a bridge with an older minor is caught by the per-member check in
`renderer/host.ts` rather than by the version string.

#### Example

```ts
isCompatibleHostVersion("1.4.0"); // true
isCompatibleHostVersion("2.0.0"); // false
```

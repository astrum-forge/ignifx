# @ignifx/devtools

`@ignifx/devtools` public barrel: the overlay and its nine panels, the schema-driven inspector,
the Console panel's log sink, the `devtools` settings section, and the `IGX-155x` code space
(`docs/architecture/15-devtools-and-diagnostics.md` §4). Explicit named re-exports only — no
`export *` (coding standards §4).

## Classes

### DevtoolsService

The devtools overlay's controller, reached as `app.devtools`.

#### Example

```ts
app.devtools.open();
app.devtools.panel("inspector").show();
app.devtools.select(app.world.findByName("Player"));
```

#### Accessors

##### isOpen

###### Get Signature

> **get** **isOpen**(): `boolean`

Whether the overlay is up.

###### Returns

`boolean`

`true` between [DevtoolsService.open](#open) and [DevtoolsService.close](#close).

##### isSceneReloadDelegated

###### Get Signature

> **get** **isSceneReloadDelegated**(): `boolean`

Whether `app.hotReload` is already re-instantiating scene instances, in which case
[DevtoolsService.reloadScenes](#reloadscenes-1) deliberately does nothing rather than reloading twice.

###### Returns

`boolean`

`true` when core's own `hotReload.reloadScenes` is on.

##### onClosed

###### Get Signature

> **get** **onClosed**(): `SignalLike`

Emitted after the overlay closed.

###### Returns

`SignalLike`

The signal.

##### onOpened

###### Get Signature

> **get** **onOpened**(): `SignalLike`

Emitted after the overlay opened.

###### Returns

`SignalLike`

The signal.

##### onSelectionChanged

###### Get Signature

> **get** **onSelectionChanged**(): `SignalLike`\<`Entity` \| `null`\>

Emitted whenever [DevtoolsService.select](#select) changes the selection.

###### Returns

`SignalLike`\<`Entity` \| `null`\>

The signal.

##### panels

###### Get Signature

> **get** **panels**(): readonly [`DevtoolsPanelHandle`](#devtoolspanelhandle)[]

Every panel this build carries, in tab order.

###### Returns

readonly [`DevtoolsPanelHandle`](#devtoolspanelhandle)[]

The handles.

##### reloadScenes

###### Get Signature

> **get** **reloadScenes**(): `boolean`

Whether a scene file that changes on disk re-instantiates its live scene instances
(`docs/architecture/15-devtools-and-diagnostics.md` §5).

###### Returns

`boolean`

`true` while scene reload is on.

###### Set Signature

> **set** **reloadScenes**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### selected

###### Get Signature

> **get** **selected**(): `Entity` \| `null`

The entity the Inspector panel is showing.

###### Returns

`Entity` \| `null`

The entity, or `null`.

#### Methods

##### close()

> **close**(): `void`

Closes the overlay, disposing its DOM and every subscription it installed.

###### Returns

`void`

##### open()

> **open**(): `void`

Opens the overlay. On a headless app — or on any app with no DOM canvas — it is a documented
no-op with one debug line (`docs/architecture/07-rendering.md` §6).

###### Returns

`void`

##### panel()

> **panel**(`name`): [`DevtoolsPanelHandle`](#devtoolspanelhandle)

Returns a handle to one panel.

###### Parameters

###### name

`string`

The panel name, one of `DEVTOOLS_PANEL_NAMES`.

###### Returns

[`DevtoolsPanelHandle`](#devtoolspanelhandle)

The handle.

###### Throws

IgnifxError with code `IGX-1552` when no panel is registered under the name.

##### select()

> **select**(`entity`): `void`

Selects an entity for the Inspector panel.

###### Parameters

###### entity

`Entity` \| `null`

The entity, or `null` to clear the selection.

###### Returns

`void`

##### toggle()

> **toggle**(): `void`

Opens the overlay when it is closed and closes it when it is open.

###### Returns

`void`

## Interfaces

### DevtoolsDomTarget

The DOM objects one app's overlay is built in.

#### Properties

##### canvas

> `readonly` **canvas**: `HTMLCanvasElement`

The canvas the overlay is positioned over.

##### document

> `readonly` **document**: `Document`

The document the overlay's elements and its stylesheet are created in.

##### window

> `readonly` **window**: `Window`

The window the toggle key and resize events are read from.

***

### DevtoolsErrorOptions

Options accepted by [devtoolsError](#devtoolserror): the same subset of `IgnifxErrorOptions` this package
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

### DevtoolsLogSink

A `LogSink` that keeps the most recent records for the Console panel and, optionally,
forwards each one to a second sink so the browser console keeps working.

#### Example

```ts
const sink = createDevtoolsLogSink({ limit: 500 });
const app = await createApp({ headless: true, logSink: sink, extensions: [devtools({ logSink: sink })] });
```

#### Extends

- `LogSink`

#### Properties

##### length

> `readonly` **length**: `number`

How many records are currently retained, never more than [DevtoolsLogSink.limit](#limit).

##### limit

> `readonly` **limit**: `number`

The maximum number of records retained.

#### Methods

##### at()

> **at**(`index`): `LogRecord` \| `null`

Reads one retained record.

###### Parameters

###### index

`number`

`0` is the oldest retained record, `length - 1` the newest.

###### Returns

`LogRecord` \| `null`

The record, or `null` when the index is out of range.

##### clear()

> **clear**(): `void`

Drops every retained record.

###### Returns

`void`

##### query()

> **query**(`level`, `search`, `out`, `max`): `LogRecord`[]

Copies the records that pass a level threshold and a case-insensitive substring search, newest
first, into a caller-owned array.

###### Parameters

###### level

`LogThreshold`

The lowest severity to keep; `"silent"` keeps nothing.

###### search

`string`

A substring matched against the scope and the message; `""` matches everything.

###### out

`LogRecord`[]

The array to fill. It is truncated first, so one array serves every refresh.

###### max

`number`

How many records to copy at most.

###### Returns

`LogRecord`[]

The same `out` array.

##### write()

> **write**(`record`): `void`

Writes one record. Called synchronously from the logging call site, so implementations must be
cheap and must not throw.

###### Parameters

###### record

`LogRecord`

The record to write.

###### Returns

`void`

###### Inherited from

`LogSink.write`

***

### DevtoolsLogSinkOptions

What [createDevtoolsLogSink](#createdevtoolslogsink) accepts.

#### Properties

##### limit?

> `readonly` `optional` **limit?**: `number`

How many records to retain. Defaults to [DEFAULT\_DEVTOOLS\_LOG\_LIMIT](#default_devtools_log_limit).

##### tee?

> `readonly` `optional` **tee?**: `LogSink`

A second sink every record is also written to — the console sink, in a normal game.

***

### DevtoolsOptions

What `devtools()` accepts. Every field that names a settings value overrides the matching
`devtools` section value, which is the shape `04-extensions.md` §1 shows for `physics()`.

#### Properties

##### logSink?

> `readonly` `optional` **logSink?**: [`DevtoolsLogSink`](#devtoolslogsink)

The sink the Console panel reads its log lines from. By default the extension creates one and
adds it to `app.log` with `Logger.addSink`, so log lines appear without any wiring; pass your own
to share it with something else (a `tee` to the console, a file sink) or to size its buffer.

##### opacity?

> `readonly` `optional` **opacity?**: `number`

The overlay's background opacity, `0`–`1`.

##### openOnStart?

> `readonly` `optional` **openOnStart?**: `boolean`

Whether the overlay is open the moment the app starts.

##### panels?

> `readonly` `optional` **panels?**: readonly `string`[]

The panels to show, in tab order.

##### position?

> `readonly` `optional` **position?**: `"right"` \| `"left"` \| `"top"` \| `"bottom"`

The canvas edge the overlay docks to.

##### reloadScenes?

> `readonly` `optional` **reloadScenes?**: `boolean`

Whether a changed scene file re-instantiates its live scene instances.

##### toggleKey?

> `readonly` `optional` **toggleKey?**: `string`

The `KeyboardEvent.code` that toggles the overlay. Defaults to `"Backquote"`.

***

### DevtoolsPanelHandle

One panel, as `app.devtools.panel(name)` hands it out.

#### Properties

##### name

> `readonly` **name**: `string`

The panel's name.

##### title

> `readonly` **title**: `string`

The tab label.

##### visible

> `readonly` **visible**: `boolean`

Whether the panel's tab is shown.

#### Methods

##### hide()

> **hide**(): `void`

Hides the panel's tab; the neighbouring tab takes over when it was the visible one.

###### Returns

`void`

##### show()

> **show**(): `void`

Shows the panel's tab and brings it to the front.

###### Returns

`void`

***

### DevtoolsSettings

The resolved `devtools` settings section.

#### Example

```ts
// ignifx.config.ts
export default defineConfig({
  devtools: { toggleKey: "F1", openOnStart: true, panels: ["stats", "console"] },
});
```

#### Properties

##### opacity

> `readonly` **opacity**: `number`

The overlay's background opacity, `0`–`1`. Defaults to `0.92`.

##### openOnStart

> `readonly` **openOnStart**: `boolean`

Whether the overlay is open the moment the app starts. Defaults to `false`.

##### panels

> `readonly` **panels**: readonly `string`[]

The panels to show, in tab order. Names outside [DEVTOOLS\_PANEL\_NAMES](#devtools_panel_names) are ignored.
Defaults to every panel in the documented order.

##### position

> `readonly` **position**: `"right"` \| `"left"` \| `"top"` \| `"bottom"`

The canvas edge the overlay docks to. Defaults to `"right"`.

##### reloadScenes

> `readonly` **reloadScenes**: `boolean`

Whether a `SceneAsset` that hot-reloads re-instantiates its live scene instances
(`15-devtools-and-diagnostics.md` §5). Defaults to `false`.

##### toggleKey

> `readonly` **toggleKey**: `string`

The `KeyboardEvent.code` that toggles the overlay. Defaults to `"Backquote"` — the backtick
`15-devtools-and-diagnostics.md` §4 names. The listener is a raw `keydown` on the document, so
the key works with or without `@ignifx/input` (`08-input.md` §5).

## Type Aliases

### DevtoolsErrorCode

> **DevtoolsErrorCode** = *typeof* [`DevtoolsErrorCode`](#devtoolserrorcode)\[keyof *typeof* [`DevtoolsErrorCode`](#devtoolserrorcode)\]

The union of the codes the `DevtoolsErrorCode` table declares.

***

### DevtoolsPanelName

> **DevtoolsPanelName** = *typeof* [`DEVTOOLS_PANEL_NAMES`](#devtools_panel_names)\[`number`\]

The union of the nine panel names.

***

### DevtoolsPosition

> **DevtoolsPosition** = *typeof* [`DEVTOOLS_POSITIONS`](#devtools_positions)\[`number`\]

The edge of the canvas the overlay is docked to.

## Variables

### DEFAULT\_DEVTOOLS\_LOG\_LIMIT

> `const` **DEFAULT\_DEVTOOLS\_LOG\_LIMIT**: `500` = `500`

How many records [createDevtoolsLogSink](#createdevtoolslogsink) keeps when no limit is given. Five hundred lines
is about a screenful of scrollback at the Console panel's row height and costs a few tens of
kilobytes.

***

### devtools

> `const` **devtools**: (`options?`) => `Extension`

The `@ignifx/devtools` extension factory.

#### Parameters

##### options?

[`DevtoolsOptions`](#devtoolsoptions)

Overrides for the `devtools` settings section, plus the Console panel's sink.

#### Returns

`Extension`

The extension descriptor to pass to `createApp`.

#### Example

```ts
const app = await createApp({ canvas, extensions: [devtools({ toggleKey: "F1" })] });
app.devtools.open();
```

***

### DEVTOOLS\_CLASS\_NAMES

> `const` **DEVTOOLS\_CLASS\_NAMES**: `object`

Every class name the overlay writes, so a game that wants to restyle the panels has names to
target and the source has no string literals scattered through it.

#### Type Declaration

##### body

> `readonly` **body**: `"ignifx-devtools-body"` = `"ignifx-devtools-body"`

The panel body under the tab strip.

##### button

> `readonly` **button**: `"ignifx-devtools-button"` = `"ignifx-devtools-button"`

A small push button.

##### canvas

> `readonly` **canvas**: `"ignifx-devtools-canvas"` = `"ignifx-devtools-canvas"`

The timeline canvas.

##### heading

> `readonly` **heading**: `"ignifx-devtools-heading"` = `"ignifx-devtools-heading"`

A section heading inside a panel.

##### input

> `readonly` **input**: `"ignifx-devtools-input"` = `"ignifx-devtools-input"`

A text input, number input, or select.

##### label

> `readonly` **label**: `"ignifx-devtools-label"` = `"ignifx-devtools-label"`

The label half of a row.

##### line

> `readonly` **line**: `"ignifx-devtools-line"` = `"ignifx-devtools-line"`

One console line.

##### node

> `readonly` **node**: `"ignifx-devtools-node"` = `"ignifx-devtools-node"`

A tree row in the scene panel.

##### nodeSelected

> `readonly` **nodeSelected**: `"ignifx-devtools-node-selected"` = `"ignifx-devtools-node-selected"`

The selected tree row.

##### panel

> `readonly` **panel**: `"ignifx-devtools-panel"` = `"ignifx-devtools-panel"`

One panel's own container.

##### root

> `readonly` **root**: `"ignifx-devtools"` = `"ignifx-devtools"`

The overlay root, docked to one edge of the canvas.

##### row

> `readonly` **row**: `"ignifx-devtools-row"` = `"ignifx-devtools-row"`

A label/value row.

##### tab

> `readonly` **tab**: `"ignifx-devtools-tab"` = `"ignifx-devtools-tab"`

One tab button.

##### tabActive

> `readonly` **tabActive**: `"ignifx-devtools-tab-active"` = `"ignifx-devtools-tab-active"`

The active tab button.

##### tabs

> `readonly` **tabs**: `"ignifx-devtools-tabs"` = `"ignifx-devtools-tabs"`

The tab strip along the top of the root.

##### toolbar

> `readonly` **toolbar**: `"ignifx-devtools-toolbar"` = `"ignifx-devtools-toolbar"`

A toolbar strip inside a panel.

##### value

> `readonly` **value**: `"ignifx-devtools-value"` = `"ignifx-devtools-value"`

The value half of a row.

***

### DEVTOOLS\_ERROR\_LIMIT

> `const` **DEVTOOLS\_ERROR\_LIMIT**: `50` = `50`

How many `app.onError` reports the Console panel retains while the overlay is open. Reports that
arrive while it is closed are not retained: a closed overlay holds no subscription.

***

### DEVTOOLS\_ERROR\_MESSAGES

> `const` **DEVTOOLS\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### DEVTOOLS\_HOT\_RELOAD\_LIMIT

> `const` **DEVTOOLS\_HOT\_RELOAD\_LIMIT**: `20` = `20`

How many `app.hotReload` reports the Console and Stats panels retain
(`docs/architecture/15-devtools-and-diagnostics.md` §5).

***

### DEVTOOLS\_LAYER\_Z\_INDEX

> `const` **DEVTOOLS\_LAYER\_Z\_INDEX**: `1000000` = `1_000_000`

The `z-index` the `app.ui` devtools layer is created at: above every layer a game is likely to
declare, so the overlay is never behind a HUD.

***

### DEVTOOLS\_LOG\_LEVELS

> `const` **DEVTOOLS\_LOG\_LEVELS**: readonly `LogLevel`[]

The levels the Console panel's filter offers, lowest first.

***

### DEVTOOLS\_PANEL\_NAMES

> `const` **DEVTOOLS\_PANEL\_NAMES**: readonly \[`"stats"`, `"scene"`, `"inspector"`, `"assets"`, `"input"`, `"audio"`, `"physics"`, `"console"`, `"timeline"`\]

Every panel name, in the order `15-devtools-and-diagnostics.md` §4 lists them. The `panels`
setting is a re-ordering — and, by omission, a filter — of this list.

***

### DEVTOOLS\_POSITIONS

> `const` **DEVTOOLS\_POSITIONS**: readonly \[`"right"`, `"left"`, `"top"`, `"bottom"`\]

Where the overlay is docked against the canvas.

***

### DEVTOOLS\_SAMPLE\_ORDER

> `const` **DEVTOOLS\_SAMPLE\_ORDER**: `9000` = `9000`

The `Phase.PreRender` order the sampler runs at: after every renderer, 2D, UI and audio system,
and inside the `[1001, 9999]` band `docs/architecture/04-extensions.md` gives extensions.

***

### DEVTOOLS\_SETTINGS\_SECTION

> `const` **DEVTOOLS\_SETTINGS\_SECTION**: `"devtools"` = `"devtools"`

The section name as it appears in `ignifx.config.ts`.

***

### DEVTOOLS\_STYLE\_ELEMENT\_ID

> `const` **DEVTOOLS\_STYLE\_ELEMENT\_ID**: `"ignifx-devtools-styles"` = `"ignifx-devtools-styles"`

The id of the injected `<style>` element.

***

### DEVTOOLS\_UI\_LAYER

> `const` **DEVTOOLS\_UI\_LAYER**: `"devtools"` = `"devtools"`

The name of the `app.ui` layer the overlay mounts into when `@ignifx/ui` is registered. A game
that wants to style or hide the overlay reaches it as `app.ui.layer(DEVTOOLS_UI_LAYER)`.

***

### DevtoolsErrorCode

> `const` **DevtoolsErrorCode**: `object`

Every diagnostic code `@ignifx/devtools` can throw or log, keyed by an intention-revealing name
so call sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### assetReloadUnsupported

> `readonly` **assetReloadUnsupported**: `"IGX-1555"` = `"IGX-1555"`

The Assets panel's reload button was pressed on an asset service with no reload entry point.

##### duplicateExtension

> `readonly` **duplicateExtension**: `"IGX-1550"` = `"IGX-1550"`

A second `devtools()` extension was registered on one app.

##### fieldWriteFailed

> `readonly` **fieldWriteFailed**: `"IGX-1554"` = `"IGX-1554"`

An inspector write could not be decoded into the field's value type.

##### headlessNoOp

> `readonly` **headlessNoOp**: `"IGX-1551"` = `"IGX-1551"`

A DOM-only member was reached on a host with no document, and did nothing.

##### pickUnavailable

> `readonly` **pickUnavailable**: `"IGX-1557"` = `"IGX-1557"`

"Select in world" was used on an app whose renderer cannot pick.

##### readonlyField

> `readonly` **readonlyField**: `"IGX-1553"` = `"IGX-1553"`

An inspector write targeted a field the schema marks `readonly` or `hidden`.

##### sceneReloadUnsupported

> `readonly` **sceneReloadUnsupported**: `"IGX-1556"` = `"IGX-1556"`

`reloadScenes` is on but neither core nor `app.hotReload` can re-instantiate a scene.

##### unknownPanel

> `readonly` **unknownPanel**: `"IGX-1552"` = `"IGX-1552"`

`app.devtools.panel(name)` was given a name no panel is registered under.

#### Example

```ts
throw devtoolsError(DevtoolsErrorCode.unknownPanel, "scene-graph is not a devtools panel.", {
  context: { panel: "scene-graph" },
});
```

***

### TEXT\_REFRESH\_HZ

> `const` **TEXT\_REFRESH\_HZ**: `10` = `10`

How often a text panel is rewritten, in hertz — §4's *"throttled"* rate. A panel that declares
`perFrame` — the Timeline graph — ignores it.

## Functions

### createDevtoolsLogSink()

> **createDevtoolsLogSink**(`options?`): [`DevtoolsLogSink`](#devtoolslogsink)

Creates the Console panel's sink.

#### Parameters

##### options?

[`DevtoolsLogSinkOptions`](#devtoolslogsinkoptions) = `{}`

The retention limit and the sink to tee to.

#### Returns

[`DevtoolsLogSink`](#devtoolslogsink)

The sink, to pass to both `createApp({ logSink })` and `devtools({ logSink })`.

#### Example

```ts
const sink = createDevtoolsLogSink();
sink.write({ level: "warn", scope: "physics", message: "no collider", data: [], timeMs: 0 });
sink.length; // 1
```

***

### defaultDevtoolsSettings()

> **defaultDevtoolsSettings**(): [`DevtoolsSettings`](#devtoolssettings)

The values used for everything a project omits.

#### Returns

[`DevtoolsSettings`](#devtoolssettings)

The default `devtools` section.

***

### devtoolsError()

> **devtoolsError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`DevtoolsErrorCode`](#devtoolserrorcode-1)

The code from the `DevtoolsErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`DevtoolsErrorOptions`](#devtoolserroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to report.

#### Example

```ts
throw devtoolsError(DevtoolsErrorCode.unknownPanel, "physics2d is not a devtools panel.", {
  context: { panel: "physics2d" },
});
```

***

### devtoolsSettingsSchema()

> **devtoolsSettingsSchema**(): `Schema`

The schema the `devtools` section is validated against.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

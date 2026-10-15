# @ignifx/editor-host

`@ignifx/editor-host` public barrel: the page half of the ignifx editor's host. It runs inside a
project's own dev server, from the project's own `@ignifx/core`, in the editor's scene view and
play view, and speaks the editor protocol over a `MessagePort`
(`docs/architecture/17-editor-host.md`). The Vite plugin is the `@ignifx/editor-host/vite` entry.

Explicit named re-exports only, no `export *` (coding standards §4).

## Interfaces

### EditorConnectMessage

The window message that hands a host its `MessagePort`; the port travels as its one transferred
object, not inside the data.

#### Properties

##### type

> `readonly` **type**: `"ignifx-editor/connect"`

Always [EDITOR\_CONNECT\_MESSAGE\_TYPE](#editor_connect_message_type).

***

### EditorHost

**`Beta`**

A running scene-view host. The host owns its app: disposing the host disposes the app.

#### Properties

##### app

> `readonly` **app**: `App`

**`Beta`**

The app the scene view shows.

##### bootScene

> `readonly` **bootScene**: `SceneInstance` \| `null`

**`Beta`**

The instance of `bootScene`, or `null` when none was given.

##### engineVersion

> `readonly` **engineVersion**: `string`

**`Beta`**

The engine version the host reports in `ready`.

##### isConnected

> `readonly` **isConnected**: `boolean`

**`Beta`**

Whether the editor has handed the host a port that is still open.

#### Methods

##### \[dispose\]()

> **\[dispose\]**(): `void`

**`Beta`**

Same as [EditorHost.dispose](#dispose-1), for `using`.

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

**`Beta`**

Stops the heartbeat, closes the port, and disposes the app. Idempotent.

###### Returns

`void`

***

### EditorHostOptions

**`Beta`**

Options accepted by [startEditorHost](#starteditorhost). The app options are the ones the project's `main.ts`
passes to `createApp`; the editor host's Vite plugin generates the call that supplies them.

#### Properties

##### assets?

> `readonly` `optional` **assets?**: `AssetsCreateOptions`

**`Beta`**

The asset manifest and `fetch`, as the project's `main.ts` passes them.

##### bootScene?

> `readonly` `optional` **bootScene?**: `string` \| `null`

**`Beta`**

A scene address to load before the app starts, through the normal loader. Defaults to none.

##### canvas?

> `readonly` `optional` **canvas?**: `RenderSurface`

**`Beta`**

The canvas to render into. Without one the app is headless.

##### editMode?

> `readonly` `optional` **editMode?**: `boolean`

**`Beta`**

Build the app in edit mode (`createApp({ editMode })`, ADR-0028), so the scene view shows the
scene without playing it: only scripts whose class sets `static runInEditMode = true` get
callbacks, and physics and other game-clock systems hold or skip. Defaults to `true`; pass
`false` to run the scene view as a game.

##### editorOrigin

> `readonly` **editorOrigin**: `string`

**`Beta`**

The origin the editor is served from, for example `"ignifx://app"`. A port posted from any
other origin is ignored.

##### engineVersion?

> `readonly` `optional` **engineVersion?**: `string`

**`Beta`**

The project's `@ignifx/core` version, reported in `ready`. Used only while core's own
`VERSION` is the unstamped `"0.0.0"`; the Vite plugin reads it from the project's installed
`@ignifx/core/package.json`.

##### extensions?

> `readonly` `optional` **extensions?**: readonly `Extension`[]

**`Beta`**

The project's extensions, in the order its `main.ts` registers them.

##### headless?

> `readonly` `optional` **headless?**: `boolean`

**`Beta`**

Run on Babylon Lite's null engine. Defaults to `true` when there is no `canvas`.

##### heartbeatIntervalMs?

> `readonly` `optional` **heartbeatIntervalMs?**: `number`

**`Beta`**

Milliseconds between heartbeats once the editor has said `hello`. Defaults to `1000`.

##### hostKind?

> `readonly` `optional` **hostKind?**: `"scene"`

**`Beta`**

Which view this host runs. Only `"scene"` exists in this release. Defaults to `"scene"`.

##### messageTarget?

> `readonly` `optional` **messageTarget?**: [`EditorMessageTarget`](#editormessagetarget)

**`Beta`**

Where the editor's connect message arrives. Defaults to the page's `window`.

##### scripts?

> `readonly` `optional` **scripts?**: readonly `ConcreteComponentType`\<`Component`\>[]

**`Beta`**

The project's component classes, registered with `app.registerComponents`.

##### settings?

> `readonly` `optional` **settings?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

**`Beta`**

Project settings, as `ignifx.config.ts` supplies them (`import.meta.env.IGNIFX_CONFIG`).

***

### EditorMessageTarget

**`Beta`**

Where a host listens for the editor's connect message: the view's `window` in a browser, or any
`EventTarget` that dispatches `MessageEvent`s, which is how a headless test stands in for one.
Events that are not `MessageEvent`s are ignored.

#### Methods

##### addEventListener()

> **addEventListener**(`type`, `listener`): `void`

**`Beta`**

Subscribes to window messages.

###### Parameters

###### type

`"message"`

Always `"message"`.

###### listener

(`event`) => `void`

Receives each message.

###### Returns

`void`

##### removeEventListener()

> **removeEventListener**(`type`, `listener`): `void`

**`Beta`**

Unsubscribes a listener added with `addEventListener`.

###### Parameters

###### type

`"message"`

Always `"message"`.

###### listener

(`event`) => `void`

The listener to remove.

###### Returns

`void`

***

### EditorPlayControls

**`Beta`**

The play view's side of an editor channel. The game keeps its app; the controls only drive it.

#### Properties

##### isConnected

> `readonly` **isConnected**: `boolean`

**`Beta`**

Whether the editor has handed the page a port that is still open.

#### Methods

##### \[dispose\]()

> **\[dispose\]**(): `void`

**`Beta`**

Same as [EditorPlayControls.dispose](#dispose-3), for `using`.

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

**`Beta`**

Stops the heartbeat and closes the port. The app is left as it is. Idempotent.

###### Returns

`void`

***

### EditorPlayControlsOptions

**`Beta`**

Options accepted by [startEditorPlayControls](#starteditorplaycontrols).

#### Properties

##### editorOrigin

> `readonly` **editorOrigin**: `string`

**`Beta`**

The origin the editor is served from; a port posted from any other origin is ignored.

##### engineVersion?

> `readonly` `optional` **engineVersion?**: `string`

**`Beta`**

The project's `@ignifx/core` version, reported in `ready` while core's `VERSION` is unstamped.

##### heartbeatIntervalMs?

> `readonly` `optional` **heartbeatIntervalMs?**: `number`

**`Beta`**

Milliseconds between heartbeats once the editor has said `hello`. Defaults to `1000`.

##### messageTarget?

> `readonly` `optional` **messageTarget?**: [`EditorMessageTarget`](#editormessagetarget)

**`Beta`**

Where the editor's connect message arrives. Defaults to the page's `window`.

***

### HelloParams

What the editor says about itself in `hello`.

#### Properties

##### editorVersion

> `readonly` **editorVersion**: `string`

The editor's own version, for example `"0.1.0"`.

##### protocol

> `readonly` **protocol**: [`ProtocolVersion`](#protocolversion)

The protocol version the editor speaks.

***

### HelloRequest

Editor → host: the first request on a new channel.

#### Extends

- [`RpcRequest`](#rpcrequest)\<*typeof* [`hello`](#hello), [`HelloParams`](#helloparams)\>

#### Properties

##### id

> `readonly` **id**: [`RpcId`](#rpcid)

Matches the response to this request.

###### Inherited from

[`RpcRequest`](#rpcrequest).[`id`](#id-2)

##### jsonrpc

> `readonly` **jsonrpc**: `"2.0"`

Always `"2.0"`.

###### Inherited from

[`RpcRequest`](#rpcrequest).[`jsonrpc`](#jsonrpc-3)

##### method

> `readonly` **method**: `"hello"`

The method to call.

###### Inherited from

[`RpcRequest`](#rpcrequest).[`method`](#method-2)

##### params

> `readonly` **params**: [`HelloParams`](#helloparams)

What the editor says about itself.

###### Overrides

[`RpcRequest`](#rpcrequest).[`params`](#params-2)

***

### PlayState

What the play view reports after every `PlayMethod`.

#### Properties

##### frameCount

> `readonly` **frameCount**: `number`

How many frames have started (`app.time.frameCount`).

##### isPaused

> `readonly` **isPaused**: `boolean`

Whether game time is paused (`app.time.paused`).

##### isRunning

> `readonly` **isRunning**: `boolean`

Whether the frame loop runs (`app.isRunning`).

***

### ProtocolVersion

A protocol version. `major` changes when a message changes incompatibly; `minor` when messages
or fields are added in a way an older peer can ignore. Before 1.0 the minor plays the role of the
major (ADR-E008), so every 0.x minor is its own incompatible line.

#### Properties

##### major

> `readonly` **major**: `number`

Incremented for incompatible changes. Peers must agree on it.

##### minor

> `readonly` **minor**: `number`

Incremented for additions. From 1.0 peers may differ in it; before 1.0 they must agree on it too.

***

### ReadyResult

What a host says about itself in answer to `hello`.

#### Properties

##### capabilities

> `readonly` **capabilities**: readonly `string`[]

Optional features the host supports, named by `HostCapability`. Names are added as the
protocol grows; a peer ignores names it does not know.

##### engineVersion

> `readonly` **engineVersion**: `string`

The version of `@ignifx/core` the project runs, for example `"0.9.0"`.

##### hostKind

> `readonly` **hostKind**: [`HostKind`](#hostkind-2)

Which view the host runs.

##### protocol

> `readonly` **protocol**: [`ProtocolVersion`](#protocolversion)

The protocol version the host speaks.

***

### RpcError

The `error` member of a failed response.

#### Properties

##### code

> `readonly` **code**: [`RpcErrorCode`](#rpcerrorcode-2)

What kind of failure it was.

##### data?

> `readonly` `optional` **data?**: `unknown`

Extra detail for debugging; its shape depends on the method.

##### message

> `readonly` **message**: `string`

A short, human-readable description.

***

### RpcErrorResponse

The answer to a request that failed.

#### Properties

##### error

> `readonly` **error**: [`RpcError`](#rpcerror)

Why the request failed.

##### id

> `readonly` **id**: [`RpcId`](#rpcid) \| `null`

The `id` of the request being answered, or `null` when it could not be read.

##### jsonrpc

> `readonly` **jsonrpc**: `"2.0"`

Always `"2.0"`.

***

### RpcNotification

A one-way message: like a request, but with no `id` and no response.

#### Type Parameters

##### M

`M` *extends* `string` = `string`

The method name.

##### P

`P` = `unknown`

The parameters; omitted when the method takes none.

#### Properties

##### jsonrpc

> `readonly` **jsonrpc**: `"2.0"`

Always `"2.0"`.

##### method

> `readonly` **method**: `M`

The event or method being signalled.

##### params?

> `readonly` `optional` **params?**: `P`

The message's arguments, an object or an array in JSON.

***

### RpcRequest

A call that expects a response with the same `id`.

#### Extended by

- [`HelloRequest`](#hellorequest)

#### Type Parameters

##### M

`M` *extends* `string` = `string`

The method name.

##### P

`P` = `unknown`

The parameters; omitted when the method takes none.

#### Properties

##### id

> `readonly` **id**: [`RpcId`](#rpcid)

Matches the response to this request.

##### jsonrpc

> `readonly` **jsonrpc**: `"2.0"`

Always `"2.0"`.

##### method

> `readonly` **method**: `M`

The method to call.

##### params?

> `readonly` `optional` **params?**: `P`

The method's arguments, an object or an array in JSON.

***

### RpcSuccessResponse

The answer to a request that succeeded.

#### Type Parameters

##### R

`R` = `unknown`

The result.

#### Properties

##### id

> `readonly` **id**: [`RpcId`](#rpcid)

The `id` of the request being answered.

##### jsonrpc

> `readonly` **jsonrpc**: `"2.0"`

Always `"2.0"`.

##### result

> `readonly` **result**: `R`

What the method returned.

***

### StepParams

The parameters of the `step` method.

#### Properties

##### deltaSeconds?

> `readonly` `optional` **deltaSeconds?**: `number`

The frame delta in seconds, a positive finite number. Defaults to `app.time.fixedDeltaTime`;
any other value fails with `RpcErrorCode.invalidParams`.

## Type Aliases

### EditorHostErrorCode

> **EditorHostErrorCode** = *typeof* [`EditorHostErrorCode`](#editorhosterrorcode)\[keyof *typeof* [`EditorHostErrorCode`](#editorhosterrorcode)\]

**`Beta`**

The union of the codes in `EditorHostErrorCode`.

***

### HandshakeMethod

> **HandshakeMethod** = *typeof* [`HandshakeMethod`](#handshakemethod)\[keyof *typeof* [`HandshakeMethod`](#handshakemethod)\]

The union of the names in `HandshakeMethod`.

***

### HeartbeatNotification

> **HeartbeatNotification** = [`RpcNotification`](#rpcnotification)\<*typeof* [`heartbeat`](#heartbeat-1), `never`\>

Host → editor: the view is alive. It carries no parameters, so `params` is absent on the wire:
`{"jsonrpc":"2.0","method":"heartbeat"}`.

***

### HostCapability

> **HostCapability** = *typeof* [`HostCapability`](#hostcapability)\[keyof *typeof* [`HostCapability`](#hostcapability)\]

The union of the names in `HostCapability`.

***

### HostKind

> **HostKind** = *typeof* [`HostKind`](#hostkind-1)\[keyof *typeof* [`HostKind`](#hostkind-1)\]

The union of the kinds in `HostKind`.

***

### HostNotification

> **HostNotification** = *typeof* [`HostNotification`](#hostnotification)\[keyof *typeof* [`HostNotification`](#hostnotification)\]

The union of the names in `HostNotification`.

***

### PingRequest

> **PingRequest** = [`RpcRequest`](#rpcrequest)\<*typeof* [`ping`](#ping), `never`\>

Either direction: a liveness check. It takes no parameters.

***

### PlayMethod

> **PlayMethod** = *typeof* [`PlayMethod`](#playmethod)\[keyof *typeof* [`PlayMethod`](#playmethod)\]

The union of the names in `PlayMethod`.

***

### PlayRequest

> **PlayRequest** = [`RpcRequest`](#rpcrequest)\<*typeof* [`play`](#play-1), `never`\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`pause`](#pause), `never`\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`step`](#step), [`StepParams`](#stepparams)\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`stop`](#stop), `never`\>

Editor → play view: one of the `PlayMethod`s. Only `step` takes parameters.

***

### PlayResponse

> **PlayResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`PlayState`](#playstate)\>

Play view → editor: the answer to a [PlayRequest](#playrequest).

***

### PongResponse

> **PongResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<`"pong"`\>

The answer to [PingRequest](#pingrequest).

***

### ReadyResponse

> **ReadyResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`ReadyResult`](#readyresult)\>

Host → editor: the successful answer to [HelloRequest](#hellorequest).

***

### RpcErrorCode

> **RpcErrorCode** = *typeof* [`RpcErrorCode`](#rpcerrorcode-1)\[keyof *typeof* [`RpcErrorCode`](#rpcerrorcode-1)\]

The union of the codes in `RpcErrorCode`.

***

### RpcId

> **RpcId** = `string` \| `number`

A request id, chosen by the sender and echoed in the response.

***

### RpcMessage

> **RpcMessage** = [`RpcRequest`](#rpcrequest) \| [`RpcNotification`](#rpcnotification) \| [`RpcResponse`](#rpcresponse)

Any message that can travel on an editor channel.

***

### RpcResponse

> **RpcResponse**\<`R`\> = [`RpcSuccessResponse`](#rpcsuccessresponse)\<`R`\> \| [`RpcErrorResponse`](#rpcerrorresponse)

The answer to a request: a result or an error, never both.

#### Type Parameters

##### R

`R` = `unknown`

The result on success.

## Variables

### DEFAULT\_HEARTBEAT\_INTERVAL\_MS

> `const` **DEFAULT\_HEARTBEAT\_INTERVAL\_MS**: `1000` = `1000`

The milliseconds between heartbeats when the host is not configured otherwise: one second, so a
dead view is noticed within a few.

#### Remarks

A host starts its heartbeat after it has answered a compatible `hello` with `ready`, sends it on
the current port only, and stops it when that port is replaced or closed. A host that lists
`HostCapability.heartbeat` in `ready` sends it, and the editor treats a missing heartbeat as a
dead view.

***

### EDITOR\_CONNECT\_MESSAGE\_TYPE

> `const` **EDITOR\_CONNECT\_MESSAGE\_TYPE**: `"ignifx-editor/connect"` = `"ignifx-editor/connect"`

The `type` of the window message that hands a host its `MessagePort`.

#### Remarks

The editor posts `{ type: EDITOR_CONNECT_MESSAGE_TYPE }` to the view's window, targeted at the
view's origin, with the port as the one transferred object. It posts a fresh one after every load
of the view: a port that has been transferred once cannot be sent again, and the newest port
replaces the previous one. The host ignores the message unless `event.origin` is the editor's
origin, the data is this shape, and exactly one port is attached.

#### Example

```ts
const channel = new MessageChannel();
frame.contentWindow?.postMessage({ type: EDITOR_CONNECT_MESSAGE_TYPE }, "http://127.0.0.1:5173", [channel.port2]);
```

***

### EditorHostErrorCode

> `const` **EditorHostErrorCode**: `object`

**`Beta`**

Every diagnostic code `@ignifx/editor-host` can throw, keyed by an intention-revealing name.

#### Type Declaration

##### invalidEditorOrigin

> `readonly` **invalidEditorOrigin**: `"IGX-1801"` = `"IGX-1801"`

`editorOrigin` is not an origin such as `"ignifx://app"` or `"http://localhost:5173"`.

##### invalidOption

> `readonly` **invalidOption**: `"IGX-1803"` = `"IGX-1803"`

An option is outside its documented domain.

##### noMessageTarget

> `readonly` **noMessageTarget**: `"IGX-1802"` = `"IGX-1802"`

The host was started where there is no `window` to receive the editor's port, and was given no `messageTarget`.

***

### HandshakeMethod

> `const` **HandshakeMethod**: `object`

The method names of the handshake.

#### Type Declaration

##### hello

> `readonly` **hello**: `"hello"` = `"hello"`

Editor → host: the first message on a new channel.

##### ping

> `readonly` **ping**: `"ping"` = `"ping"`

Either direction: a liveness check, answered with `"pong"`.

#### Remarks

`as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).

***

### HostCapability

> `const` **HostCapability**: `object`

The optional features a host lists in its `ready` result.

#### Type Declaration

##### heartbeat

> `readonly` **heartbeat**: `"heartbeat"` = `"heartbeat"`

The host sends `heartbeat` notifications after `ready` (see `HostNotification`).

##### playControls

> `readonly` **playControls**: `"playControls"` = `"playControls"`

The host answers the methods in `PlayMethod`.

#### Remarks

The scene host sends `["heartbeat"]`; the play controls send `["heartbeat", "playControls"]`.

***

### HostKind

> `const` **HostKind**: `object`

Which kind of view a host runs.

#### Type Declaration

##### play

> `readonly` **play**: `"play"` = `"play"`

The play view: the project's own page, running the game.

##### scene

> `readonly` **scene**: `"scene"` = `"scene"`

The scene view: an edit-mode app that applies document ops and draws gizmos.

***

### HostNotification

> `const` **HostNotification**: `object`

The notifications a host sends on its own.

#### Type Declaration

##### heartbeat

> `readonly` **heartbeat**: `"heartbeat"` = `"heartbeat"`

Host → editor, every [DEFAULT\_HEARTBEAT\_INTERVAL\_MS](#default_heartbeat_interval_ms) by default after `ready`: the view is alive.

#### Remarks

`as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).

***

### JSON\_RPC\_VERSION

> `const` **JSON\_RPC\_VERSION**: `"2.0"` = `"2.0"`

The value of every envelope's `jsonrpc` field.

***

### PlayMethod

> `const` **PlayMethod**: `object`

The methods the play view answers after `ready`. Each one answers with a [PlayState](#playstate).

#### Type Declaration

##### pause

> `readonly` **pause**: `"pause"` = `"pause"`

Sets `app.time.paused`; scripts marked `updateWhenPaused` keep running.

##### play

> `readonly` **play**: `"play"` = `"play"`

Clears `app.time.paused` and starts the frame loop if it is stopped.

##### step

> `readonly` **step**: `"step"` = `"step"`

Stops the frame loop, then advances exactly one frame with `app.step()` and leaves the game paused.

##### stop

> `readonly` **stop**: `"stop"` = `"stop"`

Stops the frame loop with `app.stop()`. The editor reloads the view to reset the game.

#### Remarks

A host that answers them lists `HostCapability.playControls` in `ready`. Sent before `ready`, they
fail with `RpcErrorCode.notReady`; sent to a host without them, with `RpcErrorCode.methodNotFound`.

***

### PROTOCOL\_VERSION

> `const` **PROTOCOL\_VERSION**: [`ProtocolVersion`](#protocolversion)

The protocol version this package describes. The editor sends it in `hello` and the host in
`ready`.

***

### RpcErrorCode

> `const` **RpcErrorCode**: `object`

The error codes a peer may send. The first five are JSON-RPC's own; the rest use the range
JSON-RPC reserves for implementations (-32000 to -32099).

#### Type Declaration

##### incompatibleProtocol

> `readonly` **incompatibleProtocol**: `-32000` = `-32_000`

The peers' protocol versions are incompatible (see `protocolVersionIsCompatible`).

##### internalError

> `readonly` **internalError**: `-32603` = `-32_603`

The handler failed.

##### invalidParams

> `readonly` **invalidParams**: `-32602` = `-32_602`

The method exists but its `params` are wrong.

##### invalidRequest

> `readonly` **invalidRequest**: `-32600` = `-32_600`

The message was JSON but not a valid request.

##### methodNotFound

> `readonly` **methodNotFound**: `-32601` = `-32_601`

No handler exists for the method.

##### notReady

> `readonly` **notReady**: `-32001` = `-32_001`

The peer has not finished its handshake and cannot answer this method yet.

##### parseError

> `readonly` **parseError**: `-32700` = `-32_700`

The message was not valid JSON.

#### Remarks

`as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).

## Functions

### isEditorConnectMessage()

> **isEditorConnectMessage**(`value`): `value is EditorConnectMessage`

Tells whether a window message's data is the connect message. It checks the data only; the
caller still checks `event.origin` and that `event.ports` holds exactly one port.

#### Parameters

##### value

`unknown`

The `data` of a received `MessageEvent`.

#### Returns

`value is EditorConnectMessage`

True when `value` is an object whose `type` is [EDITOR\_CONNECT\_MESSAGE\_TYPE](#editor_connect_message_type).

***

### isEditorOrigin()

> **isEditorOrigin**(`value`): `boolean`

**`Beta`**

Tells whether a string is an origin the editor can be served from.

#### Parameters

##### value

`string`

The candidate, for example `"ignifx://app"` or `"http://localhost:5173"`.

#### Returns

`boolean`

`true` when the value is a scheme, `://`, and a host with an optional port.

#### Remarks

`new URL(value).origin` is not usable here: for a scheme Node does not know, such as the
editor's `ignifx://app`, it answers `"null"`, while Chromium reports `ignifx://app` as
`event.origin` because Electron registers the scheme as standard.

***

### isPlayState()

> **isPlayState**(`value`): `value is PlayState`

Checks the `result` of a play method's response.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is PlayState`

True when `value` has boolean `isRunning` and `isPaused` and a non-negative integer
`frameCount`.

***

### isRpcMessage()

> **isRpcMessage**(`value`): `value is RpcMessage`

Checks the envelope of a received message: a request, a notification, or a response. It does not
check a method's `params` or `result`; that is the handler's job.

#### Parameters

##### value

`unknown`

A value parsed from JSON or received through `postMessage`.

#### Returns

`value is RpcMessage`

True when `value` is a well-formed JSON-RPC 2.0 message with a known error code, if any.

***

### protocolVersionIsCompatible()

> **protocolVersionIsCompatible**(`a`, `b`): `boolean`

Tells whether two peers can talk.

#### Parameters

##### a

[`ProtocolVersion`](#protocolversion)

One peer's protocol version.

##### b

[`ProtocolVersion`](#protocolversion)

The other peer's protocol version.

#### Returns

`boolean`

`true` when the versions are on the same compatible line.

#### Remarks

The rule is ADR-E008's: the protocol follows SemVer, and until 1.0 its minor plays the role of the
major, as the engine's minors do. So from 1.0 two peers are compatible when their majors are
equal and the minors are free to differ; before 1.0 the major and the minor must both be equal.
The check is symmetric. Which versions the editor accepts beyond it (ADR-E008 has the editor
support the current protocol line and the previous one) is the editor's decision, not this
function's.

#### Example

```ts
protocolVersionIsCompatible({ major: 0, minor: 2 }, { major: 0, minor: 1 }); // false
protocolVersionIsCompatible({ major: 1, minor: 0 }, { major: 1, minor: 4 }); // true
```

***

### startEditorHost()

> **startEditorHost**(`options`): `Promise`\<[`EditorHost`](#editorhost)\>

**`Beta`**

Starts the scene view's host: listens for the editor's port, creates the app from the project's
own `@ignifx/core` (in edit mode unless `editMode` is `false`), registers the project's scripts,
loads `bootScene` if one is given, and starts the app.

#### Parameters

##### options

[`EditorHostOptions`](#editorhostoptions)

The editor's origin and the project's app options.

#### Returns

`Promise`\<[`EditorHost`](#editorhost)\>

The running host, once the app has started.

#### Remarks

The host answers `hello` with `ready` and `ping` with `"pong"` as soon as a port arrives, even
while the app is still being created, and refuses every other method with `methodNotFound`. It
accepts a new port whenever the editor sends one, closing the previous port.

#### Throws

IgnifxError `IGX-1801` for a malformed `editorOrigin`, `IGX-1802` with no window and no
`messageTarget`, `IGX-1803` for a bad `heartbeatIntervalMs`. Whatever `createApp`, the scene
load, or `start` throws is rethrown after the channel is closed.

#### Example

```ts
import { startEditorHost } from "@ignifx/editor-host";

const host = await startEditorHost({ editorOrigin: "ignifx://app", canvas, extensions: [], scripts });
```

***

### startEditorPlayControls()

> **startEditorPlayControls**(`app`, `options`): [`EditorPlayControls`](#editorplaycontrols)

**`Beta`**

Lets the editor drive a running game: answers the handshake with `hostKind: "play"`, then `play`,
`pause`, `step` and `stop`.

#### Parameters

##### app

`App`

The game's app. The controls never dispose it.

##### options

[`EditorPlayControlsOptions`](#editorplaycontrolsoptions)

The editor's origin and the reporting options.

#### Returns

[`EditorPlayControls`](#editorplaycontrols)

The controls; dispose them to stop listening.

#### Remarks

A game does not call this directly. It calls `attachEditorPlayControls(app)` from
`virtual:ignifx/editor`, which the editor host's Vite plugin serves: in `vite dev` that module
calls this function, and in a production build it is an empty function, so no editor code ships.

#### Throws

IgnifxError `IGX-1801` for a malformed `editorOrigin`, `IGX-1802` with no window and no
`messageTarget`, `IGX-1803` for a bad `heartbeatIntervalMs`.

#### Example

```ts
const controls = startEditorPlayControls(app, { editorOrigin: "ignifx://app" });
controls.dispose();
```

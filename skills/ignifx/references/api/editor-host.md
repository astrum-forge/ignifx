# @ignifx/editor-host

`@ignifx/editor-host` public barrel: the page half of the ignifx editor's host. It runs inside a
project's own dev server, from the project's own `@ignifx/core`, in the editor's scene view and
play view, and speaks the editor protocol over a `MessagePort`
(`docs/architecture/17-editor-host.md`). The Vite plugin is the `@ignifx/editor-host/vite` entry.

Explicit named re-exports only, no `export *` (coding standards §4).

## Interfaces

### AddComponentOp

Adds a component to an entity.

#### Properties

##### component

> `readonly` **component**: [`SceneFileComponent`](#scenefilecomponent)

The component's record; its uid must be new to the document.

##### entity

> `readonly` **entity**: `string`

The entity's uid.

##### index?

> `readonly` `optional` **index?**: `number`

The component's index on the entity; defaults to the end.

##### op

> `readonly` **op**: `"addComponent"`

The discriminant.

***

### AppErrorData

The `data` of a `hostError` the host sends for an error the app reported through `app.onError`:
where it was caught. The host's `message` and `code` are the thrown error's.

#### Remarks

`source`, `phase` and `entity` are in every 0.3 host; the other fields are additive in 0.3, sent by
a host that lists `HostCapability.logRelay`.

#### Properties

##### component?

> `readonly` `optional` **component?**: `string` \| `null`

The `typeId` of the component involved (its class name when it has none), or `null`.

##### entity

> `readonly` **entity**: `string` \| `null`

The uid of the entity involved, or `null`.

##### entityName?

> `readonly` `optional` **entityName?**: `string` \| `null`

The name of the entity involved, or `null`.

##### phase

> `readonly` **phase**: `number` \| `null`

The phase that was running, as the engine's `Phase` value, or `null` outside a phase.

##### phaseName?

> `readonly` `optional` **phaseName?**: `string` \| `null`

That phase's name in the engine's `Phase`, such as `"Update"`, or `null`.

##### source

> `readonly` **source**: `string`

Which boundary caught it: the engine's `ErrorReport.source`, such as `"lifecycle"`.

##### stack?

> `readonly` `optional` **stack?**: `string` \| `null`

The thrown error's `stack`, or `null` when it has none.

***

### ApplyOpFailure

One op the host could not apply.

#### Properties

##### code

> `readonly` **code**: [`ApplyOpFailureCode`](#applyopfailurecode-2)

Why it failed.

##### diagnostic?

> `readonly` `optional` **diagnostic?**: `string`

The engine's diagnostic code, for example `"IGX-0307"`, when the engine reported one.

##### index

> `readonly` **index**: `number`

The op's index in `ApplyOpsParams.ops`.

##### message

> `readonly` **message**: `string`

An actionable sentence.

***

### ApplyOpsParams

The parameters of `applyOps`: one command, as the editor applied it to its document.

#### Properties

##### commandId

> `readonly` **commandId**: `string`

The editor's id for this command, unique on the channel, for correlating logs and failures.

##### commandName

> `readonly` **commandName**: `string`

The command's label, for example `"Move Player"`, for the host's log.

##### ops

> `readonly` **ops**: readonly [`SceneOp`](#sceneop)[]

The ops, in the order they apply. Undo sends the inverse ops; redo sends the ops again.

***

### ApplyOpsResult

The answer to `applyOps`.

#### Remarks

The host applies the ops in order and does not stop at a failure, so `applied + failures.length`
is the number of ops sent. Any failure means the live world no longer mirrors the document; the
editor then sends `openScene` with the whole document again.

#### Properties

##### applied

> `readonly` **applied**: `number`

How many ops were applied.

##### failures

> `readonly` **failures**: readonly [`ApplyOpFailure`](#applyopfailure)[]

The ops that were not, in order.

***

### AssetReloadedParams

The parameters of `assetReloaded`.

#### Remarks

The host reloads an asset in place when the dev server reports it changed on disk and the scene
view's app has it loaded: a scene or prefab (`"scene"`), whose document instances it rebuilds from
the new file with their uids, transforms and overrides, and a model, mesh, material, sprite atlas
or shader, which the renderers pick up on their next frame. Any other type, such as a texture, is
left as it was loaded and sends nothing. The open document's own file is never reloaded.

#### Properties

##### address

> `readonly` **address**: `string`

The asset's address, relative to the asset root.

##### entities

> `readonly` **entities**: readonly `string`[]

The uids of the document's instance roots rebuilt from the new file, in document order: those
that instance it, directly or through another scene. Empty for any other type.

##### type

> `readonly` **type**: `string`

Its asset type, as the manifest records it: `"scene"` for a scene or a prefab.

***

### CreateEntityOp

Creates an entity, optionally with a whole subtree below it. `entity.parent` places it; `index`
is its place among the parent's children (default: last); `descendants` are further records,
parents first.

#### Properties

##### descendants?

> `readonly` `optional` **descendants?**: readonly [`SceneFileEntity`](#scenefileentity)[]

The rest of the subtree, parents first.

##### entity

> `readonly` **entity**: [`SceneFileEntity`](#scenefileentity)

The new entity's record, including its components and, for an instance root, its `instance`.

##### index?

> `readonly` `optional` **index?**: `number`

The entity's index among its siblings; defaults to the end.

##### op

> `readonly` **op**: `"createEntity"`

The discriminant.

***

### DestroyEntityOp

Destroys an entity and its whole subtree.

#### Properties

##### entity

> `readonly` **entity**: `string`

The entity's uid.

##### op

> `readonly` **op**: `"destroyEntity"`

The discriminant.

***

### EditorAssetChange

**`Beta`**

A change on disk to one asset, as `@ignifx/vite-plugin`'s `ignifx:asset-changed` event reports
it; the event's payload is accepted as it is.

#### Properties

##### address

> `readonly` **address**: `string`

**`Beta`**

The asset's address, relative to the asset root.

##### kind

> `readonly` **kind**: `"added"` \| `"changed"` \| `"removed"`

**`Beta`**

What happened to the file.

***

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

##### editorScene

> `readonly` **editorScene**: `SceneInstance`

**`Beta`**

The persistent scene instance named `editor` that holds the host's own objects, such as the
editor camera. It survives every scene the editor opens and is never part of the document.

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

##### assetChanged()

> **assetChanged**(`change`): `Promise`\<`boolean`\>

**`Beta`**

Reloads an asset that changed on disk, in place, through `app.assets.reload`. The generated
scene-view module calls it on every `ignifx:asset-changed` event.

###### Parameters

###### change

[`EditorAssetChange`](#editorassetchange)

The address and what happened to it.

###### Returns

`Promise`\<`boolean`\>

Whether the asset was reloaded; `false` when it was left alone or the reload failed,
which the app reports as an error (`hostError`).

###### Remarks

Only an asset the app has loaded is reloaded, and only one of the types the renderers follow:
a scene or prefab, whose instances in the open document are then rebuilt from the new file with
their uids, transforms and overrides, or a model, mesh, material, sprite atlas or shader, which
the renderers pick up on their next frame. A texture, a removed file and the open document's
own file are left alone. Once the new value is in, the host sends `assetReloaded` with the
address, the type and the rebuilt instance roots, so the editor can compare its document with
the view instead of reloading it.

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

### EditorPlayConnector

**`Beta`**

A play view whose page listens for the editor's port before the game's app exists, so the
editor's first connect message is kept rather than lost.

#### Properties

##### hasPendingPort

> `readonly` **hasPendingPort**: `boolean`

**`Beta`**

Whether a port has arrived and waits for [EditorPlayConnector.attach](#attach).

#### Methods

##### \[dispose\]()

> **\[dispose\]**(): `void`

**`Beta`**

Same as [EditorPlayConnector.dispose](#dispose-3), for `using`.

###### Returns

`void`

##### attach()

> **attach**(`app`): [`EditorPlayControls`](#editorplaycontrols)

**`Beta`**

Starts the play controls for the game's app on the port that has arrived, if any, and from
then on on every new one. Only the first call takes the waiting port; a later call, or one after
`dispose`, opens controls that wait for the editor's next port.

###### Parameters

###### app

`App`

The game's app. The controls never dispose it.

###### Returns

[`EditorPlayControls`](#editorplaycontrols)

The controls.

##### dispose()

> **dispose**(): `void`

**`Beta`**

Stops listening, closes a waiting port, and disposes the controls it attached. Idempotent.

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

Same as [EditorPlayControls.dispose](#dispose-5), for `using`.

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

### EntityFieldValues

The entity properties [SetEntityFieldOp](#setentityfieldop) writes, and their value types.

#### Properties

##### active

> `readonly` **active**: `boolean`

`false` deactivates the entity and its subtree.

##### layer

> `readonly` **layer**: `string`

The layer name; `"Default"` is the default.

##### name

> `readonly` **name**: `string`

The display name.

##### static

> `readonly` **static**: `boolean`

The static flag.

##### tags

> `readonly` **tags**: readonly `string`[]

The tags; stored deduplicated and sorted, as the serializer writes them.

***

### EntitySelection

A selection: the parameters and the answer of `select`, and the parameters of `selectionChanged`.

#### Properties

##### entities

> `readonly` **entities**: readonly `string`[]

The selected entities' uids. The last one is the primary selection, which the gizmo follows.

***

### FrameParams

The parameters of `frame`.

#### Properties

##### entities

> `readonly` **entities**: readonly `string`[] \| `"all"`

The entities to fit in the view, or `"all"` for the whole open scene.

***

### GizmoSnap

The gizmo's snapping increments. `0` turns snapping off for that mode.

#### Properties

##### rotate

> `readonly` **rotate**: `number`

The rotation step, in degrees.

##### scale

> `readonly` **scale**: `number`

The scale step, as a factor added per step (`0.1` snaps scale to tenths).

##### translate

> `readonly` **translate**: `number`

The translation step, in metres.

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

[`RpcRequest`](#rpcrequest).[`jsonrpc`](#jsonrpc-5)

##### method

> `readonly` **method**: `"hello"`

The method to call.

###### Inherited from

[`RpcRequest`](#rpcrequest).[`method`](#method-4)

##### params

> `readonly` **params**: [`HelloParams`](#helloparams)

What the editor says about itself.

###### Overrides

[`RpcRequest`](#rpcrequest).[`params`](#params-4)

***

### HostErrorParams

The parameters of `hostError`.

#### Properties

##### code

> `readonly` **code**: `string` \| `null`

The engine's `IGX-` code, or `null` when the error had none.

##### data?

> `readonly` `optional` **data?**: [`JsonValue`](#jsonvalue)

Extra detail as JSON, when there is any.

##### message

> `readonly` **message**: `string`

An actionable sentence.

***

### HotReloadedParams

The parameters of `hotReloaded`.

#### Properties

##### report

> `readonly` **report**: [`HotReloadReport`](#hotreloadreport)

The report `app.hotReload.onApplied` emitted.

***

### HotReloadError

One error a hot reload ran into.

#### Properties

##### code

> `readonly` **code**: `string` \| `null`

Its `IGX-` code when it is an `IgnifxError`, else `null`.

##### message

> `readonly` **message**: `string`

The error's message (`String(error)` when it is not an `Error`).

##### stack?

> `readonly` `optional` **stack?**: `string` \| `null`

Its `stack`, or `null` when it has none. Additive in 0.3: a host from before it leaves it out.

***

### HotReloadReport

What one hot reload did: the engine's `HotReloadReport`, with its errors made JSON.

#### Properties

##### durationMs

> `readonly` **durationMs**: `number`

How long it took, in milliseconds.

##### errors

> `readonly` **errors**: readonly [`HotReloadError`](#hotreloaderror)[]

Everything that threw on the way.

##### instances

> `readonly` **instances**: `number`

How many live component instances were swapped or re-created, or entities rebuilt.

##### kind

> `readonly` **kind**: `"scene"` \| `"patch"` \| `"recreate"`

Which operation: a prototype swap, a recreate of instances, or a scene rebuild.

##### typeIds

> `readonly` **typeIds**: readonly `string`[]

The `typeId`s reloaded, in the order applied.

***

### IncompatibleProtocolData

The `data` of the `RpcErrorCode.incompatibleProtocol` error a host answers `hello` with when
the protocol versions differ.

#### Properties

##### engineVersion

> `readonly` **engineVersion**: `string`

The version of `@ignifx/core` the project runs.

##### host

> `readonly` **host**: [`ProtocolVersion`](#protocolversion)

The protocol version the host speaks.

***

### InstantiateOp

Creates an instance root: an entity carrying an `instance` entry.

#### Properties

##### entity

> `readonly` **entity**: `string`

The new entity's uid.

##### index?

> `readonly` `optional` **index?**: `number`

Its index among its siblings; defaults to the end.

##### instance

> `readonly` **instance**: [`SceneFileInstance`](#scenefileinstance)

The instance entry: the scene asset, its hash, and any overrides.

##### name

> `readonly` **name**: `string`

Its name; usually the prefab root's name.

##### op

> `readonly` **op**: `"instantiate"`

The discriminant.

##### parent

> `readonly` **parent**: `string` \| `null`

Its parent's uid, or `null` for a root.

##### transform

> `readonly` **transform**: [`SceneFileTransform`](#scenefiletransform)

Its local transform.

***

### InvalidSceneFileData

The `data` of the `invalidParams` error `openScene` answers when `validateSceneFile` refuses the
file.

#### Properties

##### issues

> `readonly` **issues**: readonly [`SceneFileIssue`](#scenefileissue)[]

What `validateSceneFile` reported.

***

### LoggedError

An `Error` a log line carried among its extras, made JSON.

#### Properties

##### code

> `readonly` **code**: `string` \| `null`

Its `IGX-` code when it is an `IgnifxError`, else `null`.

##### message

> `readonly` **message**: `string`

The error's message.

##### stack

> `readonly` **stack**: `string` \| `null`

Its `stack`, or `null` when it has none.

***

### LogParams

The parameters of `log`: the engine's `LogRecord` without its `data`, which is not JSON, but for
the first `Error` in it.

#### Properties

##### error?

> `readonly` `optional` **error?**: [`LoggedError`](#loggederror)

The first `Error` among the record's extras, such as the one the app's default `onError` handler
logs. Additive in 0.3: a host from before it leaves it out.

##### level

> `readonly` **level**: [`LogLevel`](#loglevel)

The severity.

##### message

> `readonly` **message**: `string`

The message.

##### scope

> `readonly` **scope**: `string` \| `null`

The logger's dotted scope, or `null` for the root logger.

##### timeMs

> `readonly` **timeMs**: `number`

The logger clock's reading, in milliseconds.

***

### OpenSceneParams

The parameters of `openScene`.

#### Properties

##### address

> `readonly` **address**: `string` \| `null`

The asset address the document is saved at, for example `"scenes/level01.scene.json"`, or
`null` for a document that has never been saved. The host names the scene's asset with it and
never loads the file from it.

##### file

> `readonly` **file**: [`SceneFile`](#scenefile)

The whole scene file, as the editor's document holds it: the engine's `SceneFile` object, not
its text. It may differ from the file on disk (unsaved edits), so it is the only source the
host builds from.

***

### OpenSceneResult

The answer to `openScene`, once every entity is built.

#### Properties

##### entityCount

> `readonly` **entityCount**: `number`

How many entities the host built, including those expanded from instanced scenes.

##### viewMode?

> `readonly` `optional` **viewMode?**: [`ViewMode`](#viewmode-3)

The editor camera the scene is made for, as the host's engine sees it: `"2d"` when the project
draws sprites only (`twoD.mode: "sprite"`) or the scene's cameras are all `Camera2D`, else
`"3d"`. The host does not switch to it; the editor sends `setViewMode`. Absent from a host from
before it.

##### warnings

> `readonly` **warnings**: readonly [`SceneIssue`](#sceneissue)[]

Every recoverable problem the build reported, in order (`SceneBuildResult.issues`).

***

### PickParams

The parameters of `pick`.

#### Properties

##### unit

> `readonly` **unit**: [`PickUnit`](#pickunit-1)

The unit of `x` and `y`; the host converts it to whatever its engine's picker takes.

##### x

> `readonly` **x**: `number`

The point's x, from the view's left edge, in `unit`.

##### y

> `readonly` **y**: `number`

The point's y, from the view's top edge, in `unit`.

***

### PickRay

A world-space ray from the view's camera through a point of the view.

#### Properties

##### direction

> `readonly` **direction**: [`Vec3`](#vec3)

Which way it points: a unit vector.

##### origin

> `readonly` **origin**: [`Vec3`](#vec3)

Where the ray starts, in metres: the point under the cursor on the camera's near plane.

***

### PickResult

The answer to `pick`.

#### Properties

##### distance

> `readonly` **distance**: `number` \| `null`

How far along the camera ray the hit is, in metres, or `null` for a miss or a 2D pick.

##### entity

> `readonly` **entity**: `string` \| `null`

The scene entity hit, or `null` for a miss. A hit inside an instanced scene names its instance root.

##### plane?

> `readonly` `optional` **plane?**: [`Vec3`](#vec3)

Where `ray` meets the 2D world plane `z = 0`, as `[x, y, 0]`: in a 2D scene, the world point
under the cursor. Absent when `ray` is, and when the ray runs parallel to the plane or meets it
behind its origin.

##### point

> `readonly` **point**: [`Vec3`](#vec3) \| `null`

The world-space hit point, or `null` for a miss or when the picker does not report one.

##### ray?

> `readonly` `optional` **ray?**: [`PickRay`](#pickray)

The ray the view's camera casts through the point, hit or miss, so that an editor can place
something where nothing was hit (a 3D editor intersects it with its ground plane, `y = 0`).
Absent when the host builds no ray (a headless view, a point outside the canvas) and from a host
from before it.

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

### PlayStateChangedNotification

Play view → editor: the game's state changed.

#### Extends

- [`RpcNotification`](#rpcnotification)\<*typeof* [`playStateChanged`](#playstatechanged), [`PlayStateReport`](#playstatereport)\>

#### Properties

##### jsonrpc

> `readonly` **jsonrpc**: `"2.0"`

Always `"2.0"`.

###### Inherited from

[`RpcNotification`](#rpcnotification).[`jsonrpc`](#jsonrpc-3)

##### method

> `readonly` **method**: `"playStateChanged"`

The event or method being signalled.

###### Inherited from

[`RpcNotification`](#rpcnotification).[`method`](#method-2)

##### params

> `readonly` **params**: [`PlayStateReport`](#playstatereport)

The game's state after the change.

###### Overrides

[`RpcNotification`](#rpcnotification).[`params`](#params-2)

***

### PlayStateReport

The game's state as `playState` answers it and `playStateChanged` reports it.

#### Properties

##### frameCount

> `readonly` **frameCount**: `number`

How many frames have started (`app.time.frameCount`).

##### state

> `readonly` **state**: [`PlayPhase`](#playphase-1)

Whether the game plays, is paused, or is stopped.

##### time

> `readonly` **time**: `number`

Scaled seconds of game time since the app started running frames (`app.time.time`).

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

### ReadBackParams

The parameters of `readBack`.

#### Properties

##### entities?

> `readonly` `optional` **entities?**: readonly `string`[]

The entities to serialize; absent for every entity of the open scene.

***

### ReadBackResult

The answer to `readBack`: the open scene's entities as `serializeScene` writes them from the live
world, which is what the document should hold when the mirror is exact.

#### Properties

##### entities

> `readonly` **entities**: readonly [`SceneFileEntity`](#scenefileentity)[]

The entity records, in tree order, as `serializeScene` writes them.

##### issues

> `readonly` **issues**: readonly [`SceneIssue`](#sceneissue)[]

What the serializer reported (`SerializeIssue`), in order.

##### missing

> `readonly` **missing**: readonly `string`[]

The requested uids that name no entity of the open scene, in request order.

##### settings

> `readonly` **settings**: [`JsonObject`](#jsonobject) \| `null`

The scene's `settings`, or `null` when it has none.

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

### RemoveComponentOp

Removes a component.

#### Properties

##### component

> `readonly` **component**: `string`

The component's uid.

##### op

> `readonly` **op**: `"removeComponent"`

The discriminant.

***

### RemoveOverrideOp

Removes an override from an instance root's entry.

#### Properties

##### added?

> `readonly` `optional` **added?**: `string`

For a component `add`, the uid of the component it adds.

##### entity

> `readonly` **entity**: `string`

The instance root's uid.

##### op

> `readonly` **op**: `"removeOverride"`

The discriminant.

##### overrideOp?

> `readonly` `optional` **overrideOp?**: `"replace"` \| `"remove"` \| `"add"`

The override's `op`; defaults to what the path implies.

##### path

> `readonly` **path**: `string`

The override's path.

***

### ReorderOp

Moves an entity among its siblings; `index` is its place after the move.

#### Properties

##### entity

> `readonly` **entity**: `string`

The entity's uid.

##### index

> `readonly` **index**: `number`

The new index among its siblings.

##### op

> `readonly` **op**: `"reorder"`

The discriminant.

***

### ReparentOp

Moves an entity under another parent, keeping its local transform.

#### Properties

##### entity

> `readonly` **entity**: `string`

The entity's uid.

##### index?

> `readonly` `optional` **index?**: `number`

The entity's index among its new siblings; defaults to the end.

##### op

> `readonly` **op**: `"reparent"`

The discriminant.

##### parent

> `readonly` **parent**: `string` \| `null`

The new parent's uid, or `null` to make the entity a root.

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

#### Extended by

- [`PlayStateChangedNotification`](#playstatechangednotification)
- [`RpcNotificationWithParams`](#rpcnotificationwithparams)

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

### RpcNotificationWithParams

A notification whose `params` are required.

#### Extends

- [`RpcNotification`](#rpcnotification)\<`M`, `P`\>

#### Type Parameters

##### M

`M` *extends* `string`

The method name.

##### P

`P`

The parameters.

#### Properties

##### jsonrpc

> `readonly` **jsonrpc**: `"2.0"`

Always `"2.0"`.

###### Inherited from

[`RpcNotification`](#rpcnotification).[`jsonrpc`](#jsonrpc-3)

##### method

> `readonly` **method**: `M`

The event or method being signalled.

###### Inherited from

[`RpcNotification`](#rpcnotification).[`method`](#method-2)

##### params

> `readonly` **params**: `P`

The notification's parameters.

###### Overrides

[`RpcNotification`](#rpcnotification).[`params`](#params-2)

***

### RpcRequest

A call that expects a response with the same `id`.

#### Extended by

- [`HelloRequest`](#hellorequest)
- [`RpcRequestWithParams`](#rpcrequestwithparams)

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

### RpcRequestWithParams

A request whose `params` are required.

#### Extends

- [`RpcRequest`](#rpcrequest)\<`M`, `P`\>

#### Type Parameters

##### M

`M` *extends* `string`

The method name.

##### P

`P`

The parameters.

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

[`RpcRequest`](#rpcrequest).[`jsonrpc`](#jsonrpc-5)

##### method

> `readonly` **method**: `M`

The method to call.

###### Inherited from

[`RpcRequest`](#rpcrequest).[`method`](#method-4)

##### params

> `readonly` **params**: `P`

The method's parameters.

###### Overrides

[`RpcRequest`](#rpcrequest).[`params`](#params-4)

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

### SceneFile

A whole scene or prefab file. The engine's `SceneFile`.

#### Properties

##### engineVersion?

> `readonly` `optional` **engineVersion?**: `string`

The `@ignifx/core` version that wrote the file; informational.

##### entities

> `readonly` **entities**: readonly [`SceneFileEntity`](#scenefileentity)[]

Every entity, in tree order: parents before children, siblings in order.

##### format

> `readonly` **format**: `string`

Always `"ignifx.scene"`.

##### formatVersion

> `readonly` **formatVersion**: `number`

`1` for every file the engine writes before 1.0.

##### name

> `readonly` **name**: `string`

The scene's name.

##### settings?

> `readonly` `optional` **settings?**: [`JsonObject`](#jsonobject)

Scene-level values interpreted by systems.

***

### SceneFileAssetRef

A serialized asset reference: `{ "$asset": "<address>", "type"?: "<type>" }`. The engine's
`SceneFileAssetRef`.

#### Properties

##### $asset

> `readonly` **$asset**: `string`

The address the asset is registered under.

##### type?

> `readonly` `optional` **type?**: `string`

The asset type name, written only when the address extension does not identify it.

***

### SceneFileComponent

One component of one entity. The engine's `SceneFileComponent`.

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: `boolean`

Omitted when `true`, the default.

##### props?

> `readonly` `optional` **props?**: [`JsonObject`](#jsonobject)

Values in the component schema's declaration order.

##### schemaVersion?

> `readonly` `optional` **schemaVersion?**: `number`

Written only when the class's `schemaVersion` differs from `1`.

##### type

> `readonly` **type**: `string`

The component class's registered `typeId`.

##### uid

> `readonly` **uid**: `string`

ULID, unique within the file.

***

### SceneFileEntity

One entity of a scene file. The engine's `SceneFileEntity`.

#### Properties

##### active?

> `readonly` `optional` **active?**: `boolean`

Omitted when `true`, the default.

##### components?

> `readonly` `optional` **components?**: readonly [`SceneFileComponent`](#scenefilecomponent)[]

The entity's own components; on an instance root, the ones added on top of the instance.

##### instance?

> `readonly` `optional` **instance?**: [`SceneFileInstance`](#scenefileinstance)

Present only on instance roots.

##### layer?

> `readonly` `optional` **layer?**: `string`

The layer name, omitted when `"Default"`.

##### name

> `readonly` **name**: `string`

The display name.

##### parent

> `readonly` **parent**: `string` \| `null`

The parent's uid, or `null` for a root.

##### static?

> `readonly` `optional` **static?**: `boolean`

Omitted when `false`, the default.

##### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

The tags, omitted when empty.

##### transform

> `readonly` **transform**: [`SceneFileTransform`](#scenefiletransform)

Always present.

##### uid

> `readonly` **uid**: `string`

ULID, unique within the file.

***

### SceneFileInstance

The `instance` entry that makes an entity the root of an instanced scene (a prefab instance).
The engine's `SceneFileInstance`.

#### Properties

##### hash?

> `readonly` `optional` **hash?**: `string`

The content hash of that asset at save time.

##### overrides?

> `readonly` `optional` **overrides?**: readonly [`SceneFileOverride`](#scenefileoverride)[]

The patches applied to the instanced entities, in order.

##### scene

> `readonly` **scene**: [`SceneFileAssetRef`](#scenefileassetref)

The scene asset to instance.

***

### SceneFileIssue

One structural problem in a scene file: the engine's `SceneFileIssue`, from `validateSceneFile`.

#### Properties

##### message

> `readonly` **message**: `string`

An actionable description.

##### path

> `readonly` **path**: `string`

Where the problem is, for example `"entities/3/transform"`.

***

### SceneFileOverride

One override patch applied to an instanced scene. The engine's `SceneFileOverride`.

#### Properties

##### op?

> `readonly` `optional` **op?**: `"replace"` \| `"remove"` \| `"add"`

`"replace"` (the default) patches a value, `"remove"` deletes a component, `"add"` appends one.

##### path

> `readonly` **path**: `string`

The path into the instanced file, in the engine's override path grammar.

##### value?

> `readonly` `optional` **value?**: [`JsonValue`](#jsonvalue)

The new value, for `"replace"` and `"add"`.

***

### SceneFileTransform

An entity's local transform. The engine's `SceneFileTransform`.

#### Properties

##### position

> `readonly` **position**: readonly \[`number`, `number`, `number`\]

Local position, `[x, y, z]`, in metres.

##### rotation

> `readonly` **rotation**: readonly \[`number`, `number`, `number`, `number`\]

Local rotation quaternion, `[x, y, z, w]`.

##### scale

> `readonly` **scale**: readonly \[`number`, `number`, `number`\]

Local scale, `[x, y, z]`.

***

### SceneIssue

One recoverable problem the engine reported while building or serializing a scene: the engine's
`SceneLoadIssue` and `SerializeIssue`.

#### Properties

##### code

> `readonly` **code**: `string`

The engine's diagnostic code, for example `"IGX-0602"`.

##### message

> `readonly` **message**: `string`

The engine's actionable sentence.

***

### SceneOpenedParams

The parameters of `sceneOpened`.

#### Properties

##### address

> `readonly` **address**: `string` \| `null`

The address `openScene` was given.

##### entityCount

> `readonly` **entityCount**: `number`

As in [OpenSceneResult](#opensceneresult).

##### name

> `readonly` **name**: `string`

The file's `name`.

##### viewMode?

> `readonly` `optional` **viewMode?**: [`ViewMode`](#viewmode-3)

As in [OpenSceneResult](#opensceneresult).

##### warnings

> `readonly` **warnings**: readonly [`SceneIssue`](#sceneissue)[]

As in [OpenSceneResult](#opensceneresult).

***

### SchemaDescription

One component schema: the engine's `SchemaDescription`, plus the JSON Schema of its `props`.

#### Properties

##### allowMultiple?

> `readonly` `optional` **allowMultiple?**: `boolean`

Whether an entity may hold more than one of the component (the class's `static allowMultiple`,
`true` when it declares nothing); absent on file-format entries and from a host from before
core's `describeRegisteredSchemas`, where an editor assumes `true`.

##### builtIn?

> `readonly` `optional` **builtIn?**: `boolean`

`true` for the one component every entity carries itself, `ignifx/Transform`: it is never in a
scene file's `components` list, an editor neither adds nor removes it, and its fields are the
entity record's `transform` block, edited whole with the `setTransform` op rather than prop by
prop. Absent on every other entry. A host from before the engine described the transform (engine
ask E4) sends no such member.

##### description?

> `readonly` `optional` **description?**: `string`

A one-line summary.

##### fields

> `readonly` **fields**: `Readonly`\<`Record`\<`string`, [`SchemaFieldDescription`](#schemafielddescription)\>\>

Every declared field, in declaration order.

##### format

> `readonly` **format**: `string`

`"components"` for a component; a file format's name for the engine's file-format entries.

##### package?

> `readonly` `optional` **package?**: `string`

Who registered the component: the extension's `name` (the npm package name, for example
`@ignifx/3d`), or, for a class the game registered itself, its type id's namespace (`game` for
`game/Health`); absent on file-format entries and from a host from before
`describeRegisteredSchemas`.

##### propsSchema?

> `readonly` `optional` **propsSchema?**: [`JsonObject`](#jsonobject)

The JSON Schema of the component's `props` (the engine's `toJsonSchema(schema)`), which adds
each field's `minimum`, `maximum`, `enum` and nested shapes; absent for file-format entries.

##### title

> `readonly` **title**: `string`

The human-readable name.

***

### SchemaFieldDescription

One field of a component schema: the engine's `SchemaFieldDescription`.

#### Properties

##### assetType?

> `readonly` `optional` **assetType?**: `string`

An `asset` field's asset type name (`asset(TextureAsset)` → `"texture"`), the `type` an asset
reference to it carries; absent when the asset token names no type.

##### componentType?

> `readonly` `optional` **componentType?**: `string` \| `null`

A `componentRef` field's accepted component, as its `typeId`, or `null` when the class it was
declared with carries no `typeId`; present on every `componentRef` field a 0.3 host describes
with core's `describeRegisteredSchemas`.

##### default?

> `readonly` `optional` **default?**: [`JsonValue`](#jsonvalue)

The field's default value, encoded as JSON.

##### description?

> `readonly` `optional` **description?**: `string`

The field's tooltip.

##### group?

> `readonly` `optional` **group?**: `string`

`FieldOptions.group`: the inspector group the field folds into.

##### hidden?

> `readonly` `optional` **hidden?**: `boolean`

`FieldOptions.hidden`: the inspector leaves the field out; it is still saved.

##### kind

> `readonly` **kind**: `string`

The field kind, for example `"f32"` or `"asset"`; an editor shows a kind it does not know as JSON.

##### readonly?

> `readonly` `optional` **readonly?**: `boolean`

`FieldOptions.readonly`: the inspector shows the field but does not let it be edited.

##### step?

> `readonly` `optional` **step?**: `number`

The increment of the inspector's drag and spinner controls (`FieldOptions.step`), present only
when the field declares one; in degrees for a `quat` field, which an inspector edits as Euler
angles.

***

### SchemaSet

Every schema the host's app knows: the answer to `getSchemas` and the parameters of
`schemasChanged`.

#### Properties

##### schemas

> `readonly` **schemas**: `Readonly`\<`Record`\<`string`, [`SchemaDescription`](#schemadescription)\>\>

The descriptions, keyed by component `typeId` (file formats by `ignifx/<format>-file`).

***

### ScreenshotParams

The parameters of `screenshot`.

#### Properties

##### format

> `readonly` **format**: [`ScreenshotFormat`](#screenshotformat-1)

The image format.

##### height?

> `readonly` `optional` **height?**: `number`

The image height in pixels, 1 to [SCREENSHOT\_MAX\_SIZE](#screenshot_max_size); absent to follow the view.

##### quality?

> `readonly` `optional` **quality?**: `number`

The JPEG quality, from 0 to 1; the host's default (0.9) when absent. Ignored for PNG.

##### width?

> `readonly` `optional` **width?**: `number`

The image width in pixels, 1 to [SCREENSHOT\_MAX\_SIZE](#screenshot_max_size); absent to follow the view.

***

### ScreenshotResult

The answer to `screenshot`.

#### Properties

##### dataUrl

> `readonly` **dataUrl**: `string`

The image as a `data:image/png;base64,…` or `data:image/jpeg;base64,…` URL.

##### height

> `readonly` **height**: `number`

The image height in pixels.

##### width

> `readonly` **width**: `number`

The image width in pixels.

***

### SetGizmoParams

The parameters of `setGizmo`.

#### Properties

##### mode

> `readonly` **mode**: [`GizmoMode`](#gizmomode-1)

What the gizmo does.

##### snap

> `readonly` **snap**: [`GizmoSnap`](#gizmosnap) \| `null`

The snapping increments, or `null` for no snapping.

##### space

> `readonly` **space**: [`GizmoSpace`](#gizmospace-1)

Which axes it follows.

***

### SetOverrideOp

Sets an override on an instance root's entry, replacing the override with the same identity or
inserting a new one at `index` (default: last).

#### Properties

##### entity

> `readonly` **entity**: `string`

The instance root's uid.

##### index?

> `readonly` `optional` **index?**: `number`

Where a new override goes; defaults to the end.

##### op

> `readonly` **op**: `"setOverride"`

The discriminant.

##### override

> `readonly` **override**: [`SceneFileOverride`](#scenefileoverride)

The override.

***

### SetPropOp

Sets, or removes, a value inside a component's `props`. `path[0]` is the field name; an absent
`value` removes the key; the empty path addresses `props` itself.

#### Properties

##### component

> `readonly` **component**: `string`

The component's uid.

##### op

> `readonly` **op**: `"setProp"`

The discriminant.

##### path

> `readonly` **path**: [`JsonPath`](#jsonpath)

The path into `props`.

##### value?

> `readonly` `optional` **value?**: [`JsonValue`](#jsonvalue)

The new value; absent removes the key.

***

### SetSceneSettingOp

Sets, or removes, a value inside the scene's `settings`, with [SetPropOp](#setpropop)'s path rules.

#### Properties

##### op

> `readonly` **op**: `"setSceneSetting"`

The discriminant.

##### path

> `readonly` **path**: [`JsonPath`](#jsonpath)

The path into `settings`; `path[0]` is the setting's key.

##### value?

> `readonly` `optional` **value?**: [`JsonValue`](#jsonvalue)

The new value; absent removes the key.

***

### SettingsSet

The project's settings as the host's app has them: the answer to `describeSettings`.

#### Properties

##### sections

> `readonly` **sections**: `Readonly`\<`Record`\<`string`, [`SchemaDescription`](#schemadescription)\>\>

Every settings section the app registered (core's and each extension's), keyed by section name,
in registration order: the engine's `describeSettings(app)`. Each has `format: "settings"`, the
registering extension as `package`, field defaults in the settings form (a vector is
`{ x, y, z }` and a colour `{ r, g, b, a }`, not the scene file's arrays), and as `propsSchema`
the JSON Schema of the section as `ignifx.settings.json` may write it (its entry in the engine's
`settingsJsonSchema(app)`).

##### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, [`JsonObject`](#jsonobject)\>\>

The values the app resolved for each section, keyed by section name, in the same settings form:
the project's settings over the section's defaults. A value JSON cannot carry (a function, a
non-finite number) is left out.

***

### SetTransformOp

Sets an entity's local transform. `before` is informational and ignored when applying.

#### Properties

##### after

> `readonly` **after**: [`SceneFileTransform`](#scenefiletransform)

The new local transform.

##### before?

> `readonly` `optional` **before?**: [`SceneFileTransform`](#scenefiletransform)

The local transform the emitter saw before the change; ignored when applying.

##### entity

> `readonly` **entity**: `string`

The entity's uid.

##### op

> `readonly` **op**: `"setTransform"`

The discriminant.

***

### SetViewModeParams

The parameters of `setViewMode`.

#### Properties

##### mode

> `readonly` **mode**: [`ViewMode`](#viewmode-3)

The editor camera to use.

***

### StepParams

The parameters of the `step` method.

#### Properties

##### deltaSeconds?

> `readonly` `optional` **deltaSeconds?**: `number`

The frame delta in seconds, a positive finite number. Defaults to `app.time.fixedDeltaTime`;
any other value fails with `RpcErrorCode.invalidParams`.

***

### TransformDraggedParams

The parameters of `transformDragged`: the shape of a `setTransform` op plus the drag's mode.

#### Properties

##### after

> `readonly` **after**: [`SceneFileTransform`](#scenefiletransform)

Its local transform at pointer-up.

##### before

> `readonly` **before**: [`SceneFileTransform`](#scenefiletransform)

Its local transform when the drag started.

##### entity

> `readonly` **entity**: `string`

The dragged entity's uid.

##### mode

> `readonly` **mode**: [`GizmoDragMode`](#gizmodragmode)

The gizmo mode of the drag, for the command's name.

***

### TransformDraggingParams

The parameters of `transformDragging`.

#### Properties

##### after

> `readonly` **after**: [`SceneFileTransform`](#scenefiletransform)

Its local transform now, rounded as the engine writes numbers.

##### entity

> `readonly` **entity**: `string`

The dragged entity's uid.

##### mode

> `readonly` **mode**: [`GizmoDragMode`](#gizmodragmode)

The gizmo mode of the drag.

## Type Aliases

### ApplyOpFailureCode

> **ApplyOpFailureCode** = *typeof* [`ApplyOpFailureCode`](#applyopfailurecode-1)\[keyof *typeof* [`ApplyOpFailureCode`](#applyopfailurecode-1)\]

The union of the codes in `ApplyOpFailureCode`.

***

### ApplyOpsResponse

> **ApplyOpsResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`ApplyOpsResult`](#applyopsresult)\>

The success answer to `applyOps`.

***

### DescribeSettingsResponse

> **DescribeSettingsResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`SettingsSet`](#settingsset)\>

The success answer to `describeSettings`.

***

### EditorHostErrorCode

> **EditorHostErrorCode** = *typeof* [`EditorHostErrorCode`](#editorhosterrorcode)\[keyof *typeof* [`EditorHostErrorCode`](#editorhosterrorcode)\]

**`Beta`**

The union of the codes in `EditorHostErrorCode`.

***

### EntityField

> **EntityField** = keyof [`EntityFieldValues`](#entityfieldvalues)

The name of an entity property [SetEntityFieldOp](#setentityfieldop) writes.

***

### GetSchemasResponse

> **GetSchemasResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`SchemaSet`](#schemaset)\>

The success answer to `getSchemas`.

***

### GizmoDragMode

> **GizmoDragMode** = `Exclude`\<[`GizmoMode`](#gizmomode-1), *typeof* [`none`](#none)\>

The gizmo modes a drag can happen in: every `GizmoMode` but `none`.

***

### GizmoMode

> **GizmoMode** = *typeof* [`GizmoMode`](#gizmomode)\[keyof *typeof* [`GizmoMode`](#gizmomode)\]

The union of the modes in `GizmoMode`.

***

### GizmoSpace

> **GizmoSpace** = *typeof* [`GizmoSpace`](#gizmospace)\[keyof *typeof* [`GizmoSpace`](#gizmospace)\]

The union of the spaces in `GizmoSpace`.

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

### JsonArray

> **JsonArray** = readonly [`JsonValue`](#jsonvalue)[]

A JSON array. The engine's `JsonArray`.

***

### JsonObject

> **JsonObject** = `object`

A JSON object. The engine's `JsonObject`.

#### Index Signature

\[`key`: `string`\]: [`JsonValue`](#jsonvalue)

***

### JsonPath

> **JsonPath** = readonly (`string` \| `number`)[]

A path into a JSON object: object keys as strings, array indices as whole numbers.

***

### JsonValue

> **JsonValue** = `string` \| `number` \| `boolean` \| `null` \| [`JsonArray`](#jsonarray) \| [`JsonObject`](#jsonobject)

Any JSON value. The engine's `JsonValue`.

***

### LogLevel

> **LogLevel** = `"debug"` \| `"info"` \| `"warn"` \| `"error"`

A log line's severity: the engine's `LogLevel`.

***

### NullResponse

> **NullResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<`null`\>

The success answer of the `SceneMethod`s that return nothing: `closeScene`, `setGizmo`, `frame`
and `setViewMode`.

***

### OpenSceneResponse

> **OpenSceneResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`OpenSceneResult`](#opensceneresult)\>

The success answer to `openScene`.

***

### PickResponse

> **PickResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`PickResult`](#pickresult)\>

The success answer to `pick`.

***

### PickUnit

> **PickUnit** = *typeof* [`PickUnit`](#pickunit)\[keyof *typeof* [`PickUnit`](#pickunit)\]

The union of the units in `PickUnit`.

***

### PingRequest

> **PingRequest** = [`RpcRequest`](#rpcrequest)\<*typeof* [`ping`](#ping), `never`\>

Either direction: a liveness check. It takes no parameters.

***

### PlayMethod

> **PlayMethod** = *typeof* [`PlayMethod`](#playmethod)\[keyof *typeof* [`PlayMethod`](#playmethod)\]

The union of the names in `PlayMethod`.

***

### PlayNotification

> **PlayNotification** = *typeof* [`PlayNotification`](#playnotification)\[keyof *typeof* [`PlayNotification`](#playnotification)\]

The union of the names in `PlayNotification`.

***

### PlayPhase

> **PlayPhase** = *typeof* [`PlayPhase`](#playphase)\[keyof *typeof* [`PlayPhase`](#playphase)\]

The union of the names in `PlayPhase`.

***

### PlayRequest

> **PlayRequest** = [`RpcRequest`](#rpcrequest)\<*typeof* [`play`](#play-1), `never`\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`pause`](#pause), `never`\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`step`](#step), [`StepParams`](#stepparams)\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`stop`](#stop), `never`\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`playState`](#playstate), `never`\>

Editor → play view: one of the `PlayMethod`s. Only `step` takes parameters.

***

### PlayResponse

> **PlayResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`PlayState`](#playstate-1)\>

Play view → editor: the answer to `play`, `pause`, `step` or `stop`.

***

### PlayStateResponse

> **PlayStateResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`PlayStateReport`](#playstatereport)\>

Play view → editor: the answer to `playState`.

***

### PongResponse

> **PongResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<`"pong"`\>

The answer to [PingRequest](#pingrequest).

***

### ReadBackResponse

> **ReadBackResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`ReadBackResult`](#readbackresult)\>

The success answer to `readBack`.

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

***

### SceneHostNotification

> **SceneHostNotification** = [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`sceneOpened`](#sceneopened), [`SceneOpenedParams`](#sceneopenedparams)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`schemasChanged`](#schemaschanged), [`SchemaSet`](#schemaset)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`hotReloaded`](#hotreloaded-1), [`HotReloadedParams`](#hotreloadedparams)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`selectionChanged`](#selectionchanged), [`EntitySelection`](#entityselection)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`transformDragging`](#transformdragging), [`TransformDraggingParams`](#transformdraggingparams)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`transformDragged`](#transformdragged), [`TransformDraggedParams`](#transformdraggedparams)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`hostError`](#hosterror-1), [`HostErrorParams`](#hosterrorparams)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`log`](#log-1), [`LogParams`](#logparams)\> \| [`RpcNotificationWithParams`](#rpcnotificationwithparams)\<*typeof* [`assetReloaded`](#assetreloaded), [`AssetReloadedParams`](#assetreloadedparams)\>

Scene host → editor: one of the `SceneNotification`s.

***

### SceneMethod

> **SceneMethod** = *typeof* [`SceneMethod`](#scenemethod)\[keyof *typeof* [`SceneMethod`](#scenemethod)\]

The union of the names in `SceneMethod`.

***

### SceneNotification

> **SceneNotification** = *typeof* [`SceneNotification`](#scenenotification)\[keyof *typeof* [`SceneNotification`](#scenenotification)\]

The union of the names in `SceneNotification`.

***

### SceneOp

> **SceneOp** = [`CreateEntityOp`](#createentityop) \| [`DestroyEntityOp`](#destroyentityop) \| [`ReparentOp`](#reparentop) \| [`ReorderOp`](#reorderop) \| [`SetEntityFieldOp`](#setentityfieldop) \| [`SetTransformOp`](#settransformop) \| [`AddComponentOp`](#addcomponentop) \| [`RemoveComponentOp`](#removecomponentop) \| [`SetPropOp`](#setpropop) \| [`SetSceneSettingOp`](#setscenesettingop) \| [`InstantiateOp`](#instantiateop) \| [`SetOverrideOp`](#setoverrideop) \| [`RemoveOverrideOp`](#removeoverrideop)

One scene op: the closed vocabulary of plan §3.4, identical to `@ignifx/editor-core`'s `SceneOp`.

***

### SceneOpKind

> **SceneOpKind** = *typeof* [`SceneOpKind`](#sceneopkind)\[keyof *typeof* [`SceneOpKind`](#sceneopkind)\]

The union of the names in `SceneOpKind`.

***

### SceneRequest

> **SceneRequest** = [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`openScene`](#openscene), [`OpenSceneParams`](#opensceneparams)\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`closeScene`](#closescene), `never`\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`applyOps`](#applyops), [`ApplyOpsParams`](#applyopsparams)\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`readBack`](#readback), [`ReadBackParams`](#readbackparams)\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`select`](#select), [`EntitySelection`](#entityselection)\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`setGizmo`](#setgizmo), [`SetGizmoParams`](#setgizmoparams)\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`frame`](#frame), [`FrameParams`](#frameparams)\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`pick`](#pick), [`PickParams`](#pickparams)\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`screenshot`](#screenshot-1), [`ScreenshotParams`](#screenshotparams)\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`getSchemas`](#getschemas), `never`\> \| [`RpcRequest`](#rpcrequest)\<*typeof* [`describeSettings`](#describesettings), `never`\> \| [`RpcRequestWithParams`](#rpcrequestwithparams)\<*typeof* [`setViewMode`](#setviewmode), [`SetViewModeParams`](#setviewmodeparams)\>

Editor → scene host: one of the `SceneMethod`s. `closeScene`, `getSchemas` and `describeSettings`
take no parameters.

***

### ScreenshotFormat

> **ScreenshotFormat** = *typeof* [`ScreenshotFormat`](#screenshotformat)\[keyof *typeof* [`ScreenshotFormat`](#screenshotformat)\]

The union of the formats in `ScreenshotFormat`.

***

### ScreenshotResponse

> **ScreenshotResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`ScreenshotResult`](#screenshotresult)\>

The success answer to `screenshot`.

***

### SelectResponse

> **SelectResponse** = [`RpcSuccessResponse`](#rpcsuccessresponse)\<[`EntitySelection`](#entityselection)\>

The success answer to `select`.

***

### SetEntityFieldOp

> **SetEntityFieldOp** = `{ readonly [F in EntityField]: { entity: string; field: F; op: "setEntityField"; value: EntityFieldValues[F] } }`\[[`EntityField`](#entityfield)\]

Sets one entity property.

***

### Vec3

> **Vec3** = readonly \[`number`, `number`, `number`\]

A world-space point, `[x, y, z]`, in metres.

***

### ViewMode

> **ViewMode** = *typeof* [`ViewMode`](#viewmode-2)\[keyof *typeof* [`ViewMode`](#viewmode-2)\]

The union of the modes in `ViewMode`.

## Variables

### ApplyOpFailureCode

> `const` **ApplyOpFailureCode**: `object`

Why the host could not apply one op.

#### Type Declaration

##### duplicateUid

> `readonly` **duplicateUid**: `"duplicateUid"` = `"duplicateUid"`

A new entity or component reuses a uid.

##### engineError

> `readonly` **engineError**: `"engineError"` = `"engineError"`

The engine threw while applying the op; `diagnostic` carries its `IGX-` code when it had one.

##### invalidIndex

> `readonly` **invalidIndex**: `"invalidIndex"` = `"invalidIndex"`

An index outside the list it positions in.

##### invalidOp

> `readonly` **invalidOp**: `"invalidOp"` = `"invalidOp"`

Not an op of the vocabulary.

##### invalidParent

> `readonly` **invalidParent**: `"invalidParent"` = `"invalidParent"`

A parent outside the scene, or a move under its own subtree.

##### invalidPath

> `readonly` **invalidPath**: `"invalidPath"` = `"invalidPath"`

A JSON path or override path that does not resolve.

##### invalidValue

> `readonly` **invalidValue**: `"invalidValue"` = `"invalidValue"`

A value of the wrong shape for its field.

##### notAnInstance

> `readonly` **notAnInstance**: `"notAnInstance"` = `"notAnInstance"`

An override op on an entity without an `instance` entry.

##### unknownComponent

> `readonly` **unknownComponent**: `"unknownComponent"` = `"unknownComponent"`

The target component uid is not in the open scene.

##### unknownEntity

> `readonly` **unknownEntity**: `"unknownEntity"` = `"unknownEntity"`

The target entity uid is not in the open scene.

##### unknownOverride

> `readonly` **unknownOverride**: `"unknownOverride"` = `"unknownOverride"`

No override with that identity.

##### unsupportedOp

> `readonly` **unsupportedOp**: `"unsupportedOp"` = `"unsupportedOp"`

The host cannot apply this op to a live world yet; the editor reopens the scene instead.

#### Remarks

The first ten are `@ignifx/editor-core`'s `OpErrorCode`s, with its meanings, for a world that
disagrees with the document the op was checked against. The last two are the host's own.

***

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

### GizmoMode

> `const` **GizmoMode**: `object`

What the gizmo does.

#### Type Declaration

##### none

> `readonly` **none**: `"none"` = `"none"`

No gizmo; the selection is only outlined.

##### rotate

> `readonly` **rotate**: `"rotate"` = `"rotate"`

Rotate around axes.

##### scale

> `readonly` **scale**: `"scale"` = `"scale"`

Scale along axes and uniformly.

##### translate

> `readonly` **translate**: `"translate"` = `"translate"`

Move along axes and planes.

***

### GizmoSpace

> `const` **GizmoSpace**: `object`

Which axes the gizmo follows.

#### Type Declaration

##### local

> `readonly` **local**: `"local"` = `"local"`

The entity's own axes.

##### world

> `readonly` **world**: `"world"` = `"world"`

The world's axes.

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

##### gizmos

> `readonly` **gizmos**: `"gizmos"` = `"gizmos"`

The scene host draws gizmos on the primary selection, answers `setGizmo`, and sends
`transformDragging` and `transformDragged`.

##### heartbeat

> `readonly` **heartbeat**: `"heartbeat"` = `"heartbeat"`

The host sends `heartbeat` notifications after `ready` (see `HostNotification`).

##### logRelay

> `readonly` **logRelay**: `"logRelay"` = `"logRelay"`

The host relays the app's reports: `log` lines with the first `Error` each carries, a
`hostError` with `AppErrorData` (entity, component, phase, stack) for every `app.onError`
report, and `hotReloaded` with each error's stack. The scene view sends them as scene
notifications, the play view as play notifications. Additive in 0.3.

##### pick2d

> `readonly` **pick2d**: `"pick2d"` = `"pick2d"`

The scene host picks sprites in 2D view mode (`app.twoD.pickAt` from `@ignifx/2d`); without it,
`pick` and view clicks in 2D mode resolve through the 3D picker only.

##### playControls

> `readonly` **playControls**: `"playControls"` = `"playControls"`

The host answers the methods in `PlayMethod`.

##### screenshot

> `readonly` **screenshot**: `"screenshot"` = `"screenshot"`

The scene host answers `screenshot`.

##### viewMode2d

> `readonly` **viewMode2d**: `"viewMode2d"` = `"viewMode2d"`

The scene host accepts `setViewMode` with `"2d"`: a 2D editor camera and planar gizmos.

#### Remarks

The play controls send `["heartbeat", "playControls"]`. The scene host sends `"heartbeat"` and
whichever of `"gizmos"`, `"screenshot"`, `"viewMode2d"` and `"pick2d"` it supports; every
`SceneMethod` not tied to one of them is required of a 0.3 scene host.

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

### PickUnit

> `const` **PickUnit**: `object`

The unit of a `pick` point (S0.2 §6.1).

#### Type Declaration

##### backing

> `readonly` **backing**: `"backing"` = `"backing"`

The canvas's backing-store pixels: CSS pixels times `canvas.width / canvas.clientWidth`.

##### css

> `readonly` **css**: `"css"` = `"css"`

CSS pixels from the view's top-left corner: a DOM event's `offsetX` and `offsetY`.

***

### PlayMethod

> `const` **PlayMethod**: `object`

The methods the play view answers after `ready`. `play`, `pause`, `step` and `stop` answer with a
[PlayState](#playstate-1); `playState` answers with a [PlayStateReport](#playstatereport).

#### Type Declaration

##### pause

> `readonly` **pause**: `"pause"` = `"pause"`

Sets `app.time.paused`; scripts marked `updateWhenPaused` keep running.

##### play

> `readonly` **play**: `"play"` = `"play"`

Clears `app.time.paused` and starts the frame loop if it is stopped.

##### playState

> `readonly` **playState**: `"playState"` = `"playState"`

Reads the game's state without changing it. Takes no parameters.

##### step

> `readonly` **step**: `"step"` = `"step"`

Stops the frame loop, then advances exactly one frame with `app.step()` and leaves the game paused.

##### stop

> `readonly` **stop**: `"stop"` = `"stop"`

Stops the frame loop with `app.stop()`. The editor reloads the view to reset the game.

#### Remarks

A host that answers them lists `HostCapability.playControls` in `ready`. Sent before `ready`, they
fail with `RpcErrorCode.notReady`; sent to a host without them, with `RpcErrorCode.methodNotFound`.
`playState` is an additive 0.3 method: a host from before it answers it with
`RpcErrorCode.methodNotFound`.

***

### PlayNotification

> `const` **PlayNotification**: `object`

The notifications the play view sends after `ready`.

#### Type Declaration

##### hostError

> `readonly` **hostError**: `"hostError"` = `"hostError"`

An error the game's app reported through `app.onError`: the same `HostErrorParams` as the scene
view's `hostError`, with `AppErrorData` as its `data`. Sent by a host that lists
`HostCapability.logRelay`, kept before the handshake as `log` is.

##### hotReloaded

> `readonly` **hotReloaded**: `"hotReloaded"` = `"hotReloaded"`

After every `app.hotReload` operation in the game: the same `HotReloadedParams` as the scene
view's `hotReloaded`. Sent by a host that lists `HostCapability.logRelay`.

##### log

> `readonly` **log**: `"log"` = `"log"`

One line from the game's logger, with the same `LogParams` as the scene view's `log`. Sent by a
host that lists `HostCapability.logRelay`; lines logged before the handshake are kept (the
newest few hundred) and sent right after `ready`.

##### playStateChanged

> `readonly` **playStateChanged**: `"playStateChanged"` = `"playStateChanged"`

After the game's [PlayStateReport.state](#state) changed. A change a `PlayMethod` makes is sent
right after that method's answer; one the game makes itself, such as setting
`app.time.paused`, within one heartbeat interval.

#### Remarks

Additive in 0.3: a host from before them sends none, and answers `playState` with
`RpcErrorCode.methodNotFound`. `log`, `hostError` and `hotReloaded` came later still: only a host
that lists `HostCapability.logRelay` in `ready` sends them.

***

### PlayPhase

> `const` **PlayPhase**: `object`

Whether the game plays, is paused, or is stopped, as [PlayStateReport.state](#state) reports it.

#### Type Declaration

##### paused

> `readonly` **paused**: `"paused"` = `"paused"`

Game time is paused (`app.time.paused`): after `pause`, or after `step`, which leaves the frame
loop stopped on the stepped frame.

##### playing

> `readonly` **playing**: `"playing"` = `"playing"`

The frame loop runs (`app.isRunning`) and game time is not paused.

##### stopped

> `readonly` **stopped**: `"stopped"` = `"stopped"`

The frame loop does not run: before the game starts it, or after `stop`.

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

##### noScene

> `readonly` **noScene**: `-32002` = `-32_002`

A scene method that needs an open scene was called while none is open (`SceneMethod`).

##### notReady

> `readonly` **notReady**: `-32001` = `-32_001`

The peer cannot answer this method yet: it has not finished its handshake, or (a scene host)
its app has not started.

##### parseError

> `readonly` **parseError**: `-32700` = `-32_700`

The message was not valid JSON.

#### Remarks

`as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).

***

### SceneMethod

> `const` **SceneMethod**: `object`

Editor → scene host: the methods of protocol 0.3, answered after `ready`.

#### Type Declaration

##### applyOps

> `readonly` **applyOps**: `"applyOps"` = `"applyOps"`

Applies one command's ops to the open scene, in order. Answers [ApplyOpsResult](#applyopsresult).

##### closeScene

> `readonly` **closeScene**: `"closeScene"` = `"closeScene"`

Unloads the open scene, if any. Answers `null`.

##### describeSettings

> `readonly` **describeSettings**: `"describeSettings"` = `"describeSettings"`

Describes the project's settings sections and the values the app resolved for them. Answers
[SettingsSet](#settingsset). A host from before it answers `RpcErrorCode.methodNotFound`.

##### frame

> `readonly` **frame**: `"frame"` = `"frame"`

Moves the editor camera to frame entities. Answers `null`.

##### getSchemas

> `readonly` **getSchemas**: `"getSchemas"` = `"getSchemas"`

Describes every registered component's schema. Answers [SchemaSet](#schemaset).

##### openScene

> `readonly` **openScene**: `"openScene"` = `"openScene"`

Opens a scene from the editor's document, replacing any open scene. Answers [OpenSceneResult](#opensceneresult).

##### pick

> `readonly` **pick**: `"pick"` = `"pick"`

Asks which entity is under a point of the view, without selecting it. Answers [PickResult](#pickresult).

##### readBack

> `readonly` **readBack**: `"readBack"` = `"readBack"`

Serializes entities of the open scene as the live world has them. Answers [ReadBackResult](#readbackresult).

##### screenshot

> `readonly` **screenshot**: `"screenshot"` = `"screenshot"`

Captures the view as an image. Needs `HostCapability.screenshot`. Answers [ScreenshotResult](#screenshotresult).

##### select

> `readonly` **select**: `"select"` = `"select"`

Sets the selection the view outlines and attaches the gizmo to. Answers [EntitySelection](#entityselection).

##### setGizmo

> `readonly` **setGizmo**: `"setGizmo"` = `"setGizmo"`

Sets the gizmo's mode, space and snapping. Needs `HostCapability.gizmos`. Answers `null`.

##### setViewMode

> `readonly` **setViewMode**: `"setViewMode"` = `"setViewMode"`

Switches the view between the 3D and the 2D editor camera. Answers `null`.

#### Remarks

`as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).

The host handles these requests one at a time, in the order they arrive: a request starts only
after the previous one has been answered, so `applyOps` sent right after `openScene` sees the new
scene. Until the host's app has started, every one of them fails with `RpcErrorCode.notReady`;
the host's first `schemasChanged` is the editor's cue that they are accepted. A method that needs
an open scene fails with `RpcErrorCode.noScene` while none is open. A method whose capability the
host does not list in `ready` fails with `RpcErrorCode.methodNotFound`.

***

### SceneNotification

> `const` **SceneNotification**: `object`

Scene host → editor: the notifications of protocol 0.3. None has an answer.

#### Type Declaration

##### assetReloaded

> `readonly` **assetReloaded**: `"assetReloaded"` = `"assetReloaded"`

After the host reloaded an asset that changed on disk, in place: its address, its type, and
the document's instance roots rebuilt from it. A host from before it sends nothing.

##### hostError

> `readonly` **hostError**: `"hostError"` = `"hostError"`

A failure that answers no request: an error the app reported, a failed hot reload.

##### hotReloaded

> `readonly` **hotReloaded**: `"hotReloaded"` = `"hotReloaded"`

After every `app.hotReload` operation: its report.

##### log

> `readonly` **log**: `"log"` = `"log"`

One line from the app's logger, for the editor's Console.

##### sceneOpened

> `readonly` **sceneOpened**: `"sceneOpened"` = `"sceneOpened"`

After the answer to every successful `openScene`: what was opened.

##### schemasChanged

> `readonly` **schemasChanged**: `"schemasChanged"` = `"schemasChanged"`

Once the app has started (after `ready`), and after every hot reload: the component schemas.

##### selectionChanged

> `readonly` **selectionChanged**: `"selectionChanged"` = `"selectionChanged"`

After a click in the view changed the selection: the new selection.

##### transformDragged

> `readonly` **transformDragged**: `"transformDragged"` = `"transformDragged"`

Once per gizmo gesture, at pointer-up: the editor turns it into a `setTransform` command.

##### transformDragging

> `readonly` **transformDragging**: `"transformDragging"` = `"transformDragging"`

During a gizmo drag, at most every [TRANSFORM\_DRAGGING\_INTERVAL\_MS](#transform_dragging_interval_ms): for display only.

#### Remarks

There is no `reloadScripts` method: script hot reload is Vite's. When a script changes, Vite
replaces the module in the host page, `acceptHotReload(app)` hands the new classes to
`app.hotReload.apply`, and the host reports the outcome with `hotReloaded` and `schemasChanged`.
A change that Vite cannot hot-replace reloads the host page, which the editor sees as a new load:
a new port, a new handshake, and `openScene` again.

***

### SceneOpKind

> `const` **SceneOpKind**: `object`

The `op` discriminant of every scene op.

#### Type Declaration

##### addComponent

> `readonly` **addComponent**: `"addComponent"` = `"addComponent"`

Adds a component.

##### createEntity

> `readonly` **createEntity**: `"createEntity"` = `"createEntity"`

Creates an entity, optionally with a subtree.

##### destroyEntity

> `readonly` **destroyEntity**: `"destroyEntity"` = `"destroyEntity"`

Destroys an entity and its subtree.

##### instantiate

> `readonly` **instantiate**: `"instantiate"` = `"instantiate"`

Creates an instance root (a prefab instance).

##### removeComponent

> `readonly` **removeComponent**: `"removeComponent"` = `"removeComponent"`

Removes a component.

##### removeOverride

> `readonly` **removeOverride**: `"removeOverride"` = `"removeOverride"`

Removes an override from an instance root.

##### reorder

> `readonly` **reorder**: `"reorder"` = `"reorder"`

Moves an entity among its siblings.

##### reparent

> `readonly` **reparent**: `"reparent"` = `"reparent"`

Moves an entity under another parent, keeping its local transform.

##### setEntityField

> `readonly` **setEntityField**: `"setEntityField"` = `"setEntityField"`

Sets `name`, `active`, `static`, `layer` or `tags`.

##### setOverride

> `readonly` **setOverride**: `"setOverride"` = `"setOverride"`

Sets an override on an instance root.

##### setProp

> `readonly` **setProp**: `"setProp"` = `"setProp"`

Sets or removes a value inside a component's `props`.

##### setSceneSetting

> `readonly` **setSceneSetting**: `"setSceneSetting"` = `"setSceneSetting"`

Sets or removes a value inside the scene's `settings`.

##### setTransform

> `readonly` **setTransform**: `"setTransform"` = `"setTransform"`

Sets an entity's local transform.

#### Remarks

`as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).

***

### SCREENSHOT\_MAX\_SIZE

> `const` **SCREENSHOT\_MAX\_SIZE**: `2048` = `2048`

The largest width and height, in pixels, of a `screenshot`. A request for more fails with
`invalidParams`; a request without a size gets the view's own size scaled down to fit. It keeps
an image well under what an MCP client accepts inline (plan §3.11).

***

### ScreenshotFormat

> `const` **ScreenshotFormat**: `object`

The image formats of a `screenshot`.

#### Type Declaration

##### jpeg

> `readonly` **jpeg**: `"jpeg"` = `"jpeg"`

Lossy, `image/jpeg`.

##### png

> `readonly` **png**: `"png"` = `"png"`

Lossless, `image/png`.

***

### TRANSFORM\_DRAGGING\_INTERVAL\_MS

> `const` **TRANSFORM\_DRAGGING\_INTERVAL\_MS**: `50` = `50`

The fewest milliseconds between two `transformDragging` notifications for the same gesture: at
most 20 a second, which S0.2 measured as smooth enough for an inspector to follow a drag.

***

### ViewMode

> `const` **ViewMode**: `object`

The editor cameras the view can use.

#### Type Declaration

##### threeD

> `readonly` **threeD**: `"3d"` = `"3d"`

The 3D editor camera, gizmos and grid.

##### twoD

> `readonly` **twoD**: `"2d"` = `"2d"`

The 2D editor camera, planar gizmos and pixel grid. Needs `HostCapability.viewMode2d`.

## Functions

### isAppErrorData()

> **isAppErrorData**(`value`): `value is AppErrorData`

Checks the `data` of a `hostError` for an error the app reported.

#### Parameters

##### value

`unknown`

The received `data`.

#### Returns

`value is AppErrorData`

True for a boundary name, a phase or `null`, an entity uid or `null`, and, when present,
a phase name, an entity name, a component and a stack, each a string or `null`.

***

### isApplyOpsParams()

> **isApplyOpsParams**(`value`): `value is ApplyOpsParams`

Checks the parameters of `applyOps`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is ApplyOpsParams`

True when every op passes [isSceneOp](#issceneop) and the command has a name and an id.

***

### isApplyOpsResult()

> **isApplyOpsResult**(`value`): `value is ApplyOpsResult`

Checks the result of `applyOps`.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is ApplyOpsResult`

True for a count of applied ops and a list of failures with known codes.

***

### isAssetReloadedParams()

> **isAssetReloadedParams**(`value`): `value is AssetReloadedParams`

Checks the parameters of `assetReloaded`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is AssetReloadedParams`

True for `{ address, type, entities }` with a non-empty address and type.

***

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

### isEntitySelection()

> **isEntitySelection**(`value`): `value is EntitySelection`

Checks a selection: the parameters and result of `select` and the parameters of
`selectionChanged`.

#### Parameters

##### value

`unknown`

The received `params` or `result`.

#### Returns

`value is EntitySelection`

True for `{ entities: uid[] }`.

***

### isFrameParams()

> **isFrameParams**(`value`): `value is FrameParams`

Checks the parameters of `frame`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is FrameParams`

True for a list of uids or `"all"`.

***

### isHostErrorParams()

> **isHostErrorParams**(`value`): `value is HostErrorParams`

Checks the parameters of `hostError`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is HostErrorParams`

True for a code or `null`, a message and optional JSON data.

***

### isHotReloadedParams()

> **isHotReloadedParams**(`value`): `value is HotReloadedParams`

Checks the parameters of `hotReloaded`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is HotReloadedParams`

True for `{ report }` with a known kind, type ids, counts and JSON errors.

***

### isIncompatibleProtocolData()

> **isIncompatibleProtocolData**(`value`): `value is IncompatibleProtocolData`

Checks the `data` of an `incompatibleProtocol` answer to `hello`.

#### Parameters

##### value

`unknown`

The received `error.data`.

#### Returns

`value is IncompatibleProtocolData`

True when it names the host's protocol version and the engine version.

***

### isInvalidSceneFileData()

> **isInvalidSceneFileData**(`value`): `value is InvalidSceneFileData`

Checks the `data` of the `invalidParams` error `openScene` answers for a file
`validateSceneFile` refuses.

#### Parameters

##### value

`unknown`

The received `error.data`.

#### Returns

`value is InvalidSceneFileData`

True for `{ issues: [{ path, message }] }`.

***

### isJsonObject()

> **isJsonObject**(`value`): `value is JsonObject`

Tells whether a value is a JSON object.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is JsonObject`

True for a plain object of JSON values.

***

### isJsonValue()

> **isJsonValue**(`value`): `value is JsonValue`

Tells whether a value is JSON: `null`, a boolean, a string, a finite number, or an array or
plain object of JSON values, nested at most 256 levels deep.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is JsonValue`

True for a JSON value.

***

### isLogParams()

> **isLogParams**(`value`): `value is LogParams`

Checks the parameters of `log`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is LogParams`

True for a known level, a scope or `null`, a message and a finite time.

***

### isOpenSceneParams()

> **isOpenSceneParams**(`value`): `value is OpenSceneParams`

Checks the parameters of `openScene`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is OpenSceneParams`

True for a structurally valid scene file and a string or `null` address.

***

### isOpenSceneResult()

> **isOpenSceneResult**(`value`): `value is OpenSceneResult`

Checks the result of `openScene`.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is OpenSceneResult`

True for a count, a list of issues, and an optional view mode.

***

### isPickParams()

> **isPickParams**(`value`): `value is PickParams`

Checks the parameters of `pick`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is PickParams`

True for finite `x` and `y` and a known unit.

***

### isPickResult()

> **isPickResult**(`value`): `value is PickResult`

Checks the result of `pick`.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is PickResult`

True for a uid or `null`, a point or `null`, a non-negative distance or `null`, an
optional ray and an optional plane point.

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

### isPlayStateReport()

> **isPlayStateReport**(`value`): `value is PlayStateReport`

Checks the `result` of `playState` and the `params` of `playStateChanged`.

#### Parameters

##### value

`unknown`

The received value.

#### Returns

`value is PlayStateReport`

True when `value` has a `state` that is a `PlayPhase`, a non-negative integer
`frameCount`, and a non-negative finite `time`.

***

### isProtocolVersion()

> **isProtocolVersion**(`value`): `value is ProtocolVersion`

Tells whether a value is a protocol version: two non-negative integers.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is ProtocolVersion`

True for `{ major, minor }` with non-negative safe integers.

***

### isReadBackParams()

> **isReadBackParams**(`value`): `value is ReadBackParams`

Checks the parameters of `readBack`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is ReadBackParams`

True for an object with an optional list of uids.

***

### isReadBackResult()

> **isReadBackResult**(`value`): `value is ReadBackResult`

Checks the result of `readBack`.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is ReadBackResult`

True for entity records, missing uids, settings or `null`, and issues.

***

### isReadyResult()

> **isReadyResult**(`value`): `value is ReadyResult`

Checks the `result` of a `hello` answer.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is ReadyResult`

True when it has a string `engineVersion`, a protocol version, an array of capability
strings, and a known `hostKind`.

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

### isSceneFile()

> **isSceneFile**(`value`): `value is SceneFile`

Checks a whole scene file's structure.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneFile`

True for a file object whose header fields and entity records have the right types.

***

### isSceneFileAssetRef()

> **isSceneFileAssetRef**(`value`): `value is SceneFileAssetRef`

Checks an asset reference.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneFileAssetRef`

True for `{ $asset: string, type?: string }`.

***

### isSceneFileComponent()

> **isSceneFileComponent**(`value`): `value is SceneFileComponent`

Checks a component record.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneFileComponent`

True for a record with a uid, a type and well-typed optional fields.

***

### isSceneFileEntity()

> **isSceneFileEntity**(`value`): `value is SceneFileEntity`

Checks an entity record.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneFileEntity`

True for a record with a uid, a name, a parent, a transform and well-typed optional
fields.

***

### isSceneFileInstance()

> **isSceneFileInstance**(`value`): `value is SceneFileInstance`

Checks an `instance` entry.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneFileInstance`

True for `{ scene, hash?, overrides? }`.

***

### isSceneFileOverride()

> **isSceneFileOverride**(`value`): `value is SceneFileOverride`

Checks an override patch.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneFileOverride`

True for `{ op?, path, value? }` with a known `op` and a JSON `value`.

***

### isSceneFileTransform()

> **isSceneFileTransform**(`value`): `value is SceneFileTransform`

Checks a local transform.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneFileTransform`

True for three, four and three finite numbers in `position`, `rotation` and `scale`.

***

### isSceneIssue()

> **isSceneIssue**(`value`): `value is SceneIssue`

Checks one engine issue.

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is SceneIssue`

True for `{ code: string, message: string }`.

***

### isSceneOp()

> **isSceneOp**(`value`): `value is SceneOp`

Checks the structure of one scene op: a known `op` and fields of the right types.

#### Parameters

##### value

`unknown`

A received op.

#### Returns

`value is SceneOp`

True when `value` is a structurally valid [SceneOp](#sceneop).

#### Remarks

It answers "is this an op of the vocabulary", not "does it apply": uids are checked to be
non-empty strings, indices to be non-negative integers, values to be JSON, and records to have the
scene format's shape. Unknown extra fields are ignored. A `setProp` or `setSceneSetting` value may
be any JSON; that the empty path receives an object is the applier's check.

#### Example

```ts
isSceneOp({ op: "setEntityField", entity: "01J9Z6M7E5S3A0V2Q4R8T1Y6WX", field: "name", value: "Player" }); // true
isSceneOp({ op: "setEntityField", entity: "01J9Z6M7E5S3A0V2Q4R8T1Y6WX", field: "name", value: 3 }); // false
```

***

### isSceneOpenedParams()

> **isSceneOpenedParams**(`value`): `value is SceneOpenedParams`

Checks the parameters of `sceneOpened`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is SceneOpenedParams`

True for an address or `null`, a name, a count, issues, and an optional view mode.

***

### isSchemaSet()

> **isSchemaSet**(`value`): `value is SchemaSet`

Checks the result of `getSchemas` and the parameters of `schemasChanged`.

#### Parameters

##### value

`unknown`

The received `result` or `params`.

#### Returns

`value is SchemaSet`

True for `{ schemas }` whose every entry is a schema description.

***

### isScreenshotParams()

> **isScreenshotParams**(`value`): `value is ScreenshotParams`

Checks the parameters of `screenshot`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is ScreenshotParams`

True for a known format, sizes in range when given, and a quality from 0 to 1 when given.

***

### isScreenshotResult()

> **isScreenshotResult**(`value`): `value is ScreenshotResult`

Checks the result of `screenshot`.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is ScreenshotResult`

True for a PNG or JPEG data URL and sizes in range.

***

### isSetGizmoParams()

> **isSetGizmoParams**(`value`): `value is SetGizmoParams`

Checks the parameters of `setGizmo`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is SetGizmoParams`

True for a known mode and space and a snap of three non-negative numbers, or `null`.

***

### isSettingsSet()

> **isSettingsSet**(`value`): `value is SettingsSet`

Checks the result of `describeSettings`.

#### Parameters

##### value

`unknown`

The received `result`.

#### Returns

`value is SettingsSet`

True for `{ sections, values }`: every section a schema description, every value an
object.

***

### isSetViewModeParams()

> **isSetViewModeParams**(`value`): `value is SetViewModeParams`

Checks the parameters of `setViewMode`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is SetViewModeParams`

True for `{ mode: "3d" | "2d" }`.

***

### isTransformDraggedParams()

> **isTransformDraggedParams**(`value`): `value is TransformDraggedParams`

Checks the parameters of `transformDragged`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is TransformDraggedParams`

True for an entity, a drag mode and two transforms.

***

### isTransformDraggingParams()

> **isTransformDraggingParams**(`value`): `value is TransformDraggingParams`

Checks the parameters of `transformDragging`.

#### Parameters

##### value

`unknown`

The received `params`.

#### Returns

`value is TransformDraggingParams`

True for an entity, a drag mode and a transform.

***

### listenForEditorPlayControls()

> **listenForEditorPlayControls**(`options`): [`EditorPlayConnector`](#editorplayconnector)

**`Beta`**

Listens for the editor's connect message before the game's app exists, and keeps the newest port
until [EditorPlayConnector.attach](#attach) hands it the app.

#### Parameters

##### options

[`EditorPlayControlsOptions`](#editorplaycontrolsoptions)

The editor's origin and the reporting options.

#### Returns

[`EditorPlayConnector`](#editorplayconnector)

The connector; dispose it to stop listening.

#### Remarks

The editor posts its port on the play view's `load` event, which can fire while the game's
`main.ts` still awaits `createApp`. `virtual:ignifx/editor` calls this when the module is
evaluated, which is before `main.ts` runs, and `attachEditorPlayControls(app)` calls `attach`, so
the handshake runs on the port the editor sent first. A port is accepted only from exactly
`editorOrigin`; a newer one replaces and closes the one waiting. Nothing is read from the port
before `attach`: the editor's `hello` waits in it.

#### Throws

IgnifxError `IGX-1801` for a malformed `editorOrigin`, `IGX-1802` with no window and no
`messageTarget`, `IGX-1803` for a bad `heartbeatIntervalMs`.

#### Example

```ts
const connector = listenForEditorPlayControls({ editorOrigin: "ignifx://app" });
const app = await createApp({ headless: true });
const controls = connector.attach(app);
connector.dispose();
```

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
protocolVersionIsCompatible({ major: 0, minor: 3 }, { major: 0, minor: 2 }); // false
protocolVersionIsCompatible({ major: 1, minor: 0 }, { major: 1, minor: 4 }); // true
```

***

### startEditorHost()

> **startEditorHost**(`options`): `Promise`\<[`EditorHost`](#editorhost)\>

**`Beta`**

Starts the scene view's host: listens for the editor's port, creates the app from the project's
own `@ignifx/core` (in edit mode unless `editMode` is `false`), registers the project's scripts,
loads `bootScene` if one is given, starts the app, and serves the editor protocol's scene methods
(protocol 0.3, `docs/architecture/17-editor-host.md` §6).

#### Parameters

##### options

[`EditorHostOptions`](#editorhostoptions)

The editor's origin and the project's app options.

#### Returns

`Promise`\<[`EditorHost`](#editorhost)\>

The running host, once the app has started.

#### Remarks

The host answers `hello` with `ready` and `ping` with `"pong"` as soon as a port arrives, even
while the app is still being created; the scene methods answer `notReady` until the app has
started, and the host's first `schemasChanged` says they are accepted. It accepts a new port
whenever the editor sends one, closing the previous port.

With a `canvas` the host draws Babylon Lite's gizmos and a selection outline in core's render
overlay (`app.renderer.openOverlay()`), answers `screenshot`, and has a 2D view mode
(`setViewMode`), which shows the sprites through an editor-owned `Camera2D` and picks them with
`app.twoD.pickAt` when the project registers `@ignifx/2d`. A headless host serves every method
that needs no GPU.

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
`pause`, `step`, `stop` and `playState`, and sends `playStateChanged` when the game's phase
changes, and `log`, `hostError` and `hotReloaded` for the game's log lines, `app.onError` reports
and hot reloads (the newest 256 from before the handshake right after it).

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

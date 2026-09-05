# ignifx

`ignifx` public barrel: the umbrella entry point that re-exports `@ignifx/core` and, as each
phase lands, the standard extensions (`docs/architecture/00-overview.md` §2). Every symbol is
re-exported by name — no `export *` (coding standards §4).

Phase 2 added the render components, the GPU asset loaders, and the scene serialization surface;
Phase 3 adds the whole of `@ignifx/input`. The physics, physics-2d, audio, 2d, 3d, and ui
re-exports and the one-call `createGame()` arrive with the phases of
`docs/plan/engineering-plan.md` that populate those packages.

Two `@ignifx/input` exports are deliberately **not** re-exported, because `@ignifx/core` already
owns the name: `VERSION` (the umbrella reports the core version) and `describeSchemas` (the
documentation harness reads each package's own entry point, so nothing is lost). Reach them as
`@ignifx/input`'s own exports when a tool needs them.

## Classes

### ActionMap

A named group of actions.

#### Example

```ts
app.input.actions.map("UI").enabled = true;
app.input.actions.map("Player").enabled = false;
```

#### Constructors

##### Constructor

> **new ActionMap**(`definition`, `resolver`, `onHandlerError`): [`ActionMap`](#actionmap)

Builds a map and its actions.

###### Parameters

###### definition

[`ActionMapDefinition`](#actionmapdefinition)

The map as it appears in an `ignifx.inputactions` document.

###### resolver

[`BindingResolver`](#bindingresolver)

How binding paths become controls.

###### onHandlerError

(`error`) => `void`

Where an action signal handler's exception is reported.

###### Returns

[`ActionMap`](#actionmap)

###### Throws

IgnifxError with code `IGX-0810` when two actions share a name, or with a binding code
when one of the bindings cannot be resolved.

#### Properties

##### enabled

> **enabled**: `boolean`

Whether the map's actions resolve. Actions in a disabled map read as released.

##### name

> `readonly` **name**: `string`

The map name.

#### Accessors

##### actions

###### Get Signature

> **get** **actions**(): `ReadonlyMap`\<`string`, [`InputAction`](#inputaction)\>

The map's actions, keyed by name.

###### Returns

`ReadonlyMap`\<`string`, [`InputAction`](#inputaction)\>

The action table.

#### Methods

##### get()

> **get**(`name`): [`InputAction`](#inputaction)

Looks one action up.

###### Parameters

###### name

`string`

The action name.

###### Returns

[`InputAction`](#inputaction)

The action.

###### Throws

IgnifxError with code `IGX-0801` when the map declares no such action.

***

### ActionVector

A live, allocation-free view of an action's `vector2` value.

#### Implements

- [`Vec2Like`](#vec2like)

#### Constructors

##### Constructor

> **new ActionVector**(`values`): [`ActionVector`](#actionvector)

Wraps the two slots an action keeps its value in.

###### Parameters

###### values

`Float32Array`

The action's value array.

###### Returns

[`ActionVector`](#actionvector)

#### Accessors

##### x

###### Get Signature

> **get** **x**(): `number`

The x component, read from the action's live value.

###### Returns

`number`

The current x.

The x component.

###### Implementation of

[`Vec2Like`](#vec2like).[`x`](#x-13)

##### y

###### Get Signature

> **get** **y**(): `number`

The y component, read from the action's live value.

###### Returns

`number`

The current y.

The y component.

###### Implementation of

[`Vec2Like`](#vec2like).[`y`](#y-13)

***

### AssetLoadError

The failure an [AssetHandle.promise](#promise) rejects with
(`docs/architecture/05-assets-and-loading.md` §9). Its `code` is one of `IGX-0502` (aborted),
`IGX-0503` (the app was disposed), `IGX-0504` (no loader), or `IGX-0505` (the load failed after
every retry, with the last failure as `cause`).

#### Example

```ts
try {
  await app.assets.loadAsync("levels/1.scene.json");
} catch (error) {
  if (error instanceof AssetLoadError) {
    app.log.error("{address} failed from {url}", error.address, error.url);
  }
}
```

#### Extends

- [`IgnifxError`](#ignifxerror)

#### Constructors

##### Constructor

> **new AssetLoadError**(`code`, `message`, `options`): [`AssetLoadError`](#assetloaderror)

Creates an asset failure.

###### Parameters

###### code

`` `IGX-${number}` ``

The `IGX-05xx` code.

###### message

`string`

The actionable development sentence.

###### options

[`AssetLoadErrorOptions`](#assetloaderroroptions)

The address and URL, plus the standard `context`, `hint`, and `cause`.

###### Returns

[`AssetLoadError`](#assetloaderror)

###### Overrides

[`IgnifxError`](#ignifxerror).[`constructor`](#constructor-20)

#### Properties

##### address

> `readonly` **address**: `string`

The address that failed.

##### cause?

> `optional` **cause?**: `unknown`

###### Inherited from

[`IgnifxError`](#ignifxerror).[`cause`](#cause-3)

##### code

> `readonly` **code**: `` `IGX-${number}` ``

The stable diagnostic code for this failure.

###### Inherited from

[`IgnifxError`](#ignifxerror).[`code`](#code-2)

##### context

> `readonly` **context**: [`ErrorContext`](#errorcontext)

Identifiers that locate the failure (entity uid, component type id, asset key, …).

###### Inherited from

[`IgnifxError`](#ignifxerror).[`context`](#context-3)

##### hint

> `readonly` **hint**: `string` \| `null`

One sentence telling the developer how to fix it, or `null` when there is nothing to add.

###### Inherited from

[`IgnifxError`](#ignifxerror).[`hint`](#hint-3)

##### message

> **message**: `string`

###### Inherited from

[`IgnifxError`](#ignifxerror).[`message`](#message-3)

##### name

> **name**: `string`

###### Inherited from

[`IgnifxError`](#ignifxerror).[`name`](#name-15)

##### stack?

> `optional` **stack?**: `string`

###### Inherited from

[`IgnifxError`](#ignifxerror).[`stack`](#stack-1)

##### url

> `readonly` **url**: `string`

The URL it resolved to.

***

### AudioBusesAsset

A parsed `.audio.json` (`docs/architecture/10-audio.md` §1).

#### Example

```ts
const tree = await app.assets.loadAsync<AudioBusesAsset>("audio/buses.audio.json");
tree.value.buses[0].name; // "Master"
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the tree was loaded from.

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers bus files under.

##### buses

> `readonly` **buses**: readonly [`AudioBusDefinition`](#audiobusdefinition)[]

The buses, parents before children.

***

### AudioClip

One loaded sound file (`docs/architecture/10-audio.md` §2).

#### Example

```ts
const step = await app.assets.loadAsync<AudioClip>("audio/footstep.wav");
step.value.duration; // 0.42
app.audio.playOneShot(step.value);
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the clip was loaded from.

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers audio clips under.

##### isStreaming

> `readonly` **isStreaming**: `boolean`

Whether the clip is played by a media element rather than from a decoded buffer.

##### url

> `readonly` **url**: `string`

The URL the address resolved to.

#### Accessors

##### byteLength

###### Get Signature

> **get** **byteLength**(): `number`

How many bytes the file held, for diagnostics. Stays at its loaded value after the bytes have
been decoded and released.

###### Returns

`number`

The file size in bytes, or `0` for a streaming clip, which is never fetched.

##### channels

###### Get Signature

> **get** **channels**(): `number` \| `null`

How many interleaved channels the clip holds.

###### Returns

`number` \| `null`

The channel count, or `null` when unknown.

##### duration

###### Get Signature

> **get** **duration**(): `number` \| `null`

How long the clip plays, in seconds.

###### Returns

`number` \| `null`

The duration, or `null` when this build has not been able to determine it.

##### isDecoded

###### Get Signature

> **get** **isDecoded**(): `boolean`

`true` once a backend has decoded this clip into a playable buffer.

###### Returns

`boolean`

Whether [AudioClip.lite](#lite-3) carries a buffer.

##### lite

###### Get Signature

> **get** **lite**(): [`AudioClipLiteHandles`](#audiocliplitehandles)

The Babylon Lite objects the clip owns. Unstable escape hatch.

###### Returns

[`AudioClipLiteHandles`](#audiocliplitehandles)

The decoded buffer, or `null`.

##### sampleRate

###### Get Signature

> **get** **sampleRate**(): `number` \| `null`

The clip's sample rate.

###### Returns

`number` \| `null`

Samples per second, or `null` when unknown.

***

### AudioListener

The listener spatial audio is heard from.

#### Example

```ts
const camera = world.createEntity("Main Camera");
camera.addComponent(Camera);
camera.addComponent(AudioListener);
```

#### Extends

- [`Script`](#abstract-script)

#### Implements

- [`ScriptCallbacks`](#scriptcallbacks)

#### Constructors

##### Constructor

> **new AudioListener**(): [`AudioListener`](#audiolistener)

Creates a component. The engine constructs components; game code never calls `new`.

###### Returns

[`AudioListener`](#audiolistener)

###### Inherited from

[`Script`](#abstract-script).[`constructor`](#constructor-37)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

One pair of ears per entity.

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004). A listener has none: which listener is active is
decided by which one is enabled, and a scene file records that on the component itself.

##### typeId

> `static` **typeId**: `string`

The registration id the serializer and the inspector know this class by.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Script`](#abstract-script).[`app`](#app-16)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`enabled`](#enabled-18)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Script`](#abstract-script).[`entity`](#entity-15)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Script`](#abstract-script).[`handle`](#handle-12)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Script`](#abstract-script).[`isDestroyed`](#isdestroyed-12)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Script`](#abstract-script).[`isEnabledInHierarchy`](#isenabledinhierarchy-11)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Script`](#abstract-script).[`onDestroyed`](#ondestroyed-12)

##### spatialTarget

###### Get Signature

> **get** **spatialTarget**(): `SpatialTarget`

The world transform Lite's spatial listener follows: this entity's node
(`setSpatialListener(engine, { attachedTo })`, `index.d.ts` 11008).

###### Returns

`SpatialTarget`

The entity's Lite node, which exposes the `worldMatrix` a `SpatialTarget` needs.

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Script`](#abstract-script).[`transform`](#transform-13)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Script`](#abstract-script).[`uid`](#uid-16)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Script`](#abstract-script).[`world`](#world-13)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ScriptDefinition`](#scriptdefinition)\<`S`\>

Declares a script's serialized fields and returns the base class to extend — the `Script`
counterpart of `Component.define`.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ScriptDefinition`](#scriptdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Patrol extends Script.define({ waypoints: array(vec3()), speed: f32(3) }) {
  static typeId = "mygame/Patrol";
}
```

###### Inherited from

[`Script`](#abstract-script).[`define`](#define-11)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`destroy`](#destroy-12)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Script`](#abstract-script).[`getComponent`](#getcomponent-12)

##### onDisable()

> **onDisable**(): `void`

Hands the ears back to whichever listener was active before this one.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`onDisable`](#ondisable-3)

##### onEnable()

> **onEnable**(): `void`

Becomes the active listener.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`onEnable`](#onenable-2)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Script`](#abstract-script).[`requireComponent`](#requirecomponent-12)

##### startCoroutine()

> **startCoroutine**(`routine`): [`CoroutineHandle`](#coroutinehandle)

Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
coroutine is paused while the script is not effectively enabled and cancelled when it is
destroyed.

###### Parameters

###### routine

[`Coroutine`](#coroutine)

The generator to drive. Call the generator function: `this.spawnLoop()`.

###### Returns

[`CoroutineHandle`](#coroutinehandle)

A handle for stopping it or waiting on it.

###### Example

```ts
blink() {
  while (true) {
    this.renderer.enabled = !this.renderer.enabled;
    yield waitSeconds(0.2);
  }
}
onEnable(): void {
  this.startCoroutine(this.blink());
}
```

###### Inherited from

[`Script`](#abstract-script).[`startCoroutine`](#startcoroutine-3)

##### stopAllCoroutines()

> **stopAllCoroutines**(): `void`

Stops every coroutine this script started.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`stopAllCoroutines`](#stopallcoroutines-3)

##### stopCoroutine()

> **stopCoroutine**(`handle`): `void`

Stops one coroutine this script started. Stopping a finished coroutine is a no-op.

###### Parameters

###### handle

[`CoroutineHandle`](#coroutinehandle)

The handle [Script.startCoroutine](#startcoroutine-3) returned.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`stopCoroutine`](#stopcoroutine-3)

***

### AudioService

The service behind `app.audio`.

#### Example

```ts
app.audio.bus("Music").setVolume(0.3, 2);
app.audio.playOneShot(coin.value, { volume: 0.8, pitch: 1.2 });
await app.audio.unlock(); // from a click handler, for an explicit "tap to start"
```

#### Implements

- [`VoiceHost`](#voicehost)

#### Constructors

##### Constructor

> **new AudioService**(`options`): [`AudioService`](#audioservice)

Creates the service. The extension does this in `onStart`, once a backend exists.

###### Parameters

###### options

[`AudioServiceOptions`](#audioserviceoptions)

The app, the logger, the backend, and the resolved settings.

###### Returns

[`AudioService`](#audioservice)

#### Properties

##### backend

> `readonly` **backend**: [`AudioBackend`](#audiobackend)

The backend every call is forwarded to; `"headless"` under Node.

###### Implementation of

[`VoiceHost`](#voicehost).[`backend`](#backend-2)

#### Accessors

##### buses

###### Get Signature

> **get** **buses**(): `ReadonlyMap`\<`string`, [`AudioBus`](#audiobus)\>

The mixer tree, keyed by bus name, in declaration order.

###### Returns

`ReadonlyMap`\<`string`, [`AudioBus`](#audiobus)\>

The buses. Empty until the tree has been built, which is before the first frame unless
the project loads its tree from a `.audio.json`.

##### isLocked

###### Get Signature

> **get** **isLocked**(): `boolean`

`true` before the first unlock — the predicate voices queue on.

###### Returns

`boolean`

Whether plays are being held.

`true` before the first unlock, when a browser would refuse to make a sound.

###### Implementation of

[`VoiceHost`](#voicehost).[`isLocked`](#islocked-1)

##### isTreeReady

###### Get Signature

> **get** **isTreeReady**(): `boolean`

`true` once the mixer tree exists and sounds can be routed.

###### Returns

`boolean`

Whether the tree has been built.

##### isUnlocked

###### Get Signature

> **get** **isUnlocked**(): `boolean`

`true` once the audio context has run at least once, so plays are no longer queued.

###### Returns

`boolean`

Whether the engine has been unlocked.

##### listener

###### Get Signature

> **get** **listener**(): [`AudioListener`](#audiolistener) \| `null`

The listener spatial audio is heard from (`docs/architecture/10-audio.md` §4).

###### Returns

[`AudioListener`](#audiolistener) \| `null`

The most recently enabled [AudioListener](#audiolistener), or `null` when none is enabled.

##### lite

###### Get Signature

> **get** **lite**(): [`AudioServiceLiteHandles`](#audioservicelitehandles)

The Babylon Lite objects behind the service. Unstable escape hatch.

###### Returns

[`AudioServiceLiteHandles`](#audioservicelitehandles)

The engine, or `null` under the headless backend.

##### masterVolume

###### Get Signature

> **get** **masterVolume**(): `number`

The master output gain, applied after every bus.

###### Returns

`number`

The linear gain, where `1` is unity.

###### Set Signature

> **set** **masterVolume**(`value`): `void`

###### Parameters

###### value

`number`

###### Returns

`void`

##### onStateChanged

###### Get Signature

> **get** **onStateChanged**(): [`SignalLike`](#signallike)\<[`AudioServiceState`](#audioservicestate-1)\>

Emitted whenever [AudioService.state](#state-2) changes.

###### Returns

[`SignalLike`](#signallike)\<[`AudioServiceState`](#audioservicestate-1)\>

The signal.

##### queueWhileLocked

###### Get Signature

> **get** **queueWhileLocked**(): `boolean`

Whether plays made while locked are held rather than dropped.

###### Returns

`boolean`

The `audio.queueWhileLocked` setting.

Whether plays made while locked are held rather than dropped.

###### Implementation of

[`VoiceHost`](#voicehost).[`queueWhileLocked`](#queuewhilelocked-3)

##### state

###### Get Signature

> **get** **state**(): [`AudioServiceState`](#audioservicestate-1)

Where the audio engine is (`docs/architecture/10-audio.md` §1).

###### Returns

[`AudioServiceState`](#audioservicestate-1)

`"locked"` until the first unlock, and the audio context's own state after it.

##### unlockedAtMs

###### Get Signature

> **get** **unlockedAtMs**(): `number` \| `null`

When the engine was unlocked, on the app's realtime clock.

###### Returns

`number` \| `null`

Milliseconds since the app was created, or `null` while still locked.

#### Methods

##### buildBuses()

> **buildBuses**(`definitions`): `Promise`\<`void`\>

Builds the mixer tree, releasing whatever tree was there before.

###### Parameters

###### definitions

readonly [`AudioBusDefinition`](#audiobusdefinition)[]

The buses, parents before children.

###### Returns

`Promise`\<`void`\>

###### Throws

IgnifxError with code `IGX-1006` when a definition names a parent that is not declared
before it.

##### bus()

> **bus**(`name`): [`AudioBus`](#audiobus)

Looks a bus up by name.

###### Parameters

###### name

`string`

The bus name, for example `"Music"`.

###### Returns

[`AudioBus`](#audiobus)

The bus.

###### Throws

IgnifxError with code `IGX-1001` when the tree holds no such bus.

###### Example

```ts
app.audio.bus("SFX").volume = 0.5;
```

##### createBus()

> **createBus**(`name`, `options?`): `Promise`\<[`AudioBus`](#audiobus)\>

Adds a bus to the tree at run time.

###### Parameters

###### name

`string`

The new bus's name.

###### options?

[`CreateBusOptions`](#createbusoptions)

Its parent, gain, and pause behaviour.

###### Returns

`Promise`\<[`AudioBus`](#audiobus)\>

The bus, once the backend has built it.

###### Throws

IgnifxError with code `IGX-1001` when `options.parent` names a bus that does not exist,
or `IGX-1005` when the name is already taken.

###### Example

```ts
const ambience = await app.audio.createBus("Ambience", { parent: "Master", volume: 0.4 });
```

##### createVoice()

> **createVoice**(`request`): [`SoundVoice`](#soundvoice)

Builds a voice: one clip routed to one bus, with the options an `AudioSource` carries.

###### Parameters

###### request

[`VoiceRequest`](#voicerequest)

The clip, the bus name, and the per-sound options.

###### Returns

[`SoundVoice`](#soundvoice)

The voice.

###### Remarks

The backend sound is created as soon as the mixer tree exists, which is normally before the
first frame; a voice built earlier holds its plays until then, the same way it holds them
behind the unlock.

###### Example

```ts
const voice = app.audio.createVoice({
  clip, bus: "SFX", volume: 1, playbackRate: 1, loop: false, maxInstances: 8, pan: 0, spatial: null,
});
```

##### defaultBusTree()

> `static` **defaultBusTree**(`names`): readonly [`AudioBusDefinition`](#audiobusdefinition)[]

Turns a list of bus names into the default tree: the first name is the root and every other
name routes into it (`docs/architecture/10-audio.md` §1).

###### Parameters

###### names

readonly `string`[]

The bus names, root first.

###### Returns

readonly [`AudioBusDefinition`](#audiobusdefinition)[]

The definitions to hand [AudioService.buildBuses](#buildbuses).

##### dispose()

> **dispose**(): `void`

Releases every voice, every bus, and the backend itself.

###### Returns

`void`

##### playOneShot()

> **playOneShot**(`clip`, `options?`): [`SoundInstance`](#soundinstance)

Plays a clip once, with no component and nothing to keep hold of — a coin pickup, a UI click
(`docs/architecture/10-audio.md` §1).

###### Parameters

###### clip

[`AudioClip`](#audioclip)

The clip to play.

###### options?

[`OneShotOptions`](#oneshotoptions)

Per-play overrides, and the bus to route through.

###### Returns

[`SoundInstance`](#soundinstance)

The sound, so a caller that wants to can stop or fade it.

###### Remarks

One voice is kept per clip-and-bus pair and reused, so a hundred coins in a second cost one
Web Audio sub-graph and a hundred instances, with the oldest stolen past sixteen. The clip must
already be loaded; an `asset()` field hands you exactly that.

###### Example

```ts
class Coin extends Script {
  pickup: AssetHandle<AudioClip> | null = null;
  onTriggerEnter(): void {
    if (this.pickup !== null) {
      this.app.audio.playOneShot(this.pickup.value, { pitch: 1 + Math.random() * 0.1 });
    }
  }
}
```

##### pump()

> **pump**(`deltaSeconds`): `void`

Advances everything time-based by one frame: fades, pending stops, the app-pause transition,
simulated playback, and `onEnded` (`docs/architecture/01-lifecycle-and-time.md` §3 step 10).

###### Parameters

###### deltaSeconds

`number`

The frame delta in seconds.

###### Returns

`void`

##### registerListener()

> **registerListener**(`listener`): `void`

Adds a listener to the selection (`docs/architecture/10-audio.md` §4). The most recently
registered enabled listener wins, which during a scene load is the one with the highest
creation serial.

###### Parameters

###### listener

[`AudioListener`](#audiolistener)

The listener that just became enabled.

###### Returns

`void`

##### releaseVoice()

> **releaseVoice**(`voice`): `void`

Releases a voice and its backend sound.

###### Parameters

###### voice

[`SoundVoice`](#soundvoice)

The voice to release.

###### Returns

`void`

##### reportError()

> **reportError**(`error`): `void`

Reports a failure that has no caller to throw at, through `app.onError`.

###### Parameters

###### error

`unknown`

What went wrong.

###### Returns

`void`

###### Implementation of

[`VoiceHost`](#voicehost).[`reportError`](#reporterror-1)

##### setDiagnostics()

> **setDiagnostics**(`group`): `void`

Attaches the diagnostics group the extension registered.

###### Parameters

###### group

[`DiagnosticsGroup`](#diagnosticsgroup-1)

The `audio` counter group.

###### Returns

`void`

##### tryBus()

> **tryBus**(`name`): [`AudioBus`](#audiobus) \| `null`

Looks a bus up, tolerating its absence — the pattern for code that must work with or without a
particular bus (coding standards §5.5).

###### Parameters

###### name

`string`

The bus name.

###### Returns

[`AudioBus`](#audiobus) \| `null`

The bus, or `null`.

##### unlock()

> **unlock**(): `Promise`\<`void`\>

Resumes the audio context — what a "tap to start" button calls
(`docs/architecture/10-audio.md` §1).

###### Returns

`Promise`\<`void`\>

A promise that settles once the context is running.

###### Remarks

Every `play()` made while locked is started as this settles, in the order it was requested.
Calling it when already unlocked is a no-op. Call it from inside a real user-gesture handler:
browsers ignore a resume that does not come from one.

###### Example

```ts
button.addEventListener("click", () => void app.audio.unlock());
```

##### unregisterListener()

> **unregisterListener**(`listener`): `void`

Removes a listener from the selection.

###### Parameters

###### listener

[`AudioListener`](#audiolistener)

The listener that was disabled or destroyed.

###### Returns

`void`

***

### AudioSource

A sound attached to an entity.

#### Example

```ts
class Footsteps extends Script {
  #source: AudioSource | null = null;
  awake(): void {
    this.#source = this.requireComponent(AudioSource);
  }
  step(): void {
    this.#source?.play({ pitch: 0.9 + Math.random() * 0.2 });
  }
}
```

#### Extends

- [`Script`](#abstract-script)

#### Implements

- [`ScriptCallbacks`](#scriptcallbacks)

#### Constructors

##### Constructor

> **new AudioSource**(): [`AudioSource`](#audiosource)

Applies the schema defaults, exactly as `Script.define` would.

###### Returns

[`AudioSource`](#audiosource)

###### Overrides

[`Script`](#abstract-script).[`constructor`](#constructor-37)

#### Properties

##### bus

> **bus**: `string`

Which mixer bus this source routes into.

##### clip

> **clip**: [`AssetHandle`](#assethandle)\<[`AudioClip`](#audioclip)\> \| `null`

The sound to play.

##### cone

> **cone**: [`AudioConeSettings`](#audioconesettings)

The source's directionality, in degrees.

##### distanceModel

> **distanceModel**: `"linear"` \| `"inverse"` \| `"exponential"`

Which attenuation curve distance follows.

##### loop

> **loop**: `boolean`

Whether instances repeat instead of ending.

##### maxDistance

> **maxDistance**: `number`

Maximum distance, in metres; used by the `"linear"` model.

##### maxInstances

> **maxInstances**: `number`

How many instances may sound at once; the oldest is stolen above it.

##### minDistance

> **minDistance**: `number`

Distance below which no attenuation is applied, in metres.

##### pan

> **pan**: `number`

Stereo pan of a non-spatial source, in `[-1, 1]`.

##### pitch

> **pitch**: `number`

Playback rate; Lite's own `pitch` is in cents and is not exposed.

##### playOnAwake

> **playOnAwake**: `boolean`

Whether to play once as soon as the entity comes alive.

##### rolloff

> **rolloff**: `number`

How steeply the sound falls off with distance.

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### spatial

> **spatial**: `boolean`

Whether the sound is positioned in 3D instead of in the stereo field.

##### typeId

> `static` **typeId**: `string`

The registration id the serializer and the inspector know this class by.

##### volume

> **volume**: `number`

The sound's own linear gain, in `[0, 1]`.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Script`](#abstract-script).[`app`](#app-16)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`enabled`](#enabled-18)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Script`](#abstract-script).[`entity`](#entity-15)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Script`](#abstract-script).[`handle`](#handle-12)

##### instance

###### Get Signature

> **get** **instance**(): [`SoundInstance`](#soundinstance) \| `null`

The sound this source is playing, once it has played at least once.

###### Returns

[`SoundInstance`](#soundinstance) \| `null`

The instance, or `null`.

##### instanceCount

###### Get Signature

> **get** **instanceCount**(): `number`

How many instances of this source are live.

###### Returns

`number`

The instance count, `0` when nothing is playing.

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Script`](#abstract-script).[`isDestroyed`](#isdestroyed-12)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Script`](#abstract-script).[`isEnabledInHierarchy`](#isenabledinhierarchy-11)

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

`true` while at least one instance is sounding, or waiting behind the unlock.

###### Returns

`boolean`

Whether the source is making a sound.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Script`](#abstract-script).[`onDestroyed`](#ondestroyed-12)

##### onEnded

###### Get Signature

> **get** **onEnded**(): [`SignalLike`](#signallike)

Emitted in `PreRender` on the frame the last instance stops sounding, whether it ran out or was
stopped (`docs/architecture/10-audio.md` §3).

###### Returns

[`SignalLike`](#signallike)

The signal.

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Script`](#abstract-script).[`transform`](#transform-13)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Script`](#abstract-script).[`uid`](#uid-16)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Script`](#abstract-script).[`world`](#world-13)

#### Methods

##### awake()

> **awake**(): `void`

Starts the source when `playOnAwake` is set, after the scene's props have been decoded.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`awake`](#awake-3)

##### define()

> `static` **define**\<`S`\>(`schema`): [`ScriptDefinition`](#scriptdefinition)\<`S`\>

Declares a script's serialized fields and returns the base class to extend — the `Script`
counterpart of `Component.define`.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ScriptDefinition`](#scriptdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Patrol extends Script.define({ waypoints: array(vec3()), speed: f32(3) }) {
  static typeId = "mygame/Patrol";
}
```

###### Inherited from

[`Script`](#abstract-script).[`define`](#define-11)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`destroy`](#destroy-12)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Script`](#abstract-script).[`getComponent`](#getcomponent-12)

##### onDestroy()

> **onDestroy**(): `void`

Releases the voice and its backend sound.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`onDestroy`](#ondestroy-3)

##### onDisable()

> **onDisable**(): `void`

Stops everything this source is playing; a disabled source makes no sound.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`onDisable`](#ondisable-3)

##### pause()

> **pause**(): `void`

Pauses every instance, keeping its position.

###### Returns

`void`

##### play()

> **play**(`options?`): [`SoundInstance`](#soundinstance) \| `null`

Starts one more instance of this source's clip.

###### Parameters

###### options?

[`PlayOptions`](#playoptions)

Per-play overrides for volume, pitch, loop, delay, start offset, and duration.

###### Returns

[`SoundInstance`](#soundinstance) \| `null`

The sound, so a caller can fade or stop it; `null` when the source has no clip.

###### Throws

IgnifxError with code `IGX-1001` when `bus` names a bus the tree does not hold.

###### Example

```ts
this.source.play({ volume: 0.6, delay: 0.25 });
```

##### playOneShot()

> **playOneShot**(`clip`, `options?`): [`SoundInstance`](#soundinstance)

Plays another clip once through this source's bus, without disturbing what this source is
playing (`docs/architecture/10-audio.md` §3).

###### Parameters

###### clip

[`AudioClip`](#audioclip)

The clip to play.

###### options?

[`OneShotVolume`](#oneshotvolume)

The gain for this one play.

###### Returns

[`SoundInstance`](#soundinstance)

The sound.

###### Example

```ts
this.source.playOneShot(this.impact.value, { volume: 0.5 });
```

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Script`](#abstract-script).[`requireComponent`](#requirecomponent-12)

##### resume()

> **resume**(): `void`

Resumes every paused instance.

###### Returns

`void`

##### startCoroutine()

> **startCoroutine**(`routine`): [`CoroutineHandle`](#coroutinehandle)

Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
coroutine is paused while the script is not effectively enabled and cancelled when it is
destroyed.

###### Parameters

###### routine

[`Coroutine`](#coroutine)

The generator to drive. Call the generator function: `this.spawnLoop()`.

###### Returns

[`CoroutineHandle`](#coroutinehandle)

A handle for stopping it or waiting on it.

###### Example

```ts
blink() {
  while (true) {
    this.renderer.enabled = !this.renderer.enabled;
    yield waitSeconds(0.2);
  }
}
onEnable(): void {
  this.startCoroutine(this.blink());
}
```

###### Inherited from

[`Script`](#abstract-script).[`startCoroutine`](#startcoroutine-3)

##### stop()

> **stop**(`fadeSeconds?`): `void`

Stops every instance, optionally fading out first.

###### Parameters

###### fadeSeconds?

`number`

Seconds of frame time to fade over; omitted or `0` stops now.

###### Returns

`void`

##### stopAllCoroutines()

> **stopAllCoroutines**(): `void`

Stops every coroutine this script started.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`stopAllCoroutines`](#stopallcoroutines-3)

##### stopCoroutine()

> **stopCoroutine**(`handle`): `void`

Stops one coroutine this script started. Stopping a finished coroutine is a no-op.

###### Parameters

###### handle

[`CoroutineHandle`](#coroutinehandle)

The handle [Script.startCoroutine](#startcoroutine-3) returned.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`stopCoroutine`](#stopcoroutine-3)

##### update()

> **update**(): `void`

Pushes the field changes a running sound can accept and rebuilds the voice when one it cannot
accept changed.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`update`](#update-5)

***

### Binding

One binding of one action.

#### Remarks

A binding tagged with a control scheme still resolves when another scheme is active. Unity's
schemes filter device *pairing* and UI glyphs, not resolution, and a game that binds jump to both
the space bar and the south button expects both to work whichever scheme the player used last.
Set `input.strictSchemes` to make the tag a filter instead.

#### Example

```ts
const jump = app.input.actions.get("jump");
jump.bindings[0].overridePath = "<Keyboard>/enter";
```

#### Constructors

##### Constructor

> **new Binding**(`definition`, `resolver`): [`Binding`](#binding)

Builds a binding from its document form.

###### Parameters

###### definition

[`BindingDefinition`](#bindingdefinition)

The binding as it appears in an `ignifx.inputactions` document.

###### resolver

[`BindingResolver`](#bindingresolver)

How paths become controls, and how the owner is told they changed.

###### Returns

[`Binding`](#binding)

###### Throws

IgnifxError with code `IGX-0802`, `IGX-0803`, or `IGX-0806` when the definition names
an unknown processor, an unresolvable path, or an unknown composite.

#### Properties

##### composite

> `readonly` **composite**: [`CompositeKind`](#compositekind-1) \| `null`

The composite this binding uses, or `null` for a simple path binding.

##### partNames

> `readonly` **partNames**: readonly `string`[]

The composite part names, in evaluation order; empty for a simple binding.

##### partPaths

> `readonly` **partPaths**: readonly `string`[]

The path each composite part was declared with, in [Binding.partNames](#partnames) order.

##### path

> `readonly` **path**: `string`

The path the binding was declared with; `""` for a composite.

##### processors

> `readonly` **processors**: readonly `string`[]

The processor strings the binding declared, in application order.

##### scheme

> `readonly` **scheme**: `string`

The control scheme this binding is tagged with; `""` when it belongs to every scheme.

#### Accessors

##### effectivePath

###### Get Signature

> **get** **effectivePath**(): `string`

The path the binding actually reads: the override when there is one, otherwise the declared
path.

###### Returns

`string`

The effective path; `""` for a composite with no override.

##### overridePath

###### Get Signature

> **get** **overridePath**(): `string` \| `null`

The path that replaces [Binding.path](#path) at run time, or `null` when the binding is not
overridden (`docs/architecture/08-input.md` §6).

###### Remarks

Assigning re-resolves the binding: a path that does not resolve throws `IGX-0803` and the
previous override is kept. A composite binding cannot be overridden as a whole; override the
action's simple bindings instead.

###### Returns

`string` \| `null`

The override, or `null`. Assign `null` to return to the declared path.

###### Set Signature

> **set** **overridePath**(`path`): `void`

###### Parameters

###### path

`string` \| `null`

###### Returns

`void`

***

### Camera

The camera an entity renders the world through (`docs/architecture/07-rendering.md` §2.1).

#### Remarks

A world renders through the enabled camera with the highest `priority`; ties break on creation
order. A world with no enabled camera draws nothing and logs `IGX-0706` once.

#### Example

```ts
const eye = world.createEntity("Main Camera", { position: { x: 0, y: 2, z: -6 } });
eye.addComponent(Camera, { fov: 50, near: 0.05 });
```

#### Extends

- [`Component`](#abstract-component)

#### Implements

- [`ComponentHooks`](#componenthooks)

#### Constructors

##### Constructor

> **new Camera**(): [`Camera`](#camera)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`Camera`](#camera)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

At most one camera per entity: two views from one transform would be the same view.

##### clearColor

> **clearColor**: [`ColorLike`](#colorlike) \| `null`

##### far

> **far**: `number`

##### fov

> **fov**: `number`

##### near

> **near**: `number`

##### orthographicSize

> **orthographicSize**: `number`

##### priority

> **priority**: `number`

##### projection

> **projection**: `"perspective"` \| `"orthographic"`

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### typeId

> `static` **typeId**: `string`

The namespaced registration id.

##### viewport

> **viewport**: `object`

###### height

> **height**: `number`

###### width

> **width**: `number`

###### x

> **x**: `number`

###### y

> **y**: `number`

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### lite

###### Get Signature

> **get** **lite**(): `object`

The Babylon Lite camera this component owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

`object`

The camera, or `null` before the component is attached.

###### camera

> `readonly` **camera**: `FreeCamera` \| `null`

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### getProjectionMatrix()

> **getProjectionMatrix**(`out`): [`Mat4`](#mat4)

Copies the camera's projection matrix into `out`.

###### Parameters

###### out

[`Mat4`](#mat4)

A 4x4 matrix that receives the result, column-major.

###### Returns

[`Mat4`](#mat4)

`out`, for chaining.

##### getViewMatrix()

> **getViewMatrix**(`out`): [`Mat4`](#mat4)

Copies the camera's view matrix — the inverse of its world matrix — into `out`.

###### Parameters

###### out

[`Mat4`](#mat4)

A 4x4 matrix that receives the result, column-major.

###### Returns

[`Mat4`](#mat4)

`out`, for chaining.

##### onAttach()

> **onAttach**(): `void`

Creates the Lite camera and parents it under the entity's node.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onAttach`](#onattach-1)

##### onDetach()

> **onDetach**(): `void`

Drops the Lite camera.

###### Returns

`void`

###### Remarks

A Lite camera holds no GPU resource and is never added to the scene — only assigned to
`scene.camera` — so breaking the parent link and forgetting it is the whole teardown. The
`PreRender` system re-picks the main camera on the next frame and clears `scene.camera` when
this was the last one.

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onDetach`](#ondetach-1)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

##### screenToRay()

> **screenToRay**(`x`, `y`, `out?`): [`Ray`](#ray) \| `null`

Builds a world-space ray through a point on the canvas.

###### Parameters

###### x

`number`

The CSS pixel x, from the canvas's left edge.

###### y

`number`

The CSS pixel y, from the canvas's top edge.

###### out?

[`Ray`](#ray)

The ray to fill; a fresh one is allocated when omitted.

###### Returns

[`Ray`](#ray) \| `null`

`out`, or `null` when the view-projection matrix is singular — a zero-sized viewport,
or a camera that is not attached.

###### Example

```ts
const ray = camera.screenToRay(event.offsetX, event.offsetY);
const hit = ray === null ? null : world.raycastRender(ray);
```

##### screenToWorldPoint()

> **screenToWorldPoint**(`x`, `y`, `distance`, `out`): [`MutableVec3`](#mutablevec3) \| `null`

The world-space point a canvas pixel maps to at a given distance along the view ray.

###### Parameters

###### x

`number`

The CSS pixel x, from the canvas's left edge.

###### y

`number`

The CSS pixel y, from the canvas's top edge.

###### distance

`number`

How far along the ray to travel, in metres.

###### out

[`MutableVec3`](#mutablevec3)

Receives the point.

###### Returns

[`MutableVec3`](#mutablevec3) \| `null`

`out`, or `null` when no ray could be built.

##### viewportToWorldPoint()

> **viewportToWorldPoint**(`u`, `v`, `distance`, `out`): [`MutableVec3`](#mutablevec3) \| `null`

The world-space point a **normalized** viewport coordinate maps to.

###### Parameters

###### u

`number`

The horizontal coordinate, `0` at the viewport's left edge and `1` at its right.

###### v

`number`

The vertical coordinate, `0` at the **bottom** edge and `1` at the top, matching
Babylon's viewport convention.

###### distance

`number`

How far along the ray to travel, in metres.

###### out

[`MutableVec3`](#mutablevec3)

Receives the point.

###### Returns

[`MutableVec3`](#mutablevec3) \| `null`

`out`, or `null` when no ray could be built.

##### worldToScreen()

> **worldToScreen**(`point`, `out`): `boolean`

Projects a world-space point onto the canvas.

###### Parameters

###### point

[`Vec3Like`](#vec3like)

The world-space point.

###### out

[`MutableVec3`](#mutablevec3)

Receives the pixel position in `x`/`y` — measured from the viewport's top left —
and the clip depth in `z`, which is `1` at the near plane and `0` at the far plane because
Lite's projection is reverse-depth.

###### Returns

`boolean`

`true` when the point is in front of the camera; `false` when it is behind it, in which
case `out` holds a mirrored projection and should be ignored.

***

### Color

An RGBA colour whose components are **linear** and normally in 0-1 (values above 1 are allowed
and mean HDR intensity). Lighting maths only works in linear space, which is why this is the
space ignifx stores; scene files and hex strings are sRGB, and
[Color.fromHex](#fromhex)/[Color.fromSrgb](#fromsrgb) are the doors between the two
(`docs/architecture/06-serialization-and-scene-format.md` section 3).

Every method says which space it works in. The rule of thumb: if it takes or returns a hex string
or has `Srgb` in its name, it is sRGB; everything else is linear.

#### Example

```ts
const tint = Color.fromHex("#ff8800") ?? new Color(1, 1, 1, 1); // parsed as sRGB, stored linear
tint.scaleRgb(2);                                              // twice as bright, same alpha
tint.toHex();                                                  // back to sRGB: "#ffbe00"
```

#### Constructors

##### Constructor

> **new Color**(`r?`, `g?`, `b?`, `a?`): [`Color`](#color-3)

Creates a colour from linear components.

###### Parameters

###### r?

`number`

The linear red component. Defaults to 0.

###### g?

`number`

The linear green component. Defaults to 0.

###### b?

`number`

The linear blue component. Defaults to 0.

###### a?

`number`

The alpha component. Defaults to 1 (opaque).

###### Returns

[`Color`](#color-3)

#### Properties

##### a

> **a**: `number`

The alpha component in 0-1. Alpha is always linear, never gamma encoded.

##### b

> **b**: `number`

The linear blue component.

##### g

> **g**: `number`

The linear green component.

##### r

> **r**: `number`

The linear red component.

#### Methods

##### black()

> `static` **black**(): [`Color`](#color-3)

Opaque black.

###### Returns

[`Color`](#color-3)

A new linear `(0, 0, 0, 1)`. **Allocates.**

##### clone()

> **clone**(): [`Color`](#color-3)

Copies this colour into a new one.

###### Returns

[`Color`](#color-3)

A new colour. **Allocates.**

##### copyFrom()

> **copyFrom**(`c`): `this`

Copies every component from another colour.

###### Parameters

###### c

[`ColorLike`](#colorlike)

The colour to read.

###### Returns

`this`

This colour.

##### equalsWithEpsilon()

> `static` **equalsWithEpsilon**(`a`, `b`, `epsilon?`): `boolean`

Compares two colours component by component, with a tolerance.

###### Parameters

###### a

[`ColorLike`](#colorlike)

The first colour.

###### b

[`ColorLike`](#colorlike)

The second colour.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### equalsWithEpsilon()

> **equalsWithEpsilon**(`c`, `epsilon?`): `boolean`

Compares this colour with another, component by component, with a tolerance.

###### Parameters

###### c

[`ColorLike`](#colorlike)

The colour to compare against.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### from()

> `static` **from**(`c`): [`Color`](#color-3)

Copies any colour-shaped value into a `Color`.

###### Parameters

###### c

[`ColorLike`](#colorlike)

The linear colour to copy.

###### Returns

[`Color`](#color-3)

A new colour. **Allocates.**

##### fromHex()

> `static` **fromHex**(`hex`): [`Color`](#color-3) \| `null`

Parses an **sRGB** hex string into a linear colour.

###### Parameters

###### hex

`string`

`#rrggbb` or `#rrggbbaa`, with or without the leading `#`, in either case.

###### Returns

[`Color`](#color-3) \| `null`

A new colour, or `null` when the string is not a hex colour. Colours arrive from files
and user input, so a bad one is expected absence rather than API misuse (coding standards
section 5.5): the caller decides whether to substitute a default or raise a load error.
**Allocates.**

###### Example

```ts
const tint = Color.fromHex("#ff8800aa") ?? Color.white();
```

##### fromHexToRef()

> `static` **fromHexToRef**(`hex`, `out`): `boolean`

Parses an **sRGB** hex string into `out` as linear components.

###### Parameters

###### hex

`string`

`#rrggbb` or `#rrggbbaa`, with or without the leading `#`, in either case.

###### out

[`Color`](#color-3)

The colour to write; left untouched when parsing fails.

###### Returns

`boolean`

`true` when `hex` was a valid hex colour.

##### fromSrgb()

> `static` **fromSrgb**(`r`, `g`, `b`, `a?`): [`Color`](#color-3)

Builds a colour from **sRGB** components, converting RGB to linear and taking alpha as-is.

###### Parameters

###### r

`number`

The sRGB red component, 0-1.

###### g

`number`

The sRGB green component, 0-1.

###### b

`number`

The sRGB blue component, 0-1.

###### a?

`number`

The alpha component, 0-1. Defaults to 1.

###### Returns

[`Color`](#color-3)

A new colour holding linear components. **Allocates.**

##### fromSrgbToRef()

> `static` **fromSrgbToRef**\<`TOut`\>(`r`, `g`, `b`, `a`, `out`): `TOut`

Writes a colour built from **sRGB** components into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`Color`](#color-3)

###### Parameters

###### r

`number`

The sRGB red component, 0-1.

###### g

`number`

The sRGB green component, 0-1.

###### b

`number`

The sRGB blue component, 0-1.

###### a

`number`

The alpha component, 0-1.

###### out

`TOut`

The colour to write; holds linear components afterwards.

###### Returns

`TOut`

`out`.

##### lerp()

> **lerp**(`target`, `t`): `this`

Moves this colour towards a target, in linear space (which is where blending belongs; lerping
sRGB values darkens midpoints).

###### Parameters

###### target

[`ColorLike`](#colorlike)

The colour reached at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

`this`

This colour.

##### lerpToRef()

> `static` **lerpToRef**\<`TOut`\>(`a`, `b`, `t`, `out`): `TOut`

Writes the linear-space interpolation of `a` and `b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`Color`](#color-3)

###### Parameters

###### a

[`ColorLike`](#colorlike)

The colour written at `t === 0`.

###### b

[`ColorLike`](#colorlike)

The colour written at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### out

`TOut`

The colour to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### linearToSrgb()

> `static` **linearToSrgb**(`channel`): `number`

Converts one **linear** channel to sRGB, the inverse of [Color.srgbToLinear](#srgbtolinear).

###### Parameters

###### channel

`number`

The linear channel value; clamped into 0-1, so HDR intensity is lost.

###### Returns

`number`

The sRGB value.

##### multiply()

> **multiply**(`c`): `this`

Multiplies this colour by another, component by component including alpha — the usual way a
tint is applied.

###### Parameters

###### c

[`ColorLike`](#colorlike)

The colour to multiply by.

###### Returns

`this`

This colour.

##### multiplyToRef()

> `static` **multiplyToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes the component-wise product `a * b` into `out`, in linear space.

###### Type Parameters

###### TOut

`TOut` *extends* [`Color`](#color-3)

###### Parameters

###### a

[`ColorLike`](#colorlike)

The first colour.

###### b

[`ColorLike`](#colorlike)

The second colour.

###### out

`TOut`

The colour to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### scaleRgb()

> **scaleRgb**(`factor`): `this`

Scales the linear RGB components, leaving alpha alone. This is what "brighter" means: alpha is
coverage, not colour.

###### Parameters

###### factor

`number`

The intensity factor.

###### Returns

`this`

This colour.

##### scaleRgbToRef()

> `static` **scaleRgbToRef**\<`TOut`\>(`c`, `factor`, `out`): `TOut`

Writes `c` with its RGB scaled and its alpha untouched into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`Color`](#color-3)

###### Parameters

###### c

[`ColorLike`](#colorlike)

The colour to scale.

###### factor

`number`

The intensity factor.

###### out

`TOut`

The colour to write; may alias `c`.

###### Returns

`TOut`

`out`.

##### set()

> **set**(`r`, `g`, `b`, `a`): `this`

Assigns every component at once, in linear space.

###### Parameters

###### r

`number`

The new linear red component.

###### g

`number`

The new linear green component.

###### b

`number`

The new linear blue component.

###### a

`number`

The new alpha component.

###### Returns

`this`

This colour.

##### srgbToLinear()

> `static` **srgbToLinear**(`channel`): `number`

Converts one **sRGB** channel to linear, using the IEC 61966-2-1 curve Babylon Lite uses
(`lib/math/color.js`).

###### Parameters

###### channel

`number`

The sRGB channel value; clamped into 0-1.

###### Returns

`number`

The linear value.

##### toArray()

> **toArray**(`out`, `offset?`): `Float32Array`

Writes the **linear** components into a `Float32Array`, the form a shader wants. The output
comes first to mirror Babylon Lite's `toArray` helpers.

###### Parameters

###### out

`Float32Array`

The array to write into.

###### offset?

`number`

The index of the red component. Defaults to 0.

###### Returns

`Float32Array`

`out`.

##### toHex()

> **toHex**(): `string`

Encodes this colour as an sRGB hex string.

###### Returns

`string`

`#rrggbb` for an opaque colour, `#rrggbbaa` when alpha is below 1. **Allocates a
string.**

###### Example

```ts
new Color(1, 1, 1, 1).toHex(); // "#ffffff"
```

##### toSrgbToRef()

> **toSrgbToRef**\<`TOut`\>(`out`): `TOut`

Writes this colour's **sRGB-encoded** components into `out`, for display, pickers and files.
Components are clamped into 0-1 by the encoding curve.

###### Type Parameters

###### TOut

`TOut` *extends* [`Color`](#color-3)

###### Parameters

###### out

`TOut`

The colour to write; may be this colour. Its fields hold sRGB values afterwards,
not linear ones.

###### Returns

`TOut`

`out`.

##### transparent()

> `static` **transparent**(): [`Color`](#color-3)

Fully transparent black.

###### Returns

[`Color`](#color-3)

A new linear `(0, 0, 0, 0)`. **Allocates.**

##### white()

> `static` **white**(): [`Color`](#color-3)

Opaque white.

###### Returns

[`Color`](#color-3)

A new linear `(1, 1, 1, 1)`. **Allocates.**

***

### `abstract` Component

Typed data and behaviour attached to an entity
(`docs/architecture/03-scripting-and-components.md` §1). Engine-owned components
(`MeshRenderer`, `Rigidbody`, `AudioSource`) are plain `Component`s driven by systems; game
behaviour extends `Script`, which adds the frame lifecycle.

#### Remarks

A component class must have a no-argument constructor: the engine constructs it, then assigns
`entity`, `uid`, and `handle`, then applies schema defaults and the `init` object, then calls
`onAttach`. Reading `this.entity` from a constructor therefore throws `IGX-0206`; cache lookups
in `onAttach` or `awake` instead.

**Where the statics are declared.** `typeId`, `schema`, `requires`, and `allowMultiple` are not
members of this class. Declaring them here would make every `static typeId = "mygame/Mover"` an
override and force the `override` keyword on it under `noImplicitOverride` (coding standards §3)
— the same reasoning that keeps the callbacks on [ComponentHooks](#componenthooks). The shape lives on
[ComponentStatics](#componentstatics) instead, and `ComponentRegistry` reads it once per class and supplies
the defaults (`allowMultiple` is `true` when the class declares nothing).

#### Example

```ts
class Health extends Component.define({ maximum: f32(100) }) {
  static typeId = "mygame/Health";
  current = 0;
  onAttach(): void {
    this.current = this.maximum;
  }
}
```

#### Extended by

- [`Camera`](#camera)
- [`Environment`](#environment)
- [`Light`](#light)
- [`MeshRenderer`](#meshrenderer)
- [`Model`](#model)
- [`PostProcessStack`](#postprocessstack)
- [`Script`](#abstract-script)
- [`Transform`](#transform-14)
- [`PlayerInput`](#playerinput)

#### Implements

- [`SignalOwner`](#signalowner)

#### Constructors

##### Constructor

> **new Component**(): [`Component`](#abstract-component)

Creates a component. The engine constructs components; game code never calls `new`.

###### Returns

[`Component`](#abstract-component)

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Implementation of

[`SignalOwner`](#signalowner).[`isDestroyed`](#isdestroyed-13)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Implementation of

[`SignalOwner`](#signalowner).[`onDestroyed`](#ondestroyed-13)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

***

### ComponentRegistry

The component-class table of one app. There is one per [App](#app), never a module-level one
(`CONSTITUTION.md` §3.5, §3.6): two apps in one test process must not see each other's types.

#### Example

```ts
const registry = new ComponentRegistry();
registry.register(Mover);
registry.get("mygame/Mover"); // Mover
```

#### Constructors

##### Constructor

> **new ComponentRegistry**(): [`ComponentRegistry`](#componentregistry)

###### Returns

[`ComponentRegistry`](#componentregistry)

#### Accessors

##### size

###### Get Signature

> **get** **size**(): `number`

How many classes the registry has described, registered explicitly or not.

###### Returns

`number`

The class count.

#### Methods

##### describe()

> **describe**(`type`): [`ComponentClassInfo`](#componentclassinfo)

Describes a class, computing and caching its info on first sight. Explicit registration is only
needed for *serializable* components; a script added from code is described the first time it
is attached (`docs/architecture/03-scripting-and-components.md` §4).

###### Parameters

###### type

[`ComponentType`](#componenttype-1)

The component class.

###### Returns

[`ComponentClassInfo`](#componentclassinfo)

The cached class info.

##### get()

> **get**(`typeId`): [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\> \| `null`

Looks a class up by its registered id.

###### Parameters

###### typeId

`string`

The namespaced id.

###### Returns

[`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\> \| `null`

The class, or `null` when nothing is registered under the id.

##### implementsCallback()

> **implementsCallback**(`type`, `kind`): `boolean`

Reports whether a component class implements a script callback, from the bit mask the registry
computed when it first described the class. Extension authors use it to decide once per class
what a per-frame path would otherwise have to rediscover
(`docs/architecture/04-extensions.md` §3).

###### Parameters

###### type

[`ComponentType`](#componenttype-1)

The component class. A plain (non-`Script`) class always answers `false`.

###### kind

[`ScriptCallbackKind`](#scriptcallbackkind-1)

The callback ordinal.

###### Returns

`boolean`

`true` when the class implements the callback.

###### Example

```ts
registry.implementsCallback(Explode, ScriptCallbackKind.onCollisionEnter); // true
```

##### isRegistered()

> **isRegistered**(`type`): `boolean`

Reports whether a class was registered explicitly.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)

The component class.

###### Returns

`boolean`

`true` when the class was registered under a type id.

##### register()

> **register**(`type`, `typeId?`): [`ComponentClassInfo`](#componentclassinfo)

Registers a component class so that scenes using it can be loaded and saved.

###### Parameters

###### type

[`ConcreteComponentType`](#concretecomponenttype)

The component class.

###### typeId?

`string`

An explicit id, when the class does not declare one.

###### Returns

[`ComponentClassInfo`](#componentclassinfo)

What the registry worked out about the class.

###### Throws

IgnifxError with code `IGX-0203` when the id is already registered by another class, or
when the id is not `<namespace>/<Name>`.

##### registerAll()

> **registerAll**(`types`): `void`

Registers several component classes.

###### Parameters

###### types

readonly [`ConcreteComponentType`](#concretecomponenttype)\<[`Component`](#abstract-component)\>[]

The component classes.

###### Returns

`void`

##### registrations()

> **registrations**(): readonly readonly \[`string`, [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>\][]

Every class registered under a type id, paired with that id, in registration order.

###### Returns

readonly readonly \[`string`, [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>\][]

A freshly allocated array of `[typeId, class]` pairs.

###### Remarks

The scene-file JSON Schema generator
(`docs/architecture/06-serialization-and-scene-format.md` §8) walks it to narrow
`components[].props` per `typeId`. Classes described but never registered are not listed:
only a registered class can appear in a file.

##### requireTypeId()

> **requireTypeId**(`type`): `string`

The id a component must carry to be written to a file.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)

The component class.

###### Returns

`string`

The registered id.

###### Throws

IgnifxError with code `IGX-0204` when the class declares no `typeId`.

***

### ControlSchemes

The scheme table, with the lookup the frame's device attribution goes through.

#### Constructors

##### Constructor

> **new ControlSchemes**(): [`ControlSchemes`](#controlschemes)

###### Returns

[`ControlSchemes`](#controlschemes)

#### Accessors

##### all

###### Get Signature

> **get** **all**(): readonly [`ControlSchemeDefinition`](#controlschemedefinition)[]

The declared schemes, in document order.

###### Returns

readonly [`ControlSchemeDefinition`](#controlschemedefinition)[]

The schemes.

#### Methods

##### forDevice()

> **forDevice**(`device`): `string`

Finds the scheme a device family belongs to.

###### Parameters

###### device

[`DeviceKind`](#devicekind-1)

The device family that produced input.

###### Returns

`string`

The scheme name, or `""` when no scheme lists the family.

##### has()

> **has**(`name`): `boolean`

Whether a scheme with that name is declared.

###### Parameters

###### name

`string`

The scheme name.

###### Returns

`boolean`

`true` when the table declares it.

***

### Cursor

The cursor controller, reached as `app.input.cursor`.

#### Example

```ts
app.input.cursor.visible = false;
```

#### Constructors

##### Constructor

> **new Cursor**(): [`Cursor`](#cursor)

###### Returns

[`Cursor`](#cursor)

#### Accessors

##### visible

###### Get Signature

> **get** **visible**(): `boolean`

Whether the mouse cursor is drawn over the canvas. Assigning `false` applies `cursor: none` to
the canvas; a headless app records the value and does nothing else.

###### Returns

`boolean`

`true` unless the cursor has been hidden.

###### Set Signature

> **set** **visible**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

***

### Diagnostics

The frame-sampled counters reached as `app.diagnostics`
(`docs/architecture/15-devtools-and-diagnostics.md` §3).

#### Remarks

Nothing on the per-frame path allocates: [Diagnostics.frame](#frame) is one long-lived object the
loop writes in place, the history is a preallocated structure-of-arrays ring buffer, and counters
are typed arrays addressed by index (coding standards §7).

#### Example

```ts
const diagnostics = new Diagnostics({ development: true });
diagnostics.beginFrame(16.7);
diagnostics.frame.fixedSteps = 1;
diagnostics.endFrame();
diagnostics.readFrame(0, sample).fixedSteps; // 1
```

#### Constructors

##### Constructor

> **new Diagnostics**(`options?`): [`Diagnostics`](#diagnostics-1)

Creates the diagnostics service of one app.

###### Parameters

###### options?

[`DiagnosticsOptions`](#diagnosticsoptions)

Development flag, clock, and history length.

###### Returns

[`Diagnostics`](#diagnostics-1)

#### Properties

##### frame

> `readonly` **frame**: [`FrameSample`](#framesample)

The frame being measured. The frame loop writes its counters in place; everything else reads
them. Values are reset by [Diagnostics.beginFrame](#beginframe).

##### historyCapacity

> `readonly` **historyCapacity**: `number`

How many frames the history can hold.

##### isDevelopment

> `readonly` **isDevelopment**: `boolean`

Whether per-phase timings and User Timing entries are being recorded.

#### Accessors

##### groups

###### Get Signature

> **get** **groups**(): readonly [`DiagnosticsGroup`](#diagnosticsgroup-1)[]

Every registered counter group, in registration order.

###### Returns

readonly [`DiagnosticsGroup`](#diagnosticsgroup-1)[]

The live list of groups.

##### historyLength

###### Get Signature

> **get** **historyLength**(): `number`

How many frames of history are currently recorded, never more than the capacity.

###### Returns

`number`

The number of retained frames.

#### Methods

##### beginFrame()

> **beginFrame**(`rawDeltaMs`): `void`

Starts a new frame: zeroes [Diagnostics.frame](#frame), assigns the next frame number, and records
the raw delta.

###### Parameters

###### rawDeltaMs

`number`

The wall-clock delta handed to the loop, before clamping, in milliseconds.

###### Returns

`void`

##### clearHistory()

> **clearHistory**(): `void`

Drops every recorded frame and resets the frame counter.

###### Returns

`void`

##### endFrame()

> **endFrame**(): `void`

Copies [Diagnostics.frame](#frame) into the history ring buffer, overwriting the oldest entry.

###### Returns

`void`

##### group()

> **group**(`name`): [`DiagnosticsGroup`](#diagnosticsgroup-1) \| `null`

Looks a counter group up by name.

###### Parameters

###### name

`string`

The group name.

###### Returns

[`DiagnosticsGroup`](#diagnosticsgroup-1) \| `null`

The group, or `null` when no subsystem registered it — an absent group is expected
absence, not a failure (coding standards §5.5).

##### profile()

> **profile**(`name`): [`ProfileScope`](#profilescope)

Opens a timing scope. In development builds it writes a `performance.mark`/`measure` pair that
shows up in browser profilers; outside development it is free
(`docs/architecture/15-devtools-and-diagnostics.md` §6).

###### Parameters

###### name

`string`

The scope name, shown in the profiler.

###### Returns

[`ProfileScope`](#profilescope)

A scope to `end()`; scopes must be ended in the order they were opened.

###### Example

```ts
const scope = app.diagnostics.profile("physics.step");
stepPhysics();
scope.end();
```

##### readFrame()

> **readFrame**(`offset`, `out`): [`FrameSample`](#framesample)

Reads a recorded frame into a caller-owned sample, so plotting the whole history allocates
nothing.

###### Parameters

###### offset

`number`

`0` is the most recently ended frame, `historyLength - 1` the oldest retained.

###### out

[`FrameSample`](#framesample)

The sample to fill; build it with `createFrameSample()`.

###### Returns

[`FrameSample`](#framesample)

The same `out` sample, zeroed when the offset is out of range.

###### Example

```ts
const sample = createFrameSample();
diagnostics.readFrame(0, sample); // the frame that just ended
```

##### registerGroup()

> **registerGroup**(`name`, `counterNames`): [`DiagnosticsGroup`](#diagnosticsgroup-1)

Registers a subsystem's counter group.

###### Parameters

###### name

`string`

The group name, unique within this app.

###### counterNames

readonly `string`[]

The counter names, in the order their indices are assigned.

###### Returns

[`DiagnosticsGroup`](#diagnosticsgroup-1)

The group, whose indices are resolved once with [DiagnosticsGroup.index](#index-1).

###### Throws

IgnifxError with code `IGX-1503` when the name is already registered.

***

### Entity

A node of the scene tree (`docs/architecture/02-scene-graph.md` §4). Every entity has a stable
id, a name, tags, a layer, an active flag, an ordered list of components, and exactly one
`Transform` wrapping its Babylon Lite node.

#### Remarks

Entities are created by the world, never with `new`: `world.createEntity()` allocates the Lite
node, the handle, and the transform together. Destroying one queues its whole subtree for the
current frame's destroy flush; it reports `isDestroyed === true` immediately and throws
`IGX-0101` on any further structural change (`addComponent`, `removeComponent`, `setParent`,
`active`, `layer`, `name`, `isStatic`, `tags.add`/`delete`). Transform writes are deliberately
not* guarded: they are the hottest path in the engine and a write to a doomed node is harmless.

#### Example

```ts
const player = world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
player.layer = world.layers.indexOf("Player");
player.tags.add("player");
const mover = player.addComponent(Mover, { speed: 8 });
const gun = world.createEntity("Gun", { parent: player });
```

#### Accessors

##### active

###### Get Signature

> **get** **active**(): `boolean`

The entity's own active flag. Setting it to `false` disables every component in the subtree
(`onDisable`), hides the Lite subtree, and pauses their coroutines; setting it back reverses
that with `onEnable`, and `start` still runs only once ever
(`docs/architecture/01-lifecycle-and-time.md` §6).

###### Returns

`boolean`

The own flag.

###### Set Signature

> **set** **active**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### activeInHierarchy

###### Get Signature

> **get** **activeInHierarchy**(): `boolean`

`active` and every ancestor's `active`. Materialised on change, never walked per read.

###### Returns

`boolean`

`true` when the entity and every ancestor are active.

##### children

###### Get Signature

> **get** **children**(): readonly [`Entity`](#entity-4)[]

The children, in creation order. The array is live; treat it as read-only.

###### Returns

readonly [`Entity`](#entity-4)[]

The live child list.

##### components

###### Get Signature

> **get** **components**(): readonly [`Component`](#abstract-component)[]

The components, in attach order. The transform is always first.

###### Returns

readonly [`Component`](#abstract-component)[]

The live component list.

##### handle

###### Get Signature

> **get** **handle**(): [`EntityHandle`](#entityhandle-1)

The dense runtime handle; `world.getEntityByHandle` stops resolving it after destruction.

###### Returns

[`EntityHandle`](#entityhandle-1)

The handle.

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the entity has been queued for destruction.

##### isStatic

###### Get Signature

> **get** **isStatic**(): `boolean`

The immovability hint: `true` promises that the transform will not change after `awake`, which
lets the 2D batcher, physics, and navmesh treat the entity as static.

###### Returns

`boolean`

`true` when the entity is marked static.

###### Set Signature

> **set** **isStatic**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

##### layer

###### Get Signature

> **get** **layer**(): `number`

The layer slot, `0..31` (`docs/architecture/02-scene-graph.md` §7). Layers drive physics
collision matrices and raycast masks. Files store the layer *name*, so reordering the project
list is safe.

###### Returns

`number`

The slot index.

###### Set Signature

> **set** **layer**(`value`): `void`

###### Parameters

###### value

`number`

###### Returns

`void`

##### name

###### Get Signature

> **get** **name**(): `string`

The display name. Not unique, and never used for lookup by the engine
(`docs/architecture/02-scene-graph.md` §4).

###### Returns

`string`

The name.

###### Set Signature

> **set** **name**(`value`): `void`

###### Parameters

###### value

`string`

###### Returns

`void`

##### onActiveChanged

###### Get Signature

> **get** **onActiveChanged**(): [`Signal`](#signal-3)\<`boolean`\>

Emitted with the new value when the entity's **own** active flag changes. An ancestor's change
does not emit it; read `activeInHierarchy` for the effective state.

###### Returns

[`Signal`](#signal-3)\<`boolean`\>

The signal, created on first access.

##### onChildAdded

###### Get Signature

> **get** **onChildAdded**(): [`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

Emitted after a child is added, whether by creation or by reparenting.

###### Returns

[`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

The signal, created on first access.

##### onChildRemoved

###### Get Signature

> **get** **onChildRemoved**(): [`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

Emitted after a child is removed.

###### Returns

[`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

The signal, created on first access.

##### onComponentAdded

###### Get Signature

> **get** **onComponentAdded**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted with each component attached to this entity, synchronously at the end of
`addComponent`, after the component's `onAttach` has run
(`docs/architecture/02-scene-graph.md` §8). Extensions that key work off an entity's component
set — the physics extension recomputing `Rigidbody.collisionEvents`, say — listen here rather
than polling `entity.components`. Costs nothing until something connects.

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal, created on first access.

##### onComponentRemoved

###### Get Signature

> **get** **onComponentRemoved**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted with each component the destroy flush removes from this entity, after it has left
`entity.components` and before its `onDetach` runs. Removal is deferred, so this fires in the
destroy flush rather than inside `removeComponent`.

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal, created on first access.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

Emitted in the destroy flush, after the entity's components have run `onDestroy`. `Signal`'s
`{ owner }` option uses it to detach handlers automatically.

###### Returns

[`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

The signal, created on first access.

##### onParentChanged

###### Get Signature

> **get** **onParentChanged**(): [`Signal`](#signal-3)\<[`Entity`](#entity-4) \| `null`\>

Emitted with the new parent after this entity is reparented.

###### Returns

[`Signal`](#signal-3)\<[`Entity`](#entity-4) \| `null`\>

The signal, created on first access.

##### parent

###### Get Signature

> **get** **parent**(): [`Entity`](#entity-4) \| `null`

The parent entity, or `null` when the entity is a root of its scene.

###### Returns

[`Entity`](#entity-4) \| `null`

The parent, or `null`.

##### prefab

###### Get Signature

> **get** **prefab**(): [`EntityPrefabLink`](#entityprefablink) \| `null`

The prefab link for an entity a scene file's `instance` entry produced
(`docs/architecture/02-scene-graph.md` §6). It is set on the instance root and on every entity
the instanced scene contributed, so tooling can show where an object came from.

###### Remarks

The engine keeps no live link back to the prefab after load: editing the instanced scene does
not update loaded instances, and "apply changes to prefab" is editor work, post-1.0. The link
exists so that saving re-emits the subtree as an `instance` entry with recomputed overrides
(`06-serialization-and-scene-format.md` §5) rather than as plain entities.

###### Example

```ts
const link = enemy.prefab;
if (link !== null && link.instanceRoot === enemy) {
  app.log.info(`${enemy.name} is the root of an instance of ${link.address}`);
}
```

###### Returns

[`EntityPrefabLink`](#entityprefablink) \| `null`

The link, or `null` for an entity the scene declared itself or code created.

##### scene

###### Get Signature

> **get** **scene**(): [`SceneInstance`](#sceneinstance)

The scene instance the entity belongs to.

###### Returns

[`SceneInstance`](#sceneinstance)

The owning scene instance.

##### tags

###### Get Signature

> **get** **tags**(): [`TagSet`](#tagset)

The free-form tags the world indexes for `world.findByTag`.

###### Returns

[`TagSet`](#tagset)

The tag set.

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform. Every entity has one; it can be neither removed nor disabled.

###### Returns

[`Transform`](#transform-14)

The transform.

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this entity.

###### Returns

`string`

The identifier.

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world that owns the entity.

###### Returns

[`World`](#world-16)

The world.

#### Methods

##### addComponent()

> **addComponent**\<`T`\>(`type`, `init?`): `T`

Attaches a component.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ConcreteComponentType`](#concretecomponenttype)\<`T`\>

The component class.

###### init?

[`ComponentInit`](#componentinit)\<`T`\>

Initial values for the class's schema fields.

###### Returns

`T`

The attached component.

###### Remarks

The engine constructs the class with no arguments, assigns its identity, applies schema
defaults then `init`, calls `onAttach`, and finally runs the enable transition — so `awake`
runs in the next lifecycle flush, or immediately and nested when `addComponent` is called from
inside a callback (`docs/architecture/01-lifecycle-and-time.md` §4). Everything a class lists in
`static requires` is added first if it is missing.

###### Throws

IgnifxError with code `IGX-0202` when the class does not allow multiple instances and
the entity already has one, `IGX-0605`/`IGX-0606`/`IGX-0607` when `init` does not match the
schema, and `IGX-0101` when the entity has been destroyed.

##### destroy()

> **destroy**(): `void`

Queues this entity and its whole subtree for the current frame's destroy flush. `isDestroyed`
becomes `true` immediately; `onDisable` and `onDestroy` run in the flush, children before
parents (`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

##### destroyImmediate()

> **destroyImmediate**(): `void`

Runs the destroy flush for this entity right now, rather than at the end of the frame. It
exists for tooling and tests.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0102` when called from inside a lifecycle callback, where
destroying an object the engine is still iterating would be unsound; use `destroy()` there.

##### find()

> **find**(`path`): [`Entity`](#entity-4) \| `null`

Resolves a path relative to this entity — `"Body/Arm.L"`, `"../Sibling"`, `"/Root/Child"`.

###### Parameters

###### path

`string`

The path. A leading `/` resolves from the roots of this entity's scene instance;
`..` is the parent and `.` is this entity, as whole segments only, so a name may contain dots.

###### Returns

[`Entity`](#entity-4) \| `null`

The entity, or `null` when the path resolves to nothing.

###### Remarks

Deliberately fragile, and allowed only in tests, examples, and tools: the
`ignifx/no-entity-find-in-src` rule flags it anywhere else. Use `entityRef`/`componentRef`
fields or `requireComponent` to link objects (`docs/architecture/02-scene-graph.md` §4).

##### findChild()

> **findChild**(`predicate`, `deep?`): [`Entity`](#entity-4) \| `null`

Finds a descendant satisfying a predicate.

###### Parameters

###### predicate

(`entity`) => `boolean`

Called with each candidate; the first `true` wins.

###### deep?

`boolean`

`true` (the default) searches the whole subtree depth-first; `false` searches
direct children only.

###### Returns

[`Entity`](#entity-4) \| `null`

The first match, or `null`.

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

The first component matching a class, by identity **or** inheritance — `getComponent(Script)`
returns the first script.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class, abstract or concrete.

###### Returns

`T` \| `null`

The first match in attach order, or `null`. Cost is linear in the entity's component
count, so cache the result in `awake`.

##### getComponentInChildren()

> **getComponentInChildren**\<`T`\>(`type`, `includeInactive?`): `T` \| `null`

The first matching component on this entity or anywhere below it, depth-first.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### includeInactive?

`boolean`

`false` (the default) skips entities that are inactive in the
hierarchy.

###### Returns

`T` \| `null`

The first match, or `null`.

##### getComponentInParent()

> **getComponentInParent**\<`T`\>(`type`): `T` \| `null`

The first matching component on this entity or any ancestor.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T` \| `null`

The first match walking up from this entity, or `null`.

##### getComponents()

> **getComponents**\<`T`\>(`type`): `T`[]

Every component matching a class, by identity or inheritance.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`[]

A freshly allocated array in attach order; empty when there is no match.

##### getComponentsInChildren()

> **getComponentsInChildren**\<`T`\>(`type`, `includeInactive?`): `T`[]

Every matching component on this entity and everything below it, depth-first.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### includeInactive?

`boolean`

`false` (the default) skips entities that are inactive in the
hierarchy.

###### Returns

`T`[]

A freshly allocated array.

##### hasComponent()

> **hasComponent**(`type`): `boolean`

Reports whether the entity carries a component of a class.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)

The component class.

###### Returns

`boolean`

`true` when at least one matches.

##### isDescendantOf()

> **isDescendantOf**(`other`): `boolean`

Reports whether this entity is anywhere below another in the tree.

###### Parameters

###### other

[`Entity`](#entity-4)

The candidate ancestor.

###### Returns

`boolean`

`true` when `other` is a strict ancestor of this entity.

##### removeComponent()

> **removeComponent**(`component`): `void`

Queues one component for destruction. It stays usable until the destroy flush.

###### Parameters

###### component

[`Component`](#abstract-component)

The component to remove; it must be attached to this entity.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0205` when the component is the entity's transform.

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

The first component matching a class, requiring it to be there — the supported way to link
components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

##### root()

> **root**(): [`Entity`](#entity-4)

The topmost ancestor.

###### Returns

[`Entity`](#entity-4)

The root of this entity's branch, which is this entity when it has no parent.

##### setParent()

> **setParent**(`parent`, `options?`): `void`

Moves the entity under a new parent, or to the root of its scene.

###### Parameters

###### parent

[`Entity`](#entity-4) \| `null`

The new parent, or `null` to detach to the scene root.

###### options?

[`SetParentOptions`](#setparentoptions)

How the entity's transform is treated across the move:
`worldPositionStays` is `true` by default and keeps the world transform, while `false` keeps
the local values.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0306` when the new parent is inside this entity's own
subtree, and `IGX-0101` when either entity has been destroyed.

###### Example

```ts
gun.setParent(hand);                                   // snaps to the hand, keeping world pose
gun.setParent(hand, { worldPositionStays: false });     // keeps its local offset instead
```

***

### Environment

The world's lighting environment (`docs/architecture/07-rendering.md` §2.5).

#### Example

```ts
const studio = await app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
world.createEntity("Environment").addComponent(Environment, {
  environment: studio.retain(),
  imageProcessing: { exposure: 1.2, contrast: 1, toneMapping: "aces" },
});
```

#### Extends

- [`Component`](#abstract-component)

#### Implements

- [`ComponentHooks`](#componenthooks)

#### Constructors

##### Constructor

> **new Environment**(): [`Environment`](#environment)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`Environment`](#environment)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

One per entity, and effectively one per world: the fields are all scene state.

##### blur

> **blur**: `number`

##### clearColor

> **clearColor**: [`ColorLike`](#colorlike)

##### environment

> **environment**: [`AssetHandle`](#assethandle)\<[`EnvironmentAsset`](#environmentasset)\> \| `null`

##### fog

> **fog**: [`EnvironmentFogSettings`](#environmentfogsettings)

##### imageProcessing

> **imageProcessing**: [`ImageProcessingSettings`](#imageprocessingsettings)

##### rotation

> **rotation**: `number`

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### skybox

> **skybox**: `object`

###### enabled

> **enabled**: `boolean`

###### size

> **size**: `number`

##### typeId

> `static` **typeId**: `string`

The namespaced registration id.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### installed

###### Get Signature

> **get** **installed**(): [`EnvironmentAsset`](#environmentasset) \| `null`

The environment asset this component installed, once it has loaded.

###### Returns

[`EnvironmentAsset`](#environmentasset) \| `null`

The asset, or `null` when none is loaded.

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### onAttach()

> **onAttach**(): `void`

Records that the component exists; the scene is written on the first sync.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onAttach`](#onattach-1)

##### onDetach()

> **onDetach**(): `void`

Leaves the scene as it is.

###### Returns

`void`

###### Remarks

Lite offers no "unload environment": `loadEnvironment` installs textures and a skybox and has
no inverse. Rather than pretend otherwise, removing an `Environment` leaves what it installed
in place until another one replaces it — which is also what "the most recently enabled wins"
implies. The `PreRender` system re-picks the winner on the next frame.

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onDetach`](#ondetach-1)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

***

### EnvironmentAsset

A loaded image-based lighting environment (`docs/architecture/07-rendering.md` §2.5).

#### Example

```ts
const studio = await app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
world.createEntity("Env").addComponent(Environment, { environment: studio.retain() });
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the environment was loaded from.

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers environments under.

##### brdfUrl

> `readonly` **brdfUrl**: `string`

The URL Lite fetched the BRDF lookup table from, or empty when the load was headless.

##### definition

> `readonly` **definition**: [`EnvironmentDefinition`](#environmentdefinition-3)

What the file declared, with the defaults filled in.

#### Accessors

##### lite

###### Get Signature

> **get** **lite**(): [`EnvironmentAssetLiteHandles`](#environmentassetlitehandles)

The Babylon Lite objects the asset owns. Unstable escape hatch.

###### Returns

[`EnvironmentAssetLiteHandles`](#environmentassetlitehandles)

The GPU handles, or `null` under a headless app.

***

### FontAsset

A parsed font file (`docs/architecture/05-assets-and-loading.md` §5).

#### Example

```ts
const inter = await app.assets.loadAsync<FontAsset>("fonts/inter.ttf");
inter.value.address; // "fonts/inter.ttf"
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the font was loaded from.

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers fonts under.

##### byteLength

> `readonly` **byteLength**: `number`

How many bytes the file held, for diagnostics.

#### Accessors

##### lite

###### Get Signature

> **get** **lite**(): [`FontAssetLiteHandles`](#fontassetlitehandles)

The Babylon Lite objects the asset owns. Unstable escape hatch.

###### Returns

[`FontAssetLiteHandles`](#fontassetlitehandles)

The parsed font.

***

### GamepadDevice

A game controller (`docs/architecture/08-input.md` §4). Values are refreshed once per frame from
`navigator.getGamepads()`; the Gamepad API has no events for axis motion, so polling is the only
option and it happens in `PreUpdate` with everything else.

#### Example

```ts
const pad = app.input.gamepads[0];
if (pad.isConnected) {
  pad.rumble(0.6, 0.2);
}
```

#### Extends

- [`InputDevice`](#inputdevice)

#### Constructors

##### Constructor

> **new GamepadDevice**(`slot`): [`GamepadDevice`](#gamepaddevice)

Builds one gamepad slot. Slots exist from app start and report `isConnected === false` until a
pad appears in them.

###### Parameters

###### slot

`number`

The slot index, `0` through `3`.

###### Returns

[`GamepadDevice`](#gamepaddevice)

###### Overrides

[`InputDevice`](#inputdevice).[`constructor`](#constructor-24)

#### Properties

##### deviceIndex

> `readonly` **deviceIndex**: `number`

Which device of its family this is; `0` for every family that has only one.

###### Inherited from

[`InputDevice`](#inputdevice).[`deviceIndex`](#deviceindex-1)

##### kind

> `readonly` **kind**: [`DeviceKind`](#devicekind-1)

The device family this device belongs to.

###### Inherited from

[`InputDevice`](#inputdevice).[`kind`](#kind-15)

#### Accessors

##### controls

###### Get Signature

> **get** **controls**(): readonly [`ControlDescriptor`](#controldescriptor)[]

The device's controls, in index order.

###### Returns

readonly [`ControlDescriptor`](#controldescriptor)[]

The control table.

###### Inherited from

[`InputDevice`](#inputdevice).[`controls`](#controls-1)

##### id

###### Get Signature

> **get** **id**(): `string`

The pad's `id` string, or `""` when the slot is empty.

###### Returns

`string`

The identifier the browser reports.

##### isConnected

###### Get Signature

> **get** **isConnected**(): `boolean`

Whether the device is present. Only gamepads ever report `false`.

###### Returns

`boolean`

`true` when bindings to this device can produce input.

###### Inherited from

[`InputDevice`](#inputdevice).[`isConnected`](#isconnected-1)

#### Methods

##### control()

> **control**(`name`): [`ControlDescriptor`](#controldescriptor) \| `null`

Looks a control up by name. Call it at binding time, never per frame.

###### Parameters

###### name

`string`

The control name, for example `dpad/up`.

###### Returns

[`ControlDescriptor`](#controldescriptor) \| `null`

The descriptor, or `null` when the device has no such control.

###### Inherited from

[`InputDevice`](#inputdevice).[`control`](#control-2)

##### rumble()

> **rumble**(`intensity`, `seconds`): `boolean`

Plays a dual-rumble effect, when the pad exposes a haptic actuator
(`docs/architecture/08-input.md` §4).

###### Parameters

###### intensity

`number`

Motor magnitude in `[0, 1]`; values outside are clamped.

###### seconds

`number`

How long the effect lasts.

###### Returns

`boolean`

`true` when an effect was started, `false` when the pad has no actuator.

###### Example

```ts
app.input.gamepads[0].rumble(1, 0.15);
```

##### valueAt()

> **valueAt**(`offset`): `number`

Reads one component of the device's value array.

###### Parameters

###### offset

`number`

The slot, from a [ControlDescriptor](#controldescriptor).

###### Returns

`number`

The value, or `0` when the slot is out of range.

###### Inherited from

[`InputDevice`](#inputdevice).[`valueAt`](#valueat-1)

***

### HeadlessBackend

The audio backend that runs where there is no Web Audio.

#### Example

```ts
// Exercise the browser's locked-until-a-gesture behaviour in a Node test.
const app = await createApp({
  headless: true,
  extensions: [audio({ createBackend: () => new HeadlessBackend({ startSuspended: true }) })],
});
```

#### Implements

- [`AudioBackend`](#audiobackend)

#### Constructors

##### Constructor

> **new HeadlessBackend**(`options?`): [`HeadlessBackend`](#headlessbackend)

Creates the backend.

###### Parameters

###### options?

[`HeadlessBackendOptions`](#headlessbackendoptions)

The initial gain, and whether to start suspended.

###### Returns

[`HeadlessBackend`](#headlessbackend)

#### Properties

##### kind

> `readonly` **kind**: [`AudioBackendKind`](#audiobackendkind-1)

Which implementation this is.

###### Implementation of

[`AudioBackend`](#audiobackend).[`kind`](#kind-2)

##### lite

> `readonly` **lite**: [`AudioLiteHandles`](#audiolitehandles) \| `null`

There is no Lite engine behind this backend.

###### Implementation of

[`AudioBackend`](#audiobackend).[`lite`](#lite-1)

#### Accessors

##### buses

###### Get Signature

> **get** **buses**(): readonly [`HeadlessBus`](#headlessbus)[]

Every bus this backend has made, for tests and diagnostics.

###### Returns

readonly [`HeadlessBus`](#headlessbus)[]

The live buses, in creation order.

##### elapsedMs

###### Get Signature

> **get** **elapsedMs**(): `number`

How many milliseconds of engine time the pump has advanced, for diagnostics.

###### Returns

`number`

The elapsed simulated time in milliseconds.

##### elapsedSeconds

###### Get Signature

> **get** **elapsedSeconds**(): `number`

How many seconds of engine time the pump has advanced.

###### Returns

`number`

The elapsed simulated time in seconds.

##### listener

###### Get Signature

> **get** **listener**(): `SpatialTarget` \| `null`

The world transform the listener follows.

###### Returns

`SpatialTarget` \| `null`

The target, or `null` when the listener sits at the world origin.

##### onStateChanged

###### Get Signature

> **get** **onStateChanged**(): [`SignalLike`](#signallike)\<[`AudioBackendState`](#audiobackendstate-1)\>

Emitted whenever the state changes.

###### Returns

[`SignalLike`](#signallike)\<[`AudioBackendState`](#audiobackendstate-1)\>

The signal.

Emitted whenever [AudioBackend.state](#state-1) changes.

###### Implementation of

[`AudioBackend`](#audiobackend).[`onStateChanged`](#onstatechanged)

##### sounds

###### Get Signature

> **get** **sounds**(): readonly [`HeadlessSound`](#headlesssound)[]

Every sound this backend has made and not released, for tests and diagnostics.

###### Returns

readonly [`HeadlessSound`](#headlesssound)[]

The live sounds, in creation order.

##### state

###### Get Signature

> **get** **state**(): [`AudioBackendState`](#audiobackendstate-1)

The simulated context's state.

###### Returns

[`AudioBackendState`](#audiobackendstate-1)

The state.

The audio context's current state.

###### Implementation of

[`AudioBackend`](#audiobackend).[`state`](#state-1)

#### Methods

##### createBus()

> **createBus**(`request`): `Promise`\<[`BackendBus`](#backendbus)\>

Creates a simulated bus.

###### Parameters

###### request

[`BackendBusRequest`](#backendbusrequest)

The name, gain, and parent bus.

###### Returns

`Promise`\<[`BackendBus`](#backendbus)\>

The bus.

###### Implementation of

[`AudioBackend`](#audiobackend).[`createBus`](#createbus)

##### createSound()

> **createSound**(`request`): [`BackendSound`](#backendsound)

Creates a simulated sound. Synchronously, on purpose: it is what makes `onEnded` timing exact
in a test that never awaits between `play()` and the frames it steps.

###### Parameters

###### request

[`BackendSoundRequest`](#backendsoundrequest)

The clip, routing, and per-sound options.

###### Returns

[`BackendSound`](#backendsound)

The sound.

###### Implementation of

[`AudioBackend`](#audiobackend).[`createSound`](#createsound)

##### decode()

> **decode**(): `Promise`\<`void`\>

Nothing is decoded under Node: a clip keeps whatever duration its container header gave it.

###### Returns

`Promise`\<`void`\>

A settled promise.

###### Implementation of

[`AudioBackend`](#audiobackend).[`decode`](#decode)

##### dispose()

> **dispose**(): `void`

Releases every sound and bus and closes the simulated context.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`dispose`](#dispose-2)

##### disposeBus()

> **disposeBus**(`bus`): `void`

Releases a bus.

###### Parameters

###### bus

[`BackendBus`](#backendbus)

The bus.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`disposeBus`](#disposebus)

##### disposeSound()

> **disposeSound**(`sound`): `void`

Releases a sound.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`disposeSound`](#disposesound)

##### getMasterVolume()

> **getMasterVolume**(): `number`

Reads the master gain.

###### Returns

`number`

The gain.

###### Implementation of

[`AudioBackend`](#audiobackend).[`getMasterVolume`](#getmastervolume)

##### pause()

> **pause**(`sound`): `void`

Pauses every instance.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`pause`](#pause-1)

##### play()

> **play**(`sound`, `request`): `void`

Starts one instance, or resumes the sound when it was paused — Babylon Lite's documented
behaviour (`index.d.ts` 8955).

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### request

[`BackendPlayRequest`](#backendplayrequest)

The per-play overrides.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`play`](#play)

##### resume()

> **resume**(`sound`): `void`

Resumes every paused instance.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`resume`](#resume-1)

##### setBusVolume()

> **setBusVolume**(`bus`, `volume`): `void`

Sets a bus's gain.

###### Parameters

###### bus

[`BackendBus`](#backendbus)

The bus.

###### volume

`number`

The gain to apply now.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setBusVolume`](#setbusvolume)

##### setListener()

> **setListener**(`target`): `void`

Records the transform the listener follows. Nothing is audible, so nothing else happens; the
value is here so a test can assert that a listener was selected.

###### Parameters

###### target

`SpatialTarget` \| `null`

The transform, or `null`.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setListener`](#setlistener)

##### setMasterVolume()

> **setMasterVolume**(`volume`): `void`

Sets the master gain.

###### Parameters

###### volume

`number`

The gain to apply now.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setMasterVolume`](#setmastervolume)

##### setSoundPan()

> **setSoundPan**(`sound`, `pan`): `void`

Sets a sound's stereo pan.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### pan

`number`

The pan in `[-1, 1]`.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setSoundPan`](#setsoundpan)

##### setSoundVolume()

> **setSoundVolume**(`sound`, `volume`): `void`

Sets a sound's gain. Fades are interpolated by the service, so the value arrives already at
this frame's position along the ramp.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### volume

`number`

The gain to apply now.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setSoundVolume`](#setsoundvolume)

##### stop()

> **stop**(`sound`): `void`

Stops every instance.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`stop`](#stop-1)

##### unlock()

> **unlock**(): `Promise`\<`void`\>

Moves the simulated context to `"running"`.

###### Returns

`Promise`\<`void`\>

A promise that settles once the state has changed.

###### Implementation of

[`AudioBackend`](#audiobackend).[`unlock`](#unlock)

##### update()

> **update**(`deltaSeconds`): `void`

Advances simulated playback by one frame, dropping every instance whose time ran out.

###### Parameters

###### deltaSeconds

`number`

The frame delta in seconds.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`update`](#update)

***

### HeadlessBus

A bus of the headless backend: a name, a gain, and its place in the tree.

#### Implements

- [`BackendBus`](#backendbus)

#### Constructors

##### Constructor

> **new HeadlessBus**(`name`, `volume`, `parent`): [`HeadlessBus`](#headlessbus)

Creates a simulated bus.

###### Parameters

###### name

`string`

The bus name.

###### volume

`number`

Its own linear gain.

###### parent

[`HeadlessBus`](#headlessbus) \| `null`

The bus it routes into, or `null`.

###### Returns

[`HeadlessBus`](#headlessbus)

#### Properties

##### isDisposed

> **isDisposed**: `boolean`

`true` once the tree it belongs to has released it.

##### lite

> `readonly` **lite**: `null`

Lite owns nothing here, so the escape hatch is always `null`.

###### Implementation of

[`BackendBus`](#backendbus).[`lite`](#lite-5)

##### name

> `readonly` **name**: `string`

The bus name.

###### Implementation of

[`BackendBus`](#backendbus).[`name`](#name-6)

##### parent

> `readonly` **parent**: [`HeadlessBus`](#headlessbus) \| `null`

The bus it routes into, or `null` for the root.

##### volume

> **volume**: `number`

The bus's own linear gain, before the parent chain.

#### Accessors

##### effectiveVolume

###### Get Signature

> **get** **effectiveVolume**(): `number`

The gain this bus actually contributes: its own, multiplied up the parent chain. A real Web
Audio graph gets this for free by chaining gain nodes; the simulation has to multiply.

###### Returns

`number`

The product of every gain from this bus to the root.

***

### HeadlessSound

A sound of the headless backend: one clip routed to one bus, carrying simulated instances.

#### Implements

- [`BackendSound`](#backendsound)

#### Constructors

##### Constructor

> **new HeadlessSound**(`request`): [`HeadlessSound`](#headlesssound)

Creates a simulated sound.

###### Parameters

###### request

[`BackendSoundRequest`](#backendsoundrequest)

The clip, routing, and per-sound options.

###### Returns

[`HeadlessSound`](#headlesssound)

#### Properties

##### bus

> `readonly` **bus**: [`HeadlessBus`](#headlessbus) \| `null`

The bus it routes into, or `null` for the main bus.

##### clip

> `readonly` **clip**: [`AudioClip`](#audioclip)

The clip this sound plays.

##### isDisposed

> **isDisposed**: `boolean`

`true` once the backend has released it.

##### maxInstances

> `readonly` **maxInstances**: `number`

How many instances may play at once.

##### pan

> **pan**: `number`

The sound's stereo pan, as the last `setSoundPan` left it.

##### spatial

> `readonly` **spatial**: [`BackendSpatialRequest`](#backendspatialrequest) \| `null`

The 3D placement it was created with, or `null` for a non-spatial sound.

##### volume

> **volume**: `number`

The sound's own linear gain, as the last `setSoundVolume` left it.

#### Accessors

##### effectiveVolume

###### Get Signature

> **get** **effectiveVolume**(): `number`

The gain a listener would hear: the sound's own gain times its bus chain.

###### Returns

`number`

The product.

##### instanceCount

###### Get Signature

> **get** **instanceCount**(): `number`

How many instances are live.

###### Returns

`number`

The instance count.

How many instances of this sound are live.

###### Implementation of

[`BackendSound`](#backendsound).[`instanceCount`](#instancecount-1)

##### isPaused

###### Get Signature

> **get** **isPaused**(): `boolean`

Whether every live instance is paused.

###### Returns

`boolean`

`true` when there is at least one instance and none of them are running.

`true` when every instance has been paused.

###### Implementation of

[`BackendSound`](#backendsound).[`isPaused`](#ispaused)

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

Whether anything is sounding.

###### Returns

`boolean`

`true` while at least one instance is live and not paused.

`true` while at least one instance is playing or about to.

###### Implementation of

[`BackendSound`](#backendsound).[`isPlaying`](#isplaying-1)

#### Methods

##### advance()

> **advance**(`deltaSeconds`): `void`

Advances every running instance and drops the ones that finished.

###### Parameters

###### deltaSeconds

`number`

The frame delta in seconds.

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Drops every instance; the backend calls it from `disposeSound`.

###### Returns

`void`

##### pauseAll()

> **pauseAll**(): `void`

Pauses every instance, keeping its remaining time.

###### Returns

`void`

##### resumeAll()

> **resumeAll**(): `void`

Resumes every paused instance.

###### Returns

`void`

##### start()

> **start**(`request`): `void`

Starts one instance, stealing the oldest when the sound is already at `maxInstances`.

###### Parameters

###### request

[`BackendPlayRequest`](#backendplayrequest)

The per-play overrides.

###### Returns

`void`

##### stopAll()

> **stopAll**(): `void`

Stops every instance at once, without an `onEnded`: a stop is not an end.

###### Returns

`void`

***

### IgnifxError

The error every ignifx API throws for misuse (`CONSTITUTION.md` §3.9). It always carries a stable
`IGX-####` `code` and the `context` identifiers needed to find the offending object,
so a production build can compact the human-readable half without losing meaning.

#### Example

```ts
try {
  world.instantiate(scene);
} catch (error) {
  if (isIgnifxError(error) && error.code === CoreErrorCode.sceneNotLoaded) {
    await scene.load();
  }
}
```

#### Extends

- `Error`

#### Extended by

- [`AssetLoadError`](#assetloaderror)

#### Constructors

##### Constructor

> **new IgnifxError**(`code`, `message`, `options?`): [`IgnifxError`](#ignifxerror)

Creates an ignifx error.

###### Parameters

###### code

`` `IGX-${number}` ``

The stable `IGX-####` code for the failure.

###### message

`string`

An actionable description of what went wrong, used in development mode.

###### options?

[`IgnifxErrorOptions`](#ignifxerroroptions)

Context, hint, format mode, and the standard `cause`.

###### Returns

[`IgnifxError`](#ignifxerror)

###### Overrides

`Error.constructor`

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

###### Inherited from

`Error.cause`

##### code

> `readonly` **code**: `` `IGX-${number}` ``

The stable diagnostic code for this failure.

##### context

> `readonly` **context**: [`ErrorContext`](#errorcontext)

Identifiers that locate the failure (entity uid, component type id, asset key, …).

##### hint

> `readonly` **hint**: `string` \| `null`

One sentence telling the developer how to fix it, or `null` when there is nothing to add.

##### message

> **message**: `string`

###### Inherited from

`Error.message`

##### name

> **name**: `string`

###### Inherited from

`Error.name`

##### stack?

> `optional` **stack?**: `string`

###### Inherited from

`Error.stack`

***

### InputAction

One input action (`docs/architecture/08-input.md` §2).

#### Example

```ts
class Player extends Script {
  update(dt: number): void {
    const move = this.app.input.actions.get("move");
    this.transform.translate({ x: move.vector.x * dt, y: 0, z: move.vector.y * dt });
    if (this.app.input.actions.get("jump").wasPressedThisFrame) {
      this.jump();
    }
  }
}
```

#### Constructors

##### Constructor

> **new InputAction**(`definition`, `map`, `resolver`, `onHandlerError`): [`InputAction`](#inputaction)

Builds an action from its document form.

###### Parameters

###### definition

[`ActionDefinition`](#actiondefinition)

The action as it appears in an `ignifx.inputactions` document.

###### map

[`ActionMap`](#actionmap)

The map the action belongs to.

###### resolver

[`BindingResolver`](#bindingresolver)

How binding paths become controls.

###### onHandlerError

(`error`) => `void`

Where a signal handler's exception is reported.

###### Returns

[`InputAction`](#inputaction)

###### Throws

IgnifxError with code `IGX-0802`, `IGX-0803`, or `IGX-0806` for an unusable binding.

#### Properties

##### enabled

> **enabled**: `boolean`

Whether this action resolves at all. An action in a disabled map reads as released too.

##### map

> `readonly` **map**: [`ActionMap`](#actionmap)

The map the action belongs to.

##### name

> `readonly` **name**: `string`

The action name game code asks for.

##### onCanceled

> `readonly` **onCanceled**: [`Signal`](#signal-3)\<[`InputActionEvent`](#inputactionevent)\>

Emitted the frame the action returns to rest.

##### onPerformed

> `readonly` **onPerformed**: [`Signal`](#signal-3)\<[`InputActionEvent`](#inputactionevent)\>

Emitted when the action is pressed and whenever its value changes while actuated.

##### onStarted

> `readonly` **onStarted**: [`Signal`](#signal-3)\<[`InputActionEvent`](#inputactionevent)\>

Emitted the frame the action is first actuated.

##### type

> `readonly` **type**: [`InputActionType`](#inputactiontype-1)

What the action produces.

#### Accessors

##### axis

###### Get Signature

> **get** **axis**(): `number`

The action's scalar value, for an `axis` action.

###### Returns

`number`

The signed value; for other types, the x component.

##### bindings

###### Get Signature

> **get** **bindings**(): readonly [`Binding`](#binding)[]

The bindings that feed this action, in declaration order.

###### Returns

readonly [`Binding`](#binding)[]

The bindings.

##### isPressed

###### Get Signature

> **get** **isPressed**(): `boolean`

Whether the action is actuated past the press point.

###### Returns

`boolean`

`true` while held.

##### magnitude

###### Get Signature

> **get** **magnitude**(): `number`

How far the action is actuated, in `[0, 1]` for normalised controls.

###### Returns

`number`

The magnitude the press point is compared against.

##### value

###### Get Signature

> **get** **value**(): `number` \| `boolean` \| [`Vec2Like`](#vec2like)

The action's value in the shape its `type` implies.

###### Returns

`number` \| `boolean` \| [`Vec2Like`](#vec2like)

A boolean for `button`, a number for `axis`, a live `Vec2Like` for `vector2`.

##### vector

###### Get Signature

> **get** **vector**(): [`Vec2Like`](#vec2like)

The action's vector value, for a `vector2` action. The object is a live view: it always reads
the action's current value and is never reallocated.

###### Returns

[`Vec2Like`](#vec2like)

The live vector.

##### wasPressedThisFrame

###### Get Signature

> **get** **wasPressedThisFrame**(): `boolean`

Whether the action became pressed in this frame. Stable for the whole frame, every fixed step
included.

###### Returns

`boolean`

`true` in the one frame the press resolved.

##### wasReleasedThisFrame

###### Get Signature

> **get** **wasReleasedThisFrame**(): `boolean`

Whether the action was released in this frame. Stable for the whole frame.

###### Returns

`boolean`

`true` in the one frame the release resolved.

***

### InputActionsAsset

A loaded input actions document.

#### Example

```ts
const actions = await app.assets.loadAsync<InputActionsAsset>("input/default.input.json");
app.input.loadActions(actions.value);
```

#### Constructors

##### Constructor

> **new InputActionsAsset**(`address`, `definition`): [`InputActionsAsset`](#inputactionsasset)

Wraps a validated document. The `inputactions` loader constructs these.

###### Parameters

###### address

`string`

The address it was loaded from.

###### definition

[`InputActionsDefinition`](#inputactionsdefinition)

The validated document.

###### Returns

[`InputActionsAsset`](#inputactionsasset)

#### Properties

##### address

> `readonly` **address**: `string`

The address the document was loaded from; `""` for one built in code.

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers input action documents under.

##### definition

> `readonly` **definition**: [`InputActionsDefinition`](#inputactionsdefinition)

The validated document.

#### Accessors

##### mapNames

###### Get Signature

> **get** **mapNames**(): readonly `string`[]

The names of the maps the document declares, in document order.

###### Returns

readonly `string`[]

The map names.

***

### InputActionSet

A private copy of a document's action maps, owned by one [PlayerInput](#playerinput) or by game code that
asked for one (`docs/architecture/08-input.md` §7).

#### Properties

##### actions

> `readonly` **actions**: [`InputActionsView`](#inputactionsview)

The lookups over the set's maps.

##### maps

> `readonly` **maps**: `ReadonlyMap`\<`string`, [`ActionMap`](#actionmap)\>

The set's maps, keyed by name.

#### Accessors

##### isDisposed

###### Get Signature

> **get** **isDisposed**(): `boolean`

Whether [InputActionSet.dispose](#dispose-7) has run.

###### Returns

`boolean`

`true` once the set has been disposed.

#### Methods

##### dispose()

> **dispose**(): `void`

Unregisters the set so its actions stop resolving. Disposing twice is a no-op.

###### Returns

`void`

***

### InputActionsView

The maps installed on one input source, and the two lookups over them.

#### Example

```ts
app.input.actions.get("jump").wasPressedThisFrame;
app.input.actions.map("Player").enabled = false;
```

#### Constructors

##### Constructor

> **new InputActionsView**(`maps`): [`InputActionsView`](#inputactionsview)

Wraps a map table.

###### Parameters

###### maps

`Map`\<`string`, [`ActionMap`](#actionmap)\>

The installed maps, keyed by name; the view reads it live.

###### Returns

[`InputActionsView`](#inputactionsview)

#### Accessors

##### maps

###### Get Signature

> **get** **maps**(): `ReadonlyMap`\<`string`, [`ActionMap`](#actionmap)\>

Every installed map, keyed by name.

###### Returns

`ReadonlyMap`\<`string`, [`ActionMap`](#actionmap)\>

The map table.

#### Methods

##### find()

> **find**(`name`): [`InputAction`](#inputaction) \| `null`

Finds an action by name in any map, enabled or not.

###### Parameters

###### name

`string`

The action name.

###### Returns

[`InputAction`](#inputaction) \| `null`

The action, or `null` when no map declares it — an absent action is not a failure
(coding standards §5.5).

##### get()

> **get**(`name`): [`InputAction`](#inputaction)

Finds an action by name in the enabled maps.

###### Parameters

###### name

`string`

The action name.

###### Returns

[`InputAction`](#inputaction)

The action.

###### Throws

IgnifxError with code `IGX-0801` when no enabled map declares it.

##### map()

> **map**(`name`): [`ActionMap`](#actionmap)

Looks a map up by name.

###### Parameters

###### name

`string`

The map name.

###### Returns

[`ActionMap`](#actionmap)

The map.

###### Throws

IgnifxError with code `IGX-0804` when no map is installed under that name.

***

### InputDevice

One input device: a named control table and the values behind it
(`docs/architecture/08-input.md` §4).

#### Remarks

Values live in a `Float32Array`. Reads take the descriptor's `offset`, never the control's name,
so nothing on the per-frame path allocates or hashes a string (coding standards §7).

#### Example

```ts
const space = app.input.devices.keyboard.control("space");
if (space !== null && app.input.devices.keyboard.valueAt(space.offset) > 0) {
  jump();
}
```

#### Extended by

- [`GamepadDevice`](#gamepaddevice)
- [`VirtualDevice`](#virtualdevice)

#### Constructors

##### Constructor

> **new InputDevice**(`kind`, `deviceIndex`, `specs`, `isConnected?`): [`InputDevice`](#inputdevice)

Builds a device from its control declarations.

###### Parameters

###### kind

[`DeviceKind`](#devicekind-1)

The device family.

###### deviceIndex

`number`

Which device of the family this is.

###### specs

readonly [`ControlSpec`](#controlspec)[]

The control declarations, in index order.

###### isConnected?

`boolean`

Whether the device starts connected. Gamepads start disconnected.

###### Returns

[`InputDevice`](#inputdevice)

#### Properties

##### deviceIndex

> `readonly` **deviceIndex**: `number`

Which device of its family this is; `0` for every family that has only one.

##### kind

> `readonly` **kind**: [`DeviceKind`](#devicekind-1)

The device family this device belongs to.

#### Accessors

##### controls

###### Get Signature

> **get** **controls**(): readonly [`ControlDescriptor`](#controldescriptor)[]

The device's controls, in index order.

###### Returns

readonly [`ControlDescriptor`](#controldescriptor)[]

The control table.

##### isConnected

###### Get Signature

> **get** **isConnected**(): `boolean`

Whether the device is present. Only gamepads ever report `false`.

###### Returns

`boolean`

`true` when bindings to this device can produce input.

#### Methods

##### control()

> **control**(`name`): [`ControlDescriptor`](#controldescriptor) \| `null`

Looks a control up by name. Call it at binding time, never per frame.

###### Parameters

###### name

`string`

The control name, for example `dpad/up`.

###### Returns

[`ControlDescriptor`](#controldescriptor) \| `null`

The descriptor, or `null` when the device has no such control.

##### valueAt()

> **valueAt**(`offset`): `number`

Reads one component of the device's value array.

###### Parameters

###### offset

`number`

The slot, from a [ControlDescriptor](#controldescriptor).

###### Returns

`number`

The value, or `0` when the slot is out of range.

***

### InputDevices

Every input device an app has (`docs/architecture/08-input.md` §1).

#### Example

```ts
app.input.devices.keyboard.control("space");
app.input.devices.gamepads[0].isConnected;
```

#### Constructors

##### Constructor

> **new InputDevices**(): [`InputDevices`](#inputdevices)

Builds one device of every family plus the four gamepad slots.

###### Returns

[`InputDevices`](#inputdevices)

#### Properties

##### all

> `readonly` **all**: readonly [`InputDevice`](#inputdevice)[]

Every device, in a stable order.

##### gamepads

> `readonly` **gamepads**: readonly [`GamepadDevice`](#gamepaddevice)[]

The four gamepad slots, connected or not.

##### keyboard

> `readonly` **keyboard**: [`InputDevice`](#inputdevice)

The physical keyboard.

##### mouse

> `readonly` **mouse**: [`InputDevice`](#inputdevice)

The mouse.

##### pointer

> `readonly` **pointer**: [`InputDevice`](#inputdevice)

The unified primary pointer: mouse, pen, or first touch.

##### touch

> `readonly` **touch**: [`InputDevice`](#inputdevice)

The touch screen and its ten slots.

##### virtual

> `readonly` **virtual**: [`VirtualDevice`](#virtualdevice)

The synthetic device on-screen controls feed.

#### Methods

##### device()

> **device**(`kind`, `deviceIndex`): [`InputDevice`](#inputdevice) \| `null`

Looks a device up by family and index.

###### Parameters

###### kind

[`DeviceKind`](#devicekind-1)

The device family.

###### deviceIndex

`number`

Which device of the family; only gamepads have more than one.

###### Returns

[`InputDevice`](#inputdevice) \| `null`

The device, or `null` when the family has no such index.

##### resolve()

> **resolve**(`path`, `virtualKind?`): [`ControlRef`](#controlref)

Resolves a binding path to the control it names, creating the control when the path names the
virtual device (`docs/architecture/08-input.md` §8).

###### Parameters

###### path

`string`

The binding path, for example `<Gamepad>{1}/leftStick`.

###### virtualKind?

[`ControlKind`](#controlkind-1)

The kind a virtual control is created with when it does not exist yet.

###### Returns

[`ControlRef`](#controlref)

The device and control the path names.

###### Throws

IgnifxError with code `IGX-0803` when the path is malformed, names an unknown device
index, or names a control the device does not have.

###### Example

```ts
const ref = app.input.devices.resolve("<Mouse>/delta");
ref.device.valueAt(ref.control.offset);
```

***

### InputService

The input service (`docs/architecture/08-input.md` §1).

#### Example

```ts
const app = await createApp({ headless: true, extensions: [input()] });
app.input.loadActions(
  defineInputActions({
    maps: [{ name: "Player", actions: [{ name: "jump", bindings: [{ path: "<Keyboard>/space" }] }] }],
  }),
);
app.input.simulate({ "<Keyboard>/space": 1 });
app.step(1 / 60);
app.input.actions.get("jump").wasPressedThisFrame; // true
```

#### Implements

- [`BindingResolver`](#bindingresolver)

#### Constructors

##### Constructor

> **new InputService**(`options`): [`InputService`](#inputservice)

Builds the service. The extension constructs exactly one per app.

###### Parameters

###### options

[`InputServiceOptions`](#inputserviceoptions)

The app, the resolved settings, and an optional gamepad reader.

###### Returns

[`InputService`](#inputservice)

#### Properties

##### cursor

> `readonly` **cursor**: [`Cursor`](#cursor)

Cursor visibility over the canvas.

##### devices

> `readonly` **devices**: [`InputDevices`](#inputdevices)

Every input device this app has.

##### pointerLock

> `readonly` **pointerLock**: [`PointerLock`](#pointerlock-3)

Pointer lock (`docs/architecture/08-input.md` §4).

##### pressPoint

> **pressPoint**: `number`

The magnitude at which an analog value counts as pressed. Defaults to the `input` setting.

##### strictSchemes

> **strictSchemes**: `boolean`

Whether a binding tagged with a control scheme resolves only while that scheme is active.
Defaults to the `input.strictSchemes` setting.

#### Accessors

##### actions

###### Get Signature

> **get** **actions**(): [`InputActionsView`](#inputactionsview)

The installed action maps and the two lookups over them.

###### Returns

[`InputActionsView`](#inputactionsview)

The action lookup.

##### actionsHandle

###### Get Signature

> **get** **actionsHandle**(): [`AssetHandle`](#assethandle)\<[`InputActionsAsset`](#inputactionsasset)\> \| `null`

The handle of the `.input.json` document the `input.actions` setting named, or `null` when the
project named none.

###### Remarks

The extension starts the load in `onStart` and installs the maps at delivery, which is the
`PreUpdate` of the first stepped frame. Awaiting the handle inside `onStart` would deadlock: a
headless app has not been stepped yet and a canvas app has not started its loop
(`05-assets-and-loading.md` §4). Game code that must wait awaits this handle's `promise`.

###### Returns

[`AssetHandle`](#assethandle)\<[`InputActionsAsset`](#inputactionsasset)\> \| `null`

The handle, or `null`.

##### controlSchemes

###### Get Signature

> **get** **controlSchemes**(): readonly [`ControlSchemeDefinition`](#controlschemedefinition)[]

The control schemes the loaded document declared.

###### Returns

readonly [`ControlSchemeDefinition`](#controlschemedefinition)[]

The schemes, in document order.

##### currentScheme

###### Get Signature

> **get** **currentScheme**(): `string`

The control scheme in use, chosen by the device that produced input last.

###### Returns

`string`

The scheme name, or `""` before any input arrives.

##### events

###### Get Signature

> **get** **events**(): readonly [`InputEventRecord`](#inputeventrecord)[]

The current frame's raw events, in arrival order
(`docs/architecture/08-input.md` §5). The array and its records are reused each frame.

###### Returns

readonly [`InputEventRecord`](#inputeventrecord)[]

The frame's event list.

##### gamepads

###### Get Signature

> **get** **gamepads**(): readonly [`GamepadDevice`](#gamepaddevice)[]

The gamepad slots, connected or not.

###### Returns

readonly [`GamepadDevice`](#gamepaddevice)[]

The four slots, in slot order.

##### onControlSchemeChanged

###### Get Signature

> **get** **onControlSchemeChanged**(): [`SignalLike`](#signallike)\<`string`\>

Emitted with the new scheme name whenever the active control scheme changes.

###### Returns

[`SignalLike`](#signallike)\<`string`\>

The signal.

##### onDeviceConnected

###### Get Signature

> **get** **onDeviceConnected**(): [`SignalLike`](#signallike)\<[`InputDevice`](#inputdevice)\>

Emitted when a gamepad appears in a slot.

###### Returns

[`SignalLike`](#signallike)\<[`InputDevice`](#inputdevice)\>

The signal.

##### onDeviceDisconnected

###### Get Signature

> **get** **onDeviceDisconnected**(): [`SignalLike`](#signallike)\<[`InputDevice`](#inputdevice)\>

Emitted when a gamepad leaves a slot.

###### Returns

[`SignalLike`](#signallike)\<[`InputDevice`](#inputdevice)\>

The signal.

##### uiHasFocus

###### Get Signature

> **get** **uiHasFocus**(): `boolean`

Whether a DOM text field has focus (`docs/architecture/08-input.md` §5). While it is `true`,
keyboard actions read as released and keyboard events are still published on
[InputService.events](#events-1); pointer actions keep working.

###### Returns

`boolean`

`true` while the UI owns the keyboard. `@ignifx/ui` assigns it.

###### Set Signature

> **set** **uiHasFocus**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

#### Methods

##### cancelInteractiveRebind()

> **cancelInteractiveRebind**(): `void`

Cancels the interactive rebind in flight, if there is one.

###### Returns

`void`

##### clearActions()

> **clearActions**(): `void`

Removes every installed map and control scheme.

###### Returns

`void`

##### clearOverrides()

> **clearOverrides**(): `void`

Returns every binding to its declared path.

###### Returns

`void`

##### createActionSet()

> **createActionSet**(`source`, `options?`): [`InputActionSet`](#inputactionset)

Builds a private copy of a document's maps, bound to one gamepad slot
(`docs/architecture/08-input.md` §7). `PlayerInput` uses it so that two players can hold the
same action names without sharing state; the copy resolves in the same `PreUpdate` pass as
`app.input.actions`.

###### Parameters

###### source

[`InputActionsAsset`](#inputactionsasset) \| [`InputActionsDefinition`](#inputactionsdefinition) \| [`AssetHandle`](#assethandle)\<[`InputActionsAsset`](#inputactionsasset)\>

A loaded asset, its handle, or a definition built by `defineInputActions`.

###### options?

[`ActionSetOptions`](#actionsetoptions)

The gamepad slot to pin to and the control scheme to keep.

###### Returns

[`InputActionSet`](#inputactionset)

The private set. Dispose it when the owner goes away.

###### Example

```ts
const set = app.input.createActionSet(asset, { deviceSlot: 1, scheme: "Gamepad" });
set.actions.get("move").vector.x;
```

##### invalidateBindings()

> **invalidateBindings**(): `void`

Marks the control-to-actions index stale, so the next frame rebuilds it.

###### Returns

`void`

###### Implementation of

[`BindingResolver`](#bindingresolver).[`invalidateBindings`](#invalidatebindings)

##### loadActions()

> **loadActions**(`source`): `void`

Installs the maps and control schemes of a document, merging by map name: a map whose name is
already installed is replaced, and every other installed map is kept
(`docs/architecture/08-input.md` §3).

###### Parameters

###### source

[`InputActionsAsset`](#inputactionsasset) \| [`InputActionsDefinition`](#inputactionsdefinition) \| [`AssetHandle`](#assethandle)\<[`InputActionsAsset`](#inputactionsasset)\>

A loaded asset, its handle, or a definition built by `defineInputActions`.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0802`, `IGX-0803`, `IGX-0806`, or `IGX-0810` when a binding
or a name in the document cannot be used.

##### loadOverrides()

> **loadOverrides**(`json`): `void`

Applies a saved override document, clearing whatever was applied before.

###### Parameters

###### json

[`InputOverridesJson`](#inputoverridesjson)

The document from [InputService.saveOverrides](#saveoverrides).

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0808` when the document cannot be applied.

##### performInteractiveRebind()

> **performInteractiveRebind**(`action`, `options?`): `Promise`\<[`InteractiveRebindResult`](#interactiverebindresult)\>

Listens for the next control the player actuates and writes its path into one of an action's
bindings as an override (`docs/architecture/08-input.md` §6).

###### Parameters

###### action

[`InputAction`](#inputaction)

The action to rebind.

###### options?

[`InteractiveRebindOptions`](#interactiverebindoptions)

Binding index, exclusions, cancel path, timeout, and threshold.

###### Returns

`Promise`\<[`InteractiveRebindResult`](#interactiverebindresult)\>

What the player chose, or a cancelled or timed-out result. The promise settles from the
`PreUpdate` resolution, the same delivery point an asset handle settles at.

###### Throws

IgnifxError with code `IGX-0807` when a rebind is already listening.

###### Example

```ts
const result = await app.input.performInteractiveRebind(app.input.actions.get("jump"), {
  cancelPath: "<Keyboard>/escape",
  timeoutSeconds: 5,
});
```

##### releaseAll()

> **releaseAll**(): `void`

Queues a release of every control, which is what `blur` and `visibilitychange` do
(`docs/architecture/08-input.md` §4). A game that opens a modal outside the canvas can call it
so a key held at that moment does not stay stuck.

###### Returns

`void`

###### Example

```ts
app.input.releaseAll();
```

##### resolveControl()

> **resolveControl**(`path`, `kind?`): [`ControlRef`](#controlref)

Resolves a binding path to a device control, creating a `<Virtual>` control on demand.

###### Parameters

###### path

`string`

The binding path.

###### kind?

[`ControlKind`](#controlkind-1)

The kind a new `<Virtual>` control is created with.

###### Returns

[`ControlRef`](#controlref)

The resolved control.

###### Throws

IgnifxError with code `IGX-0803` when the path does not resolve.

###### Implementation of

[`BindingResolver`](#bindingresolver).[`resolveControl`](#resolvecontrol)

##### saveOverrides()

> **saveOverrides**(): [`InputOverridesJson`](#inputoverridesjson)

Collects every binding override currently applied.

###### Returns

[`InputOverridesJson`](#inputoverridesjson)

The document to persist.

##### simulate()

> **simulate**(`values`): `void`

Queues synthetic control values, resolved by the same pipeline as real input
(`docs/architecture/08-input.md` §8). This is how headless tests drive the engine.

###### Parameters

###### values

`Readonly`\<`Record`\<`string`, [`SimulatedValue`](#simulatedvalue)\>\>

Binding paths to the value each control takes, held until changed again.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0803` when a path does not resolve.

###### Example

```ts
app.input.simulate({ "<Keyboard>/w": 1, "<Gamepad>/leftStick": { x: 0.5, y: 0 } });
```

##### simulateEvent()

> **simulateEvent**(`event`): `void`

Queues one synthetic raw event, as if the DOM had delivered it.

###### Parameters

###### event

[`SimulatedEvent`](#simulatedevent)

The event to queue; `code` names a control, not a `KeyboardEvent.code`.

###### Returns

`void`

###### Example

```ts
app.input.simulateEvent({ type: "pointerdown", x: 10, y: 20, button: 0 });
```

***

### LayerMask

An immutable set of layer slots.

#### Remarks

Two ways in, deliberately:

- **Scripts use `world.layers.mask("Player", "Enemy")`** — names, resolved through the project's
  [LayerTable](#layertable), which is what makes files rename-safe.
- [LayerMask.of](#of) takes slot **indices**, for code that already resolved names (a system
  caching `entity.layer` at `awake`, say) and for tests.

There is no name-taking static, because resolving a name needs the project's table and a static
has no access to one; [LayerMask.fromNames](#fromnames) is the standalone form that takes the table
explicitly.

#### Example

```ts
class Hitbox extends Script {
  #hostiles = LayerMask.nothing();
  awake(): void {
    this.#hostiles = this.world.layers.mask("Enemy", "Projectile");
  }
  onTriggerEnter(other: TriggerEvent): void {
    if (this.#hostiles.has(other.entity.layer)) {
      this.takeDamage();
    }
  }
}
```

#### Constructors

##### Constructor

> **new LayerMask**(`bits`): [`LayerMask`](#layermask-4)

Wraps a raw bit word. Prefer [LayerMask.of](#of), [LayerMask.fromNames](#fromnames), or
`world.layers.mask(...)`.

###### Parameters

###### bits

`number`

The bit word; only the low 32 bits are kept.

###### Returns

[`LayerMask`](#layermask-4)

#### Properties

##### bits

> `readonly` **bits**: `number`

The 32 slot bits, read as an unsigned word.

#### Methods

##### everything()

> `static` **everything**(): [`LayerMask`](#layermask-4)

The mask with all 32 slots set.

###### Returns

[`LayerMask`](#layermask-4)

A full mask.

##### fromBits()

> `static` **fromBits**(`bits`): [`LayerMask`](#layermask-4)

Wraps a bit word that was stored or received from another system.

###### Parameters

###### bits

`number`

The bit word.

###### Returns

[`LayerMask`](#layermask-4)

The mask.

##### fromNames()

> `static` **fromNames**(`table`, `names`): [`LayerMask`](#layermask-4)

Builds a mask from layer names resolved through a table — the standalone form of
`world.layers.mask(...)`.

###### Parameters

###### table

[`LayerTable`](#layertable)

The project's layer table.

###### names

readonly `string`[]

The layer names to include.

###### Returns

[`LayerMask`](#layermask-4)

The mask.

###### Throws

IgnifxError with code `IGX-0303` when a name is not declared.

##### has()

> **has**(`layer`): `boolean`

Reports whether a slot is in the mask.

###### Parameters

###### layer

`number`

The slot index.

###### Returns

`boolean`

`true` when the slot's bit is set.

##### intersects()

> **intersects**(`other`): `boolean`

Reports whether the mask shares at least one slot with another.

###### Parameters

###### other

[`LayerMask`](#layermask-4)

The mask to test against.

###### Returns

`boolean`

`true` when the two masks overlap.

##### nothing()

> `static` **nothing**(): [`LayerMask`](#layermask-4)

The mask with no slots set.

###### Returns

[`LayerMask`](#layermask-4)

An empty mask.

##### of()

> `static` **of**(...`layers`): [`LayerMask`](#layermask-4)

Builds a mask from layer slot indices.

###### Parameters

###### layers

...readonly `number`[]

The slots to include; values outside `[0, 31]` are ignored.

###### Returns

[`LayerMask`](#layermask-4)

The mask.

###### Example

```ts
LayerMask.of(0, 8).bits; // 0b100000001
```

##### toNames()

> **toNames**(`table`): `string`[]

The names of every slot in the mask, in slot order — what the serializer writes, because files
store names rather than bits (`docs/architecture/06-serialization-and-scene-format.md` §3).

###### Parameters

###### table

[`LayerTable`](#layertable)

The project's layer table.

###### Returns

`string`[]

The names of the set slots that the table declares; unnamed slots are skipped.

##### with()

> **with**(`layer`): [`LayerMask`](#layermask-4)

Adds a slot.

###### Parameters

###### layer

`number`

The slot index; out-of-range values are ignored.

###### Returns

[`LayerMask`](#layermask-4)

A new mask; this one is unchanged.

##### without()

> **without**(`layer`): [`LayerMask`](#layermask-4)

Removes a slot.

###### Parameters

###### layer

`number`

The slot index; out-of-range values are ignored.

###### Returns

[`LayerMask`](#layermask-4)

A new mask; this one is unchanged.

***

### LayerTable

The resolved mapping between layer names and the 32 layer slots.

#### Remarks

How the project list is interpreted (the settings example in
`docs/architecture/04-extensions.md` §5 opens with `"Default"`, while
`docs/architecture/02-scene-graph.md` §7 reserves slots 0–7, so one rule has to reconcile the
two): the eight reserved names always occupy slots 0–7. A project entry that repeats a reserved
name keeps that reserved slot and consumes no user slot; every other entry takes the next free
slot from 8 upwards, in declaration order. A name declared twice is `IGX-0304`; more names than
slots is `IGX-0305`.

#### Example

```ts
const table = createLayerTable(["Default", "Ground", "Player"]);
table.indexOf("Ground"); // 8
table.mask("Ground", "Player").bits; // 0b1100000000
```

#### Accessors

##### count

###### Get Signature

> **get** **count**(): `number`

How many slots carry a name.

###### Returns

`number`

The count, always at least eight.

##### names

###### Get Signature

> **get** **names**(): readonly `string`[]

Every slot's name, indexed by slot. Unassigned user slots hold the empty string.

###### Returns

readonly `string`[]

The 32 slot names.

#### Methods

##### has()

> **has**(`name`): `boolean`

Reports whether a name is declared.

###### Parameters

###### name

`string`

The layer name.

###### Returns

`boolean`

`true` when the name resolves to a slot.

##### indexOf()

> **indexOf**(`name`): `number`

Resolves a layer name to its slot.

###### Parameters

###### name

`string`

The layer name.

###### Returns

`number`

The slot index, or `-1` when the project does not declare the name.

##### mask()

> **mask**(...`names`): [`LayerMask`](#layermask-4)

Builds a mask from layer names — the ergonomic form scripts use, reached as
`world.layers.mask("Player", "Enemy")`.

###### Parameters

###### names

...readonly `string`[]

The layer names to include.

###### Returns

[`LayerMask`](#layermask-4)

The mask.

###### Throws

IgnifxError with code `IGX-0303` when a name is not declared.

###### Example

```ts
const hostiles = this.world.layers.mask("Enemy", "Projectile");
if (hostiles.has(other.layer)) {
  this.takeDamage();
}
```

##### nameOf()

> **nameOf**(`index`): `string` \| `null`

The name of a slot.

###### Parameters

###### index

`number`

The slot index.

###### Returns

`string` \| `null`

The name, or `null` when the slot is out of range or unassigned.

##### requireIndex()

> **requireIndex**(`name`): `number`

Resolves a layer name to its slot, requiring it to exist.

###### Parameters

###### name

`string`

The layer name.

###### Returns

`number`

The slot index.

###### Throws

IgnifxError with code `IGX-0303` when the project does not declare the name. Scene
loading* is more forgiving: an unknown name in a file resolves to `Default` with the same code
reported as a diagnostic (`docs/architecture/02-scene-graph.md` §7).

***

### Light

A light source (`docs/architecture/07-rendering.md` §2.2).

#### Remarks

The entity's transform defines the light: a directional or spot light points along the entity's
local `+Z`, a point light sits at its origin, and a hemispheric light's sky direction is its local
`+Y`.

#### Example

```ts
const sun = world.createEntity("Sun");
sun.transform.lookAt({ x: 0, y: 0, z: 0 });
sun.addComponent(Light, { type: "directional", intensity: 3, shadows: { enabled: true } });
```

#### Extends

- [`Component`](#abstract-component)

#### Implements

- [`ComponentHooks`](#componenthooks)

#### Constructors

##### Constructor

> **new Light**(): [`Light`](#light)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`Light`](#light)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

At most one light per entity: two lights from one transform want two entities.

##### color

> **color**: [`ColorLike`](#colorlike)

##### exclude

> **exclude**: ([`Entity`](#entity-4) \| `null`)[]

##### groundColor

> **groundColor**: [`ColorLike`](#colorlike)

##### includeOnly

> **includeOnly**: ([`Entity`](#entity-4) \| `null`)[]

##### intensity

> **intensity**: `number`

##### range

> **range**: `number`

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### shadows

> **shadows**: [`LightShadowSettings`](#lightshadowsettings)

##### spotAngle

> **spotAngle**: `number`

##### spotExponent

> **spotExponent**: `number`

##### type

> **type**: `"directional"` \| `"point"` \| `"spot"` \| `"hemispheric"`

##### typeId

> `static` **typeId**: `string`

The namespaced registration id.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### isCastingShadows

###### Get Signature

> **get** **isCastingShadows**(): `boolean`

Whether this light currently casts shadows — which needs the `shadows` rendering feature, a
light kind Lite can shadow, and `shadows.enabled`.

###### Returns

`boolean`

`true` when a shadow generator is attached.

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### lite

###### Get Signature

> **get** **lite**(): `object`

The Babylon Lite light this component owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

`object`

The light and its shadow generator, either of which may be `null`.

###### light

> `readonly` **light**: [`LiteLight`](#litelight) \| `null`

###### shadowGenerator

> `readonly` **shadowGenerator**: `ShadowGenerator` \| `null`

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### onAttach()

> **onAttach**(): `void`

Records that the component exists; the Lite light is built on the first sync.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onAttach`](#onattach-1)

##### onDetach()

> **onDetach**(): `void`

Removes the light from the scene and releases its shadow generator.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onDetach`](#ondetach-1)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

***

### Mat4

A 4×4 transformation matrix stored column-major in a `Float32Array`, byte-compatible with WGSL's
`mat4x4<f32>` and with Babylon Lite's `Mat4` (translation in slots 12/13/14).

ignifx is left-handed, Y up, +Z forward (ADR-0011), so the projection helpers are the `LH`
family and they use Lite's **reverse depth** convention: the near plane maps to 1 and the far
plane to 0.

Instance methods mutate the matrix and return `this`; `ToRef` statics write into their `out`
matrix and allocate nothing, and are safe when `out` aliases an input. The remaining statics
allocate a fresh matrix and say so.

#### Example

```ts
const world = new Mat4();
Mat4.composeToRef(position, rotation, scale, world);

const inverse = new Mat4();
if (Mat4.invertToRef(world, inverse)) {
  Mat4.transformPointToRef(inverse, worldPoint, localPoint);
}
```

#### Constructors

##### Constructor

> **new Mat4**(): [`Mat4`](#mat4)

Creates an identity matrix.

###### Returns

[`Mat4`](#mat4)

#### Properties

##### elements

> `readonly` **elements**: [`Mat4Elements`](#mat4elements-1)

The 16 elements, column-major (`elements[column * 4 + row]`). This is the object to hand to
anything that wants a [Mat4Like](#mat4like) — including Babylon Lite — and the buffer to upload to
the GPU. It is never reallocated, so a reference to it stays valid for the matrix's lifetime.

#### Methods

##### clone()

> **clone**(): [`Mat4`](#mat4)

Copies this matrix into a new one.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### compose()

> `static` **compose**(`position`, `rotation`, `scale`): [`Mat4`](#mat4)

Builds a translation-rotation-scale matrix, the same composition order Babylon Lite's
`mat4Compose` uses (`translation * rotation * scale`).

###### Parameters

###### position

[`Vec3Like`](#vec3like)

The translation, in metres.

###### rotation

[`QuatLike`](#quatlike)

The rotation; assumed to be a unit quaternion.

###### scale

[`Vec3Like`](#vec3like)

The per-axis scale.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### composeToRef()

> `static` **composeToRef**(`position`, `rotation`, `scale`, `out`): [`Mat4`](#mat4)

Writes a translation-rotation-scale matrix into `out`.

###### Parameters

###### position

[`Vec3Like`](#vec3like)

The translation, in metres.

###### rotation

[`QuatLike`](#quatlike)

The rotation; assumed to be a unit quaternion.

###### scale

[`Vec3Like`](#vec3like)

The per-axis scale.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

###### Example

```ts
Mat4.composeToRef(transform.localPosition, transform.localRotation, transform.localScale, local);
```

##### copyFrom()

> **copyFrom**(`m`): `this`

Copies every element from another matrix.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to read.

###### Returns

`this`

This matrix.

##### decomposeToRef()

> `static` **decomposeToRef**(`m`, `outPosition`, `outRotation`, `outScale`): `boolean`

Splits an affine transformation-rotation-scale matrix back into its parts, using Babylon Lite's
convention (`lib/math/mat4-decompose.js`): scales are the lengths of the basis columns, and a
mirrored matrix (negative basis determinant) reports a **negative Y scale** rather than
silently dropping the reflection. Shear is not detected.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to split.

###### outPosition

[`MutableVec3`](#mutablevec3)

Receives the translation.

###### outRotation

[`MutableQuat`](#mutablequat)

Receives the rotation as a unit quaternion.

###### outScale

[`MutableVec3`](#mutablevec3)

Receives the per-axis scale.

###### Returns

`boolean`

`true` on success; `false` when a basis column has (near) zero length, in which case
the outputs are left untouched.

###### Example

```ts
Mat4.decomposeToRef(node.worldMatrix, position, rotation, scale);
```

##### determinant()

> `static` **determinant**(`m`): `number`

The full 4×4 determinant.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to measure.

###### Returns

`number`

The determinant; zero means the matrix cannot be inverted.

##### determinant()

> **determinant**(): `number`

The full 4×4 determinant of this matrix.

###### Returns

`number`

The determinant; zero means the matrix cannot be inverted.

##### equalsWithEpsilon()

> `static` **equalsWithEpsilon**(`a`, `b`, `epsilon?`): `boolean`

Compares two matrices element by element, with a tolerance.

###### Parameters

###### a

[`Mat4Like`](#mat4like)

The first matrix.

###### b

[`Mat4Like`](#mat4like)

The second matrix.

###### epsilon?

`number`

The largest per-element difference still considered equal.

###### Returns

`boolean`

`true` when every element matches within `epsilon`.

##### equalsWithEpsilon()

> **equalsWithEpsilon**(`m`, `epsilon?`): `boolean`

Compares this matrix with another element by element, with a tolerance.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to compare against.

###### epsilon?

`number`

The largest per-element difference still considered equal.

###### Returns

`boolean`

`true` when every element matches within `epsilon`.

##### from()

> `static` **from**(`m`): [`Mat4`](#mat4)

Creates a matrix holding a copy of another matrix's elements.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to copy.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### fromQuat()

> `static` **fromQuat**(`q`): [`Mat4`](#mat4)

Builds a pure rotation matrix from a quaternion.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation; assumed to be a unit quaternion.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### fromQuatToRef()

> `static` **fromQuatToRef**(`q`, `out`): [`Mat4`](#mat4)

Writes a pure rotation matrix into `out`.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation; assumed to be a unit quaternion.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

##### getRotationToRef()

> `static` **getRotationToRef**\<`TOut`\>(`m`, `out`): `TOut`

Reads a matrix's rotation, dividing the scale out of the basis first.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to read.

###### out

`TOut`

The quaternion to write. Left untouched when a basis column has zero length.

###### Returns

`TOut`

`out`.

##### getScaleToRef()

> `static` **getScaleToRef**\<`TOut`\>(`m`, `out`): `TOut`

Reads a matrix's per-axis scale as the lengths of its basis columns, negating Y for a mirrored
matrix exactly as [Mat4.decomposeToRef](#decomposetoref) does.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to read.

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`.

##### getTranslationToRef()

> `static` **getTranslationToRef**\<`TOut`\>(`m`, `out`): `TOut`

Reads a matrix's translation.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to read.

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`.

##### identity()

> `static` **identity**(): [`Mat4`](#mat4)

Creates an identity matrix.

###### Returns

[`Mat4`](#mat4)

A new identity matrix. **Allocates.**

##### identity()

> **identity**(): `this`

Resets this matrix to the identity.

###### Returns

`this`

This matrix.

##### invert()

> **invert**(): `boolean`

Inverts this matrix in place.

###### Returns

`boolean`

`true` on success. When the matrix is singular this returns `false` and leaves the
matrix untouched.

##### invertToRef()

> `static` **invertToRef**(`m`, `out`): `boolean`

Writes the inverse of `m` into `out`.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to invert.

###### out

[`Mat4`](#mat4)

The matrix to write; may alias `m`. Left untouched when the inverse does not exist.

###### Returns

`boolean`

`true` on success, `false` when `m` is singular. Returning a status rather than `null`
keeps the call allocation-free (coding standards §7).

###### Example

```ts
if (!Mat4.invertToRef(world, worldToLocal)) {
  // degenerate scale — skip this entity
}
```

##### lookAtLH()

> `static` **lookAtLH**(`eye`, `target`, `up`): [`Mat4`](#mat4)

Builds a left-handed view matrix that places the camera at `eye` looking at `target`.

###### Parameters

###### eye

[`Vec3Like`](#vec3like)

The camera position, in metres.

###### target

[`Vec3Like`](#vec3like)

The point to look at, in metres.

###### up

[`Vec3Like`](#vec3like)

The camera's up direction.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### lookAtLHToRef()

> `static` **lookAtLHToRef**(`eye`, `target`, `up`, `out`): [`Mat4`](#mat4)

Writes a left-handed view matrix into `out`. Reproduces Babylon Lite's `mat4LookAtLHToRef`,
including its degenerate-input behaviour: when `eye` and `target` coincide, or when `up` is
parallel to the view direction, `out` becomes the identity.

###### Parameters

###### eye

[`Vec3Like`](#vec3like)

The camera position, in metres.

###### target

[`Vec3Like`](#vec3like)

The point to look at, in metres.

###### up

[`Vec3Like`](#vec3like)

The camera's up direction.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

##### multiply()

> `static` **multiply**(`a`, `b`): [`Mat4`](#mat4)

Multiplies two matrices.

###### Parameters

###### a

[`Mat4Like`](#mat4like)

The left-hand matrix.

###### b

[`Mat4Like`](#mat4like)

The right-hand matrix.

###### Returns

[`Mat4`](#mat4)

A new matrix holding `a * b`. **Allocates.**

##### multiply()

> **multiply**(`m`): `this`

Post-multiplies this matrix by another (`this = this * m`), so `m`'s transform is applied first
when the product acts on a column vector.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The right-hand matrix.

###### Returns

`this`

This matrix.

##### multiplyToRef()

> `static` **multiplyToRef**(`a`, `b`, `out`): [`Mat4`](#mat4)

Writes `a * b` into `out`. Acting on a column vector, `b` is applied first.

###### Parameters

###### a

[`Mat4Like`](#mat4like)

The left-hand matrix.

###### b

[`Mat4Like`](#mat4like)

The right-hand matrix.

###### out

[`Mat4`](#mat4)

The matrix to write; may alias `a` or `b`.

###### Returns

[`Mat4`](#mat4)

`out`.

##### orthoLH()

> `static` **orthoLH**(`width`, `height`, `near`, `far`): [`Mat4`](#mat4)

Builds a centred left-handed orthographic projection.

###### Parameters

###### width

`number`

The view width, in metres.

###### height

`number`

The view height, in metres.

###### near

`number`

The near plane distance, in metres.

###### far

`number`

The far plane distance, in metres.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### orthoLHToRef()

> `static` **orthoLHToRef**(`width`, `height`, `near`, `far`, `out`): [`Mat4`](#mat4)

Writes a centred left-handed orthographic projection into `out`, with the same reverse-depth
convention as [Mat4.perspectiveLHToRef](#perspectivelhtoref).

###### Parameters

###### width

`number`

The view width, in metres.

###### height

`number`

The view height, in metres.

###### near

`number`

The near plane distance, in metres.

###### far

`number`

The far plane distance, in metres.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

##### orthoOffCenterLHToRef()

> `static` **orthoOffCenterLHToRef**(`left`, `right`, `bottom`, `top`, `near`, `far`, `out`): [`Mat4`](#mat4)

Writes an off-centre left-handed orthographic projection into `out`, reproducing Babylon Lite's
`mat4OrthoOffCenterLHToRef` (reverse depth).

###### Parameters

###### left

`number`

The left clip plane, in metres.

###### right

`number`

The right clip plane, in metres.

###### bottom

`number`

The bottom clip plane, in metres.

###### top

`number`

The top clip plane, in metres.

###### near

`number`

The near plane distance, in metres.

###### far

`number`

The far plane distance, in metres.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

##### perspectiveLH()

> `static` **perspectiveLH**(`fovDegrees`, `aspect`, `near`, `far`): [`Mat4`](#mat4)

Builds a left-handed perspective projection.

###### Parameters

###### fovDegrees

`number`

The vertical field of view, in degrees.

###### aspect

`number`

The viewport's width divided by its height.

###### near

`number`

The near plane distance, in metres.

###### far

`number`

The far plane distance, in metres.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### perspectiveLHToRef()

> `static` **perspectiveLHToRef**(`fovDegrees`, `aspect`, `near`, `far`, `out`): [`Mat4`](#mat4)

Writes a left-handed perspective projection into `out`, matching Babylon Lite's
`mat4PerspectiveLHToRef` — which is a **reverse-depth** projection: the near plane maps to
clip-space depth 1 and the far plane to 0, the arrangement that keeps float depth precise.

###### Parameters

###### fovDegrees

`number`

The vertical field of view, in degrees.

###### aspect

`number`

The viewport's width divided by its height.

###### near

`number`

The near plane distance, in metres.

###### far

`number`

The far plane distance, in metres.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

##### scaling()

> `static` **scaling**(`x`, `y`, `z`): [`Mat4`](#mat4)

Builds a pure scaling matrix.

###### Parameters

###### x

`number`

Scale along X.

###### y

`number`

Scale along Y.

###### z

`number`

Scale along Z.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### scalingToRef()

> `static` **scalingToRef**(`x`, `y`, `z`, `out`): [`Mat4`](#mat4)

Writes a pure scaling matrix into `out`.

###### Parameters

###### x

`number`

Scale along X.

###### y

`number`

Scale along Y.

###### z

`number`

Scale along Z.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

##### transformDirectionToRef()

> `static` **transformDirectionToRef**\<`TOut`\>(`m`, `direction`, `out`): `TOut`

Transforms a direction by a matrix, ignoring translation. Note that this is the plain basis
transform: a non-uniformly scaled matrix needs its inverse-transpose to keep normals correct.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The transformation.

###### direction

[`Vec3Like`](#vec3like)

The direction to transform.

###### out

`TOut`

The vector to write; may alias `direction`.

###### Returns

`TOut`

`out`.

##### transformPointToRef()

> `static` **transformPointToRef**\<`TOut`\>(`m`, `point`, `out`): `TOut`

Transforms a point by a matrix, applying translation and the perspective divide.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The transformation.

###### point

[`Vec3Like`](#vec3like)

The point to transform, in metres.

###### out

`TOut`

The vector to write; may alias `point`.

###### Returns

`TOut`

`out`.

##### translation()

> `static` **translation**(`x`, `y`, `z`): [`Mat4`](#mat4)

Builds a pure translation matrix.

###### Parameters

###### x

`number`

Translation along X, in metres.

###### y

`number`

Translation along Y, in metres.

###### z

`number`

Translation along Z, in metres.

###### Returns

[`Mat4`](#mat4)

A new matrix. **Allocates.**

##### translationToRef()

> `static` **translationToRef**(`x`, `y`, `z`, `out`): [`Mat4`](#mat4)

Writes a pure translation matrix into `out`.

###### Parameters

###### x

`number`

Translation along X, in metres.

###### y

`number`

Translation along Y, in metres.

###### z

`number`

Translation along Z, in metres.

###### out

[`Mat4`](#mat4)

The matrix to write.

###### Returns

[`Mat4`](#mat4)

`out`.

##### transpose()

> **transpose**(): `this`

Transposes this matrix in place, swapping rows and columns.

###### Returns

`this`

This matrix.

##### transposeToRef()

> `static` **transposeToRef**(`m`, `out`): [`Mat4`](#mat4)

Writes the transpose of `m` into `out`.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to transpose.

###### out

[`Mat4`](#mat4)

The matrix to write; may alias `m`.

###### Returns

[`Mat4`](#mat4)

`out`.

***

### MaterialAsset

A material a `MeshRenderer` or a `Model` draws with
(`docs/architecture/07-rendering.md` §2.6).

#### Remarks

Materials are shared: many renderers reference one asset, and editing it changes all of them.
[MaterialAsset.clone](#clone-2) is the per-renderer variation escape hatch — it rebuilds the Lite
material from the same declaration, so the copy starts identical and drifts on its own.

#### Example

```ts
const gold = await app.assets.loadAsync<MaterialAsset>("materials/gold.material.json");
using warm = gold.value.clone(app);
warm.value.setBaseColor({ r: 1, g: 0.6, b: 0.2, a: 1 });
```

#### Properties

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers materials under.

##### definition

> `readonly` **definition**: [`MaterialDefinition`](#materialdefinition)

The declaration this material was built from; [MaterialAsset.clone](#clone-2) replays it.

##### textures

> `readonly` **textures**: readonly [`AssetHandle`](#assethandle)\<[`TextureAsset`](#textureasset)\>[]

The texture handles the material samples, in slot order. It does not own them.

#### Accessors

##### kind

###### Get Signature

> **get** **kind**(): `"standard"` \| `"pbr"` \| `"shader"`

The material family.

###### Returns

`"standard"` \| `"pbr"` \| `"shader"`

`"pbr"` or `"standard"`.

##### lite

###### Get Signature

> **get** **lite**(): [`MaterialAssetLiteHandles`](#materialassetlitehandles)

The Babylon Lite objects the asset owns. Unstable escape hatch.

###### Returns

[`MaterialAssetLiteHandles`](#materialassetlitehandles)

The Lite material.

##### name

###### Get Signature

> **get** **name**(): `string`

The material's human-readable name.

###### Returns

`string`

The declared name.

#### Methods

##### clone()

> **clone**(`app`): [`AssetHandle`](#assethandle)\<[`MaterialAsset`](#materialasset)\>

Builds an independent copy of this material from the same declaration — the per-renderer
variation path of `docs/architecture/07-rendering.md` §2.6.

###### Parameters

###### app

[`App`](#app)

The app whose asset service publishes the copy.

###### Returns

[`AssetHandle`](#assethandle)\<[`MaterialAsset`](#materialasset)\>

The copy's handle, with one holder — the caller.

###### Remarks

The copy shares the original's *textures* (they are addressed assets, and the handles are
retained by whoever loaded them) and nothing else: it is a second Lite material in the same
family, so it costs no extra shader compilation.

##### setAlpha()

> **setAlpha**(`alpha`): `void`

Replaces the material's overall alpha.

###### Parameters

###### alpha

`number`

The new alpha, 0 to 1.

###### Returns

`void`

##### setBaseColor()

> **setBaseColor**(`color`): `void`

Replaces the base colour — the PBR `baseColorFactor`, or a Standard material's `diffuseColor`.

###### Parameters

###### color

[`ColorLike`](#colorlike)

The new sRGB colour. Alpha is used by PBR and ignored by Standard, which carries
its own `alpha`.

###### Returns

`void`

###### Remarks

The colour is sRGB, like every colour in ignifx's public API; the linear value the shader reads
is derived here. The change marks the material's uniform block dirty, which is the cheap path:
no pipeline is recompiled (`src/lite/material.ts`).

##### setMetallicRoughness()

> **setMetallicRoughness**(`metallic`, `roughness`): `void`

Replaces the metallic and roughness factors of a `"pbr"` material. A Standard material has
neither, so the call is ignored.

###### Parameters

###### metallic

`number`

The metallic factor, 0 to 1.

###### roughness

`number`

The roughness factor, 0 to 1.

###### Returns

`void`

***

### MeshAsset

A geometry template a `MeshRenderer` draws (`docs/architecture/07-rendering.md` §2.3).

#### Remarks

Build one with a primitive factory or [MeshAsset.fromData](#fromdata); each returns the handle the
`MeshRenderer.mesh` field takes. A mesh that came from a file arrives as part of a `ModelAsset`
instead — a glTF is a tree of meshes, materials, and animations, not one buffer.

#### Example

```ts
using box = MeshAsset.box(app, { size: 2 });
const cube = app.world.createEntity("Cube");
cube.addComponent(MeshRenderer, { mesh: box.retain() });
```

#### Properties

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers meshes under.

##### name

> `readonly` **name**: `string`

A human-readable name, used in diagnostics and as the Lite mesh's name.

#### Accessors

##### isDisposed

###### Get Signature

> **get** **isDisposed**(): `boolean`

Whether the template's GPU buffers have been released.

###### Returns

`boolean`

`true` once [MeshAsset.dispose](#dispose-9) has run.

##### lite

###### Get Signature

> **get** **lite**(): [`MeshAssetLiteHandles`](#meshassetlitehandles)

The Babylon Lite objects the asset owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

[`MeshAssetLiteHandles`](#meshassetlitehandles)

The template mesh, or `null` under a headless app.

#### Methods

##### \[dispose\]()

> **\[dispose\]**(): `void`

Releases the template when the asset leaves a `using` block.

###### Returns

`void`

##### box()

> `static` **box**(`app`, `options?`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a box template and publishes it.

###### Parameters

###### app

[`App`](#app)

The app whose engine uploads the geometry and whose asset service holds the handle.

###### options?

[`BoxMeshOptions`](#boxmeshoptions)

A uniform `size`, or per-axis dimensions.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder — the caller.

###### Example

```ts
const box = MeshAsset.box(app, { width: 2, height: 1, depth: 3 });
```

##### capsule()

> `static` **capsule**(`app`, `options?`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a capsule template standing along Y and publishes it.

###### Parameters

###### app

[`App`](#app)

The app that owns the engine and the asset service.

###### options?

[`CapsuleMeshOptions`](#capsulemeshoptions)

Total height, radius, and tessellation.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder.

##### cylinder()

> `static` **cylinder**(`app`, `options?`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a cylinder template standing along Y and publishes it.

###### Parameters

###### app

[`App`](#app)

The app that owns the engine and the asset service.

###### options?

[`CylinderMeshOptions`](#cylindermeshoptions)

Height, diameters, and tessellation.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder.

##### dispose()

> **dispose**(): `void`

Releases the template's GPU buffers.

###### Returns

`void`

###### Remarks

Lite exports no mesh disposer: a mesh's buffers are freed when it leaves its last scene, so the
adapter adds the template to a scene and takes it straight out again
(`src/lite/gpu/mesh.ts`). Clones still in a scene keep the shared buffers alive; what the
template loses is the ability to be cloned again. Calling it twice is a no-op, and it is a
no-op under a headless app, which has no buffers.

##### fromData()

> `static` **fromData**(`app`, `name`, `data`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a template from raw vertex data and publishes it.

###### Parameters

###### app

[`App`](#app)

The app that owns the engine and the asset service.

###### name

`string`

A human-readable name.

###### data

[`MeshGeometryData`](#meshgeometrydata)

Positions, normals, indices, and optional texture coordinates. Lite keeps
references to the arrays; do not mutate them afterwards.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder.

###### Example

```ts
const triangle = MeshAsset.fromData(app, "triangle", {
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1]),
  indices: Uint32Array.from([0, 1, 2]),
});
```

##### ground()

> `static` **ground**(`app`, `options?`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a subdivided grid in the XZ plane and publishes it.

###### Parameters

###### app

[`App`](#app)

The app that owns the engine and the asset service.

###### options?

[`GroundMeshOptions`](#groundmeshoptions)

Width, depth, subdivisions, and UV scale.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder.

##### plane()

> `static` **plane**(`app`, `options?`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a quad template in the XY plane and publishes it.

###### Parameters

###### app

[`App`](#app)

The app that owns the engine and the asset service.

###### options?

[`PlaneMeshOptions`](#planemeshoptions)

A uniform `size`, or width and height.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder.

##### sphere()

> `static` **sphere**(`app`, `options?`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a sphere template and publishes it.

###### Parameters

###### app

[`App`](#app)

The app that owns the engine and the asset service.

###### options?

[`SphereMeshOptions`](#spheremeshoptions)

Diameter and ring count.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder.

##### torus()

> `static` **torus**(`app`, `options?`): [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

Creates a torus template in the XZ plane and publishes it.

###### Parameters

###### app

[`App`](#app)

The app that owns the engine and the asset service.

###### options?

[`TorusMeshOptions`](#torusmeshoptions)

Diameter, thickness, and tessellation.

###### Returns

[`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\>

The handle, with one holder.

***

### MeshRenderer

Draws a mesh asset with a material (`docs/architecture/07-rendering.md` §2.3).

#### Example

```ts
using box = MeshAsset.box(app, { size: 1 });
const cube = world.createEntity("Cube");
cube.addComponent(MeshRenderer, { mesh: box.retain(), castShadows: true });
```

#### Extends

- [`Component`](#abstract-component)

#### Implements

- [`ComponentHooks`](#componenthooks)

#### Constructors

##### Constructor

> **new MeshRenderer**(): [`MeshRenderer`](#meshrenderer)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`MeshRenderer`](#meshrenderer)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

Several renderers on one entity draw several meshes from one transform, which is useful.

##### castShadows

> **castShadows**: `boolean`

##### materials

> **materials**: ([`AssetHandle`](#assethandle)\<[`MaterialAsset`](#materialasset)\> \| `null`)[]

##### mesh

> **mesh**: [`AssetHandle`](#assethandle)\<[`MeshAsset`](#meshasset)\> \| `null`

##### pickable

> **pickable**: `boolean`

##### receiveShadows

> **receiveShadows**: `boolean`

##### renderOrder

> **renderOrder**: `number`

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### typeId

> `static` **typeId**: `string`

The namespaced registration id.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### isVisible

###### Get Signature

> **get** **isVisible**(): `boolean`

Whether the mesh is currently drawn: its own `enabled` flag and its entity's
`activeInHierarchy`, materialised onto Lite's `visible`.

###### Returns

`boolean`

`true` when the clone is visible.

##### lite

###### Get Signature

> **get** **lite**(): `object`

The Babylon Lite mesh this renderer draws. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

`object`

The clone, or `null` when there is nothing to draw.

###### mesh

> `readonly` **mesh**: `SceneNode` \| `null`

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### onAttach()

> **onAttach**(): `void`

Nothing to do at attach: the clone is built on the first sync, once `mesh` has been decoded.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onAttach`](#onattach-1)

##### onDetach()

> **onDetach**(): `void`

Removes the clone from the scene, releasing its share of the template's buffers.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onDetach`](#ondetach-1)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

***

### Model

One instance of a loaded model (`docs/architecture/07-rendering.md` §2.4).

#### Example

```ts
const hero = await app.assets.loadAsync<ModelAsset>("models/hero.glb");
const entity = world.createEntity("Hero");
const model = entity.addComponent(Model, { model: hero.retain() });
model.attachToNode("hand.R", sword);
```

#### Extends

- [`Component`](#abstract-component)

#### Implements

- [`ComponentHooks`](#componenthooks)

#### Constructors

##### Constructor

> **new Model**(): [`Model`](#model)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`Model`](#model)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

One model per entity: a second instance under the same transform wants its own entity.

##### castShadows

> **castShadows**: `boolean`

##### materialOverrides

> **materialOverrides**: `Record`\<`string`, [`AssetHandle`](#assethandle)\<[`MaterialAsset`](#materialasset)\> \| `null`\>

##### model

> **model**: [`AssetHandle`](#assethandle)\<[`ModelAsset`](#modelasset)\> \| `null`

##### pickable

> **pickable**: `boolean`

##### receiveShadows

> **receiveShadows**: `boolean`

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### typeId

> `static` **typeId**: `string`

The namespaced registration id.

#### Accessors

##### animations

###### Get Signature

> **get** **animations**(): readonly `AnimationGroup`[]

**`Beta`**

The clips the file declared.

###### Remarks

Unstable: these are Lite's own animation groups, and ignifx does not advance them in Phase 2
(ADR-0003 — `@ignifx/3d`'s animator owns playback).

###### Returns

readonly `AnimationGroup`[]

The clips, in load order.

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### lite

###### Get Signature

> **get** **lite**(): `object`

The Babylon Lite objects this instance owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

`object`

The cloned root, or `null` when there is nothing instantiated.

###### root

> `readonly` **root**: `SceneNode` \| `null`

##### nodes

###### Get Signature

> **get** **nodes**(): `ReadonlyMap`\<`string`, `SceneNode`\>

The glTF nodes of this instance, by their names in the file.

###### Remarks

The map is the instance's own, so two `Model`s of one asset never hand out each other's nodes.
It is empty until the asset is loaded, and under a headless app.

###### Returns

`ReadonlyMap`\<`string`, `SceneNode`\>

The nodes, keyed by glTF node name.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### skeletons

###### Get Signature

> **get** **skeletons**(): readonly `Skeleton`[]

**`Beta`**

The skeletons the file declared. Empty unless the `boneControl` rendering feature was on before
the asset loaded.

###### Returns

readonly `Skeleton`[]

The skeletons.

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### attachToNode()

> **attachToNode**(`nodeName`, `entity`): `boolean`

Parents an entity under one of the model's glTF nodes — the "weapon in hand" case
(`docs/architecture/07-rendering.md` §2.4).

###### Parameters

###### nodeName

`string`

The glTF node name, as the file spells it.

###### entity

[`Entity`](#entity-4)

The entity to attach.

###### Returns

`boolean`

`true` when the node exists and the entity was attached.

###### Remarks

The entity keeps its **local** transform, so it lands at the node's origin and then follows it
for free: Lite composes `parentWorld × local` on every read, so a bone attachment costs no
per-frame work at all. Detach by re-parenting the entity in the ordinary way.

###### Example

```ts
model.attachToNode("hand.R", sword);
```

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### onAttach()

> **onAttach**(): `void`

Nothing to do at attach: the instance is built on the first sync, once `model` is decoded.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onAttach`](#onattach-1)

##### onDetach()

> **onDetach**(): `void`

Removes the instance from the scene and gives back its share of the template's buffers.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onDetach`](#ondetach-1)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

***

### ModelAsset

A loaded glTF or GLB file (`docs/architecture/05-assets-and-loading.md` §5).

#### Example

```ts
const hero = await app.assets.loadAsync<ModelAsset>("models/hero.glb");
hero.value.animations.map((clip) => clip.name);
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the model was loaded from.

##### animations

> `readonly` **animations**: readonly `AnimationGroup`[]

**`Beta`**

The clips the file declared, stripped from the container so Lite never ticks them.

###### Remarks

Unstable: these are Lite's own animation groups, handed on to `@ignifx/3d`'s animator, and they
are excluded from the stability guarantees of `CONSTITUTION.md` Article IV. A `Model` re-binds
them per instance when the animation system lands; in Phase 2 they are read-only metadata.

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers models under.

##### skeletons

> `readonly` **skeletons**: readonly `Skeleton`[]

**`Beta`**

The skeletons the file declared. Empty unless the `boneControl` rendering feature was on before
the load, because Lite builds them only then (`index.d.ts` 653).

#### Accessors

##### instanceCount

###### Get Signature

> **get** **instanceCount**(): `number`

How many `Model` components currently hold a copy of this template.

###### Returns

`number`

The live instance count.

##### lite

###### Get Signature

> **get** **lite**(): [`ModelAssetLiteHandles`](#modelassetlitehandles)

The Babylon Lite objects the asset owns. Unstable escape hatch.

###### Returns

[`ModelAssetLiteHandles`](#modelassetlitehandles)

The template container, or `null` under a headless app.

#### Methods

##### \[dispose\]()

> **\[dispose\]**(): `void`

Releases the template when the asset leaves a `using` block.

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Releases the template's GPU resources.

###### Returns

`void`

###### Remarks

The container was never added to a scene, so the round trip `removeFromScene` needs is the same
one `MeshAsset.dispose` performs: this hands it to the scene and takes it straight back out,
which drops its share of every buffer. Clones still in a scene keep theirs. Calling it twice is
a no-op, and it is a no-op under a headless app.

##### instantiate()

> **instantiate**(`parent`): [`ModelInstantiation`](#modelinstantiation) \| `null`

Clones the template under an entity's node.

###### Parameters

###### parent

`SceneNode` \| `null`

The entity's transform node, or `null` for world space.

###### Returns

[`ModelInstantiation`](#modelinstantiation) \| `null`

The cloned root and its named nodes, or `null` when there is nothing to clone — a
headless app, or a file that declared only lights.

##### releaseInstance()

> **releaseInstance**(): `void`

Records that one fewer `Model` holds a copy. Releasing below zero is a no-op.

###### Returns

`void`

##### retainInstance()

> **retainInstance**(): `void`

Records that one more `Model` holds a copy.

###### Returns

`void`

***

### MusicPlayer

A music track player with a playlist and crossfading.

#### Example

```ts
const jukebox = world.createEntity("Music");
const music = jukebox.addComponent(MusicPlayer, { autoAdvance: true, crossfadeSeconds: 3 });
music.play(menuTheme.value, { fadeIn: 1.5 });
// …later…
music.crossfadeTo(battleTheme.value, 2);
```

#### Extends

- [`Script`](#abstract-script)

#### Implements

- [`ScriptCallbacks`](#scriptcallbacks)

#### Constructors

##### Constructor

> **new MusicPlayer**(): [`MusicPlayer`](#musicplayer)

Applies the schema defaults, exactly as `Script.define` would.

###### Returns

[`MusicPlayer`](#musicplayer)

###### Overrides

[`Script`](#abstract-script).[`constructor`](#constructor-37)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

One music player per entity.

##### autoAdvance

> **autoAdvance**: `boolean`

Whether a track that ends crossfades into the next one.

##### bus

> **bus**: `string`

Which mixer bus the music routes into.

##### crossfadeSeconds

> **crossfadeSeconds**: `number`

How long a crossfade takes, in seconds.

##### loopPlaylist

> **loopPlaylist**: `boolean`

Whether the playlist wraps after its last entry.

##### loopTrack

> **loopTrack**: `boolean`

Whether the current track repeats instead of ending.

##### playlist

> **playlist**: ([`AssetHandle`](#assethandle)\<[`AudioClip`](#audioclip)\> \| `null`)[]

The tracks, in the order they are played.

##### playOnAwake

> **playOnAwake**: `boolean`

Whether to start the first playlist entry as soon as the entity is alive.

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### typeId

> `static` **typeId**: `string`

The registration id the serializer and the inspector know this class by.

##### volume

> **volume**: `number`

The gain a track fades up to, in `[0, 1]`.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Script`](#abstract-script).[`app`](#app-16)

##### current

###### Get Signature

> **get** **current**(): [`SoundInstance`](#soundinstance) \| `null`

The track that is playing.

###### Returns

[`SoundInstance`](#soundinstance) \| `null`

The sound, or `null` when nothing is playing.

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`enabled`](#enabled-18)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Script`](#abstract-script).[`entity`](#entity-15)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Script`](#abstract-script).[`handle`](#handle-12)

##### index

###### Get Signature

> **get** **index**(): `number`

Which entry of `playlist` is playing.

###### Returns

`number`

The index, or `-1` when the current track did not come from the playlist.

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Script`](#abstract-script).[`isDestroyed`](#isdestroyed-12)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Script`](#abstract-script).[`isEnabledInHierarchy`](#isenabledinhierarchy-11)

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

Whether music is sounding.

###### Returns

`boolean`

`true` while a track is playing or waiting behind the unlock.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Script`](#abstract-script).[`onDestroyed`](#ondestroyed-12)

##### previous

###### Get Signature

> **get** **previous**(): [`SoundInstance`](#soundinstance) \| `null`

The track that is fading out, while a crossfade is in progress.

###### Returns

[`SoundInstance`](#soundinstance) \| `null`

The outgoing sound, or `null`.

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Script`](#abstract-script).[`transform`](#transform-13)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Script`](#abstract-script).[`uid`](#uid-16)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Script`](#abstract-script).[`world`](#world-13)

#### Methods

##### awake()

> **awake**(): `void`

Starts the first playlist entry when `playOnAwake` is set.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`awake`](#awake-3)

##### crossfadeTo()

> **crossfadeTo**(`clip`, `seconds?`): [`SoundInstance`](#soundinstance)

Fades the current track out while fading a new one in.

###### Parameters

###### clip

[`AudioClip`](#audioclip)

The track to fade in.

###### seconds?

`number`

How long both fades take; defaults to `crossfadeSeconds`.

###### Returns

[`SoundInstance`](#soundinstance)

The incoming sound.

###### Example

```ts
music.crossfadeTo(battleTheme.value, 3);
```

##### define()

> `static` **define**\<`S`\>(`schema`): [`ScriptDefinition`](#scriptdefinition)\<`S`\>

Declares a script's serialized fields and returns the base class to extend — the `Script`
counterpart of `Component.define`.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ScriptDefinition`](#scriptdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Patrol extends Script.define({ waypoints: array(vec3()), speed: f32(3) }) {
  static typeId = "mygame/Patrol";
}
```

###### Inherited from

[`Script`](#abstract-script).[`define`](#define-11)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`destroy`](#destroy-12)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Script`](#abstract-script).[`getComponent`](#getcomponent-12)

##### next()

> **next**(): [`SoundInstance`](#soundinstance) \| `null`

Crossfades to the next playlist entry, wrapping when `loopPlaylist` is set.

###### Returns

[`SoundInstance`](#soundinstance) \| `null`

The incoming sound, or `null` when the playlist has nothing left to play.

##### onDestroy()

> **onDestroy**(): `void`

Stops the music and releases both voices.

###### Returns

`void`

###### Implementation of

[`ScriptCallbacks`](#scriptcallbacks).[`onDestroy`](#ondestroy-3)

##### play()

> **play**(`clip`, `options?`): [`SoundInstance`](#soundinstance)

Plays a track, replacing whatever was playing.

###### Parameters

###### clip

[`AudioClip`](#audioclip)

The track.

###### options?

[`MusicPlayOptions`](#musicplayoptions)

How long to fade the new track up over.

###### Returns

[`SoundInstance`](#soundinstance)

The sound.

###### Example

```ts
music.play(theme.value, { fadeIn: 2 });
```

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Script`](#abstract-script).[`requireComponent`](#requirecomponent-12)

##### startCoroutine()

> **startCoroutine**(`routine`): [`CoroutineHandle`](#coroutinehandle)

Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
coroutine is paused while the script is not effectively enabled and cancelled when it is
destroyed.

###### Parameters

###### routine

[`Coroutine`](#coroutine)

The generator to drive. Call the generator function: `this.spawnLoop()`.

###### Returns

[`CoroutineHandle`](#coroutinehandle)

A handle for stopping it or waiting on it.

###### Example

```ts
blink() {
  while (true) {
    this.renderer.enabled = !this.renderer.enabled;
    yield waitSeconds(0.2);
  }
}
onEnable(): void {
  this.startCoroutine(this.blink());
}
```

###### Inherited from

[`Script`](#abstract-script).[`startCoroutine`](#startcoroutine-3)

##### stop()

> **stop**(`options?`): `void`

Stops the music.

###### Parameters

###### options?

[`MusicStopOptions`](#musicstopoptions)

How long to fade out over; omitted stops now.

###### Returns

`void`

##### stopAllCoroutines()

> **stopAllCoroutines**(): `void`

Stops every coroutine this script started.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`stopAllCoroutines`](#stopallcoroutines-3)

##### stopCoroutine()

> **stopCoroutine**(`handle`): `void`

Stops one coroutine this script started. Stopping a finished coroutine is a no-op.

###### Parameters

###### handle

[`CoroutineHandle`](#coroutinehandle)

The handle [Script.startCoroutine](#startcoroutine-3) returned.

###### Returns

`void`

###### Inherited from

[`Script`](#abstract-script).[`stopCoroutine`](#stopcoroutine-3)

***

### PlayerInput

Binds an entity to an action document and one device slot.

#### Remarks

The schema field `actions` holds the *asset*; the resolved lookup is `playerInput.input`, which
is the same [InputActionsView](#inputactionsview) `app.input.actions` exposes. `08-input.md` §7 spells the
lookup `player.input.actions`; the two cannot both be called `actions` on one class, and the
serialized field is the one whose name the file format fixes.

#### Example

```ts
const player = entity.addComponent(PlayerInput, { actions: handle, deviceSlot: 1 });
player.input?.get("move").vector.x;
```

#### Extends

- [`Component`](#abstract-component)

#### Implements

- [`ComponentHooks`](#componenthooks)

#### Constructors

##### Constructor

> **new PlayerInput**(): [`PlayerInput`](#playerinput)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`PlayerInput`](#playerinput)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### actions

> **actions**: [`AssetHandle`](#assethandle)\<[`InputActionsAsset`](#inputactionsasset)\> \| `null`

The `ignifx.inputactions` document this player's private maps are built from.

##### allowMultiple

> `static` **allowMultiple**: `boolean`

One player owns one entity.

##### deviceSlot

> **deviceSlot**: `number`

Which gamepad slot the player's `<Gamepad>/…` bindings are pinned to.

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### scheme

> **scheme**: `string`

The control scheme to keep; `""` keeps every binding whatever its tag.

##### typeId

> `static` **typeId**: `string`

The namespaced registration id.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### input

###### Get Signature

> **get** **input**(): [`InputActionsView`](#inputactionsview) \| `null`

The player's private action lookup.

###### Returns

[`InputActionsView`](#inputactionsview) \| `null`

The view over the private maps, or `null` until the document is available.

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### onAttach()

> **onAttach**(): `void`

Builds the private maps as soon as the component's fields are assigned.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onAttach`](#onattach-1)

##### onDetach()

> **onDetach**(): `void`

Stops the private maps resolving.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onDetach`](#ondetach-1)

##### rebuild()

> **rebuild**(): `boolean`

Rebuilds the private maps from the current `actions`, `deviceSlot`, and `scheme` fields. Call
it after changing any of them; `onAttach` calls it once for you.

###### Returns

`boolean`

`true` when a set was built, `false` when the document or the service is absent.

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

***

### PointerLock

The pointer-lock controller, reached as `app.input.pointerLock`.

#### Example

```ts
canvas.addEventListener("click", () => {
  void app.input.pointerLock.request();
});
app.input.pointerLock.onChange.connect((locked) => hud.setCrosshair(locked));
```

#### Constructors

##### Constructor

> **new PointerLock**(): [`PointerLock`](#pointerlock-3)

###### Returns

[`PointerLock`](#pointerlock-3)

#### Accessors

##### locked

###### Get Signature

> **get** **locked**(): `boolean`

Whether the canvas currently holds the pointer.

###### Returns

`boolean`

`true` while `document.pointerLockElement` is this app's canvas.

##### onChange

###### Get Signature

> **get** **onChange**(): [`SignalLike`](#signallike)\<`boolean`\>

Emitted whenever the lock is taken or released, with the new state.

###### Returns

[`SignalLike`](#signallike)\<`boolean`\>

The signal.

#### Methods

##### exit()

> **exit**(): `void`

Releases the lock, if this app holds it.

###### Returns

`void`

##### request()

> **request**(): `Promise`\<`boolean`\>

Requests the lock. Must be called from inside a user gesture.

###### Returns

`Promise`\<`boolean`\>

`true` once the lock is held, `false` when the browser refused it.

###### Throws

IgnifxError with code `IGX-0809` when the app has no DOM canvas to lock.

***

### PostProcessStack

One instance of a post-process chain, attached to the main camera's entity
(`docs/architecture/07-rendering.md` §2.7).

#### Example

```ts
cameraEntity.addComponent(PostProcessStack, {
  bloom: { enabled: true, threshold: 0.85, weight: 0.4 },
  smaa: { enabled: true },
});
```

#### Extends

- [`Component`](#abstract-component)

#### Implements

- [`ComponentHooks`](#componenthooks)

#### Constructors

##### Constructor

> **new PostProcessStack**(): [`PostProcessStack`](#postprocessstack)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`PostProcessStack`](#postprocessstack)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

One chain per camera entity; a second would fight the first for the swapchain.

##### bloom

> **bloom**: [`BloomEffectSettings`](#bloomeffectsettings)

##### imageProcessing

> **imageProcessing**: [`ImageProcessingEffectSettings`](#imageprocessingeffectsettings)

##### schema

> `static` **schema**: [`Schema`](#schema-14)

The serialized field declarations (ADR-0004).

##### smaa

> **smaa**: [`SmaaEffectSettings`](#smaaeffectsettings)

##### typeId

> `static` **typeId**: `string`

The namespaced registration id.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### taskCount

###### Get Signature

> **get** **taskCount**(): `number`

How many frame-graph tasks the stack has recorded.

###### Returns

`number`

The task count; `0` before the chain is built, under a headless app, and when the
`postProcessing` rendering feature is off.

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### onAttach()

> **onAttach**(): `void`

Nothing to do at attach: the chain is built on the first sync that wants an effect.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onAttach`](#onattach-1)

##### onDetach()

> **onDetach**(): `void`

Disables and disposes every task the stack recorded.

###### Returns

`void`

###### Implementation of

[`ComponentHooks`](#componenthooks).[`onDetach`](#ondetach-1)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

***

### Quat

A rotation, stored as a unit quaternion. Quaternions are how ignifx stores every rotation:
they interpolate smoothly, never gimbal-lock, and compose without matrix round-trips. Euler
angles exist only at the edges of the API, always in **degrees** (ADR-0011, coding standards
section 5.1).

Conventions, all verified against Babylon Lite 1.27.0's implementation so a `Quat` and a Lite
quaternion mean the same rotation:

- Euler order is **intrinsic XYZ** (`lib/math/quat-euler.js`), the inverse of Lite's
  `quatToEulerXYZ`.
- `a * b` is the Hamilton product: applied to a vector it performs `b` first, then `a`, matching
  the matrix product `Ma * Mb`.
- The space is left-handed with Y up and +Z forward, so rotating `(1, 0, 0)` by 90 degrees about
  +Y gives `(0, 0, -1)`, and [Quat.lookRotation](#lookrotation) maps +Z onto `forward`.

Instance methods mutate the receiver and return `this`; `ToRef` statics write into a final `out`
argument and allocate nothing; the remaining statics allocate and say so.

#### Example

```ts
// face the movement direction, then blend into it over time
const target = Quat.lookRotation(velocity);
Quat.slerpToRef(transform.localRotation, target, 0.2, transform.localRotation);
```

#### Constructors

##### Constructor

> **new Quat**(`x?`, `y?`, `z?`, `w?`): [`Quat`](#quat-4)

Creates a quaternion. The defaults are the identity rotation.

###### Parameters

###### x?

`number`

The imaginary X component. Defaults to 0.

###### y?

`number`

The imaginary Y component. Defaults to 0.

###### z?

`number`

The imaginary Z component. Defaults to 0.

###### w?

`number`

The real component. Defaults to 1.

###### Returns

[`Quat`](#quat-4)

#### Properties

##### w

> **w**: `number`

The real (scalar) component.

##### x

> **x**: `number`

The imaginary X component.

##### y

> **y**: `number`

The imaginary Y component.

##### z

> **z**: `number`

The imaginary Z component.

#### Methods

##### angleDegrees()

> `static` **angleDegrees**(`a`, `b`): `number`

The angle between two rotations, in degrees, along the shortest arc.

###### Parameters

###### a

[`QuatLike`](#quatlike)

The first rotation; assumed to be a unit quaternion.

###### b

[`QuatLike`](#quatlike)

The second rotation; assumed to be a unit quaternion.

###### Returns

`number`

The angle in `[0, 180]` degrees.

##### clone()

> **clone**(): [`Quat`](#quat-4)

Copies this quaternion into a new one.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

##### conjugate()

> **conjugate**(): `this`

Conjugates this quaternion, negating its imaginary part. For a unit quaternion this is the
inverse rotation.

###### Returns

`this`

This quaternion.

##### conjugateToRef()

> `static` **conjugateToRef**\<`TOut`\>(`q`, `out`): `TOut`

Writes the conjugate of `q` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation to conjugate.

###### out

`TOut`

The quaternion to write; may alias `q`.

###### Returns

`TOut`

`out`.

##### copyFrom()

> **copyFrom**(`q`): `this`

Copies every component from another quaternion.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The quaternion to read.

###### Returns

`this`

This quaternion.

##### dot()

> `static` **dot**(`a`, `b`): `number`

The dot product of two rotations.

###### Parameters

###### a

[`QuatLike`](#quatlike)

The first rotation.

###### b

[`QuatLike`](#quatlike)

The second rotation.

###### Returns

`number`

The dot product.

##### dot()

> **dot**(`q`): `number`

The dot product of this quaternion with another. Its magnitude is the cosine of half the angle
between the two rotations.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The other rotation.

###### Returns

`number`

The dot product.

##### equalsWithEpsilon()

> `static` **equalsWithEpsilon**(`a`, `b`, `epsilon?`): `boolean`

Compares two quaternions component by component, with a tolerance. Note that `q` and `-q` are
the same rotation but are **not** equal by this test; compare with [Quat.angleDegrees](#angledegrees)
when that matters.

###### Parameters

###### a

[`QuatLike`](#quatlike)

The first quaternion.

###### b

[`QuatLike`](#quatlike)

The second quaternion.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### equalsWithEpsilon()

> **equalsWithEpsilon**(`q`, `epsilon?`): `boolean`

Compares this quaternion with another, component by component, with a tolerance. Note that `q`
and `-q` are the same rotation but are **not** equal by this test.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The quaternion to compare against.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### from()

> `static` **from**(`q`): [`Quat`](#quat-4)

Copies any quaternion-shaped value into a `Quat`.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The quaternion to copy.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

##### fromAxisAngle()

> `static` **fromAxisAngle**(`axis`, `degrees`): [`Quat`](#quat-4)

Builds a rotation of `degrees` about an axis.

###### Parameters

###### axis

[`Vec3Like`](#vec3like)

The axis to turn about; normalized internally.

###### degrees

`number`

The angle, in degrees.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

##### fromAxisAngleToRef()

> `static` **fromAxisAngleToRef**\<`TOut`\>(`axis`, `degrees`, `out`): `TOut`

Writes a rotation of `degrees` about an axis into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### axis

[`Vec3Like`](#vec3like)

The axis to turn about; normalized internally. A zero-length axis writes the
identity rotation.

###### degrees

`number`

The angle, in degrees.

###### out

`TOut`

The quaternion to write.

###### Returns

`TOut`

`out`.

##### fromEulerDegrees()

> `static` **fromEulerDegrees**(`xDegrees`, `yDegrees`, `zDegrees`): [`Quat`](#quat-4)

Builds a rotation from Euler angles in degrees, in intrinsic XYZ order.

###### Parameters

###### xDegrees

`number`

Rotation about X (pitch), in degrees.

###### yDegrees

`number`

Rotation about Y (yaw), in degrees.

###### zDegrees

`number`

Rotation about Z (roll), in degrees.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

###### Example

```ts
transform.localRotation.copyFrom(Quat.fromEulerDegrees(0, 90, 0)); // face +X
```

##### fromEulerDegreesToRef()

> `static` **fromEulerDegreesToRef**\<`TOut`\>(`xDegrees`, `yDegrees`, `zDegrees`, `out`): `TOut`

Writes a rotation built from Euler degrees into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### xDegrees

`number`

Rotation about X (pitch), in degrees.

###### yDegrees

`number`

Rotation about Y (yaw), in degrees.

###### zDegrees

`number`

Rotation about Z (roll), in degrees.

###### out

`TOut`

The quaternion to write.

###### Returns

`TOut`

`out`.

##### fromEulerRadians()

> `static` **fromEulerRadians**(`xRadians`, `yRadians`, `zRadians`): [`Quat`](#quat-4)

Builds a rotation from Euler angles in radians, in intrinsic XYZ order.

###### Parameters

###### xRadians

`number`

Rotation about X, in radians.

###### yRadians

`number`

Rotation about Y, in radians.

###### zRadians

`number`

Rotation about Z, in radians.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

##### fromEulerRadiansToRef()

> `static` **fromEulerRadiansToRef**\<`TOut`\>(`xRadians`, `yRadians`, `zRadians`, `out`): `TOut`

Writes a rotation built from Euler radians into `out`. This is Babylon Lite's `eulerToQuat`
(`lib/math/quat-euler.js`) element for element, so a rotation built here means the same thing
to Lite's node hierarchy.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### xRadians

`number`

Rotation about X, in radians.

###### yRadians

`number`

Rotation about Y, in radians.

###### zRadians

`number`

Rotation about Z, in radians.

###### out

`TOut`

The quaternion to write.

###### Returns

`TOut`

`out`.

##### fromRotationMatrix()

> `static` **fromRotationMatrix**(`m`): [`Quat`](#quat-4)

Reads the rotation out of a transformation matrix.

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to read; scale is divided out first.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

##### fromRotationMatrixToRef()

> `static` **fromRotationMatrixToRef**\<`TOut`\>(`m`, `out`): `TOut`

Writes the rotation of a transformation matrix into `out`, dividing out the scale exactly as
[Mat4.decomposeToRef](#decomposetoref) does.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### m

[`Mat4Like`](#mat4like)

The matrix to read.

###### out

`TOut`

The quaternion to write. Left untouched when a basis column has zero length.

###### Returns

`TOut`

`out`.

##### identity()

> `static` **identity**(): [`Quat`](#quat-4)

The identity rotation.

###### Returns

[`Quat`](#quat-4)

A new `(0, 0, 0, 1)`. **Allocates**; see [QUAT\_IDENTITY](#quat_identity).

##### identity()

> **identity**(): `this`

Resets this quaternion to the identity rotation.

###### Returns

`this`

This quaternion.

##### invert()

> **invert**(): `this`

Inverts this rotation. Unlike [Quat.conjugate](#conjugate) this also divides by the squared length, so
it is correct for quaternions that have drifted from unit length.

###### Returns

`this`

This quaternion.

##### invertToRef()

> `static` **invertToRef**\<`TOut`\>(`q`, `out`): `TOut`

Writes the inverse of `q` into `out`, dividing the conjugate by the squared length.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation to invert.

###### out

`TOut`

The quaternion to write; may alias `q`. A zero-length input writes the identity.

###### Returns

`TOut`

`out`.

##### length()

> **length**(): `number`

The length of this quaternion; 1 for a well-formed rotation.

###### Returns

`number`

The length.

##### lengthSquared()

> **lengthSquared**(): `number`

The squared length of this quaternion.

###### Returns

`number`

The squared length.

##### lookRotation()

> `static` **lookRotation**(`forward`, `up?`): [`Quat`](#quat-4)

Builds the rotation that points local +Z along `forward` and local +Y as close to `up` as it
can (left-handed, ADR-0011).

###### Parameters

###### forward

[`Vec3Like`](#vec3like)

The direction to face; normalized internally.

###### up?

[`Vec3Like`](#vec3like)

The reference up direction. Defaults to world up, `(0, 1, 0)`.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

##### lookRotationToRef()

> `static` **lookRotationToRef**\<`TOut`\>(`forward`, `up`, `out`): `TOut`

Writes the rotation that points local +Z along `forward` into `out`. The basis is built the way
Babylon Lite builds it in `quatFromLookDirectionRH` (`lib/math/quat-from-look-direction-rh.js`):
`right = up x forward`, `up' = forward x right`, columns `(right, up', forward)` — which in
ignifx's left-handed space is exactly the Unity-style look rotation, whatever the Lite function
is named.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### forward

[`Vec3Like`](#vec3like)

The direction to face; normalized internally.

###### up

[`Vec3Like`](#vec3like)

The reference up direction; normalized internally.

###### out

`TOut`

The quaternion to write. Degenerate input (a zero-length `forward`, or an `up`
parallel to it) writes the identity rotation, where Lite would produce a meaningless basis.

###### Returns

`TOut`

`out`.

##### multiply()

> `static` **multiply**(`a`, `b`): [`Quat`](#quat-4)

Composes two rotations.

###### Parameters

###### a

[`QuatLike`](#quatlike)

The rotation applied second.

###### b

[`QuatLike`](#quatlike)

The rotation applied first.

###### Returns

[`Quat`](#quat-4)

A new quaternion holding `a * b`. **Allocates.**

##### multiply()

> **multiply**(`q`): `this`

Post-multiplies this rotation by another (`this = this * q`): applied to a vector, `q` happens
first.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The right-hand rotation.

###### Returns

`this`

This quaternion.

##### multiplyToRef()

> `static` **multiplyToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes the Hamilton product `a * b` into `out`. Applied to a vector, `b` is performed first.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### a

[`QuatLike`](#quatlike)

The left-hand rotation.

###### b

[`QuatLike`](#quatlike)

The right-hand rotation.

###### out

`TOut`

The quaternion to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### normalize()

> **normalize**(): `this`

Scales this quaternion to unit length. Compositions drift over time, so normalize rotations you
keep integrating. A zero-length quaternion becomes the identity rather than `NaN`.

###### Returns

`this`

This quaternion.

##### normalizeToRef()

> `static` **normalizeToRef**\<`TOut`\>(`q`, `out`): `TOut`

Writes a unit-length copy of `q` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation to normalize.

###### out

`TOut`

The quaternion to write; may alias `q`. A zero-length input writes the identity.

###### Returns

`TOut`

`out`.

##### rotateVectorToRef()

> `static` **rotateVectorToRef**\<`TOut`\>(`q`, `v`, `out`): `TOut`

Rotates a vector by a quaternion, writing the result into `out`. This is the allocation-free
way to turn a local direction into a world direction.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation; assumed to be a unit quaternion.

###### v

[`Vec3Like`](#vec3like)

The vector to rotate.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

###### Example

```ts
// world-space forward of an entity
Quat.rotateVectorToRef(transform.localRotation, VEC3_FORWARD, forward);
```

##### set()

> **set**(`x`, `y`, `z`, `w`): `this`

Assigns every component at once.

###### Parameters

###### x

`number`

The new imaginary X component.

###### y

`number`

The new imaginary Y component.

###### z

`number`

The new imaginary Z component.

###### w

`number`

The new real component.

###### Returns

`this`

This quaternion.

##### slerp()

> `static` **slerp**(`a`, `b`, `t`): [`Quat`](#quat-4)

Interpolates between two rotations along the shortest arc, at a constant angular rate.

###### Parameters

###### a

[`QuatLike`](#quatlike)

The rotation returned at `t === 0`.

###### b

[`QuatLike`](#quatlike)

The rotation returned at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

[`Quat`](#quat-4)

A new quaternion. **Allocates.**

##### slerpToRef()

> `static` **slerpToRef**\<`TOut`\>(`a`, `b`, `t`, `out`): `TOut`

Writes the spherical interpolation of `a` and `b` into `out`, taking the shortest arc: when the
two rotations point away from each other one is negated first, which is the same rotation. Very
close rotations fall back to a normalized linear blend, where slerp is numerically unstable.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### a

[`QuatLike`](#quatlike)

The rotation written at `t === 0`.

###### b

[`QuatLike`](#quatlike)

The rotation written at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### out

`TOut`

The quaternion to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### toArray()

> **toArray**(`out`, `offset?`): `Float32Array`

Writes this quaternion into a `Float32Array`, for GPU upload. The output comes first to mirror
Babylon Lite's `ObservableQuat.toArray`.

###### Parameters

###### out

`Float32Array`

The array to write into.

###### offset?

`number`

The index of the X component. Defaults to 0.

###### Returns

`Float32Array`

`out`.

##### toEulerDegreesToRef()

> `static` **toEulerDegreesToRef**\<`TOut`\>(`q`, `out`): `TOut`

Writes a rotation's Euler angles in degrees into `out`, in intrinsic XYZ order — the inverse of
[Quat.fromEulerDegreesToRef](#fromeulerdegreestoref).

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation to convert; assumed to be a unit quaternion.

###### out

`TOut`

The vector to write; `x` is pitch, `y` is yaw, `z` is roll, all in degrees.

###### Returns

`TOut`

`out`.

##### toEulerRadiansToRef()

> `static` **toEulerRadiansToRef**\<`TOut`\>(`q`, `out`): `TOut`

Writes a rotation's Euler angles in radians into `out`, in intrinsic XYZ order. This is Babylon
Lite's `quatToEulerXYZ` (`lib/math/quat-euler.js`) line for line, including its behaviour near
the poles: at a Y rotation of plus or minus 90 degrees the X and Z angles are not separable and
the result is one of the infinitely many valid answers.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### q

[`QuatLike`](#quatlike)

The rotation to convert; assumed to be a unit quaternion.

###### out

`TOut`

The vector to write, in radians.

###### Returns

`TOut`

`out`.

***

### SceneInstance

One loaded scene file, or the implicit default scene
(`docs/architecture/02-scene-graph.md` §3). An entity belongs to exactly one instance: the scene
it was loaded from, or the world's active scene when it was created in code.

#### Remarks

The implicit `"default"` instance every app starts with has no asset and is always loaded.
An instance created by `world.loadScene` carries the handle it was built from and reports
`isLoaded === false` only while its entities are being constructed — a window no game code can
observe, because construction is one synchronous block (`docs/architecture/02-scene-graph.md` §2).

#### Example

```ts
world.activeScene.persistent = true; // survives a "single" load, like DontDestroyOnLoad
```

#### Properties

##### name

> `readonly` **name**: `string`

The instance's name; the file's name, or `"default"` for the implicit scene.

##### persistent

> **persistent**: `boolean`

Whether the instance survives a `"single"` scene load — Unity's `DontDestroyOnLoad`, at scene
granularity rather than per object.

##### uid

> `readonly` **uid**: `string`

The instance id, distinct from the address of the asset it was loaded from.

#### Accessors

##### asset

###### Get Signature

> **get** **asset**(): [`AssetHandle`](#assethandle)\<[`SceneAsset`](#sceneasset)\> \| `null`

The asset this instance was loaded from.

###### Returns

[`AssetHandle`](#assethandle)\<[`SceneAsset`](#sceneasset)\> \| `null`

The handle `world.loadScene` retained on the instance's behalf, or `null` for the
implicit default scene and for instances created in code.

##### isLoaded

###### Get Signature

> **get** **isLoaded**(): `boolean`

Whether every entity of the instance has been constructed and its references resolved.

###### Returns

`boolean`

`true` once construction has finished; `false` only during it.

##### onUnloading

###### Get Signature

> **get** **onUnloading**(): [`Signal`](#signal-3)

Emitted just before the instance is unloaded, while its entities are still valid.

###### Returns

[`Signal`](#signal-3)

The signal.

##### remap

###### Get Signature

> **get** **remap**(): [`UidRemap`](#uidremap) \| `null`

The file-local uid to runtime object table of this instance
(`docs/architecture/02-scene-graph.md` §10). Two instances of one scene have two tables, which
is what keeps their `$entity`/`$component` references apart.

###### Returns

[`UidRemap`](#uidremap) \| `null`

The table, or `null` for an instance that was not built from a file.

##### roots

###### Get Signature

> **get** **roots**(): readonly [`Entity`](#entity-4)[]

The instance's root entities — the ones with no parent — in creation order.

###### Returns

readonly [`Entity`](#entity-4)[]

The live root list. Its identity is stable for the instance's lifetime.

##### settings

###### Get Signature

> **get** **settings**(): [`JsonObject`](#jsonobject) \| `null`

The scene-level values the file carried — environment, clear colour, 2D mode flags, physics
overrides (`docs/architecture/06-serialization-and-scene-format.md` §2). The core keeps them as
plain JSON; the systems that understand a key read it from here.

###### Returns

[`JsonObject`](#jsonobject) \| `null`

The block, or `null` for an instance that was not built from a file.

***

### `abstract` Script

A component that receives the engine lifecycle (`docs/architecture/03-scripting-and-components.md`
§2). This is the Unity `MonoBehaviour` role and the primary way game code is written.

#### Remarks

**Where the callbacks are declared.** `awake`, `update`, `onCollisionEnter` and the rest are
not* members of this class. Declaring them here would make every implementation an override, and
`noImplicitOverride` (coding standards §3) would then demand an `override` modifier on every
`update` in every game — which the documented examples do not carry, and which would be a tax on
the most-written method in the engine. They live in [ScriptCallbacks](#scriptcallbacks) instead; write
`implements ScriptCallbacks` to have their signatures checked. The engine detects which callbacks
a class implements once, by inspecting the prototype at registration, so an empty `update() {}`
costs a call per frame and not defining it costs nothing.

**The statics work the same way.** `typeId`, `schema`, `requires`, `allowMultiple`,
`executionOrder`, and `updateWhenPaused` are not members of `Component` or `Script` either: a
static declared on the base class is an override too, so `static typeId = "mygame/Mover"` would
have needed an `override` modifier. Their shape lives on [ComponentStatics](#componentstatics) and
[ScriptStatics](#scriptstatics), which the class-token types intersect, so a plain `static` on a subclass
satisfies them structurally; `ComponentRegistry` reads each one once per class and applies the
defaults (`executionOrder` `0`, `updateWhenPaused` `false`).

#### Example

```ts
class Mover extends Script.define({ speed: f32(5) }) implements ScriptCallbacks {
  static typeId = "mygame/Mover";
  static executionOrder = -10;

  update(dt: number): void {
    this.transform.translate({ x: 0, y: 0, z: this.speed * dt });
  }
}
```

#### Extends

- [`Component`](#abstract-component)

#### Extended by

- [`AudioListener`](#audiolistener)
- [`AudioSource`](#audiosource)
- [`MusicPlayer`](#musicplayer)

#### Constructors

##### Constructor

> **new Script**(): [`Script`](#abstract-script)

Creates a component. The engine constructs components; game code never calls `new`.

###### Returns

[`Script`](#abstract-script)

###### Inherited from

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Returns

`boolean`

`true` when the component's own flag is set.

###### Set Signature

> **set** **enabled**(`value`): `void`

###### Parameters

###### value

`boolean`

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ScriptDefinition`](#scriptdefinition)\<`S`\>

Declares a script's serialized fields and returns the base class to extend — the `Script`
counterpart of `Component.define`.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ScriptDefinition`](#scriptdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Patrol extends Script.define({ waypoints: array(vec3()), speed: f32(3) }) {
  static typeId = "mygame/Patrol";
}
```

###### Overrides

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

##### startCoroutine()

> **startCoroutine**(`routine`): [`CoroutineHandle`](#coroutinehandle)

Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
coroutine is paused while the script is not effectively enabled and cancelled when it is
destroyed.

###### Parameters

###### routine

[`Coroutine`](#coroutine)

The generator to drive. Call the generator function: `this.spawnLoop()`.

###### Returns

[`CoroutineHandle`](#coroutinehandle)

A handle for stopping it or waiting on it.

###### Example

```ts
blink() {
  while (true) {
    this.renderer.enabled = !this.renderer.enabled;
    yield waitSeconds(0.2);
  }
}
onEnable(): void {
  this.startCoroutine(this.blink());
}
```

##### stopAllCoroutines()

> **stopAllCoroutines**(): `void`

Stops every coroutine this script started.

###### Returns

`void`

##### stopCoroutine()

> **stopCoroutine**(`handle`): `void`

Stops one coroutine this script started. Stopping a finished coroutine is a no-op.

###### Parameters

###### handle

[`CoroutineHandle`](#coroutinehandle)

The handle [Script.startCoroutine](#startcoroutine-3) returned.

###### Returns

`void`

***

### Signal

A typed, synchronous, many-listener event (`docs/architecture/02-scene-graph.md` §8). Signals are
the "signal up" half of the engine's *call down, signal up* convention: a parent calls methods on
the children it owns, a child announces what happened and lets interested parties subscribe.

#### Remarks

Delivery guarantees:

- Handlers run in connection order, synchronously, inside [Signal.emit](#emit).
- A handler connected *during* an emit runs on the next emit, never the one in flight.
- A handler disconnected during an emit never runs again, including in the emit in flight.
- One handler throwing does not stop delivery to the others.
- Nothing is allocated per emit on the non-deferred path (coding standards §7).

The payload type `T` defaults to `void`, so `signal.emit()` takes no argument.

#### Example

```ts
class Health extends Script {
  readonly onDied = new Signal<Entity>();
  damage(amount: number): void {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.onDied.emit(this.entity);
    }
  }
}

health.onDied.connect((entity) => this.spawnLoot(entity), { owner: this, once: true });
```

#### Type Parameters

##### T

`T` = `void`

#### Implements

- [`SignalLike`](#signallike)\<`T`\>

#### Constructors

##### Constructor

> **new Signal**\<`T`\>(`options?`): [`Signal`](#signal-3)\<`T`\>

Creates a signal.

###### Parameters

###### options?

[`SignalOptions`](#signaloptions)\<`T`\>

The deferred-delivery scheduler and the handler-error reporter. Both are
supplied by the app for engine signals; a signal a script owns usually needs neither.

###### Returns

[`Signal`](#signal-3)\<`T`\>

#### Accessors

##### connectionCount

###### Get Signature

> **get** **connectionCount**(): `number`

How many handlers are currently attached.

###### Returns

`number`

The live connection count.

How many handlers are currently attached.

###### Implementation of

[`SignalLike`](#signallike).[`connectionCount`](#connectioncount-1)

#### Methods

##### clear()

> **clear**(): `void`

Detaches every handler, including the auto-disconnect hooks held on owners.

###### Returns

`void`

##### connect()

> **connect**(`handler`, `options?`): [`Disconnect`](#disconnect)

Attaches a handler.

###### Parameters

###### handler

[`SignalHandler`](#signalhandler)\<`T`\>

The listener.

###### options?

[`ConnectOptions`](#connectoptions)

`once` to detach after the first delivery, `deferred` to queue delivery on the
signal's [DeferredQueue](#deferredqueue), and `owner` to detach when the owner is destroyed.

###### Returns

[`Disconnect`](#disconnect)

A function that detaches the handler; calling it twice is a no-op.

###### Throws

IgnifxError with code `IGX-0103` when `deferred` is requested and the signal was
constructed without a [DeferredQueue](#deferredqueue).

###### Example

```ts
const stop = app.events.onSceneLoaded.connect((scene) => this.spawn(scene), { owner: this });
stop();
```

###### Implementation of

[`SignalLike`](#signallike).[`connect`](#connect-1)

##### disconnect()

> **disconnect**(`handler`): `void`

Detaches the first connection made with this handler. Detaching a handler that is not connected
is a no-op.

###### Parameters

###### handler

[`SignalHandler`](#signalhandler)\<`T`\>

The listener to detach.

###### Returns

`void`

##### emit()

> **emit**(`value`): `void`

Delivers a value to every attached handler, in connection order.

###### Parameters

###### value

`T`

The payload. Omitted for `Signal<void>`.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0104` wrapping the first handler exception, when the signal
was constructed without an `onHandlerError` reporter.

***

### SoundVoice

The concrete class behind [SoundInstance](#soundinstance), as `app.audio.createVoice` returns it.

#### Remarks

Hold a [SoundInstance](#soundinstance) rather than this: the interface is the contract, and this class adds
only what the components that own a voice need — releasing it, re-panning it, and flushing the
plays it held while the engine was locked.

#### Implements

- [`SoundInstance`](#soundinstance)

#### Constructors

##### Constructor

> **new SoundVoice**(`host`, `clip`, `volume`): [`SoundVoice`](#soundvoice)

Creates a voice. The service does this; game code reaches one through `play()`.

###### Parameters

###### host

[`VoiceHost`](#voicehost)

The backend and the lock state.

###### clip

[`AudioClip`](#audioclip)

The clip to play.

###### volume

`number`

Its starting gain.

###### Returns

[`SoundVoice`](#soundvoice)

#### Properties

##### clip

> `readonly` **clip**: [`AudioClip`](#audioclip)

The clip being played.

###### Implementation of

[`SoundInstance`](#soundinstance).[`clip`](#clip-3)

#### Accessors

##### bus

###### Get Signature

> **get** **bus**(): [`AudioBus`](#audiobus) \| `null`

The bus this voice routes into.

###### Returns

[`AudioBus`](#audiobus) \| `null`

The bus, or `null` while the tree is still being built or when the voice goes straight
to the engine's main bus.

The bus it routes into, or `null` when it goes straight to the engine's main bus.

###### Implementation of

[`SoundInstance`](#soundinstance).[`bus`](#bus-6)

##### instanceCount

###### Get Signature

> **get** **instanceCount**(): `number`

How many instances are live.

###### Returns

`number`

The backend's instance count plus the plays still queued.

How many instances are live, including ones queued behind the unlock.

###### Implementation of

[`SoundInstance`](#soundinstance).[`instanceCount`](#instancecount-4)

##### isAlive

###### Get Signature

> **get** **isAlive**(): `boolean`

`true` while the voice holds a live instance or a queued play — which is the predicate
`onEnded` watches, and which stays `true` for a paused sound because a pause is not an end.

###### Returns

`boolean`

Whether anything is still owed.

##### isDisposed

###### Get Signature

> **get** **isDisposed**(): `boolean`

`true` once the voice has been released and can no longer play.

###### Returns

`boolean`

Whether the voice is dead.

##### isPaused

###### Get Signature

> **get** **isPaused**(): `boolean`

Whether every live instance is paused.

###### Returns

`boolean`

`true` when the sound is paused.

`true` when every live instance is paused.

###### Implementation of

[`SoundInstance`](#soundinstance).[`isPaused`](#ispaused-2)

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

Whether anything is sounding.

###### Returns

`boolean`

`true` while an instance is running or a play is waiting for the unlock.

`true` while at least one instance is sounding, or waiting for the unlock.

###### Implementation of

[`SoundInstance`](#soundinstance).[`isPlaying`](#isplaying-4)

##### onEnded

###### Get Signature

> **get** **onEnded**(): [`SignalLike`](#signallike)

Emitted when the last instance stops sounding.

###### Returns

[`SignalLike`](#signallike)

The signal.

Emitted in `PreRender` on the frame the last instance stops sounding, whether it ran out or was
stopped. Never emitted for a sound that is merely paused.

###### Implementation of

[`SoundInstance`](#soundinstance).[`onEnded`](#onended-1)

##### sound

###### Get Signature

> **get** **sound**(): [`BackendSound`](#backendsound) \| `null`

The backend's sound, once it exists.

###### Returns

[`BackendSound`](#backendsound) \| `null`

The sound, or `null` while it is still being created.

##### volume

###### Get Signature

> **get** **volume**(): `number`

The gain, where a fade in progress has reached.

###### Returns

`number`

The linear gain.

The gain, where a fade in progress has reached.

###### Implementation of

[`SoundInstance`](#soundinstance).[`volume`](#volume-13)

#### Methods

##### advance()

> **advance**(`deltaSeconds`): `void`

Advances the fade and the pending stop. Runs before the backend's own update, so a stop that
comes due this frame is seen as an end in the same frame.

###### Parameters

###### deltaSeconds

`number`

The frame delta in seconds.

###### Returns

`void`

##### attach()

> **attach**(`sound`, `bus`): `void`

Adopts the backend sound the service created and releases whatever was queued behind it.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The freshly created sound.

###### bus

[`AudioBus`](#audiobus) \| `null`

The bus it was routed to.

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Releases the backend sound and every listener.

###### Returns

`void`

##### flush()

> **flush**(): `void`

Starts every play that was waiting for the sound or for the unlock.

###### Returns

`void`

##### pause()

> **pause**(): `void`

Pauses every instance.

###### Returns

`void`

###### Implementation of

[`SoundInstance`](#soundinstance).[`pause`](#pause-4)

##### play()

> **play**(`request`): `void`

Starts one instance, or holds the request until the sound exists and the engine is unlocked.

###### Parameters

###### request

[`BackendPlayRequest`](#backendplayrequest)

The per-play overrides.

###### Returns

`void`

##### resume()

> **resume**(): `void`

Resumes every paused instance.

###### Returns

`void`

###### Implementation of

[`SoundInstance`](#soundinstance).[`resume`](#resume-4)

##### setPan()

> **setPan**(`pan`): `void`

Sets the stereo pan of a non-spatial sound.

###### Parameters

###### pan

`number`

The pan in `[-1, 1]`.

###### Returns

`void`

##### settle()

> **settle**(): `void`

Raises `onEnded` when the voice stopped being alive since the previous frame. Runs after the
backend's update, so a simulated instance that ran out this frame is already gone.

###### Returns

`void`

##### setVolume()

> **setVolume**(`volume`, `rampSeconds?`): `void`

Fades the gain.

###### Parameters

###### volume

`number`

The target linear gain.

###### rampSeconds?

`number`

How long the fade takes, in frame time.

###### Returns

`void`

###### Implementation of

[`SoundInstance`](#soundinstance).[`setVolume`](#setvolume-1)

##### stop()

> **stop**(`fadeSeconds?`): `void`

Stops every instance, optionally fading first.

###### Parameters

###### fadeSeconds?

`number`

Seconds of frame time to fade over; `0` stops now.

###### Returns

`void`

###### Implementation of

[`SoundInstance`](#soundinstance).[`stop`](#stop-6)

***

### TagSet

The mutable set of tags on one entity.

#### Example

```ts
entity.tags.add("enemy");
entity.tags.has("enemy"); // true
for (const tag of entity.tags) {
  console.log(tag);
}
```

#### Accessors

##### size

###### Get Signature

> **get** **size**(): `number`

How many tags the entity carries.

###### Returns

`number`

The tag count.

#### Methods

##### \[iterator\]()

> **\[iterator\]**(): `IterableIterator`\<`string`\>

Every tag, in insertion order, so a tag set can be spread or used in `for…of`.

###### Returns

`IterableIterator`\<`string`\>

An iterator over the tags.

##### add()

> **add**(`tag`): `this`

Adds a tag. Adding a tag the entity already carries is a no-op.

###### Parameters

###### tag

`string`

The tag.

###### Returns

`this`

This set, so calls chain.

##### delete()

> **delete**(`tag`): `boolean`

Removes a tag.

###### Parameters

###### tag

`string`

The tag.

###### Returns

`boolean`

`true` when the tag was present and has been removed.

##### has()

> **has**(`tag`): `boolean`

Reports whether the entity carries a tag.

###### Parameters

###### tag

`string`

The tag.

###### Returns

`boolean`

`true` when the tag is present.

##### values()

> **values**(): `IterableIterator`\<`string`\>

Every tag, in insertion order.

###### Returns

`IterableIterator`\<`string`\>

An iterator over the tags.

***

### TextureAsset

A loaded 2D texture (`docs/architecture/05-assets-and-loading.md` §5).

#### Example

```ts
const albedo = await app.assets.loadAsync<TextureAsset>("textures/hero-albedo.png");
albedo.value.options.srgb; // what the .meta.json sidecar asked for
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the texture was loaded from.

##### assetType

> `static` **assetType**: `string`

The type name the asset service registers textures under.

##### options

> `readonly` **options**: [`TextureImportOptions`](#textureimportoptions)

The resolved import options, sidecar values merged onto the defaults.

#### Accessors

##### isReleased

###### Get Signature

> **get** **isReleased**(): `boolean`

Whether the GPU texture has been given up.

###### Returns

`boolean`

`true` once [TextureAsset.releaseGpu](#releasegpu) has run.

##### lite

###### Get Signature

> **get** **lite**(): [`TextureAssetLiteHandles`](#textureassetlitehandles)

The Babylon Lite objects the asset owns. Unstable escape hatch.

###### Returns

[`TextureAssetLiteHandles`](#textureassetlitehandles)

The GPU texture, or `null` under a headless app.

#### Methods

##### releaseGpu()

> **releaseGpu**(): `boolean`

Gives up the asset's share of the GPU texture, destroying it when it was the last one. Calling
it twice is a no-op, and it is a no-op under a headless app.

###### Returns

`boolean`

`true` when this call destroyed the underlying `GPUTexture`.

##### retainGpu()

> **retainGpu**(): `void`

Claims an extra share of the GPU texture, so releasing the asset does not destroy it.

###### Returns

`void`

###### Remarks

Only needed when a Lite object has to outlive the asset that loaded it. Ordinary sharing goes
through `ctx.loadDependency`, which counts the asset handle instead.

***

### Transform

The view over an entity's Babylon Lite `SceneNode`
(`docs/architecture/02-scene-graph.md` §5). Every entity has exactly one; it cannot be removed
and cannot be disabled (`IGX-0205`).

#### Remarks

There is no second copy of position, rotation, or scale anywhere in ignifx: physics, animation,
and scripts all read and write the same Lite node. `localPosition`, `localRotation`, and
`localScale` are the node's own live values, so `transform.localPosition.x += 1` writes straight
through with no copy and no dirty flag of ignifx's own.

World-space getters (`position`, `rotation`, `eulerAngles`, `lossyScale`, `forward`, `right`,
`up`) allocate a fresh value; every one of them has a `ToRef` twin that writes into a caller-owned
object and allocates nothing, and hot code uses those (coding standards §7).

#### Example

```ts
class Follow extends Script implements ScriptCallbacks {
  #target = new Vec3();
  lateUpdate(dt: number): void {
    this.player.transform.positionToRef(this.#target);   // no allocation
    this.transform.localPosition.copyFrom(this.#target); // straight into the Lite node
  }
}
```

#### Extends

- [`Component`](#abstract-component)

#### Constructors

##### Constructor

> **new Transform**(): [`Transform`](#transform-14)

Creates an unbound transform. The entity constructor binds it to a Lite node immediately.

###### Returns

[`Transform`](#transform-14)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-9)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean`

An entity has exactly one transform.

##### typeId

> `static` **typeId**: `string`

The registration id of the one component every entity carries.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-5)

##### enabled

###### Get Signature

> **get** **enabled**(): `boolean`

A transform is always enabled: it is the entity's only view of its own position, and the
engine, physics, and animation all write through it.

###### Throws

IgnifxError with code `IGX-0205` on any attempt to set it to `false`. Deactivate the
entity instead (`docs/architecture/01-lifecycle-and-time.md` §6).

###### Returns

`boolean`

Always `true`.

###### Set Signature

> **set** **enabled**(`value`): `void`

The component's own enabled flag; `true` by default. Setting it runs the enable or disable
transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
`awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
happens inside a callback.

###### Parameters

###### value

`boolean`

###### Returns

`void`

`true` when the component's own flag is set.

###### Overrides

[`Component`](#abstract-component).[`enabled`](#enabled-6)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-4)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-4)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity-3)

##### eulerAngles

###### Get Signature

> **get** **eulerAngles**(): [`Vec3`](#vec3-4)

The world rotation as intrinsic XYZ Euler angles in degrees.

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.eulerAnglesToRef` in hot code.

###### Set Signature

> **set** **eulerAngles**(`value`): `void`

###### Parameters

###### value

[`Vec3Like`](#vec3like)

###### Returns

`void`

##### forward

###### Get Signature

> **get** **forward**(): [`Vec3`](#vec3-4)

The world unit vector pointing along the entity's local +Z (ADR-0011: left-handed, Y up, +Z
forward).

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.forwardToRef` in hot code.

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

##### lite

###### Get Signature

> **get** **lite**(): `SceneNode`

The Babylon Lite node this transform is a view over. Unstable escape hatch
(`docs/architecture/00-overview.md` §3); excluded from the stability guarantees of
`CONSTITUTION.md` Article IV.

###### Returns

`SceneNode`

The node.

##### localEulerAngles

###### Get Signature

> **get** **localEulerAngles**(): [`Vec3`](#vec3-4)

The local rotation as intrinsic XYZ Euler angles in **degrees** (ADR-0011).

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.localEulerAnglesToRef` in hot code.

###### Set Signature

> **set** **localEulerAngles**(`value`): `void`

###### Parameters

###### value

[`Vec3Like`](#vec3like)

###### Returns

`void`

##### localMatrix

###### Get Signature

> **get** **localMatrix**(): [`Mat4Like`](#mat4like)

The matrix that takes local space to the parent's space, composed from the local TRS as
`T * R * S`.

###### Returns

[`Mat4Like`](#mat4like)

The 16 column-major elements. The same storage and staleness rules as
`Transform.worldMatrix`.

##### localPosition

###### Get Signature

> **get** **localPosition**(): [`MutableVec3`](#mutablevec3)

The position relative to the parent, as a **live** view over the Lite node: writing to it moves
the entity and invalidates the subtree's world matrices.

###### Returns

[`MutableVec3`](#mutablevec3)

The live local position. Never hold it past the entity's lifetime.

##### localPosition2D

###### Get Signature

> **get** **localPosition2D**(): [`Vec2`](#vec2-4)

The local position in the 2D plane; the Z depth is left alone by the setter, because 2D uses it
only as a sorting fallback (`docs/architecture/00-overview.md` §4).

###### Returns

[`Vec2`](#vec2-4)

A freshly allocated 2D vector.

###### Set Signature

> **set** **localPosition2D**(`value`): `void`

###### Parameters

###### value

[`Vec2`](#vec2-4)

###### Returns

`void`

##### localRotation

###### Get Signature

> **get** **localRotation**(): [`MutableQuat`](#mutablequat)

The rotation relative to the parent, as a live view over the Lite node.

###### Returns

[`MutableQuat`](#mutablequat)

The live local rotation.

##### localScale

###### Get Signature

> **get** **localScale**(): [`MutableVec3`](#mutablevec3)

The scale relative to the parent, as a live view over the Lite node. Non-uniform scale is
supported; negative scale is allowed but shadows and physics shapes do not support it.

###### Returns

[`MutableVec3`](#mutablevec3)

The live local scale.

##### localScale2D

###### Get Signature

> **get** **localScale2D**(): [`Vec2`](#vec2-4)

The local scale in the 2D plane.

###### Returns

[`Vec2`](#vec2-4)

A freshly allocated 2D vector.

###### Set Signature

> **set** **localScale2D**(`value`): `void`

###### Parameters

###### value

[`Vec2`](#vec2-4)

###### Returns

`void`

##### lossyScale

###### Get Signature

> **get** **lossyScale**(): [`Vec3`](#vec3-4)

The world scale, read as the lengths of the world matrix's basis columns. It is *lossy*: a
rotated parent with non-uniform scale has no exact per-axis world scale, so this is the closest
approximation, exactly as Unity's `lossyScale` is.

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.lossyScaleToRef` in hot code.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal-3)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed-3)

##### position

###### Get Signature

> **get** **position**(): [`Vec3`](#vec3-4)

The world position.

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.positionToRef` in hot code.

###### Set Signature

> **set** **position**(`value`): `void`

###### Parameters

###### value

[`Vec3Like`](#vec3like)

###### Returns

`void`

##### position2D

###### Get Signature

> **get** **position2D**(): [`Vec2`](#vec2-4)

The world position, in metres, in the plane 2D games use.

###### Returns

[`Vec2`](#vec2-4)

A freshly allocated 2D vector.

###### Set Signature

> **set** **position2D**(`value`): `void`

###### Parameters

###### value

[`Vec2`](#vec2-4)

###### Returns

`void`

##### right

###### Get Signature

> **get** **right**(): [`Vec3`](#vec3-4)

The world unit vector pointing along the entity's local +X.

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.rightToRef` in hot code.

##### rotation

###### Get Signature

> **get** **rotation**(): [`Quat`](#quat-4)

The world rotation.

###### Returns

[`Quat`](#quat-4)

A freshly allocated quaternion. Use `Transform.rotationToRef` in hot code.

###### Set Signature

> **set** **rotation**(`value`): `void`

###### Parameters

###### value

[`QuatLike`](#quatlike)

###### Returns

`void`

##### rotation2D

###### Get Signature

> **get** **rotation2D**(): `number`

The local rotation about +Z in degrees, counter-clockwise — the only rotation 2D uses
(ADR-0011).

###### Returns

`number`

The angle in degrees.

###### Set Signature

> **set** **rotation2D**(`degrees`): `void`

###### Parameters

###### degrees

`number`

###### Returns

`void`

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-14)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-14)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid-3)

##### up

###### Get Signature

> **get** **up**(): [`Vec3`](#vec3-4)

The world unit vector pointing along the entity's local +Y.

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.upToRef` in hot code.

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world the entity belongs to.

###### Returns

[`World`](#world-16)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-4)

##### worldMatrix

###### Get Signature

> **get** **worldMatrix**(): [`Mat4Like`](#mat4like)

The world matrix, copied out of Lite's cache the first time it is read after a change.

###### Remarks

Lite documents its `Mat4` as opaque and recomputes it lazily up the parent chain, so the
adapter copies it element by element rather than handing out Lite's own object (ADR-0003
Validation). The returned view is this transform's own storage: it is read-only, its identity
is stable, and its contents change the next time the matrix is read after the entity moves.

###### Returns

[`Mat4Like`](#mat4like)

The 16 column-major elements, translation in slots 12/13/14.

##### worldMatrixVersion

###### Get Signature

> **get** **worldMatrixVersion**(): `number`

A counter that increases whenever this transform's world matrix is invalidated, by its own TRS
or by any ancestor's. Snapshot it to detect movement without comparing matrices — how
extensions feed spatial acceleration structures (`docs/architecture/02-scene-graph.md` §9).

###### Returns

`number`

The current version.

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): [`ComponentDefinition`](#componentdefinition)\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

[`ComponentDefinition`](#componentdefinition)\<`S`\>

An abstract class to extend.

###### Throws

IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
with a `Component`/`Script` member.

###### Example

```ts
class Spinner extends Component.define({
  degreesPerSecond: f32(90, { min: -360, max: 360 }),
  axis: vec3({ x: 0, y: 1, z: 0 }),
}) {
  static typeId = "mygame/Spinner";
}
```

###### Inherited from

[`Component`](#abstract-component).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

A transform cannot be destroyed on its own.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0205`. Destroy the entity instead.

###### Overrides

[`Component`](#abstract-component).[`destroy`](#destroy-3)

##### eulerAnglesToRef()

> **eulerAnglesToRef**\<`TOut`\>(`out`): `TOut`

Writes the world Euler angles in degrees into a caller-owned vector. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`.

##### forwardToRef()

> **forwardToRef**\<`TOut`\>(`out`): `TOut`

Writes the world +Z axis into a caller-owned vector. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`, normalised.

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

[`Component`](#abstract-component).[`getComponent`](#getcomponent-3)

##### inverseTransformDirection()

> **inverseTransformDirection**(`world`, `out?`): [`MutableVec3`](#mutablevec3)

Takes a direction from world space to this entity's local space.

###### Parameters

###### world

[`Vec3Like`](#vec3like)

The direction, in world space.

###### out?

[`MutableVec3`](#mutablevec3)

Where to write the result; a fresh `Vec3` is allocated when omitted.

###### Returns

[`MutableVec3`](#mutablevec3)

The local direction; unchanged input when the world matrix is singular.

##### inverseTransformPoint()

> **inverseTransformPoint**(`world`, `out?`): [`MutableVec3`](#mutablevec3)

Takes a point from world space to this entity's local space.

###### Parameters

###### world

[`Vec3Like`](#vec3like)

The point, in world space.

###### out?

[`MutableVec3`](#mutablevec3)

Where to write the result; a fresh `Vec3` is allocated when omitted.

###### Returns

[`MutableVec3`](#mutablevec3)

The local point; unchanged input when the world matrix is singular.

##### localEulerAnglesToRef()

> **localEulerAnglesToRef**\<`TOut`\>(`out`): `TOut`

Writes the local Euler angles in degrees into a caller-owned vector. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`.

##### lookAt()

> **lookAt**(`target`, `up?`): `void`

Points the entity's +Z axis at a world-space target.

###### Parameters

###### target

[`Vec3Like`](#vec3like)

Where to look, in world space.

###### up?

[`Vec3Like`](#vec3like)

The world up hint; defaults to +Y.

###### Returns

`void`

##### lossyScaleToRef()

> **lossyScaleToRef**\<`TOut`\>(`out`): `TOut`

Writes the lossy world scale into a caller-owned vector. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`.

##### positionToRef()

> **positionToRef**\<`TOut`\>(`out`): `TOut`

Writes the world position into a caller-owned vector. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`.

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type to look for.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent-3)

##### rightToRef()

> **rightToRef**\<`TOut`\>(`out`): `TOut`

Writes the world +X axis into a caller-owned vector. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`, normalised.

##### rotate()

> **rotate**(`eulerDegrees`, `space?`): `void`

Rotates the entity by intrinsic XYZ Euler angles in degrees. Allocates nothing.

###### Parameters

###### eulerDegrees

[`Vec3Like`](#vec3like)

The rotation to apply.

###### space?

`"local"` \| `"world"`

`"local"` (the default) applies the rotation in the entity's own space;
`"world"` applies it in world space.

###### Returns

`void`

##### rotateAround()

> **rotateAround**(`point`, `axis`, `degrees`): `void`

Orbits the entity around a world-space point.

###### Parameters

###### point

[`Vec3Like`](#vec3like)

The pivot, in world space.

###### axis

[`Vec3Like`](#vec3like)

The axis to rotate about, in world space; need not be normalised.

###### degrees

`number`

How far to rotate, counter-clockwise about the axis.

###### Returns

`void`

##### rotationToRef()

> **rotationToRef**\<`TOut`\>(`out`): `TOut`

Writes the world rotation into a caller-owned quaternion. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableQuat`](#mutablequat)

###### Parameters

###### out

`TOut`

The quaternion to write.

###### Returns

`TOut`

`out`.

##### setPositionAndRotation()

> **setPositionAndRotation**(`position`, `rotation`): `void`

Sets world position and rotation together, which is cheaper than setting them one at a time
because the parent's world matrix is read once.

###### Parameters

###### position

[`Vec3Like`](#vec3like)

The world position, in metres.

###### rotation

[`QuatLike`](#quatlike)

The world rotation.

###### Returns

`void`

##### transformDirection()

> **transformDirection**(`local`, `out?`): [`MutableVec3`](#mutablevec3)

Takes a direction from this entity's local space to world space; translation is ignored.

###### Parameters

###### local

[`Vec3Like`](#vec3like)

The direction, in the entity's local space.

###### out?

[`MutableVec3`](#mutablevec3)

Where to write the result; a fresh `Vec3` is allocated when omitted.

###### Returns

[`MutableVec3`](#mutablevec3)

The world direction.

##### transformPoint()

> **transformPoint**(`local`, `out?`): [`MutableVec3`](#mutablevec3)

Takes a point from this entity's local space to world space.

###### Parameters

###### local

[`Vec3Like`](#vec3like)

The point, in the entity's local space.

###### out?

[`MutableVec3`](#mutablevec3)

Where to write the result; a fresh `Vec3` is allocated when omitted.

###### Returns

[`MutableVec3`](#mutablevec3)

The world point.

##### translate()

> **translate**(`delta`, `space?`): `void`

Moves the entity by a delta. Allocates nothing.

###### Parameters

###### delta

[`Vec3Like`](#vec3like)

How far to move, in metres.

###### space?

`"local"` \| `"world"`

`"local"` (the default) rotates the delta by the entity's own rotation first, so
`{ z: 1 }` means "one metre forward"; `"world"` adds the delta to the world position.

###### Returns

`void`

###### Example

```ts
this.transform.translate({ x: 0, y: 0, z: this.speed * dt }); // forward
```

##### upToRef()

> **upToRef**\<`TOut`\>(`out`): `TOut`

Writes the world +Y axis into a caller-owned vector. Allocates nothing.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### out

`TOut`

The vector to write.

###### Returns

`TOut`

`out`, normalised.

***

### UidRemap

The per-instance mapping from the uids a scene file carries to the runtime objects built from it
(`docs/architecture/02-scene-graph.md` §10). Loading the same scene twice produces two remaps, so
two instances of one prefab never resolve each other's references.

#### Remarks

The "file uid" side of the table is the uid an entity carries in the *expanded* file — the same
uid for entities declared by the scene itself, and a freshly minted one for each copy an
`instance` entry expands, because a prefab instanced twice would otherwise contribute the same
uid twice.

#### Constructors

##### Constructor

> **new UidRemap**(): [`UidRemap`](#uidremap)

###### Returns

[`UidRemap`](#uidremap)

#### Accessors

##### size

###### Get Signature

> **get** **size**(): `number`

How many entities the remap holds.

###### Returns

`number`

The entity count.

#### Methods

##### clear()

> **clear**(): `void`

Drops every entry; the scene instance calls it on unload.

###### Returns

`void`

##### component()

> **component**(`fileUid`): [`Component`](#abstract-component) \| `null`

Resolves a file uid to its component.

###### Parameters

###### fileUid

`string`

The uid read from the file.

###### Returns

[`Component`](#abstract-component) \| `null`

The component, or `null` when the file declares no such component.

##### entity()

> **entity**(`fileUid`): [`Entity`](#entity-4) \| `null`

Resolves a file uid to its entity.

###### Parameters

###### fileUid

`string`

The uid read from the file.

###### Returns

[`Entity`](#entity-4) \| `null`

The entity, or `null` when the file declares no such entity.

##### entries()

> **entries**(): `IterableIterator`\<readonly \[`string`, [`Entity`](#entity-4)\]\>

Every entity the remap holds, in the order the file declared them.

###### Returns

`IterableIterator`\<readonly \[`string`, [`Entity`](#entity-4)\]\>

The live iterator over `[fileUid, entity]` pairs.

***

### Vec2

A 2-component vector: a position or direction in the 2D toolkit's world space (Y up, X right,
metres — ADR-0011), a UV coordinate, or a 2D scale.

Instance methods mutate the receiver and return `this`; `ToRef` statics write into a final `out`
argument and allocate nothing; the remaining statics allocate and say so.

#### Example

```ts
const velocity = new Vec2(1, 0);
velocity.scale(speed);
Vec2.addToRef(position, velocity, position);
```

#### Constructors

##### Constructor

> **new Vec2**(`x?`, `y?`): [`Vec2`](#vec2-4)

Creates a vector.

###### Parameters

###### x?

`number`

The X component. Defaults to 0.

###### y?

`number`

The Y component. Defaults to 0.

###### Returns

[`Vec2`](#vec2-4)

#### Properties

##### x

> **x**: `number`

The X component; positive is right.

##### y

> **y**: `number`

The Y component; positive is up.

#### Methods

##### add()

> `static` **add**(`a`, `b`): [`Vec2`](#vec2-4)

Adds two vectors.

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The first vector.

###### b

[`Vec2Like`](#vec2like)

The second vector.

###### Returns

[`Vec2`](#vec2-4)

A new vector. **Allocates.**

##### add()

> **add**(`v`): `this`

Adds another vector to this one.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to add.

###### Returns

`this`

This vector.

##### addScaled()

> **addScaled**(`v`, `scale`): `this`

Adds a scaled vector to this one, without a temporary.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to add.

###### scale

`number`

The factor to multiply `v` by first.

###### Returns

`this`

This vector.

##### addToRef()

> `static` **addToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes `a + b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec2`](#mutablevec2)

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The first vector.

###### b

[`Vec2Like`](#vec2like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### clone()

> **clone**(): [`Vec2`](#vec2-4)

Copies this vector into a new one.

###### Returns

[`Vec2`](#vec2-4)

A new vector. **Allocates.**

##### copyFrom()

> **copyFrom**(`v`): `this`

Copies every component from another vector.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to read.

###### Returns

`this`

This vector.

##### cross()

> `static` **cross**(`a`, `b`): `number`

The 2D cross product of two vectors — the Z component of their 3D cross product.

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The left-hand vector.

###### b

[`Vec2Like`](#vec2like)

The right-hand vector.

###### Returns

`number`

The scalar cross product.

##### cross()

> **cross**(`v`): `number`

The 2D cross product — the Z component of the 3D cross product. Its sign says which side of
this vector the other one falls on.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The other vector.

###### Returns

`number`

The scalar cross product.

##### distance()

> `static` **distance**(`a`, `b`): `number`

The distance between two positions, in metres.

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The first position.

###### b

[`Vec2Like`](#vec2like)

The second position.

###### Returns

`number`

The distance.

##### distance()

> **distance**(`v`): `number`

The distance from this vector to another, in metres.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The other position.

###### Returns

`number`

The distance.

##### distanceSquared()

> **distanceSquared**(`v`): `number`

The squared distance from this vector to another.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The other position.

###### Returns

`number`

The squared distance.

##### dot()

> `static` **dot**(`a`, `b`): `number`

The dot product of two vectors.

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The first vector.

###### b

[`Vec2Like`](#vec2like)

The second vector.

###### Returns

`number`

The dot product.

##### dot()

> **dot**(`v`): `number`

The dot product of this vector with another.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The other vector.

###### Returns

`number`

The dot product.

##### equalsWithEpsilon()

> `static` **equalsWithEpsilon**(`a`, `b`, `epsilon?`): `boolean`

Compares two vectors component by component, with a tolerance.

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The first vector.

###### b

[`Vec2Like`](#vec2like)

The second vector.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### equalsWithEpsilon()

> **equalsWithEpsilon**(`v`, `epsilon?`): `boolean`

Compares this vector with another, component by component, with a tolerance.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to compare against.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### from()

> `static` **from**(`v`): [`Vec2`](#vec2-4)

Copies any vector-shaped value into a `Vec2`.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to copy.

###### Returns

[`Vec2`](#vec2-4)

A new vector. **Allocates.**

##### length()

> `static` **length**(`v`): `number`

The length of a vector, in metres.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to measure.

###### Returns

`number`

The length.

##### length()

> **length**(): `number`

The length of this vector, in metres.

###### Returns

`number`

The length.

##### lengthSquared()

> `static` **lengthSquared**(`v`): `number`

The squared length of a vector.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to measure.

###### Returns

`number`

The squared length.

##### lengthSquared()

> **lengthSquared**(): `number`

The squared length of this vector.

###### Returns

`number`

The squared length.

##### lerp()

> `static` **lerp**(`a`, `b`, `t`): [`Vec2`](#vec2-4)

Linearly interpolates between two vectors.

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The vector returned at `t === 0`.

###### b

[`Vec2Like`](#vec2like)

The vector returned at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

[`Vec2`](#vec2-4)

A new vector. **Allocates.**

##### lerp()

> **lerp**(`target`, `t`): `this`

Moves this vector towards a target by an interpolant.

###### Parameters

###### target

[`Vec2Like`](#vec2like)

The vector reached at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

`this`

This vector.

##### lerpToRef()

> `static` **lerpToRef**\<`TOut`\>(`a`, `b`, `t`, `out`): `TOut`

Writes the interpolation of `a` and `b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec2`](#mutablevec2)

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The vector written at `t === 0`.

###### b

[`Vec2Like`](#vec2like)

The vector written at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### multiply()

> **multiply**(`v`): `this`

Multiplies this vector by another component by component.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to multiply by.

###### Returns

`this`

This vector.

##### multiplyToRef()

> `static` **multiplyToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes the component-wise product `a * b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec2`](#mutablevec2)

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The first vector.

###### b

[`Vec2Like`](#vec2like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### negate()

> **negate**(): `this`

Flips this vector to point the other way.

###### Returns

`this`

This vector.

##### negateToRef()

> `static` **negateToRef**\<`TOut`\>(`v`, `out`): `TOut`

Writes `-v` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec2`](#mutablevec2)

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to flip.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### normalize()

> `static` **normalize**(`v`): [`Vec2`](#vec2-4)

A unit-length copy of a vector.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to normalize.

###### Returns

[`Vec2`](#vec2-4)

A new vector. **Allocates.**

##### normalize()

> **normalize**(): `this`

Scales this vector to unit length; a zero-length vector is left at zero rather than becoming
`NaN`.

###### Returns

`this`

This vector.

##### normalizeToRef()

> `static` **normalizeToRef**\<`TOut`\>(`v`, `out`): `TOut`

Writes a unit-length copy of `v` into `out`; a zero-length input is written as zero.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec2`](#mutablevec2)

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to normalize.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### one()

> `static` **one**(): [`Vec2`](#vec2-4)

The vector whose components are both one.

###### Returns

[`Vec2`](#vec2-4)

A new `(1, 1)`. **Allocates.**

##### scale()

> `static` **scale**(`v`, `scale`): [`Vec2`](#vec2-4)

Multiplies a vector by a number.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to scale.

###### scale

`number`

The factor.

###### Returns

[`Vec2`](#vec2-4)

A new vector. **Allocates.**

##### scale()

> **scale**(`scale`): `this`

Multiplies every component by a number.

###### Parameters

###### scale

`number`

The factor.

###### Returns

`this`

This vector.

##### scaleToRef()

> `static` **scaleToRef**\<`TOut`\>(`v`, `scale`, `out`): `TOut`

Writes `v * scale` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec2`](#mutablevec2)

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to scale.

###### scale

`number`

The factor.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### set()

> **set**(`x`, `y`): `this`

Assigns every component at once.

###### Parameters

###### x

`number`

The new X component.

###### y

`number`

The new Y component.

###### Returns

`this`

This vector.

##### subtract()

> `static` **subtract**(`a`, `b`): [`Vec2`](#vec2-4)

Subtracts one vector from another.

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The vector to subtract from.

###### b

[`Vec2Like`](#vec2like)

The vector to subtract.

###### Returns

[`Vec2`](#vec2-4)

A new vector holding `a - b`. **Allocates.**

##### subtract()

> **subtract**(`v`): `this`

Subtracts another vector from this one.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to subtract.

###### Returns

`this`

This vector.

##### subtractToRef()

> `static` **subtractToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes `a - b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec2`](#mutablevec2)

###### Parameters

###### a

[`Vec2Like`](#vec2like)

The vector to subtract from.

###### b

[`Vec2Like`](#vec2like)

The vector to subtract.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### toArray()

> **toArray**(`out`, `offset?`): `Float32Array`

Writes this vector into a `Float32Array`, for GPU upload. The output comes first to mirror
Babylon Lite's `toArray` helpers.

###### Parameters

###### out

`Float32Array`

The array to write into.

###### offset?

`number`

The index of the X component. Defaults to 0.

###### Returns

`Float32Array`

`out`.

##### zero()

> `static` **zero**(): [`Vec2`](#vec2-4)

The zero vector.

###### Returns

[`Vec2`](#vec2-4)

A new `(0, 0)`. **Allocates.**

***

### Vec3

A 3-component vector: a position or a direction in metres, or a per-axis scale. ignifx is
left-handed with Y up and +Z forward (ADR-0011), so [Vec3.forward](#forward-1) is `(0, 0, 1)` and
[Vec3.right](#right-2) is `(1, 0, 0)`.

The fields are plain mutable numbers, which is what makes a `Vec3` interchangeable with Babylon
Lite's `{ x, y, z }` vectors and with the live [MutableVec3](#mutablevec3) views a `Transform` exposes.

Three families of operations, and the names say which is which:

- instance methods mutate the receiver and return `this` (`a.add(b)` means `a += b`);
- `ToRef` statics write into a final `out` argument, allocate nothing, and are safe when `out`
  aliases an input — these are what per-frame code uses (coding standards section 7);
- the remaining statics return a fresh vector and are documented as allocating.

#### Example

```ts
// convenience code
const offset = Vec3.add(position, Vec3.scale(direction, distance));

// per-frame code: no allocation
Vec3.scaleToRef(direction, distance, scratch);
Vec3.addToRef(position, scratch, position);
```

#### Constructors

##### Constructor

> **new Vec3**(`x?`, `y?`, `z?`): [`Vec3`](#vec3-4)

Creates a vector.

###### Parameters

###### x?

`number`

The X component. Defaults to 0.

###### y?

`number`

The Y component. Defaults to 0.

###### z?

`number`

The Z component. Defaults to 0.

###### Returns

[`Vec3`](#vec3-4)

#### Properties

##### x

> **x**: `number`

The X component; positive is right.

##### y

> **y**: `number`

The Y component; positive is up.

##### z

> **z**: `number`

The Z component; positive is forward.

#### Methods

##### add()

> `static` **add**(`a`, `b`): [`Vec3`](#vec3-4)

Adds two vectors.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first vector.

###### b

[`Vec3Like`](#vec3like)

The second vector.

###### Returns

[`Vec3`](#vec3-4)

A new vector. **Allocates**; use [Vec3.addToRef](#addtoref-1) in per-frame code.

##### add()

> **add**(`v`): `this`

Adds another vector to this one.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to add.

###### Returns

`this`

This vector.

##### addScaled()

> **addScaled**(`v`, `scale`): `this`

Adds a scaled vector to this one — the "move by velocity times delta time" step, without a
temporary.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to add.

###### scale

`number`

The factor to multiply `v` by first.

###### Returns

`this`

This vector.

###### Example

```ts
position.addScaled(velocity, time.deltaTime);
```

##### addToRef()

> `static` **addToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes `a + b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first vector.

###### b

[`Vec3Like`](#vec3like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### backward()

> `static` **backward**(): [`Vec3`](#vec3-4)

The world backward direction.

###### Returns

[`Vec3`](#vec3-4)

A new `(0, 0, -1)`. **Allocates.**

##### clone()

> **clone**(): [`Vec3`](#vec3-4)

Copies this vector into a new one.

###### Returns

[`Vec3`](#vec3-4)

A new vector. **Allocates.**

##### copyFrom()

> **copyFrom**(`v`): `this`

Copies every component from another vector.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to read.

###### Returns

`this`

This vector.

##### cross()

> `static` **cross**(`a`, `b`): [`Vec3`](#vec3-4)

The cross product of two vectors.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The left-hand vector.

###### b

[`Vec3Like`](#vec3like)

The right-hand vector.

###### Returns

[`Vec3`](#vec3-4)

A new vector holding `a x b`. **Allocates.**

##### cross()

> **cross**(`v`): `this`

Replaces this vector with its cross product with another (`this = this x v`).

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The right-hand vector.

###### Returns

`this`

This vector.

##### crossToRef()

> `static` **crossToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes `a x b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The left-hand vector.

###### b

[`Vec3Like`](#vec3like)

The right-hand vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### distance()

> `static` **distance**(`a`, `b`): `number`

The distance between two positions, in metres.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first position.

###### b

[`Vec3Like`](#vec3like)

The second position.

###### Returns

`number`

The distance.

##### distance()

> **distance**(`v`): `number`

The distance from this vector to another, in metres.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The other position.

###### Returns

`number`

The distance.

##### distanceSquared()

> `static` **distanceSquared**(`a`, `b`): `number`

The squared distance between two positions. Compare squared distances to avoid a square root.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first position.

###### b

[`Vec3Like`](#vec3like)

The second position.

###### Returns

`number`

The squared distance.

##### distanceSquared()

> **distanceSquared**(`v`): `number`

The squared distance from this vector to another.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The other position.

###### Returns

`number`

The squared distance.

##### dot()

> `static` **dot**(`a`, `b`): `number`

The dot product of two vectors.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first vector.

###### b

[`Vec3Like`](#vec3like)

The second vector.

###### Returns

`number`

The dot product.

##### dot()

> **dot**(`v`): `number`

The dot product of this vector with another.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The other vector.

###### Returns

`number`

The dot product.

##### down()

> `static` **down**(): [`Vec3`](#vec3-4)

The world down direction.

###### Returns

[`Vec3`](#vec3-4)

A new `(0, -1, 0)`. **Allocates.**

##### equalsWithEpsilon()

> `static` **equalsWithEpsilon**(`a`, `b`, `epsilon?`): `boolean`

Compares two vectors component by component, with a tolerance.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first vector.

###### b

[`Vec3Like`](#vec3like)

The second vector.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### equalsWithEpsilon()

> **equalsWithEpsilon**(`v`, `epsilon?`): `boolean`

Compares this vector with another, component by component, with a tolerance.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to compare against.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### forward()

> `static` **forward**(): [`Vec3`](#vec3-4)

The world forward direction. ignifx is left-handed, so forward is **+Z** (ADR-0011).

###### Returns

[`Vec3`](#vec3-4)

A new `(0, 0, 1)`. **Allocates**; see [VEC3\_FORWARD](#vec3_forward).

##### from()

> `static` **from**(`v`): [`Vec3`](#vec3-4)

Copies any vector-shaped value into a `Vec3`.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to copy.

###### Returns

[`Vec3`](#vec3-4)

A new vector. **Allocates.**

###### Example

```ts
const position = Vec3.from(node.position); // snapshot of a live Lite view
```

##### left()

> `static` **left**(): [`Vec3`](#vec3-4)

The world left direction.

###### Returns

[`Vec3`](#vec3-4)

A new `(-1, 0, 0)`. **Allocates.**

##### length()

> `static` **length**(`v`): `number`

The length of a vector, in metres.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to measure.

###### Returns

`number`

The length.

##### length()

> **length**(): `number`

The length of this vector, in metres.

###### Returns

`number`

The length.

##### lengthSquared()

> `static` **lengthSquared**(`v`): `number`

The squared length of a vector.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to measure.

###### Returns

`number`

The squared length.

##### lengthSquared()

> **lengthSquared**(): `number`

The squared length of this vector. Prefer it over `length()` when comparing distances:
it skips the square root.

###### Returns

`number`

The squared length.

##### lerp()

> `static` **lerp**(`a`, `b`, `t`): [`Vec3`](#vec3-4)

Linearly interpolates between two vectors.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The vector returned at `t === 0`.

###### b

[`Vec3Like`](#vec3like)

The vector returned at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

[`Vec3`](#vec3-4)

A new vector. **Allocates.**

##### lerp()

> **lerp**(`target`, `t`): `this`

Moves this vector towards a target by an interpolant.

###### Parameters

###### target

[`Vec3Like`](#vec3like)

The vector reached at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

`this`

This vector.

##### lerpToRef()

> `static` **lerpToRef**\<`TOut`\>(`a`, `b`, `t`, `out`): `TOut`

Writes the interpolation of `a` and `b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The vector written at `t === 0`.

###### b

[`Vec3Like`](#vec3like)

The vector written at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### maxToRef()

> `static` **maxToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes the component-wise maximum of two vectors into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first vector.

###### b

[`Vec3Like`](#vec3like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### minToRef()

> `static` **minToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes the component-wise minimum of two vectors into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first vector.

###### b

[`Vec3Like`](#vec3like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### multiply()

> **multiply**(`v`): `this`

Multiplies this vector by another component by component.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to multiply by.

###### Returns

`this`

This vector.

##### multiplyToRef()

> `static` **multiplyToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes the component-wise product `a * b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The first vector.

###### b

[`Vec3Like`](#vec3like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### negate()

> **negate**(): `this`

Flips this vector to point the other way.

###### Returns

`this`

This vector.

##### negateToRef()

> `static` **negateToRef**\<`TOut`\>(`v`, `out`): `TOut`

Writes `-v` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to flip.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### normalize()

> `static` **normalize**(`v`): [`Vec3`](#vec3-4)

A unit-length copy of a vector.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to normalize.

###### Returns

[`Vec3`](#vec3-4)

A new vector. **Allocates.**

##### normalize()

> **normalize**(): `this`

Scales this vector to unit length. A zero-length vector is left at zero rather than becoming
`NaN`, so callers can normalize an unchecked direction safely.

###### Returns

`this`

This vector.

##### normalizeToRef()

> `static` **normalizeToRef**\<`TOut`\>(`v`, `out`): `TOut`

Writes a unit-length copy of `v` into `out`. A zero-length input is written as zero rather than
`NaN`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to normalize.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### one()

> `static` **one**(): [`Vec3`](#vec3-4)

The vector whose components are all one.

###### Returns

[`Vec3`](#vec3-4)

A new `(1, 1, 1)`. **Allocates.**

##### right()

> `static` **right**(): [`Vec3`](#vec3-4)

The world right direction.

###### Returns

[`Vec3`](#vec3-4)

A new `(1, 0, 0)`. **Allocates**; see [VEC3\_RIGHT](#vec3_right).

##### scale()

> `static` **scale**(`v`, `scale`): [`Vec3`](#vec3-4)

Multiplies a vector by a number.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to scale.

###### scale

`number`

The factor.

###### Returns

[`Vec3`](#vec3-4)

A new vector. **Allocates.**

##### scale()

> **scale**(`scale`): `this`

Multiplies every component by a number.

###### Parameters

###### scale

`number`

The factor.

###### Returns

`this`

This vector.

##### scaleToRef()

> `static` **scaleToRef**\<`TOut`\>(`v`, `scale`, `out`): `TOut`

Writes `v * scale` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to scale.

###### scale

`number`

The factor.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### set()

> **set**(`x`, `y`, `z`): `this`

Assigns every component at once.

###### Parameters

###### x

`number`

The new X component.

###### y

`number`

The new Y component.

###### z

`number`

The new Z component.

###### Returns

`this`

This vector.

##### subtract()

> `static` **subtract**(`a`, `b`): [`Vec3`](#vec3-4)

Subtracts one vector from another.

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The vector to subtract from.

###### b

[`Vec3Like`](#vec3like)

The vector to subtract.

###### Returns

[`Vec3`](#vec3-4)

A new vector holding `a - b`. **Allocates.**

##### subtract()

> **subtract**(`v`): `this`

Subtracts another vector from this one.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to subtract.

###### Returns

`this`

This vector.

##### subtractToRef()

> `static` **subtractToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes `a - b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### a

[`Vec3Like`](#vec3like)

The vector to subtract from.

###### b

[`Vec3Like`](#vec3like)

The vector to subtract.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### toArray()

> **toArray**(`out`, `offset?`): `Float32Array`

Writes this vector into a `Float32Array`, for GPU upload. The output comes first to mirror
Babylon Lite's `ObservableVec3.toArray`, the shape the adapter has to interoperate with.

###### Parameters

###### out

`Float32Array`

The array to write into.

###### offset?

`number`

The index of the X component. Defaults to 0.

###### Returns

`Float32Array`

`out`.

##### transformCoordinatesToRef()

> `static` **transformCoordinatesToRef**\<`TOut`\>(`v`, `m`, `out`): `TOut`

Transforms a **position** by a matrix into `out`: the matrix's translation is applied and the
result is divided by w, so a projection matrix gives clip-space coordinates.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The position to transform, in metres.

###### m

[`Mat4Like`](#mat4like)

The transformation, column-major.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

###### Example

```ts
Vec3.transformCoordinatesToRef(localPoint, node.worldMatrix, worldPoint);
```

##### transformNormalToRef()

> `static` **transformNormalToRef**\<`TOut`\>(`v`, `m`, `out`): `TOut`

Transforms a **direction** by a matrix into `out`, ignoring the matrix's translation.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec3`](#mutablevec3)

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The direction to transform.

###### m

[`Mat4Like`](#mat4like)

The transformation, column-major.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### up()

> `static` **up**(): [`Vec3`](#vec3-4)

The world up direction.

###### Returns

[`Vec3`](#vec3-4)

A new `(0, 1, 0)`. **Allocates**; see [VEC3\_UP](#vec3_up).

##### zero()

> `static` **zero**(): [`Vec3`](#vec3-4)

The zero vector.

###### Returns

[`Vec3`](#vec3-4)

A new `(0, 0, 0)`. **Allocates**; use [VEC3\_ZERO](#vec3_zero) when a read-only value will do.

***

### Vec4

A 4-component vector: homogeneous coordinates, a tangent with a handedness sign, or any packed
quadruple headed for a shader. Rotations use [Quat](#quat-4), not this type.

Instance methods mutate the receiver and return `this`; `ToRef` statics write into a final `out`
argument and allocate nothing; the remaining statics allocate and say so.

#### Example

```ts
const tangent = new Vec4(1, 0, 0, -1);
tangent.toArray(vertexBuffer, offset);
```

#### Constructors

##### Constructor

> **new Vec4**(`x?`, `y?`, `z?`, `w?`): [`Vec4`](#vec4-4)

Creates a vector.

###### Parameters

###### x?

`number`

The X component. Defaults to 0.

###### y?

`number`

The Y component. Defaults to 0.

###### z?

`number`

The Z component. Defaults to 0.

###### w?

`number`

The W component. Defaults to 0.

###### Returns

[`Vec4`](#vec4-4)

#### Properties

##### w

> **w**: `number`

The W component.

##### x

> **x**: `number`

The X component.

##### y

> **y**: `number`

The Y component.

##### z

> **z**: `number`

The Z component.

#### Methods

##### add()

> `static` **add**(`a`, `b`): [`Vec4`](#vec4-4)

Adds two vectors.

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The first vector.

###### b

[`Vec4Like`](#vec4like)

The second vector.

###### Returns

[`Vec4`](#vec4-4)

A new vector. **Allocates.**

##### add()

> **add**(`v`): `this`

Adds another vector to this one.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to add.

###### Returns

`this`

This vector.

##### addToRef()

> `static` **addToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes `a + b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec4`](#mutablevec4)

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The first vector.

###### b

[`Vec4Like`](#vec4like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### clone()

> **clone**(): [`Vec4`](#vec4-4)

Copies this vector into a new one.

###### Returns

[`Vec4`](#vec4-4)

A new vector. **Allocates.**

##### copyFrom()

> **copyFrom**(`v`): `this`

Copies every component from another vector.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to read.

###### Returns

`this`

This vector.

##### dot()

> `static` **dot**(`a`, `b`): `number`

The dot product of two vectors.

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The first vector.

###### b

[`Vec4Like`](#vec4like)

The second vector.

###### Returns

`number`

The dot product.

##### dot()

> **dot**(`v`): `number`

The dot product of this vector with another.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The other vector.

###### Returns

`number`

The dot product.

##### equalsWithEpsilon()

> `static` **equalsWithEpsilon**(`a`, `b`, `epsilon?`): `boolean`

Compares two vectors component by component, with a tolerance.

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The first vector.

###### b

[`Vec4Like`](#vec4like)

The second vector.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### equalsWithEpsilon()

> **equalsWithEpsilon**(`v`, `epsilon?`): `boolean`

Compares this vector with another, component by component, with a tolerance.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to compare against.

###### epsilon?

`number`

The largest per-component difference still considered equal.

###### Returns

`boolean`

`true` when every component matches within `epsilon`.

##### from()

> `static` **from**(`v`): [`Vec4`](#vec4-4)

Copies any vector-shaped value into a `Vec4`.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to copy.

###### Returns

[`Vec4`](#vec4-4)

A new vector. **Allocates.**

##### length()

> `static` **length**(`v`): `number`

The length of a vector.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to measure.

###### Returns

`number`

The length.

##### length()

> **length**(): `number`

The length of this vector.

###### Returns

`number`

The length.

##### lengthSquared()

> `static` **lengthSquared**(`v`): `number`

The squared length of a vector.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to measure.

###### Returns

`number`

The squared length.

##### lengthSquared()

> **lengthSquared**(): `number`

The squared length of this vector.

###### Returns

`number`

The squared length.

##### lerp()

> `static` **lerp**(`a`, `b`, `t`): [`Vec4`](#vec4-4)

Linearly interpolates between two vectors.

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The vector returned at `t === 0`.

###### b

[`Vec4Like`](#vec4like)

The vector returned at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

[`Vec4`](#vec4-4)

A new vector. **Allocates.**

##### lerp()

> **lerp**(`target`, `t`): `this`

Moves this vector towards a target by an interpolant.

###### Parameters

###### target

[`Vec4Like`](#vec4like)

The vector reached at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### Returns

`this`

This vector.

##### lerpToRef()

> `static` **lerpToRef**\<`TOut`\>(`a`, `b`, `t`, `out`): `TOut`

Writes the interpolation of `a` and `b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec4`](#mutablevec4)

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The vector written at `t === 0`.

###### b

[`Vec4Like`](#vec4like)

The vector written at `t === 1`.

###### t

`number`

The interpolant; not clamped.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### multiply()

> **multiply**(`v`): `this`

Multiplies this vector by another component by component.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to multiply by.

###### Returns

`this`

This vector.

##### multiplyToRef()

> `static` **multiplyToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes the component-wise product `a * b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec4`](#mutablevec4)

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The first vector.

###### b

[`Vec4Like`](#vec4like)

The second vector.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### negate()

> **negate**(): `this`

Flips every component's sign.

###### Returns

`this`

This vector.

##### negateToRef()

> `static` **negateToRef**\<`TOut`\>(`v`, `out`): `TOut`

Writes `-v` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec4`](#mutablevec4)

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to flip.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### normalize()

> `static` **normalize**(`v`): [`Vec4`](#vec4-4)

A unit-length copy of a vector.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to normalize.

###### Returns

[`Vec4`](#vec4-4)

A new vector. **Allocates.**

##### normalize()

> **normalize**(): `this`

Scales this vector to unit length; a zero-length vector is left at zero rather than becoming
`NaN`.

###### Returns

`this`

This vector.

##### normalizeToRef()

> `static` **normalizeToRef**\<`TOut`\>(`v`, `out`): `TOut`

Writes a unit-length copy of `v` into `out`; a zero-length input is written as zero.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec4`](#mutablevec4)

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to normalize.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### one()

> `static` **one**(): [`Vec4`](#vec4-4)

The vector whose components are all one.

###### Returns

[`Vec4`](#vec4-4)

A new `(1, 1, 1, 1)`. **Allocates.**

##### scale()

> `static` **scale**(`v`, `scale`): [`Vec4`](#vec4-4)

Multiplies a vector by a number.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to scale.

###### scale

`number`

The factor.

###### Returns

[`Vec4`](#vec4-4)

A new vector. **Allocates.**

##### scale()

> **scale**(`scale`): `this`

Multiplies every component by a number.

###### Parameters

###### scale

`number`

The factor.

###### Returns

`this`

This vector.

##### scaleToRef()

> `static` **scaleToRef**\<`TOut`\>(`v`, `scale`, `out`): `TOut`

Writes `v * scale` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec4`](#mutablevec4)

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to scale.

###### scale

`number`

The factor.

###### out

`TOut`

The vector to write; may alias `v`.

###### Returns

`TOut`

`out`.

##### set()

> **set**(`x`, `y`, `z`, `w`): `this`

Assigns every component at once.

###### Parameters

###### x

`number`

The new X component.

###### y

`number`

The new Y component.

###### z

`number`

The new Z component.

###### w

`number`

The new W component.

###### Returns

`this`

This vector.

##### subtract()

> `static` **subtract**(`a`, `b`): [`Vec4`](#vec4-4)

Subtracts one vector from another.

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The vector to subtract from.

###### b

[`Vec4Like`](#vec4like)

The vector to subtract.

###### Returns

[`Vec4`](#vec4-4)

A new vector holding `a - b`. **Allocates.**

##### subtract()

> **subtract**(`v`): `this`

Subtracts another vector from this one.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to subtract.

###### Returns

`this`

This vector.

##### subtractToRef()

> `static` **subtractToRef**\<`TOut`\>(`a`, `b`, `out`): `TOut`

Writes `a - b` into `out`.

###### Type Parameters

###### TOut

`TOut` *extends* [`MutableVec4`](#mutablevec4)

###### Parameters

###### a

[`Vec4Like`](#vec4like)

The vector to subtract from.

###### b

[`Vec4Like`](#vec4like)

The vector to subtract.

###### out

`TOut`

The vector to write; may alias `a` or `b`.

###### Returns

`TOut`

`out`.

##### toArray()

> **toArray**(`out`, `offset?`): `Float32Array`

Writes this vector into a `Float32Array`, for GPU upload. The output comes first to mirror
Babylon Lite's `toArray` helpers.

###### Parameters

###### out

`Float32Array`

The array to write into.

###### offset?

`number`

The index of the X component. Defaults to 0.

###### Returns

`Float32Array`

`out`.

##### zero()

> `static` **zero**(): [`Vec4`](#vec4-4)

The zero vector.

###### Returns

[`Vec4`](#vec4-4)

A new `(0, 0, 0, 0)`. **Allocates.**

***

### VirtualDevice

A device whose controls are created on demand.

#### Example

```ts
const stick = app.input.devices.virtual.declare("joystick", "vector2");
app.input.devices.virtual.setVector("joystick", 0, 1);
```

#### Extends

- [`InputDevice`](#inputdevice)

#### Constructors

##### Constructor

> **new VirtualDevice**(): [`VirtualDevice`](#virtualdevice)

Builds an empty virtual device.

###### Returns

[`VirtualDevice`](#virtualdevice)

###### Overrides

[`InputDevice`](#inputdevice).[`constructor`](#constructor-24)

#### Properties

##### deviceIndex

> `readonly` **deviceIndex**: `number`

Which device of its family this is; `0` for every family that has only one.

###### Inherited from

[`InputDevice`](#inputdevice).[`deviceIndex`](#deviceindex-1)

##### kind

> `readonly` **kind**: [`DeviceKind`](#devicekind-1)

The device family this device belongs to.

###### Inherited from

[`InputDevice`](#inputdevice).[`kind`](#kind-15)

#### Accessors

##### controls

###### Get Signature

> **get** **controls**(): readonly [`ControlDescriptor`](#controldescriptor)[]

The device's controls, in index order.

###### Returns

readonly [`ControlDescriptor`](#controldescriptor)[]

The control table.

###### Inherited from

[`InputDevice`](#inputdevice).[`controls`](#controls-1)

##### isConnected

###### Get Signature

> **get** **isConnected**(): `boolean`

Whether the device is present. Only gamepads ever report `false`.

###### Returns

`boolean`

`true` when bindings to this device can produce input.

###### Inherited from

[`InputDevice`](#inputdevice).[`isConnected`](#isconnected-1)

#### Methods

##### control()

> **control**(`name`): [`ControlDescriptor`](#controldescriptor) \| `null`

Looks a control up by name. Call it at binding time, never per frame.

###### Parameters

###### name

`string`

The control name, for example `dpad/up`.

###### Returns

[`ControlDescriptor`](#controldescriptor) \| `null`

The descriptor, or `null` when the device has no such control.

###### Inherited from

[`InputDevice`](#inputdevice).[`control`](#control-2)

##### declare()

> **declare**(`name`, `kind?`): [`ControlDescriptor`](#controldescriptor)

Returns the named control, creating it when the device does not have it yet.

###### Parameters

###### name

`string`

The control name, as it appears after `<Virtual>/`.

###### kind?

[`ControlKind`](#controlkind-1)

What the control produces. Ignored when the control already exists.

###### Returns

[`ControlDescriptor`](#controldescriptor)

The descriptor.

##### set()

> **set**(`name`, `value`): `void`

Writes a scalar control, creating it when it does not exist.

###### Parameters

###### name

`string`

The control name.

###### value

`number`

The new value.

###### Returns

`void`

##### setVector()

> **setVector**(`name`, `x`, `y`): `void`

Writes a vector control, creating it when it does not exist.

###### Parameters

###### name

`string`

The control name.

###### x

`number`

The new x component.

###### y

`number`

The new y component.

###### Returns

`void`

##### valueAt()

> **valueAt**(`offset`): `number`

Reads one component of the device's value array.

###### Parameters

###### offset

`number`

The slot, from a [ControlDescriptor](#controldescriptor).

###### Returns

`number`

The value, or `0` when the slot is out of range.

###### Inherited from

[`InputDevice`](#inputdevice).[`valueAt`](#valueat-1)

***

### WebAudioBackend

The audio backend that runs in a browser.

#### Implements

- [`AudioBackend`](#audiobackend)

#### Constructors

##### Constructor

> **new WebAudioBackend**(`engine`): [`WebAudioBackend`](#webaudiobackend)

Wraps an audio engine Lite has already created.

###### Parameters

###### engine

`AudioEngine`

The engine from `createAudioEngineAsync`.

###### Returns

[`WebAudioBackend`](#webaudiobackend)

#### Properties

##### kind

> `readonly` **kind**: [`AudioBackendKind`](#audiobackendkind-1)

Which implementation this is.

###### Implementation of

[`AudioBackend`](#audiobackend).[`kind`](#kind-2)

#### Accessors

##### lite

###### Get Signature

> **get** **lite**(): [`AudioLiteHandles`](#audiolitehandles)

The Lite objects this backend owns. Unstable escape hatch.

###### Returns

[`AudioLiteHandles`](#audiolitehandles)

The engine.

The Lite objects this backend owns, or `null` when it owns none.

###### Implementation of

[`AudioBackend`](#audiobackend).[`lite`](#lite-1)

##### onStateChanged

###### Get Signature

> **get** **onStateChanged**(): [`SignalLike`](#signallike)\<[`AudioBackendState`](#audiobackendstate-1)\>

Emitted whenever the state changes.

###### Returns

[`SignalLike`](#signallike)\<[`AudioBackendState`](#audiobackendstate-1)\>

The signal.

Emitted whenever [AudioBackend.state](#state-1) changes.

###### Implementation of

[`AudioBackend`](#audiobackend).[`onStateChanged`](#onstatechanged)

##### state

###### Get Signature

> **get** **state**(): [`AudioBackendState`](#audiobackendstate-1)

The audio context's state.

###### Returns

[`AudioBackendState`](#audiobackendstate-1)

Lite's `AudioEngineState`, which is always `"running"` for an `OfflineAudioContext`.

The audio context's current state.

###### Implementation of

[`AudioBackend`](#audiobackend).[`state`](#state-1)

#### Methods

##### createBus()

> **createBus**(`request`): `Promise`\<[`BackendBus`](#backendbus)\>

Creates a Lite bus routed into its parent.

###### Parameters

###### request

[`BackendBusRequest`](#backendbusrequest)

The name, gain, and parent bus.

###### Returns

`Promise`\<[`BackendBus`](#backendbus)\>

The bus.

###### Implementation of

[`AudioBackend`](#audiobackend).[`createBus`](#createbus)

##### createSound()

> **createSound**(`request`): `Promise`\<[`BackendSound`](#backendsound)\>

Creates a Lite sound: buffer-backed for a static clip, media-element-backed for a streaming one.

###### Parameters

###### request

[`BackendSoundRequest`](#backendsoundrequest)

The clip, routing, and per-sound options.

###### Returns

`Promise`\<[`BackendSound`](#backendsound)\>

The sound.

###### Throws

IgnifxError with code `IGX-1008` when a static clip cannot be decoded, or `IGX-1009`
when a streaming clip is asked for on a context that cannot stream.

###### Implementation of

[`AudioBackend`](#audiobackend).[`createSound`](#createsound)

##### decode()

> **decode**(`clip`): `Promise`\<`void`\>

Decodes a static clip's bytes into a buffer every sound built from it shares.

###### Parameters

###### clip

[`AudioClip`](#audioclip)

The clip to decode.

###### Returns

`Promise`\<`void`\>

###### Throws

IgnifxError with code `IGX-1008` when the bytes are not audio this browser can decode.

###### Implementation of

[`AudioBackend`](#audiobackend).[`decode`](#decode)

##### dispose()

> **dispose**(): `void`

Stops every sound, tears down the graph, and closes the audio context.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`dispose`](#dispose-2)

##### disposeBus()

> **disposeBus**(`bus`): `void`

Releases a bus and its sub-graph.

###### Parameters

###### bus

[`BackendBus`](#backendbus)

The bus.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`disposeBus`](#disposebus)

##### disposeSound()

> **disposeSound**(`sound`): `void`

Releases a sound and its sub-graph.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`disposeSound`](#disposesound)

##### getMasterVolume()

> **getMasterVolume**(): `number`

Reads the master gain.

###### Returns

`number`

The gain.

###### Implementation of

[`AudioBackend`](#audiobackend).[`getMasterVolume`](#getmastervolume)

##### pause()

> **pause**(`sound`): `void`

Pauses every instance.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`pause`](#pause-1)

##### play()

> **play**(`sound`, `request`): `void`

Starts one instance, or resumes a paused sound — which is what Lite's `playSound` does
(`index.d.ts` 8955).

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### request

[`BackendPlayRequest`](#backendplayrequest)

The per-play overrides.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`play`](#play)

##### resume()

> **resume**(`sound`): `void`

Resumes every paused instance.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`resume`](#resume-1)

##### setBusVolume()

> **setBusVolume**(`bus`, `volume`): `void`

Sets a bus's gain.

###### Parameters

###### bus

[`BackendBus`](#backendbus)

The bus.

###### volume

`number`

The gain to apply now.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setBusVolume`](#setbusvolume)

##### setListener()

> **setListener**(`target`): `void`

Attaches Lite's spatial listener to a world transform, or leaves it at the world origin.

###### Parameters

###### target

`SpatialTarget` \| `null`

The transform to follow, or `null`.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setListener`](#setlistener)

##### setMasterVolume()

> **setMasterVolume**(`volume`): `void`

Sets the master gain.

###### Parameters

###### volume

`number`

The gain to apply now.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setMasterVolume`](#setmastervolume)

##### setSoundPan()

> **setSoundPan**(`sound`, `pan`): `void`

Sets a sound's stereo pan, building the panner sub-node on first use.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### pan

`number`

The pan in `[-1, 1]`.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setSoundPan`](#setsoundpan)

##### setSoundVolume()

> **setSoundVolume**(`sound`, `volume`): `void`

Sets a sound's gain.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### volume

`number`

The gain to apply now.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`setSoundVolume`](#setsoundvolume)

##### stop()

> **stop**(`sound`): `void`

Stops every instance.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`stop`](#stop-1)

##### unlock()

> **unlock**(): `Promise`\<`void`\>

Resumes the audio context. Browsers only honour this from inside a user-gesture handler; Lite
also resumes on the first `click` anywhere in the document on its own.

###### Returns

`Promise`\<`void`\>

A promise that settles once the context is running.

###### Implementation of

[`AudioBackend`](#audiobackend).[`unlock`](#unlock)

##### update()

> **update**(`deltaSeconds`): `void`

Re-reads the world matrix of every attached source and of the listener.

###### Parameters

###### deltaSeconds

`number`

The frame delta; Lite's pump reads poses rather than integrating, so it
is not used and is accepted only to satisfy the contract.

###### Returns

`void`

###### Implementation of

[`AudioBackend`](#audiobackend).[`update`](#update)

***

### World

The running simulation: the entity registry, the scene instances, and the lifecycle queues
(`docs/architecture/02-scene-graph.md` §2). One world per app in the MVP.

#### Remarks

Phase 1 ships the subset that needs no asset system: entity creation, queries, the implicit
`"default"` scene, and the lifecycle. `loadScene`, `unloadScene`, `instantiate`,
`instantiateAsync`, and `moveEntityToScene` arrive in Phase 2, and `onSceneLoaded`/
`onSceneUnloaded` exist here but never fire until then.

#### Example

```ts
const player = app.world.createEntity("Player");
for (const script of app.world.components(Script)) {
  script.enabled = false;
}
```

#### Implements

- `WorldHost`

#### Accessors

##### activeScene

###### Get Signature

> **get** **activeScene**(): [`SceneInstance`](#sceneinstance)

The scene that owns entities created in code without an explicit `scene` option. Assigning to
it makes another instance the default owner.

###### Returns

[`SceneInstance`](#sceneinstance)

The active instance.

###### Set Signature

> **set** **activeScene**(`scene`): `void`

###### Parameters

###### scene

[`SceneInstance`](#sceneinstance)

###### Returns

`void`

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Implementation of

`WorldHost.app`

##### isDisposed

###### Get Signature

> **get** **isDisposed**(): `boolean`

`true` once [World.dispose](#dispose-15) has run.

###### Returns

`boolean`

`true` when the world has been disposed.

##### layers

###### Get Signature

> **get** **layers**(): [`LayerTable`](#layertable)

The project's resolved layer names. `world.layers.mask("Player", "Enemy")` builds a mask.

###### Returns

[`LayerTable`](#layertable)

The layer table.

###### Implementation of

`WorldHost.layers`

##### lite

###### Get Signature

> **get** **lite**(): [`WorldLiteHandles`](#worldlitehandles)

Babylon Lite objects the world owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

[`WorldLiteHandles`](#worldlitehandles)

The render scene, and the physics simulation scene once an extension has set one. The
object is the same one on every read and is updated in place; do not retain a copy of its
fields.

##### mainCamera

###### Get Signature

> **get** **mainCamera**(): [`Camera`](#camera) \| `null`

The camera this world renders through: the enabled [Camera](#camera) with the highest `priority`
(`docs/architecture/07-rendering.md` §2.1).

###### Remarks

The `PreRender` render-sync system chooses it and assigns it to the Lite scene, so the value is
the one the **last rendered frame** used, not a live query. A world with no enabled camera
renders nothing and logs `IGX-0706` once.

###### Example

```ts
const ray = world.mainCamera?.screenToRay(event.offsetX, event.offsetY) ?? null;
```

###### Returns

[`Camera`](#camera) \| `null`

The main camera, or `null` when the world has none.

##### onEntityCreated

###### Get Signature

> **get** **onEntityCreated**(): [`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

Emitted for every entity the world creates.

###### Returns

[`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

The signal.

##### onEntityDestroyed

###### Get Signature

> **get** **onEntityDestroyed**(): [`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

Emitted for every entity the destroy flush releases.

###### Returns

[`Signal`](#signal-3)\<[`Entity`](#entity-4)\>

The signal.

##### onSceneLoaded

###### Get Signature

> **get** **onSceneLoaded**(): [`Signal`](#signal-3)\<[`SceneInstance`](#sceneinstance)\>

Emitted when a scene instance finishes loading. Never fires before Phase 2.

###### Returns

[`Signal`](#signal-3)\<[`SceneInstance`](#sceneinstance)\>

The signal.

##### onSceneUnloaded

###### Get Signature

> **get** **onSceneUnloaded**(): [`Signal`](#signal-3)\<[`SceneInstance`](#sceneinstance)\>

Emitted when a scene instance is unloaded. Never fires before Phase 2.

###### Returns

[`Signal`](#signal-3)\<[`SceneInstance`](#sceneinstance)\>

The signal.

##### registry

###### Get Signature

> **get** **registry**(): [`ComponentRegistry`](#componentregistry)

The component-class table.

###### Returns

[`ComponentRegistry`](#componentregistry)

The registry.

###### Implementation of

`WorldHost.registry`

##### scenes

###### Get Signature

> **get** **scenes**(): readonly [`SceneInstance`](#sceneinstance)[]

Every loaded scene instance, in load order; the implicit `"default"` scene is always first.

###### Returns

readonly [`SceneInstance`](#sceneinstance)[]

The live scene list.

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-16)

The world itself; `WorldHost` names it so entities can reach it.

###### Returns

[`World`](#world-16)

This world.

###### Implementation of

`WorldHost.world`

#### Methods

##### components()

> **components**\<`T`\>(`type`): readonly `T`[]

Every component of a class, by identity **and** inheritance — the primary iteration API for
systems (`docs/architecture/02-scene-graph.md` §9).

###### Type Parameters

###### T

`T` *extends* [`Component`](#abstract-component)

The component type.

###### Parameters

###### type

[`ComponentType`](#componenttype-1)\<`T`\>

The component class, abstract or concrete; `components(Script)` returns every
script.

###### Returns

readonly `T`[]

The live list. O(1) to obtain, stable within a phase, and never allocated per call.

##### createEntity()

> **createEntity**(`name?`, `options?`): [`Entity`](#entity-4)

Creates an entity with a transform and a Lite node.

###### Parameters

###### name?

`string`

The display name; defaults to `"Entity"`.

###### options?

[`CreateEntityOptions`](#createentityoptions)

The parent, the owning scene, and an initial world position and rotation.

###### Returns

[`Entity`](#entity-4)

The new entity, already active and registered.

###### Example

```ts
const hand = world.createEntity("Hand", { parent: player, position: { x: 0.3, y: 1.2, z: 0 } });
```

##### dispose()

> **dispose**(): `void`

Destroys every entity, cancels every coroutine, releases every Lite node, and clears every
index. The Lite scene itself belongs to the app and is left alone.

###### Returns

`void`

##### findAllByName()

> **findAllByName**(`name`): [`Entity`](#entity-4)[]

Every entity with a name, depth-first from the roots of every scene.

###### Parameters

###### name

`string`

The name to match exactly.

###### Returns

[`Entity`](#entity-4)[]

A freshly allocated array; empty when nothing matches.

##### findByName()

> **findByName**(`name`): [`Entity`](#entity-4) \| `null`

The first entity with a name, depth-first from the roots of every scene.

###### Parameters

###### name

`string`

The name to match exactly.

###### Returns

[`Entity`](#entity-4) \| `null`

The first match, or `null`.

###### Remarks

Linear in the number of entities, and names are not unique: this is a prototyping and tooling
convenience, not a lookup the engine itself uses
(`docs/architecture/02-scene-graph.md` §4).

##### findByTag()

> **findByTag**(`tag`): readonly [`Entity`](#entity-4)[]

Every entity carrying a tag.

###### Parameters

###### tag

`string`

The tag.

###### Returns

readonly [`Entity`](#entity-4)[]

The live list of tagged entities. A tag nothing carries yields a shared frozen empty
array.

###### Remarks

Indexed, not searched: the world maintains one array per tag as `tags.add`/`tags.delete` run
and as entities are destroyed, so this is O(1) to obtain and allocates nothing. The array is
**live** and its identity is stable for the tag's lifetime in this world, so it can be cached
in `awake`; treat it as read-only.

##### getComponentByHandle()

> **getComponentByHandle**(`handle`): [`Component`](#abstract-component) \| `null`

Resolves a dense component handle.

###### Parameters

###### handle

[`ComponentHandle`](#componenthandle-1)

The handle, as a Lite node's `metadata.ignifx` tag carries it.

###### Returns

[`Component`](#abstract-component) \| `null`

The component, or `null` when the handle is stale.

##### getEntity()

> **getEntity**(`uid`): [`Entity`](#entity-4) \| `null`

Looks an entity up by its stable identifier.

###### Parameters

###### uid

`string`

The ULID.

###### Returns

[`Entity`](#entity-4) \| `null`

The entity, or `null` when nothing in this world carries that uid.

##### getEntityByHandle()

> **getEntityByHandle**(`handle`): [`Entity`](#entity-4) \| `null`

Resolves a dense runtime handle.

###### Parameters

###### handle

[`EntityHandle`](#entityhandle-1)

The handle.

###### Returns

[`Entity`](#entity-4) \| `null`

The entity, or `null` when the handle is stale — a handle kept across a destroy never
resolves to whatever entity recycled the slot.

##### instantiate()

> **instantiate**(`scene`, `options?`): [`Entity`](#entity-4)

Instantiates a loaded scene asset as a prefab (ADR-0005) and answers with its root.

###### Parameters

###### scene

[`SceneAsset`](#sceneasset)

The loaded scene asset.

###### options?

[`InstantiateOptions`](#instantiateoptions)

Parent, owning instance, name, and initial placement.

###### Returns

[`Entity`](#entity-4)

The instance root.

###### Remarks

Synchronous, because a `SceneAsset` carries its dependencies already loaded. Every entity gets
a fresh uid and an `Entity.prefab` link (`02-scene-graph.md` §6, §10). A file with exactly one
root answers with that root; a file with several gets a container entity named after the scene,
so the call always answers with one entity.

`awake` follows the same rule as `addComponent`: queued for the frame's lifecycle flush, or run
nested and synchronously when `instantiate` is called from inside a callback
(`01-lifecycle-and-time.md` §4).

###### Throws

IgnifxError with code `IGX-0301` when a scene the file instances is not loaded, and
`IGX-0302` when instancing would nest a scene inside itself.

###### Example

```ts
const enemy = world.instantiate(enemyPrefab, { position: { x: 4, y: 0, z: 2 } });
```

##### instantiateAsync()

> **instantiateAsync**(`scene`, `options?`): `Promise`\<[`Entity`](#entity-4)\>

Loads a scene asset and instantiates it (`docs/architecture/02-scene-graph.md` §2).

###### Parameters

###### scene

`string` \| [`AssetRef`](#assetref-3)\<[`SceneAsset`](#sceneasset)\>

The scene address, or a reference carrying one.

###### options?

[`InstantiateOptions`](#instantiateoptions)

Parent, owning instance, name, and initial placement.

###### Returns

`Promise`\<[`Entity`](#entity-4)\>

The instance root, once the asset and its dependencies have loaded.

###### Example

```ts
const enemy = await world.instantiateAsync("prefabs/enemy.prefab.json");
```

##### loadScene()

> **loadScene**(`scene`, `options?`): `Promise`\<[`SceneInstance`](#sceneinstance)\>

Loads a scene file and builds its entities (`docs/architecture/02-scene-graph.md` §2).

###### Parameters

###### scene

`string` \| [`AssetRef`](#assetref-3)\<[`SceneAsset`](#sceneasset)\>

The scene address, or a reference carrying one.

###### options?

[`LoadSceneOptions`](#loadsceneoptions)

The mode, cancellation, progress, and whether to make the result active.

###### Returns

`Promise`\<[`SceneInstance`](#sceneinstance)\>

The instance, once every entity exists, every reference is resolved, and `awake` has
run.

###### Remarks

`"single"` (the default) unloads every instance that is not `persistent` first — the implicit
`"default"` scene is persistent, so entities created in code survive. The asset and everything
it references are loaded before a single entity is created, which is what lets `asset()` fields
be usable in `awake` (`06-serialization-and-scene-format.md` §4 step 2).

Construction happens in one synchronous block once the asset is in memory, so nothing observes
a half-built scene; `awake` and `onEnable` then run in tree order, through the world's own
lifecycle flush, before the returned promise settles. A component queued for `awake` by
something else earlier in the frame is flushed with it — the flush drains the whole queue, as
it does in the frame.

###### Throws

IgnifxError with code `IGX-0502` when `options.signal` aborts, and whatever the asset
system throws for a missing or malformed file.

###### Example

```ts
const level = await world.loadScene("levels/level01.scene.json", { mode: "additive" });
```

##### moveEntityToScene()

> **moveEntityToScene**(`entity`, `scene`): `void`

Moves a root entity and its subtree to another scene instance
(`docs/architecture/02-scene-graph.md` §6). This is the per-object equivalent of marking a
whole instance `persistent`.

###### Parameters

###### entity

[`Entity`](#entity-4)

The entity to move; it must be a root.

###### scene

[`SceneInstance`](#sceneinstance)

The instance that will own it.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0309` when the entity has a parent — a child follows its
parent's instance, so reparent it first — and `IGX-0101` when it has been destroyed.

###### Example

```ts
world.moveEntityToScene(player, world.scenes[0]);
```

##### raycastRender()

> **raycastRender**(`ray`, `options?`): [`RenderPick`](#renderpick) \| `null`

Casts a ray against every renderable mesh in the world, on the CPU
(`docs/architecture/07-rendering.md` §3).

###### Parameters

###### ray

[`Ray`](#ray)

The ray to cast.

###### options?

[`RenderPickOptions`](#renderpickoptions)

An entity filter.

###### Returns

[`RenderPick`](#renderpick) \| `null`

What was hit, or `null` for a miss.

###### Remarks

Distinct from a physics raycast (`09-physics.md` §5): this hits **render** geometry, including
meshes that carry no collider, and it ignores visibility — a hidden mesh still occludes, which
is Lite's documented behaviour (`src/lite/picking.ts`). It reads each mesh's CPU vertex copy, so
a mesh built from a GPU-only path is silently skipped and `app.renderer.pickAsync` is the exact
answer.

###### Example

```ts
const hit = world.raycastRender(camera.screenToRay(x, y) ?? createRay());
```

##### unloadScene()

> **unloadScene**(`instance`): `Promise`\<`void`\>

Unloads a scene instance: `onUnloading` fires while its entities are still valid, its roots are
destroyed through the normal destroy path (children before parents, `onDisable` then
`onDestroy`), and the assets it held are released
(`docs/architecture/02-scene-graph.md` §3).

###### Parameters

###### instance

[`SceneInstance`](#sceneinstance)

The instance to unload. Unloading the implicit `"default"` scene, or an
instance this world does not own, does nothing.

###### Returns

`Promise`\<`void`\>

A promise that settles once the destroy flush has run.

###### Example

```ts
await world.unloadScene(level);
```

## Interfaces

### ActionDefinition

One action of one map.

#### Properties

##### bindings

> `readonly` **bindings**: readonly [`BindingDefinition`](#bindingdefinition)[]

The bindings that feed it.

##### name

> `readonly` **name**: `string`

The action name game code asks for, for example `move`.

##### type?

> `readonly` `optional` **type?**: [`InputActionType`](#inputactiontype-1)

What the action produces. Defaults to `button`.

***

### ActionMapDefinition

One action map: a named context such as `Player`, `UI`, or `Vehicle`.

#### Properties

##### actions

> `readonly` **actions**: readonly [`ActionDefinition`](#actiondefinition)[]

The actions the map declares.

##### enabled?

> `readonly` `optional` **enabled?**: `boolean`

Whether the map starts enabled. Defaults to `true`.

##### name

> `readonly` **name**: `string`

The map name.

***

### ActionSetOptions

How a private action set differs from the document it is built from.

#### Properties

##### deviceSlot?

> `readonly` `optional` **deviceSlot?**: `number`

The gamepad slot every `<Gamepad>/…` path is pinned to. Defaults to `0`.

##### scheme?

> `readonly` `optional` **scheme?**: `string`

The control scheme to keep; `""` keeps every binding whatever its tag.

***

### App

The root object of a game and the surface a script sees through `this.app`
(`docs/architecture/00-overview.md` §1). There are no globals: every engine service is reached
from here, or from the `entity`/`world` a script belongs to (`CONSTITUTION.md` §3.6).

#### Remarks

Extensions add typed properties through declaration merging
(`docs/architecture/03-scripting-and-components.md` §7), so `this.app.input` is fully typed when
`@ignifx/input` is installed and a compile error when it is not.

#### Example

```ts
class Menu extends Script {
  static updateWhenPaused = true;
  onEnable(): void {
    this.app.pause();
  }
}
```

#### Properties

##### assets

> `readonly` **assets**: [`Assets`](#assets-1)

Addressed, reference-counted asset loading (`docs/architecture/05-assets-and-loading.md` §4).

##### audio

> `readonly` **audio**: [`AudioService`](#audioservice)

The audio service (`docs/architecture/10-audio.md` §1): the mixer tree, the unlock state,
one-shots, and the listener.

##### coroutines

> `readonly` **coroutines**: [`CoroutineHost`](#coroutinehost)

The coroutine scheduler.

##### diagnostics

> `readonly` **diagnostics**: [`Diagnostics`](#diagnostics-1)

Per-frame counters and profiling scopes.

##### events

> `readonly` **events**: [`AppEvents`](#appevents-1)

Engine-wide events (`docs/architecture/02-scene-graph.md` §8).

##### input

> `readonly` **input**: [`InputService`](#inputservice)

The input service (`docs/architecture/08-input.md` §1): devices, action maps, control
schemes, pointer lock, the cursor, and the frame's raw event stream.

##### isHeadless

> `readonly` **isHeadless**: `boolean`

`true` when the app runs on Lite's null engine with no render surface.

##### isRunning

> `readonly` **isRunning**: `boolean`

`true` between `start()` and `stop()`/`dispose()`.

##### lite

> `readonly` **lite**: [`AppLiteHandles`](#applitehandles)

Unstable Babylon Lite escape hatch (`docs/architecture/00-overview.md` §3).

##### log

> `readonly` **log**: [`Logger`](#logger)

The app-scoped logger.

##### onError

> `readonly` **onError**: [`Signal`](#signal-3)\<[`ErrorReport`](#errorreport)\>

Every failure the engine caught at a boundary rather than rethrowing.

##### platform

> `readonly` **platform**: [`PlatformInfo`](#platforminfo)

Where the app is running (`docs/architecture/14-platform-electron.md` §1). Phase 1 answers only
`kind`; the rest of §1's surface arrives with `@ignifx/electron`.

##### renderer

> `readonly` **renderer**: [`Renderer`](#renderer-1)

Surface sizing, material warm-up, GPU picking, screenshots, and the render diagnostics
(`docs/architecture/07-rendering.md` §1, §3, §5).

##### services

> `readonly` **services**: [`ServiceRegistry`](#serviceregistry)

Services registered by extensions.

##### settings

> `readonly` **settings**: [`AppSettings`](#appsettings-1)

Resolved project settings.

##### time

> `readonly` **time**: [`Time`](#time-3)

The clock.

##### version

> `readonly` **version**: `string`

The `@ignifx/core` version this app was built from.

##### world

> `readonly` **world**: [`World`](#world-16)

The running simulation.

#### Methods

##### dispose()

> **dispose**(): `void`

Stops the loop, disposes the world, the extensions, and the Lite objects.

###### Returns

`void`

##### pause()

> **pause**(): `void`

Sets `time.paused`.

###### Returns

`void`

##### registerComponents()

> **registerComponents**(`types`): `void`

Makes component `typeId`s known to the serializer and the inspector
(`docs/architecture/03-scripting-and-components.md` §4).

###### Parameters

###### types

readonly [`ConcreteComponentType`](#concretecomponenttype)\<[`Component`](#abstract-component)\>[]

The component classes to register.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0203` when a `typeId` is already registered.

##### resume()

> **resume**(): `void`

Clears `time.paused`.

###### Returns

`void`

##### start()

> **start**(): `Promise`\<`void`\>

Runs extension `onStart` hooks and starts the frame loop.

###### Returns

`Promise`\<`void`\>

A promise that settles once the first frame has been submitted.

##### step()

> **step**(`deltaSeconds`): `void`

Runs exactly one frame with a supplied delta — the headless driver
(`docs/architecture/01-lifecycle-and-time.md` §8).

###### Parameters

###### deltaSeconds

`number`

The raw frame delta in seconds, before the maximum-delta clamp.

###### Returns

`void`

##### stop()

> **stop**(): `void`

Stops the frame loop without disposing anything.

###### Returns

`void`

***

### AppEvents

The engine-wide events reached as `app.events` (`docs/architecture/02-scene-graph.md` §8,
`07-rendering.md` §4). Extensions add their own signals through declaration merging, the same way
they add app properties.

#### Example

```ts
class Hud extends Script {
  onEnable(): void {
    this.app.events.onSceneLoaded.connect((scene) => this.rebuild(scene), { owner: this });
  }
}
```

#### Properties

##### onDeviceLost

> `readonly` **onDeviceLost**: [`SignalLike`](#signallike)\<[`DeviceLostInfo`](#devicelostinfo)\>

The WebGPU device was lost; rendering is suspended while Lite rebuilds it.

##### onDeviceRecovered

> `readonly` **onDeviceRecovered**: [`SignalLike`](#signallike)

The WebGPU device and its resources were rebuilt.

##### onDeviceRecoveryFailed

> `readonly` **onDeviceRecoveryFailed**: [`SignalLike`](#signallike)\<`unknown`\>

Recovery failed; the payload is whatever the recovery path reported.

##### onSceneLoaded

> `readonly` **onSceneLoaded**: [`SignalLike`](#signallike)\<[`SceneInstance`](#sceneinstance)\>

A scene instance and its entities exist.

##### onSceneUnloaded

> `readonly` **onSceneUnloaded**: [`SignalLike`](#signallike)\<[`SceneInstance`](#sceneinstance)\>

A scene instance is about to be unloaded and its entities destroyed.

***

### AppLiteHandles

Babylon Lite objects an app owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3); excluded from the stability guarantees of
`CONSTITUTION.md` Article IV.

#### Properties

##### engine

> `readonly` **engine**: `EngineContext`

The Lite engine — a WebGPU engine, or the null engine in headless mode.

##### scene

> `readonly` **scene**: `SceneContext`

The Lite scene the world renders into.

***

### AppSettings

Resolved project settings, reached as `app.settings`
(`docs/architecture/04-extensions.md` §5). Each section is validated against the schema the
owning extension registered.

#### Properties

##### layers

> `readonly` **layers**: [`LayersSettings`](#layerssettings)

The core `layers` section.

##### sortingLayers

> `readonly` **sortingLayers**: [`SortingLayersSettings`](#sortinglayerssettings)

The core `sortingLayers` section.

##### time

> `readonly` **time**: [`TimeSettings`](#timesettings)

The core `time` section.

#### Methods

##### section()

> **section**\<`S`\>(`name`): `S`

Reads an extension-registered section.

###### Type Parameters

###### S

`S`

The section's resolved shape.

###### Parameters

###### name

`string`

The section name the extension registered.

###### Returns

`S`

The resolved section.

###### Throws

IgnifxError with code `IGX-0407` when the section was never registered.

***

### ArrayFieldSpec

Kind-specific data for `array`.

#### Properties

##### item

> `readonly` **item**: [`FieldDefinition`](#fielddefinition)\<`unknown`\>

The field definition every element follows.

##### kind

> `readonly` **kind**: `"array"`

The array kind.

***

### AssetFieldSpec

Kind-specific data for `asset`.

#### Properties

##### assetType

> `readonly` **assetType**: [`AssetTypeToken`](#assettypetoken)\<`unknown`\>

The asset class the field may point at.

##### kind

> `readonly` **kind**: `"asset"`

The asset-reference kind.

##### typeName

> `readonly` **typeName**: `string` \| `null`

The `type` discriminator written into files, or `null` when the address is unambiguous.

***

### AssetHandle

The reference-counted handle every load returns
(`docs/architecture/05-assets-and-loading.md` §3). Handles are shared: two loads of the same
`(address, type)` return the same object with `refCount` incremented, and each `load` must be
paired with exactly one [AssetHandle.release](#release).

#### Remarks

A handle never becomes an invalid object. After the last holder releases it and the collector
has run, `state` is `"released"` and reading `value` throws `IGX-0501`; loading the same address
again starts a fresh load and returns a fresh handle.

#### Example

```ts
const model = app.assets.load<ModelAsset>("models/hero.glb");
// In a coroutine: `yield model.promise` resumes on the first Update after delivery.
await model.promise;
model.release();
```

#### Type Parameters

##### T

`T` = `unknown`

The loaded value type.

#### Properties

##### address

> `readonly` **address**: `string`

The address this handle was requested under, fragment included.

##### error

> `readonly` **error**: [`AssetLoadError`](#assetloaderror) \| `null`

Why the load failed, or `null` when it has not.

##### onReplaced

> `readonly` **onReplaced**: [`SignalLike`](#signallike)\<`T`\>

Emitted at delivery when hot reload replaced the value; `value` is already the new one.

##### progress

> `readonly` **progress**: `number`

How far along the load is, in `[0, 1]`; bytes-weighted when the sizes are known.

##### promise

> `readonly` **promise**: `Promise`\<`T`\>

Resolves with [AssetHandle.value](#value) at delivery, or rejects with an [AssetLoadError](#assetloaderror).

##### refCount

> `readonly` **refCount**: `number`

How many holders the handle has.

##### state

> `readonly` **state**: [`AssetState`](#assetstate)

Where the handle is in its life.

##### type

> `readonly` **type**: `string`

The asset type the loader is registered under, for example `"model"`.

##### value

> `readonly` **value**: `T`

The loaded value.

###### Throws

IgnifxError with code `IGX-0501` unless `state` is `"loaded"`.

#### Methods

##### \[dispose\]()

> **\[dispose\]**(): `void`

Releases one holder when the handle leaves a `using` block — exactly [AssetHandle.release](#release)
(`docs/architecture/05-assets-and-loading.md` §3).

###### Returns

`void`

###### Example

```ts
using icon = app.assets.load<TextureAsset>("ui/icon.png");
await icon.promise;
```

##### release()

> **release**(): `void`

Removes a holder. At zero the asset is unloaded after `assets.gcDelay` seconds.

###### Returns

`void`

##### retain()

> **retain**(): `this`

Adds a holder.

###### Returns

`this`

This handle, so a retain reads inline.

***

### AssetLoader

How one asset type is turned into a value
(`docs/architecture/05-assets-and-loading.md` §5). Loaders are pure with respect to the world:
they produce values and never create entities.

#### Example

```ts
const jsonLoader: AssetLoader<unknown> = {
  type: "json",
  extensions: [".json"],
  load: (ctx) => ctx.fetchJson(),
};
```

#### Type Parameters

##### T

`T` = `unknown`

The value the loader produces.

#### Properties

##### extensions

> `readonly` **extensions**: readonly `string`[]

The address suffixes that select this loader, each with its leading dot.

##### type

> `readonly` **type**: `string`

The type name the loader is registered under, for example `"texture"`.

#### Methods

##### load()

> **load**(`ctx`): `Promise`\<`T`\>

Produces the value.

###### Parameters

###### ctx

[`LoaderContext`](#loadercontext)

The address, the fetch helpers, and the abort signal.

###### Returns

`Promise`\<`T`\>

The loaded value.

##### parseFragment()?

> `optional` **parseFragment**(`fragment`, `value`): `unknown`

Extracts a sub-asset named by an address fragment, such as `#animation:Run`.

###### Parameters

###### fragment

`string`

The text after `#`.

###### value

`T`

The base address's value.

###### Returns

`unknown`

The sub-asset.

###### Remarks

Declaring it is what makes `models/hero.glb#animation:Run` load the base address once and share
it: the fragment handle retains the base handle and its value is whatever this returns. A
loader that does not declare it is invoked with the fragment in [LoaderContext.fragment](#fragment)
and owns the whole address itself.

##### reload()?

> `optional` **reload**(`ctx`, `previous`): `Promise`\<`T`\>

Re-produces the value in development hot reload. Defaults to unload plus load.

###### Parameters

###### ctx

[`LoaderContext`](#loadercontext)

The context for the new load.

###### previous

`T`

The value being replaced.

###### Returns

`Promise`\<`T`\>

The new value.

##### unload()?

> `optional` **unload**(`value`, `ctx`): `void`

Releases whatever the value owns — GPU buffers, audio nodes, object URLs.

###### Parameters

###### value

`T`

The value [AssetLoader.load](#load) produced.

###### ctx

[`LoaderContext`](#loadercontext)

The same context the load ran with.

###### Returns

`void`

***

### AssetLoadErrorOptions

Options accepted by [AssetLoadError](#assetloaderror).

#### Extends

- [`IgnifxErrorOptions`](#ignifxerroroptions)

#### Properties

##### address

> `readonly` **address**: `string`

The address that failed.

##### cause?

> `optional` **cause?**: `unknown`

###### Inherited from

[`IgnifxErrorOptions`](#ignifxerroroptions).[`cause`](#cause-4)

##### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>\>

Identifiers that locate the failure. Defaults to an empty record.

###### Inherited from

[`IgnifxErrorOptions`](#ignifxerroroptions).[`context`](#context-4)

##### hint?

> `readonly` `optional` **hint?**: `string` \| `null`

One sentence telling the developer what to do about it. Defaults to `null`.

###### Inherited from

[`IgnifxErrorOptions`](#ignifxerroroptions).[`hint`](#hint-4)

##### mode?

> `readonly` `optional` **mode?**: [`ErrorFormatMode`](#errorformatmode)

How verbose `message` should be. Defaults to `"development"`.

###### Inherited from

[`IgnifxErrorOptions`](#ignifxerroroptions).[`mode`](#mode-3)

##### url

> `readonly` **url**: `string`

The URL it resolved to.

***

### AssetManifest

The address-to-URL table generated by `@ignifx/vite-plugin`
(`docs/architecture/05-assets-and-loading.md` §7).

#### Properties

##### entries

> `readonly` **entries**: readonly [`AssetManifestEntry`](#assetmanifestentry)[]

Every addressed file.

##### format

> `readonly` **format**: `"ignifx.manifest"`

The file's format discriminator.

##### formatVersion

> `readonly` **formatVersion**: `1`

The format version this build can read.

##### root

> `readonly` **root**: `string`

The asset root every relative address is resolved against.

***

### AssetManifestEntry

One address in the manifest (`docs/architecture/05-assets-and-loading.md` §7).

#### Properties

##### address

> `readonly` **address**: `string`

The address game code asks for.

##### bytes?

> `readonly` `optional` **bytes?**: `number`

The byte size, when the build knows it; it makes progress bytes-weighted.

##### groups?

> `readonly` `optional` **groups?**: readonly `string`[]

The group labels this entry belongs to, such as `"boot"` or `"level1"`.

##### hash?

> `readonly` `optional` **hash?**: `string`

The content hash, for cache validation.

##### meta?

> `readonly` `optional` **meta?**: [`JsonObject`](#jsonobject)

The `.meta.json` sidecar the build read for this address, verbatim
(`docs/architecture/05-assets-and-loading.md` §7). Loaders read the sub-object they own — the
texture loader reads `meta.texture`, the model loader reads `meta.model` — and ignore the rest,
so one sidecar can carry options for several tools.

###### Example

```json
{ "groups": ["level1"], "texture": { "srgb": true, "mipMaps": false } }
```

##### type?

> `readonly` `optional` **type?**: `string`

The asset type, when the extension does not identify it.

##### url

> `readonly` **url**: `string`

The URL to fetch, usually content-hashed in production builds.

***

### AssetProgress

The aggregate payload of [Assets.onProgress](#onprogress): how the current batch of work is going
(`docs/architecture/05-assets-and-loading.md` §4).

#### Properties

##### bytesLoaded

> `readonly` **bytesLoaded**: `number`

Bytes received so far.

##### bytesTotal

> `readonly` **bytesTotal**: `number`

Bytes expected, as far as the manifest and the response headers say.

##### loaded

> `readonly` **loaded**: `number`

How many of the loads in flight have settled.

##### total

> `readonly` **total**: `number`

How many loads are in the current run.

***

### AssetRef

The serializable form of an asset reference (`docs/architecture/05-assets-and-loading.md` §2).
It is a plain object so that it survives `JSON.stringify` and the schema codec unchanged; the way
to turn one into a handle is `app.assets.load(ref)`, never a method on the reference.

#### Example

```ts
const hero: AssetRef<ModelAsset> = assetRef("models/hero.glb");
const handle = app.assets.load(hero);
```

#### Type Parameters

##### T

`T` = `unknown`

The loaded value type this reference points at. It is a compile-time marker only:
`assetOf` is never assigned at runtime and is never serialized. It exists so that
`AssetRef<TextureAsset>` and `AssetRef<ModelAsset>` are different types.

#### Properties

##### address

> `readonly` **address**: `string`

The address, for example `models/hero.glb` or `sprites/ui.atlas.json#frame:button_idle`.

##### assetOf?

> `readonly` `optional` **assetOf?**: `T`

Compile-time marker for the loaded value type; never present at runtime.

##### type?

> `readonly` `optional` **type?**: `string`

The asset type name, when the address alone does not identify it.

***

### AssetRefValue

The plain, serializable form of an asset reference: what `{ "$asset": … }` decodes to before the
asset service turns it into a handle, and what a tool that reads a scene file without an app
works with (`docs/architecture/05-assets-and-loading.md` §2).

#### Remarks

It is **not** the runtime value of an `asset()` field. Since Phase 2 that value is
`AssetHandle<A> | null`: a component receives the handle already loaded
(`docs/architecture/05-assets-and-loading.md` §3), so `this.mesh?.value` reaches the asset with no
second lookup. The two shapes overlap on `address`/`type`, which is why the encoder accepts
either.

#### Type Parameters

##### A

`A`

The asset value type this reference points at. It is a compile-time marker only:
`assetOf` is never assigned at runtime and is never serialized. It exists so that
`AssetRefValue<Texture>` and `AssetRefValue<Mesh>` are different types.

#### Properties

##### address

> `readonly` **address**: `string`

The address the asset is registered under, for example `models/hero.glb#mesh:Body`.

##### assetOf?

> `readonly` `optional` **assetOf?**: `A`

Compile-time marker for the asset type; never present at runtime.

##### type?

> `readonly` `optional` **type?**: `string`

The asset type name, when the address alone does not identify it.

***

### Assets

The asset service, reached as `app.assets`
(`docs/architecture/05-assets-and-loading.md` §4).

#### Example

```ts
const batch = app.assets.loadAll(["ui/font.ttf", "sprites/hero.png"]);
app.assets.onProgress.connect((p) => bar.set(p.loaded / p.total));
await batch.promise;
```

#### Properties

##### gcDelay

> **gcDelay**: `number`

How many seconds a zero-reference asset stays cached. `0` unloads at the next delivery.

##### manifest

> `readonly` **manifest**: [`AssetManifest`](#assetmanifest)

The address-to-URL table, empty until a build supplies one.

##### onProgress

> `readonly` **onProgress**: [`SignalLike`](#signallike)\<[`AssetProgress`](#assetprogress)\>

Emitted at delivery whenever the aggregate progress of the loads in flight changed.

#### Methods

##### gc()

> **gc**(): `void`

Unloads every zero-reference asset now, without waiting for [Assets.gcDelay](#gcdelay).

###### Returns

`void`

##### get()

> **get**\<`T`\>(`address`): [`AssetHandle`](#assethandle)\<`T`\> \| `null`

Looks a cached handle up without changing its reference count.

###### Type Parameters

###### T

`T`

The loaded value type.

###### Parameters

###### address

`string`

The address, fragment included.

###### Returns

[`AssetHandle`](#assethandle)\<`T`\> \| `null`

The handle, or `null` when the address is not cached.

##### load()

> **load**\<`T`\>(`ref`, `options?`): [`AssetHandle`](#assethandle)\<`T`\>

Requests an asset and returns its handle immediately.

###### Type Parameters

###### T

`T`

The loaded value type.

###### Parameters

###### ref

`string` \| [`AssetRef`](#assetref-3)\<`T`\>

The address, or a reference carrying one.

###### options?

[`LoadOptions`](#loadoptions)

Priority, type, progress, and cancellation.

###### Returns

[`AssetHandle`](#assethandle)\<`T`\>

The shared handle, with one more holder.

###### Remarks

Completion is delivered in the `PreUpdate` phase of a later frame, never mid-phase: `state`
flips and `promise` settles at that one point
(`docs/architecture/01-lifecycle-and-time.md` §3 step 2).

An `options.signal` abort drops *this* request's hold. It aborts the shared load only when no
other request is still interested in it; a load two scripts asked for keeps going when one of
them cancels, and the shared handle still resolves.

###### Throws

IgnifxError with code `IGX-0504` when no loader claims the address, or `IGX-0106` when
the app has been disposed.

##### loadAll()

> **loadAll**(`refs`, `options?`): [`BatchHandle`](#batchhandle)

Requests several assets as one batch.

###### Parameters

###### refs

readonly (`string` \| [`AssetRef`](#assetref-3)\<`unknown`\>)[]

The addresses or references.

###### options?

[`LoadOptions`](#loadoptions)

Priority, type, progress, and cancellation, applied to every member.

###### Returns

[`BatchHandle`](#batchhandle)

The batch.

##### loadAsync()

> **loadAsync**\<`T`\>(`ref`, `options?`): `Promise`\<[`AssetHandle`](#assethandle)\<`T`\>\>

Requests an asset and waits for the same delivery point [Assets.load](#load-1) settles at.

###### Type Parameters

###### T

`T`

The loaded value type.

###### Parameters

###### ref

`string` \| [`AssetRef`](#assetref-3)\<`T`\>

The address, or a reference carrying one.

###### options?

[`LoadOptions`](#loadoptions)

Priority, type, progress, and cancellation.

###### Returns

`Promise`\<[`AssetHandle`](#assethandle)\<`T`\>\>

The handle, once it has loaded.

##### preloadGroup()

> **preloadGroup**(`group`, `options?`): [`BatchHandle`](#batchhandle)

Loads every manifest entry carrying a group label.

###### Parameters

###### group

`string`

The label, such as `"boot"`.

###### options?

[`LoadOptions`](#loadoptions)

Priority, progress, and cancellation.

###### Returns

[`BatchHandle`](#batchhandle)

The batch; empty when the manifest knows no such group.

##### register()

> **register**\<`T`\>(`value`, `options`): [`AssetHandle`](#assethandle)\<`T`\>

Publishes a value built in code as an asset, so an `asset()` field can hold it
(`docs/architecture/05-assets-and-loading.md` §3). This is what `MeshAsset.box(…)` and
`MaterialAsset.pbr(…)` return.

###### Type Parameters

###### T

`T`

The value type.

###### Parameters

###### value

`T`

The already-built value.

###### options

[`RegisterAssetOptions`](#registerassetoptions)

The asset type it is registered under, and an explicit address to publish it
at instead of the generated one.

###### Returns

[`AssetHandle`](#assethandle)\<`T`\>

The handle, with one holder.

###### Remarks

The handle is created already `loaded`, under a synthetic `memory:<type>/<ulid>` address, with
one holder — the caller. It plays by the ordinary rules from there: `retain`/`release` count,
the collector unloads it `gcDelay` seconds after the last holder lets go, and the registered
type's loader `unload` runs then if one exists. Because the address names no file, serializing
a component that references it writes `null` and reports the loss.

###### Example

```ts
using box = app.assets.register(mesh, { type: "mesh" });
```

##### registerLoader()

> **registerLoader**(`loader`): `void`

Registers a loader. Extensions normally call `ctx.registerAssetLoader` instead.

###### Parameters

###### loader

[`AssetLoader`](#assetloader)

The loader.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0506` when the type is already registered.

##### registerType()

> **registerType**(`type`): `void`

Declares an asset type that has no loader yet.

###### Parameters

###### type

[`AssetTypeDefinition`](#assettypedefinition)

The type name and the extensions that select it.

###### Returns

`void`

##### release()

> **release**(`handleOrAddress`): `void`

Removes one holder from a handle, by object or by address.

###### Parameters

###### handleOrAddress

`string` \| [`AssetHandle`](#assethandle)\<`unknown`\>

The handle, or the address it was requested under.

###### Returns

`void`

##### resolveUrl()

> **resolveUrl**(`address`): `string`

Resolves an address to the URL the service fetches.

###### Parameters

###### address

`string`

The address; the fragment is stripped.

###### Returns

`string`

The manifest's URL for the address, or `<root>/<address>`.

***

### AssetsCreateOptions

The asset options [CreateAppOptions.assets](#assets-2) carries.

#### Properties

##### fetch?

> `readonly` `optional` **fetch?**: (`input`, `init?`) => `Promise`\<`Response`\>

The `fetch` every asset read goes through. Defaults to `globalThis.fetch`.

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

###### Parameters

###### input

`RequestInfo` \| `URL`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### manifest?

> `readonly` `optional` **manifest?**: [`AssetManifest`](#assetmanifest)

The address-to-URL table. Defaults to an empty manifest rooted at the `assets` setting.

***

### AssetsSettings

The `assets` project settings section
(`docs/architecture/04-extensions.md` §5, `05-assets-and-loading.md` §4).

#### Properties

##### concurrency

> `readonly` **concurrency**: `number`

How many fetches may be in flight at once. Defaults to `6`.

##### gcDelay

> `readonly` **gcDelay**: `number`

How many seconds a zero-reference asset stays cached. Defaults to `5`.

##### preload

> `readonly` **preload**: readonly `string`[]

Manifest group labels loaded during `app.start()`. Defaults to none.

##### retries

> `readonly` **retries**: `number`

How many times a failed fetch is retried. Defaults to `2`.

##### root

> `readonly` **root**: `string`

The asset root relative addresses resolve against. Defaults to `"assets"`.

***

### AssetTypeDefinition

An asset type declared without a loader, so that addresses resolve to a type before the loader
that reads them is registered (`docs/architecture/04-extensions.md` §1).

#### Properties

##### extensions

> `readonly` **extensions**: readonly `string`[]

The address suffixes that select it, each with its leading dot.

##### type

> `readonly` **type**: `string`

The type name, for example `"texture"`.

***

### AssetTypeToken

How an asset class is named in a schema. Like [ComponentTypeToken](#componenttypetoken), a class satisfies it
structurally; `assetType` supplies the `type` discriminator written into `{ "$asset": … }` when
the loader cannot infer it from the address extension
(`docs/architecture/05-assets-and-loading.md` §2).

#### Type Parameters

##### A

`A`

The asset value type the token stands for.

#### Properties

##### assetType?

> `readonly` `optional` **assetType?**: `string`

The asset type name written into files when the extension is ambiguous.

##### prototype

> `readonly` **prototype**: `A`

The instance shape the token names.

***

### AudioBackend

The audio implementation behind `app.audio`
(`docs/architecture/10-audio.md` §1, §7).

#### Remarks

A game never touches this. It exists so the service and the components have exactly one thing to
talk to, and so `audio({ createBackend })` can substitute a recording double in a test.

#### Example

```ts
const app = await createApp({ headless: true, extensions: [audio({ createBackend: () => spy })] });
```

#### Properties

##### kind

> `readonly` **kind**: [`AudioBackendKind`](#audiobackendkind-1)

Which implementation this is.

##### lite

> `readonly` **lite**: [`AudioLiteHandles`](#audiolitehandles) \| `null`

The Lite objects this backend owns, or `null` when it owns none.

##### onStateChanged

> `readonly` **onStateChanged**: [`SignalLike`](#signallike)\<[`AudioBackendState`](#audiobackendstate-1)\>

Emitted whenever [AudioBackend.state](#state-1) changes.

##### state

> `readonly` **state**: [`AudioBackendState`](#audiobackendstate-1)

The audio context's current state.

#### Methods

##### createBus()

> **createBus**(`request`): `Promise`\<[`BackendBus`](#backendbus)\>

Creates one mixer bus.

###### Parameters

###### request

[`BackendBusRequest`](#backendbusrequest)

The name, gain, and parent bus.

###### Returns

`Promise`\<[`BackendBus`](#backendbus)\>

The bus.

##### createSound()

> **createSound**(`request`): [`BackendSound`](#backendsound) \| `Promise`\<[`BackendSound`](#backendsound)\>

Creates a playable sound.

###### Parameters

###### request

[`BackendSoundRequest`](#backendsoundrequest)

The clip, routing, and per-sound options.

###### Returns

[`BackendSound`](#backendsound) \| `Promise`\<[`BackendSound`](#backendsound)\>

The sound, or a promise for it when the backend has to decode first.

##### decode()

> **decode**(`clip`): `Promise`\<`void`\>

Decodes a static clip's bytes into a buffer every sound built from it can share, and records
the exact duration on the clip. Calling it twice is a no-op, and a backend that never decodes —
the headless one — does nothing at all.

###### Parameters

###### clip

[`AudioClip`](#audioclip)

The clip to decode.

###### Returns

`Promise`\<`void`\>

A promise that settles once the clip is playable.

##### dispose()

> **dispose**(): `void`

Releases everything the backend owns, including the audio context.

###### Returns

`void`

##### disposeBus()

> **disposeBus**(`bus`): `void`

Releases a bus and its sub-graph.

###### Parameters

###### bus

[`BackendBus`](#backendbus)

The bus.

###### Returns

`void`

##### disposeSound()

> **disposeSound**(`sound`): `void`

Releases a sound and its sub-graph.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

##### getMasterVolume()

> **getMasterVolume**(): `number`

Reads the master output gain.

###### Returns

`number`

The gain, where `1` is unity.

##### pause()

> **pause**(`sound`): `void`

Pauses every instance of a sound, keeping its position.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

##### play()

> **play**(`sound`, `request`): `void`

Starts one new instance of a sound, stealing the oldest when `maxInstances` is reached. A
paused sound is resumed instead, which is Babylon Lite's documented behaviour
(`index.d.ts` 8955).

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### request

[`BackendPlayRequest`](#backendplayrequest)

The per-play overrides.

###### Returns

`void`

##### resume()

> **resume**(`sound`): `void`

Resumes a paused sound.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

##### setBusVolume()

> **setBusVolume**(`bus`, `volume`): `void`

Sets a bus's own gain.

###### Parameters

###### bus

[`BackendBus`](#backendbus)

The bus.

###### volume

`number`

The gain to apply now.

###### Returns

`void`

##### setListener()

> **setListener**(`target`): `void`

Points the spatial listener at a world transform.

###### Parameters

###### target

`SpatialTarget` \| `null`

The transform to follow, or `null` to leave the listener at the world origin.

###### Returns

`void`

##### setMasterVolume()

> **setMasterVolume**(`volume`): `void`

Sets the master output gain.

###### Parameters

###### volume

`number`

The gain to apply now, where `1` is unity.

###### Returns

`void`

##### setSoundPan()

> **setSoundPan**(`sound`, `pan`): `void`

Sets a non-spatial sound's stereo pan.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### pan

`number`

The pan in `[-1, 1]`.

###### Returns

`void`

##### setSoundVolume()

> **setSoundVolume**(`sound`, `volume`): `void`

Sets a sound's gain.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### volume

`number`

The gain to apply now.

###### Returns

`void`

##### stop()

> **stop**(`sound`): `void`

Stops every instance of a sound immediately. Fading is the service's job, so that both
backends fade identically.

###### Parameters

###### sound

[`BackendSound`](#backendsound)

The sound.

###### Returns

`void`

##### unlock()

> **unlock**(): `Promise`\<`void`\>

Resumes a suspended context — what a "tap to start" prompt calls.

###### Returns

`Promise`\<`void`\>

A promise that settles once the context is running, or immediately when the backend
needs no gesture.

##### update()

> **update**(`deltaSeconds`): `void`

Advances the backend by one frame: the web backend pumps `updateSpatialAudio`, the headless
backend advances simulated playback and fires `onEnded`.

###### Parameters

###### deltaSeconds

`number`

The frame delta in seconds.

###### Returns

`void`

***

### AudioBackendContext

What a backend factory is handed (`audio({ createBackend })`).

#### Properties

##### audioContext

> `readonly` **audioContext**: `BaseAudioContext` \| `null`

An existing Web Audio context to build the engine on — an `OfflineAudioContext` in tests.

##### isHeadless

> `readonly` **isHeadless**: `boolean`

`true` when the app runs with no render surface.

##### masterVolume

> `readonly` **masterVolume**: `number`

The initial master gain.

***

### AudioBus

A named gain in the mixer tree.

#### Example

```ts
app.audio.bus("Music").setVolume(0.2, 1.5); // duck the music over a second and a half
app.audio.bus("SFX").muted = true;
```

#### Properties

##### effectiveVolume

> `readonly` **effectiveVolume**: `number`

The gain that actually reaches the output: this bus's applied gain times its parents'.

##### lite

> `readonly` **lite**: `AudioBus` \| `null`

Lite's bus, or `null` under the headless backend. Unstable escape hatch.

##### muted

> **muted**: `boolean`

Silences the bus and everything under it without losing [AudioBus.volume](#volume).

##### name

> `readonly` **name**: `string`

The bus name; what `AudioSource.bus` and `app.audio.bus(name)` use.

##### parent

> `readonly` **parent**: [`AudioBus`](#audiobus) \| `null`

The bus this one routes into, or `null` for the root.

##### pausable

> `readonly` **pausable**: `boolean`

Whether `app.pause()` pauses the sounds routed directly to this bus.

##### volume

> **volume**: `number`

This bus's own linear gain, ignoring its parents. Setting it applies immediately.

#### Methods

##### setVolume()

> **setVolume**(`volume`, `rampSeconds?`): `void`

Fades this bus's own gain.

###### Parameters

###### volume

`number`

The target linear gain.

###### rampSeconds?

`number`

How long the fade takes, in frame time; `0` applies immediately.

###### Returns

`void`

***

### AudioBusDefinition

One bus of a tree, as the file declares it and as `app.audio` builds it.

#### Properties

##### name

> `readonly` **name**: `string`

The bus name, unique within the tree; what `app.audio.bus(name)` and `AudioSource.bus` use.

##### parent

> `readonly` **parent**: `string` \| `null`

The bus this one routes into, or `null` for the root.

##### pausable

> `readonly` **pausable**: `boolean` \| `null`

Whether `app.pause()` pauses the sounds on this bus. `null` defers to the `audio` settings
section's `pausableBuses` list, which is the usual case.

##### volume

> `readonly` **volume**: `number`

The bus's own linear gain, in `[0, 1]`. Defaults to `1`.

***

### AudioClipInit

What the loader hands [AudioClip](#audioclip)'s constructor.

#### Properties

##### address

> `readonly` **address**: `string`

The address the clip was loaded from, fragment included.

##### bytes

> `readonly` **bytes**: `ArrayBuffer` \| `null`

The undecoded bytes, kept only until a backend decodes them; `null` for a streaming clip and
for a headless load, neither of which will ever decode.

##### channels

> `readonly` **channels**: `number` \| `null`

How many channels the data holds, or `null` when unknown.

##### duration

> `readonly` **duration**: `number` \| `null`

The playing length in seconds, or `null` when this build cannot tell yet.

##### isStreaming

> `readonly` **isStreaming**: `boolean`

Whether the clip streams from a media element rather than decoding into memory.

##### sampleRate

> `readonly` **sampleRate**: `number` \| `null`

Samples per second, or `null` when unknown.

##### url

> `readonly` **url**: `string`

The URL the address resolved to; a streaming clip plays straight from it.

***

### AudioClipLiteHandles

The Babylon Lite objects an [AudioClip](#audioclip) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### buffer

> `readonly` **buffer**: `SoundBuffer` \| `null`

The decoded buffer shared by every sound built from this clip, or `null` — headless always,
streaming always, and in a browser until the first sound is created from the clip.

***

### AudioClipLoaderOptions

Options accepted by [createAudioClipLoader](#createaudiocliploader).

#### Properties

##### decoder

> `readonly` **decoder**: () => [`AudioDecoder`](#audiodecoder) \| `null`

Returns the decoder to run on a freshly loaded static clip, or `null` to leave the clip
undecoded until a source plays it.

###### Returns

[`AudioDecoder`](#audiodecoder) \| `null`

***

### AudioConeSettings

The directional cone of a spatial source, in **degrees** (`docs/architecture/10-audio.md` §3).
`360` on both angles is an omnidirectional source, which is the default.

#### Properties

##### innerAngle

> **innerAngle**: `number`

The angle inside which the source is heard at full volume.

##### outerAngle

> **outerAngle**: `number`

The angle outside which the source is heard at `outerVolume`.

##### outerVolume

> **outerVolume**: `number`

The gain outside the outer cone, in `[0, 1]`.

***

### AudioErrorOptions

Options accepted by [audioError](#audioerror): the same subset of `IgnifxErrorOptions` this package uses.

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

### AudioLiteHandles

The Babylon Lite objects an [AudioBackend](#audiobackend) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3); `null` on the headless backend, which owns none.

#### Properties

##### engine

> `readonly` **engine**: `AudioEngine`

Lite's audio engine (`index.d.ts` 926).

***

### AudioOptions

What `audio()` accepts. Every field that names a settings value overrides the matching `audio`
section value, which is the shape `04-extensions.md` §1 shows for `physics()`.

#### Properties

##### audioContext?

> `readonly` `optional` **audioContext?**: `BaseAudioContext` \| `null`

An existing Web Audio context to build the engine on. Pass an `OfflineAudioContext` to render
deterministically in a browser test.

##### buses?

> `readonly` `optional` **buses?**: `string`

The address of the `.audio.json` bus tree; empty builds [AudioOptions.defaultBuses](#defaultbuses).

##### busTree?

> `readonly` `optional` **busTree?**: readonly [`AudioBusDefinition`](#audiobusdefinition)[]

The bus tree, given directly instead of through a file. It is the only way to have a custom
tree in place before the first frame, because a file has to be delivered first.

##### createBackend?

> `readonly` `optional` **createBackend?**: (`context`) => [`AudioBackend`](#audiobackend) \| `Promise`\<[`AudioBackend`](#audiobackend)\>

Builds the backend. Defaults to the Web Audio backend in a browser and the headless one
everywhere else; a test passes a recording double, or a `HeadlessBackend` configured to start
suspended so the unlock flow can be exercised under Node.

###### Parameters

###### context

[`AudioBackendContext`](#audiobackendcontext)

###### Returns

[`AudioBackend`](#audiobackend) \| `Promise`\<[`AudioBackend`](#audiobackend)\>

##### defaultBuses?

> `readonly` `optional` **defaultBuses?**: readonly `string`[]

The tree built when neither a file nor `busTree` is given; the first name is the root.

##### masterVolume?

> `readonly` `optional` **masterVolume?**: `number`

The master output gain the app starts at.

##### pausableBuses?

> `readonly` `optional` **pausableBuses?**: readonly `string`[]

Which buses `app.pause()` pauses.

##### pauseWithApp?

> `readonly` `optional` **pauseWithApp?**: `boolean`

Whether `app.pause()` pauses the sounds on pausable buses.

##### queueWhileLocked?

> `readonly` `optional` **queueWhileLocked?**: `boolean`

Whether plays made before the first unlock are queued rather than dropped.

***

### AudioServiceLiteHandles

The Babylon Lite objects `app.audio` owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### engine

> `readonly` **engine**: `AudioEngine` \| `null`

Lite's audio engine, or `null` under the headless backend.

***

### AudioServiceOptions

What [AudioService](#audioservice)'s constructor is handed. The extension builds this; a game never does.

#### Properties

##### app

> `readonly` **app**: [`App`](#app)

The app the service belongs to.

##### backend

> `readonly` **backend**: [`AudioBackend`](#audiobackend)

The backend every call is forwarded to.

##### log

> `readonly` **log**: [`Logger`](#logger)

A logger scoped to the extension.

##### settings

> `readonly` **settings**: [`AudioSettings`](#audiosettings)

The resolved `audio` settings section, with the extension's options merged over it.

***

### AudioSettings

The resolved `audio` settings section.

#### Example

```ts
// ignifx.config.ts
export default defineConfig({ audio: { buses: "audio/buses.audio.json", masterVolume: 0.8 } });
```

#### Properties

##### buses

> `readonly` **buses**: `string`

The address of the `.audio.json` bus tree loaded at startup; empty builds the defaults.

##### defaultBuses

> `readonly` **defaultBuses**: readonly `string`[]

The tree built when `buses` is empty: the first name is the root, the rest route into it.

##### masterVolume

> `readonly` **masterVolume**: `number`

The master output gain the app starts at, in `[0, 1]`.

##### pausableBuses

> `readonly` **pausableBuses**: readonly `string`[]

Which buses `app.pause()` pauses. A bus file's own `pausable` field overrides this per bus.

##### pauseWithApp

> `readonly` **pauseWithApp**: `boolean`

Whether `app.pause()` pauses the sounds on pausable buses.

##### queueWhileLocked

> `readonly` **queueWhileLocked**: `boolean`

Whether `play()` calls made before the first unlock are queued and flushed on unlock.

***

### BackendBus

A mixer bus as the backend knows it: an opaque token the service hands back with every sound it
creates.

#### Properties

##### lite

> `readonly` **lite**: `AudioBus` \| `null`

Lite's bus, or `null` on the headless backend. Unstable escape hatch.

##### name

> `readonly` **name**: `string`

The bus name, as the tree declared it.

***

### BackendBusRequest

What [AudioBackend.createBus](#createbus) is asked for.

#### Properties

##### name

> `readonly` **name**: `string`

The bus name.

##### parent

> `readonly` **parent**: [`BackendBus`](#backendbus) \| `null`

The bus it outputs into, or `null` to output into the engine's main bus.

##### volume

> `readonly` **volume**: `number`

Its own linear gain, before the parent chain.

***

### BackendPlayRequest

The per-play overrides [AudioBackend.play](#play) applies, matching Babylon Lite's
`StaticSoundPlayOptions` (`index.d.ts` 12375).

#### Properties

##### delay

> `readonly` **delay**: `number`

How long to wait before the instance starts, in seconds.

##### duration

> `readonly` **duration**: `number`

How long the instance plays, in seconds; `0` means "to the end of the clip".

##### loop

> `readonly` **loop**: `boolean`

Whether the instance loops.

##### playbackRate

> `readonly` **playbackRate**: `number`

The instance's playback rate.

##### startOffset

> `readonly` **startOffset**: `number`

Where in the clip the instance starts, in seconds.

##### volume

> `readonly` **volume**: `number`

The instance's linear gain.

***

### BackendSound

A playable sound as the backend knows it: one clip routed to one bus, able to carry several
concurrent instances (Babylon Lite's `StaticSound`/`StreamingSound` model, `index.d.ts` 12336 and
12499).

#### Remarks

There is deliberately no `onEnded` here. Lite raises its own `onEnded` from a Web Audio `ended`
event, which lands at an arbitrary point between frames, and a stopped sound raises it too; the
service instead polls [BackendSound.isPlaying](#isplaying-1) once per frame in the `PreRender` pump and
raises `SoundInstance.onEnded` there. That is what makes "the sound finished" arrive at a defined
point in the frame, the same way every other engine event does, and identical on both backends.

#### Properties

##### instanceCount

> `readonly` **instanceCount**: `number`

How many instances of this sound are live.

##### isPaused

> `readonly` **isPaused**: `boolean`

`true` when every instance has been paused.

##### isPlaying

> `readonly` **isPlaying**: `boolean`

`true` while at least one instance is playing or about to.

***

### BackendSoundRequest

What [AudioBackend.createSound](#createsound) is asked for.

#### Properties

##### bus

> `readonly` **bus**: [`BackendBus`](#backendbus) \| `null`

The bus it routes into, or `null` for the engine's main bus.

##### clip

> `readonly` **clip**: [`AudioClip`](#audioclip)

The clip to play.

##### loop

> `readonly` **loop**: `boolean`

Whether instances loop.

##### maxInstances

> `readonly` **maxInstances**: `number`

How many instances may play at once; the oldest is stolen above it.

##### pan

> `readonly` **pan**: `number`

Stereo pan in `[-1, 1]` for a non-spatial sound.

##### playbackRate

> `readonly` **playbackRate**: `number`

Playback rate multiplier; ignifx's `pitch` field maps onto it.

##### spatial

> `readonly` **spatial**: [`BackendSpatialRequest`](#backendspatialrequest) \| `null`

The 3D placement, or `null` for a non-spatial sound.

##### volume

> `readonly` **volume**: `number`

The sound's own linear gain.

***

### BackendSpatialRequest

The 3D placement of a spatial sound, already converted into the units Babylon Lite wants: angles
in **radians** (`SpatialSoundOptions`, `index.d.ts` 11771), distances in metres.

#### Properties

##### attachedTo

> `readonly` **attachedTo**: `SpatialTarget` \| `null`

The world transform the source follows, or `null` to stay at the origin.

##### coneInnerAngleRadians

> `readonly` **coneInnerAngleRadians**: `number`

Cone inner angle in radians; `2π` for an omnidirectional source.

##### coneOuterAngleRadians

> `readonly` **coneOuterAngleRadians**: `number`

Cone outer angle in radians.

##### coneOuterVolume

> `readonly` **coneOuterVolume**: `number`

Gain outside the outer cone, in `[0, 1]`.

##### distanceModel

> `readonly` **distanceModel**: `"linear"` \| `"inverse"` \| `"exponential"`

Which attenuation curve to use.

##### maxDistance

> `readonly` **maxDistance**: `number`

Maximum distance, used by the `"linear"` model.

##### minDistance

> `readonly` **minDistance**: `number`

Reference distance below which no attenuation is applied.

##### rolloffFactor

> `readonly` **rolloffFactor**: `number`

Attenuation roll-off factor.

***

### BatchHandle

A group of loads requested together
(`docs/architecture/05-assets-and-loading.md` §4).

#### Properties

##### handles

> `readonly` **handles**: readonly [`AssetHandle`](#assethandle)\<`unknown`\>[]

The handles the batch retains.

##### progress

> `readonly` **progress**: `number`

The mean of the batch's handle progresses, in `[0, 1]`.

##### promise

> `readonly` **promise**: `Promise`\<`void`\>

Settles once every handle in the batch has settled; rejects with the first failure.

#### Methods

##### cancel()

> **cancel**(): `void`

Aborts every load the batch started and releases it.

###### Returns

`void`

##### release()

> **release**(): `void`

Releases every handle the batch retains. Calling it twice is a no-op.

###### Returns

`void`

***

### BindingContext

What evaluation needs to know about the frame.

#### Properties

##### currentScheme

> `readonly` **currentScheme**: `string`

The control scheme in use this frame.

##### strictSchemes

> `readonly` **strictSchemes**: `boolean`

`true` when bindings tagged with another control scheme must not resolve.

##### uiHasFocus

> `readonly` **uiHasFocus**: `boolean`

`true` while a DOM text field has focus; keyboard controls then read as released.

***

### BindingDefinition

One binding of one action, as it appears in a document. A binding is either a single `path` or a
`composite` whose named parts each carry a path.

#### Example

```json
{ "composite": "2DVector", "up": "<Keyboard>/w", "down": "<Keyboard>/s",
  "left": "<Keyboard>/a", "right": "<Keyboard>/d" }
```

#### Properties

##### button?

> `readonly` `optional` **button?**: `string`

The `ButtonWithModifier` button part.

##### composite?

> `readonly` `optional` **composite?**: `string`

The composite name, for a composite binding.

##### down?

> `readonly` `optional` **down?**: `string`

The `2DVector` down part.

##### left?

> `readonly` `optional` **left?**: `string`

The `2DVector` left part.

##### modifier?

> `readonly` `optional` **modifier?**: `string`

The `ButtonWithModifier` modifier part.

##### negative?

> `readonly` `optional` **negative?**: `string`

The `1DAxis` negative part.

##### path?

> `readonly` `optional` **path?**: `string`

The control path, for a simple binding.

##### positive?

> `readonly` `optional` **positive?**: `string`

The `1DAxis` positive part.

##### processors?

> `readonly` `optional` **processors?**: readonly `string`[]

The processors applied to the binding's value, in order.

##### right?

> `readonly` `optional` **right?**: `string`

The `2DVector` right part.

##### scheme?

> `readonly` `optional` **scheme?**: `string`

The control scheme this binding belongs to; empty means every scheme.

##### up?

> `readonly` `optional` **up?**: `string`

The `2DVector` up part.

***

### BindingResolver

What a [Binding](#binding) needs from the rest of the engine: path resolution, and a way to tell the
service that its resolved controls changed.

#### Methods

##### invalidateBindings()

> **invalidateBindings**(): `void`

Tells the owner that this binding's control set changed and subscriptions must be rebuilt.

###### Returns

`void`

##### resolveControl()

> **resolveControl**(`path`, `kind?`): [`ControlRef`](#controlref)

Resolves a binding path to a device control.

###### Parameters

###### path

`string`

The binding path.

###### kind?

[`ControlKind`](#controlkind-1)

The kind a `<Virtual>` control is created with when it does not exist yet.

###### Returns

[`ControlRef`](#controlref)

The resolved control.

***

### BloomEffectSettings

The `bloom` record a `PostProcessStack` declares (`docs/architecture/07-rendering.md` §2.7).

#### Properties

##### enabled

> **enabled**: `boolean`

Whether the glow pass runs.

##### exposure

> **exposure**: `number`

An exposure applied while extracting highlights.

##### kernel

> **kernel**: `number`

The blur kernel width, in pixels.

##### order

> **order**: `number`

Position in the chain; lower runs first.

##### scale

> **scale**: `number`

The fraction of full resolution the blur runs at.

##### threshold

> **threshold**: `number`

The luminance above which a pixel glows.

##### weight

> **weight**: `number`

How strongly the glow is mixed back in.

***

### BoolFieldSpec

Kind-specific data for `bool`.

#### Properties

##### kind

> `readonly` **kind**: `"bool"`

The boolean kind.

***

### BoxMeshOptions

How [MeshAsset.box](#box) sizes its box, in metres. Give `size` for a cube, or the three
dimensions.

#### Properties

##### depth?

> `readonly` `optional` **depth?**: `number`

Size along Z, overriding `size`.

##### height?

> `readonly` `optional` **height?**: `number`

Size along Y, overriding `size`.

##### size?

> `readonly` `optional` **size?**: `number`

Edge length on every axis.

##### width?

> `readonly` `optional` **width?**: `number`

Size along X, overriding `size`.

***

### CapsuleMeshOptions

How [MeshAsset.capsule](#capsule) sizes its capsule, which stands along Y.

#### Remarks

`height` is the **total** height including both caps, the same convention `@ignifx/physics` uses
for a capsule collider, so one pair of numbers describes both.

#### Properties

##### height?

> `readonly` `optional` **height?**: `number`

Total height including both caps, in metres.

##### radius?

> `readonly` `optional` **radius?**: `number`

Radius of the body and the caps.

##### tessellation?

> `readonly` `optional` **tessellation?**: `number`

Radial segment count.

***

### Clock

A source of monotonically non-decreasing milliseconds.

#### Remarks

Only `Time.realtimeSinceStartup` and the development-only phase timings read it; frame deltas are
supplied by Babylon Lite's render loop or by `app.step(dt)`, never measured from this clock, so
swapping the clock never changes simulation results (`CONSTITUTION.md` §2.1).

#### Example

```ts
const clock = createManualClock();
const app = await createApp({ headless: true, clock });
clock.advance(1000); // app.time.realtimeSinceStartup === 1
```

#### Extended by

- [`ManualClock`](#manualclock)

#### Methods

##### nowMs()

> **nowMs**(): `number`

Reads the clock.

###### Returns

`number`

Milliseconds since an unspecified epoch; only differences are meaningful.

***

### ColorFieldSpec

Kind-specific data for `color`.

#### Properties

##### kind

> `readonly` **kind**: `"color"`

The color kind.

***

### ColorLike

The structural shape of an RGBA color.

#### Properties

##### a

> `readonly` **a**: `number`

The alpha channel.

##### b

> `readonly` **b**: `number`

The blue channel.

##### g

> `readonly` **g**: `number`

The green channel.

##### r

> `readonly` **r**: `number`

The red channel.

***

### ComponentClassInfo

Everything the engine needs to know about a component class, computed once and cached.

#### Properties

##### allowMultiple

> `readonly` **allowMultiple**: `boolean`

`false` when at most one instance may live on an entity.

##### ancestors

> `readonly` **ancestors**: readonly [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>[]

The class and every component class it derives from, nearest first, ending at `Component`.
`world.components(Type)` and `getComponent(Type)` match against this list, which is why they
are inheritance-aware without touching a prototype chain per frame.

##### classIndex

> `readonly` **classIndex**: `number`

A dense index assigned in registration order, for array-indexed per-class bookkeeping.

##### isScript

> `readonly` **isScript**: `boolean`

`true` when the class derives from `Script`.

##### requires

> `readonly` **requires**: readonly [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>[]

Component types auto-added to, and validated on, the entity.

##### schema

> `readonly` **schema**: `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\> \| `null`

The declared serialized fields, or `null` when the class was not built with `define`.

##### script

> `readonly` **script**: [`ScriptClassInfo`](#scriptclassinfo) \| `null`

Callback and ordering data, or `null` for a plain component.

##### trackedFields

> `readonly` **trackedFields**: readonly `string`[]

The names of the `entityRef`/`componentRef` fields the schema declares. The world's reference
tracker nulls exactly these when their target is destroyed
(`docs/architecture/02-scene-graph.md` §4).

##### type

> `readonly` **type**: [`ComponentType`](#componenttype-1)

The class itself.

##### typeId

> `readonly` **typeId**: `string` \| `null`

The namespaced registration id, or `null` when the class declares none.

***

### ComponentHooks

The optional hooks every component may implement
(`docs/architecture/03-scripting-and-components.md` §1).

#### Remarks

They are declared here rather than on `Component` for the reason spelled out on
`ScriptCallbacks`: a member declared on the base class would force every implementation to carry
an `override` modifier under `noImplicitOverride` (coding standards §3). Write
`implements ComponentHooks` to have the signatures checked.

#### Methods

##### onAttach()?

> `optional` **onAttach**(): `void`

Runs after the component's fields are assigned and before `awake`. It may run while the entity
is inactive, so it must not assume the component is enabled.

###### Returns

`void`

##### onDetach()?

> `optional` **onDetach**(): `void`

Runs just before the component is removed, after `onDestroy`.

###### Returns

`void`

***

### ComponentRefFieldSpec

Kind-specific data for `componentRef`.

#### Properties

##### componentType

> `readonly` **componentType**: [`ComponentTypeToken`](#componenttypetoken)\<`unknown`\>

The component class the field may point at.

##### kind

> `readonly` **kind**: `"componentRef"`

The component-reference kind.

***

### ComponentStatics

The static members a component class may declare, as *structural*, optional properties
(`docs/architecture/03-scripting-and-components.md` §1). They are deliberately not declared on
the `Component` class: a static declared on the base class would make every
`static typeId = "mygame/Mover"` an override and force the `override` keyword on it under
`noImplicitOverride` (coding standards §3). Declaring the shape here instead means a plain
`static typeId` on a subclass satisfies it structurally, and the registry supplies the defaults.

#### Example

```ts
class Mover extends Script.define({ speed: f32(5) }) {
  static typeId = "mygame/Mover";
}
```

#### Extended by

- [`ComponentType`](#componenttype-1)
- [`ScriptStatics`](#scriptstatics)

#### Properties

##### allowMultiple?

> `readonly` `optional` **allowMultiple?**: `boolean`

`false` when at most one instance may be attached to an entity; defaults to `true`.

##### requires?

> `readonly` `optional` **requires?**: readonly [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>[]

Component types auto-added to, and validated on, any entity this one is attached to.

##### schema?

> `readonly` `optional` **schema?**: `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The serialized field declarations, set by `Component.define` / `Script.define`.

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
derived from the class name, so minification and renames cannot change a file's meaning.

***

### ComponentType

A component class used as a **query token** — `entity.getComponent(Type)`,
`world.components(Type)`, `componentRef(Type)`. Abstract classes qualify, which is what makes
`getComponent(Script)` legal (`docs/architecture/02-scene-graph.md` §4).

#### Example

```ts
function first<T extends Component>(entity: Entity, type: ComponentType<T>): T | null {
  return entity.getComponent(type);
}
```

#### Extends

- [`ComponentStatics`](#componentstatics)

#### Extended by

- [`ConcreteComponentType`](#concretecomponenttype)

#### Type Parameters

##### T

`T` *extends* [`Component`](#abstract-component) = [`Component`](#abstract-component)

The component instance type the token stands for.

#### Properties

##### allowMultiple?

> `readonly` `optional` **allowMultiple?**: `boolean`

`false` when at most one instance may be attached to an entity; defaults to `true`.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`allowMultiple`](#allowmultiple-3)

##### prototype

> `readonly` **prototype**: `T`

The instance shape the token names.

##### requires?

> `readonly` `optional` **requires?**: readonly [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>[]

Component types auto-added to, and validated on, any entity this one is attached to.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`requires`](#requires-1)

##### schema?

> `readonly` `optional` **schema?**: `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The serialized field declarations, set by `Component.define` / `Script.define`.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`schema`](#schema-4)

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
derived from the class name, so minification and renames cannot change a file's meaning.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`typeId`](#typeid-4)

***

### ComponentTypeToken

How a component class is named in a schema. A class satisfies it structurally through its
`prototype`, so `componentRef(Camera)` infers `Camera` without the class having to implement
anything. The optional `typeId` is the namespaced registration id from
`docs/architecture/03-scripting-and-components.md` §4 when the class carries one.

#### Type Parameters

##### C

`C`

The component instance type the token stands for.

#### Properties

##### prototype

> `readonly` **prototype**: `C`

The instance shape the token names.

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The component's namespaced registration id, when it declares one.

***

### ConcreteComponentType

A component class the engine can construct: everything [ComponentType](#componenttype-1) requires plus a
no-argument constructor. `entity.addComponent` and `app.registerComponents` take this shape,
because both have to be able to `new` the class.

#### Extends

- [`ComponentType`](#componenttype-1)\<`T`\>

#### Type Parameters

##### T

`T` *extends* [`Component`](#abstract-component) = [`Component`](#abstract-component)

The component instance type.

#### Constructors

##### Constructor

> **new ConcreteComponentType**(): `T`

Constructs an instance. Components are constructed by the engine only: initial values come from
schema defaults, then from the file or the `init` object.

###### Returns

`T`

###### Inherited from

`ComponentType<T>.constructor`

#### Properties

##### allowMultiple?

> `readonly` `optional` **allowMultiple?**: `boolean`

`false` when at most one instance may be attached to an entity; defaults to `true`.

###### Inherited from

[`ComponentType`](#componenttype-1).[`allowMultiple`](#allowmultiple-4)

##### prototype

> `readonly` **prototype**: `T`

The instance shape the token names.

###### Inherited from

[`ComponentType`](#componenttype-1).[`prototype`](#prototype-1)

##### requires?

> `readonly` `optional` **requires?**: readonly [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>[]

Component types auto-added to, and validated on, any entity this one is attached to.

###### Inherited from

[`ComponentType`](#componenttype-1).[`requires`](#requires-2)

##### schema?

> `readonly` `optional` **schema?**: `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The serialized field declarations, set by `Component.define` / `Script.define`.

###### Inherited from

[`ComponentType`](#componenttype-1).[`schema`](#schema-5)

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
derived from the class name, so minification and renames cannot change a file's meaning.

###### Inherited from

[`ComponentType`](#componenttype-1).[`typeId`](#typeid-5)

***

### ConnectOptions

Options for [Signal.connect](#connect).

#### Properties

##### deferred?

> `readonly` `optional` **deferred?**: `boolean`

Queue the delivery on the signal's [DeferredQueue](#deferredqueue) instead of calling the handler inside
`emit` (Godot's `CONNECT_DEFERRED`).

##### once?

> `readonly` `optional` **once?**: `boolean`

Disconnect the handler after its first delivery.

##### owner?

> `readonly` `optional` **owner?**: [`SignalOwner`](#signalowner)

Disconnect the handler automatically when this object is destroyed.

***

### ConsoleLike

The part of the host `console` a [LogSink](#logsink-1) needs. Declaring it keeps the sink testable and
keeps ignifx off the DOM `Console` type, which Node's console does not implement in full.

#### Methods

##### debug()

> **debug**(...`data`): `void`

Writes a debug line.

###### Parameters

###### data

...readonly `unknown`[]

The message followed by its structured extras.

###### Returns

`void`

##### error()

> **error**(...`data`): `void`

Writes an error line.

###### Parameters

###### data

...readonly `unknown`[]

The message followed by its structured extras.

###### Returns

`void`

##### info()

> **info**(...`data`): `void`

Writes an info line.

###### Parameters

###### data

...readonly `unknown`[]

The message followed by its structured extras.

###### Returns

`void`

##### warn()

> **warn**(...`data`): `void`

Writes a warning line.

###### Parameters

###### data

...readonly `unknown`[]

The message followed by its structured extras.

###### Returns

`void`

***

### ConsoleSinkOptions

Options for [createConsoleSink](#createconsolesink).

#### Properties

##### target?

> `readonly` `optional` **target?**: [`ConsoleLike`](#consolelike)

The console to write to. Defaults to the host `console`.

***

### ControlDescriptor

One control of a device, as the binding layer sees it after path resolution.

#### Properties

##### components

> `readonly` **components**: `number`

How many `Float32Array` slots the control occupies: `1`, or `2` for a vector.

##### index

> `readonly` **index**: `number`

The control's stable index inside its device's control table.

##### kind

> `readonly` **kind**: [`ControlKind`](#controlkind-1)

What the control produces.

##### name

> `readonly` **name**: `string`

The control's name inside its device, for example `leftStick` or `dpad/up`.

##### offset

> `readonly` **offset**: `number`

Where the control's components start in the device's value array.

***

### ControlRef

One control of one device, as a binding holds it after resolution.

#### Properties

##### control

> `readonly` **control**: [`ControlDescriptor`](#controldescriptor)

The control itself.

##### device

> `readonly` **device**: [`InputDevice`](#inputdevice)

The device the control belongs to.

##### path

> `readonly` **path**: `string`

The path the reference was resolved from.

***

### ControlSchemeDefinition

One control scheme: a name and the device families it pairs with
(`docs/architecture/08-input.md` §4).

#### Properties

##### devices

> `readonly` **devices**: readonly `string`[]

The device family tokens the scheme uses, for example `["Keyboard", "Mouse"]`.

##### name

> `readonly` **name**: `string`

The scheme name, for example `KeyboardMouse`.

***

### ControlSpec

A control declaration, before offsets are assigned.

#### Properties

##### kind

> `readonly` **kind**: [`ControlKind`](#controlkind-1)

What the control produces.

##### name

> `readonly` **name**: `string`

The control's name inside its device.

***

### ControlValue

A two-component value carried through a processor chain. Scalar controls use `x` and leave `y`
at `0`.

#### Properties

##### x

> **x**: `number`

The scalar value, or the vector's x component.

##### y

> **y**: `number`

The vector's y component; `0` for scalar controls.

***

### CoroutineHandle

The observable state of a running coroutine, returned by `Script.startCoroutine`.

#### Properties

##### isDone

> `readonly` **isDone**: `boolean`

`true` once the coroutine has finished, been stopped, or been cancelled.

##### isRunning

> `readonly` **isRunning**: `boolean`

`true` while the coroutine is still scheduled — including while it is paused.

***

### CoroutineHost

The coroutine scheduler, reached as `app.coroutines` and driven by `Script.startCoroutine`
(`docs/architecture/01-lifecycle-and-time.md` §5). The kernel calls
[CoroutineHost.setPaused](#setpaused) on every enable transition and [CoroutineHost.cancelAll](#cancelall)
when a script is destroyed.

#### Methods

##### cancelAll()

> **cancelAll**(`owner`): `void`

Cancels every coroutine a script started and detaches any promise they were waiting on, so the
continuation never runs. Called by the destroy flush and by world disposal.

###### Parameters

###### owner

[`Script`](#abstract-script)

The owning script.

###### Returns

`void`

##### setPaused()

> **setPaused**(`owner`, `paused`): `void`

Pauses or resumes every coroutine a script started, without discarding their state.

###### Parameters

###### owner

[`Script`](#abstract-script)

The owning script.

###### paused

`boolean`

`true` to pause, `false` to resume.

###### Returns

`void`

##### start()

> **start**(`owner`, `routine`): [`CoroutineHandle`](#coroutinehandle)

Schedules a coroutine owned by a script.

###### Parameters

###### owner

[`Script`](#abstract-script)

The script whose enabled state gates the coroutine.

###### routine

[`Coroutine`](#coroutine)

The generator to drive.

###### Returns

[`CoroutineHandle`](#coroutinehandle)

A handle for stopping it or waiting on it.

##### stop()

> **stop**(`handle`): `void`

Stops one coroutine. Stopping an already finished coroutine is a no-op.

###### Parameters

###### handle

[`CoroutineHandle`](#coroutinehandle)

The handle returned by [CoroutineHost.start](#start-1).

###### Returns

`void`

##### stopAll()

> **stopAll**(`owner`): `void`

Stops every coroutine a script started.

###### Parameters

###### owner

[`Script`](#abstract-script)

The owning script.

###### Returns

`void`

***

### CreateAppOptions

Options accepted by [createApp](#createapp).

#### Example

```ts
const app = await createApp({ canvas, extensions: [physics(), input()] });
await app.start();
```

#### Properties

##### assets?

> `readonly` `optional` **assets?**: [`AssetsCreateOptions`](#assetscreateoptions)

The asset service's construction options
(`docs/architecture/05-assets-and-loading.md` §7). The manifest normally arrives from
`@ignifx/vite-plugin`; tests and Electron tooling pass it here.

###### Remarks

The `assets` **settings** section configures the root, the concurrency limit, the collector
delay, and the retry count. The manifest and the injected `fetch` are not settings: neither
survives schema validation, so they are creation options instead.

##### canvas?

> `readonly` `optional` **canvas?**: [`RenderSurface`](#rendersurface)

The canvas to render into. Ignored when `headless` is `true`.

##### clock?

> `readonly` `optional` **clock?**: [`Clock`](#clock)

The wall clock behind `time.realtimeSinceStartup` and the development phase timings. Defaults
to `performance.now()`; headless tests pass [createManualClock](#createmanualclock).

##### extensions?

> `readonly` `optional` **extensions?**: readonly [`Extension`](#extension)[]

The extensions to register, after the implicit core extension.

##### fetch?

> `readonly` `optional` **fetch?**: (`input`, `init?`) => `Promise`\<`Response`\>

The `fetch` the asset service reads through, as a shorthand for `assets.fetch`. Defaults to
`globalThis.fetch`; headless tests pass a fake so responses are deterministic.

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

###### Parameters

###### input

`RequestInfo` \| `URL`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### headless?

> `readonly` `optional` **headless?**: `boolean`

Run on Babylon Lite's null engine with no render surface
(`docs/architecture/01-lifecycle-and-time.md` §8). Defaults to `true` when no `canvas` is
given, so `createApp({})` is a headless app.

##### logLevel?

> `readonly` `optional` **logLevel?**: [`LogThreshold`](#logthreshold)

The lowest level `app.log` writes to the sink. Defaults to `"info"` in every mode, so an app
prints nothing at startup; pass `"debug"` to see the kernel's own diagnostics.

##### logSink?

> `readonly` `optional` **logSink?**: [`LogSink`](#logsink-1)

Where `app.log` writes. Defaults to the console sink.

##### mode?

> `readonly` `optional` **mode?**: [`ErrorFormatMode`](#errorformatmode)

`"development"` turns on per-phase CPU timings, full error messages, and the strict half of
every rule `04-extensions.md` §2 relaxes in production. Defaults to `"development"`; the Vite
plugin sets it from the build mode in Phase 2.

##### settings?

> `readonly` `optional` **settings?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Project settings, as `ignifx.config.ts` would supply them
(`docs/architecture/04-extensions.md` §5). The Vite plugin injects the resolved config in
Phase 2; tests and Electron tooling pass it here.

***

### CreateBusOptions

Options accepted by [AudioService.createBus](#createbus-1).

#### Properties

##### parent?

> `readonly` `optional` **parent?**: `string`

The name of the bus the new one routes into; empty routes it to the root.

##### pausable?

> `readonly` `optional` **pausable?**: `boolean`

Whether `app.pause()` pauses it. Defaults to whatever the `audio` settings section says.

##### volume?

> `readonly` `optional` **volume?**: `number`

The new bus's own linear gain. Defaults to `1`.

***

### CreateEntityOptions

Options accepted by [World.createEntity](#createentity).

#### Properties

##### active?

> `readonly` `optional` **active?**: `boolean`

The entity's own `active` flag at creation. Defaults to `true`.

###### Remarks

Scene loading passes `false` so that no component can `awake` before the whole scene exists and
its references are resolved (`docs/architecture/01-lifecycle-and-time.md` §4), then sets the
file's value in tree order once construction is complete.

##### parent?

> `readonly` `optional` **parent?**: [`Entity`](#entity-4)

The parent to attach the new entity to; `undefined` makes it a root of its scene.

##### position?

> `readonly` `optional` **position?**: [`Vec3Like`](#vec3like)

The initial world position, in metres.

##### rotation?

> `readonly` `optional` **rotation?**: [`QuatLike`](#quatlike)

The initial world rotation.

##### scene?

> `readonly` `optional` **scene?**: [`SceneInstance`](#sceneinstance)

The owning scene instance; defaults to the parent's scene, or `world.activeScene`.

##### uid?

> `readonly` `optional` **uid?**: `string`

The uid to adopt instead of a freshly minted ULID.

###### Remarks

Scene loading passes the uid the file carries, which is what makes save → load → save
byte-identical (`docs/architecture/06-serialization-and-scene-format.md` §1). A uid another
entity of this world already holds is ignored and a fresh one minted, so two instances of one
scene never collide (`02-scene-graph.md` §10).

***

### CurveFieldSpec

Kind-specific data for `curve`.

#### Properties

##### kind

> `readonly` **kind**: `"curve"`

The curve kind.

***

### CurveValue

The value a `curve()` field holds.

#### Properties

##### keys

> `readonly` **keys**: readonly [`CurveKey`](#curvekey)[]

The curve's keys, ordered by time.

***

### CustomFieldCodec

The hand-written encoder and decoder behind a `custom()` field. The codec owns both the default
value and the JSON representation, so `custom` is the escape hatch for value types the built-in
kinds cannot express.

#### Type Parameters

##### T

`T`

The runtime value type.

#### Properties

##### jsonSchema?

> `readonly` `optional` **jsonSchema?**: [`JsonObject`](#jsonobject)

A JSON Schema fragment describing the encoded form, merged into the generated document.

#### Methods

##### createDefault()

> **createDefault**(): `T`

Builds a fresh default value. It is a factory, not a constant, so two components never share
one mutable default object.

###### Returns

`T`

A newly allocated default value.

##### deserialize()

> **deserialize**(`json`): `T`

Rebuilds a runtime value from JSON.

###### Parameters

###### json

[`JsonValue`](#jsonvalue)

The JSON previously produced by `serialize`.

###### Returns

`T`

The runtime value.

##### serialize()

> **serialize**(`value`): [`JsonValue`](#jsonvalue)

Converts a runtime value into JSON.

###### Parameters

###### value

`T`

The value to serialize.

###### Returns

[`JsonValue`](#jsonvalue)

The JSON representation written into the file.

***

### CustomFieldSpec

Kind-specific data for `custom`.

#### Properties

##### codec

> `readonly` **codec**: [`CustomFieldCodec`](#customfieldcodec)\<`unknown`\>

The hand-written codec that owns the value's default and JSON form.

##### kind

> `readonly` **kind**: `"custom"`

The custom kind.

***

### CylinderMeshOptions

How [MeshAsset.cylinder](#cylinder) sizes its cylinder, which stands along Y.

#### Properties

##### diameter?

> `readonly` `optional` **diameter?**: `number`

Diameter of both ends.

##### diameterBottom?

> `readonly` `optional` **diameterBottom?**: `number`

Diameter of the bottom cap, overriding `diameter`.

##### diameterTop?

> `readonly` `optional` **diameterTop?**: `number`

Diameter of the top cap, overriding `diameter` — a cone is `diameterTop: 0`.

##### height?

> `readonly` `optional` **height?**: `number`

Height along Y, in metres.

##### tessellation?

> `readonly` `optional` **tessellation?**: `number`

Radial segment count.

***

### DecodeResult

What decoding produced: a value that is always usable — the field's default when the JSON could
not be read — plus every problem found on the way.

#### Type Parameters

##### T

`T`

The decoded value type.

#### Properties

##### issues

> `readonly` **issues**: readonly [`SchemaIssue`](#schemaissue)[]

Every problem found, in discovery order; empty on a clean decode.

##### value

> `readonly` **value**: `T`

The decoded value, or the field's freshly built default when decoding failed.

***

### DeferredQueue

The scheduler that runs deferred deliveries. The core frame loop implements it on the
`EndOfFrame` phase; tests can pass a queue that runs callbacks on demand.

#### Methods

##### enqueue()

> **enqueue**(`callback`): `void`

Schedules a callback to run at the next flush point.

###### Parameters

###### callback

() => `void`

The delivery to run.

###### Returns

`void`

***

### DeviceLostInfo

What Babylon Lite reported when the WebGPU device was lost
(`docs/architecture/07-rendering.md` §4).

#### Properties

##### message

> `readonly` **message**: `string`

The human-readable message.

##### reason

> `readonly` **reason**: `string` \| `null`

The `GPUDeviceLostInfo.reason` string, or `null` when the host gave none.

***

### DiagnosticsGroup

A named set of numeric counters owned by one subsystem — `render`, `physics`, `assets`, `input`,
`audio`, `twoD`, `animation` (`docs/architecture/15-devtools-and-diagnostics.md` §3).

#### Remarks

Counter names are resolved to array indices once, at registration. Per-frame code holds the index
and never performs a string-keyed lookup (coding standards §7).

#### Example

```ts
const counters = app.diagnostics.registerGroup("render", ["drawCalls", "triangles"]);
const drawCalls = counters.index("drawCalls");
// …per frame…
counters.set(drawCalls, scene.drawCallCount);
```

#### Properties

##### counterNames

> `readonly` **counterNames**: readonly `string`[]

The counter names in index order.

##### name

> `readonly` **name**: `string`

The group name, unique within one [Diagnostics](#diagnostics-1).

#### Methods

##### add()

> **add**(`index`, `delta`): `void`

Adds to a counter. Out-of-range indices are ignored.

###### Parameters

###### index

`number`

The index from [DiagnosticsGroup.index](#index-1).

###### delta

`number`

The amount to add.

###### Returns

`void`

##### get()

> **get**(`index`): `number`

Reads a counter.

###### Parameters

###### index

`number`

The index from [DiagnosticsGroup.index](#index-1).

###### Returns

`number`

The current value, or `0` when the index is out of range.

##### index()

> **index**(`counter`): `number`

Resolves a counter name to its index. Call it at registration or `awake`, never per frame.

###### Parameters

###### counter

`string`

The counter name.

###### Returns

`number`

The index to pass to [DiagnosticsGroup.get](#get-3), `set`, and `add`.

###### Throws

IgnifxError with code `IGX-1504` when the group has no such counter.

##### reset()

> **reset**(): `void`

Zeroes every counter in the group.

###### Returns

`void`

##### set()

> **set**(`index`, `value`): `void`

Replaces a counter's value. Out-of-range indices are ignored.

###### Parameters

###### index

`number`

The index from [DiagnosticsGroup.index](#index-1).

###### value

`number`

The new value.

###### Returns

`void`

***

### DiagnosticsOptions

Options for the [Diagnostics](#diagnostics-1) constructor.

#### Properties

##### development?

> `readonly` `optional` **development?**: `boolean`

Whether this is a development build. Per-phase CPU timings and `performance.mark`/`measure`
entries are only produced when it is `true`. Defaults to `false`.

##### historyLength?

> `readonly` `optional` **historyLength?**: `number`

How many frames of history to keep. Defaults to [FRAME\_HISTORY\_LENGTH](#frame_history_length).

##### now?

> `readonly` `optional` **now?**: () => `number`

The clock used for profile scopes, in milliseconds. Defaults to `performance.now` when the host
has it and `Date.now` otherwise; tests pass a counter so timings are deterministic.

###### Returns

`number`

***

### DomSource

One adapter's subscription lifetime.

#### Methods

##### attach()

> **attach**(): `void`

Subscribes to the DOM.

###### Returns

`void`

##### detach()

> **detach**(): `void`

Unsubscribes. Calling it twice is a no-op.

###### Returns

`void`

***

### DomTarget

The DOM objects one app's input adapters subscribe to.

#### Properties

##### canvas

> `readonly` **canvas**: `HTMLCanvasElement`

The canvas pointer and wheel events are read from, and pointer lock is requested on.

##### document

> `readonly` **document**: `Document`

The document `visibilitychange` and `pointerlockchange` are read from.

##### window

> `readonly` **window**: `Window`

The window keyboard events and `blur` are read from.

***

### EntityPrefabLink

The prefab link `Entity.prefab` returns for an entity a scene file's `instance` entry produced
(`docs/architecture/02-scene-graph.md` §6).

#### Properties

##### address

> `readonly` **address**: `string`

The address of the instanced scene.

##### asset

> `readonly` **asset**: [`AssetHandle`](#assethandle)\<[`SceneAsset`](#sceneasset)\> \| `null`

The handle the instanced scene was loaded through, or `null` when no asset service resolved one.

##### instanceRoot

> `readonly` **instanceRoot**: [`Entity`](#entity-4)

The entity the `instance` entry sat on — the root of this instance.

***

### EntityRefFieldSpec

Kind-specific data for `entityRef`.

#### Properties

##### kind

> `readonly` **kind**: `"entityRef"`

The entity-reference kind.

***

### EnumFieldSpec

Kind-specific data for `enumOf`.

#### Properties

##### kind

> `readonly` **kind**: `"enum"`

The enumeration kind.

##### values

> `readonly` **values**: readonly `string`[]

Every accepted string value, in declaration order.

***

### EnvironmentAssetLiteHandles

The Babylon Lite objects an [EnvironmentAsset](#environmentasset) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### textures

> `readonly` **textures**: `EnvironmentTextures` \| `null`

The GPU-resident cube map, BRDF table, samplers, and harmonics, or `null` under a headless app.

***

### EnvironmentDefinition

What an `.environment.json` declares, or what an `.env` address implies
(`docs/architecture/06-serialization-and-scene-format.md` §6).

#### Remarks

The description file exists so a project can pin the skybox and the BRDF table next to the IBL
rather than repeating them on every `Environment` component. Loading a bare `.env` address
produces the same shape with everything but `environment` left at its default.

#### Properties

##### blur

> `readonly` **blur**: `number`

How blurred the specular reflection is, 0 to 1.

##### brdfLut

> `readonly` **brdfLut**: `string`

The RGBD BRDF lookup table, or empty to take `rendering.brdfLut`.

##### environment

> `readonly` **environment**: `string`

The `.env` file holding the prefiltered specular cube map and its spherical harmonics.

##### rotation

> `readonly` **rotation**: `number`

Rotation around the world Y axis, in degrees.

##### skybox

> `readonly` **skybox**: `string`

A `.dds` or `.env` skybox, or empty for none.

##### skyboxEnabled

> `readonly` **skyboxEnabled**: `boolean`

Whether a skybox is drawn at all.

##### skyboxSize

> `readonly` **skyboxSize**: `number`

The skybox cube's size, in metres. Lite defaults to 20.

***

### EnvironmentFogSettings

The `fog` record an `Environment` declares (`docs/architecture/07-rendering.md` §2.5).

#### Properties

##### color

> **color**: [`ColorLike`](#colorlike)

The fog's sRGB colour.

##### density

> **density**: `number`

Density, for the exponential modes.

##### end

> **end**: `number`

Where linear fog reaches full strength, in metres.

##### mode

> **mode**: `"none"` \| `"linear"` \| `"exp"` \| `"exp2"`

The falloff, or `"none"` to disable fog.

##### start

> **start**: `number`

Where linear fog begins, in metres.

***

### ErrorCodeDescription

What the registry knows about one code.

#### Properties

##### code

> `readonly` **code**: `` `IGX-${number}` ``

The code itself.

##### message

> `readonly` **message**: `string`

The one-line message template; context keys appear in braces.

##### owner

> `readonly` **owner**: `string`

The extension that owns the code (`"@ignifx/core"` for the codes in `CoreErrorCode`).

***

### ErrorCodeRegistry

The per-app table of every diagnostic code the running game can produce. Devtools resolves codes
to messages through it, and `ExtensionContext.registerErrorCodes` writes to it.

#### Remarks

There is one registry per [App](#app), never a module-level one (`CONSTITUTION.md` §3.5, §3.6):
two apps in one test process must not see each other's extensions.

#### Methods

##### describe()

> **describe**(`code`): [`ErrorCodeDescription`](#errorcodedescription) \| `null`

Looks a code up.

###### Parameters

###### code

`string`

The code to describe.

###### Returns

[`ErrorCodeDescription`](#errorcodedescription) \| `null`

The description, or `null` when the code was never registered — an unknown code is an
expected absence, not a failure (coding standards §5.5).

##### isRegistered()

> **isRegistered**(`code`): `boolean`

Reports whether a code is known.

###### Parameters

###### code

`string`

The code to test.

###### Returns

`boolean`

`true` when the code has been registered.

##### register()

> **register**(`codes`, `owner`): `void`

Adds a block of codes.

###### Parameters

###### codes

`Readonly`\<`Record`\<`string`, `string`\>\>

A map of `IGX-####` code to one-line message template.

###### owner

`string`

The extension name recorded as the owner of every code in the block.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-1502` when a key is not a valid code, or `IGX-1501` when a
code is already registered.

***

### ErrorReport

A failure the engine caught at a boundary and reported instead of rethrowing
(`docs/architecture/01-lifecycle-and-time.md` §5, `15-devtools-and-diagnostics.md` §1). One
script throwing never stops the others.

#### Example

```ts
app.onError.connect((report) => {
  app.log.error("{source} callback threw on {entity}", report.source, report.entity?.name ?? "-");
});
```

#### Properties

##### component

> `readonly` **component**: [`Component`](#abstract-component) \| `null`

The component involved, or `null` when the failure is not component-scoped.

##### entity

> `readonly` **entity**: [`Entity`](#entity-4) \| `null`

The entity involved, or `null` when the failure is not entity-scoped.

##### error

> `readonly` **error**: `unknown`

Whatever was thrown. Usually an `Error`, often an `IgnifxError`.

##### phase

> `readonly` **phase**: [`Phase`](#phase-3) \| `null`

The phase that was running, or `null` outside a phase (a lifecycle flush, say).

##### source

> `readonly` **source**: `"asset"` \| `"lifecycle"` \| `"coroutine"` \| `"system"` \| `"extension"`

Which boundary caught it.

***

### Extension

The unit of optional functionality (`docs/architecture/04-extensions.md` §1). Core features are
extensions too (`CONSTITUTION.md` §8.1).

#### Properties

##### engine?

> `readonly` `optional` **engine?**: `string`

The semver range of `@ignifx/core` this extension supports, checked at registration.

##### name

> `readonly` **name**: `string`

Unique name; the npm package name for published extensions.

##### optional?

> `readonly` `optional` **optional?**: readonly `string`[]

Extensions this one integrates with when they are present.

##### requires?

> `readonly` `optional` **requires?**: readonly `string`[]

Extensions that must be registered before this one.

##### version

> `readonly` **version**: `string`

The semver version of the extension itself.

#### Methods

##### dispose()?

> `optional` **dispose**(`app`): `void`

Releases everything the extension owns, in reverse registration order.

###### Parameters

###### app

[`App`](#app)

The app being disposed.

###### Returns

`void`

##### onStart()?

> `optional` **onStart**(`app`): `void` \| `Promise`\<`void`\>

Runs after every extension registered and the Lite engine exists, before the first frame.

###### Parameters

###### app

[`App`](#app)

The app being started.

###### Returns

`void` \| `Promise`\<`void`\>

Nothing, or a promise `app.start()` awaits.

##### onStop()?

> `optional` **onStop**(`app`): `void`

Runs when the app stops, in reverse registration order.

###### Parameters

###### app

[`App`](#app)

The app being stopped.

###### Returns

`void`

##### register()

> **register**(`ctx`): `void` \| `Promise`\<`void`\>

Declares components, systems, services, loaders, and settings.

###### Parameters

###### ctx

[`ExtensionContext`](#extensioncontext)

The registration surface.

###### Returns

`void` \| `Promise`\<`void`\>

Nothing, or a promise the host awaits before registering the next extension.

***

### ExtensionContext

An extension's registration surface (`docs/architecture/04-extensions.md` §1). Everything an
extension contributes is declared here; nothing happens at module import time
(`CONSTITUTION.md` §3.5).

#### Properties

##### app

> `readonly` **app**: [`App`](#app)

The app being built.

##### log

> `readonly` **log**: [`Logger`](#logger)

A logger scoped to this extension.

#### Methods

##### defineAppProperty()

> **defineAppProperty**(`name`, `getter`): `void`

Defines a property on `App`, pairing with a module augmentation of the `App` interface.

###### Parameters

###### name

`string`

The property name, for example `"input"`.

###### getter

() => `unknown`

Returns the value each time the property is read.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0401` when the property is already defined.

##### dispatchScriptCallback()

> **dispatchScriptCallback**(`entity`, `kind`, `argument`): `void`

**`Beta`**

Delivers one physics callback to every script on an entity that implements it, for extension
authors (`docs/architecture/09-physics.md` §4). The scheduler stays the only thing that calls a
script callback: this routes through the same guarded call site the frame loop uses
(`03-scripting-and-components.md` §6).

###### Parameters

###### entity

[`Entity`](#entity-4)

The entity whose scripts should receive the callback.

###### kind

[`PhysicsCallbackName`](#physicscallbackname-1)

Which physics callback to deliver.

###### argument

`unknown`

The single argument the callback receives — a collision or a trigger event.

###### Returns

`void`

###### Remarks

Delivery is synchronous and in component order, to effectively-enabled scripts only; a
destroyed or inactive entity receives nothing. A handler that throws is reported to
`app.onError` with `source: "lifecycle"` and the running phase, and the remaining scripts still
receive the callback. Nothing is allocated per call.

###### Throws

IgnifxError with code `IGX-0409` in development when called from outside the fixed
loop, where `01-lifecycle-and-time.md` §3 says these callbacks never run. Production builds
deliver it anyway rather than losing the event.

###### Example

```ts
for (let index = 0; index < events.length; index += 1) {
  ctx.dispatchScriptCallback(events[index].entity, PhysicsCallbackName.onTriggerEnter, events[index]);
}
```

##### entityImplements()

> **entityImplements**(`entity`, `kind`): `boolean`

**`Beta`**

Whether any script on an entity implements a physics callback, for extension authors. This is
what `Rigidbody.collisionEvents` auto-detection asks (`09-physics.md` §2.1).

###### Parameters

###### entity

[`Entity`](#entity-4)

The entity to inspect.

###### kind

[`PhysicsCallbackName`](#physicscallbackname-1)

Which physics callback.

###### Returns

`boolean`

`true` when at least one script on the entity implements it.

###### Remarks

The answer ignores `enabled`, so it stays stable while scripts are toggled and only changes
when a component is added or removed — the two moments the physics extension recomputes it.
Components already queued for destruction do not count.

##### onDispose()

> **onDispose**(`callback`): `void`

Registers a callback that runs when the app is disposed.

###### Parameters

###### callback

() => `void`

The teardown to run.

###### Returns

`void`

##### registerAssetLoader()

> **registerAssetLoader**(`loader`): `void`

Registers an asset loader (`docs/architecture/05-assets-and-loading.md` §5).

###### Parameters

###### loader

[`AssetLoader`](#assetloader)

The loader, which also declares the extensions that select its type.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0506` when another extension already owns the type.

##### registerAssetType()

> **registerAssetType**(`type`): `void`

Declares an asset type whose loader is registered separately, or not at all, so that addresses
with its extensions resolve to a type (`docs/architecture/04-extensions.md` §1).

###### Parameters

###### type

[`AssetTypeDefinition`](#assettypedefinition)

The type name and the extensions that select it.

###### Returns

`void`

##### registerComponent()

> **registerComponent**(`type`, `options?`): `void`

Registers one component class.

###### Parameters

###### type

[`ConcreteComponentType`](#concretecomponenttype)

The component class.

###### options?

[`RegisterComponentOptions`](#registercomponentoptions)

An explicit `typeId`, when the class does not declare one.

###### Returns

`void`

##### registerComponents()

> **registerComponents**(`types`): `void`

Registers several component classes.

###### Parameters

###### types

readonly [`ConcreteComponentType`](#concretecomponenttype)\<[`Component`](#abstract-component)\>[]

The component classes.

###### Returns

`void`

##### registerErrorCodes()

> **registerErrorCodes**(`codes`): `void`

Adds diagnostic codes to the app's error-code registry.

###### Parameters

###### codes

`Readonly`\<`Record`\<`string`, `string`\>\>

`IGX-####` to one-line message template.

###### Returns

`void`

##### registerService()

> **registerService**\<`T`\>(`key`, `instance`): `void`

Registers a service instance under a key.

###### Type Parameters

###### T

`T`

The service instance type.

###### Parameters

###### key

[`ServiceKey`](#servicekey)\<`T`\>

The class or named key.

###### instance

`T`

The service.

###### Returns

`void`

##### registerSettings()

> **registerSettings**\<`S`\>(`section`, `schema`, `defaults`): `void`

Registers a project settings section.

###### Type Parameters

###### S

`S`

The section's resolved shape.

###### Parameters

###### section

`string`

The section name as it appears in `ignifx.config.ts`.

###### schema

[`Schema`](#schema-14)

The schema the section is validated against.

###### defaults

`S`

The values used when the project omits the section.

###### Returns

`void`

##### registerSystem()

> **registerSystem**(`system`, `options`): `void`

Registers a system in a phase.

###### Parameters

###### system

[`System`](#system)

The system.

###### options

[`RegisterSystemOptions`](#registersystemoptions)

The phase and the ascending order within it; core uses `[-1000, 1000]`.

###### Returns

`void`

##### require()

> **require**\<`T`\>(`key`): `T`

Looks up a service registered by an earlier extension.

###### Type Parameters

###### T

`T`

The service instance type.

###### Parameters

###### key

[`ServiceKey`](#servicekey)\<`T`\>

The class or named key.

###### Returns

`T`

The instance.

###### Throws

IgnifxError with code `IGX-0405` when the service is not registered.

##### requireRenderingFeature()

> **requireRenderingFeature**(`feature`): `void`

Declares that this extension needs a rendering feature switched on
(`docs/architecture/07-rendering.md` §1.1).

###### Parameters

###### feature

keyof [`RenderingFeatureSettings`](#renderingfeaturesettings)

The feature the extension needs.

###### Returns

`void`

###### Remarks

Babylon Lite compiles its shader permutations and records its frame graph inside
`registerScene`, so every feature that changes what gets compiled has to be on before that
call. `register` runs before `app.start()` does it, so this is a *declaration* there: the
feature is switched on whether or not the project listed it. After the scene is registered it
is a refusal instead.

###### Throws

IgnifxError with code `IGX-0704` when the render scene has already been registered.

###### Example

```ts
register(ctx: ExtensionContext): void {
  ctx.requireRenderingFeature("skeletons");
}
```

##### setSimulationScene()

> **setSimulationScene**(`scene`): `void`

**`Beta`**

Publishes the scene an extension simulates in as `world.lite.simulationScene`, for extension
authors (`docs/architecture/09-physics.md` §1, `02-scene-graph.md` §2).

###### Parameters

###### scene

`SceneContext` \| `null`

The simulation scene, or `null` to clear it from the extension's `dispose`.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0410` when the world already has a different simulation
scene.

##### settings()

> **settings**\<`S`\>(`section`): `S`

Reads a resolved settings section.

###### Type Parameters

###### S

`S`

The section's resolved shape.

###### Parameters

###### section

`string`

The section name.

###### Returns

`S`

The resolved section.

###### Throws

IgnifxError with code `IGX-0407` when the section was never registered.

##### tryGet()

> **tryGet**\<`T`\>(`key`): `T` \| `null`

Looks up a service registered by an earlier extension, tolerating its absence.

###### Type Parameters

###### T

`T`

The service instance type.

###### Parameters

###### key

[`ServiceKey`](#servicekey)\<`T`\>

The class or named key.

###### Returns

`T` \| `null`

The instance, or `null` when it is not registered.

***

### FieldDefinition

One declared field of a component schema. Field definitions are plain, immutable data built by
the constructors in this module; nothing about them is reflective and nothing runs at import
time (ADR-0004, `CONSTITUTION.md` §3.5).

The type parameter is the field's *runtime* value type, which is what
`Script.define({ … })` uses to type the generated properties.

#### Example

```ts
const speed = f32(5, { min: 0, max: 50, tooltip: "Units per second" });
speed.kind; // "f32"
speed.createDefault(); // 5
```

#### Type Parameters

##### T

`T`

The runtime value type of the field.

#### Properties

##### kind

> `readonly` **kind**: [`FieldKind`](#fieldkind-1)

The field kind, mirroring `spec.kind` for quick reads by tooling and the docs harness.

##### options

> `readonly` **options**: [`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

##### spec

> `readonly` **spec**: [`FieldSpec`](#fieldspec)

The kind-specific data, discriminated by `spec.kind`.

#### Methods

##### createDefault()

> **createDefault**(): `T`

Builds a fresh default value. Object-valued kinds allocate on every call, so two components
never share one mutable default.

###### Returns

`T`

A newly allocated default value.

***

### FieldOptions

Inspector and serializer metadata carried by every field
(`docs/architecture/03-scripting-and-components.md` §3,
`docs/architecture/06-serialization-and-scene-format.md` §5). Options never change a field's
value type; they constrain and present it.

#### Properties

##### group?

> `readonly` `optional` **group?**: `string`

Name of the inspector group the field is folded into.

##### hidden?

> `readonly` `optional` **hidden?**: `boolean`

Hides the field from the inspector while still serializing it.

##### max?

> `readonly` `optional` **max?**: `number`

Highest accepted value for numeric kinds; validation reports `IGX-0606` above it.

##### min?

> `readonly` `optional` **min?**: `number`

Lowest accepted value for numeric kinds; validation reports `IGX-0606` below it.

##### readonly?

> `readonly` `optional` **readonly?**: `boolean`

Shows the field in the inspector but forbids editing it there.

##### step?

> `readonly` `optional` **step?**: `number`

Increment used by the inspector's drag and spinner controls.

##### tooltip?

> `readonly` `optional` **tooltip?**: `string`

Help text shown next to the field in the inspector.

##### transient?

> `readonly` `optional` **transient?**: `boolean`

Excludes the field from saved games and scene files; it always takes its default on load.

***

### FontAssetLiteHandles

The Babylon Lite objects a [FontAsset](#fontasset) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### font

> `readonly` **font**: `Font`

The parsed font. Present in headless mode too: parsing needs no device.

***

### FrameSample

One frame's counters.

#### Remarks

The numeric fields are mutable on purpose: the frame loop writes them in place so that publishing
diagnostics costs no allocation (coding standards §7). Everything outside the loop treats a
sample as read-only, and history samples are read through
[Diagnostics.readFrame](#readframe) into a caller-owned sample.

#### Properties

##### coroutinesResumed

> **coroutinesResumed**: `number`

How many coroutines were resumed this frame.

##### cpuMs

> `readonly` **cpuMs**: `Float64Array`

CPU milliseconds per phase, indexed by [PhaseIndex](#phaseindex). Always [PHASE\_COUNT](#phase_count) long and
only filled in development builds.

##### destroyed

> **destroyed**: `number`

How many entities and components were destroyed in this frame's flush.

##### droppedMs

> **droppedMs**: `number`

How much of `rawDeltaMs` was discarded by the maximum-delta clamp, in milliseconds.

##### fixedSteps

> **fixedSteps**: `number`

How many fixed steps ran this frame.

##### frame

> **frame**: `number`

The monotonically increasing frame number, starting at 1.

##### rawDeltaMs

> **rawDeltaMs**: `number`

The wall-clock delta the loop was handed, before clamping, in milliseconds.

##### scriptsUpdated

> **scriptsUpdated**: `number`

How many scripts received `update` this frame.

***

### FrameState

Where in the frame the engine currently is, as far as the scene graph needs to know
(`docs/architecture/01-lifecycle-and-time.md` §4, §6). The scheduler and the lifecycle queue
write it; `Entity` and the queue read it to decide whether `awake` runs nested and synchronously
and whether `destroyImmediate` is legal.

#### Properties

##### isInsideCallback

> `readonly` **isInsideCallback**: `boolean`

`true` while a lifecycle callback, a script callback, or a coroutine body is on the stack.

##### isInsideFixedStep

> `readonly` **isInsideFixedStep**: `boolean`

`true` while the fixed loop is running (`time.inFixedStep`).

***

### GamepadLike

The subset of the DOM `Gamepad` object this package reads.

#### Properties

##### axes

> `readonly` **axes**: readonly `number`[]

The pad's axes, in its raw order.

##### buttons

> `readonly` **buttons**: readonly `object`[]

The pad's buttons, in its raw order.

##### connected

> `readonly` **connected**: `boolean`

Whether the pad is still present.

##### id

> `readonly` **id**: `string`

The pad's identifier string.

##### mapping

> `readonly` **mapping**: `string`

The pad's mapping: `"standard"`, `"xr-standard"`, or `""`.

##### vibrationActuator?

> `readonly` `optional` **vibrationActuator?**: [`VibrationActuatorLike`](#vibrationactuatorlike) \| `null`

The haptic actuator, when the pad has one.

***

### GamepadRemap

How one non-standard pad's raw indices map onto the standard ones
(`docs/architecture/08-input.md` §4, "a small remap table for common non-standard pads").

#### Properties

##### axes

> `readonly` **axes**: readonly `number`[]

Standard axis index (`0` lx, `1` ly, `2` rx, `3` ry) to raw axis index.

##### buttons

> `readonly` **buttons**: readonly `number`[]

Standard button index to raw button index; `-1` means the pad has no such button.

##### id

> `readonly` **id**: `string`

A substring of `Gamepad.id` that selects this remap, matched case-insensitively.

***

### GamepadSnapshot

One frame's reading of a physical gamepad, in the shape `navigator.getGamepads()` reports.
Declared as its own type so the mapping is testable without a browser.

#### Properties

##### axes

> `readonly` **axes**: readonly `number`[]

Axis values in `[-1, 1]`, in the pad's raw order.

##### buttons

> `readonly` **buttons**: readonly `number`[]

Button values in `[0, 1]`, in the pad's raw order.

##### id

> `readonly` **id**: `string`

The pad's `id` string.

##### mapping

> `readonly` **mapping**: `string`

The pad's `mapping`: `"standard"`, `"xr-standard"`, or `""`.

***

### GroundMeshOptions

How [MeshAsset.ground](#ground) sizes and subdivides its grid, which lies in the XZ plane facing
`+Y`.

#### Properties

##### height?

> `readonly` `optional` **height?**: `number`

Size along Z, in metres.

##### subdivisions?

> `readonly` `optional` **subdivisions?**: `number`

Quads per side.

##### uvScale?

> `readonly` `optional` **uvScale?**: readonly \[`number`, `number`\]

UV multiplier, for tiling a texture across the grid.

##### width?

> `readonly` `optional` **width?**: `number`

Size along X, in metres.

***

### HeadlessBackendOptions

Options accepted by [HeadlessBackend](#headlessbackend).

#### Properties

##### masterVolume?

> `readonly` `optional` **masterVolume?**: `number`

The initial master gain. Defaults to `1`.

##### startSuspended?

> `readonly` `optional` **startSuspended?**: `boolean`

Start in the `"suspended"` state, so `app.audio.state` reads `"locked"` and plays are queued
until `app.audio.unlock()` — the browser's behaviour, reproduced under Node so the unlock flow
can be tested without a browser. Defaults to `false`.

***

### IgnifxErrorOptions

Options accepted by [IgnifxError](#ignifxerror). Extends the standard `ErrorOptions`, so `cause` keeps
the original failure when an error is wrapped.

#### Extends

- `ErrorOptions`

#### Extended by

- [`AssetLoadErrorOptions`](#assetloaderroroptions)

#### Properties

##### cause?

> `optional` **cause?**: `unknown`

###### Inherited from

`ErrorOptions.cause`

##### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>\>

Identifiers that locate the failure. Defaults to an empty record.

##### hint?

> `readonly` `optional` **hint?**: `string` \| `null`

One sentence telling the developer what to do about it. Defaults to `null`.

##### mode?

> `readonly` `optional` **mode?**: [`ErrorFormatMode`](#errorformatmode)

How verbose `message` should be. Defaults to `"development"`.

***

### ImageProcessingEffectSettings

The `imageProcessing` record a `PostProcessStack` declares
(`docs/architecture/07-rendering.md` §2.7).

#### Properties

##### enabled

> **enabled**: `boolean`

Whether a full-screen grading pass runs.

##### order

> **order**: `number`

Position in the chain; lower runs first.

***

### ImageProcessingSettings

The `imageProcessing` record an `Environment` declares
(`docs/architecture/07-rendering.md` §2.5).

#### Properties

##### contrast

> **contrast**: `number`

Contrast multiplier.

##### exposure

> **exposure**: `number`

Exposure multiplier.

##### toneMapping

> **toneMapping**: `"none"` \| `"standard"` \| `"aces"` \| `"neutral"`

The tone-mapping curve.

***

### InputActionEvent

The payload of [InputAction.onStarted](#onstarted), [InputAction.onPerformed](#onperformed), and
[InputAction.onCanceled](#oncanceled).

#### Remarks

One event object is reused per action, so a handler that needs the values after its call returns
must copy them. Reusing it is what keeps the steady frame allocation-free (coding standards §7).

#### Properties

##### action

> `readonly` **action**: [`InputAction`](#inputaction)

The action that changed.

##### magnitude

> `readonly` **magnitude**: `number`

The action's magnitude this frame, in `[0, 1]` for normalised controls.

##### phase

> `readonly` **phase**: `"started"` \| `"performed"` \| `"canceled"`

Which signal is delivering: `started`, `performed`, or `canceled`.

##### x

> `readonly` **x**: `number`

The x component of the action's value.

##### y

> `readonly` **y**: `number`

The y component of the action's value; `0` unless the action is a `vector2`.

***

### InputActionsDefinition

A whole `ignifx.inputactions` document.

#### Properties

##### controlSchemes

> `readonly` **controlSchemes**: readonly [`ControlSchemeDefinition`](#controlschemedefinition)[]

The control schemes the document declares.

##### format

> `readonly` **format**: `"ignifx.inputactions"`

Always `ignifx.inputactions`.

##### formatVersion

> `readonly` **formatVersion**: `number`

The format version; `1` before ignifx 1.0.

##### maps

> `readonly` **maps**: readonly [`ActionMapDefinition`](#actionmapdefinition)[]

The action maps the document declares.

***

### InputActionsInput

What [defineInputActions](#defineinputactions) accepts: a document with the two header fields optional, because
code that builds the object does not have to repeat what the format already fixes.

#### Properties

##### controlSchemes?

> `readonly` `optional` **controlSchemes?**: readonly [`ControlSchemeDefinition`](#controlschemedefinition)[]

The control schemes; defaults to none.

##### format?

> `readonly` `optional` **format?**: `"ignifx.inputactions"`

Always `ignifx.inputactions` when present.

##### formatVersion?

> `readonly` `optional` **formatVersion?**: `number`

The format version when present; defaults to `1`.

##### maps

> `readonly` **maps**: readonly [`ActionMapDefinition`](#actionmapdefinition)[]

The action maps.

***

### InputErrorOptions

Options accepted by [inputError](#inputerror): the same subset of `IgnifxErrorOptions` this package uses.

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

### InputEventRecord

One raw event of the current frame (`docs/architecture/08-input.md` §5).

#### Remarks

Every field is always present; the ones an event kind does not use read `0` or `""`. A fixed
shape is what lets the records be pooled, and reading `deltaX` on a `keydown` is harmless.

The records are recycled: keep a copy of anything needed after the frame ends.

#### Properties

##### button

> `readonly` **button**: `number`

The `PointerEvent.button` index, for pointer events.

##### code

> `readonly` **code**: `string`

The physical `KeyboardEvent.code`, for key events.

##### deltaX

> `readonly` **deltaX**: `number`

The pointer movement x, or the wheel's horizontal delta.

##### deltaY

> `readonly` **deltaY**: `number`

The pointer movement y, or the wheel's vertical delta.

##### key

> `readonly` **key**: `string`

The layout-dependent `KeyboardEvent.key`, or the composed text of a `textinput` event.

##### pointerId

> `readonly` **pointerId**: `number`

The `PointerEvent.pointerId`, for pointer events.

##### pointerType

> `readonly` **pointerType**: `string`

The `PointerEvent.pointerType`: `mouse`, `pen`, or `touch`.

##### repeat

> `readonly` **repeat**: `boolean`

Whether a key event is an auto-repeat.

##### sequence

> `readonly` **sequence**: `number`

A monotonically increasing arrival number, shared by every event of one app.

##### type

> `readonly` **type**: [`InputEventType`](#inputeventtype)

Which kind of event this is.

##### x

> `readonly` **x**: `number`

The pointer x, in CSS pixels from the canvas's left edge.

##### y

> `readonly` **y**: `number`

The pointer y, in CSS pixels from the canvas's top edge.

***

### InputOptions

What `input()` accepts. Every field overrides the matching `input` settings section value, which
is the shape `04-extensions.md` §1 shows for `physics()`.

#### Properties

##### actions?

> `readonly` `optional` **actions?**: `string`

The address of the `.input.json` document loaded at startup.

##### defaultScheme?

> `readonly` `optional` **defaultScheme?**: `string`

The control scheme the app starts in.

##### gamepadPolling?

> `readonly` `optional` **gamepadPolling?**: `boolean`

Whether gamepads are polled each frame.

##### gamepadReader?

> `readonly` `optional` **gamepadReader?**: [`GamepadReader`](#gamepadreader) \| `null`

How gamepads are read. Defaults to `navigator.getGamepads()`, or to no polling at all under
Node. Tests pass their own reader.

##### pointerLock?

> `readonly` `optional` **pointerLock?**: [`PointerLockSettings`](#pointerlocksettings)

Pointer-lock policy.

##### pressPoint?

> `readonly` `optional` **pressPoint?**: `number`

The magnitude at which an analog value counts as pressed.

##### strictSchemes?

> `readonly` `optional` **strictSchemes?**: `boolean`

Whether a scheme tag filters resolution as well as device pairing.

***

### InputOverrideEntry

One overridden binding.

#### Properties

##### action

> `readonly` **action**: `string`

The action name.

##### bindingIndex

> `readonly` **bindingIndex**: `number`

Which of the action's bindings is overridden.

##### map

> `readonly` **map**: `string`

The map the action belongs to.

##### path

> `readonly` **path**: `string`

The path the binding now reads.

***

### InputOverridesJson

A saved set of binding overrides.

#### Example

```ts
const saved = app.input.saveOverrides();
localStorage.setItem("bindings", JSON.stringify(saved));
```

#### Properties

##### format

> `readonly` **format**: `string`

Always `ignifx.inputoverrides`. Typed as a string because the value is read back from JSON.

##### formatVersion

> `readonly` **formatVersion**: `number`

The format version; `1` before ignifx 1.0.

##### overrides

> `readonly` **overrides**: readonly [`InputOverrideEntry`](#inputoverrideentry)[]

The overridden bindings.

***

### InputServiceOptions

What [InputService](#inputservice) is constructed with.

#### Properties

##### app

> `readonly` **app**: [`App`](#app)

The app the service belongs to.

##### gamepadReader?

> `readonly` `optional` **gamepadReader?**: [`GamepadReader`](#gamepadreader) \| `null`

The gamepad reader; defaults to `navigator.getGamepads()` when the host has it.

##### settings

> `readonly` **settings**: [`InputSettings`](#inputsettings)

The resolved `input` settings section.

***

### InputSettings

The resolved `input` settings section.

#### Example

```ts
// ignifx.config.ts
export default defineConfig({ input: { actions: "input/default.input.json", pressPoint: 0.4 } });
```

#### Properties

##### actions

> `readonly` **actions**: `string`

The address of the `.input.json` document loaded at startup; empty loads none.

##### defaultScheme

> `readonly` **defaultScheme**: `string`

The control scheme the app starts in; empty picks the first the document declares.

##### gamepadPolling

> `readonly` **gamepadPolling**: `boolean`

Whether gamepads are polled each frame. Defaults to `true`.

##### pointerLock

> `readonly` **pointerLock**: [`PointerLockSettings`](#pointerlocksettings)

Pointer-lock policy.

##### pressPoint

> `readonly` **pressPoint**: `number`

The magnitude at which an analog value counts as pressed. Defaults to `0.5`.

##### strictSchemes

> `readonly` **strictSchemes**: `boolean`

Whether a binding tagged with a control scheme resolves only while that scheme is active.
Defaults to `false`, which is Unity's behaviour and what most games want.

***

### InstantiateOptions

Options accepted by [World.instantiate](#instantiate-1) and [World.instantiateAsync](#instantiateasync)
(`docs/architecture/02-scene-graph.md` §2).

#### Properties

##### name?

> `readonly` `optional` **name?**: `string`

Renames the instance root.

##### parent?

> `readonly` `optional` **parent?**: [`Entity`](#entity-4) \| `null`

The parent to attach the instance root to; `null` or omitted makes it a root.

##### position?

> `readonly` `optional` **position?**: [`Vec3Like`](#vec3like)

Places the instance root.

##### rotation?

> `readonly` `optional` **rotation?**: [`QuatLike`](#quatlike)

Rotates the instance root.

##### scene?

> `readonly` `optional` **scene?**: [`SceneInstance`](#sceneinstance)

The instance that owns the new entities; defaults to the parent's, else `world.activeScene`.

##### strictInstanceHashes?

> `readonly` `optional` **strictInstanceHashes?**: `boolean`

`true` turns an `IGX-0604` instance hash mismatch from a logged warning into a throw.

##### worldSpace?

> `readonly` `optional` **worldSpace?**: `boolean`

`true` reads `position`/`rotation` as world values; `false` (the default) as local ones.

***

### InstantiateSceneOptions

Options accepted by [instantiateScene](#instantiatescene).

#### Properties

##### asInstance?

> `readonly` `optional` **asInstance?**: `boolean`

`true` treats the whole file as one instance: every entity gets a fresh uid and an
`Entity.prefab` link. This is what `world.instantiate` does; `world.loadScene` leaves it off so
that the scene's own entities keep the uids the file gave them
(`docs/architecture/02-scene-graph.md` §10).

##### assetHandle?

> `readonly` `optional` **assetHandle?**: [`AssetHandle`](#assethandle)\<[`SceneAsset`](#sceneasset)\> \| `null`

The handle the scene was loaded through, recorded on `Entity.prefab` when `asInstance`.

##### parent?

> `readonly` `optional` **parent?**: [`Entity`](#entity-4) \| `null`

The entity the scene's roots attach to; `null` or omitted makes them roots of `scene`.

##### rootEntity?

> `readonly` `optional` **rootEntity?**: [`Entity`](#entity-4) \| `null`

The entity that stands for the instance when `asInstance` is set and the file has more or fewer
than one root. `world.instantiate` creates it and passes it as both `parent` and `rootEntity`,
so that the call still answers with one entity.

##### scene?

> `readonly` `optional` **scene?**: [`SceneInstance`](#sceneinstance)

The instance that owns the new entities; defaults to the parent's, else `world.activeScene`.

##### strictInstanceHashes?

> `readonly` `optional` **strictInstanceHashes?**: `boolean`

`true` turns an `IGX-0604` hash mismatch from a diagnostic into a throw.

***

### InteractiveRebindOptions

Options accepted by `app.input.performInteractiveRebind`.

#### Properties

##### bindingIndex?

> `readonly` `optional` **bindingIndex?**: `number`

Which of the action's bindings to override. Defaults to `0`.

##### cancelPath?

> `readonly` `optional` **cancelPath?**: `string`

A path that cancels the rebind when actuated, usually `<Keyboard>/escape`.

##### excludePaths?

> `readonly` `optional` **excludePaths?**: readonly `string`[]

Paths the rebind refuses to bind to, for example the movement keys.

##### magnitudeThreshold?

> `readonly` `optional` **magnitudeThreshold?**: `number`

The magnitude a control must reach to count as actuated. Defaults to `0.5`.

##### timeoutSeconds?

> `readonly` `optional` **timeoutSeconds?**: `number`

How long to listen before giving up, in unscaled seconds. `0` waits forever.

***

### InteractiveRebindResult

What `app.input.performInteractiveRebind` resolves with.

#### Properties

##### action

> `readonly` **action**: [`InputAction`](#inputaction)

The action that was being rebound.

##### bindingIndex

> `readonly` **bindingIndex**: `number`

The binding index that was being rebound.

##### canceled

> `readonly` **canceled**: `boolean`

Whether the cancel control ended the rebind.

##### path

> `readonly` **path**: `string` \| `null`

The path the player chose, or `null` when the rebind was cancelled or timed out.

##### timedOut

> `readonly` **timedOut**: `boolean`

Whether the timeout ended the rebind.

***

### LayerMaskFieldSpec

Kind-specific data for `layerMask`.

#### Properties

##### kind

> `readonly` **kind**: `"layerMask"`

The layer-mask kind.

***

### LayersSettings

The `layers` project settings section (`docs/architecture/04-extensions.md` §5,
`02-scene-graph.md` §7).

#### Properties

##### layers

> `readonly` **layers**: readonly `string`[]

The project's layer names in declaration order.

***

### LightShadowSettings

The `shadows` record a `Light` declares (`docs/architecture/07-rendering.md` §2.2).

#### Properties

##### bias

> **bias**: `number`

Depth bias applied while sampling.

##### cascades

> **cascades**: `number`

Cascade count, CSM only; Lite clamps it to four.

##### darkness

> **darkness**: `number`

How dark a fully shadowed texel is: `0` is black, `1` is unshadowed.

##### enabled

> **enabled**: `boolean`

Whether this light casts shadows.

##### mapSize

> **mapSize**: `number`

Shadow map resolution, in texels per side.

##### maxDistance

> **maxDistance**: `number`

The distance beyond which nothing is shadowed, in metres; `0` takes Lite's default.

##### normalBias

> **normalBias**: `number`

Offset along the surface normal, PCF only.

##### technique

> **technique**: `"esm"` \| `"pcf"` \| `"csm"`

The technique; spot lights ignore it and always use PCF, the only one Lite offers them.

***

### LoaderContext

What a loader is handed for one load
(`docs/architecture/05-assets-and-loading.md` §5).

#### Remarks

The three `fetch*` methods share one code path: the bytes are streamed through the service's
priority queue, counted into the handle's progress, and aborted with [LoaderContext.signal](#signal).
A loader that reaches the network any other way loses progress, cancellation, and retries.

#### Properties

##### address

> `readonly` **address**: `string`

The address being loaded, fragment included.

##### app

> `readonly` **app**: [`App`](#app)

The app the load belongs to.

##### fragment

> `readonly` **fragment**: `string` \| `null`

The `#fragment` part of the address, or `null` when it carries none.

##### lite

> `readonly` **lite**: `object`

Unstable Babylon Lite escape hatch for GPU loaders (`docs/architecture/00-overview.md` §3).

###### engine

> `readonly` **engine**: `EngineContext`

##### meta

> `readonly` **meta**: [`JsonObject`](#jsonobject) \| `null`

The `.meta.json` sidecar the build recorded for this address, or `null` when the manifest lists
none (`docs/architecture/05-assets-and-loading.md` §7).

###### Remarks

Read the sub-object your loader owns and ignore the rest: one sidecar carries options for
several tools, and `groups` in it belongs to the manifest generator, not to a loader.

###### Example

```ts
const srgb = asRecord(ctx.meta?.["texture"])?.["srgb"] === true;
```

##### signal

> `readonly` **signal**: `AbortSignal`

Aborted when the request is cancelled or the app is disposed.

##### type

> `readonly` **type**: `string`

The asset type the loader is registered under.

##### url

> `readonly` **url**: `string`

The URL the address resolved to, fragment stripped.

#### Methods

##### fetchBytes()

> **fetchBytes**(): `Promise`\<`ArrayBuffer`\>

Fetches the address as bytes, with progress and cancellation.

###### Returns

`Promise`\<`ArrayBuffer`\>

The response body.

##### fetchJson()

> **fetchJson**\<`J`\>(): `Promise`\<`J`\>

Fetches the address and parses it as JSON.

###### Type Parameters

###### J

`J` = `unknown`

The parsed shape, as the loader declares it.

###### Returns

`Promise`\<`J`\>

The parsed body.

##### fetchText()

> **fetchText**(): `Promise`\<`string`\>

Fetches the address as UTF-8 text.

###### Returns

`Promise`\<`string`\>

The decoded body.

##### loadDependency()

> **loadDependency**\<`D`\>(`ref`, `options?`): `Promise`\<[`AssetHandle`](#assethandle)\<`D`\>\>

Loads another asset as a dependency of this one: its progress counts into this load and the
retain it takes is released when this asset is unloaded.

###### Type Parameters

###### D

`D`

The dependency's loaded value type.

###### Parameters

###### ref

`string` \| [`AssetRef`](#assetref-3)\<`D`\>

The dependency's address or reference.

###### options?

[`LoadOptions`](#loadoptions)

Priority, type, progress, and cancellation.

###### Returns

`Promise`\<[`AssetHandle`](#assethandle)\<`D`\>\>

The dependency's handle, once it has been delivered.

##### reportProgress()

> **reportProgress**(`fraction`): `void`

Reports progress for loaders that cannot express it in bytes.

###### Parameters

###### fraction

`number`

How far along the load is, in `[0, 1]`.

###### Returns

`void`

***

### LoadOptions

Options accepted by every load entry point of [Assets](#assets-1).

#### Properties

##### onProgress?

> `readonly` `optional` **onProgress?**: (`fraction`) => `void`

Called at delivery whenever this request's progress changed.

###### Parameters

###### fraction

`number`

How far along the load is, in `[0, 1]`.

###### Returns

`void`

##### priority?

> `readonly` `optional` **priority?**: `number`

Higher runs first; ties break in request order. Defaults to `0`.

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Aborts this request. Whether it aborts the shared load is documented on [Assets.load](#load-1).

##### type?

> `readonly` `optional` **type?**: `string`

The asset type, when the address's extension does not identify it.

***

### LoadProgress

How far a scene load has got, as `world.loadScene`'s `onProgress` reports it.

#### Properties

##### address

> `readonly` **address**: `string`

The address being loaded.

##### fraction

> `readonly` **fraction**: `number`

How far along, in `[0, 1]`, counting every dependency the scene pulls in.

***

### LoadSceneOptions

Options accepted by [World.loadScene](#loadscene) (`docs/architecture/02-scene-graph.md` §2).

#### Properties

##### mode?

> `readonly` `optional` **mode?**: `"single"` \| `"additive"`

`"single"` (the default) unloads every instance that is not `persistent` first; `"additive"`
keeps them.

##### onProgress?

> `readonly` `optional` **onProgress?**: (`progress`) => `void`

Called as the scene and its dependencies load.

###### Parameters

###### progress

[`LoadProgress`](#loadprogress)

###### Returns

`void`

##### setActive?

> `readonly` `optional` **setActive?**: `boolean`

Makes the loaded instance `world.activeScene`. Defaults to `true` for a `"single"` load and
`false` for an additive one, which is what "the level you just loaded owns new entities" means.

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Cancels the load; an abort after the asset arrived still rejects with `IGX-0502`.

##### strictInstanceHashes?

> `readonly` `optional` **strictInstanceHashes?**: `boolean`

`true` turns an `IGX-0604` instance hash mismatch from a logged warning into a throw.

***

### Logger

The logging front end reached as `app.log` and, per extension, as `ctx.log`
(`docs/architecture/15-devtools-and-diagnostics.md` §2).

#### Remarks

Calls below the current threshold return before any record is built, so a disabled `debug()` costs
one numeric comparison. The rest parameter itself is still materialised by the JavaScript engine,
so per-frame call sites guard with [Logger.isEnabled](#isenabled) instead (coding standards §7).

#### Example

```ts
const log = app.log.child("physics");
log.info("stepping at {hz}Hz", 60);
if (log.isEnabled("debug")) {
  log.debug("contacts", collectContacts());
}
```

#### Properties

##### level

> `readonly` **level**: [`LogThreshold`](#logthreshold)

The threshold below which records are dropped. Shared with every child logger.

##### scope

> `readonly` **scope**: `string` \| `null`

The dotted scope prefix of this logger, or `null` for the root.

#### Methods

##### child()

> **child**(`scope`): [`Logger`](#logger)

Creates a logger that prefixes its records with an additional scope segment and shares this
logger's sink, threshold, clock, and `warnOnce` memory.

###### Parameters

###### scope

`string`

The segment to append, for example `"physics"`.

###### Returns

[`Logger`](#logger)

The scoped logger.

##### debug()

> **debug**(`message`, ...`data`): `void`

Writes a `debug` record.

###### Parameters

###### message

`string`

The message.

###### data

...readonly `unknown`[]

Structured extras.

###### Returns

`void`

##### error()

> **error**(`message`, ...`data`): `void`

Writes an `error` record.

###### Parameters

###### message

`string`

The message.

###### data

...readonly `unknown`[]

Structured extras.

###### Returns

`void`

##### info()

> **info**(`message`, ...`data`): `void`

Writes an `info` record.

###### Parameters

###### message

`string`

The message.

###### data

...readonly `unknown`[]

Structured extras.

###### Returns

`void`

##### isEnabled()

> **isEnabled**(`level`): `boolean`

Reports whether a record at this level would be written.

###### Parameters

###### level

[`LogLevel`](#loglevel-2)

The level to test.

###### Returns

`boolean`

`true` when the level passes the current threshold.

##### setLevel()

> **setLevel**(`level`): `void`

Raises or lowers the threshold for this logger, its parents, and its children — they share one
setting so devtools can turn `debug` on for the whole app at once.

###### Parameters

###### level

[`LogThreshold`](#logthreshold)

The new threshold.

###### Returns

`void`

##### warn()

> **warn**(`message`, ...`data`): `void`

Writes a `warn` record.

###### Parameters

###### message

`string`

The message.

###### data

...readonly `unknown`[]

Structured extras.

###### Returns

`void`

##### warnOnce()

> **warnOnce**(`key`, `message`, ...`data`): `void`

Writes a `warn` record the first time this key is seen and drops every later call with the same
key. This is the rate limiter for warnings that would otherwise repeat every frame.

###### Parameters

###### key

`string`

The de-duplication key, scoped to this logger's scope.

###### message

`string`

The message, used on the first call only.

###### data

...readonly `unknown`[]

Structured extras, used on the first call only.

###### Returns

`void`

***

### LoggerOptions

Options for [createLogger](#createlogger).

#### Properties

##### level?

> `readonly` `optional` **level?**: [`LogThreshold`](#logthreshold)

The initial threshold. Defaults to `"info"`.

##### now?

> `readonly` `optional` **now?**: () => `number`

The clock used for [LogRecord.timeMs](#timems). Defaults to `performance.now` when the host has
it and `Date.now` otherwise; tests pass a counter so records are deterministic.

###### Returns

`number`

##### scope?

> `readonly` `optional` **scope?**: `string` \| `null`

The root scope. Defaults to `null`.

##### sink

> `readonly` **sink**: [`LogSink`](#logsink-1)

Where records go.

***

### LogRecord

One line of log output, as handed to a [LogSink](#logsink-1).

#### Properties

##### data

> `readonly` **data**: readonly `unknown`[]

Structured extras passed after the message. Empty when there were none.

##### level

> `readonly` **level**: [`LogLevel`](#loglevel-2)

The severity of the line.

##### message

> `readonly` **message**: `string`

The human-readable message.

##### scope

> `readonly` **scope**: `string` \| `null`

The dotted scope of the logger that produced it, or `null` for the root logger.

##### timeMs

> `readonly` **timeMs**: `number`

The logger clock's reading when the line was produced, in milliseconds.

***

### LogSink

Where log records go: the console, a devtools panel, a file in Electron, or an in-memory buffer
in tests. A sink is passed to [createLogger](#createlogger) and is never discovered globally.

#### Extended by

- [`MemorySink`](#memorysink)

#### Methods

##### write()

> **write**(`record`): `void`

Writes one record. Called synchronously from the logging call site, so implementations must be
cheap and must not throw.

###### Parameters

###### record

[`LogRecord`](#logrecord)

The record to write.

###### Returns

`void`

***

### ManualClock

A clock that only moves when a test moves it.

#### Extends

- [`Clock`](#clock)

#### Methods

##### advance()

> **advance**(`milliseconds`): `void`

Moves the clock forward.

###### Parameters

###### milliseconds

`number`

How far to advance. Negative values are rejected so the clock stays
monotonic.

###### Returns

`void`

##### nowMs()

> **nowMs**(): `number`

Reads the clock.

###### Returns

`number`

Milliseconds since an unspecified epoch; only differences are meaningful.

###### Inherited from

[`Clock`](#clock).[`nowMs`](#nowms)

##### set()

> **set**(`milliseconds`): `void`

Sets the clock to an absolute reading.

###### Parameters

###### milliseconds

`number`

The new reading.

###### Returns

`void`

***

### MapFieldSpec

Kind-specific data for `map`.

#### Properties

##### kind

> `readonly` **kind**: `"map"`

The map kind.

##### value

> `readonly` **value**: [`FieldDefinition`](#fielddefinition)\<`unknown`\>

The field definition every entry's value follows.

***

### Mat4Like

A read-only 4x4 matrix stored as 16 numbers in **column-major** order (`m[column * 4 + row]`),
the layout WGSL's `mat4x4<f32>` expects and the one Babylon Lite uses, so a Lite `Mat4` is a
`Mat4Like` and vice versa. Translation lives in slots 12/13/14.

The storage type is deliberately unspecified: it is a `Float32Array` in both Lite and ignifx
today (see [Mat4.elements](#elements)) but callers must only rely on indexed reads and `length`.

#### Example

```ts
function translationX(m: Mat4Like): number {
  return m[12] ?? 0;
}
```

#### Indexable

> \[`index`: `number`\]: `number`

Element access in column-major order; `m[column * 4 + row]`.

#### Properties

##### length

> `readonly` **length**: `16`

Always exactly 16.

***

### MaterialAssetLiteHandles

The Babylon Lite objects a [MaterialAsset](#materialasset) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### material

> `readonly` **material**: `Material`

The Lite material. Present in headless mode too: a material is plain data.

***

### MemorySink

A [LogSink](#logsink-1) that keeps the most recent records in a fixed-size ring buffer. Used by the
devtools console panel, which needs scrollback without unbounded growth, and by unit tests, which
assert on what was logged.

#### Extends

- [`LogSink`](#logsink-1)

#### Properties

##### length

> `readonly` **length**: `number`

How many records are currently retained, never more than [MemorySink.limit](#limit).

##### limit

> `readonly` **limit**: `number`

The maximum number of records retained.

#### Methods

##### at()

> **at**(`index`): [`LogRecord`](#logrecord) \| `null`

Reads one retained record without copying the buffer.

###### Parameters

###### index

`number`

`0` is the oldest retained record, `length - 1` the newest.

###### Returns

[`LogRecord`](#logrecord) \| `null`

The record, or `null` when the index is out of range.

##### clear()

> **clear**(): `void`

Drops every retained record.

###### Returns

`void`

##### toArray()

> **toArray**(): readonly [`LogRecord`](#logrecord)[]

Copies the retained records, oldest first.

###### Returns

readonly [`LogRecord`](#logrecord)[]

A new array; allocating here is fine because only tests and devtools call it.

##### write()

> **write**(`record`): `void`

Writes one record. Called synchronously from the logging call site, so implementations must be
cheap and must not throw.

###### Parameters

###### record

[`LogRecord`](#logrecord)

The record to write.

###### Returns

`void`

###### Inherited from

[`LogSink`](#logsink-1).[`write`](#write)

***

### MeshAssetLiteHandles

The Babylon Lite objects a [MeshAsset](#meshasset) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### mesh

> `readonly` **mesh**: `Mesh` \| `null`

The template mesh, or `null` under a headless app, which uploads no geometry.

***

### MeshGeometryData

Raw vertex data for [MeshAsset.fromData](#fromdata).

#### Remarks

Lite keeps references to these arrays rather than copying them — they are what its CPU ray pick
and its bounds read (`lib/mesh/mesh-factories.js`) — so a caller must not mutate them afterwards.

#### Properties

##### indices

> `readonly` **indices**: `Uint32Array`

Three indices per triangle.

##### normals

> `readonly` **normals**: `Float32Array`

Three floats per vertex, one normal each.

##### positions

> `readonly` **positions**: `Float32Array`

Three floats per vertex.

##### uvs?

> `readonly` `optional` **uvs?**: `Float32Array`\<`ArrayBufferLike`\>

Two floats per vertex, or omitted for a mesh with no texture coordinates.

***

### ModelAssetLiteHandles

The Babylon Lite objects a [ModelAsset](#modelasset) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### container

> `readonly` **container**: `AssetContainer` \| `null`

The template container, or `null` under a headless app.

***

### ModelInstantiation

One instantiated copy of a model, as a `Model` component holds it.

#### Properties

##### nodes

> `readonly` **nodes**: `ReadonlyMap`\<`string`, `SceneNode`\>

Every named node in the clone, keyed by its glTF node name.

##### root

> `readonly` **root**: `SceneNode`

The cloned container root, parented under the entity's node.

***

### MusicPlayOptions

Options accepted by [MusicPlayer.play](#play-3).

#### Properties

##### fadeIn?

> `readonly` `optional` **fadeIn?**: `number`

Seconds to fade the new track up over. Defaults to no fade.

***

### MusicStopOptions

Options accepted by [MusicPlayer.stop](#stop-5).

#### Properties

##### fadeOut?

> `readonly` `optional` **fadeOut?**: `number`

Seconds to fade the current track out over. Defaults to stopping now.

***

### MutableQuat

A writable quaternion — the `out` shape of every `Quat` `ToRef` function, and the type
`Transform.localRotation` exposes. Babylon Lite's `ObservableQuat` satisfies it exactly, so
rotations are written straight into the Lite node (`docs/architecture/02-scene-graph.md` section 5).

#### Example

```ts
Quat.fromEulerDegreesToRef(0, 90, 0, transform.localRotation);
```

#### Properties

##### w

> **w**: `number`

The real (scalar) component.

##### x

> **x**: `number`

The imaginary X component.

##### y

> **y**: `number`

The imaginary Y component.

##### z

> **z**: `number`

The imaginary Z component.

#### Methods

##### copyFrom()

> **copyFrom**(`q`): `void`

Copies every component from another quaternion.

###### Parameters

###### q

[`QuatLike`](#quatlike)

The quaternion to read.

###### Returns

`void`

##### set()

> **set**(`x`, `y`, `z`, `w`): `void`

Assigns every component at once. Live views use this to emit a single change notification.

###### Parameters

###### x

`number`

The new imaginary X component.

###### y

`number`

The new imaginary Y component.

###### z

`number`

The new imaginary Z component.

###### w

`number`

The new real component.

###### Returns

`void`

***

### MutableVec2

A writable 2-component vector — the `out` shape of every `Vec2` `ToRef` function.

#### Example

```ts
const out = new Vec2();
Vec2.addToRef(a, b, out);
```

#### Properties

##### x

> **x**: `number`

The X component.

##### y

> **y**: `number`

The Y component.

#### Methods

##### copyFrom()

> **copyFrom**(`v`): `void`

Copies every component from another vector.

###### Parameters

###### v

[`Vec2Like`](#vec2like)

The vector to read.

###### Returns

`void`

##### set()

> **set**(`x`, `y`): `void`

Assigns every component at once.

###### Parameters

###### x

`number`

The new X component.

###### y

`number`

The new Y component.

###### Returns

`void`

***

### MutableVec3

A writable 3-component vector — the `out` shape of every `Vec3` `ToRef` function, and the type
`Transform.localPosition`/`localScale` expose. Babylon Lite's `ObservableVec3` (the live view over
a `SceneNode`'s TRS) satisfies this interface exactly, so writing through it notifies Lite's
hierarchy without any copy (`docs/architecture/02-scene-graph.md` section 5).

#### Example

```ts
// `transform.localPosition` is a live MutableVec3 over the Lite node.
Vec3.addToRef(transform.localPosition, velocity, transform.localPosition);
```

#### Properties

##### x

> **x**: `number`

The X component.

##### y

> **y**: `number`

The Y component.

##### z

> **z**: `number`

The Z component.

#### Methods

##### copyFrom()

> **copyFrom**(`v`): `void`

Copies every component from another vector.

###### Parameters

###### v

[`Vec3Like`](#vec3like)

The vector to read.

###### Returns

`void`

##### set()

> **set**(`x`, `y`, `z`): `void`

Assigns every component at once. Live views use this to emit a single change notification.

###### Parameters

###### x

`number`

The new X component.

###### y

`number`

The new Y component.

###### z

`number`

The new Z component.

###### Returns

`void`

***

### MutableVec4

A writable 4-component vector — the `out` shape of every `Vec4` `ToRef` function.

#### Example

```ts
const out = new Vec4();
Vec4.lerpToRef(a, b, 0.5, out);
```

#### Properties

##### w

> **w**: `number`

The W component.

##### x

> **x**: `number`

The X component.

##### y

> **y**: `number`

The Y component.

##### z

> **z**: `number`

The Z component.

#### Methods

##### copyFrom()

> **copyFrom**(`v`): `void`

Copies every component from another vector.

###### Parameters

###### v

[`Vec4Like`](#vec4like)

The vector to read.

###### Returns

`void`

##### set()

> **set**(`x`, `y`, `z`, `w`): `void`

Assigns every component at once.

###### Parameters

###### x

`number`

The new X component.

###### y

`number`

The new Y component.

###### z

`number`

The new Z component.

###### w

`number`

The new W component.

###### Returns

`void`

***

### NumberFieldSpec

Kind-specific data for the numeric kinds.

#### Properties

##### kind

> `readonly` **kind**: `"f32"` \| `"f64"` \| `"i32"` \| `"u32"`

The numeric kind.

***

### OneShotOptions

Options accepted by [AudioService.playOneShot](#playoneshot).

#### Extends

- [`PlayOptions`](#playoptions)

#### Properties

##### bus?

> `readonly` `optional` **bus?**: `string`

The bus to route through. Defaults to `"SFX"`.

##### delay?

> `readonly` `optional` **delay?**: `number`

How long to wait before it starts, in seconds.

###### Inherited from

[`PlayOptions`](#playoptions).[`delay`](#delay-2)

##### duration?

> `readonly` `optional` **duration?**: `number`

How long to play for, in seconds; `0` plays to the end of the clip.

###### Inherited from

[`PlayOptions`](#playoptions).[`duration`](#duration-4)

##### loop?

> `readonly` `optional` **loop?**: `boolean`

Whether this play loops; defaults to the source's `loop`.

###### Inherited from

[`PlayOptions`](#playoptions).[`loop`](#loop-4)

##### pitch?

> `readonly` `optional` **pitch?**: `number`

Playback rate for this play; defaults to the source's `pitch`.

###### Inherited from

[`PlayOptions`](#playoptions).[`pitch`](#pitch-2)

##### startOffset?

> `readonly` `optional` **startOffset?**: `number`

Where in the clip to start, in seconds.

###### Inherited from

[`PlayOptions`](#playoptions).[`startOffset`](#startoffset-2)

##### volume?

> `readonly` `optional` **volume?**: `number`

Linear gain for this play; defaults to the source's `volume`.

###### Inherited from

[`PlayOptions`](#playoptions).[`volume`](#volume-12)

***

### OneShotVolume

Options accepted by [AudioSource.playOneShot](#playoneshot-1).

#### Properties

##### volume?

> `readonly` `optional` **volume?**: `number`

Linear gain for this one play.

***

### OptionalFieldSpec

Kind-specific data for `optional`.

#### Properties

##### inner

> `readonly` **inner**: [`FieldDefinition`](#fielddefinition)\<`unknown`\>

The field definition a non-`null` value follows.

##### kind

> `readonly` **kind**: `"optional"`

The optional kind.

***

### ParsedControlPath

A parsed binding path.

#### Properties

##### control

> `readonly` **control**: `string`

The control name, sub-control segments included, for example `dpad/up`.

##### device

> `readonly` **device**: [`DeviceKind`](#devicekind-1)

The device family the path names.

##### deviceIndex

> `readonly` **deviceIndex**: `number`

Which device of the family, zero-based. `0` when the path carries no `{index}`.

***

### PbrMaterialDefinition

The properties a `"pbr"` material declares. Every colour is sRGB; every factor is unitless.

#### Properties

##### alpha

> `readonly` **alpha**: `number`

Overall material alpha, 0 to 1.

##### alphaCutoff

> `readonly` **alphaCutoff**: `number`

The cutoff below which a `"mask"` material discards a fragment.

##### alphaMode

> `readonly` **alphaMode**: `"opaque"` \| `"mask"` \| `"blend"`

How the alpha channel is interpreted.

##### baseColor

> `readonly` **baseColor**: [`ColorLike`](#colorlike)

sRGB base colour and alpha, multiplied with the base colour texture.

##### doubleSided

> `readonly` **doubleSided**: `boolean`

Whether back faces are drawn.

##### emissive

> `readonly` **emissive**: [`ColorLike`](#colorlike)

sRGB emissive colour.

##### environmentIntensity

> `readonly` **environmentIntensity**: `number`

How strongly the environment map contributes.

##### kind

> `readonly` **kind**: `"pbr"`

The family discriminator.

##### metallic

> `readonly` **metallic**: `number`

Metallic factor, 0 to 1.

##### name

> `readonly` **name**: `string`

A human-readable name; glTF material overrides match on it.

##### normalScale

> `readonly` **normalScale**: `number`

Normal map strength.

##### occlusionStrength

> `readonly` **occlusionStrength**: `number`

How strongly ambient occlusion darkens the surface, 0 to 1.

##### roughness

> `readonly` **roughness**: `number`

Roughness factor, 0 to 1.

##### textures

> `readonly` **textures**: `Readonly`\<`Record`\<`string`, `string`\>\>

The addresses of the textures the material samples, by slot; absent slots are unset.

##### unlit

> `readonly` **unlit**: `boolean`

Whether lighting is skipped entirely.

***

### PlaneMeshOptions

How [MeshAsset.plane](#plane) sizes its quad, which lies in the XY plane facing `-Z`.

#### Properties

##### height?

> `readonly` `optional` **height?**: `number`

Height, overriding `size`.

##### size?

> `readonly` `optional` **size?**: `number`

Edge length on both axes, in metres.

##### width?

> `readonly` `optional` **width?**: `number`

Width, overriding `size`.

***

### PlatformInfo

What the kernel knows about the host.

#### Example

```ts
if (app.platform.kind === "browser") {
  document.title = "playing";
}
```

#### Properties

##### kind

> `readonly` **kind**: [`PlatformKind`](#platformkind)

Whether the app runs in a document or in a bare JavaScript runtime.

***

### PlayOptions

The per-play overrides a game passes to `play()` (`docs/architecture/10-audio.md` §3).

#### Extended by

- [`OneShotOptions`](#oneshotoptions)

#### Properties

##### delay?

> `readonly` `optional` **delay?**: `number`

How long to wait before it starts, in seconds.

##### duration?

> `readonly` `optional` **duration?**: `number`

How long to play for, in seconds; `0` plays to the end of the clip.

##### loop?

> `readonly` `optional` **loop?**: `boolean`

Whether this play loops; defaults to the source's `loop`.

##### pitch?

> `readonly` `optional` **pitch?**: `number`

Playback rate for this play; defaults to the source's `pitch`.

##### startOffset?

> `readonly` `optional` **startOffset?**: `number`

Where in the clip to start, in seconds.

##### volume?

> `readonly` `optional` **volume?**: `number`

Linear gain for this play; defaults to the source's `volume`.

***

### PointerLockSettings

The pointer-lock half of the `input` section.

#### Properties

##### allowed

> `readonly` **allowed**: `boolean`

Whether `app.input.pointerLock.request()` is allowed to ask the browser. Defaults to `true`.

***

### Processor

One parsed processor: its kind and its two numeric parameters, already defaulted.

#### Properties

##### first

> `readonly` **first**: `number`

The first parameter: `min` for `deadzone` and `clamp`, `x` for `scale`.

##### kind

> `readonly` **kind**: [`ProcessorKind`](#processorkind-2)

Which processor this is.

##### second

> `readonly` **second**: `number`

The second parameter: `max` for `deadzone` and `clamp`, `y` for `scale`.

***

### ProfileScope

A timing scope opened by [Diagnostics.profile](#profile). Ending it twice is a no-op.

#### Remarks

Scopes are pooled per nesting depth, so opening one allocates nothing after the first frame, and
outside development builds `profile` returns a shared scope that does nothing at all.

#### Properties

##### durationMs

> `readonly` **durationMs**: `number`

How long the scope was open, in milliseconds of the diagnostics clock. Valid between
[ProfileScope.end](#end-1) and the next [Diagnostics.profile](#profile) call at the same nesting
depth, because scopes are pooled. Always `0` outside development builds.

#### Methods

##### end()

> **end**(): `void`

Closes the scope and, in development, records a `performance.measure` entry.

###### Returns

`void`

***

### QuatLike

The structural shape of a quaternion.

#### Properties

##### w

> `readonly` **w**: `number`

The scalar part.

##### x

> `readonly` **x**: `number`

The x component of the vector part.

##### y

> `readonly` **y**: `number`

The y component of the vector part.

##### z

> `readonly` **z**: `number`

The z component of the vector part.

***

### RandomSource

Where [generateUlid](#generateulid) gets its randomness. Injecting it is what lets a test replay a scene
with the same uids every run (`CONSTITUTION.md` §2.1) without ignifx depending on a random
library (coding standards §13).

#### Methods

##### fillBytes()

> **fillBytes**(`bytes`): `void`

Fills every byte of the buffer with new random values.

###### Parameters

###### bytes

`Uint8Array`\<`ArrayBuffer`\>

The buffer to overwrite in place. The buffer is a plain `ArrayBuffer` view;
`crypto.getRandomValues` refuses shared memory, so the type says so.

###### Returns

`void`

###### Remarks

Named `fillBytes` rather than `fill` so that call sites are not mistaken for `Array.prototype.fill`
by the linter's reference-value rule.

***

### Ray

A world-space ray, as `Camera.screenToRay` produces and `world.raycastRender` consumes
(`docs/architecture/07-rendering.md` §3).

#### Remarks

Both vectors are written in place, so a picking loop reuses one ray and allocates nothing
(coding standards §7).

#### Properties

##### direction

> `readonly` **direction**: [`RayVector`](#rayvector)

The unit direction it travels in.

##### length

> **length**: `number`

How far it reaches, in metres.

##### origin

> `readonly` **origin**: [`RayVector`](#rayvector)

Where the ray starts, in world space.

***

### RayVector

A writable `{ x, y, z }` a ray's origin and direction are stated in.

#### Remarks

Deliberately the minimal shape rather than the math module's `MutableVec3`: the engine's `Vec3`,
a plain object literal, and a live view over a Lite node all satisfy it, so nothing has to be
converted to build or read a ray.

#### Properties

##### x

> **x**: `number`

The x component.

##### y

> **y**: `number`

The y component.

##### z

> **z**: `number`

The z component.

***

### RecordFieldSpec

Kind-specific data for `record`.

#### Properties

##### fields

> `readonly` **fields**: [`Schema`](#schema-14)

The sub-fields, in declaration order.

##### kind

> `readonly` **kind**: `"record"`

The record kind.

***

### ReferenceDecoder

How the loader turns a uid read from a file back into a live entity or component.

#### Methods

##### asset()

> **asset**(`address`, `type`): `unknown`

Resolves an asset address to the loaded handle an `asset()` field should hold
(`docs/architecture/05-assets-and-loading.md` §3).

###### Parameters

###### address

`string`

The address the file carries, fragment included.

###### type

`string` \| `null`

The asset type the field or the file declared, or `null` when the address's
extension identifies it on its own.

###### Returns

`unknown`

The handle, or `null` when nothing loaded stands at that address.

###### Remarks

The scene loader answers from the dependency handles the `SceneAsset` already retains, so the
field never starts a load of its own and never owns a reference count. A resolver that returns
`null` — an address nothing loaded — makes the field `null` and adds an `IGX-0602` issue.

##### component()

> **component**(`uid`): `unknown`

Looks up a component by its file-local uid.

###### Parameters

###### uid

`string`

The uid read from the file.

###### Returns

`unknown`

The component, or `null` when the uid is unknown.

##### entity()

> **entity**(`uid`): `unknown`

Looks up an entity by its file-local uid.

###### Parameters

###### uid

`string`

The uid read from the file.

###### Returns

`unknown`

The entity, or `null` when the uid is unknown.

***

### ReferenceEncoder

How the serializer turns a live entity or component reference into the uid written to a file.
Reference kinds cannot be encoded without a world, so the kernel implements this and tests pass
a fake.

#### Methods

##### componentUid()

> **componentUid**(`value`): `string` \| `null`

Resolves a component reference to its file-local uid.

###### Parameters

###### value

`unknown`

The component the field points at.

###### Returns

`string` \| `null`

The uid, or `null` when the target is not part of the file being written.

##### entityUid()

> **entityUid**(`value`): `string` \| `null`

Resolves an entity reference to its file-local uid.

###### Parameters

###### value

`unknown`

The entity the field points at.

###### Returns

`string` \| `null`

The uid, or `null` when the target is not part of the file being written.

***

### RegisterAssetOptions

Options accepted by [Assets.register](#register).

#### Properties

##### address?

> `readonly` `optional` **address?**: `string`

The address to publish it at. Defaults to a generated `memory:<type>/<ulid>`; pass one only to
make an in-code asset reachable by name from `app.assets.get`.

##### type

> `readonly` **type**: `string`

The asset type the value is published under, for example `"mesh"` or `"material"`.

***

### RegisterComponentOptions

Options accepted by `ExtensionContext.registerComponent`.

#### Properties

##### typeId?

> `readonly` `optional` **typeId?**: `string`

An explicit registration id, when the class does not declare one.

***

### RegisterSystemOptions

Options accepted by `ExtensionContext.registerSystem`.

#### Properties

##### order?

> `readonly` `optional` **order?**: `number`

Ascending order within the phase; core uses `[-1000, 1000]`, extensions `[1001, 9999]`.

##### phase

> `readonly` **phase**: [`Phase`](#phase-3)

Which phase the system runs in.

***

### RenderCapture

A captured frame (`docs/architecture/07-rendering.md` §5).

#### Remarks

Tightly packed RGBA8, four bytes per pixel, row-major with the **top** row first — the layout
`ImageData` wants. Alpha is forced to 255 because the swapchain is presented opaque, and the
values are the final presented 8-bit colours, so comparing two captures compares what the player
saw.

#### Properties

##### data

> `readonly` **data**: `Uint8ClampedArray`

`width * height * 4` bytes of RGBA8.

##### height

> `readonly` **height**: `number`

The capture height, in device pixels.

##### width

> `readonly` **width**: `number`

The capture width, in device pixels.

***

### Renderer

The rendering service, reached as `app.renderer`
(`docs/architecture/07-rendering.md` §1, §3, §5).

#### Example

```ts
app.renderer.resolutionScale = 0.75;
const hit = await app.renderer.pickAsync(event.offsetX, event.offsetY);
hit?.entity.name;
```

#### Properties

##### drawCalls

> `readonly` **drawCalls**: `number`

GPU draw calls in the last rendered frame. `0` under a headless app.

##### features

> `readonly` **features**: `Readonly`\<[`RenderingFeatureSettings`](#renderingfeaturesettings)\>

Which rendering features are on. Read-only once `app.start()` has registered the scene.

##### gpuFrameTimeMs

> `readonly` **gpuFrameTimeMs**: `number`

How long the last measured frame took on the GPU, in milliseconds. `0` until timing is on.

##### pixelRatio

> **pixelRatio**: `number`

The clamp on the device pixel ratio the swapchain is sized at; `0` does not clamp. Writing it
resizes the backing store before the next frame.

##### profileTasks

> **profileTasks**: `boolean`

Whether per-task GPU timings are collected. Off by default; it costs timestamp queries.

##### resolutionScale

> **resolutionScale**: `number`

A live quality multiplier on the resolution, clamped to 0.25–1 and implemented by lowering the
effective device pixel ratio (`docs/architecture/07-rendering.md` §1).

#### Methods

##### captureScreenshot()

> **captureScreenshot**(): `Promise`\<[`RenderCapture`](#rendercapture)\>

Captures the next presented frame (`docs/architecture/07-rendering.md` §5).

###### Returns

`Promise`\<[`RenderCapture`](#rendercapture)\>

The frame, as tightly packed RGBA8 with the top row first.

###### Throws

IgnifxError with code `IGX-0707` when no render loop is running, because the capture
would never settle.

##### pickAsync()

> **pickAsync**(`x`, `y`, `options?`): `Promise`\<[`RenderPick`](#renderpick) \| `null`\>

Picks the object under one CSS pixel of the canvas, exactly, on the GPU
(`docs/architecture/07-rendering.md` §3).

###### Parameters

###### x

`number`

The CSS pixel x, from the canvas's left edge.

###### y

`number`

The CSS pixel y, from the canvas's top edge.

###### options?

[`RenderPickOptions`](#renderpickoptions)

An entity filter.

###### Returns

`Promise`\<[`RenderPick`](#renderpick) \| `null`\>

What was hit, or `null` for a miss.

###### Remarks

Picks are serialised per app: Lite's picker owns one set of staging buffers and chains each
call onto the previous one's promise. A headless app has no picker and always misses.

##### requireFeature()

> **requireFeature**(`feature`): `void`

Declares that a rendering feature must be on — what an extension calls from `register`
(`docs/architecture/07-rendering.md` §1.1).

###### Parameters

###### feature

keyof [`RenderingFeatureSettings`](#renderingfeaturesettings)

The feature the caller needs.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0704` when the render scene has already been registered, at
which point Lite has compiled what it is going to compile.

##### setSize()

> **setSize**(`width`, `height`): `void`

Sets the swapchain's backing-store size explicitly, in device pixels — the `OffscreenCanvas`
path (`docs/architecture/07-rendering.md` §1).

###### Parameters

###### width

`number`

The width, in device pixels.

###### height

`number`

The height, in device pixels.

###### Returns

`void`

###### Remarks

On a laid-out DOM canvas the size survives exactly one frame: Lite's render loop re-reads the
layout size at the start of every frame. Use [Renderer.pixelRatio](#pixelratio) there instead.

##### taskTimings()

> **taskTimings**(): [`RenderTaskTimings`](#rendertasktimings)

The latest per-task GPU timing snapshot. Check `status` before reading `tasks`.

###### Returns

[`RenderTaskTimings`](#rendertasktimings)

The snapshot.

##### warmUp()

> **warmUp**(`materials`): `void`

Compiles the material families of the given materials now, so a mesh that uses one of them
later draws on the next frame instead of several frames after that (ADR-0014).

###### Parameters

###### materials

readonly [`MaterialAsset`](#materialasset)[]

The materials whose families must be compiled.

###### Returns

`void`

###### Remarks

`app.start()` already does this for every material in the `boot` preload group. Call it by hand
for a spawn-heavy game that loads a material mid-level and wants to pay the cost at a moment of
its choosing.

***

### RenderingFeatureSettings

The rendering features a project switches on (`docs/architecture/07-rendering.md` §1.1). Every one
of them changes what Lite compiles at `registerScene`, so they are declared up front and a late
toggle is `IGX-0704`.

#### Properties

##### asyncPipelines

> `readonly` **asyncPipelines**: `boolean`

Compile shader pipelines asynchronously instead of blocking the first draw.

##### boneControl

> `readonly` **boneControl**: `boolean`

Build the glTF loader's skeleton handles, needed before loading a skinned asset.

##### deviceLostRecovery

> `readonly` **deviceLostRecovery**: `boolean`

Rebuild scenes and their resources after the WebGPU device is lost.

##### lightmaps

> `readonly` **lightmaps**: `boolean`

Load the PBR lightmap fragment extension.

##### materialPlugins

> `readonly` **materialPlugins**: `boolean`

Install the material plugin bridges and the scene hook they need.

##### postProcessing

> `readonly` **postProcessing**: `boolean`

Render the scene into an offscreen target and composite it, so a `PostProcessStack` has
something it is allowed to sample. Off by default: it costs one full-screen blit per frame.

##### shadows

> `readonly` **shadows**: `boolean`

Register the scene with a shadow pass, so a `Light` can cast.

##### skeletons

> `readonly` **skeletons**: `boolean`

Compile the Standard pipeline's skinning fragment, for skinned meshes.

##### stencil

> `readonly` **stencil**: `boolean`

Install stencil resolvers on the PBR, Standard, and Shader pipelines.

***

### RenderingSettings

The resolved `rendering` settings section
(`docs/architecture/04-extensions.md` §5, `07-rendering.md` §1).

#### Example

```ts
const app = await createApp({
  canvas,
  settings: { rendering: { features: { shadows: true }, msaaSamples: 1 } },
});
```

#### Properties

##### alphaMode

> `readonly` **alphaMode**: `"opaque"` \| `"premultiplied"`

How the canvas composites with the page. `"premultiplied"` lets HTML show through.

##### brdfLut

> `readonly` **brdfLut**: `string`

The address of the RGBD BRDF lookup table `loadEnvironment` requires.

##### clearColor

> `readonly` **clearColor**: [`ColorLike`](#colorlike)

The colour the scene is cleared to each frame, in sRGB.

###### Remarks

Applied to the render scene as it is created, which makes it the floor of a three-step
precedence (`docs/architecture/07-rendering.md` §2.1, §2.5): `Camera.clearColor` on the main
camera wins whenever it is not `null`, an `Environment.clearColor` wins over this setting, and
this setting wins over Babylon Lite's own mid grey.

##### features

> `readonly` **features**: [`RenderingFeatureSettings`](#renderingfeaturesettings)

The feature opt-ins, applied during `app.start()` before the scene is registered.

##### format

> `readonly` **format**: `string`

An explicit swapchain texture format; empty means Lite's own choice. Never an `*-srgb` one.

##### maxDevicePixelRatio

> `readonly` **maxDevicePixelRatio**: `number`

Clamp on the device pixel ratio the swapchain is sized at. `0` means "do not clamp".

##### msaaSamples

> `readonly` **msaaSamples**: `number`

MSAA sample count for the main pass. WebGPU allows 1 or 4; anything else is read as 4.

##### requiredLimits

> `readonly` **requiredLimits**: `Readonly`\<`Record`\<`string`, `number`\>\>

Extra WebGPU device limits to request, such as a larger `maxColorAttachmentBytesPerSample`.

##### srgb

> `readonly` **srgb**: `boolean`

Render through an sRGB swapchain view so alpha blending is gamma-correct.

##### useFloatingOrigin

> `readonly` **useFloatingOrigin**: `boolean`

Eye-relative upload for large-world coordinates. Requires `useHighPrecisionMatrix`.

##### useHighPrecisionMatrix

> `readonly` **useHighPrecisionMatrix**: `boolean`

Float64 intermediate precision for world matrices, for large worlds.

***

### RenderPick

What a GPU pick found (`docs/architecture/07-rendering.md` §3).

#### Properties

##### component

> `readonly` **component**: [`Component`](#abstract-component) \| `null`

The component that created the mesh, when it was not the entity's own transform.

##### distance

> `readonly` **distance**: `number`

How far along the ray the hit is, in metres.

##### entity

> `readonly` **entity**: [`Entity`](#entity-4)

The entity that owns the mesh the ray hit.

##### normal

> `readonly` **normal**: readonly \[`number`, `number`, `number`\] \| `null`

The world-space surface normal, or `null` unless detailed picking is on.

##### point

> `readonly` **point**: readonly \[`number`, `number`, `number`\] \| `null`

The world-space hit point, or `null` unless detailed picking is on.

***

### RenderPickOptions

How a GPU pick is restricted (`docs/architecture/07-rendering.md` §3).

#### Properties

##### filter?

> `readonly` `optional` **filter?**: (`entity`) => `boolean`

Restricts the pick to the entities this accepts. A rejected entity neither occludes nor
returns, which is what makes a "pick only the pickups" query exact rather than approximate.

###### Parameters

###### entity

[`Entity`](#entity-4)

The candidate.

###### Returns

`boolean`

`true` to consider the entity.

***

### RenderTaskTiming

One frame-graph task's measured GPU time (`docs/architecture/07-rendering.md` §5).

#### Properties

##### durationMs

> `readonly` **durationMs**: `number`

How long the task took on the GPU, in milliseconds.

##### name

> `readonly` **name**: `string`

The task's name in the frame graph: `"shadow"`, `"scene"`, or a post-process task's own.

***

### RenderTaskTimings

A per-task GPU timing snapshot (`docs/architecture/07-rendering.md` §5).

#### Properties

##### status

> `readonly` **status**: `string`

Whether the numbers mean anything: `"unsupported"` on a device with no timestamp queries — the
CI software adapter is one — `"disabled"` until `profileTasks` is on, `"pending"` until the
first readback lands, `"error"` when it failed, `"ok"` otherwise.

##### tasks

> `readonly` **tasks**: readonly [`RenderTaskTiming`](#rendertasktiming)[]

The tasks, in frame execution order. Empty unless `status` is `"ok"`.

***

### SceneAsset

What the scene loader produces for a `*.scene.json` or `*.prefab.json` address: the parsed file,
every asset it pulled in, and the content hash instance overrides are recorded against
(`docs/architecture/05-assets-and-loading.md` §2, `06-serialization-and-scene-format.md` §2).

#### Remarks

The handles are already loaded and retained by the asset. That is what lets
`world.instantiate(sceneAsset)` be synchronous: everything the file references — textures,
materials, and the scene assets its `instance` entries name — is in memory by the time the
`SceneAsset` exists (`02-scene-graph.md` §2).

#### Properties

##### address

> `readonly` **address**: `string`

The address the asset was loaded from.

##### dependencies

> `readonly` **dependencies**: readonly [`AssetHandle`](#assethandle)\<`unknown`\>[]

Every asset the file references, already loaded, in resolution order.

##### file

> `readonly` **file**: [`SceneFile`](#scenefile)

The parsed, validated file.

##### hash

> `readonly` **hash**: `string`

The content hash of [SceneAsset.file](#file), as `sha256:<hex>`.

***

### SceneBuildResult

What [instantiateScene](#instantiatescene) produced.

#### Properties

##### issues

> `readonly` **issues**: readonly [`SceneLoadIssue`](#sceneloadissue)[]

Every recoverable problem, in discovery order.

##### remap

> `readonly` **remap**: [`UidRemap`](#uidremap)

The file-local uid to runtime object table (`docs/architecture/02-scene-graph.md` §10).

##### roots

> `readonly` **roots**: readonly [`Entity`](#entity-4)[]

The entities that ended up parentless within the built subtree, in file order.

***

### SceneFile

A whole scene or prefab file (`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Example

```ts
const file = serializeScene(world.activeScene);
await app.storage.write("save.scene.json", stringifySceneFile(file));
```

#### Properties

##### engineVersion?

> `readonly` `optional` **engineVersion?**: `string`

The `@ignifx/core` version that wrote the file; informational.

##### entities

> `readonly` **entities**: readonly [`SceneFileEntity`](#scenefileentity)[]

Every entity, in tree order.

##### format

> `readonly` **format**: `string`

Always [SCENE\_FILE\_FORMAT](#scene_file_format).

##### formatVersion

> `readonly` **formatVersion**: `number`

Always [SCENE\_FORMAT\_VERSION](#scene_format_version) for files this build writes.

##### name

> `readonly` **name**: `string`

The scene's name.

##### settings?

> `readonly` `optional` **settings?**: [`JsonObject`](#jsonobject)

Scene-level values interpreted by systems (environment, clear colour, physics overrides).

***

### SceneFileAssetRef

A serialized asset reference: `{ "$asset": "<address>", "type"?: "<type>" }`
(`docs/architecture/06-serialization-and-scene-format.md` §3).

#### Properties

##### $asset

> `readonly` **$asset**: `string`

The address the asset is registered under.

##### type?

> `readonly` `optional` **type?**: `string`

The asset type name, written only when the address extension does not identify it.

***

### SceneFileComponent

One component of one entity.

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: `boolean`

Omitted when `true`, the default.

##### props?

> `readonly` `optional` **props?**: [`JsonObject`](#jsonobject)

Values in the component schema's declaration order (§3).

##### schemaVersion?

> `readonly` `optional` **schemaVersion?**: `number`

Written only when the class's `schemaVersion` differs from `1` (§7).

##### type

> `readonly` **type**: `string`

The component class's registered `typeId`.

##### uid

> `readonly` **uid**: `string`

ULID, unique within the file.

***

### SceneFileEntity

One entity of a scene file. Entities appear in tree order — parents before children, siblings in
`children` order — and `parent` names the uid of the parent, or `null` for a root.

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

The layer **name**, omitted when `"Default"`. Names, never indices, so reordering is safe.

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

The `instance` entry that turns an entity into the root of an instanced scene — what other
engines call a prefab instance (ADR-0005).

#### Properties

##### hash?

> `readonly` `optional` **hash?**: `string`

The content hash of that asset at save time; a mismatch reports `IGX-0604`.

##### overrides?

> `readonly` `optional` **overrides?**: readonly [`SceneFileOverride`](#scenefileoverride)[]

The patches applied to the instanced entities, in order.

##### scene

> `readonly` **scene**: [`SceneFileAssetRef`](#scenefileassetref)

The scene asset to instance.

***

### SceneFileIssue

One structural problem in a scene file.

#### Properties

##### message

> `readonly` **message**: `string`

An actionable description.

##### path

> `readonly` **path**: `string`

Where the problem is, in JSON-pointer-like notation, for example `entities/3/transform`.

***

### SceneFileOverride

One override patch applied to an instanced scene, addressed by the *instanced* file's uids
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Remarks

`op` defaults to `"replace"`, which is why the common case is the two-key
`{ path, value }` object shown in the format document.

#### Properties

##### op?

> `readonly` `optional` **op?**: `"replace"` \| `"remove"` \| `"add"`

`"replace"` (the default) patches a value, `"remove"` deletes a component, `"add"` appends one.

##### path

> `readonly` **path**: `string`

The path into the instanced file; see [parseOverridePath](#parseoverridepath).

##### value?

> `readonly` `optional` **value?**: [`JsonValue`](#jsonvalue)

The new value, for `"replace"` and `"add"`.

***

### SceneFileTransform

An entity's local transform, always present in the file and always three plain number arrays
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Remarks

The values are **local** — relative to `parent` — because the file already stores the tree and
local values are the ones that survive a parent being moved. The document says only "arrays
`[x, y, z]`, `[x, y, z, w]`, `[x, y, z]`"; this is the reading that round trips.

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

### SceneLoaderOptions

Options accepted by [createSceneLoader](#createsceneloader).

#### Properties

##### validate?

> `readonly` `optional` **validate?**: `boolean`

`true` (the default) validates every file against the scene format before building anything,
reporting `IGX-0608` with the issue list. Production builds may switch it off once the content
has been validated at build time by the Vite plugin
(`docs/architecture/06-serialization-and-scene-format.md` §8).

***

### SceneLoadIssue

One recoverable problem found while a scene was being built. Nothing here stops the load: a file
degrades one field, one reference, or one layer rather than failing whole
(`docs/architecture/06-serialization-and-scene-format.md` §4).

#### Properties

##### code

> `readonly` **code**: `string`

The diagnostic code, for example `IGX-0602` or `IGX-0303`.

##### message

> `readonly` **message**: `string`

The actionable sentence.

***

### SchemaDescription

One component schema as the documentation harness sees it. `pnpm docs:schemas` reads a record of
these, keyed by component `typeId`, from each built package's `schemas` export and turns it into
`references/formats/<format>.md` and `ignifx.schemas.json`.

#### Properties

##### description?

> `readonly` `optional` **description?**: `string`

A one-line summary of what the component does.

##### fields

> `readonly` **fields**: `Readonly`\<`Record`\<`string`, [`SchemaFieldDescription`](#schemafielddescription)\>\>

Every declared field, in declaration order.

##### format

> `readonly` **format**: `string`

The format page the entry is grouped onto; `components` unless overridden.

##### title

> `readonly` **title**: `string`

The human-readable name, by default the last segment of the type id.

***

### SchemaDescriptionMeta

Optional overrides for [describeSchema](#describeschema).

#### Properties

##### description?

> `readonly` `optional` **description?**: `string`

A one-line summary of what the component does.

##### format?

> `readonly` `optional` **format?**: `string`

Overrides the default `components` grouping.

##### title?

> `readonly` `optional` **title?**: `string`

Overrides the title derived from the type id.

***

### SchemaFieldDescription

One field as the documentation harness sees it (`scripts/README.md`, "Schema discovery
convention").

#### Properties

##### default?

> `readonly` `optional` **default?**: [`JsonValue`](#jsonvalue)

The field's default value, already encoded as JSON.

##### description?

> `readonly` `optional` **description?**: `string`

The field's tooltip, when it declares one.

##### kind

> `readonly` **kind**: [`FieldKind`](#fieldkind-1)

The field kind, for example `f32` or `asset`.

***

### SchemaIssue

One problem found while validating, encoding, or decoding a schema value. Issues are plain data:
this module never throws for bad *values*, it reports them, and the caller decides whether that
is a development-time throw or a logged diagnostic (`CONSTITUTION.md` §3.9).

#### Properties

##### code

> `readonly` **code**: [`SchemaIssueCode`](#schemaissuecode-2)

The stable `IGX-####` code for the problem.

##### message

> `readonly` **message**: `string`

An actionable description of what went wrong.

##### path

> `readonly` **path**: `string`

Where the problem is, in dotted/bracketed property notation, for example `waypoints[2].x`.

***

### ScriptCallbacks

Every callback a script may implement, with the signature the engine calls it with
(`docs/architecture/01-lifecycle-and-time.md` §4). All of them are optional; implement only the
ones the script needs.

#### Remarks

The interface is deliberately not merged into [Script](#abstract-script) — see the note there. Adding
`implements ScriptCallbacks` to a script is free at run time and checks that every callback the
class does implement has the right name and signature.

#### Example

```ts
class Door extends Script implements ScriptCallbacks {
  awake(): void {
    this.body = this.requireComponent(Rigidbody);
  }
  fixedUpdate(dt: number): void {
    this.body.move(dt);
  }
}
```

#### Methods

##### awake()?

> `optional` **awake**(): `void`

Runs once, the first time the script becomes effectively enabled inside a loaded world. During
a scene load it runs after every entity and component of that scene instance exists, in tree
order, with `entityRef`/`componentRef` fields already resolved.

###### Returns

`void`

##### fixedUpdate()?

> `optional` **fixedUpdate**(`dt`): `void`

Runs once per fixed step, before physics.

###### Parameters

###### dt

`number`

The fixed step in seconds; always `time.fixedDeltaTime`.

###### Returns

`void`

##### lateUpdate()?

> `optional` **lateUpdate**(`dt`): `void`

Runs once per frame, after animation has posed the scene.

###### Parameters

###### dt

`number`

Scaled seconds since the previous frame.

###### Returns

`void`

##### onApplicationFocus()?

> `optional` **onApplicationFocus**(`focused`): `void`

Runs on window focus changes.

###### Parameters

###### focused

`boolean`

`true` when the window just gained focus.

###### Returns

`void`

##### onApplicationPause()?

> `optional` **onApplicationPause**(`paused`): `void`

Runs when the document is hidden or shown, or the Electron window is minimized or restored.

###### Parameters

###### paused

`boolean`

`true` when the app just became hidden.

###### Returns

`void`

##### onCollisionEnter()?

> `optional` **onCollisionEnter**(`collision`): `void`

Runs when a contact begins, inside the fixed loop after the physics step.

###### Parameters

###### collision

`unknown`

The contact, supplied by the physics extension.

###### Returns

`void`

##### onCollisionExit()?

> `optional` **onCollisionExit**(`collision`): `void`

Runs when a contact ends.

###### Parameters

###### collision

`unknown`

The contact.

###### Returns

`void`

##### onCollisionStay()?

> `optional` **onCollisionStay**(`collision`): `void`

Runs while a contact persists.

###### Parameters

###### collision

`unknown`

The contact.

###### Returns

`void`

##### onDestroy()?

> `optional` **onDestroy**(): `void`

Runs once, in the destroy flush of the frame `destroy()` was called in.

###### Returns

`void`

##### onDisable()?

> `optional` **onDisable**(): `void`

Runs on every transition off effectively enabled, including just before destruction.

###### Returns

`void`

##### onEnable()?

> `optional` **onEnable**(): `void`

Runs after `awake`, and on every later transition to effectively enabled.

###### Returns

`void`

##### onTriggerEnter()?

> `optional` **onTriggerEnter**(`trigger`): `void`

Runs when an overlap with a trigger shape begins.

###### Parameters

###### trigger

`unknown`

The overlap, supplied by the physics extension.

###### Returns

`void`

##### onTriggerExit()?

> `optional` **onTriggerExit**(`trigger`): `void`

Runs when an overlap with a trigger shape ends.

###### Parameters

###### trigger

`unknown`

The overlap.

###### Returns

`void`

##### start()?

> `optional` **start**(): `void`

Runs once, in the first frame the script is effectively enabled, after the fixed loop.

###### Returns

`void`

##### update()?

> `optional` **update**(`dt`): `void`

Runs once per frame.

###### Parameters

###### dt

`number`

Scaled seconds since the previous frame.

###### Returns

`void`

***

### ScriptClassInfo

What the registry worked out about a script class by inspecting its prototype exactly once.

#### Properties

##### callbacks

> `readonly` **callbacks**: `number`

One bit per `ScriptCallbackKind`: set when the class implements that callback.

##### executionOrder

> `readonly` **executionOrder**: `number`

`static executionOrder`, resolved at registration.

##### updateWhenPaused

> `readonly` **updateWhenPaused**: `boolean`

`static updateWhenPaused`, resolved at registration.

***

### ScriptStatics

The static members a script class may declare: everything [ComponentStatics](#componentstatics) allows plus
the two scheduling flags (`docs/architecture/01-lifecycle-and-time.md` §3). Structural and
optional for the reason given on [ComponentStatics](#componentstatics).

#### Extends

- [`ComponentStatics`](#componentstatics)

#### Properties

##### allowMultiple?

> `readonly` `optional` **allowMultiple?**: `boolean`

`false` when at most one instance may be attached to an entity; defaults to `true`.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`allowMultiple`](#allowmultiple-3)

##### executionOrder?

> `readonly` `optional` **executionOrder?**: `number`

Lower runs first within a phase; ties break on creation order. Core systems use
`[-1000, 1000]`. Defaults to `0`.

##### requires?

> `readonly` `optional` **requires?**: readonly [`ComponentType`](#componenttype-1)\<[`Component`](#abstract-component)\>[]

Component types auto-added to, and validated on, any entity this one is attached to.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`requires`](#requires-1)

##### schema?

> `readonly` `optional` **schema?**: `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The serialized field declarations, set by `Component.define` / `Script.define`.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`schema`](#schema-4)

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
derived from the class name, so minification and renames cannot change a file's meaning.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`typeId`](#typeid-4)

##### updateWhenPaused?

> `readonly` `optional` **updateWhenPaused?**: `boolean`

When `true`, the script still receives `update`/`lateUpdate` while `app.pause()` is in effect.
Defaults to `false`.

***

### SerializeIssue

One problem found while writing a file. Serialization is total — it always produces valid JSON —
so a problem means one value was written as `null` or one link was dropped, never that the save
failed (`docs/architecture/06-serialization-and-scene-format.md` §3).

#### Properties

##### code

> `readonly` **code**: `string`

The diagnostic code, for example `IGX-0602`.

##### message

> `readonly` **message**: `string`

The actionable sentence.

***

### SerializeSceneOptions

Options accepted by [serializeScene](#serializescene).

#### Properties

##### engineVersion?

> `readonly` `optional` **engineVersion?**: `string` \| `null`

Overrides the recorded `engineVersion`; `null` omits it, which is what byte-stable tests use.

##### flatten?

> `readonly` `optional` **flatten?**: `boolean`

`true` writes every entity of an instanced subtree as a plain entity instead of one `instance`
entry with computed overrides (`docs/architecture/06-serialization-and-scene-format.md` §5).
Flattened files no longer track the prefab and their uids are the runtime ones, which differ
per load.

##### name?

> `readonly` `optional` **name?**: `string`

Overrides the file's `name`; defaults to the instance's name, or `"scene"`.

##### onIssue?

> `readonly` `optional` **onIssue?**: (`issue`) => `void`

Receives every problem found, in discovery order.

###### Parameters

###### issue

[`SerializeIssue`](#serializeissue)

###### Returns

`void`

##### settings?

> `readonly` `optional` **settings?**: [`JsonObject`](#jsonobject) \| `null`

Overrides the file's `settings` block; defaults to the instance's.

***

### ServiceNameKey

A service key created from a name, for services that are plain objects rather than classes.

#### Type Parameters

##### T

`T`

The service instance type. It is a compile-time marker only: `serviceOf` is never
assigned at runtime, and it is what makes two keys with different service types different types.

#### Properties

##### serviceName

> `readonly` **serviceName**: `string`

The name the key was created with, used in error messages.

##### serviceOf?

> `readonly` `optional` **serviceOf?**: `T`

Compile-time marker for the service type; never present at runtime.

***

### ServiceRegistry

The per-app service table (`docs/architecture/04-extensions.md` §1). Extensions write to it
through `ExtensionContext.registerService`; scripts read from it.

#### Methods

##### get()

> **get**\<`T`\>(`key`): `T`

Looks a service up, requiring it to be present.

###### Type Parameters

###### T

`T`

The service instance type.

###### Parameters

###### key

[`ServiceKey`](#servicekey)\<`T`\>

The class or named key the service was registered under.

###### Returns

`T`

The registered instance.

###### Throws

IgnifxError with code `IGX-0405` when no extension registered the service.

##### has()

> **has**(`key`): `boolean`

Reports whether a service is registered.

###### Parameters

###### key

[`ServiceKey`](#servicekey)\<`unknown`\>

The class or named key.

###### Returns

`boolean`

`true` when an instance is registered under the key.

##### tryGet()

> **tryGet**\<`T`\>(`key`): `T` \| `null`

Looks a service up, tolerating its absence — the pattern for game code that must work with or
without an optional extension.

###### Type Parameters

###### T

`T`

The service instance type.

###### Parameters

###### key

[`ServiceKey`](#servicekey)\<`T`\>

The class or named key the service was registered under.

###### Returns

`T` \| `null`

The instance, or `null` when it is not registered.

***

### SetParentOptions

Options accepted by `Entity.setParent`. Written as code rather than as a documentation link
because `Entity` is a class and an interface at once: an unqualified reference is ambiguous to
API Extractor, and the qualified form it asks for is unresolvable to TypeDoc.

#### Properties

##### worldPositionStays?

> `readonly` `optional` **worldPositionStays?**: `boolean`

`true` (the default) preserves the entity's world transform by rewriting its local values;
`false` keeps the local values, so the entity moves with the new parent
(`docs/architecture/02-scene-graph.md` §5.1).

***

### SignalLike

The read-only half of a [Signal](#signal-3): what a public API exposes when callers may subscribe but
must not emit, where `T` is the payload the signal emits.

#### Example

```ts
interface Assets {
  readonly onLoaded: SignalLike<AssetHandle>;
}
```

#### Type Parameters

##### T

`T` = `void`

#### Properties

##### connectionCount

> `readonly` **connectionCount**: `number`

How many handlers are currently attached.

#### Methods

##### connect()

> **connect**(`handler`, `options?`): [`Disconnect`](#disconnect)

Attaches a handler.

###### Parameters

###### handler

[`SignalHandler`](#signalhandler)\<`T`\>

The listener.

###### options?

[`ConnectOptions`](#connectoptions)

`once`, `deferred`, and `owner`.

###### Returns

[`Disconnect`](#disconnect)

A function that detaches the handler.

***

### SignalOptions

Options for the [Signal](#signal-3) constructor, where `T` is the payload the signal emits.

#### Type Parameters

##### T

`T`

#### Properties

##### deferredQueue?

> `readonly` `optional` **deferredQueue?**: [`DeferredQueue`](#deferredqueue)

The scheduler used by `deferred` connections. Without it, `deferred: true` throws.

##### onHandlerError?

> `readonly` `optional` **onHandlerError?**: (`error`, `signal`) => `void`

Where handler exceptions go. When set, every exception is reported here and delivery continues;
when absent, the first exception is rethrown as `IGX-0104` once every handler has run. The app
passes a reporter that routes to `app.onError`. It must not throw.

###### Parameters

###### error

`unknown`

###### signal

[`Signal`](#signal-3)\<`T`\>

###### Returns

`void`

***

### SignalOwner

Anything whose destruction should take its signal connections with it: an `Entity`, a
`Component`, a `SceneInstance`. Connecting with an `owner` is how scripts avoid leaking handlers,
and the `ignifx/signal-connect-owner` lint rule requires it inside a `Script`
(`docs/architecture/02-scene-graph.md` §8).

#### Properties

##### isDestroyed

> `readonly` **isDestroyed**: `boolean`

Whether the owner has already been destroyed.

##### onDestroyed

> `readonly` **onDestroyed**: [`SignalLike`](#signallike)\<`unknown`\>

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal-3) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

***

### SimulatedEvent

What [InputService.simulateEvent](#simulateevent) accepts: an event record with everything but `type`
optional.

#### Properties

##### button?

> `readonly` `optional` **button?**: `number`

The `PointerEvent.button` index.

##### code?

> `readonly` `optional` **code?**: `string`

The control name a key event names, for example `w` — not the raw `KeyboardEvent.code`.

##### deltaX?

> `readonly` `optional` **deltaX?**: `number`

The pointer movement x, or the wheel's horizontal delta.

##### deltaY?

> `readonly` `optional` **deltaY?**: `number`

The pointer movement y, or the wheel's vertical delta.

##### key?

> `readonly` `optional` **key?**: `string`

The layout-dependent key, or the composed text of a `textinput` event.

##### pointerId?

> `readonly` `optional` **pointerId?**: `number`

The `PointerEvent.pointerId`.

##### pointerType?

> `readonly` `optional` **pointerType?**: `string`

The `PointerEvent.pointerType`: `mouse`, `pen`, or `touch`. Defaults to `mouse`.

##### repeat?

> `readonly` `optional` **repeat?**: `boolean`

Whether a key event is an auto-repeat.

##### type

> `readonly` **type**: [`InputEventType`](#inputeventtype)

Which kind of event to queue.

##### x?

> `readonly` `optional` **x?**: `number`

The pointer x, in CSS pixels from the canvas's left edge.

##### y?

> `readonly` `optional` **y?**: `number`

The pointer y, in CSS pixels from the canvas's top edge.

***

### SmaaEffectSettings

The `smaa` record a `PostProcessStack` declares (`docs/architecture/07-rendering.md` §2.7).

#### Properties

##### cornerDetection

> **cornerDetection**: `boolean`

Whether corner patterns are attenuated.

##### diagonalDetection

> **diagonalDetection**: `boolean`

Whether 45-degree patterns are detected.

##### enabled

> **enabled**: `boolean`

Whether subpixel morphological anti-aliasing runs.

##### maxSearchSteps

> **maxSearchSteps**: `number`

How far the pattern search runs along an edge, in pixels.

##### order

> **order**: `number`

Position in the chain; lower runs first.

##### threshold

> **threshold**: `number`

The luma difference that counts as an edge.

***

### SortingLayersSettings

The `sortingLayers` project settings section, consumed by the 2D toolkit.

#### Properties

##### sortingLayers

> `readonly` **sortingLayers**: readonly `string`[]

The project's sorting-layer names, back to front.

***

### SoundInstance

A playing sound: what `AudioSource.play()` and `app.audio.playOneShot()` return
(`docs/architecture/10-audio.md` §1, §3).

#### Remarks

It names the sound, not one of its concurrent instances — see the note on this module. Two
`play()` calls on the same `AudioSource` therefore return the same object with
`instanceCount === 2`, and `stop()` stops both.

#### Example

```ts
const engineLoop = this.source.play({ loop: true });
engineLoop.setVolume(0.2, 0.5);
engineLoop.onEnded.connect(() => this.spawnPuff(), { owner: this });
```

#### Properties

##### bus

> `readonly` **bus**: [`AudioBus`](#audiobus) \| `null`

The bus it routes into, or `null` when it goes straight to the engine's main bus.

##### clip

> `readonly` **clip**: [`AudioClip`](#audioclip)

The clip being played.

##### instanceCount

> `readonly` **instanceCount**: `number`

How many instances are live, including ones queued behind the unlock.

##### isPaused

> `readonly` **isPaused**: `boolean`

`true` when every live instance is paused.

##### isPlaying

> `readonly` **isPlaying**: `boolean`

`true` while at least one instance is sounding, or waiting for the unlock.

##### onEnded

> `readonly` **onEnded**: [`SignalLike`](#signallike)

Emitted in `PreRender` on the frame the last instance stops sounding, whether it ran out or was
stopped. Never emitted for a sound that is merely paused.

##### volume

> `readonly` **volume**: `number`

The gain, where a fade in progress has reached.

#### Methods

##### pause()

> **pause**(): `void`

Pauses every instance, keeping its position.

###### Returns

`void`

##### resume()

> **resume**(): `void`

Resumes every paused instance.

###### Returns

`void`

##### setVolume()

> **setVolume**(`volume`, `rampSeconds?`): `void`

Fades the gain.

###### Parameters

###### volume

`number`

The target linear gain.

###### rampSeconds?

`number`

How long the fade takes, in frame time; `0` applies immediately.

###### Returns

`void`

##### stop()

> **stop**(`fadeSeconds?`): `void`

Stops every instance, optionally fading out first.

###### Parameters

###### fadeSeconds?

`number`

Seconds of frame time to fade over; `0` stops now.

###### Returns

`void`

***

### SphereMeshOptions

How [MeshAsset.sphere](#sphere) tessellates its sphere.

#### Properties

##### diameter?

> `readonly` `optional` **diameter?**: `number`

Diameter on every axis, in metres. Lite defaults to 1.

##### segments?

> `readonly` `optional` **segments?**: `number`

Ring count; higher is smoother. Lite defaults to 32.

***

### StandardMaterialDefinition

The properties a `"standard"` material declares — the cheap non-PBR path
(`docs/architecture/07-rendering.md` §2.6).

#### Properties

##### alpha

> `readonly` **alpha**: `number`

Overall material alpha, 0 to 1.

##### alphaCutoff

> `readonly` **alphaCutoff**: `number`

The cutoff below which a fragment is discarded. `0` disables the alpha test.

##### diffuse

> `readonly` **diffuse**: [`ColorLike`](#colorlike)

sRGB diffuse colour.

##### doubleSided

> `readonly` **doubleSided**: `boolean`

Whether back faces are drawn.

##### emissive

> `readonly` **emissive**: [`ColorLike`](#colorlike)

sRGB emissive colour.

##### kind

> `readonly` **kind**: `"standard"`

The family discriminator.

##### name

> `readonly` **name**: `string`

A human-readable name.

##### specular

> `readonly` **specular**: [`ColorLike`](#colorlike)

sRGB specular colour.

##### specularPower

> `readonly` **specularPower**: `number`

Specular exponent; higher values give a tighter highlight.

##### textures

> `readonly` **textures**: `Readonly`\<`Record`\<`string`, `string`\>\>

The addresses of the textures the material samples, by slot.

##### unlit

> `readonly` **unlit**: `boolean`

Whether lighting is skipped entirely.

***

### StringFieldSpec

Kind-specific data for `str`.

#### Properties

##### kind

> `readonly` **kind**: `"str"`

The string kind.

***

### System

Engine-level logic that runs once per phase over many components, registered by an extension
(`docs/architecture/03-scripting-and-components.md` §6). Systems are not attached to entities and
never call script callbacks themselves.

#### Example

```ts
class SpriteSyncSystem implements System {
  readonly name = "sprite-sync";
  update(ctx: SystemContext): void {
    const sprites = ctx.world.components(SpriteRenderer);
    for (let index = 0; index < sprites.length; index += 1) {
      sprites[index]?.sync();
    }
  }
}
```

#### Properties

##### name

> `readonly` **name**: `string`

A unique, human-readable name used in diagnostics and error reports.

#### Methods

##### dispose()?

> `optional` **dispose**(): `void`

Releases resources the system owns.

###### Returns

`void`

##### onWorldCreated()?

> `optional` **onWorldCreated**(`world`): `void`

Called once when the world the system belongs to has been created.

###### Parameters

###### world

[`World`](#world-16)

The new world.

###### Returns

`void`

##### onWorldDisposed()?

> `optional` **onWorldDisposed**(`world`): `void`

Called once when the world the system belongs to is being disposed.

###### Parameters

###### world

[`World`](#world-16)

The world going away.

###### Returns

`void`

##### update()?

> `optional` **update**(`ctx`): `void`

Runs the system's work for one phase.

###### Parameters

###### ctx

[`SystemContext`](#systemcontext)

The world, clock, phase, and delta for this invocation.

###### Returns

`void`

***

### SystemContext

What a [System](#system) is handed when its phase runs
(`docs/architecture/03-scripting-and-components.md` §6).

#### Properties

##### dt

> `readonly` **dt**: `number`

Seconds elapsed: `time.deltaTime`, or `time.fixedDeltaTime` inside the fixed loop.

##### phase

> `readonly` **phase**: [`Phase`](#phase-3)

The phase currently running.

##### time

> `readonly` **time**: [`Time`](#time-3)

The app clock.

##### world

> `readonly` **world**: [`World`](#world-16)

The world the system operates on.

***

### TextureAssetLiteHandles

The Babylon Lite objects a [TextureAsset](#textureasset) owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### texture

> `readonly` **texture**: `Texture2D` \| `null`

The GPU texture, or `null` under a headless app.

***

### TextureImportOptions

The import options a texture's `.meta.json` sidecar can declare, under its `texture` key
(`docs/architecture/05-assets-and-loading.md` §7).

#### Remarks

They are the sampler and decode options, not scene state: two materials that sample one address
get one texture with one set of options, because the cache is keyed by address.

#### Example

```json
{ "texture": { "srgb": true, "addressModeU": "clamp-to-edge" } }
```

#### Properties

##### addressModeU

> `readonly` **addressModeU**: `string`

Address mode along U.

##### addressModeV

> `readonly` **addressModeV**: `string`

Address mode along V.

##### invertY

> `readonly` **invertY**: `boolean`

Flip the image vertically at upload. Lite defaults to `true`, matching Babylon.js.

##### magFilter

> `readonly` **magFilter**: `string`

Magnification filter.

##### minFilter

> `readonly` **minFilter**: `string`

Minification filter.

##### mipMaps

> `readonly` **mipMaps**: `boolean`

Generate a mip chain. Lite defaults to `true`.

##### premultiplyAlpha

> `readonly` **premultiplyAlpha**: `boolean`

Premultiply alpha at decode time; for atlases drawn with a premultiplied blend pipeline.

##### srgb

> `readonly` **srgb**: `boolean`

Decode to linear on sample (`rgba8unorm-srgb`). Base colour and emissive want it; data maps must not.

***

### Time

The clock reached as `app.time` (`docs/architecture/01-lifecycle-and-time.md` §2). Every value is
in **seconds** unless its name ends in `Ms`.

#### Example

```ts
class Spin extends Script {
  update(dt: number): void {
    // `dt` is the argument, never `app.time.deltaTime`, inside a callback.
    this.transform.rotate({ x: 0, y: 90 * dt, z: 0 });
  }
}
```

#### Properties

##### deltaTime

> `readonly` **deltaTime**: `number`

Scaled seconds since the previous frame; what `update` and `lateUpdate` receive.

##### fixedDeltaTime

> **fixedDeltaTime**: `number`

The size of one fixed step; what `fixedUpdate` receives. Defaults to `1 / 60`.

##### fixedStepAlpha

> `readonly` **fixedStepAlpha**: `number`

`accumulator / fixedDeltaTime` after the fixed loop, in `[0, 1)`; the interpolation alpha.

##### fixedTime

> `readonly` **fixedTime**: `number`

Scaled seconds advanced by fixed steps so far.

##### frameCount

> `readonly` **frameCount**: `number`

How many frames have started. Starts at `0`.

##### inFixedStep

> `readonly` **inFixedStep**: `boolean`

`true` while `fixedUpdate` and physics run.

##### maximumDeltaTime

> **maximumDeltaTime**: `number`

Upper clamp on one frame's delta, in seconds. Defaults to `0.1`.

##### paused

> **paused**: `boolean`

When `true`, fixed steps stop and only `updateWhenPaused` scripts receive `update`.

##### realtimeSinceStartup

> `readonly` **realtimeSinceStartup**: `number`

Wall-clock seconds since the app was created, unaffected by pause or time scale.

##### time

> `readonly` **time**: `number`

Scaled seconds since `app.start()`.

##### timeScale

> **timeScale**: `number`

Multiplier applied to [Time.unscaledDeltaTime](#unscaleddeltatime); `0` freezes scaled time. Defaults to `1`.

##### unscaledDeltaTime

> `readonly` **unscaledDeltaTime**: `number`

Wall-clock frame delta after the [Time.maximumDeltaTime](#maximumdeltatime) clamp, unscaled.

##### unscaledTime

> `readonly` **unscaledTime**: `number`

Unscaled seconds since `app.start()`.

***

### TimeSettings

The `time` project settings section (`docs/architecture/01-lifecycle-and-time.md` §2).

#### Properties

##### fixedDeltaTime?

> `readonly` `optional` **fixedDeltaTime?**: `number`

The initial fixed step in seconds. Defaults to `1 / 60`.

##### maximumDeltaTime?

> `readonly` `optional` **maximumDeltaTime?**: `number`

The initial frame-delta clamp in seconds. Defaults to `0.1`.

##### timeScale?

> `readonly` `optional` **timeScale?**: `number`

The initial time scale. Defaults to `1`.

***

### TorusMeshOptions

How [MeshAsset.torus](#torus) sizes its ring, which lies in the XZ plane.

#### Properties

##### diameter?

> `readonly` `optional` **diameter?**: `number`

Outer diameter, in metres.

##### tessellation?

> `readonly` `optional` **tessellation?**: `number`

Segment count around the ring.

##### thickness?

> `readonly` `optional` **thickness?**: `number`

Tube thickness, in metres.

***

### UlidFactoryOptions

Options for [createUlidFactory](#createulidfactory).

#### Properties

##### now?

> `readonly` `optional` **now?**: () => `number`

The clock, in milliseconds since the Unix epoch. Defaults to `Date.now`.

###### Returns

`number`

##### random?

> `readonly` `optional` **random?**: [`RandomSource`](#randomsource)

Where randomness comes from. Defaults to [createCryptoRandom](#createcryptorandom).

***

### Vec2Like

The structural shape of a 2D vector. Public APIs accept this interface so that plain object
literals, typed views, and the engine's `Vec2` class are interchangeable.

#### Properties

##### x

> `readonly` **x**: `number`

The x component.

##### y

> `readonly` **y**: `number`

The y component.

***

### Vec3Like

The structural shape of a 3D vector.

#### Properties

##### x

> `readonly` **x**: `number`

The x component.

##### y

> `readonly` **y**: `number`

The y component.

##### z

> `readonly` **z**: `number`

The z component.

***

### Vec4Like

The structural shape of a 4D vector.

#### Properties

##### w

> `readonly` **w**: `number`

The w component.

##### x

> `readonly` **x**: `number`

The x component.

##### y

> `readonly` **y**: `number`

The y component.

##### z

> `readonly` **z**: `number`

The z component.

***

### VectorFieldSpec

Kind-specific data for the vector kinds. `components` says how many numbers the encoded array
holds, so encoders do not have to re-derive it from the kind.

#### Properties

##### components

> `readonly` **components**: `2` \| `3` \| `4`

How many components the value has: 2, 3, or 4.

##### kind

> `readonly` **kind**: `"vec2"` \| `"vec3"` \| `"vec4"` \| `"quat"`

The vector kind.

***

### VibrationActuatorLike

The subset of the DOM `GamepadHapticActuator` this package uses.

#### Methods

##### playEffect()

> **playEffect**(`type`, `parameters`): `Promise`\<`unknown`\>

Plays one haptic effect.

###### Parameters

###### type

`string`

The effect type; `"dual-rumble"` is the only one every pad supports.

###### parameters

[`VibrationEffectParameters`](#vibrationeffectparameters)

How long the effect lasts and how hard the motors run.

###### Returns

`Promise`\<`unknown`\>

Whatever the host resolves the effect with.

***

### VibrationEffectParameters

The shape of one `dual-rumble` haptic effect.

#### Properties

##### duration

> `readonly` **duration**: `number`

How long the effect lasts, in milliseconds.

##### strongMagnitude

> `readonly` **strongMagnitude**: `number`

The low-frequency motor magnitude, in `[0, 1]`.

##### weakMagnitude

> `readonly` **weakMagnitude**: `number`

The high-frequency motor magnitude, in `[0, 1]`.

***

### VoiceHost

What a voice needs from the service to decide whether to play now or later. `AudioService`
implements it; nothing else has any reason to.

#### Properties

##### backend

> `readonly` **backend**: [`AudioBackend`](#audiobackend)

The backend every call is forwarded to.

##### isLocked

> `readonly` **isLocked**: `boolean`

`true` before the first unlock, when a browser would refuse to make a sound.

##### queueWhileLocked

> `readonly` **queueWhileLocked**: `boolean`

Whether plays made while locked are held rather than dropped.

#### Methods

##### reportError()

> **reportError**(`error`): `void`

Reports a failure that has no caller to throw at — a decode that rejected, say.

###### Parameters

###### error

`unknown`

What went wrong.

###### Returns

`void`

***

### VoiceRequest

What the service is asked to build a voice from: an [AudioSource](#audiosource)'s fields, or the
arguments of one `playOneShot`.

#### Properties

##### bus

> `readonly` **bus**: `string`

The name of the bus it routes into; empty routes to the default sound bus.

##### clip

> `readonly` **clip**: [`AudioClip`](#audioclip)

The clip to play.

##### loop

> `readonly` **loop**: `boolean`

Whether instances loop.

##### maxInstances

> `readonly` **maxInstances**: `number`

How many instances may play at once; the oldest is stolen above it.

##### pan

> `readonly` **pan**: `number`

Stereo pan in `[-1, 1]`, for a non-spatial sound.

##### playbackRate

> `readonly` **playbackRate**: `number`

Playback rate; ignifx's `pitch` maps onto it.

##### spatial

> `readonly` **spatial**: [`BackendSpatialRequest`](#backendspatialrequest) \| `null`

The 3D placement, or `null` for a non-spatial sound.

##### volume

> `readonly` **volume**: `number`

The sound's own linear gain.

***

### WaitInstruction

A wait a coroutine yielded, built by `waitSeconds`, `waitSecondsRealtime`, `waitFixedUpdate`,
`waitUntil`, or `waitWhile`.

#### Properties

##### kind

> `readonly` **kind**: `"fixedUpdate"` \| `"seconds"` \| `"secondsRealtime"` \| `"until"` \| `"while"`

Which kind of wait this is; the scheduler switches on it.

##### predicate?

> `readonly` `optional` **predicate?**: () => `boolean`

The condition, for the two predicate kinds.

###### Returns

`boolean`

##### seconds?

> `readonly` `optional` **seconds?**: `number`

How long to wait, for the two timed kinds.

***

### WavHeader

What a WAV header says about the audio it introduces.

#### Properties

##### channels

> `readonly` **channels**: `number`

How many interleaved channels the data holds.

##### duration

> `readonly` **duration**: `number`

How long the sample data plays, in seconds.

##### sampleRate

> `readonly` **sampleRate**: `number`

Samples per second per channel.

***

### WorldLiteHandles

Babylon Lite objects a world owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3, `02-scene-graph.md` §2); excluded from the stability
guarantees of `CONSTITUTION.md` Article IV.

#### Properties

##### scene

> `readonly` **scene**: `SceneContext`

The Lite scene the world's entities are rendered from.

##### simulationScene

> `readonly` **simulationScene**: `SceneContext` \| `null`

The scene a physics extension steps its simulation in (`docs/architecture/09-physics.md` §1),
or `null` when no extension has set one.

## Type Aliases

### AssetState

> **AssetState** = `"loading"` \| `"loaded"` \| `"failed"` \| `"released"`

Where an [AssetHandle](#assethandle) is in its life
(`docs/architecture/05-assets-and-loading.md` §3).

***

### AudioBackendKind

> **AudioBackendKind** = `"web"` \| `"headless"`

Which implementation of [AudioBackend](#audiobackend) is running.

***

### AudioBackendState

> **AudioBackendState** = `"running"` \| `"suspended"` \| `"interrupted"` \| `"closed"`

The audio context's state, mirroring Babylon Lite's `AudioEngineState` (`index.d.ts` 970) and,
through it, Web Audio's `AudioContextState` plus `"interrupted"`.

***

### AudioDecoder

> **AudioDecoder** = (`clip`) => `Promise`\<`void`\>

How a clip's bytes are turned into a decoded buffer, when the app has a backend that can.

#### Parameters

##### clip

[`AudioClip`](#audioclip)

#### Returns

`Promise`\<`void`\>

#### Remarks

The loader is registered in `register`, long before `onStart` creates the backend, so it holds a
lookup rather than a backend: the function answers `null` until there is one.

***

### AudioDistanceModel

> **AudioDistanceModel** = *typeof* [`AUDIO_DISTANCE_MODELS`](#audio_distance_models)\[`number`\]

The union of the distance models [AUDIO\_DISTANCE\_MODELS](#audio_distance_models) declares.

***

### AudioErrorCode

> **AudioErrorCode** = *typeof* [`AudioErrorCode`](#audioerrorcode)\[keyof *typeof* [`AudioErrorCode`](#audioerrorcode)\]

The union of the codes the `AudioErrorCode` table declares.

***

### AudioServiceState

> **AudioServiceState** = `"locked"` \| `"running"` \| `"suspended"` \| `"interrupted"` \| `"closed"`

What `app.audio.state` reports: Babylon Lite's `AudioEngineState` (`index.d.ts` 970) plus
`"locked"`, the state before the first unlock.

***

### CameraProjection

> **CameraProjection** = *typeof* [`PROJECTIONS`](#projections)\[`number`\]

The union of the camera projections.

***

### CanvasAlphaMode

> **CanvasAlphaMode** = *typeof* [`CANVAS_ALPHA_MODES`](#canvas_alpha_modes)\[`number`\]

The union of the canvas alpha modes.

***

### ComponentDefinition

> **ComponentDefinition**\<`S`\> = () => [`Component`](#abstract-component) & [`FieldsOf`](#fieldsof)\<`S`\> & `object`

The abstract base class `Component.define` returns: a `Component` that also carries every
field the schema declares, typed.

#### Type Declaration

##### prototype

> `readonly` **prototype**: [`Component`](#abstract-component) & [`FieldsOf`](#fieldsof)\<`S`\>

The instance shape, so the class satisfies `ComponentType`.

##### schema

> `readonly` **schema**: `S`

The schema the class was defined from, carried as a value on the returned class. The other
statics ([ComponentStatics](#componentstatics)) are deliberately *not* declared here: a subclass must be
able to write a plain `static typeId` without the `override` keyword.

#### Type Parameters

##### S

`S` *extends* [`Schema`](#schema-14)

The schema the class was defined from.

***

### ComponentHandle

> **ComponentHandle** = `number` & `object`

The dense runtime id of a component, with the same lifetime rules as [EntityHandle](#entityhandle-1).

#### Type Declaration

##### \_\_brand

> `readonly` **\_\_brand**: `"ComponentHandle"`

***

### ComponentInit

> **ComponentInit**\<`T`\> = `{ readonly [K in keyof T as K extends keyof Component ? never : NonNullable<T[K]> extends (args: never[]) => unknown ? never : K]?: T[K] }`

The values `entity.addComponent(Type, init)` accepts: the component's serialized fields, each
optional. Engine-owned members (`entity`, `enabled`, …) and methods are excluded, so an `init`
object can only set declared data.

#### Type Parameters

##### T

`T` *extends* [`Component`](#abstract-component)

The component instance type.

#### Example

```ts
entity.addComponent(Mover, { speed: 12, label: "hero" });
```

***

### CompositeKind

> **CompositeKind** = *typeof* [`CompositeKind`](#compositekind)\[keyof *typeof* [`CompositeKind`](#compositekind)\]

The union of the composite names.

***

### ControlKind

> **ControlKind** = *typeof* [`ControlKind`](#controlkind)\[keyof *typeof* [`ControlKind`](#controlkind)\]

The union of the control kinds.

***

### ControlTouchHandler

> **ControlTouchHandler** = (`actions`) => `void`

Called when a control's value changed, with the action indices bound to that control. The service
installs it so that the frame's resolution can visit actions in the arrival order of the events
that actuated them.

#### Parameters

##### actions

readonly `number`[]

#### Returns

`void`

***

### CoreErrorCode

> **CoreErrorCode** = *typeof* [`CoreErrorCode`](#coreerrorcode)\[keyof *typeof* [`CoreErrorCode`](#coreerrorcode)\]

The union of the codes `@ignifx/core` owns. Use it to narrow `catch` blocks to core failures.

***

### Coroutine

> **Coroutine** = `Generator`\<[`CoroutineYield`](#coroutineyield), `void`, `unknown`\>

A generator coroutine (`docs/architecture/01-lifecycle-and-time.md` §5, ADR-0010). The scheduler
resumes it synchronously at defined points in the frame; it is never an `async` function.

***

### CoroutineYield

> **CoroutineYield** = `null` \| `undefined` \| [`WaitInstruction`](#waitinstruction) \| [`CoroutineHandle`](#coroutinehandle) \| `Promise`\<`unknown`\>

Everything a coroutine may `yield`: `null`/`undefined` for "next frame", a wait instruction, a
handle to another coroutine to wait for, or a promise to resume on once it settles.

***

### CurveKey

> **CurveKey** = readonly \[`number`, `number`, `number`, `number`\]

One key of an animation curve: time, value, incoming tangent, outgoing tangent
(`docs/architecture/06-serialization-and-scene-format.md` §3).

***

### DeviceKind

> **DeviceKind** = *typeof* [`DeviceKind`](#devicekind)\[keyof *typeof* [`DeviceKind`](#devicekind)\]

The union of the device families.

***

### Disconnect

> **Disconnect** = () => `void`

Detaches a handler from a [Signal](#signal-3). Calling it more than once is a no-op.

#### Returns

`void`

***

### EntityHandle

> **EntityHandle** = `number` & `object`

The dense runtime id of an entity. Valid until the entity is destroyed; a handle that outlives
its entity resolves to `null` through `world.getEntityByHandle` rather than to whatever object
recycled the slot.

#### Type Declaration

##### \_\_brand

> `readonly` **\_\_brand**: `"EntityHandle"`

#### Remarks

The `__brand` property exists only in the type system — a handle is a `number` at runtime — so a
handle can be stored in a `Float64Array` or written into Lite's node metadata unchanged.

#### Example

```ts
const handle: EntityHandle = entity.handle;
world.getEntityByHandle(handle)?.destroy();
```

***

### EntityOverrideField

> **EntityOverrideField** = `"name"` \| `"active"` \| `"static"` \| `"layer"` \| `"tags"`

The entity properties an override may patch directly.

***

### EnvironmentFogMode

> **EnvironmentFogMode** = *typeof* [`FOG_MODE_NAMES`](#fog_mode_names)\[`number`\]

The union of the fog modes.

***

### ErrorCode

> **ErrorCode** = `` `IGX-${number}` ``

The shape of every ignifx diagnostic code: the literal `IGX-` followed by four digits.

#### Remarks

The template literal is the widest useful type; it accepts strings such as `"IGX-1"` that are not
real codes. [isValidErrorCode](#isvaliderrorcode) is the runtime check, `CoreErrorCode` is the narrowed
string-literal union for the codes this package owns, and extensions narrow their own the same
way.

***

### ErrorContext

> **ErrorContext** = `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>\>

The identifiers that make a failure actionable: entity and component uids, asset keys, layer
names, extension names. Values are primitives so the whole record survives being sent to a
devtools panel or a log sink without cloning engine objects.

***

### ErrorFormatMode

> **ErrorFormatMode** = `"development"` \| `"production"`

How much of an error is spelled out in `Error.message`.

#### Remarks

`"development"` writes the full sentence, the context values, and the hint. `"production"` keeps
the code and the *names* of the context keys and drops every value and the prose, so shipped
games neither leak content paths nor pay for message strings (`CONSTITUTION.md` §3.9). The
structured `code`, `context`, and `hint` properties are populated in both modes.

***

### ErrorRange

> **ErrorRange** = *typeof* [`ErrorRange`](#errorrange)\[keyof *typeof* [`ErrorRange`](#errorrange)\]

The union of the two-digit subsystem prefixes declared by `ErrorRange`.

***

### FetchLike

> **FetchLike** = *typeof* `globalThis.fetch`

The `fetch` implementation the service performs every read through
(`docs/architecture/05-assets-and-loading.md` §8). Injecting it is how headless tests supply
deterministic responses and how a Node app maps addresses onto `fs` (Phase 9).

***

### FieldKind

> **FieldKind** = *typeof* [`FieldKind`](#fieldkind)\[keyof *typeof* [`FieldKind`](#fieldkind)\]

The union of every field kind.

***

### FieldsOf

> **FieldsOf**\<`S`\> = `{ -readonly [K in keyof S]: S[K] extends FieldDefinition<infer T> ? T : never }`

The object type a schema describes: every field name mapped to its runtime value type. This is
what gives `this.speed` its `number` type inside a component declared with
`Script.define({ speed: f32(5) })`.

#### Type Parameters

##### S

`S` *extends* [`Schema`](#schema-14)

The schema to project.

#### Example

```ts
const schema = { speed: f32(5), label: str("") };
type Fields = FieldsOf<typeof schema>; // { speed: number; label: string }
```

***

### FieldSpec

> **FieldSpec** = [`NumberFieldSpec`](#numberfieldspec) \| [`BoolFieldSpec`](#boolfieldspec) \| [`StringFieldSpec`](#stringfieldspec) \| [`VectorFieldSpec`](#vectorfieldspec) \| [`ColorFieldSpec`](#colorfieldspec) \| [`EnumFieldSpec`](#enumfieldspec) \| [`EntityRefFieldSpec`](#entityreffieldspec) \| [`ComponentRefFieldSpec`](#componentreffieldspec) \| [`AssetFieldSpec`](#assetfieldspec) \| [`ArrayFieldSpec`](#arrayfieldspec) \| [`RecordFieldSpec`](#recordfieldspec) \| [`MapFieldSpec`](#mapfieldspec) \| [`OptionalFieldSpec`](#optionalfieldspec) \| [`LayerMaskFieldSpec`](#layermaskfieldspec) \| [`CurveFieldSpec`](#curvefieldspec) \| [`CustomFieldSpec`](#customfieldspec)

The discriminated union of kind-specific field data. Switching on `spec.kind` narrows to the
member that carries the extra information that kind needs — the enumeration's values, an array's
item definition, a component reference's class token — so no branch has to guess.

***

### GamepadReader

> **GamepadReader** = () => readonly ([`GamepadLike`](#gamepadlike) \| `null`)[]

How one frame's pads are read. Injecting it is what makes the mapping testable in Node.

#### Returns

readonly ([`GamepadLike`](#gamepadlike) \| `null`)[]

***

### InputActionSignal

> **InputActionSignal** = [`SignalLike`](#signallike)\<[`InputActionEvent`](#inputactionevent)\>

The read-only half of an action's signals, for public shapes that expose them.

***

### InputActionType

> **InputActionType** = `"button"` \| `"axis"` \| `"vector2"`

What an action produces (`docs/architecture/08-input.md` §2).

***

### InputErrorCode

> **InputErrorCode** = *typeof* [`InputErrorCode`](#inputerrorcode)\[keyof *typeof* [`InputErrorCode`](#inputerrorcode)\]

The union of the codes the `InputErrorCode` table declares.

***

### InputEventType

> **InputEventType** = `"keydown"` \| `"keyup"` \| `"pointerdown"` \| `"pointerup"` \| `"pointermove"` \| `"wheel"` \| `"textinput"`

The raw event kinds `app.input.events` publishes.

***

### JsonArray

> **JsonArray** = readonly [`JsonValue`](#jsonvalue)[]

A JSON array. Read-only because encoded values are snapshots: callers copy before mutating.

***

### JsonObject

> **JsonObject** = `object`

A JSON object. Keys are emitted in the canonical order defined by
`docs/architecture/06-serialization-and-scene-format.md` §1, so two saves of the same state
produce byte-identical files.

#### Index Signature

\[`key`: `string`\]: [`JsonValue`](#jsonvalue)

***

### JsonSchemaObject

> **JsonSchemaObject** = [`JsonObject`](#jsonobject)

A JSON Schema fragment. Kept as a plain JSON object because the generated document is assembled
— and validated — by the documentation harness, not by this module
(`docs/architecture/06-serialization-and-scene-format.md` §8).

***

### JsonValue

> **JsonValue** = `string` \| `number` \| `boolean` \| `null` \| [`JsonArray`](#jsonarray) \| [`JsonObject`](#jsonobject)

The JSON value model the serializer works in. Scene and prefab files are UTF-8 JSON
(`docs/architecture/06-serialization-and-scene-format.md` §1), so every encoded schema value is
one of these shapes. The type is recursive rather than `unknown` so that encoders cannot smuggle
a `Date`, a `Map`, or an `undefined` into a file (coding standards §5.2 bans `any`).

***

### LightType

> **LightType** = *typeof* [`LIGHT_TYPES`](#light_types)\[`number`\]

The union of the light kinds.

***

### LiteAnimationGroup

> **LiteAnimationGroup** = `AnimationGroup`

**`Beta`**

A Babylon Lite animation clip, re-exported under an ignifx name. `Model.animations` hands these
to `@ignifx/3d`'s animator, which owns advancement (ADR-0003).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteAssetContainer

> **LiteAssetContainer** = `AssetContainer`

The Babylon Lite asset container a `ModelAsset` holds, re-exported under an ignifx name
(`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteAudioBus

> **LiteAudioBus** = `AudioBus$1`

Babylon Lite's generic mixer bus (`index.d.ts` 910). Unstable escape hatch.

***

### LiteAudioEngine

> **LiteAudioEngine** = `AudioEngine`

Babylon Lite's audio engine (`index.d.ts` 926). Unstable escape hatch: excluded from the
stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteCamera

> **LiteCamera** = `FreeCamera`

The Babylon Lite camera an ignifx `Camera` component owns, re-exported under an ignifx name so
feature code can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4,
coding standards §4).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteEngine

> **LiteEngine** = `EngineContext`

The Babylon Lite engine handle an ignifx app owns, re-exported under an ignifx name so that
feature code can name the type without importing `@babylonjs/lite`
(`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches, and it
is excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteEnvironmentTextures

> **LiteEnvironmentTextures** = `EnvironmentTextures`

The GPU-resident image-based-lighting textures `loadEnvironment` resolves to, re-exported under an
ignifx name (`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteFont

> **LiteFont** = `Font`

The Babylon Lite font handle a `FontAsset` wraps, re-exported under an ignifx name so feature code
can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding
standards §4).

#### Remarks

Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches, and it
is excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteLight

> **LiteLight** = `DirectionalLight` \| `PointLight` \| `SpotLight` \| `HemisphericLight`

The Lite light kinds an ignifx `Light` component can own, re-exported under an ignifx name so
feature code can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4,
coding standards §4). The barrel exports it as `LiteLight`, the name `Light.lite.light` reads by.

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteMaterial

> **LiteMaterial** = `Material`

The Babylon Lite material a `MaterialAsset` owns, re-exported under an ignifx name
(`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteMesh

> **LiteMesh** = `Mesh`

The Babylon Lite mesh a `MeshAsset` template and a `MeshRenderer` clone are, re-exported under an
ignifx name so feature code can name the type without importing `@babylonjs/lite`
(`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches, and it
is excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LitePbrMaterial

> **LitePbrMaterial** = `PbrMaterialProps`

A Babylon Lite physically based material, re-exported under an ignifx name.

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteScene

> **LiteScene** = `SceneContext`

The Babylon Lite scene a world renders into (or simulates on), re-exported under an ignifx name
for the same reason as [LiteEngine](#liteengine).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteSceneNode

> **LiteSceneNode** = `SceneNode`

The Babylon Lite node an ignifx `Transform` wraps, re-exported under an ignifx name so that
feature code can name the type without importing `@babylonjs/lite`
(`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable: it is Lite's type, reachable only through documented `.lite` escape hatches, and it is
excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteShadowGenerator

> **LiteShadowGenerator** = `ShadowGenerator`

The Babylon Lite shadow generator a `Light` owns, re-exported under an ignifx name
(`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteSkeleton

> **LiteSkeleton** = `Skeleton`

**`Beta`**

A Babylon Lite skeleton, re-exported under an ignifx name. Present on a container only when
`enableBoneControl()` ran before the load (`index.d.ts` 653).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteSoundBuffer

> **LiteSoundBuffer** = `SoundBuffer`

Babylon Lite's decoded audio buffer (`index.d.ts` 11707). Unstable escape hatch.

***

### LiteSpatialTarget

> **LiteSpatialTarget** = `SpatialTarget`

Anything Lite's spatial nodes can follow: an object exposing a column-major `worldMatrix`
(`index.d.ts` 11807). A Lite `SceneNode` — which is what `Transform.lite` hands back — satisfies
it, which is how a spatial `AudioSource` follows its entity.

***

### LiteStandardMaterial

> **LiteStandardMaterial** = `StandardMaterialProps`

A Babylon Lite Babylon-Standard material, re-exported under an ignifx name.

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteStaticSound

> **LiteStaticSound** = `StaticSound`

Babylon Lite's buffer-backed sound (`index.d.ts` 12336). Unstable escape hatch.

***

### LiteStreamingSound

> **LiteStreamingSound** = `StreamingSound`

Babylon Lite's media-element-backed sound (`index.d.ts` 12499). Unstable escape hatch.

***

### LiteTexture2D

> **LiteTexture2D** = `Texture2D`

The Babylon Lite texture a `TextureAsset` wraps, re-exported under an ignifx name so feature code
can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding
standards §4).

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LogLevel

> **LogLevel** = *typeof* [`LogLevel`](#loglevel-1)\[keyof *typeof* [`LogLevel`](#loglevel-1)\]

The union of the four severities a [LogRecord](#logrecord) can carry.

***

### LogThreshold

> **LogThreshold** = [`LogLevel`](#loglevel-2) \| `"silent"`

What a [Logger](#logger) is set to. A threshold is a `LogLevel` or `"silent"`, which drops
everything; `"silent"` is never the level of a record.

***

### Mat4Elements

> **Mat4Elements** = `Float32Array` & `object`

The backing store of a [Mat4](#mat4): a `Float32Array` of exactly 16 elements, in column-major
order (`m[column * 4 + row]`). The `length: 16` refinement is what makes it a [Mat4Like](#mat4like),
and therefore what makes it accepted anywhere Babylon Lite wants a `Mat4`.

#### Type Declaration

##### length

> `readonly` **length**: `16`

***

### MaterialAlphaModeName

> **MaterialAlphaModeName** = `MaterialAlphaMode`

How a material interprets its alpha channel, in glTF's vocabulary.

***

### MaterialDefinition

> **MaterialDefinition** = [`PbrMaterialDefinition`](#pbrmaterialdefinition-3) \| [`StandardMaterialDefinition`](#standardmaterialdefinition-3)

The parsed body of a `.material.json`, discriminated by `kind`.

***

### MaterialKind

> **MaterialKind** = *typeof* [`MATERIAL_KINDS`](#material_kinds)\[`number`\]

The union of the material families.

***

### OverridePath

> **OverridePath** = \{ `entity`: `string`; `kind`: `"entity"`; \} \| \{ `entity`: `string`; `field`: [`EntityOverrideField`](#entityoverridefield); `kind`: `"entityField"`; \} \| \{ `channel`: keyof [`SceneFileTransform`](#scenefiletransform); `entity`: `string`; `kind`: `"transform"`; \} \| \{ `entity`: `string`; `kind`: `"componentList"`; \} \| \{ `component`: `string`; `entity`: `string`; `kind`: `"component"`; \} \| \{ `component`: `string`; `entity`: `string`; `kind`: `"componentField"`; \} \| \{ `component`: `string`; `entity`: `string`; `kind`: `"prop"`; `steps`: readonly `string`[]; \}

The parsed form of an instance override `path`
(`docs/architecture/06-serialization-and-scene-format.md` §2). Every path starts with the uid of
an entity **of the instanced file**, so a path survives the per-instance uid remap
(`02-scene-graph.md` §10).

The grammar, in the order the parser tries it:

```text
<uid>                                              → entity      (whole entity, "remove" only)
<uid>/name | active | static | layer | tags        → entityField
<uid>/transform/position | rotation | scale        → transform
<uid>/components                                   → componentList ("add" only)
<uid>/components/<uid>                             → component   ("remove" only)
<uid>/components/<uid>/enabled                     → componentField
<uid>/components/<uid>/props/<field>[/<key>…]      → prop
```

***

### PartialFieldsOf

> **PartialFieldsOf**\<`S`\> = `{ [K in keyof FieldsOf<S>]?: FieldsOf<S>[K] }`

The field object of a schema with every property optional, and an explicit `undefined` allowed.
`exactOptionalPropertyTypes` normally separates "absent" from "present and `undefined`"; both
mean "take the schema default" here, so both are accepted (`applyInit`, `encodeProps`).

#### Type Parameters

##### S

`S` *extends* [`Schema`](#schema-14)

The schema to project.

***

### Phase

> **Phase** = *typeof* [`Phase`](#phase-2)\[keyof *typeof* [`Phase`](#phase-2)\]

The union of the frame phases.

***

### PhaseIndex

> **PhaseIndex** = `0` \| `1` \| `2` \| `3` \| `4` \| `5`

A slot in [FrameSample.cpuMs](#cpums). The kernel's `Phase` ordinals index this array.

***

### PhysicsCallbackName

> **PhysicsCallbackName** = *typeof* [`PhysicsCallbackName`](#physicscallbackname)\[keyof *typeof* [`PhysicsCallbackName`](#physicscallbackname)\]

**`Beta`**

The union of the physics callback names.

***

### PlatformKind

> **PlatformKind** = `"browser"` \| `"node"`

Where an app is running.

#### Remarks

`"electron"` is deliberately absent until the Electron extension can detect it reliably: an
Electron renderer is a browser as far as the kernel is concerned, and guessing from the user
agent would be worse than saying `"browser"`.

***

### ProcessorKind

> **ProcessorKind** = *typeof* [`ProcessorKind`](#processorkind-1)\[keyof *typeof* [`ProcessorKind`](#processorkind-1)\]

The union of the processor names.

***

### RenderingFeature

> **RenderingFeature** = keyof [`RenderingFeatureSettings`](#renderingfeaturesettings)

A rendering feature a project or an extension asks for
(`docs/architecture/07-rendering.md` §1.1).

***

### RenderSurface

> **RenderSurface** = `HTMLCanvasElement` \| `OffscreenCanvas`

A canvas ignifx can render into: a DOM canvas on the main thread, or an `OffscreenCanvas`
transferred to a worker. Declared here so public signatures do not depend on a Babylon Lite type.

***

### Schema

> **Schema** = `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

A component's declared fields, keyed by property name and ordered by declaration. Declaration
order is the canonical key order used when writing files
(`docs/architecture/06-serialization-and-scene-format.md` §1).

***

### SchemaIssueCode

> **SchemaIssueCode** = *typeof* [`SchemaIssueCode`](#schemaissuecode-1)\[keyof *typeof* [`SchemaIssueCode`](#schemaissuecode-1)\]

The union of diagnostic codes this module reports.

***

### ScriptCallbackKind

> **ScriptCallbackKind** = *typeof* [`ScriptCallbackKind`](#scriptcallbackkind)\[keyof *typeof* [`ScriptCallbackKind`](#scriptcallbackkind)\]

The union of script callback ordinals.

***

### ScriptDefinition

> **ScriptDefinition**\<`S`\> = () => [`Script`](#abstract-script) & [`FieldsOf`](#fieldsof)\<`S`\> & `object`

The abstract base class [Script.define](#define-11) returns: a `Script` that also carries every field
the schema declares, typed.

#### Type Declaration

##### prototype

> `readonly` **prototype**: [`Script`](#abstract-script) & [`FieldsOf`](#fieldsof)\<`S`\>

The instance shape, so the class satisfies `ComponentType`.

##### schema

> `readonly` **schema**: `S`

The schema the class was defined from, carried as a value on the returned class. The other
statics ([ScriptStatics](#scriptstatics)) are deliberately *not* declared here: a subclass must be able
to write a plain `static typeId` or `static executionOrder` without the `override` keyword.

#### Type Parameters

##### S

`S` *extends* [`Schema`](#schema-14)

The schema the class was defined from.

***

### ServiceClassKey

> **ServiceClassKey**\<`T`\> = (...`args`) => `T`

A service key that is a class: the constructor itself is the token.

#### Type Parameters

##### T

`T`

The service instance type.

#### Parameters

##### args

...`never`[]

#### Returns

`T`

***

### ServiceKey

> **ServiceKey**\<`T`\> = [`ServiceClassKey`](#serviceclasskey)\<`T`\> \| [`ServiceNameKey`](#servicenamekey)\<`T`\>

The token a service is registered and looked up under
(`docs/architecture/04-extensions.md` §1). Either the service's own abstract class — the common
case, so `ctx.require(PhysicsService)` reads naturally — or a branded token from
[createServiceKey](#createservicekey) for services that have no class of their own.

#### Type Parameters

##### T

`T`

The service instance type the key stands for.

***

### SettingsInput

> **SettingsInput** = `Readonly`\<`Record`\<`string`, `unknown`\>\>

What a project hands `createApp` as its settings (`docs/architecture/04-extensions.md` §5). The
Vite plugin resolves `ignifx.config.ts` at build time and injects the same shape; tests and
Electron tooling pass it directly.

#### Remarks

Values are `unknown` because each section is owned — and validated — by the extension that
registered it. A section whose schema declares exactly one field may be written as that field's
value (`layers: ["Default", "Ground"]`), which is the form `04-extensions.md` §5 shows.

#### Example

```ts
const app = await createApp({
  headless: true,
  settings: { layers: ["Default", "Player"], time: { fixedDeltaTime: 1 / 120 } },
});
```

***

### ShadowTechniqueName

> **ShadowTechniqueName** = *typeof* `SHADOW_TECHNIQUES`\[`number`\]

The union of the shadow techniques a directional light can use.

***

### SignalHandler

> **SignalHandler**\<`T`\> = (`value`) => `void`

A listener attached to a [Signal](#signal-3).

#### Type Parameters

##### T

`T`

#### Parameters

##### value

`T`

#### Returns

`void`

***

### SimulatedValue

> **SimulatedValue** = `number` \| `boolean` \| [`Vec2Like`](#vec2like)

What a value passed to [InputService.simulate](#simulate) may be.

***

### ToneMappingCurve

> **ToneMappingCurve** = *typeof* `TONE_MAPPING_NAMES`\[`number`\]

The union of the tone-mapping curves.

## Variables

### ANY\_KEY\_CONTROL

> `const` **ANY\_KEY\_CONTROL**: `"anyKey"` = `"anyKey"`

The control that is actuated while any other key is held
(`docs/architecture/08-input.md` §3, `<Keyboard>/anyKey`).

***

### ASSET\_DIAGNOSTICS\_COUNTERS

> `const` **ASSET\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters the `assets` diagnostics group publishes, in index order.

***

### ASSET\_DIAGNOSTICS\_GROUP

> `const` **ASSET\_DIAGNOSTICS\_GROUP**: `"assets"` = `"assets"`

The diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).

***

### ASSET\_MANIFEST\_FORMAT

> `const` **ASSET\_MANIFEST\_FORMAT**: `"ignifx.manifest"` = `"ignifx.manifest"`

The manifest format discriminator, written into `assets.manifest.json`.

***

### ASSET\_MANIFEST\_VERSION

> `const` **ASSET\_MANIFEST\_VERSION**: `1` = `1`

The only manifest format version this build reads.

***

### audio

> `const` **audio**: (`options?`) => [`Extension`](#extension)

The `@ignifx/audio` extension factory.

#### Parameters

##### options?

[`AudioOptions`](#audiooptions)

Overrides for the `audio` settings section, an audio context, and the backend
factory.

#### Returns

[`Extension`](#extension)

The extension descriptor to pass to `createApp`.

#### Example

```ts
const app = await createApp({
  canvas,
  extensions: [audio({ buses: "audio/buses.audio.json", masterVolume: 0.8 })],
});
```

***

### AUDIO\_ASSET\_TYPE

> `const` **AUDIO\_ASSET\_TYPE**: `"audio"` = `"audio"`

The asset type audio clips are registered under.

***

### AUDIO\_BUSES\_ASSET\_TYPE

> `const` **AUDIO\_BUSES\_ASSET\_TYPE**: `"audiobuses"` = `"audiobuses"`

The asset type bus files are registered under.

***

### AUDIO\_BUSES\_FILE\_EXTENSION

> `const` **AUDIO\_BUSES\_FILE\_EXTENSION**: `".audio.json"` = `".audio.json"`

The address suffix that selects the bus loader.

***

### AUDIO\_BUSES\_FORMAT

> `const` **AUDIO\_BUSES\_FORMAT**: `"ignifx.audiobuses"` = `"ignifx.audiobuses"`

The `format` discriminator every bus file carries.

***

### AUDIO\_BUSES\_FORMAT\_VERSION

> `const` **AUDIO\_BUSES\_FORMAT\_VERSION**: `1` = `1`

The bus-file format version this build reads.

***

### AUDIO\_DIAGNOSTICS\_COUNTERS

> `const` **AUDIO\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters the `audio` diagnostics group publishes, in index order.

***

### AUDIO\_DIAGNOSTICS\_GROUP

> `const` **AUDIO\_DIAGNOSTICS\_GROUP**: `"audio"` = `"audio"`

The diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).

***

### AUDIO\_DISTANCE\_MODELS

> `const` **AUDIO\_DISTANCE\_MODELS**: readonly \[`"linear"`, `"inverse"`, `"exponential"`\]

How distance attenuates a spatial source, matching Web Audio's `distanceModel`
(`docs/architecture/10-audio.md` §3).

***

### AUDIO\_ERROR\_MESSAGES

> `const` **AUDIO\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### AUDIO\_FILE\_EXTENSIONS

> `const` **AUDIO\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the audio loader
(`docs/architecture/10-audio.md` §2).

***

### AUDIO\_PUMP\_ORDER

> `const` **AUDIO\_PUMP\_ORDER**: `-400` = `-400`

Where the audio pump sits inside `PreRender`.

#### Remarks

After physics interpolation (`-500`, `04-extensions.md` §1) so that a source attached to an
interpolated body is heard from its display pose, and well before the render sync (`900`,
`packages/core/src/render/render-sync-system.ts`) so that nothing audio does can disturb what is
drawn. Extensions use `[1001, 9999]` by convention for systems that must follow every core one;
audio has to interleave with core's own ordering instead, which is what the negative number says.

***

### AUDIO\_SETTINGS\_SECTION

> `const` **AUDIO\_SETTINGS\_SECTION**: `"audio"` = `"audio"`

The section name as it appears in `ignifx.config.ts`.

***

### AudioErrorCode

> `const` **AudioErrorCode**: `object`

Every diagnostic code `@ignifx/audio` can throw or log, keyed by an intention-revealing name so
call sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### audioDisposed

> `readonly` **audioDisposed**: `"IGX-1010"`

The audio service was used after the app had been disposed.

##### audioEngineUnavailable

> `readonly` **audioEngineUnavailable**: `"IGX-1007"`

The audio engine could not be created: no Web Audio in this host.

##### clipDecodeFailed

> `readonly` **clipDecodeFailed**: `"IGX-1008"`

A clip's bytes could not be decoded into playable audio.

##### duplicateBusName

> `readonly` **duplicateBusName**: `"IGX-1005"`

Two buses in one tree declared the same name.

##### invalidBusFile

> `readonly` **invalidBusFile**: `"IGX-1003"`

An `.audio.json` file is not an `ignifx.audiobuses` document.

##### invalidBusParent

> `readonly` **invalidBusParent**: `"IGX-1006"`

A bus named a parent that is not declared, or the parent chain forms a cycle.

##### noAudioListener

> `readonly` **noAudioListener**: `"IGX-1002"`

A spatial source is playing and no `AudioListener` is enabled; logged once per world.

##### streamingUnavailable

> `readonly` **streamingUnavailable**: `"IGX-1009"`

A streaming clip was played on a backend that cannot stream (headless has no media element).

##### unknownBus

> `readonly` **unknownBus**: `"IGX-1001"`

`app.audio.bus(name)`, or an `AudioSource.bus` field, named a bus the tree does not hold.

##### unsupportedBusFileVersion

> `readonly` **unsupportedBusFileVersion**: `"IGX-1004"`

An `.audio.json` file declares a format version this build cannot read.

#### Example

```ts
throw audioError(AudioErrorCode.unknownBus, "Ambience is not a registered bus.", {
  context: { bus: "Ambience" },
});
```

***

### binaryAssetLoader

> `const` **binaryAssetLoader**: [`AssetLoader`](#assetloader)\<`ArrayBuffer`\>

Raw bytes, for `.bin` and `.wasm` addresses — the path `ignifx.assets.public` binaries such as
Havok's WASM take (`docs/architecture/05-assets-and-loading.md` §7).

***

### CANVAS\_ALPHA\_MODES

> `const` **CANVAS\_ALPHA\_MODES**: readonly \[`"opaque"`, `"premultiplied"`\]

The canvas alpha modes Lite accepts, in the order the inspector lists them.

***

### CompositeKind

> `const` **CompositeKind**: `object`

The composites a binding may declare.

#### Type Declaration

##### axis1D

> `readonly` **axis1D**: `"1DAxis"`

Two buttons read as a signed `axis`: `negative`, `positive`.

##### buttonWithModifier

> `readonly` **buttonWithModifier**: `"ButtonWithModifier"`

A button that only counts while a modifier is held: `modifier`, `button`.

##### vector2D

> `readonly` **vector2D**: `"2DVector"`

Four buttons read as a `vector2`: `up`, `down`, `left`, `right`.

***

### ControlKind

> `const` **ControlKind**: `object`

What one control produces: a pressed/released button, a signed scalar, or a two-component
vector.

#### Type Declaration

##### axis

> `readonly` **axis**: `"axis"`

A signed scalar, normally in `[-1, 1]`. Triggers report `[0, 1]`.

##### button

> `readonly` **button**: `"button"`

A digital or analog button; the resting value is `0` and the actuated value is `1`.

##### vector2

> `readonly` **vector2**: `"vector2"`

A two-component vector, such as a stick or a pointer position.

***

### CORE\_ERROR\_MESSAGES

> `const` **CORE\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<[`CoreErrorCode`](#coreerrorcode-1), `string`\>\>

The one-line message template for every `CoreErrorCode`. Templates name context keys in
braces (`{entity}`); the throwing call site substitutes the values it has and puts the same
identifiers in [IgnifxError.context](#context) so production builds stay useful without the prose.

***

### CoreErrorCode

> `const` **CoreErrorCode**: `object`

Every diagnostic code `@ignifx/core` can throw, keyed by an intention-revealing name so call
sites read as prose and the compiler catches typos (coding standards §5.2 — `as const` objects in
place of enums).

#### Type Declaration

##### appDisposed

> `readonly` **appDisposed**: `"IGX-0106"`

An app was used after `app.dispose()` had run.

##### appNotReady

> `readonly` **appNotReady**: `"IGX-0107"`

A part of the app was reached before `createApp()` had finished building it.

##### appPropertyAlreadyDefined

> `readonly` **appPropertyAlreadyDefined**: `"IGX-0401"`

Two extensions defined the same app property.

##### assetAppDisposed

> `readonly` **assetAppDisposed**: `"IGX-0503"`

An asset promise outlived the app that owned it.

##### assetLoadAborted

> `readonly` **assetLoadAborted**: `"IGX-0502"`

An asset load was aborted through its `AbortSignal`.

##### assetLoadFailed

> `readonly` **assetLoadFailed**: `"IGX-0505"`

An asset load failed after its last retry.

##### assetNoLoader

> `readonly` **assetNoLoader**: `"IGX-0504"`

No registered loader claims the address's type or extension.

##### assetNotLoaded

> `readonly` **assetNotLoaded**: `"IGX-0501"`

An asset's value was read before the asset finished loading.

##### componentNotAttached

> `readonly` **componentNotAttached**: `"IGX-0206"`

A component's engine-assigned state was read before the engine attached it to an entity.

##### componentTypeIdMissing

> `readonly` **componentTypeIdMissing**: `"IGX-0204"`

A component without a `typeId` was serialized.

##### cryptoUnavailable

> `readonly` **cryptoUnavailable**: `"IGX-1420"`

The host exposes no Web Crypto implementation.

##### deferredSignalWithoutScheduler

> `readonly` **deferredSignalWithoutScheduler**: `"IGX-0103"`

A signal handler asked for deferred delivery on a signal that has no scheduler.

##### destroyImmediateInCallback

> `readonly` **destroyImmediateInCallback**: `"IGX-0102"`

`destroyImmediate()` was called from inside a lifecycle callback.

##### duplicateAssetLoader

> `readonly` **duplicateAssetLoader**: `"IGX-0506"`

Two loaders were registered for the same asset type.

##### duplicateComponentTypeId

> `readonly` **duplicateComponentTypeId**: `"IGX-0203"`

Two component types were registered under the same `typeId`.

##### duplicateDiagnosticsGroup

> `readonly` **duplicateDiagnosticsGroup**: `"IGX-1503"`

A diagnostics counter group was registered twice.

##### duplicateErrorCode

> `readonly` **duplicateErrorCode**: `"IGX-1501"`

An error code was registered twice.

##### duplicateExtensionName

> `readonly` **duplicateExtensionName**: `"IGX-0406"`

Two extensions were registered under the same name.

##### duplicateLayerName

> `readonly` **duplicateLayerName**: `"IGX-0304"`

Two layer slots were given the same name.

##### entityIsNotSceneRoot

> `readonly` **entityIsNotSceneRoot**: `"IGX-0309"`

An operation that only accepts a scene root was given an entity that has a parent.

##### extensionEngineMismatch

> `readonly` **extensionEngineMismatch**: `"IGX-0404"`

An extension's `engine` range does not match the running core version.

##### extensionMissing

> `readonly` **extensionMissing**: `"IGX-0403"`

An extension declares a `requires` entry that was never registered.

##### extensionRequiresCycle

> `readonly` **extensionRequiresCycle**: `"IGX-0402"`

The `requires` graph of the registered extensions contains a cycle.

##### instanceHashMismatch

> `readonly` **instanceHashMismatch**: `"IGX-0604"`

A scene instance's override hash does not match the scene file it was recorded against.

##### invalidAssetFile

> `readonly` **invalidAssetFile**: `"IGX-0709"`

An asset file does not carry the format header its loader requires.

##### invalidOverridePath

> `readonly` **invalidOverridePath**: `"IGX-0609"`

An instance override declares a `path` the override grammar does not accept.

##### invalidRuntime

> `readonly` **invalidRuntime**: `"IGX-0702"`

A runtime handle was used after disposal, or was not created by ignifx.

##### invalidSettings

> `readonly` **invalidSettings**: `"IGX-0408"`

A project settings section did not validate against the schema its extension registered.

##### invalidTimeValue

> `readonly` **invalidTimeValue**: `"IGX-0108"`

A `Time` property was set to a value outside its documented domain.

##### malformedErrorCode

> `readonly` **malformedErrorCode**: `"IGX-1502"`

An error code does not match `IGX-####` in a known range.

##### multipleComponentsNotAllowed

> `readonly` **multipleComponentsNotAllowed**: `"IGX-0202"`

A second instance of a component type that does not allow multiples was added.

##### multipleEnvironments

> `readonly` **multipleEnvironments**: `"IGX-0705"`

A second `Environment` was enabled in one world; the most recent one wins.

##### mutationAfterDestroy

> `readonly` **mutationAfterDestroy**: `"IGX-0101"`

An entity, component, or app was used after it had been destroyed or disposed.

##### noEnabledCamera

> `readonly` **noEnabledCamera**: `"IGX-0706"`

A world rendered with no enabled camera, so nothing was drawn.

##### nonFiniteNumber

> `readonly` **nonFiniteNumber**: `"IGX-0601"`

A serialized number was `NaN` or infinite.

##### notASceneFile

> `readonly` **notASceneFile**: `"IGX-0308"`

A file handed to the scene loader does not carry the `ignifx.scene` format header.

##### parentingCycle

> `readonly` **parentingCycle**: `"IGX-0306"`

Reparenting an entity under its own descendant would make the scene tree cyclic.

##### physicsCallbackOutsideFixedStep

> `readonly` **physicsCallbackOutsideFixedStep**: `"IGX-0409"`

An extension dispatched a physics callback from outside the fixed loop.

##### postProcessingFeatureOff

> `readonly` **postProcessingFeatureOff**: `"IGX-0710"`

A `PostProcessStack` was attached without the `postProcessing` rendering feature.

##### renderingFeatureTooLate

> `readonly` **renderingFeatureTooLate**: `"IGX-0704"`

A rendering feature opt-in was requested after the render scene had been registered.

##### requiredComponentMissing

> `readonly` **requiredComponentMissing**: `"IGX-0201"`

A component declared through `requires` is missing from the entity.

##### sceneFileInvalid

> `readonly` **sceneFileInvalid**: `"IGX-0608"`

A scene file failed structural validation against the generated scene-file JSON Schema.

##### sceneInstanceCycle

> `readonly` **sceneInstanceCycle**: `"IGX-0302"`

Instantiating a scene would place an instance inside itself.

##### sceneNotLoaded

> `readonly` **sceneNotLoaded**: `"IGX-0301"`

A scene was instantiated before it had finished loading.

##### schemaOutOfRange

> `readonly` **schemaOutOfRange**: `"IGX-0606"`

A value had the right type but fell outside its schema field's declared value domain.

##### schemaTypeMismatch

> `readonly` **schemaTypeMismatch**: `"IGX-0605"`

A value had the wrong JavaScript or JSON type for its schema field kind.

##### schemaUnknownField

> `readonly` **schemaUnknownField**: `"IGX-0607"`

A schema declaration or a property bag named a field the schema does not declare.

##### screenshotNeedsRenderLoop

> `readonly` **screenshotNeedsRenderLoop**: `"IGX-0707"`

A screenshot was requested with no render loop running, so no frame will ever be presented.

##### serviceNotRegistered

> `readonly` **serviceNotRegistered**: `"IGX-0405"`

`ctx.require()` asked for a service that no earlier extension registered.

##### shadowsUnsupportedForLight

> `readonly` **shadowsUnsupportedForLight**: `"IGX-0703"`

Shadows were requested from a light kind Babylon Lite cannot shadow.

##### signalHandlerThrew

> `readonly` **signalHandlerThrew**: `"IGX-0104"`

A signal handler threw and no handler-error reporter was installed.

##### simulationSceneAlreadySet

> `readonly` **simulationSceneAlreadySet**: `"IGX-0410"`

A second, different simulation scene was handed to a world that already has one.

##### stepOutsideHeadless

> `readonly` **stepOutsideHeadless**: `"IGX-0105"`

`app.step()` was called while Babylon Lite's render loop was driving the frames.

##### tooManyLayers

> `readonly` **tooManyLayers**: `"IGX-0305"`

The project settings declare more layer names than the 32 available slots.

##### transformIsNotRemovable

> `readonly` **transformIsNotRemovable**: `"IGX-0205"`

`Transform` was removed or disabled; every entity must keep exactly one enabled transform.

##### unknownComponentTypeId

> `readonly` **unknownComponentTypeId**: `"IGX-0307"`

A scene file names a component `typeId` that no extension has registered.

##### unknownDiagnosticsCounter

> `readonly` **unknownDiagnosticsCounter**: `"IGX-1504"`

A diagnostics counter name was not declared when its group was registered.

##### unknownLayer

> `readonly` **unknownLayer**: `"IGX-0303"`

A layer name that the project settings do not declare was used.

##### unknownSettingsSection

> `readonly` **unknownSettingsSection**: `"IGX-0407"`

`ctx.settings()` asked for a settings section that was never registered.

##### unreachableCase

> `readonly` **unreachableCase**: `"IGX-1505"`

A `switch` over a union reached a case the type system said was impossible.

##### unresolvedReference

> `readonly` **unresolvedReference**: `"IGX-0602"`

A serialized `$entity`/`$component` reference could not be resolved.

##### unsupportedFormatVersion

> `readonly` **unsupportedFormatVersion**: `"IGX-0603"`

A scene, prefab, or manifest declares a format version this build cannot read.

##### unsupportedMaterialKind

> `readonly` **unsupportedMaterialKind**: `"IGX-0708"`

A material file declares a family this build cannot construct.

##### webGpuUnavailable

> `readonly` **webGpuUnavailable**: `"IGX-0701"`

WebGPU is not available in the current environment.

#### Example

```ts
throw new IgnifxError(CoreErrorCode.mutationAfterDestroy, "The entity has been destroyed.", {
  context: { entity: entity.uid },
});
```

#### Remarks

Code blocks reserved for other first-party packages, which cannot import this table
(`docs/architecture/00-overview.md` §2): `@ignifx/cli` owns `IGX-1401`–`IGX-1419`;
`@ignifx/vite-plugin` owns `IGX-0550`–`IGX-0599` and `IGX-0650`–`IGX-0699`. Core allocates its
own codes from the bottom of each range and, in the platform range, from `IGX-1420` upward.

***

### coreExtension

> `const` **coreExtension**: (`options?`) => [`Extension`](#extension)

Builds the extension `createApp` always puts first (`docs/architecture/04-extensions.md` §2
rule 1).

#### Parameters

##### options?

`void`

#### Returns

[`Extension`](#extension)

The core extension descriptor.

#### Example

```ts
// createApp does this for you; the list is only ever built by the kernel.
const extensions = [coreExtension(), physics(), input()];
```

***

### DEFAULT\_ASSET\_CONCURRENCY

> `const` **DEFAULT\_ASSET\_CONCURRENCY**: `6` = `6`

The concurrency limit an unconfigured queue uses (§4).

***

### DEFAULT\_ASSET\_ROOT

> `const` **DEFAULT\_ASSET\_ROOT**: `"assets"` = `"assets"`

The asset root a project gets when it configures none (§2).

***

### DEFAULT\_AUDIO\_BUSES

> `const` **DEFAULT\_AUDIO\_BUSES**: readonly `string`[]

The bus tree built when a project declares no `.audio.json`
(`docs/architecture/10-audio.md` §1). Every bus after the first routes into `"Master"`.

***

### DEFAULT\_BRDF\_LUT\_ADDRESS

> `const` **DEFAULT\_BRDF\_LUT\_ADDRESS**: `"environments/brdf-lut.png"` = `"environments/brdf-lut.png"`

The BRDF lookup table address an `Environment` uses when neither it nor the project names one.

***

### DEFAULT\_LAYER

> `const` **DEFAULT\_LAYER**: `0` = `0`

The slot every entity starts on, and the fallback for an unknown name in a file.

***

### DEFAULT\_MEMORY\_SINK\_LIMIT

> `const` **DEFAULT\_MEMORY\_SINK\_LIMIT**: `200` = `200`

How many records [createMemorySink](#creatememorysink) keeps when no limit is given.

***

### DEFAULT\_PAUSABLE\_BUSES

> `const` **DEFAULT\_PAUSABLE\_BUSES**: readonly `string`[]

The buses `app.pause()` pauses by default: all of them except `"UI"`, so a pause menu can still
click (`docs/architecture/10-audio.md` §6).

***

### DEFAULT\_SOUND\_BUS

> `const` **DEFAULT\_SOUND\_BUS**: `"SFX"` = `"SFX"`

The bus `app.audio.playOneShot` and a fresh `AudioSource` route into.

***

### DEG\_TO\_RAD

> `const` **DEG\_TO\_RAD**: `number`

Multiplier that converts degrees to radians.

***

### DEVICE\_KINDS

> `const` **DEVICE\_KINDS**: readonly [`DeviceKind`](#devicekind-1)[]

Every device family, in the order `app.input.devices.all` reports them.

***

### DeviceKind

> `const` **DeviceKind**: `object`

The device families a binding path can name.

#### Type Declaration

##### gamepad

> `readonly` **gamepad**: `"Gamepad"`

A game controller in the W3C standard mapping.

##### keyboard

> `readonly` **keyboard**: `"Keyboard"`

Physical keys, addressed by `KeyboardEvent.code`.

##### mouse

> `readonly` **mouse**: `"Mouse"`

The mouse: three buttons, position, delta, and the wheel.

##### pointer

> `readonly` **pointer**: `"Pointer"`

The unified primary pointer: mouse, pen, or the first touch.

##### touch

> `readonly` **touch**: `"Touch"`

Up to ten simultaneous touches.

##### virtual

> `readonly` **virtual**: `"Virtual"`

A synthetic device fed by on-screen controls.

***

### EMPTY\_ASSET\_MANIFEST

> `const` **EMPTY\_ASSET\_MANIFEST**: [`AssetManifest`](#assetmanifest)

The manifest an app uses until a build supplies one.

***

### ENVIRONMENT\_ASSET\_TYPE

> `const` **ENVIRONMENT\_ASSET\_TYPE**: `"environment"` = `"environment"`

The asset type environments are registered under.

***

### ENVIRONMENT\_FILE\_EXTENSION

> `const` **ENVIRONMENT\_FILE\_EXTENSION**: `".environment.json"` = `".environment.json"`

The address suffix that selects the environment *description* file.

***

### ENVIRONMENT\_FILE\_EXTENSIONS

> `const` **ENVIRONMENT\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the environment loader.

***

### ENVIRONMENT\_FILE\_FORMAT

> `const` **ENVIRONMENT\_FILE\_FORMAT**: `"ignifx.environment"` = `"ignifx.environment"`

The `format` header an `.environment.json` carries
(`docs/architecture/06-serialization-and-scene-format.md` §6).

***

### ENVIRONMENT\_FORMAT\_VERSION

> `const` **ENVIRONMENT\_FORMAT\_VERSION**: `1` = `1`

The only `.environment.json` `formatVersion` this build reads.

***

### EPSILON

> `const` **EPSILON**: `number`

The default tolerance for approximate float comparisons. Chosen for single-precision positions in
metres: `Float32Array` round-tripping loses roughly 1e-7 of relative precision, so 1e-6 is the
smallest value that does not report false differences on data that has been through the GPU.

***

### ErrorRange

> `const` **ErrorRange**: `object`

The two-digit prefix each subsystem owns inside the `IGX-####` space
(`docs/architecture/15-devtools-and-diagnostics.md` §1). A code is the prefix followed by a
two-digit ordinal, so `rendering` owns `IGX-0700` through `IGX-0799`.

#### Type Declaration

##### assets

> `readonly` **assets**: `"05"`

Asset handles, loaders, and caching.

##### audio

> `readonly` **audio**: `"10"`

Audio buses, sources, and clips.

##### components

> `readonly` **components**: `"02"`

Components, scripts, and their registration.

##### devtools

> `readonly` **devtools**: `"15"`

Devtools, logging, and diagnostics.

##### extensions

> `readonly` **extensions**: `"04"`

The extension host and its contract.

##### input

> `readonly` **input**: `"08"`

Input devices, actions, and bindings.

##### lifecycle

> `readonly` **lifecycle**: `"01"`

App lifecycle, phases, time, coroutines, destruction.

##### physics

> `readonly` **physics**: `"09"`

3D physics.

##### platform

> `readonly` **platform**: `"14"`

Platform integration (browser, Electron).

##### rendering

> `readonly` **rendering**: `"07"`

The renderer and the Babylon Lite adapter.

##### scenes

> `readonly` **scenes**: `"03"`

Scenes, scene instances, layers.

##### serialization

> `readonly` **serialization**: `"06"`

Schemas, scene/prefab JSON, references.

##### threeD

> `readonly` **threeD**: `"12"`

The 3D toolkit.

##### twoD

> `readonly` **twoD**: `"11"`

The 2D toolkit.

##### ui

> `readonly` **ui**: `"13"`

The UI overlay.

#### Example

```ts
const code = `IGX-${ErrorRange.rendering}01` satisfies ErrorCode; // "IGX-0701"
```

***

### FieldKind

> `const` **FieldKind**: `object`

Every field kind a component schema can declare
(`docs/architecture/03-scripting-and-components.md` §3). Declared as an `as const` table with a
derived union rather than an `enum`, which `erasableSyntaxOnly` bans (coding standards §5.2).

#### Type Declaration

##### array

> `readonly` **array**: `"array"`

A list of values of one kind.

##### asset

> `readonly` **asset**: `"asset"`

A reference to an addressable asset.

##### bool

> `readonly` **bool**: `"bool"`

A boolean toggle.

##### color

> `readonly` **color**: `"color"`

An RGBA color.

##### componentRef

> `readonly` **componentRef**: `"componentRef"`

A reference to a component on an entity in the same scene file.

##### curve

> `readonly` **curve**: `"curve"`

An animation curve.

##### custom

> `readonly` **custom**: `"custom"`

A value with a hand-written encoder and decoder.

##### entityRef

> `readonly` **entityRef**: `"entityRef"`

A reference to another entity in the same scene file.

##### enum

> `readonly` **enum**: `"enum"`

One of a fixed set of string values.

##### f32

> `readonly` **f32**: `"f32"`

A 32-bit-ranged floating point number.

##### f64

> `readonly` **f64**: `"f64"`

A double-precision floating point number.

##### i32

> `readonly` **i32**: `"i32"`

A signed 32-bit integer.

##### layerMask

> `readonly` **layerMask**: `"layerMask"`

A set of layer names.

##### map

> `readonly` **map**: `"map"`

A string-keyed dictionary of values of one kind.

##### optional

> `readonly` **optional**: `"optional"`

A value that may also be `null`.

##### quat

> `readonly` **quat**: `"quat"`

A rotation quaternion.

##### record

> `readonly` **record**: `"record"`

A fixed group of named sub-fields.

##### str

> `readonly` **str**: `"str"`

A UTF-8 string.

##### u32

> `readonly` **u32**: `"u32"`

An unsigned 32-bit integer.

##### vec2

> `readonly` **vec2**: `"vec2"`

A 2D vector.

##### vec3

> `readonly` **vec3**: `"vec3"`

A 3D vector.

##### vec4

> `readonly` **vec4**: `"vec4"`

A 4D vector.

***

### FOG\_MODE\_NAMES

> `const` **FOG\_MODE\_NAMES**: readonly \[`"none"`, `"linear"`, `"exp"`, `"exp2"`\]

The `as const` name table behind the public union of the same name.

***

### FONT\_ASSET\_TYPE

> `const` **FONT\_ASSET\_TYPE**: `"font"` = `"font"`

The asset type fonts are registered under.

***

### FONT\_FILE\_EXTENSIONS

> `const` **FONT\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the font loader.

***

### FRAME\_HISTORY\_LENGTH

> `const` **FRAME\_HISTORY\_LENGTH**: `300` = `300`

How many frames of history [Diagnostics](#diagnostics-1) keeps by default — five seconds at 60 fps, which is
what the devtools graphs plot (`docs/architecture/15-devtools-and-diagnostics.md` §3).

***

### GAMEPAD\_REMAPS

> `const` **GAMEPAD\_REMAPS**: readonly [`GamepadRemap`](#gamepadremap)[]

The remaps this build ships. Both entries are pads that report an empty `mapping` string in at
least one browser and lay their buttons out differently from the standard order.

***

### GAMEPAD\_SLOTS

> `const` **GAMEPAD\_SLOTS**: `4` = `4`

How many gamepad slots the service tracks (`docs/architecture/08-input.md` §1).

***

### input

> `const` **input**: (`options?`) => [`Extension`](#extension)

The `@ignifx/input` extension factory.

#### Parameters

##### options?

[`InputOptions`](#inputoptions)

Overrides for the `input` settings section, and the gamepad reader.

#### Returns

[`Extension`](#extension)

The extension descriptor to pass to `createApp`.

#### Example

```ts
const app = await createApp({
  canvas,
  extensions: [input({ actions: "input/default.input.json" })],
});
```

***

### INPUT\_ACTIONS\_ASSET\_TYPE

> `const` **INPUT\_ACTIONS\_ASSET\_TYPE**: `"inputactions"` = `"inputactions"`

The asset type name input action documents are registered under.

***

### INPUT\_ACTIONS\_FILE\_EXTENSIONS

> `const` **INPUT\_ACTIONS\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the `inputactions` loader.

***

### INPUT\_ACTIONS\_FORMAT

> `const` **INPUT\_ACTIONS\_FORMAT**: `"ignifx.inputactions"` = `"ignifx.inputactions"`

The `format` discriminator of an input actions document.

***

### INPUT\_ACTIONS\_FORMAT\_VERSION

> `const` **INPUT\_ACTIONS\_FORMAT\_VERSION**: `1` = `1`

The format version this build reads and writes.

***

### INPUT\_DIAGNOSTICS\_COUNTERS

> `const` **INPUT\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters the `input` diagnostics group publishes, in index order.

***

### INPUT\_DIAGNOSTICS\_GROUP

> `const` **INPUT\_DIAGNOSTICS\_GROUP**: `"input"` = `"input"`

The diagnostics group name (`docs/architecture/08-input.md` §9).

***

### INPUT\_ERROR\_MESSAGES

> `const` **INPUT\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### INPUT\_OVERRIDES\_FORMAT

> `const` **INPUT\_OVERRIDES\_FORMAT**: `"ignifx.inputoverrides"` = `"ignifx.inputoverrides"`

The `format` discriminator of an override document.

***

### INPUT\_OVERRIDES\_FORMAT\_VERSION

> `const` **INPUT\_OVERRIDES\_FORMAT\_VERSION**: `1` = `1`

The override format version this build reads and writes.

***

### INPUT\_RESOLVE\_ORDER

> `const` **INPUT\_RESOLVE\_ORDER**: `-950` = `-950`

Where the input system sits in `PreUpdate`. Core delivers assets at `-900`, so `-950` puts input
first: a script woken by an asset delivered this frame already sees this frame's input.

***

### INPUT\_SETTINGS\_SECTION

> `const` **INPUT\_SETTINGS\_SECTION**: `"input"` = `"input"`

The section name as it appears in `ignifx.config.ts`.

***

### InputErrorCode

> `const` **InputErrorCode**: `object`

Every diagnostic code `@ignifx/input` can throw, keyed by an intention-revealing name so call
sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### duplicateName

> `readonly` **duplicateName**: `"IGX-0810"`

Two actions in one map, or two maps in one asset, declared the same name.

##### invalidActionsFile

> `readonly` **invalidActionsFile**: `"IGX-0805"`

An `.input.json` file is not an `ignifx.inputactions` document this build can read.

##### invalidBindingPath

> `readonly` **invalidBindingPath**: `"IGX-0803"`

A binding path is malformed, or names a device or control that does not exist.

##### invalidOverrides

> `readonly` **invalidOverrides**: `"IGX-0808"`

A saved override document is not an `ignifx.inputoverrides` document this build can read.

##### pointerLockUnavailable

> `readonly` **pointerLockUnavailable**: `"IGX-0809"`

Pointer lock was requested on an app that has no DOM canvas to lock.

##### rebindInProgress

> `readonly` **rebindInProgress**: `"IGX-0807"`

A second interactive rebind was started while one was still listening.

##### unknownAction

> `readonly` **unknownAction**: `"IGX-0801"`

`app.input.actions.get(name)` found no such action in any enabled map.

##### unknownActionMap

> `readonly` **unknownActionMap**: `"IGX-0804"`

`app.input.actions.map(name)` found no such action map.

##### unknownComposite

> `readonly` **unknownComposite**: `"IGX-0806"`

A binding declared a composite that is not `2DVector`, `1DAxis`, or `ButtonWithModifier`.

##### unknownProcessor

> `readonly` **unknownProcessor**: `"IGX-0802"`

A binding named a processor that is not one of the five built-in ones.

#### Example

```ts
throw inputError(InputErrorCode.unknownAction, "No enabled action map declares jump.", {
  context: { action: "jump" },
});
```

***

### INVALID\_HANDLE

> `const` **INVALID\_HANDLE**: `0` = `0`

The handle value that never resolves. Allocated handles always carry a generation of at least
one, so zero is unreachable and doubles as "no handle".

***

### jsonAssetLoader

> `const` **jsonAssetLoader**: [`AssetLoader`](#assetloader)

Parsed JSON, for `.json` addresses.

#### Remarks

The value is whatever the file contained; a loader that needs certainty about its shape validates
it with a schema (`docs/architecture/06-serialization-and-scene-format.md` §8). Longer suffixes
win the extension match, so registering a `.scene.json` loader takes those addresses away from
this one without any ordering rule.

#### Example

```ts
const config = app.assets.load<{ readonly hp: number }>("data/player.json");
```

***

### LIGHT\_TYPES

> `const` **LIGHT\_TYPES**: readonly \[`"directional"`, `"point"`, `"spot"`, `"hemispheric"`\]

The `as const` name table behind the public union of the same name.

***

### LOG\_LEVEL\_SEVERITY

> `const` **LOG\_LEVEL\_SEVERITY**: `Readonly`\<`Record`\<[`LogThreshold`](#logthreshold), `number`\>\>

The numeric severity of each threshold. A record is written when its level's severity is greater
than or equal to the logger's threshold severity, which is why `"silent"` sits above `"error"`.

***

### LogLevel

> `const` **LogLevel**: `object`

The severity of a log record.

#### Type Declaration

##### debug

> `readonly` **debug**: `"debug"`

Verbose engine tracing; off by default.

##### error

> `readonly` **error**: `"error"`

Something failed; usually paired with an `app.onError` report.

##### info

> `readonly` **info**: `"info"`

Lifecycle milestones a developer wants to see once.

##### warn

> `readonly` **warn**: `"warn"`

Something is wrong but the frame continues.

#### Remarks

`as const` object plus derived union rather than an `enum` (coding standards §5.2, §5.3).

***

### MAT4\_IDENTITY

> `const` **MAT4\_IDENTITY**: [`Mat4Like`](#mat4like)

A frozen identity matrix, for the common case of "no transform". It is a plain [Mat4Like](#mat4like)
rather than a [Mat4](#mat4) because a `Float32Array` cannot be frozen — pass it to anything that
reads a matrix, and use `new Mat4()` when you need one you can write to.

#### Example

```ts
Mat4.transformPointToRef(MAT4_IDENTITY, point, out); // copies the point
```

***

### MATERIAL\_ALPHA\_MODE\_NAMES

> `const` **MATERIAL\_ALPHA\_MODE\_NAMES**: readonly [`MaterialAlphaModeName`](#materialalphamodename)[]

The alpha modes a material may declare, in the order the inspector lists them.

***

### MATERIAL\_ASSET\_TYPE

> `const` **MATERIAL\_ASSET\_TYPE**: `"material"` = `"material"`

The asset type materials are registered under.

***

### MATERIAL\_FILE\_EXTENSION

> `const` **MATERIAL\_FILE\_EXTENSION**: `".material.json"` = `".material.json"`

The address suffix that selects the material loader.

***

### MATERIAL\_FILE\_FORMAT

> `const` **MATERIAL\_FILE\_FORMAT**: `"ignifx.material"` = `"ignifx.material"`

The `format` header every `.material.json` carries.

***

### MATERIAL\_FORMAT\_VERSION

> `const` **MATERIAL\_FORMAT\_VERSION**: `1` = `1`

The only `.material.json` `formatVersion` this build reads.

***

### MATERIAL\_KINDS

> `const` **MATERIAL\_KINDS**: readonly \[`"pbr"`, `"standard"`, `"shader"`\]

The material families `.material.json` can declare
(`docs/architecture/07-rendering.md` §2.6).

***

### MAX\_LAYERS

> `const` **MAX\_LAYERS**: `32` = `32`

How many layer slots exist. One bit each, in a 32-bit mask.

***

### MAX\_ULID\_TIME\_MS

> `const` **MAX\_ULID\_TIME\_MS**: `number`

The largest timestamp a ULID can encode, in milliseconds since the Unix epoch. Readings beyond it
are clamped rather than producing a malformed identifier.

***

### MESH\_ASSET\_TYPE

> `const` **MESH\_ASSET\_TYPE**: `"mesh"` = `"mesh"`

The asset type primitives are registered under.

***

### MODEL\_ASSET\_TYPE

> `const` **MODEL\_ASSET\_TYPE**: `"model"` = `"model"`

The asset type models are registered under.

***

### MODEL\_FILE\_EXTENSIONS

> `const` **MODEL\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the model loader.

***

### PBR\_TEXTURE\_SLOTS

> `const` **PBR\_TEXTURE\_SLOTS**: readonly `string`[]

The texture slots a `"pbr"` material may name, in the order the loader resolves them.

***

### Phase

> `const` **Phase**: `object`

The ordered frame phases (`docs/architecture/01-lifecycle-and-time.md` §3). The ordinals are the
order the frame function walks them in, and they index the per-phase CPU timings in
`FrameSample.cpuMs`.

#### Type Declaration

##### EndOfFrame

> `readonly` **EndOfFrame**: `0`

Deferred signal deliveries and end-of-frame systems, drained at the start of the next frame.

##### FixedUpdate

> `readonly` **FixedUpdate**: `2`

The fixed-timestep simulation loop: `fixedUpdate`, physics, collision dispatch.

##### PostUpdate

> `readonly` **PostUpdate**: `4`

Animation, state machines, and tweens, between `update` and `lateUpdate`.

##### PreRender

> `readonly` **PreRender**: `5`

Render synchronisation: interpolation, sprite and camera sync, audio, diagnostics.

##### PreUpdate

> `readonly` **PreUpdate**: `1`

Input polling and asset delivery, before any script callback.

##### Update

> `readonly` **Update**: `3`

`update` on every enabled script, then coroutine resumption.

#### Remarks

`EndOfFrame` is ordinal `0` because the work it carries is drained at the *top* of the next
frame, before the clock advances; the name describes when the work was queued, the ordinal
describes when it runs.

#### Example

```ts
ctx.registerSystem(new SpriteSyncSystem(), { phase: Phase.PreRender, order: 100 });
```

***

### PHASE\_COUNT

> `const` **PHASE\_COUNT**: `6` = `6`

How many update phases the frame loop times. The kernel owns the `Phase` names and their ordinals;
diagnostics only needs to know how many slots to preallocate, which keeps the two modules
independent.

***

### PHASE\_NAMES

> `const` **PHASE\_NAMES**: readonly `string`[]

The display name of each phase, indexed by its ordinal. Used by diagnostics and error messages.

***

### PHASES

> `const` **PHASES**: readonly [`Phase`](#phase-3)[]

Every phase in frame order, for loops that walk them all.

***

### PhysicsCallbackName

> `const` **PhysicsCallbackName**: `object`

**`Beta`**

The physics callbacks an extension may deliver through `ExtensionContext.dispatchScriptCallback`,
named rather than numbered (`docs/architecture/09-physics.md` §4). The ordinals in
`ScriptCallbackKind` are engine plumbing and may be renumbered; these five names are the
contract `@ignifx/physics` is written against.

#### Type Declaration

##### onCollisionEnter

> `readonly` **onCollisionEnter**: `"onCollisionEnter"`

`onCollisionEnter(collision)`.

##### onCollisionExit

> `readonly` **onCollisionExit**: `"onCollisionExit"`

`onCollisionExit(collision)`.

##### onCollisionStay

> `readonly` **onCollisionStay**: `"onCollisionStay"`

`onCollisionStay(collision)`.

##### onTriggerEnter

> `readonly` **onTriggerEnter**: `"onTriggerEnter"`

`onTriggerEnter(trigger)`.

##### onTriggerExit

> `readonly` **onTriggerExit**: `"onTriggerExit"`

`onTriggerExit(trigger)`.

#### Example

```ts
ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onTriggerEnter, event);
```

***

### ProcessorKind

> `const` **ProcessorKind**: `object`

The processors a binding may declare.

#### Type Declaration

##### clamp

> `readonly` **clamp**: `"clamp"`

Clamps every component into a range.

##### deadzone

> `readonly` **deadzone**: `"deadzone"`

Drops actuation below `min` and rescales `[min, max]` onto `[0, 1]`. Radial for vectors.

##### invert

> `readonly` **invert**: `"invert"`

Negates every component.

##### normalize

> `readonly` **normalize**: `"normalize"`

Scales a vector to unit length; clamps a scalar into `[-1, 1]`.

##### scale

> `readonly` **scale**: `"scale"`

Multiplies the components by a per-axis factor.

***

### PROJECTIONS

> `const` **PROJECTIONS**: readonly \[`"perspective"`, `"orthographic"`\]

The `as const` name table behind the public union of the same name.

***

### QUAT\_IDENTITY

> `const` **QUAT\_IDENTITY**: [`QuatLike`](#quatlike)

The frozen identity rotation, `(0, 0, 0, 1)`. Read-only: pass it anywhere a [QuatLike](#quatlike) is
wanted, and call `Quat.identity()` when you need one you can write to.

***

### RAD\_TO\_DEG

> `const` **RAD\_TO\_DEG**: `number`

Multiplier that converts radians to degrees.

***

### RENDER\_DIAGNOSTICS\_COUNTERS

> `const` **RENDER\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters the `render` diagnostics group publishes, in index order.

***

### RENDER\_DIAGNOSTICS\_GROUP

> `const` **RENDER\_DIAGNOSTICS\_GROUP**: `"render"` = `"render"`

The render diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).

***

### RENDERING\_SETTINGS\_SECTION

> `const` **RENDERING\_SETTINGS\_SECTION**: `"rendering"` = `"rendering"`

The name the `rendering` project settings section is registered under.

***

### RESERVED\_LAYER\_NAMES

> `const` **RESERVED\_LAYER\_NAMES**: readonly `string`[]

The names of the eight engine-reserved slots, in slot order. They always occupy slots 0–7,
whether or not the project lists them (`docs/architecture/02-scene-graph.md` §7).

***

### SCENE\_ASSET\_TYPE

> `const` **SCENE\_ASSET\_TYPE**: `"scene"` = `"scene"`

The asset type name the scene loader registers under.

***

### SCENE\_FILE\_EXTENSIONS

> `const` **SCENE\_FILE\_EXTENSIONS**: readonly `string`[]

The file extensions the scene loader claims.

***

### SCENE\_FILE\_FORMAT

> `const` **SCENE\_FILE\_FORMAT**: `"ignifx.scene"` = `"ignifx.scene"`

The `format` discriminator every scene and prefab file carries
(`docs/architecture/06-serialization-and-scene-format.md` §2). Levels (`*.scene.json`) and
prefabs (`*.prefab.json`) share it: a prefab is a scene instanced inside another scene
(ADR-0005), not a second file type.

***

### SCENE\_FORMAT\_VERSION

> `const` **SCENE\_FORMAT\_VERSION**: `1` = `1`

The `formatVersion` this build writes and is the only one it can read. Before 1.0 the number
stays `1` and an incompatible change invalidates files rather than migrating them
(`CONSTITUTION.md` §4.2); a file declaring anything else is rejected with `IGX-0603`.

***

### SchemaIssueCode

> `const` **SchemaIssueCode**: `object`

Diagnostic codes this module reports. They live in the `06xx` serialization range registered in
`docs/architecture/15-devtools-and-diagnostics.md` §1. Codes `IGX-0601` to `IGX-0604` are already
spoken for by the scene loader (`docs/architecture/06-serialization-and-scene-format.md`), so the
schema-level checks continue from `IGX-0605`.

#### Type Declaration

##### nonFiniteNumber

> `readonly` **nonFiniteNumber**: `"IGX-0601"`

A number was `NaN`, `Infinity`, or `-Infinity` and therefore cannot be written to JSON.

##### outOfRange

> `readonly` **outOfRange**: `"IGX-0606"`

A value had the right type but fell outside the field's declared value domain.

##### typeMismatch

> `readonly` **typeMismatch**: `"IGX-0605"`

A value had the wrong JavaScript or JSON type for the field kind.

##### unknownField

> `readonly` **unknownField**: `"IGX-0607"`

A property was supplied that the schema does not declare.

##### unresolvedReference

> `readonly` **unresolvedReference**: `"IGX-0602"`

An entity or component reference could not be resolved to a uid.

***

### ScriptCallbackKind

> `const` **ScriptCallbackKind**: `object`

Every script callback, numbered. The first five are driven by the lifecycle flushes; the rest are
dispatched from a phase and therefore get a sorted dispatch list.

#### Type Declaration

##### awake

> `readonly` **awake**: `0`

`awake()` — once, when the script first becomes effectively enabled.

##### fixedUpdate

> `readonly` **fixedUpdate**: `5`

`fixedUpdate(dt)` — once per fixed step.

##### lateUpdate

> `readonly` **lateUpdate**: `7`

`lateUpdate(dt)` — once per frame, after animation.

##### onApplicationFocus

> `readonly` **onApplicationFocus**: `14`

`onApplicationFocus(focused)`.

##### onApplicationPause

> `readonly` **onApplicationPause**: `13`

`onApplicationPause(paused)`.

##### onCollisionEnter

> `readonly` **onCollisionEnter**: `8`

`onCollisionEnter(collision)`.

##### onCollisionExit

> `readonly` **onCollisionExit**: `10`

`onCollisionExit(collision)`.

##### onCollisionStay

> `readonly` **onCollisionStay**: `9`

`onCollisionStay(collision)`.

##### onDestroy

> `readonly` **onDestroy**: `4`

`onDestroy()` — once, in the destroy flush.

##### onDisable

> `readonly` **onDisable**: `3`

`onDisable()` — on every transition off, including just before destruction.

##### onEnable

> `readonly` **onEnable**: `1`

`onEnable()` — on every transition to effectively enabled.

##### onTriggerEnter

> `readonly` **onTriggerEnter**: `11`

`onTriggerEnter(trigger)`.

##### onTriggerExit

> `readonly` **onTriggerExit**: `12`

`onTriggerExit(trigger)`.

##### start

> `readonly` **start**: `2`

`start()` — once, in flush B of the first frame the script is effectively enabled.

##### update

> `readonly` **update**: `6`

`update(dt)` — once per frame.

***

### STANDARD\_TEXTURE\_SLOTS

> `const` **STANDARD\_TEXTURE\_SLOTS**: readonly `string`[]

The texture slots a `"standard"` material may name.

***

### textAssetLoader

> `const` **textAssetLoader**: [`AssetLoader`](#assetloader)\<`string`\>

UTF-8 text, for `.txt`, `.md`, and `.csv` addresses.

***

### TEXTURE\_ASSET\_TYPE

> `const` **TEXTURE\_ASSET\_TYPE**: `"texture"` = `"texture"`

The asset type textures are registered under.

***

### THIRD\_PARTY\_ERROR\_PREFIX

> `const` **THIRD\_PARTY\_ERROR\_PREFIX**: `"9"` = `"9"`

The first digit of the range reserved for extensions published outside the `@ignifx` scope
(`IGX-9000` through `IGX-9999`). First-party subsystems never allocate here.

***

### TOUCH\_SLOTS

> `const` **TOUCH\_SLOTS**: `10` = `10`

How many simultaneous touches `Touch` tracks; `<Touch>/touch0` … `<Touch>/touch9`.

***

### VEC2\_ONE

> `const` **VEC2\_ONE**: [`Vec2Like`](#vec2like)

The frozen vector whose components are both one, `(1, 1)` — the identity 2D scale.

***

### VEC2\_ZERO

> `const` **VEC2\_ZERO**: [`Vec2Like`](#vec2like)

The frozen zero vector, `(0, 0)`.

***

### VEC3\_BACKWARD

> `const` **VEC3\_BACKWARD**: [`Vec3Like`](#vec3like)

The frozen world backward direction, `(0, 0, -1)`.

***

### VEC3\_DOWN

> `const` **VEC3\_DOWN**: [`Vec3Like`](#vec3like)

The frozen world down direction, `(0, -1, 0)`.

***

### VEC3\_FORWARD

> `const` **VEC3\_FORWARD**: [`Vec3Like`](#vec3like)

The frozen world forward direction, `(0, 0, 1)`. ignifx is left-handed, so forward is +Z
(ADR-0011).

***

### VEC3\_LEFT

> `const` **VEC3\_LEFT**: [`Vec3Like`](#vec3like)

The frozen world left direction, `(-1, 0, 0)`.

***

### VEC3\_ONE

> `const` **VEC3\_ONE**: [`Vec3Like`](#vec3like)

The frozen vector whose components are all one, `(1, 1, 1)` — the identity scale.

***

### VEC3\_RIGHT

> `const` **VEC3\_RIGHT**: [`Vec3Like`](#vec3like)

The frozen world right direction, `(1, 0, 0)`.

***

### VEC3\_UP

> `const` **VEC3\_UP**: [`Vec3Like`](#vec3like)

The frozen world up direction, `(0, 1, 0)`.

***

### VEC3\_ZERO

> `const` **VEC3\_ZERO**: [`Vec3Like`](#vec3like)

The frozen zero vector, `(0, 0, 0)`. Read-only: pass it anywhere a [Vec3Like](#vec3like) is wanted, and
call [Vec3.zero](#zero-1) when you need a vector you can write to.

***

### VERSION

> `const` **VERSION**: `"0.0.0"` = `"0.0.0"`

The `@ignifx/core` version this build reports as `app.version` and as the core extension's
`version` (`docs/architecture/04-extensions.md` §1).

#### Remarks

The literal is `"0.0.0"` in the repository and is stamped by the release pipeline: Changesets
writes the real number into `package.json`, and the build replaces this constant with it
(coding standards §12, `release.yml`). Reading the version from `package.json` at run time is not
an option — that would be an import-time side effect and a bundler hazard
(`CONSTITUTION.md` §3.5).

## Functions

### applyInit()

> **applyInit**\<`S`\>(`target`, `schema`, `init`): [`FieldsOf`](#fieldsof)\<`S`\>

Overwrites defaults with caller-supplied values. Only names the schema declares are copied, and
a value of `undefined` leaves the default in place — matching the loader's rule that omitted
props take schema defaults (`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Type Parameters

##### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

#### Parameters

##### target

[`FieldsOf`](#fieldsof)\<`S`\>

The field object to write into, normally the result of `createDefaults`.

##### schema

`S`

The schema that says which names are legal.

##### init

[`PartialFieldsOf`](#partialfieldsof)\<`S`\>

The values to apply.

#### Returns

[`FieldsOf`](#fieldsof)\<`S`\>

The same `target` object, for chaining.

#### Example

```ts
const fields = applyInit(createDefaults(moverSchema), moverSchema, { speed: 12 });
```

***

### applyOverrides()

> **applyOverrides**(`maps`, `json`): `void`

Applies a saved override document, clearing whatever was applied before.

#### Parameters

##### maps

`ReadonlyMap`\<`string`, [`ActionMap`](#actionmap)\>

The installed action maps.

##### json

[`InputOverridesJson`](#inputoverridesjson)

The document from [collectOverrides](#collectoverrides).

#### Returns

`void`

#### Throws

IgnifxError with code `IGX-0808` when the document is not an `ignifx.inputoverrides`
document this build can read, or names a map, action, or binding that does not exist.

***

### applyProcessors()

> **applyProcessors**(`chain`, `value`, `isVector`): `void`

Runs a whole processor chain over a value, in place. Allocation-free: the chain and the value are
both owned by the caller.

#### Parameters

##### chain

readonly [`Processor`](#processor)[]

The parsed processors, in application order.

##### value

[`ControlValue`](#controlvalue)

The value to transform.

##### isVector

`boolean`

Whether the value has two meaningful components.

#### Returns

`void`

#### Example

```ts
const value = { x: 0.1, y: 0 };
applyProcessors(parseProcessors(["deadzone(0.15)"]), value, false);
value.x; // 0
```

***

### approximately()

> **approximately**(`a`, `b`, `epsilon?`): `boolean`

Compares two numbers with an absolute tolerance. Use this instead of `===` on anything that has
been through a matrix, a quaternion or a `Float32Array`.

#### Parameters

##### a

`number`

The first value.

##### b

`number`

The second value.

##### epsilon?

`number`

The largest difference still considered equal. Defaults to [EPSILON](#epsilon).

#### Returns

`boolean`

`true` when the values differ by no more than `epsilon`. `NaN` is never approximately
equal to anything, including itself.

***

### array()

> **array**\<`T`\>(`item`, `defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<`T`[]\>

Declares a list field. The runtime value type is a *mutable* array because game code is expected
to push to it (`this.waypoints.push(p)`); the default is copied on every instantiation, shallowly,
so element objects supplied as defaults are shared and should be treated as immutable.

#### Type Parameters

##### T

`T`

The element value type, inferred from `item`.

#### Parameters

##### item

[`FieldDefinition`](#fielddefinition)\<`T`\>

The field definition every element follows.

##### defaultValue?

readonly `T`[]

The list a new component starts with; defaults to empty.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`T`[]\>

The field definition.

#### Example

```ts
waypoints: array(vec3()); // Vec3Like[]
```

***

### assertNever()

> **assertNever**(`value`, `what`): `never`

The default branch of an exhaustive `switch` (coding standards §5.2). The compiler rejects the
call as soon as a new union member is left unhandled, and at runtime it throws rather than
falling through silently.

#### Parameters

##### value

`never`

The value the type system proved impossible.

##### what

`string`

What was being switched over, for the message.

#### Returns

`never`

#### Throws

IgnifxError with code `IGX-1505`; the function never returns.

#### Example

```ts
switch (level) {
  case "debug":
    return 10;
  default:
    return assertNever(level, "log level");
}
```

***

### assertSceneDependenciesLoaded()

> **assertSceneDependenciesLoaded**(`asset`): `void`

Checks that every scene a file instances — at any depth — is among the loaded dependencies, which
is what makes `world.instantiate` safe to be synchronous
(`docs/architecture/02-scene-graph.md` §2).

#### Parameters

##### asset

[`SceneAsset`](#sceneasset)

The scene to check.

#### Returns

`void`

#### Throws

IgnifxError with code `IGX-0301` naming the first instanced scene that is not loaded.

***

### asset()

> **asset**\<`A`\>(`type`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`AssetHandle`](#assethandle)\<`A`\> \| `null`\>

Declares a reference to an addressable asset. The **runtime** value is the loaded
[AssetHandle](#assethandle), not an address: a component's `asset()` fields are resolved before its props
are written, so `awake` can already read `this.mesh.value`
(`docs/architecture/05-assets-and-loading.md` §3).

#### Type Parameters

##### A

`A`

The asset type the reference points at, inferred from the class.

#### Parameters

##### type

[`AssetTypeToken`](#assettypetoken)\<`A`\>

The asset class the field may point at.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`AssetHandle`](#assethandle)\<`A`\> \| `null`\>

The field definition.

#### Remarks

Files store the address instead — `{ "$asset": "models/hero.glb", "type"?: "model" }`
(`06-serialization-and-scene-format.md` §3). Encoding reads `handle.address`; decoding hands that
address to the `asset` resolver of the `ReferenceDecoder` the scene loader supplies, which answers
with the handle the scene already retains. Two consequences game code sees:

- An address the resolver cannot answer decodes to `null` and reports `IGX-0602`; the component
  keeps working with a missing asset rather than failing the whole scene.
- An **in-code** asset — anything from `Assets.register`, which includes `MeshAsset.box(…)` and
  `createMaterialAsset(app, pbrMaterialDefinition({ … }))` — lives at a `memory:` address that names no file, so serializing a
  component that holds one writes `null` and reports the loss. Save the asset as a file when it
  has to survive a round trip.

The field does **not** retain the handle: the scene instance that loaded it owns the reference
count and releases it on unload.

#### Example

```ts
class Hero extends Component.define({ clip: asset(AudioClip) }) {
  static typeId = "mygame/Hero";
  awake(): void {
    this.clip?.value.play();
  }
}
```

***

### assetRef()

> **assetRef**\<`T`\>(`address`, `type?`): [`AssetRef`](#assetref-3)\<`T`\>

Builds an asset reference.

#### Type Parameters

##### T

`T` = `unknown`

The loaded value type the reference points at; a compile-time marker only.

#### Parameters

##### address

`string`

The address, fragment included.

##### type?

`string`

The asset type, when the extension does not identify it.

#### Returns

[`AssetRef`](#assetref-3)\<`T`\>

A frozen reference, safe to hold as a module constant.

#### Example

```ts
const hero = assetRef<ModelAsset>("models/hero.glb");
const run = assetRef<AnimationClip>("models/hero.glb#animation:Run");
const handle = app.assets.load(hero);
```

***

### audioError()

> **audioError**(`code`, `message`, `options?`): [`IgnifxError`](#ignifxerror)

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`AudioErrorCode`](#audioerrorcode-1)

The code from the `AudioErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`AudioErrorOptions`](#audioerroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

[`IgnifxError`](#ignifxerror)

The error to throw or to reject with.

#### Remarks

`IgnifxError`'s `code` parameter is the open template type `IGX-${number}`, so an `IGX-10##`
literal from the `AudioErrorCode` table is accepted without an assertion.

#### Example

```ts
throw audioError(AudioErrorCode.unknownBus, "Ambience is not a registered bus.", {
  context: { bus: "Ambience" },
  hint: "Declare it in the project's .audio.json, or call app.audio.createBus.",
});
```

***

### audioSettingsSchema()

> **audioSettingsSchema**(): [`Schema`](#schema-14)

The schema the `audio` section is validated against.

#### Returns

[`Schema`](#schema-14)

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

***

### bool()

> **bool**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<`boolean`\>

Declares a boolean field.

#### Parameters

##### defaultValue?

`boolean`

The value a new component starts with.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`boolean`\>

The field definition.

***

### buildControls()

> **buildControls**(`specs`): readonly [`ControlDescriptor`](#controldescriptor)[]

Assigns indices and value-array offsets to a device's control declarations.

#### Parameters

##### specs

readonly [`ControlSpec`](#controlspec)[]

The declarations, in the order they should be indexed.

#### Returns

readonly [`ControlDescriptor`](#controldescriptor)[]

The descriptors, index `i` describing `specs[i]`.

#### Example

```ts
const controls = buildControls([
  { name: "leftStick", kind: ControlKind.vector2 },
  { name: "buttonSouth", kind: ControlKind.button },
]);
controls[1].offset; // 2 — the stick took slots 0 and 1
```

***

### canonicalizeNumber()

> **canonicalizeNumber**(`value`): `number`

Rounds a number to the file format's precision: six decimal places, with `-0` normalized to `0`
(`docs/architecture/06-serialization-and-scene-format.md` §3). The rule is idempotent, so
save → load → save is byte-identical.

#### Parameters

##### value

`number`

The number to canonicalize.

#### Returns

`number`

The canonical form of the number.

#### Example

```ts
canonicalizeNumber(0.1 + 0.2); // 0.3
canonicalizeNumber(-0); // 0
```

***

### clamp()

> **clamp**(`value`, `min`, `max`): `number`

Constrains a value to an inclusive range.

#### Parameters

##### value

`number`

The value to constrain.

##### min

`number`

The lower bound.

##### max

`number`

The upper bound.

#### Returns

`number`

`min` when `value` is smaller, `max` when it is larger, otherwise `value` unchanged.
`NaN` propagates.

#### Example

```ts
clamp(12, 0, 10); // 10
```

***

### clamp01()

> **clamp01**(`value`): `number`

Constrains a value to the 0–1 range.

#### Parameters

##### value

`number`

The value to constrain.

#### Returns

`number`

The value clamped into `[0, 1]`.

***

### clearOverrides()

> **clearOverrides**(`maps`): `void`

Removes every override, returning each binding to its declared path.

#### Parameters

##### maps

`ReadonlyMap`\<`string`, [`ActionMap`](#actionmap)\>

The installed action maps.

#### Returns

`void`

***

### collectOverrides()

> **collectOverrides**(`maps`): [`InputOverridesJson`](#inputoverridesjson)

Collects every override currently applied.

#### Parameters

##### maps

`ReadonlyMap`\<`string`, [`ActionMap`](#actionmap)\>

The installed action maps.

#### Returns

[`InputOverridesJson`](#inputoverridesjson)

The document to persist.

***

### color()

> **color**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`ColorLike`](#colorlike)\>

Declares an RGBA color field. Channels are sRGB in the 0–1 range, in memory and in files alike:
conversion to linear space belongs to the renderer, not the schema
(`docs/architecture/06-serialization-and-scene-format.md` §3).

#### Parameters

##### defaultValue?

`string` \| [`ColorLike`](#colorlike)

The starting color, either as channels or as a `#rgb`/`#rgba`/`#rrggbb`/
`#rrggbbaa` string; defaults to opaque white.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`ColorLike`](#colorlike)\>

The field definition.

#### Throws

A `TypeError` when a string default is not a valid hexadecimal color.

#### Example

```ts
tint: color("#ffffff");
```

***

### componentRef()

> **componentRef**\<`C`\>(`type`, `options?`): [`FieldDefinition`](#fielddefinition)\<`C` \| `null`\>

Declares a reference to a component on an entity in the same scene file.

#### Type Parameters

##### C

`C`

The component type the reference resolves to, inferred from the class.

#### Parameters

##### type

[`ComponentTypeToken`](#componenttypetoken)\<`C`\>

The component class the field may point at.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`C` \| `null`\>

The field definition.

#### Example

```ts
follow: componentRef(Camera); // Camera | null
```

***

### compositeIsVector()

> **compositeIsVector**(`kind`): `boolean`

What a composite produces before processors run.

#### Parameters

##### kind

[`CompositeKind`](#compositekind-1)

The composite.

#### Returns

`boolean`

`true` when the composite yields a two-component value.

***

### compositeParts()

> **compositeParts**(`kind`): readonly `string`[]

The part names one composite declares, in evaluation order.

#### Parameters

##### kind

[`CompositeKind`](#compositekind-1)

The composite.

#### Returns

readonly `string`[]

The part names.

#### Example

```ts
compositeParts("2DVector"); // ["up", "down", "left", "right"]
```

***

### computeSceneHash()

> **computeSceneHash**(`file`): `Promise`\<`string`\>

The content hash of a scene file: SHA-256 over the canonical JSON text, so two saves of the same
state hash the same and an edited prefab does not
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Parameters

##### file

[`SceneFile`](#scenefile)

The file to hash.

#### Returns

`Promise`\<`string`\>

The hash as `sha256:<64 lowercase hex digits>`.

#### Throws

IgnifxError with code `IGX-1420` when the host exposes no Web Crypto `subtle`.

#### Example

```ts
const hash = await computeSceneHash(serializeScene(instance)); // "sha256:9f2c…"
```

***

### controlPath()

> **controlPath**(`device`, `control`): `string`

Builds the binding path of one control.

#### Parameters

##### device

[`InputDevice`](#inputdevice)

The control's device.

##### control

[`ControlDescriptor`](#controldescriptor)

The control.

#### Returns

`string`

The path, with the `{index}` segment only when the device index is not `0`.

***

### controlSlotCount()

> **controlSlotCount**(`controls`): `number`

How many `Float32Array` slots a control table needs.

#### Parameters

##### controls

readonly [`ControlDescriptor`](#controldescriptor)[]

The descriptors from [buildControls](#buildcontrols).

#### Returns

`number`

The total slot count.

***

### createApp()

> **createApp**(`options?`): `Promise`\<[`App`](#app)\>

Creates a game (`docs/architecture/00-overview.md` §1, `04-extensions.md` §2).

#### Parameters

##### options?

[`CreateAppOptions`](#createappoptions)

The canvas or `headless`, the extensions, the project settings, and the clock.

#### Returns

`Promise`\<[`App`](#app)\>

The app, ready to start.

#### Remarks

The whole of construction happens here: the extension list is built, sorted, and validated, every
`register` hook runs in order, the Lite engine and scene are created, the project settings are
frozen, and the world is built. Nothing runs a frame until `app.start()` (browser) or
`app.step(dt)` (headless).

#### Throws

IgnifxError with the `IGX-04xx` codes of `04-extensions.md` §2 when the extension list
does not validate, `IGX-0408`/`IGX-0407` when the project settings do not, and `IGX-0701` when a
canvas was given but the host has no WebGPU.

#### Example

```ts
const app = await createApp({ headless: true, clock: createManualClock() });
const player = app.world.createEntity("Player");
player.addComponent(Mover);
app.step(1 / 60);
app.dispose();
```

***

### createAssetManifest()

> **createAssetManifest**(`entries`, `root?`): [`AssetManifest`](#assetmanifest)

Builds a manifest from a list of entries — what a test, a tool, or a hand-written config uses in
place of the generated file.

#### Parameters

##### entries

readonly [`AssetManifestEntry`](#assetmanifestentry)[]

The addressed files.

##### root?

`string`

The asset root relative addresses resolve against. Defaults to `"assets"`.

#### Returns

[`AssetManifest`](#assetmanifest)

The manifest.

#### Example

```ts
const manifest = createAssetManifest([{ address: "data/x.json", url: "assets/data/x.abc123.json" }]);
const app = await createApp({ headless: true, assets: { manifest } });
```

***

### createAudioBusesLoader()

> **createAudioBusesLoader**(): [`AssetLoader`](#assetloader)\<[`AudioBusesAsset`](#audiobusesasset)\>

Builds the loader for `.audio.json` addresses.

#### Returns

[`AssetLoader`](#assetloader)\<[`AudioBusesAsset`](#audiobusesasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createAudioBusesLoader());
```

***

### createAudioClipLoader()

> **createAudioClipLoader**(`options`): [`AssetLoader`](#assetloader)\<[`AudioClip`](#audioclip)\>

Builds the loader for audio addresses.

#### Parameters

##### options

[`AudioClipLoaderOptions`](#audiocliploaderoptions)

How to reach the app's decoder.

#### Returns

[`AssetLoader`](#assetloader)\<[`AudioClip`](#audioclip)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createAudioClipLoader({ decoder: () => service.decoder() }));
```

***

### createConsoleSink()

> **createConsoleSink**(`options?`): [`LogSink`](#logsink-1)

Creates the default log sink: one console line per record, prefixed with the logger scope and
routed to the console method matching the record's level.

#### Parameters

##### options?

[`ConsoleSinkOptions`](#consolesinkoptions)

An alternative console, for tests and for the Electron main process.

#### Returns

[`LogSink`](#logsink-1)

A sink for [createLogger](#createlogger).

#### Example

```ts
const log = createLogger({ sink: createConsoleSink(), level: "warn" });
```

***

### createCryptoRandom()

> **createCryptoRandom**(): [`RandomSource`](#randomsource)

Creates the production random source, backed by Web Crypto.

#### Returns

[`RandomSource`](#randomsource)

A source that fills buffers with `crypto.getRandomValues`.

#### Throws

IgnifxError with code `IGX-1420` when the host exposes no Web Crypto implementation.

#### Example

```ts
const nextUid = createUlidFactory({ random: createCryptoRandom() });
```

***

### createDefaults()

> **createDefaults**\<`S`\>(`schema`): [`FieldsOf`](#fieldsof)\<`S`\>

Builds the initial field object for a schema. Every value is freshly allocated by its field's
own `createDefault`, so two components declared from the same schema never share a mutable
default such as a `vec3` or an `array`.

#### Type Parameters

##### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

#### Parameters

##### schema

`S`

The schema to instantiate.

#### Returns

[`FieldsOf`](#fieldsof)\<`S`\>

A new object holding one default per declared field.

#### Example

```ts
const a = createDefaults(moverSchema);
const b = createDefaults(moverSchema);
a.offset === b.offset; // false — each call allocates
```

***

### createDiagnosticsGroup()

> **createDiagnosticsGroup**(`name`, `counterNames`): [`DiagnosticsGroup`](#diagnosticsgroup-1)

Creates a counter group. [Diagnostics.registerGroup](#registergroup) is the entry point games use; this
factory exists so a group can be built and tested on its own.

#### Parameters

##### name

`string`

The group name.

##### counterNames

readonly `string`[]

The counter names, in the order their indices are assigned.

#### Returns

[`DiagnosticsGroup`](#diagnosticsgroup-1)

The group.

***

### createEnvironmentLoader()

> **createEnvironmentLoader**(): [`AssetLoader`](#assetloader)\<[`EnvironmentAsset`](#environmentasset)\>

Builds the loader for `.env`, `.hdr`, `.dds`, and `.environment.json` addresses.

#### Returns

[`AssetLoader`](#assetloader)\<[`EnvironmentAsset`](#environmentasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createEnvironmentLoader());
```

***

### createErrorCodeRegistry()

> **createErrorCodeRegistry**(): [`ErrorCodeRegistry`](#errorcoderegistry)

Creates an error code registry pre-loaded with the codes `@ignifx/core` owns.

#### Returns

[`ErrorCodeRegistry`](#errorcoderegistry)

A registry owned by one app.

#### Example

```ts
const registry = createErrorCodeRegistry();
registry.register({ "IGX-9001": "The {thing} was not spawned." }, "game/spawner");
registry.describe("IGX-0701")?.message; // "WebGPU is not available in this environment."
```

***

### createFontLoader()

> **createFontLoader**(): [`AssetLoader`](#assetloader)\<[`FontAsset`](#fontasset)\>

Builds the loader for `.ttf` and `.otf` addresses.

#### Returns

[`AssetLoader`](#assetloader)\<[`FontAsset`](#fontasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createFontLoader());
```

***

### createFrameSample()

> **createFrameSample**(): [`FrameSample`](#framesample)

Allocates a frame sample with every counter at zero. Call it once, outside the frame loop — the
`out` parameter of [Diagnostics.readFrame](#readframe) exists so that reading history never allocates.

#### Returns

[`FrameSample`](#framesample)

A zeroed sample.

#### Example

```ts
const sample = createFrameSample();
for (let index = 0; index < app.diagnostics.historyLength; index += 1) {
  app.diagnostics.readFrame(index, sample);
  graph.push(sample.rawDeltaMs);
}
```

***

### createInputActionsLoader()

> **createInputActionsLoader**(): [`AssetLoader`](#assetloader)\<[`InputActionsAsset`](#inputactionsasset)\>

Builds the loader for `.input.json` addresses.

#### Returns

[`AssetLoader`](#assetloader)\<[`InputActionsAsset`](#inputactionsasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createInputActionsLoader());
```

***

### createKeyboardDevice()

> **createKeyboardDevice**(): [`InputDevice`](#inputdevice)

Builds the keyboard device.

#### Returns

[`InputDevice`](#inputdevice)

A device whose controls are the physical keys plus `anyKey`.

***

### createLayerTable()

> **createLayerTable**(`names?`): [`LayerTable`](#layertable)

Resolves the project's layer names into a table.

#### Parameters

##### names?

readonly `string`[]

The `layers` project settings section, in declaration order.

#### Returns

[`LayerTable`](#layertable)

The resolved table.

#### Throws

IgnifxError with code `IGX-0304` on a duplicate name, or `IGX-0305` when the names do not
fit in the 32 slots.

#### Example

```ts
const layers = createLayerTable(["Default", "Ground", "Player", "Enemy"]);
```

***

### createLogger()

> **createLogger**(`options`): [`Logger`](#logger)

Creates the root logger of one app.

#### Parameters

##### options

[`LoggerOptions`](#loggeroptions)

The sink, and optionally the threshold, root scope, and clock.

#### Returns

[`Logger`](#logger)

The root logger; call [Logger.child](#child) for scoped loggers.

#### Example

```ts
const log = createLogger({ sink: createConsoleSink(), level: "debug" });
log.child("assets").warnOnce("missing-atlas", "No atlas for sprite {id}.");
```

***

### createManualClock()

> **createManualClock**(`startMs?`): [`ManualClock`](#manualclock)

Creates a clock a test drives by hand. Headless apps take one so that `realtimeSinceStartup` and
`waitSecondsRealtime` are as deterministic as the rest of the frame
(`docs/architecture/01-lifecycle-and-time.md` §8).

#### Parameters

##### startMs?

`number`

The initial reading. Defaults to `0`.

#### Returns

[`ManualClock`](#manualclock)

The clock, with `advance` and `set`.

#### Example

```ts
const clock = createManualClock(1000);
clock.advance(1000 / 60);
clock.nowMs(); // 1016.666…
```

***

### createMaterialAsset()

> **createMaterialAsset**(`app`, `definition`, `textures`): [`AssetHandle`](#assethandle)\<[`MaterialAsset`](#materialasset)\>

Builds a Lite material from a declaration and publishes it as an in-memory asset.

#### Parameters

##### app

[`App`](#app)

The app whose asset service publishes it.

##### definition

[`MaterialDefinition`](#materialdefinition)

The declaration.

##### textures

readonly [`AssetHandle`](#assethandle)\<[`TextureAsset`](#textureasset)\>[]

The texture handles the declaration's slots resolved to, in slot order.

#### Returns

[`AssetHandle`](#assethandle)\<[`MaterialAsset`](#materialasset)\>

The handle, with one holder — the caller.

#### Example

```ts
using red = createMaterialAsset(app, pbrMaterialDefinition({ name: "red", baseColor: { r: 1, g: 0, b: 0, a: 1 } }), []);
```

***

### createMaterialLoader()

> **createMaterialLoader**(): [`AssetLoader`](#assetloader)\<[`MaterialAsset`](#materialasset)\>

Builds the loader for `.material.json` addresses.

#### Returns

[`AssetLoader`](#assetloader)\<[`MaterialAsset`](#materialasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createMaterialLoader());
```

***

### createMemorySink()

> **createMemorySink**(`limit?`): [`MemorySink`](#memorysink)

Creates an in-memory ring-buffer sink.

#### Parameters

##### limit?

`number`

How many records to retain. Defaults to [DEFAULT\_MEMORY\_SINK\_LIMIT](#default_memory_sink_limit); values
below one are clamped to one.

#### Returns

[`MemorySink`](#memorysink)

The sink, with the retained records readable through [MemorySink.at](#at).

#### Example

```ts
const sink = createMemorySink(4);
const log = createLogger({ sink, now: () => 0 });
log.warn("no atlas");
sink.at(0)?.level; // "warn"
```

***

### createModelLoader()

> **createModelLoader**(): [`AssetLoader`](#assetloader)\<[`ModelAsset`](#modelasset)\>

Builds the loader for `.glb` and `.gltf` addresses.

#### Returns

[`AssetLoader`](#assetloader)\<[`ModelAsset`](#modelasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createModelLoader());
```

***

### createMouseDevice()

> **createMouseDevice**(): [`InputDevice`](#inputdevice)

Builds the mouse device.

#### Returns

[`InputDevice`](#inputdevice)

The device behind `<Mouse>/…` paths.

***

### createNavigatorGamepadReader()

> **createNavigatorGamepadReader**(): [`GamepadReader`](#gamepadreader) \| `null`

The reader that goes through `navigator.getGamepads()`, or `null` when the host has no Gamepad
API (Node, and browsers with the feature switched off).

#### Returns

[`GamepadReader`](#gamepadreader) \| `null`

The reader, or `null`.

***

### createPerformanceClock()

> **createPerformanceClock**(): [`Clock`](#clock)

Creates the default clock: `performance.now()` where the host has it, `Date.now()` otherwise.

#### Returns

[`Clock`](#clock)

A clock reading the host's monotonic timer.

***

### createPointerDevice()

> **createPointerDevice**(): [`InputDevice`](#inputdevice)

Builds the unified pointer device: whichever of mouse, pen, or first touch acted last.

#### Returns

[`InputDevice`](#inputdevice)

The device behind `<Pointer>/…` paths.

***

### createRay()

> **createRay**(): [`Ray`](#ray)

Creates a reusable ray at the origin pointing along `+Z`.

#### Returns

[`Ray`](#ray)

A fresh ray. **Allocates** — make one per call site, not per frame.

#### Example

```ts
const ray = createRay();
camera.screenToRay(event.offsetX, event.offsetY, ray);
```

***

### createSceneAsset()

> **createSceneAsset**(`address`, `file`, `dependencies?`): `Promise`\<[`SceneAsset`](#sceneasset)\>

Builds a `SceneAsset` from a file that is already in memory — the shape the loader returns, and
the one tests and tools use when there is no asset service in play.

#### Parameters

##### address

`string`

The address the asset stands at.

##### file

[`SceneFile`](#scenefile)

The parsed file.

##### dependencies?

readonly [`AssetHandle`](#assethandle)\<`unknown`\>[]

Every asset the file references, already loaded.

#### Returns

`Promise`\<[`SceneAsset`](#sceneasset)\>

The asset, with its content hash computed.

#### Example

```ts
const prefab = await createSceneAsset("prefabs/enemy.prefab.json", enemyFile, []);
```

***

### createSceneLoader()

> **createSceneLoader**(`options?`): [`AssetLoader`](#assetloader)\<[`SceneAsset`](#sceneasset)\>

The `AssetLoader` for `*.scene.json` and `*.prefab.json`
(`docs/architecture/06-serialization-and-scene-format.md` §4 steps 1 and 2, ADR-0005 — one
loader for levels and prefabs).

#### Parameters

##### options?

[`SceneLoaderOptions`](#sceneloaderoptions)

Whether to validate.

#### Returns

[`AssetLoader`](#assetloader)\<[`SceneAsset`](#sceneasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Remarks

The loader does everything the file needs *before* the world sees it: parse, check the header and
the format version, validate the structure, then resolve every `$asset` it can find — in
`settings`, in every component's `props`, and in every `instance.scene`, recursively through the
scene assets those pull in. The resulting `SceneAsset` therefore carries a fully loaded
dependency set, which is what makes `world.instantiate` synchronous
(`02-scene-graph.md` §2).

#### Example

```ts
ctx.registerAssetLoader(createSceneLoader());
const level = await app.assets.loadAsync<SceneAsset>("levels/level01.scene.json");
```

***

### createSeededRandom()

> **createSeededRandom**(`seed`): [`RandomSource`](#randomsource)

Creates a deterministic random source: the same seed always produces the same byte stream.

#### Parameters

##### seed

`number`

Any integer; only the low 32 bits are used.

#### Returns

[`RandomSource`](#randomsource)

A source that fills buffers deterministically.

#### Remarks

The generator is Marsaglia's four-word `xorshift128`, seeded through a `splitmix32`-style
scrambler so that neighbouring seeds do not produce correlated streams. It is for tests, replays,
and procedural generation — never for anything security-sensitive.

#### Example

```ts
const nextUid = createUlidFactory({ random: createSeededRandom(1), now: () => 0 });
nextUid() === createUlidFactory({ random: createSeededRandom(1), now: () => 0 })(); // true
```

***

### createServiceKey()

> **createServiceKey**\<`T`\>(`name`): [`ServiceNameKey`](#servicenamekey)\<`T`\>

Creates a named service key for a service that has no class to use as a token.

#### Type Parameters

##### T

`T`

The service instance type the key stands for.

#### Parameters

##### name

`string`

A unique, human-readable name, used in `IGX-0405` messages.

#### Returns

[`ServiceNameKey`](#servicenamekey)\<`T`\>

The key. It is a plain frozen object, so it is safe at module scope.

#### Example

```ts
export const StorageService: ServiceKey<Storage> = createServiceKey<Storage>("storage");
ctx.registerService(StorageService, new LocalStorage());
```

***

### createTextureLoader()

> **createTextureLoader**(): [`AssetLoader`](#assetloader)\<[`TextureAsset`](#textureasset)\>

Builds the loader for `.png`, `.jpg`, `.jpeg`, `.webp`, `.ktx2`, and `.basis` addresses.

#### Returns

[`AssetLoader`](#assetloader)\<[`TextureAsset`](#textureasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createTextureLoader());
```

***

### createTouchDevice()

> **createTouchDevice**(): [`InputDevice`](#inputdevice)

Builds the touch device.

#### Returns

[`InputDevice`](#inputdevice)

The device behind `<Touch>/…` paths.

***

### createUlidFactory()

> **createUlidFactory**(`options?`): () => `string`

Creates the monotonic ULID generator an app owns.

#### Parameters

##### options?

[`UlidFactoryOptions`](#ulidfactoryoptions)

The random source and the clock.

#### Returns

A function producing the next ULID.

() => `string`

#### Remarks

The returned function holds the monotonic state — the last timestamp and its randomness — so that
ids created inside one millisecond still sort in creation order, exactly like the ULID
specification's monotonic mode. The state lives in the closure, never at module scope, so two apps
in one process generate independently (`CONSTITUTION.md` §3.5, §3.6). A clock that jumps backwards
is pinned to the last timestamp, so ids never go backwards either.

#### Example

```ts
const nextUid = createUlidFactory();
const a = nextUid();
const b = nextUid();
a < b; // true, even inside one millisecond
```

***

### createWebAudioBackend()

> **createWebAudioBackend**(`context`): `Promise`\<[`AudioBackend`](#audiobackend)\>

Creates the Web Audio backend.

#### Parameters

##### context

[`AudioBackendContext`](#audiobackendcontext)

Whether the app is headless, an audio context to build on, and the initial gain.

#### Returns

`Promise`\<[`AudioBackend`](#audiobackend)\>

The backend.

#### Remarks

`createAudioEngineAsync` calls `new AudioContext()` when it is handed none, which throws outside a
browser — so this factory is reached only when `app.isHeadless` is false, or when a test supplies
its own context. Pass an `OfflineAudioContext` to render deterministically and faster than real
time; Lite reports such an engine as permanently `"running"` (`lib/audio/audio-engine.js`), so
there is no unlock to wait for.

#### Throws

IgnifxError with code `IGX-1007` when this host has no Web Audio at all.

#### Example

```ts
const offline = new OfflineAudioContext({ numberOfChannels: 2, length: 44100, sampleRate: 44100 });
const backend = await createWebAudioBackend({ isHeadless: false, audioContext: offline, masterVolume: 1 });
```

***

### curve()

> **curve**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`CurveValue`](#curvevalue)\>

Declares an animation curve field.

#### Parameters

##### defaultValue?

[`CurveValue`](#curvevalue)

The curve a new component starts with; defaults to no keys.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`CurveValue`](#curvevalue)\>

The field definition.

#### Example

```ts
falloff: curve({ keys: [[0, 1, 0, 0], [1, 0, 0, 0]] });
```

***

### custom()

> **custom**\<`T`\>(`codec`, `options?`): [`FieldDefinition`](#fielddefinition)\<`T`\>

Declares a field whose JSON form is written by hand. Use it for value types the built-in kinds
cannot express; the codec owns the default, the encoding, and the generated JSON Schema fragment.

#### Type Parameters

##### T

`T`

The runtime value type.

#### Parameters

##### codec

[`CustomFieldCodec`](#customfieldcodec)\<`T`\>

The default factory, `serialize`, `deserialize`, and optional `jsonSchema`.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`T`\>

The field definition.

#### Example

```ts
grid: custom({
  createDefault: () => new Uint8Array(16),
  serialize: (value) => [...value],
  deserialize: (json) => Uint8Array.from(Array.isArray(json) ? json.map(Number) : []),
  jsonSchema: { type: "array", items: { type: "integer" } },
});
```

***

### decodeProps()

> **decodeProps**\<`S`\>(`schema`, `json`, `references`): [`DecodeResult`](#decoderesult)\<[`FieldsOf`](#fieldsof)\<`S`\>\>

Decodes a component's `props` object. Fields the file omits take their schema default; names the
schema does not declare are reported as `IGX-0607` and ignored.

#### Type Parameters

##### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being decoded.

#### Parameters

##### schema

`S`

The schema to decode against.

##### json

[`JsonObject`](#jsonobject)

The `props` object read from the file.

##### references

[`ReferenceDecoder`](#referencedecoder)

How to resolve uids back to entities and components.

#### Returns

[`DecodeResult`](#decoderesult)\<[`FieldsOf`](#fieldsof)\<`S`\>\>

The decoded field object and every problem found.

***

### decodeValue()

> **decodeValue**\<`T`\>(`field`, `json`, `references`): [`DecodeResult`](#decoderesult)\<`T`\>

Decodes one JSON value back into a field value. Decoding never throws and never returns a broken
value: unreadable JSON yields the field's freshly built default plus an issue, so a corrupt file
degrades one field rather than failing a whole scene
(`docs/architecture/06-serialization-and-scene-format.md` §4).

#### Type Parameters

##### T

`T`

The field's value type.

#### Parameters

##### field

[`FieldDefinition`](#fielddefinition)\<`T`\>

The field to decode against.

##### json

[`JsonValue`](#jsonvalue)

The JSON to read.

##### references

[`ReferenceDecoder`](#referencedecoder)

How to resolve uids back to entities and components.

#### Returns

[`DecodeResult`](#decoderesult)\<`T`\>

The decoded value and every problem found.

#### Example

```ts
decodeValue(vec3(), [1, 2, 3], references); // { value: { x: 1, y: 2, z: 3 }, issues: [] }
```

***

### defaultAudioSettings()

> **defaultAudioSettings**(): [`AudioSettings`](#audiosettings)

The values used for everything a project omits.

#### Returns

[`AudioSettings`](#audiosettings)

The default `audio` section.

***

### defaultInputSettings()

> **defaultInputSettings**(): [`InputSettings`](#inputsettings)

The values used for everything a project omits.

#### Returns

[`InputSettings`](#inputsettings)

The default `input` section.

***

### defaultRenderingSettings()

> **defaultRenderingSettings**(): [`RenderingSettings`](#renderingsettings)

The settings a project that declares no `rendering` section runs with: every feature off, Lite's
own swapchain defaults, and an unclamped device pixel ratio.

#### Returns

[`RenderingSettings`](#renderingsettings)

A fresh, complete section. It is built on demand rather than frozen at module scope
because `requiredLimits` and `clearColor` are mutable objects a caller must not share
(`CONSTITUTION.md` §3.5).

#### Example

```ts
const defaults = defaultRenderingSettings();
defaults.features.shadows; // false
```

***

### defineExtension()

> **defineExtension**\<`O`\>(`factory`): (`options?`) => [`Extension`](#extension)

Wraps an extension factory so that it can be called with or without options
(`docs/architecture/04-extensions.md` §1). Every published extension is written this way; a game's
own extension should be too.

#### Type Parameters

##### O

`O` = `void`

The options object the factory accepts. Defaults to `void` for an extension that
takes none.

#### Parameters

##### factory

(`options`) => [`Extension`](#extension)

Builds the extension descriptor from its options.

#### Returns

A factory that may be called with no argument, in which case the options are `undefined`.

(`options?`) => [`Extension`](#extension)

#### Remarks

The wrapper does nothing at module import time (`CONSTITUTION.md` §3.5): the factory runs when the
game calls `physics()`, and even then only builds the descriptor — the work happens in `register`
and `onStart`.

#### Example

```ts
export const spawner = defineExtension<{ readonly budget?: number }>((options = {}) => ({
  name: "game/spawner",
  version: "1.0.0",
  requires: ["@ignifx/core"],
  register(ctx) {
    ctx.registerService(SpawnerService, new SpawnerService(options.budget ?? 32));
  },
}));

const app = await createApp({ headless: true, extensions: [spawner({ budget: 64 })] });
```

***

### defineInputActions()

> **defineInputActions**(`input`): [`InputActionsDefinition`](#inputactionsdefinition)

Builds an `ignifx.inputactions` document in code, filling in the format header
(`docs/architecture/08-input.md` §3: "the same asset can be defined in code with
`defineInputActions({...})`").

#### Parameters

##### input

[`InputActionsInput`](#inputactionsinput)

The maps, and optionally the control schemes and the header.

#### Returns

[`InputActionsDefinition`](#inputactionsdefinition)

The document, identical to what the loader produces for the equivalent `.input.json`.

#### Example

```ts
const actions = defineInputActions({
  maps: [
    {
      name: "Player",
      actions: [{ name: "jump", type: "button", bindings: [{ path: "<Keyboard>/space" }] }],
    },
  ],
});
```

***

### defineSchema()

> **defineSchema**\<`S`\>(`fields`): `S`

Declares a component's serialized fields. The helper is an identity function at runtime — it
returns the object it was given — but it checks every field name and, because it is generic,
preserves the exact literal type of the schema so `FieldsOf` can project it.

`Script.define` and `Component.define` call this before they build a base class.

#### Type Parameters

##### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

#### Parameters

##### fields

`S`

The field definitions, keyed by the property name they become.

#### Returns

`S`

The same object, with its precise type preserved.

#### Throws

A `TypeError` when a field name is not identifier-like, starts with `_`, or collides with
a `Component`/`Script` member such as `enabled` or `update`.

#### Example

```ts
const moverSchema = defineSchema({
  speed: f32(5, { min: 0, max: 50 }),
  waypoints: array(vec3()),
});
```

***

### degToRad()

> **degToRad**(`degrees`): `number`

Converts an angle from degrees to radians.

#### Parameters

##### degrees

`number`

The angle in degrees.

#### Returns

`number`

The same angle in radians.

***

### deltaAngleDegrees()

> **deltaAngleDegrees**(`fromDegrees`, `toDegrees`): `number`

The shortest signed rotation from one angle to another, in degrees.

#### Parameters

##### fromDegrees

`number`

The starting angle.

##### toDegrees

`number`

The target angle.

#### Returns

`number`

The signed difference in `[-180, 180)`.

#### Example

```ts
deltaAngleDegrees(350, 10); // 20, not -340
```

***

### describeAudioBusesFormat()

> **describeAudioBusesFormat**(): [`SchemaDescription`](#schemadescription)

Describes the `ignifx.audiobuses` file format for the documentation harness
(`docs/architecture/16-docs-harness-and-skill.md` §3).

#### Returns

[`SchemaDescription`](#schemadescription)

The description of the file's fields.

***

### describeEnvironmentFileFormat()

> **describeEnvironmentFileFormat**(): [`SchemaDescription`](#schemadescription)

Describes the `ignifx.environment` file format
(`docs/architecture/06-serialization-and-scene-format.md` §6, `07-rendering.md` §2.5).

#### Returns

[`SchemaDescription`](#schemadescription)

The description of the top-level file fields.

***

### describeInputActionsFormat()

> **describeInputActionsFormat**(): [`SchemaDescription`](#schemadescription)

Describes the `ignifx.inputactions` file format for the documentation harness.

#### Returns

[`SchemaDescription`](#schemadescription)

The description of the top-level file fields.

***

### describeInputSchemas()

> **describeInputSchemas**(): `Readonly`\<`Record`\<`string`, [`SchemaDescription`](#schemadescription)\>\>

Describes every component and file format this package declares, for the documentation harness.

#### Returns

`Readonly`\<`Record`\<`string`, [`SchemaDescription`](#schemadescription)\>\>

The records, keyed by namespaced type id.

#### Example

```ts
describeInputSchemas()["ignifx/PlayerInput"].fields["deviceSlot"].default; // 0
```

***

### describeMaterialFileFormat()

> **describeMaterialFileFormat**(): [`SchemaDescription`](#schemadescription)

Describes the `ignifx.material` file format
(`docs/architecture/06-serialization-and-scene-format.md` §6, `07-rendering.md` §2.6).

#### Returns

[`SchemaDescription`](#schemadescription)

The description of the top-level file fields.

***

### describeSceneFileFormat()

> **describeSceneFileFormat**(): [`SchemaDescription`](#schemadescription)

The docs-harness description of the scene file format
(`scripts/README.md`, "Schema discovery convention"), so `pnpm docs:schemas` can render
`references/formats/scene.md` beside the component pages.

#### Returns

[`SchemaDescription`](#schemadescription)

The description of the top-level file fields.

***

### describeSchema()

> **describeSchema**(`typeId`, `schema`, `meta?`): [`SchemaDescription`](#schemadescription)

Describes a component schema in the shape the documentation harness consumes. A package exports
a record of these keyed by `typeId`; `pnpm docs:schemas` reads it from the built entry point and
regenerates the format pages and `ignifx.schemas.json` from it
(`scripts/README.md`, `docs/architecture/16-docs-harness-and-skill.md` §3).

#### Parameters

##### typeId

`string`

The component's namespaced registration id, for example `mygame/Mover`.

##### schema

[`Schema`](#schema-14)

The component's declared fields.

##### meta?

[`SchemaDescriptionMeta`](#schemadescriptionmeta)

Overrides for the title, format grouping, and summary.

#### Returns

[`SchemaDescription`](#schemadescription)

The description entry.

#### Example

```ts
export const schemas = {
  "mygame/Mover": describeSchema("mygame/Mover", moverSchema, { description: "Moves an entity." }),
};
```

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, [`SchemaDescription`](#schemadescription)\>\>

Describes every component and file format this package declares, for the documentation harness.

#### Returns

`Readonly`\<`Record`\<`string`, [`SchemaDescription`](#schemadescription)\>\>

The records, keyed by namespaced type id.

#### Example

```ts
const schemas = describeSchemas();
schemas["ignifx/Camera"].fields["fov"].default; // 60
```

***

### encodeProps()

> **encodeProps**\<`S`\>(`schema`, `props`, `references`, `issues?`): [`JsonObject`](#jsonobject)

Encodes a component's props in canonical key order. Fields the schema declares but `props` omits
take their default; fields marked `transient` are skipped.

#### Type Parameters

##### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The schema being encoded.

#### Parameters

##### schema

`S`

The schema that fixes the key order.

##### props

[`PartialFieldsOf`](#partialfieldsof)\<`S`\>

The values to encode, keyed by field name.

##### references

[`ReferenceEncoder`](#referenceencoder)

How to resolve entity and component references to uids.

##### issues?

[`SchemaIssue`](#schemaissue)[]

An optional collector; problems are appended to it in discovery order.

#### Returns

[`JsonObject`](#jsonobject)

The JSON object written under `props` in a scene file.

***

### encodeValue()

> **encodeValue**\<`T`\>(`field`, `value`, `references`, `issues?`): [`JsonValue`](#jsonvalue)

Encodes one value into the JSON form the scene format defines
(`docs/architecture/06-serialization-and-scene-format.md` §3). Numbers are canonicalized,
vectors and colors become arrays, and references become tagged objects.

Encoding is total: it always returns valid JSON. A value that cannot be represented — a `NaN`, a
reference to something outside the file, a value of the wrong type — is written as `null` and
reported through `issues`. Call [validateValue](#validatevalue) when you want the check without the output.

#### Type Parameters

##### T

`T`

The field's value type.

#### Parameters

##### field

[`FieldDefinition`](#fielddefinition)\<`T`\>

The field to encode against.

##### value

`T`

The value to encode.

##### references

[`ReferenceEncoder`](#referenceencoder)

How to resolve entity and component references to uids.

##### issues?

[`SchemaIssue`](#schemaissue)[]

An optional collector; problems are appended to it in discovery order.

#### Returns

[`JsonValue`](#jsonvalue)

The JSON representation.

#### Example

```ts
encodeValue(vec3(), { x: 1, y: 2.0000004, z: -0 }, references); // [1, 2, 0]
```

***

### entityRef()

> **entityRef**\<`E`\>(`options?`): [`FieldDefinition`](#fielddefinition)\<`E` \| `null`\>

Declares a reference to another entity in the same scene file. The value is `null` until the
scene is fully constructed and is nulled again when the target is destroyed
(`docs/architecture/03-scripting-and-components.md` §3).

The entity type is supplied by the caller because `Entity` lives in the kernel, which is layered
above this module.

#### Type Parameters

##### E

`E` = `unknown`

The entity type the reference resolves to.

#### Parameters

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`E` \| `null`\>

The field definition.

#### Example

```ts
target: entityRef<Entity>();
```

***

### enumOf()

> **enumOf**\<`T`\>(`values`, `defaultValue`, `options?`): [`FieldDefinition`](#fielddefinition)\<`T`\>

Declares a field restricted to a fixed set of string values.

#### Type Parameters

##### T

`T` *extends* `string`

#### Parameters

##### values

readonly `T`[]

Every accepted value, in the order the inspector should list them.

##### defaultValue

`NoInfer`\<`T`\>

The value a new component starts with; `NoInfer` keeps it out of the
inference for `T`, so passing a value `values` does not contain is a compile error as well as a
runtime one.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`T`\>

The field definition.

#### Throws

A `TypeError` when `defaultValue` is not one of `values`.

#### Example

```ts
mode: enumOf(["walk", "run"] as const, "walk");
```

***

### environmentDefinition()

> **environmentDefinition**(`overrides?`): [`EnvironmentDefinition`](#environmentdefinition-3)

Fills in an environment declaration's defaults.

#### Parameters

##### overrides?

`Partial`\<[`EnvironmentDefinition`](#environmentdefinition-3)\>

The properties the file or the caller set.

#### Returns

[`EnvironmentDefinition`](#environmentdefinition-3)

A complete declaration.

#### Example

```ts
environmentDefinition({ environment: "environments/studio.env", skyboxEnabled: false });
```

***

### f32()

> **f32**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<`number`\>

Declares a single-precision floating point field.

#### Parameters

##### defaultValue?

`number`

The value a new component starts with.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`number`\>

The field definition.

#### Example

```ts
speed: f32(5, { min: 0, max: 50, tooltip: "Units per second" });
```

***

### f64()

> **f64**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<`number`\>

Declares a double-precision floating point field.

#### Parameters

##### defaultValue?

`number`

The value a new component starts with.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`number`\>

The field definition.

***

### formatErrorMessage()

> **formatErrorMessage**(`code`, `message`, `context`, `hint`, `mode`): `string`

Builds the `Error.message` of an [IgnifxError](#ignifxerror).

#### Parameters

##### code

`` `IGX-${number}` ``

The stable diagnostic code.

##### message

`string`

The actionable development sentence.

##### context

[`ErrorContext`](#errorcontext)

Identifiers that locate the failure.

##### hint

`string` \| `null`

A remedy sentence, or `null`.

##### mode

[`ErrorFormatMode`](#errorformatmode)

Whether to format for development or production.

#### Returns

`string`

The formatted message.

#### Remarks

Development messages read `IGX-0201: Mover requires Rigidbody. [entity=01J…] Hint: add it.`
Production messages read `IGX-0201 [entity]` — enough to look the code up in the registry and to
know which identifiers the `context` property carries, with no prose in the bundle.

#### Example

```ts
formatErrorMessage("IGX-0303", "Enemy is not a declared layer.", { layer: "Enemy" }, null, "production");
// "IGX-0303 [layer]"
```

***

### gamepadControlNames()

> **gamepadControlNames**(): readonly `string`[]

The gamepad control names, in index order.

#### Returns

readonly `string`[]

Every control a `<Gamepad>/…` path may end in.

***

### generateUlid()

> **generateUlid**(`random?`, `now?`): `string`

Generates one ULID with fresh randomness.

#### Parameters

##### random?

[`RandomSource`](#randomsource)

Where the 80 random bits come from. Defaults to [createCryptoRandom](#createcryptorandom).

##### now?

() => `number`

The clock, in milliseconds since the Unix epoch. Defaults to `Date.now`.

#### Returns

`string`

A 26-character ULID.

#### Remarks

This is the stateless form: every call draws 80 new random bits, so two ids created in the same
millisecond are unordered relative to each other. Monotonic ordering needs state, and state at
module scope is forbidden (`CONSTITUTION.md` §3.5, §3.6) — use [createUlidFactory](#createulidfactory) when
ordering inside a millisecond matters, which is what an app does for entity uids.

#### Example

```ts
const uid = generateUlid();
isUlid(uid); // true
```

***

### i32()

> **i32**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<`number`\>

Declares a signed 32-bit integer field. Validation rejects fractional values and values outside
the signed 32-bit range with `IGX-0606`.

#### Parameters

##### defaultValue?

`number`

The value a new component starts with.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`number`\>

The field definition.

***

### inputActionsJsonSchema()

> **inputActionsJsonSchema**(): [`JsonObject`](#jsonobject)

The JSON Schema the Vite plugin validates `.input.json` files against
(`docs/architecture/06-serialization-and-scene-format.md` §6, §8).

#### Returns

[`JsonObject`](#jsonobject)

The schema document.

#### Example

```ts
await writeFile("inputactions.schema.json", JSON.stringify(inputActionsJsonSchema(), null, 2));
```

***

### inputError()

> **inputError**(`code`, `message`, `options?`): [`IgnifxError`](#ignifxerror)

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`InputErrorCode`](#inputerrorcode-1)

The code from the `InputErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`InputErrorOptions`](#inputerroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

[`IgnifxError`](#ignifxerror)

The error to throw or to reject with.

#### Remarks

`IgnifxError`'s `code` parameter is the open template type `IGX-${number}`, so an `IGX-08##`
literal from the `InputErrorCode` table is accepted without an assertion.

#### Example

```ts
throw inputError(InputErrorCode.unknownActionMap, "UI is not a registered action map.", {
  context: { map: "UI" },
});
```

***

### inputSettingsSchema()

> **inputSettingsSchema**(): [`Schema`](#schema-14)

The schema the `input` section is validated against.

#### Returns

[`Schema`](#schema-14)

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

***

### instantiateScene()

> **instantiateScene**(`world`, `asset`, `options?`): [`SceneBuildResult`](#scenebuildresult)

Builds the entities of a scene asset into a world — steps 3 to 6 of the loading algorithm
(`docs/architecture/06-serialization-and-scene-format.md` §4). It is synchronous and does no I/O:
every asset the file references is already loaded, which is what a `SceneAsset` guarantees.

#### Parameters

##### world

[`World`](#world-16)

The world to build into.

##### asset

[`SceneAsset`](#sceneasset)

The scene to build.

##### options?

[`InstantiateSceneOptions`](#instantiatesceneoptions)

Where to attach the result, and how to treat instance hashes.

#### Returns

[`SceneBuildResult`](#scenebuildresult)

The roots, the uid table, and every recoverable problem.

#### Remarks

The mechanism that keeps `awake` honest is worth stating, because §4 step 6 and
`01-lifecycle-and-time.md` §4 state only the outcome. Entities are created with `active: false`,
so the enable transition computes "not effectively enabled" and queues nothing. Components are
attached with their schema defaults, then every component's props are decoded — that is where
`entityRef` and `componentRef` resolve, through a table that by then holds the whole scene. Only
then does a last pass write each entity's file `active` value in tree order, which is what queues
`awake` and `onEnable`, parents before children. Nothing observes the half-built scene, because
all of this runs in one synchronous block.

#### Throws

IgnifxError with code `IGX-0302` on an instance cycle, `IGX-0307` when the file names an
unregistered component type, and `IGX-0604` when `strictInstanceHashes` is set and a recorded
instance hash does not match.

#### Example

```ts
const built = instantiateScene(world, sceneAsset, { scene: world.activeScene });
const player = built.remap.entity("01J9Z6M7E5S3A0V2Q4R8T1Y6WX");
```

***

### inverseLerp()

> **inverseLerp**(`a`, `b`, `value`): `number`

The inverse of [lerp](#lerp-1): finds the interpolant that maps `a`–`b` onto `value`.

#### Parameters

##### a

`number`

The value that maps to 0.

##### b

`number`

The value that maps to 1.

##### value

`number`

The value to locate.

#### Returns

`number`

The interpolant, clamped into `[0, 1]`. Returns 0 when `a` and `b` are equal.

***

### isAssetRef()

> **isAssetRef**(`value`): `value is AssetRef<unknown>`

Reports whether a value is an asset reference rather than a plain address.

#### Parameters

##### value

`unknown`

The candidate.

#### Returns

`value is AssetRef<unknown>`

`true` when the value is an object with a string `address`.

#### Example

```ts
const address = isAssetRef(input) ? input.address : input;
```

***

### isIgnifxError()

> **isIgnifxError**(`value`): `value is IgnifxError`

Narrows an unknown value — a `catch` binding, a rejected promise, a signal payload — to an
[IgnifxError](#ignifxerror).

#### Parameters

##### value

`unknown`

The value to test.

#### Returns

`value is IgnifxError`

`true` when the value is an ignifx error produced by this copy of `@ignifx/core`.

#### Example

```ts
app.onError.connect((report) => {
  if (isIgnifxError(report.error)) {
    console.warn(report.error.code, report.error.context);
  }
});
```

***

### isSceneFileHeader()

> **isSceneFileHeader**(`value`): `boolean`

Reports whether a parsed JSON value carries the `ignifx.scene` header. It is the cheap check the
loader runs before anything else, so a `.json` asset handed to the wrong loader fails with
`IGX-0308` rather than a confusing field error.

#### Parameters

##### value

`unknown`

The parsed JSON.

#### Returns

`boolean`

`true` when the value is an object whose `format` is [SCENE\_FILE\_FORMAT](#scene_file_format).

***

### isUlid()

> **isUlid**(`value`): `boolean`

Reports whether a string is a canonical ULID: 26 uppercase Crockford base32 characters whose
first character is `7` or lower, because a 48-bit timestamp cannot set the top two bits.

#### Parameters

##### value

`string`

The candidate identifier.

#### Returns

`boolean`

`true` when the string is a well-formed ULID.

#### Example

```ts
isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV"); // true
isUlid("01arz3ndektsv4rrffq69g5fav"); // false — ULIDs are canonically uppercase
```

***

### isValidErrorCode()

> **isValidErrorCode**(`code`): `` code is `IGX-${number}` ``

Reports whether a string is a well-formed ignifx error code.

#### Parameters

##### code

`string`

The candidate code.

#### Returns

`` code is `IGX-${number}` ``

`true` when the code is well formed and inside an allocated range. The signature is a
type predicate, so a validated string narrows to [ErrorCode](#errorcode) without a type assertion.

#### Remarks

The rule has exactly two parts and the `ignifx/error-code-format` lint rule mirrors it:

1. the string is `IGX-` followed by four ASCII digits, and
2. the first two digits are one of the fifteen `ErrorRange` prefixes, or the first digit is
   [THIRD\_PARTY\_ERROR\_PREFIX](#third_party_error_prefix) (the third-party block `IGX-9000`–`IGX-9999`).

#### Example

```ts
isValidErrorCode("IGX-0701"); // true  — rendering
isValidErrorCode("IGX-9042"); // true  — third party
isValidErrorCode("IGX-1601"); // false — no subsystem owns 16
```

***

### isWebGpuAvailable()

> **isWebGpuAvailable**(): `boolean`

Reports whether the current environment exposes a WebGPU entry point. This is a capability probe
only: it does not request an adapter, so it never blocks and never allocates GPU resources.
ignifx is WebGPU-only (`CONSTITUTION.md` §1.1), so this is the gate every renderer path runs first.

#### Returns

`boolean`

`true` when `navigator.gpu` is present.

#### Example

```ts
if (!isWebGpuAvailable()) {
  showWebGpuUnsupportedPage();
}
```

***

### keyboardControlNames()

> **keyboardControlNames**(): readonly `string`[]

The keyboard control names, in index order. `anyKey` is last.

#### Returns

readonly `string`[]

The control names a `<Keyboard>/…` path may end in.

#### Example

```ts
keyboardControlNames().includes("shiftLeft"); // true
```

***

### keyCodeControlNames()

> **keyCodeControlNames**(): `ReadonlyMap`\<`string`, `string`\>

The `KeyboardEvent.code` to control-name table, as a map the DOM adapter resolves through once
per event.

#### Returns

`ReadonlyMap`\<`string`, `string`\>

The lookup, built fresh so no module holds mutable state.

***

### layerMask()

> **layerMask**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<readonly `string`[]\>

Declares a set of layers. Layers are stored by *name*, not by bit value, so renaming a layer in
project settings does not silently repoint existing files
(`docs/architecture/06-serialization-and-scene-format.md` §3).

The value type is a read-only array of names in Phase 1; the kernel's `LayerMask` class arrives
with the layer registry and will satisfy the same structural shape.

#### Parameters

##### defaultValue?

readonly `string`[]

The names a new component starts with; defaults to empty.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<readonly `string`[]\>

The field definition.

#### Example

```ts
collidesWith: layerMask(["Default", "Enemy"]);
```

***

### lerp()

> **lerp**(`a`, `b`, `t`): `number`

Linearly interpolates between two values. The interpolant is **not** clamped, so values outside
`[0, 1]` extrapolate; wrap `t` in [clamp01](#clamp01) when that is not wanted.

#### Parameters

##### a

`number`

The value returned at `t === 0`.

##### b

`number`

The value returned at `t === 1`.

##### t

`number`

The interpolant.

#### Returns

`number`

The interpolated value.

#### Example

```ts
lerp(0, 10, 0.25); // 2.5
```

***

### lerpAngleDegrees()

> **lerpAngleDegrees**(`fromDegrees`, `toDegrees`, `t`): `number`

Interpolates between two angles in degrees the short way around the circle.

#### Parameters

##### fromDegrees

`number`

The angle returned at `t === 0`.

##### toDegrees

`number`

The angle approached at `t === 1`.

##### t

`number`

The interpolant; not clamped, matching [lerp](#lerp-1).

#### Returns

`number`

The interpolated angle. It is not wrapped, so feeding the result back in is stable.

#### Example

```ts
lerpAngleDegrees(350, 10, 0.5); // 360
```

***

### map()

> **map**\<`T`\>(`value`, `options?`): [`FieldDefinition`](#fielddefinition)\<`Record`\<`string`, `T`\>\>

Declares a string-keyed dictionary field. Keys are written in lexicographic order so that two
saves of the same state are byte-identical
(`docs/architecture/06-serialization-and-scene-format.md` §1).

#### Type Parameters

##### T

`T`

The entry value type, inferred from `value`.

#### Parameters

##### value

[`FieldDefinition`](#fielddefinition)\<`T`\>

The field definition every entry's value follows.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`Record`\<`string`, `T`\>\>

The field definition.

#### Example

```ts
ammo: map(i32(0)); // Record<string, number>
```

***

### mouseControlNames()

> **mouseControlNames**(): readonly `string`[]

The mouse control names, in index order.

#### Returns

readonly `string`[]

`leftButton`, `rightButton`, `middleButton`, `position`, `delta`, `scroll`.

***

### moveTowards()

> **moveTowards**(`current`, `target`, `maxDelta`): `number`

Moves a value towards a target without overshooting it.

#### Parameters

##### current

`number`

The value to move.

##### target

`number`

The value to move towards.

##### maxDelta

`number`

The largest step allowed this call; negative values move away from the target.

#### Returns

`number`

The stepped value, exactly `target` once the remaining distance fits in `maxDelta`.

#### Example

```ts
// frame-rate independent approach at 2 units per second
health = moveTowards(health, 100, 2 * time.deltaTime);
```

***

### optional()

> **optional**\<`T`\>(`inner`, `options?`): [`FieldDefinition`](#fielddefinition)\<`T` \| `null`\>

Declares a field that may also be `null`, defaulting to `null` (coding standards §5.5: `null` is
"absent value", `undefined` never reaches a file).

#### Type Parameters

##### T

`T`

The value type when present, inferred from `inner`.

#### Parameters

##### inner

[`FieldDefinition`](#fielddefinition)\<`T`\>

The field definition a non-`null` value follows.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`T` \| `null`\>

The field definition.

#### Example

```ts
nickname: optional(str()); // string | null
```

***

### parseAudioBusesFile()

> **parseAudioBusesFile**(`parsed`, `address`): readonly [`AudioBusDefinition`](#audiobusdefinition)[]

Parses and validates a `.audio.json` document.

#### Parameters

##### parsed

`unknown`

The parsed JSON.

##### address

`string`

The address it came from, for diagnostics.

#### Returns

readonly [`AudioBusDefinition`](#audiobusdefinition)[]

The buses, parents before children.

#### Throws

IgnifxError with code `IGX-1003` when the header or the `buses` array is missing,
`IGX-1004` when the format version is not readable, `IGX-1005` on a duplicate name, or
`IGX-1006` on a parent that is not declared earlier.

#### Example

```ts
const buses = parseAudioBusesFile(await ctx.fetchJson(), ctx.address);
```

***

### parseComposite()

> **parseComposite**(`name`): [`CompositeKind`](#compositekind-1)

Turns a composite name from a file into its kind.

#### Parameters

##### name

`string`

The `composite` field of a binding.

#### Returns

[`CompositeKind`](#compositekind-1)

The kind.

#### Throws

IgnifxError with code `IGX-0806` when no composite is spelled that way.

***

### parseControlPath()

> **parseControlPath**(`path`): [`ParsedControlPath`](#parsedcontrolpath)

Parses a binding path.

#### Parameters

##### path

`string`

The path, for example `<Gamepad>{1}/dpad/up`.

#### Returns

[`ParsedControlPath`](#parsedcontrolpath)

The device family, the device index, and the control name.

#### Throws

IgnifxError with code `IGX-0803` when the path is malformed or names an unknown device.

#### Example

```ts
parseControlPath("<Keyboard>/space"); // { device: "Keyboard", deviceIndex: 0, control: "space" }
```

***

### parseOverridePath()

> **parseOverridePath**(`path`): [`OverridePath`](#overridepath-1)

Parses an override path.

#### Parameters

##### path

`string`

The `path` string from the file.

#### Returns

[`OverridePath`](#overridepath-1)

The parsed path.

#### Throws

IgnifxError with code `IGX-0609` when the path does not match the grammar.

#### Example

```ts
parseOverridePath("01J…ROOT/components/01J…AI/props/aggression");
// { kind: "prop", entity: "01J…ROOT", component: "01J…AI", steps: ["aggression"] }
```

***

### parseProcessor()

> **parseProcessor**(`source`): [`Processor`](#processor)

Parses one processor string.

#### Parameters

##### source

`string`

The processor, for example `deadzone(0.15)` or `invert`.

#### Returns

[`Processor`](#processor)

The parsed processor with its parameters defaulted.

#### Throws

IgnifxError with code `IGX-0802` when the name is unknown or an argument is not a number.

#### Example

```ts
parseProcessor("scale(0.1)"); // { kind: "scale", first: 0.1, second: 0.1 }
```

***

### parseProcessors()

> **parseProcessors**(`sources`): readonly [`Processor`](#processor)[]

Parses a binding's whole processor list.

#### Parameters

##### sources

readonly `string`[]

The processor strings, in application order.

#### Returns

readonly [`Processor`](#processor)[]

The parsed chain.

#### Throws

IgnifxError with code `IGX-0802` for the first unparseable entry.

***

### parseWavHeader()

> **parseWavHeader**(`bytes`): [`WavHeader`](#wavheader) \| `null`

Reads a RIFF/WAVE header.

#### Parameters

##### bytes

`ArrayBuffer`

The whole file, or at least everything up to and including the `data` chunk header.

#### Returns

[`WavHeader`](#wavheader) \| `null`

The header, or `null` when the bytes are not a WAV this reader understands — a content
problem degrades rather than throwing (`CONSTITUTION.md` §3.9).

#### Remarks

Chunks are walked rather than assumed to be in a fixed order, because encoders routinely insert
`LIST`, `fact`, and `cue ` chunks between `fmt ` and `data`. Each chunk is padded to an even
length, which the walk honours.

#### Example

```ts
const header = parseWavHeader(await ctx.fetchBytes());
const seconds = header?.duration ?? null;
```

***

### pbrMaterialDefinition()

> **pbrMaterialDefinition**(`overrides?`): [`PbrMaterialDefinition`](#pbrmaterialdefinition-3)

Fills in a PBR declaration's defaults, so callers name only what they mean to change.

#### Parameters

##### overrides?

`Partial`\<`Omit`\<[`PbrMaterialDefinition`](#pbrmaterialdefinition-3), `"kind"`\>\>

The properties to set.

#### Returns

[`PbrMaterialDefinition`](#pbrmaterialdefinition-3)

A complete declaration.

#### Example

```ts
pbrMaterialDefinition({ name: "gold", metallic: 1, roughness: 0.25 });
```

***

### pingPong()

> **pingPong**(`t`, `length`): `number`

Bounces a value back and forth between 0 and `length`, the way a ping-pong animation behaves.

#### Parameters

##### t

`number`

The value to fold.

##### length

`number`

The positive half-period to fold into.

#### Returns

`number`

A value in `[0, length]` that rises then falls as `t` increases.

#### Example

```ts
pingPong(5, 4); // 3
```

***

### pinToDeviceSlot()

> **pinToDeviceSlot**(`definition`, `slot`, `scheme`): [`InputActionsDefinition`](#inputactionsdefinition)

Rewrites a whole document for one player: gamepad paths pinned to a slot, and — when a scheme is
named — bindings tagged with a different scheme dropped.

#### Parameters

##### definition

[`InputActionsDefinition`](#inputactionsdefinition)

The document to rewrite.

##### slot

`number`

The gamepad slot gamepad paths are pinned to.

##### scheme

`string`

The control scheme to keep, or `""` to keep every binding.

#### Returns

[`InputActionsDefinition`](#inputactionsdefinition)

A new document; the input is not modified.

#### Example

```ts
const player2 = pinToDeviceSlot(definition, 1, "Gamepad");
```

***

### quat()

> **quat**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`QuatLike`](#quatlike)\>

Declares a rotation field.

#### Parameters

##### defaultValue?

[`QuatLike`](#quatlike)

The value a new component starts with; defaults to the identity rotation.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`QuatLike`](#quatlike)\>

The field definition.

***

### radToDeg()

> **radToDeg**(`radians`): `number`

Converts an angle from radians to degrees.

#### Parameters

##### radians

`number`

The angle in radians.

#### Returns

`number`

The same angle in degrees.

***

### record()

> **record**\<`S`\>(`fields`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`FieldsOf`](#fieldsof)\<`S`\>\>

Declares a fixed group of named sub-fields. Sub-fields are serialized as a nested JSON object in
declaration order and validated recursively.

#### Type Parameters

##### S

`S` *extends* `Readonly`\<`Record`\<`string`, [`FieldDefinition`](#fielddefinition)\<`unknown`\>\>\>

The sub-schema, inferred from `fields`.

#### Parameters

##### fields

`S`

The sub-fields.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`FieldsOf`](#fieldsof)\<`S`\>\>

The field definition.

#### Example

```ts
stats: record({ hp: i32(10), armor: f32(0) }); // { hp: number; armor: number }
```

***

### repeat()

> **repeat**(`t`, `length`): `number`

Wraps a value into `[0, length)`, the way a looping animation time behaves. Unlike `%` the result
is never negative.

#### Parameters

##### t

`number`

The value to wrap.

##### length

`number`

The positive period to wrap into.

#### Returns

`number`

The wrapped value, clamped into `[0, length]` so float error cannot escape the range.

#### Example

```ts
repeat(-1, 4); // 3
```

***

### resetFrameSample()

> **resetFrameSample**(`sample`): [`FrameSample`](#framesample)

Zeroes every counter of a sample in place, reusing its `cpuMs` array.

#### Parameters

##### sample

[`FrameSample`](#framesample)

The sample to reset.

#### Returns

[`FrameSample`](#framesample)

The same sample, so it can be used as an expression.

***

### resolveGamepadRemap()

> **resolveGamepadRemap**(`snapshot`): [`GamepadRemap`](#gamepadremap) \| `null`

Picks the remap for a pad, or `null` when the standard order applies.

#### Parameters

##### snapshot

[`GamepadSnapshot`](#gamepadsnapshot)

The pad reading.

#### Returns

[`GamepadRemap`](#gamepadremap) \| `null`

The remap, or `null` for a standard pad.

#### Example

```ts
resolveGamepadRemap({ id: "Pro Controller (Nintendo)", mapping: "", buttons: [], axes: [] });
```

***

### sceneFileJsonSchema()

> **sceneFileJsonSchema**(`registry`): [`JsonObject`](#jsonobject)

The draft 2020-12 JSON Schema for a scene file, with `components[].props` narrowed per registered
component `typeId` (`docs/architecture/06-serialization-and-scene-format.md` §8). The Vite plugin
and the `ignifx schemas` CLI command emit this into `ignifx.schemas.json`, which drives
build-time validation and editor autocompletion.

#### Parameters

##### registry

[`ComponentRegistry`](#componentregistry)

The component table whose registered classes narrow `props`. Classes without a
schema contribute a `type` match with a free-form `props` object.

#### Returns

[`JsonObject`](#jsonobject)

The schema document.

#### Example

```ts
const schema = sceneFileJsonSchema(app.world.registry);
await writeFile("ignifx.schemas.json", JSON.stringify(schema, null, 2));
```

***

### serializeComponent()

> **serializeComponent**(`component`, `references?`, `onIssue?`): [`SceneFileComponent`](#scenefilecomponent)

Writes one component as a file record, for tooling and tests.

#### Parameters

##### component

[`Component`](#abstract-component)

The component to write.

##### references?

[`ReferenceEncoder`](#referenceencoder)

How entity and component references resolve to uids.

##### onIssue?

(`issue`) => `void`

Receives problems found while encoding props.

#### Returns

[`SceneFileComponent`](#scenefilecomponent)

The component record.

#### Throws

IgnifxError with code `IGX-0204` when the component's class declares no `typeId`.

#### Example

```ts
expect(serializeComponent(mover).props).toEqual({ speed: 5 });
```

***

### serializeEntity()

> **serializeEntity**(`entity`, `references?`): [`SceneFileEntity`](#scenefileentity)

Writes one entity as a file record, for tooling and tests
(`docs/architecture/06-serialization-and-scene-format.md` §5).

#### Parameters

##### entity

[`Entity`](#entity-4)

The entity to write.

##### references?

[`ReferenceEncoder`](#referenceencoder)

How entity and component references resolve to uids; by default every
reference resolves to the target's own uid, which is what an inspector wants.

#### Returns

[`SceneFileEntity`](#scenefileentity)

The entity record.

#### Remarks

The entity is written on its own: its `parent` is whatever its runtime parent's uid is, its
instanced subtree is not consulted, and references to objects outside it become `null`.

#### Example

```ts
expect(serializeEntity(player).transform.position).toEqual([0, 1, 0]);
```

***

### serializeScene()

> **serializeScene**(`source`, `options?`): [`SceneFile`](#scenefile)

Writes a scene instance, or a set of entities, as a scene file object
(`docs/architecture/06-serialization-and-scene-format.md` §5).

#### Parameters

##### source

[`SceneInstance`](#sceneinstance) \| readonly [`Entity`](#entity-4)[]

The instance to write, or the entities to write as a file's roots.

##### options?

[`SerializeSceneOptions`](#serializesceneoptions)

Flattening, naming, and the issue collector.

#### Returns

[`SceneFile`](#scenefile)

The file object.

#### Remarks

Everything about the output is fixed so that two saves of the same state are byte-identical:
entities appear in tree order, object keys in the canonical order of §1, numbers rounded by
[canonicalizeNumber](#canonicalizenumber), props in their schema's declaration order, and properties equal to
their default (`active`, `static`, `layer`, `tags`, `enabled`) omitted. Pass the result to
`stringifySceneFile` for the canonical text.

An entity that came from an `instance` entry is re-emitted as one — with overrides recomputed by
diffing its current state against the instanced scene — unless `flatten` is set.

#### Example

```ts
const text = stringifySceneFile(serializeScene(world.activeScene));
```

***

### sign()

> **sign**(`value`): `number`

The sign of a value, with zero treated as positive (matching Unity's `Mathf.Sign`, and unlike
`Math.sign`, which returns 0 and `-0`).

#### Parameters

##### value

`number`

The value to inspect.

#### Returns

`number`

`-1` for negative values, `1` for positive values and for both `0` and `-0`, and `NaN`
for `NaN`.

***

### smoothStep()

> **smoothStep**(`edge0`, `edge1`, `x`): `number`

Smoothly interpolates between two edges with a Hermite curve (the GLSL `smoothstep`), easing in
and out instead of the straight ramp of [lerp](#lerp-1).

#### Parameters

##### edge0

`number`

The value below which the result is 0.

##### edge1

`number`

The value above which the result is 1.

##### x

`number`

The value to map.

#### Returns

`number`

A value in `[0, 1]`. Degenerate edges (`edge0 === edge1`) step from 0 to 1 at the edge.

#### Example

```ts
smoothStep(0, 1, 0.5); // 0.5, but with zero slope at 0 and 1
```

***

### standardMaterialDefinition()

> **standardMaterialDefinition**(`overrides?`): [`StandardMaterialDefinition`](#standardmaterialdefinition-3)

Fills in a Standard declaration's defaults.

#### Parameters

##### overrides?

`Partial`\<`Omit`\<[`StandardMaterialDefinition`](#standardmaterialdefinition-3), `"kind"`\>\>

The properties to set.

#### Returns

[`StandardMaterialDefinition`](#standardmaterialdefinition-3)

A complete declaration.

***

### str()

> **str**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<`string`\>

Declares a string field.

#### Parameters

##### defaultValue?

`string`

The value a new component starts with.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`string`\>

The field definition.

***

### stringifySceneFile()

> **stringifySceneFile**(`file`): `string`

Writes a scene file as the canonical UTF-8 JSON text: two-space indentation, keys in the order
the serializer built them, numbers already canonicalized by
[canonicalizeNumber](#canonicalizenumber). Two saves of the same state produce byte-identical text
(`docs/architecture/06-serialization-and-scene-format.md` §1).

#### Parameters

##### file

[`SceneFile`](#scenefile)

The file object, normally from `serializeScene`.

#### Returns

`string`

The JSON text, without a trailing newline.

#### Example

```ts
stringifySceneFile(serializeScene(instance)) === stringifySceneFile(serializeScene(instance));
```

***

### toJsonSchema()

> **toJsonSchema**(`schema`): [`JsonObject`](#jsonobject)

Generates the JSON Schema (draft 2020-12) for a component's `props` object. The harness and the
Vite plugin assemble these into `ignifx.schemas.json`, which drives build-time validation and
editor autocompletion (`docs/architecture/06-serialization-and-scene-format.md` §8).

#### Parameters

##### schema

[`Schema`](#schema-14)

The schema to convert.

#### Returns

[`JsonObject`](#jsonobject)

The object fragment describing every declared prop.

***

### touchControlNames()

> **touchControlNames**(): readonly `string`[]

The touch control names, in index order.

#### Returns

readonly `string`[]

`primaryTouch/…`, `touch0/…` through `touch9/…`, and `touchCount`.

***

### u32()

> **u32**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<`number`\>

Declares an unsigned 32-bit integer field. Validation rejects fractional and negative values, and
values above 4294967295, with `IGX-0606`.

#### Parameters

##### defaultValue?

`number`

The value a new component starts with.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<`number`\>

The field definition.

***

### validateInputActions()

> **validateInputActions**(`value`, `file`): [`InputActionsDefinition`](#inputactionsdefinition)

Validates a whole `ignifx.inputactions` document.

#### Parameters

##### value

`unknown`

The parsed JSON.

##### file

`string`

The address the document came from, for error context.

#### Returns

[`InputActionsDefinition`](#inputactionsdefinition)

The validated document.

#### Throws

IgnifxError with code `IGX-0805` when the header is wrong or the shape is malformed.

#### Example

```ts
const document = validateInputActions(await ctx.fetchJson(), ctx.address);
```

***

### validateProps()

> **validateProps**(`schema`, `props`, `path?`): readonly [`SchemaIssue`](#schemaissue)[]

Checks a bag of property values against a schema. Names the schema does not declare are reported
as `IGX-0607`; names the caller omits are legal, because omitted props take schema defaults
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Parameters

##### schema

[`Schema`](#schema-14)

The schema to check against.

##### props

`Readonly`\<`Record`\<`string`, `unknown`\>\>

The values to check, keyed by field name.

##### path?

`string`

A property path prefix used when reporting issues; defaults to the empty path.

#### Returns

readonly [`SchemaIssue`](#schemaissue)[]

Every problem found, in discovery order; empty when the props are valid.

***

### validateSceneFile()

> **validateSceneFile**(`value`): readonly [`SceneFileIssue`](#scenefileissue)[]

Validates a parsed JSON value against the scene file format
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Parameters

##### value

`unknown`

The parsed JSON.

#### Returns

readonly [`SceneFileIssue`](#scenefileissue)[]

Every problem found, in discovery order; empty when the value is a valid scene file.

#### Remarks

The checks mirror [sceneFileJsonSchema](#scenefilejsonschema) clause for clause — required keys, value types,
tuple lengths, uid uniqueness, and the `parent` and override shapes — and are hand-written
because the engine ships no JSON Schema runtime and takes no dependency to gain one
(`CONSTITUTION.md` §2.3). The generated document remains the artefact the Vite plugin and editors
validate against; this is the same rule set, executable at load time.

Component `props` are *not* checked here: `decodeProps` already reports every field problem with
a schema issue code, per field, which is more precise than a document-level match.

#### Example

```ts
const issues = validateSceneFile(JSON.parse(text));
if (issues.length > 0) {
  throw new IgnifxError(CoreErrorCode.sceneFileInvalid, issues[0].message);
}
```

***

### validateValue()

> **validateValue**(`field`, `value`, `path?`): readonly [`SchemaIssue`](#schemaissue)[]

Checks one value against one field definition. Nothing is thrown: the result is data, and the
caller decides whether a problem is a development-time error or a logged diagnostic
(`CONSTITUTION.md` §3.9).

Checks performed are the value's type, finiteness for numbers, whole-number and 32-bit range for
`i32`/`u32`, `min`/`max` from the field options, enum membership, sRGB 0–1 range for colors, and
recursion into `array`, `record`, `map`, and `optional`.

#### Parameters

##### field

[`FieldDefinition`](#fielddefinition)\<`unknown`\>

The field to check against.

##### value

`unknown`

The value to check.

##### path?

`string`

A property path prefix used when reporting issues; defaults to the empty path.

#### Returns

readonly [`SchemaIssue`](#schemaissue)[]

Every problem found, in discovery order; empty when the value is valid.

#### Example

```ts
validateValue(f32(0, { min: 0 }), -1);
// [{ path: "", code: "IGX-0606", message: "-1 is below the declared minimum 0." }]
```

***

### vec2()

> **vec2**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`Vec2Like`](#vec2like)\>

Declares a 2D vector field. The runtime value type is the structural `Vec2Like`, so the engine's
`Vec2` class and plain object literals are both accepted.

#### Parameters

##### defaultValue?

[`Vec2Like`](#vec2like)

The value a new component starts with; defaults to the origin.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`Vec2Like`](#vec2like)\>

The field definition.

***

### vec3()

> **vec3**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`Vec3Like`](#vec3like)\>

Declares a 3D vector field.

#### Parameters

##### defaultValue?

[`Vec3Like`](#vec3like)

The value a new component starts with; defaults to the origin.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`Vec3Like`](#vec3like)\>

The field definition.

#### Example

```ts
offset: vec3({ x: 0, y: 1, z: 0 });
```

***

### vec4()

> **vec4**(`defaultValue?`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`Vec4Like`](#vec4like)\>

Declares a 4D vector field.

#### Parameters

##### defaultValue?

[`Vec4Like`](#vec4like)

The value a new component starts with; defaults to all zeroes.

##### options?

[`FieldOptions`](#fieldoptions)

Inspector and serializer metadata.

#### Returns

[`FieldDefinition`](#fielddefinition)\<[`Vec4Like`](#vec4like)\>

The field definition.

***

### waitFixedUpdate()

> **waitFixedUpdate**(): [`WaitInstruction`](#waitinstruction)

Waits until just after the next fixed step, so the coroutine sees the same world state a
`fixedUpdate` would.

#### Returns

[`WaitInstruction`](#waitinstruction)

The instruction to `yield`. Allocates one small object; hoist it into a field when a
loop yields it every iteration.

#### Example

```ts
push() {
  const step = waitFixedUpdate();
  for (let index = 0; index < 30; index += 1) {
    this.body.addForce(this.direction);
    yield step;
  }
}
```

***

### waitSeconds()

> **waitSeconds**(`seconds`): [`WaitInstruction`](#waitinstruction)

Waits for a number of **scaled** seconds — `time.timeScale` applies, so a slow-motion effect
slows the wait too.

#### Parameters

##### seconds

`number`

How long to wait, in seconds.

#### Returns

[`WaitInstruction`](#waitinstruction)

The instruction to `yield`. Allocates one small object.

#### Example

```ts
reload() {
  this.isReloading = true;
  yield waitSeconds(1.5);
  this.isReloading = false;
}
```

***

### waitSecondsRealtime()

> **waitSecondsRealtime**(`seconds`): [`WaitInstruction`](#waitinstruction)

Waits for a number of **unscaled** seconds — unaffected by `time.timeScale`, so a pause menu's
animations keep running while the game is frozen.

#### Parameters

##### seconds

`number`

How long to wait, in seconds of wall-clock time.

#### Returns

[`WaitInstruction`](#waitinstruction)

The instruction to `yield`. Allocates one small object.

***

### waitUntil()

> **waitUntil**(`predicate`): [`WaitInstruction`](#waitinstruction)

Waits until a predicate becomes `true`. The predicate is evaluated once per frame in the
`Update` phase, so it must be cheap and free of side effects.

#### Parameters

##### predicate

() => `boolean`

Evaluated each frame; the coroutine resumes on the first `true`.

#### Returns

[`WaitInstruction`](#waitinstruction)

The instruction to `yield`. Allocates one small object.

#### Example

```ts
yield waitUntil(() => this.door.isOpen);
```

***

### waitWhile()

> **waitWhile**(`predicate`): [`WaitInstruction`](#waitinstruction)

Waits while a predicate stays `true` — the complement of [waitUntil](#waituntil).

#### Parameters

##### predicate

() => `boolean`

Evaluated each frame; the coroutine resumes on the first `false`.

#### Returns

[`WaitInstruction`](#waitinstruction)

The instruction to `yield`. Allocates one small object.

***

### wrapAngleDegrees()

> **wrapAngleDegrees**(`degrees`): `number`

Wraps an angle in degrees into `[-180, 180)`, the range rotations are most readable in.

#### Parameters

##### degrees

`number`

The angle to wrap.

#### Returns

`number`

The equivalent angle in `[-180, 180)`; exactly `180` wraps to `-180`.

#### Example

```ts
wrapAngleDegrees(370); // 10
wrapAngleDegrees(-190); // 170
```

# @ignifx/audio

`@ignifx/audio` public barrel: the audio service and its mixer tree, `AudioSource`,
`AudioListener`, `MusicPlayer`, the `audio` and `audiobuses` assets, the two backends, and the
`audio()` extension (`docs/architecture/10-audio.md`). Explicit named re-exports only — no
`export *` (coding standards §4).

## Classes

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

> `static` **assetType**: `string` = `AUDIO_BUSES_ASSET_TYPE`

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

> `static` **assetType**: `string` = `AUDIO_ASSET_TYPE`

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

Whether [AudioClip.lite](#lite-2) carries a buffer.

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

- `Script`

#### Implements

- `ScriptCallbacks`

#### Constructors

##### Constructor

> **new AudioListener**(): [`AudioListener`](#audiolistener)

Creates a component. The engine constructs components; game code never calls `new`.

###### Returns

[`AudioListener`](#audiolistener)

###### Inherited from

`Script.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One pair of ears per entity.

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004). A listener has none: which listener is active is
decided by which one is enabled, and a scene file records that on the component itself.

##### typeId

> `static` **typeId**: `string` = `"ignifx/AudioListener"`

The registration id the serializer and the inspector know this class by.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Script.app`

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

`Script.enabled`

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

`Script.entity`

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

`Script.handle`

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

`Script.isDestroyed`

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

`Script.isEnabledInHierarchy`

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

`Script.onDestroyed`

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

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

`Script.transform`

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

`Script.uid`

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

`Script.world`

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): `ScriptDefinition`\<`S`\>

Declares a script's serialized fields and returns the base class to extend — the `Script`
counterpart of `Component.define`.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ScriptDefinition`\<`S`\>

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

`Script.define`

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

`Script.destroy`

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

`Script.getComponent`

##### onDisable()

> **onDisable**(): `void`

Hands the ears back to whichever listener was active before this one.

###### Returns

`void`

###### Implementation of

`ScriptCallbacks.onDisable`

##### onEnable()

> **onEnable**(): `void`

Becomes the active listener.

###### Returns

`void`

###### Implementation of

`ScriptCallbacks.onEnable`

##### requireComponent()

> **requireComponent**\<`T`\>(`type`): `T`

Finds another component on the same entity, requiring it to be there — the supported way to
link components (`docs/architecture/03-scripting-and-components.md` §8).

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

`Script.requireComponent`

##### startCoroutine()

> **startCoroutine**(`routine`): `CoroutineHandle`

Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
coroutine is paused while the script is not effectively enabled and cancelled when it is
destroyed.

###### Parameters

###### routine

`Coroutine`

The generator to drive. Call the generator function: `this.spawnLoop()`.

###### Returns

`CoroutineHandle`

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

`Script.startCoroutine`

##### stopAllCoroutines()

> **stopAllCoroutines**(): `void`

Stops every coroutine this script started.

###### Returns

`void`

###### Inherited from

`Script.stopAllCoroutines`

##### stopCoroutine()

> **stopCoroutine**(`handle`): `void`

Stops one coroutine this script started. Stopping a finished coroutine is a no-op.

###### Parameters

###### handle

`CoroutineHandle`

The handle [Script.startCoroutine](#startcoroutine) returned.

###### Returns

`void`

###### Inherited from

`Script.stopCoroutine`

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

> **get** **onStateChanged**(): `SignalLike`\<[`AudioServiceState`](#audioservicestate-1)\>

Emitted whenever [AudioService.state](#state-1) changes.

###### Returns

`SignalLike`\<[`AudioServiceState`](#audioservicestate-1)\>

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

`DiagnosticsGroup`

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

- `Script`

#### Implements

- `ScriptCallbacks`

#### Constructors

##### Constructor

> **new AudioSource**(): [`AudioSource`](#audiosource)

Applies the schema defaults, exactly as `Script.define` would.

###### Returns

[`AudioSource`](#audiosource)

###### Overrides

`Script.constructor`

#### Properties

##### bus

> **bus**: `string`

Which mixer bus this source routes into.

##### clip

> **clip**: `AssetHandle`\<[`AudioClip`](#audioclip)\> \| `null`

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

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### spatial

> **spatial**: `boolean`

Whether the sound is positioned in 3D instead of in the stereo field.

##### typeId

> `static` **typeId**: `string` = `"ignifx/AudioSource"`

The registration id the serializer and the inspector know this class by.

##### volume

> **volume**: `number`

The sound's own linear gain, in `[0, 1]`.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Script.app`

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

`Script.enabled`

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

`Script.entity`

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

`Script.handle`

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

###### Inherited from

`Script.isDestroyed`

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

`Script.isEnabledInHierarchy`

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

`true` while at least one instance is sounding, or waiting behind the unlock.

###### Returns

`boolean`

Whether the source is making a sound.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

`Script.onDestroyed`

##### onEnded

###### Get Signature

> **get** **onEnded**(): `SignalLike`

Emitted in `PreRender` on the frame the last instance stops sounding, whether it ran out or was
stopped (`docs/architecture/10-audio.md` §3).

###### Returns

`SignalLike`

The signal.

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

`Script.transform`

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

`Script.uid`

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

`Script.world`

#### Methods

##### awake()

> **awake**(): `void`

Starts the source when `playOnAwake` is set, after the scene's props have been decoded.

###### Returns

`void`

###### Implementation of

`ScriptCallbacks.awake`

##### define()

> `static` **define**\<`S`\>(`schema`): `ScriptDefinition`\<`S`\>

Declares a script's serialized fields and returns the base class to extend — the `Script`
counterpart of `Component.define`.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ScriptDefinition`\<`S`\>

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

`Script.define`

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

`Script.destroy`

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

`Script.getComponent`

##### onDestroy()

> **onDestroy**(): `void`

Releases the voice and its backend sound.

###### Returns

`void`

###### Implementation of

`ScriptCallbacks.onDestroy`

##### onDisable()

> **onDisable**(): `void`

Stops everything this source is playing; a disabled source makes no sound.

###### Returns

`void`

###### Implementation of

`ScriptCallbacks.onDisable`

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

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

`Script.requireComponent`

##### resume()

> **resume**(): `void`

Resumes every paused instance.

###### Returns

`void`

##### startCoroutine()

> **startCoroutine**(`routine`): `CoroutineHandle`

Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
coroutine is paused while the script is not effectively enabled and cancelled when it is
destroyed.

###### Parameters

###### routine

`Coroutine`

The generator to drive. Call the generator function: `this.spawnLoop()`.

###### Returns

`CoroutineHandle`

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

`Script.startCoroutine`

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

`Script.stopAllCoroutines`

##### stopCoroutine()

> **stopCoroutine**(`handle`): `void`

Stops one coroutine this script started. Stopping a finished coroutine is a no-op.

###### Parameters

###### handle

`CoroutineHandle`

The handle [Script.startCoroutine](#startcoroutine) returned.

###### Returns

`void`

###### Inherited from

`Script.stopCoroutine`

##### update()

> **update**(): `void`

Pushes the field changes a running sound can accept and rebuilds the voice when one it cannot
accept changed.

###### Returns

`void`

###### Implementation of

`ScriptCallbacks.update`

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

> `readonly` **kind**: [`AudioBackendKind`](#audiobackendkind-1) = `"headless"`

Which implementation this is.

###### Implementation of

[`AudioBackend`](#audiobackend).[`kind`](#kind)

##### lite

> `readonly` **lite**: [`AudioLiteHandles`](#audiolitehandles) \| `null` = `null`

There is no Lite engine behind this backend.

###### Implementation of

[`AudioBackend`](#audiobackend).[`lite`](#lite)

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

> **get** **onStateChanged**(): `SignalLike`\<[`AudioBackendState`](#audiobackendstate-1)\>

Emitted whenever the state changes.

###### Returns

`SignalLike`\<[`AudioBackendState`](#audiobackendstate-1)\>

The signal.

Emitted whenever [AudioBackend.state](#state) changes.

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

[`AudioBackend`](#audiobackend).[`state`](#state)

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

[`AudioBackend`](#audiobackend).[`dispose`](#dispose)

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

[`AudioBackend`](#audiobackend).[`pause`](#pause)

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

[`AudioBackend`](#audiobackend).[`resume`](#resume)

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

[`AudioBackend`](#audiobackend).[`stop`](#stop)

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

> **isDisposed**: `boolean` = `false`

`true` once the tree it belongs to has released it.

##### lite

> `readonly` **lite**: `null` = `null`

Lite owns nothing here, so the escape hatch is always `null`.

###### Implementation of

[`BackendBus`](#backendbus).[`lite`](#lite-4)

##### name

> `readonly` **name**: `string`

The bus name.

###### Implementation of

[`BackendBus`](#backendbus).[`name`](#name-2)

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

> **isDisposed**: `boolean` = `false`

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

- `Script`

#### Implements

- `ScriptCallbacks`

#### Constructors

##### Constructor

> **new MusicPlayer**(): [`MusicPlayer`](#musicplayer)

Applies the schema defaults, exactly as `Script.define` would.

###### Returns

[`MusicPlayer`](#musicplayer)

###### Overrides

`Script.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

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

> **playlist**: (`AssetHandle`\<[`AudioClip`](#audioclip)\> \| `null`)[]

The tracks, in the order they are played.

##### playOnAwake

> **playOnAwake**: `boolean`

Whether to start the first playlist entry as soon as the entity is alive.

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### typeId

> `static` **typeId**: `string` = `"ignifx/MusicPlayer"`

The registration id the serializer and the inspector know this class by.

##### volume

> **volume**: `number`

The gain a track fades up to, in `[0, 1]`.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Script.app`

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

`Script.enabled`

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

`Script.entity`

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

`Script.handle`

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

###### Inherited from

`Script.isDestroyed`

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

`Script.isEnabledInHierarchy`

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

Whether music is sounding.

###### Returns

`boolean`

`true` while a track is playing or waiting behind the unlock.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): `Signal`\<`Component`\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

`Signal`\<`Component`\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

###### Inherited from

`Script.onDestroyed`

##### previous

###### Get Signature

> **get** **previous**(): [`SoundInstance`](#soundinstance) \| `null`

The track that is fading out, while a crossfade is in progress.

###### Returns

[`SoundInstance`](#soundinstance) \| `null`

The outgoing sound, or `null`.

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

`Script.transform`

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

`Script.uid`

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

`Script.world`

#### Methods

##### awake()

> **awake**(): `void`

Starts the first playlist entry when `playOnAwake` is set.

###### Returns

`void`

###### Implementation of

`ScriptCallbacks.awake`

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

> `static` **define**\<`S`\>(`schema`): `ScriptDefinition`\<`S`\>

Declares a script's serialized fields and returns the base class to extend — the `Script`
counterpart of `Component.define`.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ScriptDefinition`\<`S`\>

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

`Script.define`

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

`Script.destroy`

##### getComponent()

> **getComponent**\<`T`\>(`type`): `T` \| `null`

Finds another component on the same entity — sugar for `this.entity.getComponent`.

###### Type Parameters

###### T

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class; matching is by class identity **and** inheritance.

###### Returns

`T` \| `null`

The first match in attach order, or `null`.

###### Inherited from

`Script.getComponent`

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

`ScriptCallbacks.onDestroy`

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

`T` *extends* `Component`

The component type to look for.

###### Parameters

###### type

`ComponentType`\<`T`\>

The component class.

###### Returns

`T`

The first match in attach order.

###### Throws

IgnifxError with code `IGX-0201` when the entity has no such component.

###### Inherited from

`Script.requireComponent`

##### startCoroutine()

> **startCoroutine**(`routine`): `CoroutineHandle`

Starts a coroutine owned by this script (`docs/architecture/01-lifecycle-and-time.md` §5). The
coroutine is paused while the script is not effectively enabled and cancelled when it is
destroyed.

###### Parameters

###### routine

`Coroutine`

The generator to drive. Call the generator function: `this.spawnLoop()`.

###### Returns

`CoroutineHandle`

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

`Script.startCoroutine`

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

`Script.stopAllCoroutines`

##### stopCoroutine()

> **stopCoroutine**(`handle`): `void`

Stops one coroutine this script started. Stopping a finished coroutine is a no-op.

###### Parameters

###### handle

`CoroutineHandle`

The handle [Script.startCoroutine](#startcoroutine) returned.

###### Returns

`void`

###### Inherited from

`Script.stopCoroutine`

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

[`SoundInstance`](#soundinstance).[`instanceCount`](#instancecount-3)

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

> **get** **onEnded**(): `SignalLike`

Emitted when the last instance stops sounding.

###### Returns

`SignalLike`

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

[`SoundInstance`](#soundinstance).[`pause`](#pause-3)

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

[`SoundInstance`](#soundinstance).[`resume`](#resume-3)

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

`number` = `0`

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

`number` = `0`

Seconds of frame time to fade over; `0` stops now.

###### Returns

`void`

###### Implementation of

[`SoundInstance`](#soundinstance).[`stop`](#stop-4)

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

> `readonly` **kind**: [`AudioBackendKind`](#audiobackendkind-1) = `"web"`

Which implementation this is.

###### Implementation of

[`AudioBackend`](#audiobackend).[`kind`](#kind)

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

[`AudioBackend`](#audiobackend).[`lite`](#lite)

##### onStateChanged

###### Get Signature

> **get** **onStateChanged**(): `SignalLike`\<[`AudioBackendState`](#audiobackendstate-1)\>

Emitted whenever the state changes.

###### Returns

`SignalLike`\<[`AudioBackendState`](#audiobackendstate-1)\>

The signal.

Emitted whenever [AudioBackend.state](#state) changes.

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

[`AudioBackend`](#audiobackend).[`state`](#state)

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

[`AudioBackend`](#audiobackend).[`dispose`](#dispose)

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

[`AudioBackend`](#audiobackend).[`pause`](#pause)

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

[`AudioBackend`](#audiobackend).[`resume`](#resume)

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

[`AudioBackend`](#audiobackend).[`stop`](#stop)

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

## Interfaces

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

> `readonly` **onStateChanged**: `SignalLike`\<[`AudioBackendState`](#audiobackendstate-1)\>

Emitted whenever [AudioBackend.state](#state) changes.

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

> `readonly` **app**: `App`

The app the service belongs to.

##### backend

> `readonly` **backend**: [`AudioBackend`](#audiobackend)

The backend every call is forwarded to.

##### log

> `readonly` **log**: `Logger`

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

### MusicPlayOptions

Options accepted by [MusicPlayer.play](#play-3).

#### Properties

##### fadeIn?

> `readonly` `optional` **fadeIn?**: `number`

Seconds to fade the new track up over. Defaults to no fade.

***

### MusicStopOptions

Options accepted by [MusicPlayer.stop](#stop-3).

#### Properties

##### fadeOut?

> `readonly` `optional` **fadeOut?**: `number`

Seconds to fade the current track out over. Defaults to stopping now.

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

> `readonly` **onEnded**: `SignalLike`

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

## Type Aliases

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

### LiteAudioBus

> **LiteAudioBus** = `AudioBus`

Babylon Lite's generic mixer bus (`index.d.ts` 910). Unstable escape hatch.

***

### LiteAudioEngine

> **LiteAudioEngine** = `AudioEngine`

Babylon Lite's audio engine (`index.d.ts` 926). Unstable escape hatch: excluded from the
stability guarantees of `CONSTITUTION.md` Article IV.

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

### LiteStaticSound

> **LiteStaticSound** = `StaticSound`

Babylon Lite's buffer-backed sound (`index.d.ts` 12336). Unstable escape hatch.

***

### LiteStreamingSound

> **LiteStreamingSound** = `StreamingSound`

Babylon Lite's media-element-backed sound (`index.d.ts` 12499). Unstable escape hatch.

## Variables

### audio

> `const` **audio**: (`options?`) => `Extension`

The `@ignifx/audio` extension factory.

#### Parameters

##### options?

[`AudioOptions`](#audiooptions)

Overrides for the `audio` settings section, an audio context, and the backend
factory.

#### Returns

`Extension`

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

> `readonly` **audioDisposed**: `"IGX-1010"` = `"IGX-1010"`

The audio service was used after the app had been disposed.

##### audioEngineUnavailable

> `readonly` **audioEngineUnavailable**: `"IGX-1007"` = `"IGX-1007"`

The audio engine could not be created: no Web Audio in this host.

##### clipDecodeFailed

> `readonly` **clipDecodeFailed**: `"IGX-1008"` = `"IGX-1008"`

A clip's bytes could not be decoded into playable audio.

##### duplicateBusName

> `readonly` **duplicateBusName**: `"IGX-1005"` = `"IGX-1005"`

Two buses in one tree declared the same name.

##### invalidBusFile

> `readonly` **invalidBusFile**: `"IGX-1003"` = `"IGX-1003"`

An `.audio.json` file is not an `ignifx.audiobuses` document.

##### invalidBusParent

> `readonly` **invalidBusParent**: `"IGX-1006"` = `"IGX-1006"`

A bus named a parent that is not declared, or the parent chain forms a cycle.

##### noAudioListener

> `readonly` **noAudioListener**: `"IGX-1002"` = `"IGX-1002"`

A spatial source is playing and no `AudioListener` is enabled; logged once per world.

##### streamingUnavailable

> `readonly` **streamingUnavailable**: `"IGX-1009"` = `"IGX-1009"`

A streaming clip was played on a backend that cannot stream (headless has no media element).

##### unknownBus

> `readonly` **unknownBus**: `"IGX-1001"` = `"IGX-1001"`

`app.audio.bus(name)`, or an `AudioSource.bus` field, named a bus the tree does not hold.

##### unsupportedBusFileVersion

> `readonly` **unsupportedBusFileVersion**: `"IGX-1004"` = `"IGX-1004"`

An `.audio.json` file declares a format version this build cannot read.

#### Example

```ts
throw audioError(AudioErrorCode.unknownBus, "Ambience is not a registered bus.", {
  context: { bus: "Ambience" },
});
```

***

### DEFAULT\_AUDIO\_BUSES

> `const` **DEFAULT\_AUDIO\_BUSES**: readonly `string`[]

The bus tree built when a project declares no `.audio.json`
(`docs/architecture/10-audio.md` §1). Every bus after the first routes into `"Master"`.

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

### VERSION

> `const` **VERSION**: `"0.0.0"` = `"0.0.0"`

The `@ignifx/audio` version this build was cut from.

## Functions

### audioError()

> **audioError**(`code`, `message`, `options?`): `IgnifxError`

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

`IgnifxError`

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

> **audioSettingsSchema**(): `Schema`

The schema the `audio` section is validated against.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

***

### createAudioBusesLoader()

> **createAudioBusesLoader**(): `AssetLoader`\<[`AudioBusesAsset`](#audiobusesasset)\>

Builds the loader for `.audio.json` addresses.

#### Returns

`AssetLoader`\<[`AudioBusesAsset`](#audiobusesasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createAudioBusesLoader());
```

***

### createAudioClipLoader()

> **createAudioClipLoader**(`options`): `AssetLoader`\<[`AudioClip`](#audioclip)\>

Builds the loader for audio addresses.

#### Parameters

##### options

[`AudioClipLoaderOptions`](#audiocliploaderoptions)

How to reach the app's decoder.

#### Returns

`AssetLoader`\<[`AudioClip`](#audioclip)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createAudioClipLoader({ decoder: () => service.decoder() }));
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

### defaultAudioSettings()

> **defaultAudioSettings**(): [`AudioSettings`](#audiosettings)

The values used for everything a project omits.

#### Returns

[`AudioSettings`](#audiosettings)

The default `audio` section.

***

### describeAudioBusesFormat()

> **describeAudioBusesFormat**(): `SchemaDescription`

Describes the `ignifx.audiobuses` file format for the documentation harness
(`docs/architecture/16-docs-harness-and-skill.md` §3).

#### Returns

`SchemaDescription`

The description of the file's fields.

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component and file format this package declares, for the documentation harness.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The records, keyed by namespaced type id.

#### Example

```ts
describeSchemas()["ignifx/AudioSource"].fields["maxInstances"].default; // 8
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

# @ignifx/particles

Stateless GPU particles: the `ParticleSystem` component, `.particles.json` definitions and
presets, `app.particles`, and the CPU evaluator `@ignifx/particles-2d` shares
(`docs/plan/2026-09-terrain-particles-shaders.md` §4). Nothing here imports `@babylonjs/lite`.

## Classes

### EmitterRandom

**`Beta`**

A deterministic stream of unit floats for the emission scheduler, drawn from `pcg3d` over a
counter so two systems with the same seed and the same frame deltas roll the same numbers.

#### Constructors

##### Constructor

> **new EmitterRandom**(`seed`): [`EmitterRandom`](#emitterrandom)

**`Beta`**

Creates a stream.

###### Parameters

###### seed

`number`

The seed to start from.

###### Returns

[`EmitterRandom`](#emitterrandom)

#### Accessors

##### seed

###### Get Signature

> **get** **seed**(): `number`

**`Beta`**

The seed the stream runs on.

###### Returns

`number`

The seed.

#### Methods

##### next()

> **next**(): `number`

**`Beta`**

The next unit float in `[0, 1)`.

###### Returns

`number`

The number.

##### reseed()

> **reseed**(`seed`): `void`

**`Beta`**

Restarts the stream from a seed.

###### Parameters

###### seed

`number`

The new seed.

###### Returns

`void`

***

### MeshShapeTable

**`Beta`**

Precomputed data a `"mesh"` shape samples from: the cumulative area of its triangles.

#### Constructors

##### Constructor

> **new MeshShapeTable**(`vertices`): [`MeshShapeTable`](#meshshapetable)

**`Beta`**

Builds the table.

###### Parameters

###### vertices

`Float32Array`

Nine floats per triangle.

###### Returns

[`MeshShapeTable`](#meshshapetable)

#### Properties

##### cumulative

> `readonly` **cumulative**: `Float32Array`

**`Beta`**

Cumulative areas, one per triangle, ending at the total.

##### vertices

> `readonly` **vertices**: `Float32Array`

**`Beta`**

The triangle soup, nine floats per triangle.

#### Accessors

##### area

###### Get Signature

> **get** **area**(): `number`

**`Beta`**

The total surface area.

###### Returns

`number`

The area.

***

### ParticleAsset

A parsed particle document.

#### Example

```ts
const handle = app.assets.load<ParticleAsset>("fx/fire.particles.json").retain();
await handle.promise;
handle.value.definition.main.capacity; // 1000
```

#### Properties

##### address

> `readonly` **address**: `string`

Where the document was loaded from, or the `memory:` address it was published at.

##### assetType

> `static` **assetType**: `string` = `PARTICLE_ASSET_TYPE`

The asset type name, so `assetRef` and the inspector can round-trip a reference.

##### definition

> `readonly` **definition**: [`ParticleDefinition`](#particledefinition-3)

The parsed, baked document.

##### texture

> `readonly` **texture**: `AssetHandle`\<`TextureAsset`\> \| `null`

The texture the renderer samples, or `null` for the procedural soft disc.

#### Methods

##### dispose()

> **dispose**(): `void`

Releases what the asset holds beyond its data. The `particles` asset type's `unload` runs it
when the last holder releases the handle.

###### Returns

`void`

***

### ParticleEmitterCore

**`Beta`**

The CPU half of a particle system: the spawn-record ring, the system clock, the seeded random
stream, and the emission scheduler.

#### Example

```ts
const core = new ParticleEmitterCore({ definition, capacity: 1000, seed: 7 });
core.play();
core.advance(1 / 60);
core.reconcile();
```

#### Constructors

##### Constructor

> **new ParticleEmitterCore**(`options`): [`ParticleEmitterCore`](#particleemittercore)

**`Beta`**

Creates the core.

###### Parameters

###### options

[`ParticleEmitterCoreOptions`](#particleemittercoreoptions)

The definition, the clamped capacity, and the seed.

###### Returns

[`ParticleEmitterCore`](#particleemittercore)

#### Properties

##### definition

> `readonly` **definition**: [`ParticleDefinition`](#particledefinition-3)

**`Beta`**

The definition every record is written from.

##### emitterWorld

> `readonly` **emitterWorld**: `Float32Array`

**`Beta`**

The emitter's world matrix, column-major; write it before [ParticleEmitterCore.advance](#advance).
A `"world"` definition bakes it into every record, and `rateOverDistance` reads its translation.

##### onStopped

> **onStopped**: (() => `void`) \| `null` = `null`

**`Beta`**

Called once when a non-looping system runs out of cycle and particles.

##### qualityScale

> **qualityScale**: `number` = `1`

**`Beta`**

A `0`–`1` multiplier on rates and burst counts; the app's `qualityScale`.

##### ring

> `readonly` **ring**: [`SpawnRecordRing`](#spawnrecordring)

**`Beta`**

The spawn records.

#### Accessors

##### aliveCount

###### Get Signature

> **get** **aliveCount**(): `number`

**`Beta`**

How many particles are alive, as of the last [ParticleEmitterCore.reconcile](#reconcile).

###### Returns

`number`

The exact count.

##### drawCount

###### Get Signature

> **get** **drawCount**(): `number`

**`Beta`**

How many records the GPU draws, newest first: from the newest back to the oldest still alive.

###### Returns

`number`

The draw count.

##### droppedTotal

###### Get Signature

> **get** **droppedTotal**(): `number`

**`Beta`**

How many spawns landed on a slot whose particle was still alive, so that older particle
vanished. It is what "over budget" looks like from inside a system: the capacity the app's
`maxParticles` granted is smaller than `rate × lifetime`.

###### Returns

`number`

The total since the last `play()` from an empty ring.

##### emittedTotal

###### Get Signature

> **get** **emittedTotal**(): `number`

**`Beta`**

How many particles have been emitted since the last `play()` from an empty ring.

###### Returns

`number`

The total.

##### isEmitting

###### Get Signature

> **get** **isEmitting**(): `boolean`

**`Beta`**

Whether the current cycle still emits.

###### Returns

`boolean`

`true` while emission runs.

##### isPaused

###### Get Signature

> **get** **isPaused**(): `boolean`

**`Beta`**

Whether the clock is held.

###### Returns

`boolean`

`true` after `pause()`.

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

**`Beta`**

Whether the system is playing, paused or not.

###### Returns

`boolean`

`true` between `play()` and the stop.

##### seed

###### Get Signature

> **get** **seed**(): `number`

**`Beta`**

The seed in use: the declared one, or the random one `play()` picked for a declared `0`.

###### Returns

`number`

The seed.

##### time

###### Get Signature

> **get** **time**(): `number`

**`Beta`**

The system clock, in seconds: what every record's age is measured against.

###### Returns

`number`

The clock.

#### Methods

##### advance()

> **advance**(`dt`): `void`

**`Beta`**

Advances one frame. It does nothing while paused, and nothing once a stopped system's last
particle has died.

###### Parameters

###### dt

`number`

The frame's scaled seconds; the definition's own `timeScale` is applied here.

###### Returns

`void`

##### emit()

> **emit**(`count`): `void`

**`Beta`**

Spawns particles now, at the current clock, whether or not the system is playing.

###### Parameters

###### count

`number`

How many; a non-integer is floored, and `qualityScale` does not apply.

###### Returns

`void`

##### pause()

> **pause**(): `void`

**`Beta`**

Holds the clock; emission and ageing stop until [ParticleEmitterCore.resume](#resume).

###### Returns

`void`

##### play()

> **play**(): `void`

**`Beta`**

Starts, or resumes after a `stop()`, emission. On an empty ring the clock restarts at zero and
a `prewarm` definition fast-forwards one cycle; otherwise the clock keeps counting.

###### Returns

`void`

##### reconcile()

> **reconcile**(): [`RingCensus`](#ringcensus)

**`Beta`**

Recounts the ring at the current clock and fires `onStopped` once a non-looping system has
nothing left to do.

###### Returns

[`RingCensus`](#ringcensus)

The census.

##### resume()

> **resume**(): `void`

**`Beta`**

Releases a `pause()`.

###### Returns

`void`

##### simulate()

> **simulate**(`seconds`): `void`

**`Beta`**

Fast-forwards the system by `seconds` in fixed sub-steps, emitting as it goes — what `prewarm`
does, and what a test does to reach a known state. The definition's `timeScale` does not apply.

###### Parameters

###### seconds

`number`

How far to advance the system clock.

###### Returns

`void`

##### stop()

> **stop**(`options?`): `void`

**`Beta`**

Stops emission. Live particles keep ageing until they die unless `clear` is set.

###### Parameters

###### options?

[`ParticleStopOptions`](#particlestopoptions)

Whether to clear the particles too.

###### Returns

`void`

***

### ParticleRenderSystem

**`Beta`**

Uploads every system's new records, writes its uniforms, bounds its draw count, and publishes the
`particles` counters. Runs in `PreRender` before core's render sync.

#### Implements

- `System`

#### Constructors

##### Constructor

> **new ParticleRenderSystem**(`service`): [`ParticleRenderSystem`](#particlerendersystem)

**`Beta`**

Creates the system.

###### Parameters

###### service

[`ParticlesService`](#particlesservice)

The service whose list it walks.

###### Returns

[`ParticleRenderSystem`](#particlerendersystem)

#### Properties

##### name

> `readonly` **name**: `string` = `"ignifx/particles-render"`

**`Beta`**

The name diagnostics and error reports use.

###### Implementation of

`System.name`

#### Methods

##### update()

> **update**(): `void`

**`Beta`**

Runs the upload for one frame.

###### Returns

`void`

###### Implementation of

`System.update`

***

### ParticlesService

The particles service, reached as `app.particles`.

#### Example

```ts
app.particles.qualityScale = 0.5; // half the emission everywhere, for a low setting
app.particles.systems.length; // how many ParticleSystem components are attached
```

#### Constructors

##### Constructor

> **new ParticlesService**(`app`, `settings`): [`ParticlesService`](#particlesservice)

Creates the service.

###### Parameters

###### app

`App`

The app it belongs to.

###### settings

[`ParticlesSettings`](#particlessettings)

The resolved `particles` section, options already merged.

###### Returns

[`ParticlesService`](#particlesservice)

#### Properties

##### maxParticles

> **maxParticles**: `number`

The budget every attached system's capacity is counted against. Raising it takes effect for
systems attached afterwards.

##### qualityScale

> **qualityScale**: `number`

A `0`–`1` multiplier on every rate and burst count, read each frame.

#### Accessors

##### capacityInUse

###### Get Signature

> **get** **capacityInUse**(): `number`

How much of the budget attached systems hold.

###### Returns

`number`

The sum of every attached system's capacity.

##### counters

###### Get Signature

> **get** **counters**(): `DiagnosticsGroup` \| `null`

The `particles` diagnostics group, once the extension registered it.

###### Returns

`DiagnosticsGroup` \| `null`

The group, or `null` before registration.

##### gravity

###### Get Signature

> **get** **gravity**(): `Vec3Like`

The world gravity a definition's `gravityMultiplier` scales, in metres per second squared.

###### Returns

`Vec3Like`

The service's own vector; assign to replace it.

###### Set Signature

> **set** **gravity**(`value`): `void`

Copies a new world gravity in, so the caller's object is not retained.

###### Parameters

###### value

`Vec3Like`

The gravity to copy.

###### Returns

`void`

##### systems

###### Get Signature

> **get** **systems**(): readonly [`ParticleSystem`](#particlesystem)[]

Every attached `ParticleSystem`, in attach order.

###### Returns

readonly [`ParticleSystem`](#particlesystem)[]

The live list; iterate it without copying.

#### Methods

##### dispose()

> **dispose**(): `void`

Releases every shared resource. The extension calls it on dispose.

###### Returns

`void`

##### release()

> **release**(`granted`): `void`

**`Beta`**

Gives capacity back to the budget.

###### Parameters

###### granted

`number`

What [ParticlesService.reserve](#reserve) returned.

###### Returns

`void`

##### reserve()

> **reserve**(`entity`, `requested`): `number`

**`Beta`**

Takes capacity out of the budget, clamping to what is left and logging `IGX-1702` when it had
to. Every renderer that spends the particle budget goes through here, `@ignifx/particles-2d`
included; pair each call with [ParticlesService.release](#release).

###### Parameters

###### entity

`string`

The entity's name, for the warning.

###### requested

`number`

The definition's capacity, in records.

###### Returns

`number`

The capacity granted, at least one record.

***

### ParticleSystem

Draws a particle effect on its entity.

#### Example

```ts
const fire = particleAssetFromDefinition(app, particleDefinition("fire"));
const system = campfire.addComponent(ParticleSystem, { definition: fire });
system.emit(50);
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new ParticleSystem**(): [`ParticleSystem`](#particlesystem)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`ParticleSystem`](#particlesystem)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several effects may share one entity; each owns its own renderer.

##### definition

> **definition**: `AssetHandle`\<[`ParticleAsset`](#particleasset)\> \| `null`

The `.particles.json`, as a loaded handle.

##### onStopped

> `readonly` **onStopped**: `Signal`\<[`ParticleSystem`](#particlesystem)\>

Emitted once when a non-looping system runs out of cycle and particles.

##### playOnAwake

> **playOnAwake**: `boolean`

Whether the system plays the first frame it is enabled; the definition's `playOnAwake` must agree.

##### schema

> `static` **schema**: `Schema`

The declarative fields (ADR-0004).

##### seed

> **seed**: `number`

The emission seed; `0` uses the definition's, and a definition seed of `0` picks at random.

##### typeId

> `static` **typeId**: `string` = `"ignifx/ParticleSystem"`

The registration id the serializer writes into scene files.

#### Accessors

##### aliveCount

###### Get Signature

> **get** **aliveCount**(): `number`

How many particles are alive, exactly, as of the last frame.

###### Returns

`number`

The count.

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Component.app`

##### asset

###### Get Signature

> **get** **asset**(): [`ParticleAsset`](#particleasset) \| `null`

The loaded document, or `null` while the handle is loading or unset.

###### Returns

[`ParticleAsset`](#particleasset) \| `null`

The asset.

##### capacity

###### Get Signature

> **get** **capacity**(): `number`

The ring capacity in use, after the app's budget clamped the definition's.

###### Returns

`number`

The capacity, or `0` before a definition is applied.

##### drawCount

###### Get Signature

> **get** **drawCount**(): `number`

How many records the GPU draws this frame: from the newest back to the oldest still alive.

###### Returns

`number`

The draw count.

##### droppedCount

###### Get Signature

> **get** **droppedCount**(): `number`

How many spawns displaced a particle that was still alive, because the capacity the app's
`maxParticles` budget granted is smaller than the definition's rate times its lifetime.

###### Returns

`number`

The total since the system last started from empty.

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

`Component.enabled`

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

`Component.entity`

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

`Component.handle`

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

`Component.isDestroyed`

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

`Component.isEnabledInHierarchy`

##### isPaused

###### Get Signature

> **get** **isPaused**(): `boolean`

Whether the clock is held by `pause()`.

###### Returns

`boolean`

`true` while paused.

##### isPlaying

###### Get Signature

> **get** **isPlaying**(): `boolean`

Whether the system is playing, paused or not.

###### Returns

`boolean`

`true` between `play()` and the stop.

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

`Component.onDestroyed`

##### records

###### Get Signature

> **get** **records**(): `Float32Array`\<`ArrayBufferLike`\> \| `null`

**`Beta`**

The CPU mirror of the spawn records: `capacity * 12` floats, one 48-byte record per slot, in
the layout `src/emitter/record-ring.ts` documents. Read-only; for tests and tools.

###### Returns

`Float32Array`\<`ArrayBufferLike`\> \| `null`

The mirror, or `null` before a definition is applied.

##### time

###### Get Signature

> **get** **time**(): `number`

The system-local clock, in seconds — what every particle's age is measured against and what the
shader reads as `clock`.

###### Returns

`number`

The clock.

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

`Component.transform`

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

`Component.uid`

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

`Component.world`

#### Methods

##### define()

> `static` **define**\<`S`\>(`schema`): `ComponentDefinition`\<`S`\>

Declares a component's serialized fields and returns the base class to extend (ADR-0004,
`docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
as a typed instance property, applies the defaults in its constructor, and carries the schema
for the serializer, the inspector, and the docs harness.

###### Type Parameters

###### S

`S` *extends* `Readonly`\<`Record`\<`string`, `FieldDefinition`\<`unknown`\>\>\>

The schema being declared.

###### Parameters

###### schema

`S`

The field definitions, keyed by the property name they become.

###### Returns

`ComponentDefinition`\<`S`\>

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

`Component.define`

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

`Component.destroy`

##### emit()

> **emit**(`count`): `void`

Spawns particles now, at the current clock, whether or not the system is playing. Called from a
script's `update`, they are drawn in the same frame.

###### Parameters

###### count

`number`

How many; floored.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-1707` for a negative or non-finite count, or `IGX-1705`
when no definition is applied.

##### evaluate()

> **evaluate**(`slot`, `out?`): `boolean`

**`Beta`**

Evaluates one spawn record at the current clock with the CPU evaluator, in world space — the
same arithmetic the shader runs, for tests and tools.

###### Parameters

###### slot

`number`

The record's slot in the ring.

###### out?

[`ParticleState`](#particlestate) = `...`

Receives the state; allocate one with `createParticleState()`.

###### Returns

`boolean`

`true` when the record is alive.

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

`Component.getComponent`

##### onAttach()

> **onAttach**(): `void`

Joins the service's live list.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Releases the GPU side, the budget, and the shared resources.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### pause()

> **pause**(): `void`

Holds the clock; every particle freezes in place.

###### Returns

`void`

##### play()

> **play**(): `void`

Starts emitting, or resumes after `stop()`. A `prewarm` definition fast-forwards one cycle.

###### Returns

`void`

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

`Component.requireComponent`

##### resume()

> **resume**(): `void`

Releases `pause()`.

###### Returns

`void`

##### simulate()

> **simulate**(`seconds`): `void`

Fast-forwards the system by `seconds`, emitting as it goes — what `prewarm` does.

###### Parameters

###### seconds

`number`

How far to advance.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-1707` for a negative or non-finite duration, or `IGX-1705`
when no definition is applied.

##### stop()

> **stop**(`options?`): `void`

Stops emitting. Live particles finish their lives unless `clear` is set.

###### Parameters

###### options?

[`ParticleStopOptions`](#particlestopoptions)

Whether to clear the particles too.

###### Returns

`void`

***

### ParticleUpdateSystem

**`Beta`**

Advances every system's emitter core by the frame's scaled delta, or by nothing while the app is
paused. Runs late in `Update` so a script's `emit()` is drawn in the same frame.

#### Implements

- `System`

#### Constructors

##### Constructor

> **new ParticleUpdateSystem**(`service`): [`ParticleUpdateSystem`](#particleupdatesystem)

**`Beta`**

Creates the system.

###### Parameters

###### service

[`ParticlesService`](#particlesservice)

The service whose list it walks.

###### Returns

[`ParticleUpdateSystem`](#particleupdatesystem)

#### Properties

##### name

> `readonly` **name**: `string` = `"ignifx/particles-update"`

**`Beta`**

The name diagnostics and error reports use.

###### Implementation of

`System.name`

#### Methods

##### update()

> **update**(`ctx`): `void`

**`Beta`**

Runs emission for one frame.

###### Parameters

###### ctx

`SystemContext`

The world, the clock, the phase, and the frame delta.

###### Returns

`void`

###### Implementation of

`System.update`

***

### SpawnRecordRing

**`Beta`**

The CPU copy of a system's spawn records. Record `n` lives in slot `n % capacity`, so the newest
record is the one the shader draws first and an overwritten record simply disappears.

#### Constructors

##### Constructor

> **new SpawnRecordRing**(`capacity`): [`SpawnRecordRing`](#spawnrecordring)

**`Beta`**

Allocates a ring.

###### Parameters

###### capacity

`number`

How many records it holds; at least one.

###### Returns

[`SpawnRecordRing`](#spawnrecordring)

#### Properties

##### capacity

> `readonly` **capacity**: `number`

**`Beta`**

How many records the ring holds.

##### floats

> `readonly` **floats**: `Float32Array`

**`Beta`**

The records as floats, `capacity * RECORD_FLOATS` long.

##### words

> `readonly` **words**: `Uint32Array`

**`Beta`**

The same bytes as words, for `seed` and `flags`.

#### Accessors

##### head

###### Get Signature

> **get** **head**(): `number`

**`Beta`**

The slot the next record goes into.

###### Returns

`number`

`written % capacity`.

##### pendingCount

###### Get Signature

> **get** **pendingCount**(): `number`

**`Beta`**

How many records have been written and not yet uploaded, capped at the capacity because older
ones were overwritten anyway.

###### Returns

`number`

The pending count.

##### tail

###### Get Signature

> **get** **tail**(): `number`

**`Beta`**

The index of the oldest record still inside the draw window.

###### Returns

`number`

The record index, not the slot.

##### written

###### Get Signature

> **get** **written**(): `number`

**`Beta`**

How many records have been written since the last clear.

###### Returns

`number`

The count; it never decreases except through [SpawnRecordRing.clear](#clear-1).

#### Methods

##### clear()

> **clear**(): `void`

**`Beta`**

Forgets every record, so the next frame draws nothing and uploads nothing.

###### Returns

`void`

##### markUploaded()

> **markUploaded**(): `void`

**`Beta`**

Records that everything written so far has reached the GPU.

###### Returns

`void`

##### pendingRanges()

> **pendingRanges**(`out`): `number`

**`Beta`**

The runs of slots written since the last upload, at most two because a ring wraps at most once
per frame that matters — anything older than a whole ring was overwritten.

###### Parameters

###### out

\[[`UploadRange`](#uploadrange), [`UploadRange`](#uploadrange)\]

Receives up to two ranges.

###### Returns

`number`

How many of `out`'s entries are meaningful: `0`, `1`, or `2`.

##### reconcile()

> **reconcile**(`clock`, `out`): [`RingCensus`](#ringcensus)

**`Beta`**

Advances the tail past leading dead records and counts the alive ones behind it. One pass over
the draw window, no allocation.

###### Parameters

###### clock

`number`

The system clock.

###### out

[`RingCensus`](#ringcensus)

Receives the counts.

###### Returns

[`RingCensus`](#ringcensus)

`out`.

##### slotOf()

> **slotOf**(`index`): `number`

**`Beta`**

The slot of a record.

###### Parameters

###### index

`number`

The record index.

###### Returns

`number`

The slot.

##### write()

> **write**(`spawnTime`, `lifetime`, `seed`, `flags`, `px`, `py`, `pz`, `size`, `vx`, `vy`, `vz`, `rotation`): `number`

**`Beta`**

Writes one record and returns its slot.

###### Parameters

###### spawnTime

`number`

The system clock at spawn.

###### lifetime

`number`

Seconds the particle lives.

###### seed

`number`

The per-record hash seed.

###### flags

`number`

Reserved; write `0`.

###### px

`number`

Start position X.

###### py

`number`

Start position Y.

###### pz

`number`

Start position Z.

###### size

`number`

Start size.

###### vx

`number`

Start velocity X.

###### vy

`number`

Start velocity Y.

###### vz

`number`

Start velocity Z.

###### rotation

`number`

Start rotation, in radians.

###### Returns

`number`

The slot written.

## Interfaces

### LookupRow

One row of the lookup texture: which row it is and how its bytes map back to values.

#### Properties

##### index

> `readonly` **index**: `number`

The row index in the texture.

##### max

> `readonly` **max**: `number`

The value a byte of `255` decodes to.

##### min

> `readonly` **min**: `number`

The value a byte of `0` decodes to.

***

### ParticleBurst

One burst: `count` particles at `time` into the cycle, repeated `cycles` times every `interval`
seconds with `probability`.

#### Properties

##### count

> `readonly` **count**: [`ScalarValue`](#scalarvalue)

How many particles; a random count is rolled per firing.

##### cycles

> `readonly` **cycles**: `number`

How many times the burst fires per cycle; `0` means until the cycle ends.

##### interval

> `readonly` **interval**: `number`

Seconds between firings.

##### probability

> `readonly` **probability**: `number`

The chance a firing happens, `0`–`1`.

##### time

> `readonly` **time**: `number`

Seconds into the cycle.

***

### ParticleBurstInput

One burst as authored.

#### Properties

##### count?

> `readonly` `optional` **count?**: [`ScalarValueInput`](#scalarvalueinput)

How many particles. Defaults to `10`.

##### cycles?

> `readonly` `optional` **cycles?**: `number`

Firings per cycle; `0` means until the cycle ends. Defaults to `1`.

##### interval?

> `readonly` `optional` **interval?**: `number`

Seconds between firings. Defaults to `0.1`.

##### probability?

> `readonly` `optional` **probability?**: `number`

The chance a firing happens. Defaults to `1`.

##### time?

> `readonly` `optional` **time?**: `number`

Seconds into the cycle. Defaults to `0`.

***

### ParticleDefinition

The parsed and baked `.particles.json` document.

#### Properties

##### emission

> `readonly` **emission**: [`ParticleEmission`](#particleemission)

Rates and bursts.

##### forces

> `readonly` **forces**: [`ParticleForces`](#particleforces)

What acts on it.

##### format

> `readonly` **format**: `"ignifx.particles"`

Always `"ignifx.particles"`.

##### formatVersion

> `readonly` **formatVersion**: `number`

Always `1` in this build.

##### lookup

> `readonly` **lookup**: [`ParticleLookup`](#particlelookup)

The baked lookup texture.

##### main

> `readonly` **main**: [`ParticleMain`](#particlemain)

Capacity, timing, space, and playback.

##### overLifetime

> `readonly` **overLifetime**: [`ParticleOverLifetime`](#particleoverlifetime)

How it changes over its life.

##### renderer

> `readonly` **renderer**: [`ParticleRenderer`](#particlerenderer)

How it is drawn.

##### shape

> `readonly` **shape**: [`ParticleShape`](#particleshape)

Where particles start and which way they go.

##### start

> `readonly` **start**: [`ParticleStart`](#particlestart)

What a particle is born with.

***

### ParticleDefinitionInput

What [defineParticles](#defineparticles) accepts: the document as authored, every key optional. Unknown keys
are reported, because a misspelled module silently doing nothing is the worst outcome for an
effect file.

#### Properties

##### emission?

> `readonly` `optional` **emission?**: [`ParticleEmissionInput`](#particleemissioninput)

The `emission` module.

##### forces?

> `readonly` `optional` **forces?**: [`ParticleForcesInput`](#particleforcesinput)

The `forces` module.

##### format?

> `readonly` `optional` **format?**: `string`

Always `"ignifx.particles"` when present.

##### formatVersion?

> `readonly` `optional` **formatVersion?**: `number`

The document version.

##### main?

> `readonly` `optional` **main?**: [`ParticleMainInput`](#particlemaininput)

The `main` module.

##### overLifetime?

> `readonly` `optional` **overLifetime?**: [`ParticleOverLifetimeInput`](#particleoverlifetimeinput)

The `overLifetime` module.

##### renderer?

> `readonly` `optional` **renderer?**: [`ParticleRendererInput`](#particlerendererinput)

The `renderer` module.

##### shape?

> `readonly` `optional` **shape?**: [`ParticleShapeInput`](#particleshapeinput)

The `shape` module.

##### start?

> `readonly` `optional` **start?**: [`ParticleStartInput`](#particlestartinput)

The `start` module.

***

### ParticleDefinitionResources

The GPU-facing resources one definition's systems share.

#### Properties

##### lut

> `readonly` **lut**: `AssetHandle`\<`TextureAsset`\>

The baked lookup texture.

##### materialDefinition

> `readonly` **materialDefinition**: `ShaderMaterialDefinition`

The material every system builds its own copy from.

##### mesh

> `readonly` **mesh**: `AssetHandle`\<`MeshAsset`\>

The quad, or the primitive a `"mesh"` renderer draws.

##### shader

> `readonly` **shader**: `AssetHandle`\<`ShaderAsset`\>

The program's asset, loading until the shader adapter is in place.

##### sheet

> `readonly` **sheet**: `AssetHandle`\<`TextureAsset`\> \| `null`

The renderer's texture, or `null` for the procedural disc.

##### source

> `readonly` **source**: `string`

The generated program.

##### textures

> `readonly` **textures**: readonly `AssetHandle`\<`TextureAsset`\>[]

The texture handles in the order `materialDefinition.textures` names them.

***

### ParticleEmission

The `emission` module.

#### Properties

##### bursts

> `readonly` **bursts**: readonly [`ParticleBurst`](#particleburst)[]

The bursts, in declaration order.

##### rateOverDistance

> `readonly` **rateOverDistance**: `number`

Particles per metre the emitter moves.

##### rateOverTime

> `readonly` **rateOverTime**: `number`

Particles per second while the cycle runs.

***

### ParticleEmissionInput

The `emission` module as authored.

#### Properties

##### bursts?

> `readonly` `optional` **bursts?**: readonly [`ParticleBurstInput`](#particleburstinput)[]

The bursts. Defaults to none.

##### rateOverDistance?

> `readonly` `optional` **rateOverDistance?**: `number`

Particles per metre moved. Defaults to `0`.

##### rateOverTime?

> `readonly` `optional` **rateOverTime?**: `number`

Particles per second. Defaults to `10`.

***

### ParticleEmitterCoreOptions

**`Beta`**

How [ParticleEmitterCore](#particleemittercore) is built.

#### Properties

##### capacity

> `readonly` **capacity**: `number`

**`Beta`**

The ring capacity, after the app's budget clamped it.

##### definition

> `readonly` **definition**: [`ParticleDefinition`](#particledefinition-3)

**`Beta`**

The definition to emit.

##### seed

> `readonly` **seed**: `number`

**`Beta`**

The seed; `0` picks a random one on `play()`.

***

### ParticleEvaluationInputs

**`Beta`**

The per-system inputs the evaluator needs beyond the definition.

#### Properties

##### definition

> `readonly` **definition**: [`ParticleDefinition`](#particledefinition-3)

**`Beta`**

The definition every record was written from.

##### emitterWorld

> `readonly` **emitterWorld**: `Float32Array`

**`Beta`**

The emitter's current world matrix, for a `"local"` definition; ignored for `"world"`.

##### gravity

> `readonly` **gravity**: `Float32Array`

**`Beta`**

The effective gravity plus constant force, in the simulation space.

##### orbitCenter

> `readonly` **orbitCenter**: `Float32Array`

**`Beta`**

The orbit centre in the simulation space: the origin for `"local"`, the emitter's position for `"world"`.

***

### ParticleForces

The `forces` module.

#### Properties

##### constantForce

> `readonly` **constantForce**: `Vec3Like`

A constant acceleration, in metres per second squared, folded into gravity.

##### drag

> `readonly` **drag**: `number`

Linear drag; `0` is none.

##### gravity

> `readonly` **gravity**: `Vec3Like` \| `null`

An explicit world gravity, or `null` to use `gravityMultiplier` times the app's gravity.

##### gravityMultiplier

> `readonly` **gravityMultiplier**: `number`

How much of the app's gravity applies when `gravity` is `null`.

##### noise

> `readonly` **noise**: [`ParticleNoise`](#particlenoise) \| `null`

A noise offset, or `null`.

##### orbit

> `readonly` **orbit**: [`ParticleOrbit`](#particleorbit) \| `null`

A rotation about an axis, or `null`.

***

### ParticleForcesInput

The `forces` module as authored.

#### Properties

##### constantForce?

> `readonly` `optional` **constantForce?**: `Vec3Like`

Defaults to `(0, 0, 0)`.

##### drag?

> `readonly` `optional` **drag?**: `number`

Defaults to `0`.

##### gravity?

> `readonly` `optional` **gravity?**: `Vec3Like` \| `null`

An explicit gravity, or `null`/omitted to scale the app's.

##### gravityMultiplier?

> `readonly` `optional` **gravityMultiplier?**: `number`

Defaults to `0`.

##### noise?

> `readonly` `optional` **noise?**: \{ `frequency?`: `number`; `influenceOverLife?`: [`ScalarValueInput`](#scalarvalueinput); `octaves?`: `number`; `scroll?`: `Vec3Like`; `strength?`: `number`; \} \| `null`

Defaults to none.

##### orbit?

> `readonly` `optional` **orbit?**: \{ `axis?`: `Vec3Like`; `speed?`: `number`; \} \| `null`

Defaults to none.

***

### ParticleLookup

The baked lookup texture both evaluators sample: [LOOKUP\_SAMPLES](#lookup_samples) texels wide, RGBA8, one
row per curve or gradient the definition uses, in the order colour, size, rotation, noise
influence, sheet frame. The GPU reads the bytes the CPU decodes, to the filter's precision.

#### Properties

##### color

> `readonly` **color**: [`LookupRow`](#lookuprow) \| `null`

The colour-over-life gradient row, or `null`.

##### frame

> `readonly` **frame**: [`LookupRow`](#lookuprow) \| `null`

The frame-over-life row, or `null`.

##### noise

> `readonly` **noise**: [`LookupRow`](#lookuprow) \| `null`

The noise-influence-over-life row, or `null`.

##### pixels

> `readonly` **pixels**: `Uint8Array`

The texels, `rows * LOOKUP_SAMPLES * 4` bytes, top row first.

##### rotation

> `readonly` **rotation**: [`LookupRow`](#lookuprow) \| `null`

The angular-speed-over-life row, or `null`.

##### rows

> `readonly` **rows**: `number`

How many rows the texture has; at least `1`.

##### size

> `readonly` **size**: [`LookupRow`](#lookuprow) \| `null`

The size-over-life row, or `null`. Per-axis sizes use R, G, and B.

***

### ParticleMain

The `main` module: capacity, timing, space, and playback.

#### Properties

##### capacity

> `readonly` **capacity**: `number`

How many spawn records the ring holds. Older records are overwritten, alive or not.

##### duration

> `readonly` **duration**: `number`

How long one emission cycle lasts, in seconds.

##### looping

> `readonly` **looping**: `boolean`

Whether the cycle repeats. A non-looping system stops when the cycle ends and the last particle dies.

##### playOnAwake

> `readonly` **playOnAwake**: `boolean`

Whether a `ParticleSystem` starts playing the first frame it is enabled.

##### prewarm

> `readonly` **prewarm**: `boolean`

Whether `play()` fast-forwards one full cycle first, so a looping effect starts steady.

##### renderOrder

> `readonly` **renderOrder**: `number`

The renderer's sort key within the transparent phase; lower draws first.

##### seed

> `readonly` **seed**: `number`

The emission seed; `0` picks one at random on `play()`. A component's `seed` field overrides it.

##### simulationSpace

> `readonly` **simulationSpace**: `"local"` \| `"world"`

Where positions live.

##### startDelay

> `readonly` **startDelay**: `number`

Seconds after `play()` before emission starts.

##### timeScale

> `readonly` **timeScale**: `number`

A multiplier on the system's own clock.

***

### ParticleMainInput

The `main` module as authored.

#### Properties

##### capacity?

> `readonly` `optional` **capacity?**: `number`

See [ParticleMain.capacity](#capacity-1). Defaults to `1000`.

##### duration?

> `readonly` `optional` **duration?**: `number`

See [ParticleMain.duration](#duration). Defaults to `5`.

##### looping?

> `readonly` `optional` **looping?**: `boolean`

See [ParticleMain.looping](#looping). Defaults to `true`.

##### playOnAwake?

> `readonly` `optional` **playOnAwake?**: `boolean`

See [ParticleMain.playOnAwake](#playonawake). Defaults to `true`.

##### prewarm?

> `readonly` `optional` **prewarm?**: `boolean`

See [ParticleMain.prewarm](#prewarm). Defaults to `false`.

##### renderOrder?

> `readonly` `optional` **renderOrder?**: `number`

See [ParticleMain.renderOrder](#renderorder). Defaults to `0`.

##### seed?

> `readonly` `optional` **seed?**: `number`

See [ParticleMain.seed](#seed-3). Defaults to `0`.

##### simulationSpace?

> `readonly` `optional` **simulationSpace?**: `"local"` \| `"world"`

See [ParticleMain.simulationSpace](#simulationspace). Defaults to `"local"`.

##### startDelay?

> `readonly` `optional` **startDelay?**: `number`

See [ParticleMain.startDelay](#startdelay). Defaults to `0`.

##### timeScale?

> `readonly` `optional` **timeScale?**: `number`

See [ParticleMain.timeScale](#timescale). Defaults to `1`.

***

### ParticleNoise

A positional noise offset sampled at the analytic position.

#### Properties

##### frequency

> `readonly` **frequency**: `number`

How quickly the field varies with position.

##### influenceOverLife

> `readonly` **influenceOverLife**: [`ScalarValue`](#scalarvalue)

A multiplier on `strength` over the particle's life.

##### octaves

> `readonly` **octaves**: `number`

How many octaves are summed, `1` or `2`.

##### scroll

> `readonly` **scroll**: `Vec3Like`

How the field drifts with time, in field units per second.

##### strength

> `readonly` **strength**: `number`

The largest offset, in metres.

***

### ParticleOrbit

A rotation about a fixed axis through the emitter.

#### Properties

##### axis

> `readonly` **axis**: `Vec3Like`

The axis, normalized at definition time.

##### speed

> `readonly` **speed**: `number`

Degrees per second.

***

### ParticleOverLifetime

The `overLifetime` module.

#### Properties

##### color

> `readonly` **color**: [`ColorValue`](#colorvalue) \| `null`

A colour multiplied onto the start colour over the particle's life, or `null`.

##### rotation

> `readonly` **rotation**: [`ScalarValue`](#scalarvalue) \| `null`

The angular speed, in degrees per second, or `null` for none.

##### size

> `readonly` **size**: [`ScalarValue`](#scalarvalue) \| `null`

A multiplier on the start size (the X axis when `sizeY` or `sizeZ` is set), or `null`.

##### sizeY

> `readonly` **sizeY**: [`ScalarValue`](#scalarvalue) \| `null`

A separate multiplier for the Y axis, or `null` to follow `size`.

##### sizeZ

> `readonly` **sizeZ**: [`ScalarValue`](#scalarvalue) \| `null`

A separate multiplier for the Z axis, or `null` to follow `size`.

***

### ParticleOverLifetimeInput

The `overLifetime` module as authored.

#### Properties

##### color?

> `readonly` `optional` **color?**: [`ColorValueInput`](#colorvalueinput) \| `null`

A gradient, or a constant tint.

##### rotation?

> `readonly` `optional` **rotation?**: [`ScalarValueInput`](#scalarvalueinput) \| `null`

Angular speed in degrees per second.

##### size?

> `readonly` `optional` **size?**: [`ScalarValueInput`](#scalarvalueinput) \| `null`

A curve or constant multiplier.

##### sizeY?

> `readonly` `optional` **sizeY?**: [`ScalarValueInput`](#scalarvalueinput) \| `null`

A separate Y multiplier.

##### sizeZ?

> `readonly` `optional` **sizeZ?**: [`ScalarValueInput`](#scalarvalueinput) \| `null`

A separate Z multiplier.

***

### ParticleRenderer

The `renderer` module.

#### Properties

##### blend

> `readonly` **blend**: `"premultiplied"` \| `"additive"` \| `"alpha"`

How particles composite.

##### lengthScale

> `readonly` **lengthScale**: `number`

A multiplier on a `"stretched"` particle's length.

##### lit

> `readonly` **lit**: `boolean`

Whether particles are shaded with the main light and the ambient colour.

##### mesh

> `readonly` **mesh**: `"sphere"` \| `"box"` \| `"plane"` \| `"cylinder"` \| `"capsule"` \| `"torus"`

The primitive a `"mesh"` renderer draws.

##### mode

> `readonly` **mode**: `"mesh"` \| `"billboard"` \| `"stretched"` \| `"horizontal"` \| `"vertical"`

How particles are oriented.

##### pivot

> `readonly` **pivot**: `Vec2Like`

Where the particle's origin sits inside its quad, in size units; `(0, 0)` is the centre.

##### sheet

> `readonly` **sheet**: [`ParticleSheet`](#particlesheet) \| `null`

The sprite-sheet layout of `texture`, or `null` for a single image.

##### speedScale

> `readonly` **speedScale**: `number`

How much of the speed a `"stretched"` particle adds to its length.

##### texture

> `readonly` **texture**: `string` \| `null`

The texture's asset address, or `null` for a procedural soft disc.

***

### ParticleRendererInput

The `renderer` module as authored.

#### Properties

##### blend?

> `readonly` `optional` **blend?**: `"premultiplied"` \| `"additive"` \| `"alpha"`

Defaults to `"premultiplied"`.

##### lengthScale?

> `readonly` `optional` **lengthScale?**: `number`

Defaults to `1`.

##### lit?

> `readonly` `optional` **lit?**: `boolean`

Defaults to `false`.

##### mesh?

> `readonly` `optional` **mesh?**: `"sphere"` \| `"box"` \| `"plane"` \| `"cylinder"` \| `"capsule"` \| `"torus"`

Defaults to `"box"`.

##### mode?

> `readonly` `optional` **mode?**: `"mesh"` \| `"billboard"` \| `"stretched"` \| `"horizontal"` \| `"vertical"`

Defaults to `"billboard"`.

##### pivot?

> `readonly` `optional` **pivot?**: `Vec2Like`

Defaults to `(0, 0)`.

##### sheet?

> `readonly` `optional` **sheet?**: [`ParticleSheetInput`](#particlesheetinput) \| `null`

Defaults to `null`.

##### speedScale?

> `readonly` `optional` **speedScale?**: `number`

Defaults to `0`.

##### texture?

> `readonly` `optional` **texture?**: `string` \| `null`

Defaults to `null`.

***

### ParticlesErrorOptions

Options accepted by [particlesError](#particleserror): the same subset of `IgnifxErrorOptions` this package
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

### ParticleShape

The `shape` module. Every field is present; a shape reads the ones that apply to it.

#### Properties

##### angle

> `readonly` **angle**: `number`

A cone's half-angle in degrees.

##### arc

> `readonly` **arc**: `number`

The angular span of a sphere, hemisphere, circle, or cone, in degrees.

##### emitFrom

> `readonly` **emitFrom**: `"volume"` \| `"shell"` \| `"base"`

Where inside the shape particles start.

##### kind

> `readonly` **kind**: `"point"` \| `"sphere"` \| `"hemisphere"` \| `"cone"` \| `"box"` \| `"circle"` \| `"edge"` \| `"mesh"`

Which shape.

##### length

> `readonly` **length**: `number`

A cone's height, or an edge's length.

##### radius

> `readonly` **radius**: `number`

The radius of a sphere, hemisphere, circle, or cone base; half the length of an edge.

##### randomDirection

> `readonly` **randomDirection**: `number`

How much of the start direction is random, `0`–`1`.

##### size

> `readonly` **size**: `Vec3Like`

A box's full extents.

##### spherizeDirection

> `readonly` **spherizeDirection**: `number`

How much of the start direction points away from the shape's centre, `0`–`1`.

##### thickness

> `readonly` **thickness**: `number`

How much of a sphere, hemisphere, or circle's radius emits, `0` (surface only) to `1` (whole).

##### vertices

> `readonly` **vertices**: `Float32Array`

A `"mesh"` shape's triangle soup: three floats per vertex, three vertices per triangle.

***

### ParticleShapeInput

The `shape` module as authored.

#### Properties

##### angle?

> `readonly` `optional` **angle?**: `number`

See [ParticleShape.angle](#angle). Defaults to `25`.

##### arc?

> `readonly` `optional` **arc?**: `number`

See [ParticleShape.arc](#arc). Defaults to `360`.

##### emitFrom?

> `readonly` `optional` **emitFrom?**: `"volume"` \| `"shell"` \| `"base"`

See [ParticleShape.emitFrom](#emitfrom). Defaults to `"base"` for a cone and `"volume"` otherwise.

##### kind?

> `readonly` `optional` **kind?**: `"point"` \| `"sphere"` \| `"hemisphere"` \| `"cone"` \| `"box"` \| `"circle"` \| `"edge"` \| `"mesh"`

Which shape. Defaults to `"cone"`.

##### length?

> `readonly` `optional` **length?**: `number`

See [ParticleShape.length](#length). Defaults to `1`.

##### radius?

> `readonly` `optional` **radius?**: `number`

See [ParticleShape.radius](#radius). Defaults to `0.2`.

##### randomDirection?

> `readonly` `optional` **randomDirection?**: `number`

See [ParticleShape.randomDirection](#randomdirection). Defaults to `0`.

##### size?

> `readonly` `optional` **size?**: `Vec3Like`

See [ParticleShape.size](#size-3). Defaults to `(1, 1, 1)`.

##### spherizeDirection?

> `readonly` `optional` **spherizeDirection?**: `number`

See [ParticleShape.spherizeDirection](#spherizedirection). Defaults to `0`.

##### thickness?

> `readonly` `optional` **thickness?**: `number`

See [ParticleShape.thickness](#thickness). Defaults to `1`.

##### vertices?

> `readonly` `optional` **vertices?**: readonly `number`[]

A `"mesh"` shape's triangles, nine numbers per triangle.

***

### ParticleSheet

A sprite sheet laid out in a grid.

#### Properties

##### fps

> `readonly` **fps**: `number`

Frames per second, for `"fps"`.

##### frameOverTime

> `readonly` **frameOverTime**: [`ScalarValue`](#scalarvalue)

The frame over the particle's life as a fraction of the sheet, for `"curve"`.

##### mode

> `readonly` **mode**: `"curve"` \| `"random"` \| `"fps"`

How the frame is chosen.

##### tiles

> `readonly` **tiles**: `Vec2Like`

Columns and rows of the grid.

***

### ParticleSheetInput

A sprite sheet as authored.

#### Properties

##### frameOverTime?

> `readonly` `optional` **frameOverTime?**: `"random"` \| [`ScalarValueInput`](#scalarvalueinput) \| \{ `fps`: `number`; \}

A curve over life, `"random"`, or `{ fps }`. Defaults to a linear curve over the whole sheet.

##### tiles?

> `readonly` `optional` **tiles?**: `Vec2Like`

Columns and rows. Defaults to `(1, 1)`.

***

### ParticlesOptions

What `particles()` accepts. Every field overrides the matching `particles` settings section value.

#### Properties

##### gravity?

> `readonly` `optional` **gravity?**: `Vec3Like`

The world gravity a `gravityMultiplier` scales.

##### maxParticles?

> `readonly` `optional` **maxParticles?**: `number`

The particle budget every system's capacity is counted against.

##### qualityScale?

> `readonly` `optional` **qualityScale?**: `number`

A `0`–`1` multiplier on every emission rate and burst count.

***

### ParticlesSettings

The resolved `particles` settings section.

#### Example

```ts
// ignifx.config.ts
export default defineConfig({
  particles: { maxParticles: 50_000, qualityScale: 1 },
});
```

#### Properties

##### gravity

> `readonly` **gravity**: `Vec3Like`

The world gravity, in metres per second squared, a definition's `forces.gravityMultiplier`
scales. When `@ignifx/physics` is registered and this stays at its default, the physics
section's gravity is used instead.

##### maxParticles

> `readonly` **maxParticles**: `number`

The budget every `ParticleSystem`'s `capacity` is counted against. A system that would push the
total over it is clamped to what is left and `IGX-1702` is logged once.

##### qualityScale

> `readonly` **qualityScale**: `number`

A `0`–`1` multiplier on every emission rate and burst count, for settings screens.

***

### ParticleStart

The `start` module: what a particle is born with.

#### Properties

##### color

> `readonly` **color**: [`ColorValue`](#colorvalue)

The start colour, sRGB. A random value picks between two colours per particle.

##### lifetime

> `readonly` **lifetime**: [`ScalarValue`](#scalarvalue)

Seconds a particle lives.

##### rotation

> `readonly` **rotation**: [`ScalarValue`](#scalarvalue)

The start rotation, in degrees.

##### size

> `readonly` **size**: [`ScalarValue`](#scalarvalue)

The particle's size, in metres.

##### size3D

> `readonly` **size3D**: `Vec3Like` \| `null`

Optional per-axis multipliers on `size`, or `null` for a uniform size.

##### speed

> `readonly` **speed**: [`ScalarValue`](#scalarvalue)

Metres per second along the start direction.

***

### ParticleStartInput

The `start` module as authored.

#### Properties

##### color?

> `readonly` `optional` **color?**: [`ColorValueInput`](#colorvalueinput)

Defaults to opaque white.

##### lifetime?

> `readonly` `optional` **lifetime?**: [`ScalarValueInput`](#scalarvalueinput)

Defaults to `2`.

##### rotation?

> `readonly` `optional` **rotation?**: [`ScalarValueInput`](#scalarvalueinput)

Defaults to `0`.

##### size?

> `readonly` `optional` **size?**: [`ScalarValueInput`](#scalarvalueinput)

Defaults to `0.2`.

##### size3D?

> `readonly` `optional` **size3D?**: `Vec3Like` \| `null`

Defaults to `null`.

##### speed?

> `readonly` `optional` **speed?**: [`ScalarValueInput`](#scalarvalueinput)

Defaults to `2`.

***

### ParticleState

**`Beta`**

Everything a particle is at one instant.

#### Properties

##### age

> **age**: `number`

**`Beta`**

Seconds since spawn.

##### color

> `readonly` **color**: `Float32Array`

**`Beta`**

Linear red, green, blue, and straight alpha.

##### frame

> **frame**: `number`

**`Beta`**

The sprite-sheet frame, or `0` without a sheet.

##### life

> **life**: `number`

**`Beta`**

`age / lifetime`, in `[0, 1]`.

##### position

> `readonly` **position**: `Float32Array`

**`Beta`**

The world position.

##### rotation

> **rotation**: `number`

**`Beta`**

The rotation about the view axis (or the mesh's spin axis), in radians.

##### size

> `readonly` **size**: `Float32Array`

**`Beta`**

The size along each axis, in metres.

##### velocity

> `readonly` **velocity**: `Float32Array`

**`Beta`**

The world velocity.

***

### ParticleStopOptions

What [ParticleEmitterCore.stop](#stop) accepts.

#### Properties

##### clear?

> `readonly` `optional` **clear?**: `boolean`

Whether to forget the live particles too. Defaults to `false`: they finish their lives.

***

### RingCensus

**`Beta`**

What one reconciliation pass found.

#### Properties

##### alive

> **alive**: `number`

**`Beta`**

Records whose age is inside their lifetime. Exact.

##### drawCount

> **drawCount**: `number`

**`Beta`**

Records from the newest back to the oldest still alive: what the GPU draws.

***

### UploadRange

**`Beta`**

A contiguous run of records to upload, in slots.

#### Properties

##### count

> `readonly` **count**: `number`

**`Beta`**

How many records.

##### start

> `readonly` **start**: `number`

**`Beta`**

The first slot.

## Type Aliases

### ColorInput

> **ColorInput** = `ColorLike` \| readonly \[`number`, `number`, `number`, `number`\]

A colour as a document may write it: an `{ r, g, b, a }` object or an `[r, g, b, a]` array, both
sRGB in `0`–`1`.

***

### ColorValue

> **ColorValue** = \{ `kind`: `"constant"`; `value`: `ColorLike`; \} \| \{ `kind`: `"random"`; `max`: `ColorLike`; `min`: `ColorLike`; \} \| \{ `kind`: `"gradient"`; `samples`: `Float32Array`; `stops`: readonly [`GradientStop`](#gradientstop)[]; \}

A resolved colour value. A `"gradient"` carries its baked RGBA samples, sRGB, four floats per
sample.

***

### ColorValueInput

> **ColorValueInput** = [`ColorInput`](#colorinput) \| \{ `max`: [`ColorInput`](#colorinput); `min`: [`ColorInput`](#colorinput); \} \| \{ `gradient`: readonly [`GradientStop`](#gradientstop)[]; \}

A colour a document may give as a constant, a random pick between two, or a gradient.

***

### DeepPartial

> **DeepPartial**\<`T`\> = `T` *extends* readonly `unknown`[] ? `T` : `T` *extends* `object` ? `{ readonly [K in keyof T]?: DeepPartial<T[K]> }` : `T`

A recursively optional view of a type: what an override of a preset looks like.

#### Type Parameters

##### T

`T`

The type being made optional.

***

### GradientStop

> **GradientStop** = readonly \[`number`, `number`, `number`, `number`, `number`\]

One stop of a colour gradient: normalized time, then sRGB red, green, blue, and alpha in `0`–`1`.

***

### ParticleBlendMode

> **ParticleBlendMode** = *typeof* [`PARTICLE_BLEND_MODES`](#particle_blend_modes)\[`number`\]

The union of [PARTICLE\_BLEND\_MODES](#particle_blend_modes).

***

### ParticleEmitFrom

> **ParticleEmitFrom** = *typeof* [`PARTICLE_EMIT_FROM`](#particle_emit_from)\[`number`\]

The union of [PARTICLE\_EMIT\_FROM](#particle_emit_from).

***

### ParticleFrameMode

> **ParticleFrameMode** = *typeof* [`PARTICLE_FRAME_MODES`](#particle_frame_modes)\[`number`\]

The union of [PARTICLE\_FRAME\_MODES](#particle_frame_modes).

***

### ParticleMeshName

> **ParticleMeshName** = *typeof* [`PARTICLE_MESHES`](#particle_meshes)\[`number`\]

The union of [PARTICLE\_MESHES](#particle_meshes).

***

### ParticlePreset

> **ParticlePreset** = *typeof* [`PARTICLE_PRESETS`](#particle_presets)\[`number`\]

The union of [PARTICLE\_PRESETS](#particle_presets).

***

### ParticleRenderMode

> **ParticleRenderMode** = *typeof* [`PARTICLE_RENDER_MODES`](#particle_render_modes)\[`number`\]

The union of [PARTICLE\_RENDER\_MODES](#particle_render_modes).

***

### ParticlesErrorCode

> **ParticlesErrorCode** = *typeof* [`ParticlesErrorCode`](#particleserrorcode)\[keyof *typeof* [`ParticlesErrorCode`](#particleserrorcode)\]

The union of the codes the `ParticlesErrorCode` table declares.

***

### ParticleShapeKind

> **ParticleShapeKind** = *typeof* [`PARTICLE_SHAPE_KINDS`](#particle_shape_kinds)\[`number`\]

The union of [PARTICLE\_SHAPE\_KINDS](#particle_shape_kinds).

***

### ParticleSimulationSpace

> **ParticleSimulationSpace** = *typeof* [`PARTICLE_SIMULATION_SPACES`](#particle_simulation_spaces)\[`number`\]

The union of [PARTICLE\_SIMULATION\_SPACES](#particle_simulation_spaces).

***

### ScalarValue

> **ScalarValue** = \{ `kind`: `"constant"`; `value`: `number`; \} \| \{ `kind`: `"random"`; `max`: `number`; `min`: `number`; \} \| \{ `curve`: `CurveValue`; `kind`: `"curve"`; `samples`: `Float32Array`; \}

A resolved scalar value. A `"curve"` carries its [LOOKUP\_SAMPLES](#lookup_samples) baked samples so the CPU
side never re-evaluates the Hermite spline.

***

### ScalarValueInput

> **ScalarValueInput** = `number` \| \{ `max`: `number`; `min`: `number`; \} \| \{ `curve`: `CurveValue`; \}

A number a document may give as a constant, a range, or a curve. As authored:
`2`, `{ "min": 1, "max": 3 }`, or `{ "curve": { "keys": [[0, 1, 0, 0], [1, 0, 0, 0]] } }`.

## Variables

### LOOKUP\_SAMPLES

> `const` **LOOKUP\_SAMPLES**: `64` = `64`

How many samples a baked curve or gradient row holds. Both evaluators read the same 64 samples
with the same linear rule, which is what makes the lookup the contract between them.

***

### PARTICLE\_ASSET\_TYPE

> `const` **PARTICLE\_ASSET\_TYPE**: `"particles"` = `"particles"`

The asset type name the loader registers.

***

### PARTICLE\_BLEND\_MODES

> `const` **PARTICLE\_BLEND\_MODES**: readonly \[`"premultiplied"`, `"additive"`, `"alpha"`\]

How particles composite over what is behind them. `premultiplied` is the default: fire and smoke
share one draw and blend front-to-back correctly.

***

### PARTICLE\_EMIT\_FROM

> `const` **PARTICLE\_EMIT\_FROM**: readonly \[`"volume"`, `"shell"`, `"base"`\]

Where inside a shape particles start: anywhere in it, on its surface, or — for a cone — on its
base disc.

***

### PARTICLE\_FILE\_EXTENSIONS

> `const` **PARTICLE\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the particle loader.

***

### PARTICLE\_FRAME\_MODES

> `const` **PARTICLE\_FRAME\_MODES**: readonly \[`"curve"`, `"random"`, `"fps"`\]

How a sprite sheet picks its frame: from a curve over the particle's life, at random per particle,
or advancing at a fixed rate.

***

### PARTICLE\_MESHES

> `const` **PARTICLE\_MESHES**: readonly \[`"box"`, `"sphere"`, `"plane"`, `"cylinder"`, `"capsule"`, `"torus"`\]

The core primitives a `"mesh"` renderer may draw, each built at unit size.

***

### PARTICLE\_PRESETS

> `const` **PARTICLE\_PRESETS**: readonly \[`"fire"`, `"smoke"`, `"sparks"`, `"explosion"`, `"dust"`, `"sparkle"`, `"rain"`, `"snow"`, `"leaves"`\]

Every preset name, in the order the documentation lists them.

***

### PARTICLE\_RENDER\_MODES

> `const` **PARTICLE\_RENDER\_MODES**: readonly \[`"billboard"`, `"stretched"`, `"horizontal"`, `"vertical"`, `"mesh"`\]

How a particle is oriented when drawn.

***

### PARTICLE\_RENDER\_ORDER

> `const` **PARTICLE\_RENDER\_ORDER**: `880` = `880`

Where the render system sits in `PreRender`: before core's shader-uniform (890) and render-sync
(900) systems, so this frame's records and uniforms are what the scene draws.

***

### PARTICLE\_SHAPE\_KINDS

> `const` **PARTICLE\_SHAPE\_KINDS**: readonly \[`"point"`, `"sphere"`, `"hemisphere"`, `"cone"`, `"box"`, `"circle"`, `"edge"`, `"mesh"`\]

Every emitter shape. Directional shapes emit along the emitter's local `+Y`.

***

### PARTICLE\_SIMULATION\_SPACES

> `const` **PARTICLE\_SIMULATION\_SPACES**: readonly \[`"local"`, `"world"`\]

Where a particle's position is integrated: in the emitter's space and transformed by the emitter's
current world matrix at draw (`"local"`, so the effect follows its entity), or baked into world
space at spawn (`"world"`, so a trail stays where it was emitted).

***

### PARTICLE\_UPDATE\_ORDER

> `const` **PARTICLE\_UPDATE\_ORDER**: `900` = `900`

Where the update system sits in `Update`: after every script, so a script's `emit()` is drawn in
the same frame.

***

### particles

> `const` **particles**: (`options?`) => `Extension`

The `@ignifx/particles` extension factory.

#### Parameters

##### options?

[`ParticlesOptions`](#particlesoptions)

Overrides for the `particles` settings section.

#### Returns

`Extension`

The extension descriptor to pass to `createApp`.

#### Example

```ts
const app = await createApp({ canvas, extensions: [particles({ maxParticles: 50_000 })] });
```

***

### PARTICLES\_DIAGNOSTICS\_COUNTERS

> `const` **PARTICLES\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters the group carries, in index order.

***

### PARTICLES\_DIAGNOSTICS\_GROUP

> `const` **PARTICLES\_DIAGNOSTICS\_GROUP**: `"particles"` = `"particles"`

The diagnostics group name.

***

### PARTICLES\_ERROR\_MESSAGES

> `const` **PARTICLES\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### PARTICLES\_FORMAT

> `const` **PARTICLES\_FORMAT**: `"ignifx.particles"` = `"ignifx.particles"`

The `format` discriminator every `.particles.json` document carries.

***

### PARTICLES\_FORMAT\_VERSION

> `const` **PARTICLES\_FORMAT\_VERSION**: `1` = `1`

The document version this build reads and writes.

***

### PARTICLES\_SETTINGS\_SECTION

> `const` **PARTICLES\_SETTINGS\_SECTION**: `"particles"` = `"particles"`

The section name as it appears in `ignifx.config.ts`.

***

### ParticlesErrorCode

> `const` **ParticlesErrorCode**: `object`

Every diagnostic code `@ignifx/particles` can throw or log, keyed by an intention-revealing name
so call sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### budgetExceeded

> `readonly` **budgetExceeded**: `"IGX-1702"` = `"IGX-1702"`

A `ParticleSystem` asked for more capacity than the `app.particles.maxParticles` budget has left; it was clamped.

##### duplicateExtension

> `readonly` **duplicateExtension**: `"IGX-1703"` = `"IGX-1703"`

A second `particles()` extension was registered on one app.

##### invalidArgument

> `readonly` **invalidArgument**: `"IGX-1707"` = `"IGX-1707"`

`emit`, `simulate`, or a value argument was not a finite number in range.

##### invalidParticlesFile

> `readonly` **invalidParticlesFile**: `"IGX-1701"` = `"IGX-1701"`

A `.particles.json` document, or a `defineParticles` input, is not an `ignifx.particles` document this build can read.

##### noDefinition

> `readonly` **noDefinition**: `"IGX-1705"` = `"IGX-1705"`

A `ParticleSystem` method that needs a definition ran without one.

##### shaderFailed

> `readonly` **shaderFailed**: `"IGX-1706"` = `"IGX-1706"`

The generated particle shader failed to load or to build a material.

##### unknownPreset

> `readonly` **unknownPreset**: `"IGX-1704"` = `"IGX-1704"`

`particleDefinition` named a preset that does not exist.

#### Example

```ts
throw particlesError(ParticlesErrorCode.invalidParticlesFile, "fire.particles.json declares no main.", {
  context: { file: "fire.particles.json", reason: "main is missing" },
});
```

***

### RECORD\_BYTES

> `const` **RECORD\_BYTES**: `number`

**`Beta`**

Bytes per record, matching the WGSL `Particle` struct's size.

***

### RECORD\_FLOATS

> `const` **RECORD\_FLOATS**: `12` = `12`

**`Beta`**

Floats per record.

***

### RECORD\_LIFETIME

> `const` **RECORD\_LIFETIME**: `1` = `1`

**`Beta`**

The float index of `lifetime` inside a record.

***

### RECORD\_POSITION

> `const` **RECORD\_POSITION**: `4` = `4`

**`Beta`**

The float index of `position.x` inside a record.

***

### RECORD\_ROTATION

> `const` **RECORD\_ROTATION**: `11` = `11`

**`Beta`**

The float index of `rotation` inside a record, in radians.

***

### RECORD\_SEED

> `const` **RECORD\_SEED**: `2` = `2`

**`Beta`**

The word index of `seed` inside a record; read it from the ring's `words`, not its floats.

***

### RECORD\_SIZE

> `const` **RECORD\_SIZE**: `7` = `7`

**`Beta`**

The float index of `size` inside a record.

***

### RECORD\_SPAWN\_TIME

> `const` **RECORD\_SPAWN\_TIME**: `0` = `0`

**`Beta`**

The float index of `spawnTime` inside a record.

***

### RECORD\_VELOCITY

> `const` **RECORD\_VELOCITY**: `8` = `8`

**`Beta`**

The float index of `velocity.x` inside a record.

***

### VERSION

> `const` **VERSION**: `"0.2.1"` = `"0.2.1"`

The `@ignifx/particles` version this build was cut from.

## Functions

### bakeCurve()

> **bakeCurve**(`curve`): `Float32Array`

Bakes a curve into [LOOKUP\_SAMPLES](#lookup_samples) samples over `[0, 1]`.

#### Parameters

##### curve

`CurveValue`

The curve.

#### Returns

`Float32Array`

The samples; sample `i` is the curve at `i / 63`.

***

### bakeGradient()

> **bakeGradient**(`stops`): `Float32Array`

Bakes a gradient into [LOOKUP\_SAMPLES](#lookup_samples) RGBA samples.

#### Parameters

##### stops

readonly [`GradientStop`](#gradientstop)[]

The stops.

#### Returns

`Float32Array`

`LOOKUP_SAMPLES * 4` floats, sRGB.

***

### createParticleLoader()

> **createParticleLoader**(): `AssetLoader`\<[`ParticleAsset`](#particleasset)\>

Builds the loader for `.particles.json` addresses.

#### Returns

`AssetLoader`\<[`ParticleAsset`](#particleasset)\>

The loader to register with `ctx.registerAssetLoader`.

#### Example

```ts
ctx.registerAssetLoader(createParticleLoader());
```

***

### createParticleState()

> **createParticleState**(): [`ParticleState`](#particlestate)

**`Beta`**

Allocates an empty state.

#### Returns

[`ParticleState`](#particlestate)

A state with every field zeroed.

***

### defaultParticlesSettings()

> **defaultParticlesSettings**(): [`ParticlesSettings`](#particlessettings)

The values used for everything a project omits.

#### Returns

[`ParticlesSettings`](#particlessettings)

The default `particles` section.

***

### defineParticles()

> **defineParticles**(`input`, `address?`): [`ParticleDefinition`](#particledefinition-3)

Fills in the defaults of a particle document, checks every rule the evaluators rely on, and bakes
its curves and gradients into the lookup rows both hosts sample.

#### Parameters

##### input

[`ParticleDefinitionInput`](#particledefinitioninput)

The document, as authored.

##### address?

`string` = `"<inline>"`

What to name in an error; defaults to `"<inline>"`.

#### Returns

[`ParticleDefinition`](#particledefinition-3)

The complete, frozen definition.

#### Throws

IgnifxError with code `IGX-1701`, naming the offending path, when the document is not
readable.

#### Example

```ts
const sparks = defineParticles({
  main: { capacity: 200, duration: 1, looping: false },
  emission: { rateOverTime: 0, bursts: [{ time: 0, count: 120 }] },
  start: { lifetime: { min: 0.4, max: 1 }, speed: { min: 3, max: 6 }, size: 0.04 },
  forces: { gravityMultiplier: 1, drag: 0.5 },
  renderer: { mode: "stretched", blend: "additive" },
});
```

***

### describeParticlesFormat()

> **describeParticlesFormat**(): `SchemaDescription`

Describes the `ignifx.particles` file format.

#### Returns

`SchemaDescription`

The record `pnpm docs:schemas` renders.

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component and settings section this package registers.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The record `pnpm docs:schemas` renders, keyed by schema id.

***

### evaluateCurve()

> **evaluateCurve**(`curve`, `t`): `number`

Evaluates a cubic Hermite curve at `t`, clamping to the end keys outside the key range
(`docs/architecture/06-serialization-and-scene-format.md` §3: keys are
`[time, value, inTangent, outTangent]`).

#### Parameters

##### curve

`CurveValue`

The curve; its keys must be sorted by time and non-empty.

##### t

`number`

Where to evaluate.

#### Returns

`number`

The value; `0` for a curve with no keys.

***

### evaluateGradient()

> **evaluateGradient**(`stops`, `t`, `out`): `Float32Array`

Evaluates a gradient at `t` by linear interpolation between stops, clamping outside them.

#### Parameters

##### stops

readonly [`GradientStop`](#gradientstop)[]

The stops, sorted by time and non-empty.

##### t

`number`

Where to evaluate.

##### out

`Float32Array`

Receives the sRGB colour.

#### Returns

`Float32Array`

`out`.

***

### evaluateParticle()

> **evaluateParticle**(`inputs`, `floats`, `words`, `slot`, `clock`, `out`): `boolean`

**`Beta`**

Evaluates one record at a clock.

#### Parameters

##### inputs

[`ParticleEvaluationInputs`](#particleevaluationinputs)

The definition and the per-system values.

##### floats

`Float32Array`

The ring's floats.

##### words

`Uint32Array`

The ring's words.

##### slot

`number`

Which record.

##### clock

`number`

The system clock.

##### out

[`ParticleState`](#particlestate)

Receives the state.

#### Returns

`boolean`

`true` when the particle is alive; `false` leaves `out` untouched.

***

### generateParticleWgsl()

> **generateParticleWgsl**(`definition`): `string`

**`Beta`**

Generates the WGSL program that draws a definition.

#### Parameters

##### definition

[`ParticleDefinition`](#particledefinition-3)

The definition.

#### Returns

`string`

The whole `.wgsl` source, pragmas included, ready for the shader loader.

#### Example

```ts
const source = generateParticleWgsl(particleDefinition("fire"));
source.includes("@ignifx blend premultiplied"); // true
```

***

### gradientNoise()

> **gradientNoise**(`x`, `y`, `z`, `scratch`): `number`

**`Beta`**

One scalar of lattice gradient noise at a point.

#### Parameters

##### x

`number`

The sample position.

##### y

`number`

The sample position.

##### z

`number`

The sample position.

##### scratch

`Uint32Array`

Three words of scratch space.

#### Returns

`number`

The noise value, in roughly `[-1, 1]`.

***

### hashToUnit()

> **hashToUnit**(`word`): `number`

**`Beta`**

Turns a hashed word into a unit float in `[0, 1)` — the same `f32(h) * 2^-32` the shader uses.

#### Parameters

##### word

`number`

A `u32`.

#### Returns

`number`

The unit float.

***

### isUnitScalar()

> **isUnitScalar**(`value`): `boolean`

Whether a scalar is a constant `1`, so a module can skip it entirely.

#### Parameters

##### value

[`ScalarValue`](#scalarvalue)

The scalar.

#### Returns

`boolean`

`true` for a constant equal to one.

***

### noise3()

> **noise3**(`x`, `y`, `z`, `octaves`, `scratch`, `out`): `Float32Array`

**`Beta`**

Three decorrelated noise channels at a point, summed over one or two octaves.

#### Parameters

##### x

`number`

The sample position.

##### y

`number`

The sample position.

##### z

`number`

The sample position.

##### octaves

`number`

`1` or `2`.

##### scratch

`Uint32Array`

Three words of scratch space.

##### out

`Float32Array`

Receives the three channels.

#### Returns

`Float32Array`

`out`.

***

### particleAssetFromDefinition()

> **particleAssetFromDefinition**(`app`, `definition`, `name?`): `AssetHandle`\<[`ParticleAsset`](#particleasset)\>

Publishes a definition built in code as a `particles` asset, so a `ParticleSystem`'s `definition`
field can hold it without a file. A `renderer.texture` starts loading here; the system draws the
procedural disc until it arrives. The handle has one holder, the caller.

#### Parameters

##### app

`App`

The app whose asset service publishes it.

##### definition

[`ParticleDefinition`](#particledefinition-3)

The definition, from [defineParticles](#defineparticles) or a preset.

##### name?

`string` = `"particles"`

A human-readable name for diagnostics; defaults to `"particles"`.

#### Returns

`AssetHandle`\<[`ParticleAsset`](#particleasset)\>

The handle, already loaded.

#### Example

```ts
const fire = particleAssetFromDefinition(app, particleDefinition("fire"));
campfire.addComponent(ParticleSystem, { definition: fire });
```

***

### particleDefinition()

> **particleDefinition**(`name`, `overrides?`): [`ParticleDefinition`](#particledefinition-3)

A preset, with any part of it overridden, as a complete definition. An object override merges key
by key; an array or a primitive replaces the whole value.

#### Parameters

##### name

`"fire"` \| `"smoke"` \| `"sparks"` \| `"explosion"` \| `"dust"` \| `"sparkle"` \| `"rain"` \| `"snow"` \| `"leaves"`

The preset.

##### overrides?

What to change.

###### emission?

\{ `bursts?`: readonly [`ParticleBurstInput`](#particleburstinput)[]; `rateOverDistance?`: `number`; `rateOverTime?`: `number`; \}

The `emission` module.

###### emission.bursts?

readonly [`ParticleBurstInput`](#particleburstinput)[]

The bursts. Defaults to none.

###### emission.rateOverDistance?

`number`

Particles per metre moved. Defaults to `0`.

###### emission.rateOverTime?

`number`

Particles per second. Defaults to `10`.

###### forces?

\{ `constantForce?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}; `drag?`: `number`; `gravity?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \} \| `null`; `gravityMultiplier?`: `number`; `noise?`: \{ `frequency?`: `number`; `influenceOverLife?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: ... \| ...; \}; \}; `octaves?`: `number`; `scroll?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}; `strength?`: `number`; \} \| `null`; `orbit?`: \{ `axis?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}; `speed?`: `number`; \} \| `null`; \}

The `forces` module.

###### forces.constantForce?

\{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}

Defaults to `(0, 0, 0)`.

###### forces.constantForce.x?

`number`

The x component.

###### forces.constantForce.y?

`number`

The y component.

###### forces.constantForce.z?

`number`

The z component.

###### forces.drag?

`number`

Defaults to `0`.

###### forces.gravity?

\{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \} \| `null`

An explicit gravity, or `null`/omitted to scale the app's.

###### forces.gravityMultiplier?

`number`

Defaults to `0`.

###### forces.noise?

\{ `frequency?`: `number`; `influenceOverLife?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: ... \| ...; \}; \}; `octaves?`: `number`; `scroll?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}; `strength?`: `number`; \} \| `null`

Defaults to none.

###### forces.orbit?

\{ `axis?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}; `speed?`: `number`; \} \| `null`

Defaults to none.

###### format?

`string`

Always `"ignifx.particles"` when present.

###### formatVersion?

`number`

The document version.

###### main?

\{ `capacity?`: `number`; `duration?`: `number`; `looping?`: `boolean`; `playOnAwake?`: `boolean`; `prewarm?`: `boolean`; `renderOrder?`: `number`; `seed?`: `number`; `simulationSpace?`: `"local"` \| `"world"`; `startDelay?`: `number`; `timeScale?`: `number`; \}

The `main` module.

###### main.capacity?

`number`

See [ParticleMain.capacity](#capacity-1). Defaults to `1000`.

###### main.duration?

`number`

See [ParticleMain.duration](#duration). Defaults to `5`.

###### main.looping?

`boolean`

See [ParticleMain.looping](#looping). Defaults to `true`.

###### main.playOnAwake?

`boolean`

See [ParticleMain.playOnAwake](#playonawake). Defaults to `true`.

###### main.prewarm?

`boolean`

See [ParticleMain.prewarm](#prewarm). Defaults to `false`.

###### main.renderOrder?

`number`

See [ParticleMain.renderOrder](#renderorder). Defaults to `0`.

###### main.seed?

`number`

See [ParticleMain.seed](#seed-3). Defaults to `0`.

###### main.simulationSpace?

`"local"` \| `"world"`

See [ParticleMain.simulationSpace](#simulationspace). Defaults to `"local"`.

###### main.startDelay?

`number`

See [ParticleMain.startDelay](#startdelay). Defaults to `0`.

###### main.timeScale?

`number`

See [ParticleMain.timeScale](#timescale). Defaults to `1`.

###### overLifetime?

\{ `color?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \} \| \{ `max?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; `min?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; \} \| \{ `gradient?`: readonly [`GradientStop`](#gradientstop)[]; \} \| `null`; `rotation?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`; `size?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`; `sizeY?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`; `sizeZ?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`; \}

The `overLifetime` module.

###### overLifetime.color?

readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \} \| \{ `max?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; `min?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; \} \| \{ `gradient?`: readonly [`GradientStop`](#gradientstop)[]; \} \| `null`

A gradient, or a constant tint.

###### overLifetime.rotation?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`

Angular speed in degrees per second.

###### overLifetime.size?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`

A curve or constant multiplier.

###### overLifetime.sizeY?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`

A separate Y multiplier.

###### overLifetime.sizeZ?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \} \| `null`

A separate Z multiplier.

###### renderer?

\{ `blend?`: `"premultiplied"` \| `"additive"` \| `"alpha"`; `lengthScale?`: `number`; `lit?`: `boolean`; `mesh?`: `"sphere"` \| `"box"` \| `"plane"` \| `"cylinder"` \| `"capsule"` \| `"torus"`; `mode?`: `"mesh"` \| `"billboard"` \| `"stretched"` \| `"horizontal"` \| `"vertical"`; `pivot?`: \{ `x?`: `number`; `y?`: `number`; \}; `sheet?`: \{ `frameOverTime?`: `number` \| `"random"` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: ... \| ...; \}; \} \| \{ `fps?`: `number`; \}; `tiles?`: \{ `x?`: `number`; `y?`: `number`; \}; \} \| `null`; `speedScale?`: `number`; `texture?`: `string` \| `null`; \}

The `renderer` module.

###### renderer.blend?

`"premultiplied"` \| `"additive"` \| `"alpha"`

Defaults to `"premultiplied"`.

###### renderer.lengthScale?

`number`

Defaults to `1`.

###### renderer.lit?

`boolean`

Defaults to `false`.

###### renderer.mesh?

`"sphere"` \| `"box"` \| `"plane"` \| `"cylinder"` \| `"capsule"` \| `"torus"`

Defaults to `"box"`.

###### renderer.mode?

`"mesh"` \| `"billboard"` \| `"stretched"` \| `"horizontal"` \| `"vertical"`

Defaults to `"billboard"`.

###### renderer.pivot?

\{ `x?`: `number`; `y?`: `number`; \}

Defaults to `(0, 0)`.

###### renderer.pivot.x?

`number`

The x component.

###### renderer.pivot.y?

`number`

The y component.

###### renderer.sheet?

\{ `frameOverTime?`: `number` \| `"random"` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: ... \| ...; \}; \} \| \{ `fps?`: `number`; \}; `tiles?`: \{ `x?`: `number`; `y?`: `number`; \}; \} \| `null`

Defaults to `null`.

###### renderer.speedScale?

`number`

Defaults to `0`.

###### renderer.texture?

`string` \| `null`

Defaults to `null`.

###### shape?

\{ `angle?`: `number`; `arc?`: `number`; `emitFrom?`: `"volume"` \| `"shell"` \| `"base"`; `kind?`: `"point"` \| `"sphere"` \| `"hemisphere"` \| `"cone"` \| `"box"` \| `"circle"` \| `"edge"` \| `"mesh"`; `length?`: `number`; `radius?`: `number`; `randomDirection?`: `number`; `size?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}; `spherizeDirection?`: `number`; `thickness?`: `number`; `vertices?`: readonly `number`[]; \}

The `shape` module.

###### shape.angle?

`number`

See [ParticleShape.angle](#angle). Defaults to `25`.

###### shape.arc?

`number`

See [ParticleShape.arc](#arc). Defaults to `360`.

###### shape.emitFrom?

`"volume"` \| `"shell"` \| `"base"`

See [ParticleShape.emitFrom](#emitfrom). Defaults to `"base"` for a cone and `"volume"` otherwise.

###### shape.kind?

`"point"` \| `"sphere"` \| `"hemisphere"` \| `"cone"` \| `"box"` \| `"circle"` \| `"edge"` \| `"mesh"`

Which shape. Defaults to `"cone"`.

###### shape.length?

`number`

See [ParticleShape.length](#length). Defaults to `1`.

###### shape.radius?

`number`

See [ParticleShape.radius](#radius). Defaults to `0.2`.

###### shape.randomDirection?

`number`

See [ParticleShape.randomDirection](#randomdirection). Defaults to `0`.

###### shape.size?

\{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \}

See [ParticleShape.size](#size-3). Defaults to `(1, 1, 1)`.

###### shape.size.x?

`number`

The x component.

###### shape.size.y?

`number`

The y component.

###### shape.size.z?

`number`

The z component.

###### shape.spherizeDirection?

`number`

See [ParticleShape.spherizeDirection](#spherizedirection). Defaults to `0`.

###### shape.thickness?

`number`

See [ParticleShape.thickness](#thickness). Defaults to `1`.

###### shape.vertices?

readonly `number`[]

A `"mesh"` shape's triangles, nine numbers per triangle.

###### start?

\{ `color?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \} \| \{ `max?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; `min?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; \} \| \{ `gradient?`: readonly [`GradientStop`](#gradientstop)[]; \}; `lifetime?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}; `rotation?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}; `size?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}; `size3D?`: \{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \} \| `null`; `speed?`: `number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}; \}

The `start` module.

###### start.color?

readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \} \| \{ `max?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; `min?`: readonly \[`number`, `number`, `number`, `number`\] \| \{ `a?`: `number`; `b?`: `number`; `g?`: `number`; `r?`: `number`; \}; \} \| \{ `gradient?`: readonly [`GradientStop`](#gradientstop)[]; \}

Defaults to opaque white.

###### start.lifetime?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}

Defaults to `2`.

###### start.rotation?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}

Defaults to `0`.

###### start.size?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}

Defaults to `0.2`.

###### start.size3D?

\{ `x?`: `number`; `y?`: `number`; `z?`: `number`; \} \| `null`

Defaults to `null`.

###### start.speed?

`number` \| \{ `max?`: `number`; `min?`: `number`; \} \| \{ `curve?`: \{ `keys?`: readonly `CurveKey`[]; \}; \}

Defaults to `2`.

#### Returns

[`ParticleDefinition`](#particledefinition-3)

The definition, validated and baked.

#### Throws

IgnifxError with code `IGX-1704` for an unknown preset, or `IGX-1701` when the overrides
make the document invalid.

#### Example

```ts
const bigFire = particleDefinition("fire", { start: { size: { min: 0.8, max: 1.2 } } });
```

***

### particlePresetInput()

> **particlePresetInput**(`name`): [`ParticleDefinitionInput`](#particledefinitioninput)

The document a preset starts from, before any override.

#### Parameters

##### name

`"fire"` \| `"smoke"` \| `"sparks"` \| `"explosion"` \| `"dust"` \| `"sparkle"` \| `"rain"` \| `"snow"` \| `"leaves"`

The preset.

#### Returns

[`ParticleDefinitionInput`](#particledefinitioninput)

A fresh copy of the authored document.

#### Throws

IgnifxError with code `IGX-1704` for a name that is not a preset.

***

### particlesError()

> **particlesError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`ParticlesErrorCode`](#particleserrorcode-1)

The code from the `ParticlesErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`ParticlesErrorOptions`](#particleserroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to reject with.

#### Example

```ts
throw particlesError(ParticlesErrorCode.unknownPreset, "lava is not a particle preset.", {
  context: { preset: "lava" },
});
```

***

### particlesFileSchema()

> **particlesFileSchema**(): `Schema`

The `ignifx.particles` document schema.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

***

### particleShaderAddress()

> **particleShaderAddress**(`source`): `string`

**`Beta`**

The `data:` address the generated program is published under, so the core shader loader — the
only path that also loads core's shader adapter — reads it with no file and no network. Two
definitions that generate the same program share one address, and so one `ShaderAsset`.

#### Parameters

##### source

`string`

The generated WGSL, which is ASCII.

#### Returns

`string`

A `data:text/plain;base64,…` URL.

***

### particlesSettingsSchema()

> **particlesSettingsSchema**(): `Schema`

The schema the `particles` section is validated against.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

***

### particleUnits()

> **particleUnits**(`seed`, `out`, `scratch`): `Float32Array`

**`Beta`**

The three unit floats every per-particle derivation reads from a record's `seed`: the start
colour pick, the angular speed pick, and the sheet's random frame.

#### Parameters

##### seed

`number`

The record's `seed` word.

##### out

`Float32Array`

Receives three floats in `[0, 1)`.

##### scratch

`Uint32Array`

Three words of scratch space.

#### Returns

`Float32Array`

`out`.

***

### pcg3d()

> **pcg3d**(`x`, `y`, `z`, `out`): `Uint32Array`

**`Beta`**

Hashes three 32-bit words into three others, bit-identically to the WGSL `pcg3d`.

#### Parameters

##### x

`number`

The first lane; any number, wrapped to `u32`.

##### y

`number`

The second lane.

##### z

`number`

The third lane.

##### out

`Uint32Array`

Receives the three hashed words.

#### Returns

`Uint32Array`

`out`.

***

### readScalarRow()

> **readScalarRow**(`definition`, `row`, `life`, `channel`, `fallback`): `number`

**`Beta`**

Reads a scalar row's decoded value at a normalized time.

#### Parameters

##### definition

[`ParticleDefinition`](#particledefinition-3)

The definition.

##### row

[`LookupRow`](#lookuprow) \| `null`

The row, or `null` to return `fallback`.

##### life

`number`

The normalized time.

##### channel

`number`

Which channel holds the value.

##### fallback

`number`

What to return when the row is absent.

#### Returns

`number`

The decoded value.

***

### recordSeed()

> **recordSeed**(`systemSeed`, `index`, `scratch`): `number`

**`Beta`**

The `seed` word a record gets from the system seed and its index.

#### Parameters

##### systemSeed

`number`

The system's seed.

##### index

`number`

The record's index since `play()`.

##### scratch

`Uint32Array`

Three words of scratch space.

#### Returns

`number`

The record seed.

***

### resolveColor()

> **resolveColor**(`value`, `unit`, `t`, `out`): `Float32Array`

The colour a random or constant start colour resolves to for one particle, in sRGB, without
allocating. A gradient start colour samples at `t`.

#### Parameters

##### value

[`ColorValue`](#colorvalue)

The colour value.

##### unit

`number`

A uniform random number in `[0, 1)`; picks between `min` and `max`.

##### t

`number`

The normalized cycle time, for a gradient.

##### out

`Float32Array`

Receives `r, g, b, a`.

#### Returns

`Float32Array`

`out`.

***

### resolveScalar()

> **resolveScalar**(`value`, `unit`, `t`): `number`

Resolves a scalar at spawn: the constant, a pick inside the range by `unit`, or the curve sampled
at `t` (the normalized position in the emission cycle).

#### Parameters

##### value

[`ScalarValue`](#scalarvalue)

The scalar.

##### unit

`number`

A uniform random number in `[0, 1)`.

##### t

`number`

The normalized cycle time, for a curve.

#### Returns

`number`

The resolved number.

***

### sampleRow()

> **sampleRow**(`samples`, `t`): `number`

Samples a baked scalar row with the linear rule both evaluators share: `x = t * 63`, then a lerp
between samples `floor(x)` and `floor(x) + 1`.

#### Parameters

##### samples

`Float32Array`

A row of [LOOKUP\_SAMPLES](#lookup_samples) floats.

##### t

`number`

The normalized time, clamped to `[0, 1]`.

#### Returns

`number`

The interpolated value.

***

### sampleShape()

> **sampleShape**(`shape`, `rng`, `mesh`, `position`, `direction`): `void`

**`Beta`**

Samples a start position and direction from a shape.

#### Parameters

##### shape

[`ParticleShape`](#particleshape)

The shape module.

##### rng

[`EmitterRandom`](#emitterrandom)

The emitter's random stream.

##### mesh

[`MeshShapeTable`](#meshshapetable) \| `null`

The triangle table, for a `"mesh"` shape; ignored otherwise.

##### position

`Float32Array`

Receives the local position.

##### direction

`Float32Array`

Receives the unit direction.

#### Returns

`void`

***

### scalarMax()

> **scalarMax**(`value`): `number`

The largest value a scalar can produce.

#### Parameters

##### value

[`ScalarValue`](#scalarvalue)

The scalar.

#### Returns

`number`

The maximum.

***

### scalarMin()

> **scalarMin**(`value`): `number`

The smallest value a scalar can produce: the constant, the range's `min`, or the curve's minimum.

#### Parameters

##### value

[`ScalarValue`](#scalarvalue)

The scalar.

#### Returns

`number`

The minimum.

***

### srgbToLinear()

> **srgbToLinear**(`value`): `number`

Decodes an sRGB channel to linear — the exact formula the generated WGSL uses, so the CPU
evaluator and the shader agree (`Color.srgbToLinear` in core is the same function; it is
restated here so the two hosts can be read side by side).

#### Parameters

##### value

`number`

The sRGB channel in `0`–`1`.

#### Returns

`number`

The linear channel.

# @ignifx/particles-2d

`@ignifx/particles-2d` public barrel: the `ParticleSystem2D` component, the `particles2D()`
extension, and the service that shares `app.particles`' budget with the 3D systems
(`docs/plan/2026-09-terrain-particles-shaders.md` §4.3).

Explicit named re-exports only — no `export *` (coding standards §4). The package imports nothing
from `@babylonjs/lite`: it draws through `@ignifx/2d`'s `SpriteBatch` and simulates with
`@ignifx/particles`' emitter core and evaluator.

## Classes

### Particles2DService

The 2D particles service: the live system list, the shared budget, and the counters.

#### Example

```ts
app.particles.qualityScale = 0.5; // halves emission for 2D and 3D systems alike
```

#### Constructors

##### Constructor

> **new Particles2DService**(`particles`, `twoD`, `sortingLayers`): [`Particles2DService`](#particles2dservice)

Creates the service.

###### Parameters

###### particles

`ParticlesService`

The shared budget, from `ctx.require(ParticlesService)`.

###### twoD

`TwoDService`

The sprite-layer service batches are claimed from.

###### sortingLayers

readonly `string`[]

The project's declared sorting layers, for `IGX-1756`.

###### Returns

[`Particles2DService`](#particles2dservice)

#### Properties

##### particles

> `readonly` **particles**: `ParticlesService`

The 3D particles service every capacity reservation goes through.

#### Accessors

##### counters

###### Get Signature

> **get** **counters**(): `DiagnosticsGroup` \| `null`

The `particles-2d` diagnostics group, once the extension registered it.

###### Returns

`DiagnosticsGroup` \| `null`

The group, or `null` before registration.

##### gravity

###### Get Signature

> **get** **gravity**(): `Vec3Like`

The world gravity a definition's `gravityMultiplier` scales, in metres per second squared.

###### Returns

`Vec3Like`

`app.particles.gravity`.

##### qualityScale

###### Get Signature

> **get** **qualityScale**(): `number`

The `0`–`1` emission multiplier `app.particles` holds.

###### Returns

`number`

The multiplier.

##### systems

###### Get Signature

> **get** **systems**(): readonly [`ParticleSystem2D`](#particlesystem2d)[]

Every attached `ParticleSystem2D`, in attach order.

###### Returns

readonly [`ParticleSystem2D`](#particlesystem2d)[]

The live list; iterate it without copying.

#### Methods

##### dispose()

> **dispose**(): `void`

Forgets every attached system. The extension calls it on dispose.

###### Returns

`void`

***

### ParticleSystem2D

Draws a `.particles.json` effect as sprites on a sorting layer.

#### Remarks

The document is simulated exactly as the 3D `ParticleSystem` simulates it, then flattened: X and
Y become the sprite's centre in world metres and the evaluated Z is dropped, because 2D draws in
sorting-layer order rather than by depth (`docs/architecture/11-2d-toolkit.md` §3). Sizes are
world metres, the tint is linear, and `renderer.texture`, `mode`, `lit` and `pivot` are ignored —
the frames come from [ParticleSystem2D.atlas](#atlas).

#### Example

```ts
const torch = app.world.createEntity("torch");
const system = torch.addComponent(ParticleSystem2D, { definition: fire, atlas: sparks });
system.emit(20);
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new ParticleSystem2D**(): [`ParticleSystem2D`](#particlesystem2d)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`ParticleSystem2D`](#particlesystem2d)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several effects may share one entity; each owns its own batch.

##### atlas

> **atlas**: `AssetHandle`\<`SpriteAtlasAsset`\> \| `null`

The atlas every particle draws a frame of; it must be loaded before anything is drawn.

###### Remarks

The document's sheet tile index is the atlas frame index: `renderer.sheet.tiles` of
`{ x: 2, y: 2 }` picks frames 0–3, counted across rows. A document with no `sheet`, and a frame
the atlas does not have, both draw frame 0.

##### definition

> **definition**: `AssetHandle`\<`ParticleAsset`\> \| `null`

The `.particles.json`, as a loaded handle.

##### onStopped

> `readonly` **onStopped**: `Signal`\<[`ParticleSystem2D`](#particlesystem2d)\>

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

##### sortingLayer

> **sortingLayer**: `string`

Which sorting layer the particles draw on.

##### typeId

> `static` **typeId**: `string` = `"ignifx/ParticleSystem2D"`

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

> **get** **asset**(): `ParticleAsset` \| `null`

The loaded document, or `null` while the handle is loading or unset.

###### Returns

`ParticleAsset` \| `null`

The asset.

##### capacity

###### Get Signature

> **get** **capacity**(): `number`

The ring capacity in use, after `app.particles`' budget clamped the definition's.

###### Returns

`number`

The capacity, or `0` before a definition is applied.

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

##### spriteCount

###### Get Signature

> **get** **spriteCount**(): `number`

How many sprite slots the last frame wrote: the alive particles the batch is drawing.

###### Returns

`number`

The count.

##### time

###### Get Signature

> **get** **time**(): `number`

The system-local clock, in seconds — what every particle's age is measured against.

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

IgnifxError with code `IGX-1753` for a negative or non-finite count, or `IGX-1752`
when no definition is applied.

##### evaluate()

> **evaluate**(`slot`, `out?`): `boolean`

**`Beta`**

Evaluates one spawn record at the current clock — the same arithmetic the 3D system's shader
runs, for tests and tools.

###### Parameters

###### slot

`number`

The record's slot in the ring.

###### out?

`ParticleState` = `...`

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

Releases the batch, the budget, and the core.

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

IgnifxError with code `IGX-1753` for a negative or non-finite duration, or `IGX-1752`
when no definition is applied.

##### stop()

> **stop**(`options?`): `void`

Stops emitting. Live particles finish their lives unless `clear` is set.

###### Parameters

###### options?

`ParticleStopOptions`

Whether to clear the particles too.

###### Returns

`void`

## Interfaces

### Particles2DErrorOptions

Options accepted by [particles2DError](#particles2derror): the same subset of `IgnifxErrorOptions` this
package uses.

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

## Type Aliases

### Particles2DErrorCode

> **Particles2DErrorCode** = *typeof* [`Particles2DErrorCode`](#particles2derrorcode)\[keyof *typeof* [`Particles2DErrorCode`](#particles2derrorcode)\]

The union of the codes the `Particles2DErrorCode` table declares.

## Variables

### PARTICLE\_2D\_UPDATE\_ORDER

> `const` **PARTICLE\_2D\_UPDATE\_ORDER**: `900` = `900`

Where the update system sits in `Update`: the same place `@ignifx/particles` puts its own.

***

### PARTICLE\_2D\_WRITE\_ORDER

> `const` **PARTICLE\_2D\_WRITE\_ORDER**: `-460` = `-460`

Where the write system sits in `PreRender`: before `@ignifx/2d`'s sprite sync (`-450`).

***

### PARTICLES\_2D\_DIAGNOSTICS\_COUNTERS

> `const` **PARTICLES\_2D\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters the group carries, in index order.

***

### PARTICLES\_2D\_DIAGNOSTICS\_GROUP

> `const` **PARTICLES\_2D\_DIAGNOSTICS\_GROUP**: `"particles-2d"` = `"particles-2d"`

The diagnostics group name.

***

### PARTICLES\_2D\_ERROR\_MESSAGES

> `const` **PARTICLES\_2D\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### particles2D

> `const` **particles2D**: () => `Extension`

The `@ignifx/particles-2d` extension factory.

#### Returns

`Extension`

The extension descriptor to pass to `createApp`.

#### Example

```ts
const app = await createApp({ canvas, extensions: [twoD(), particles(), particles2D()] });
```

***

### Particles2DErrorCode

> `const` **Particles2DErrorCode**: `object`

Every diagnostic code `@ignifx/particles-2d` can throw or log, keyed by an intention-revealing
name so call sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### atlasNotLoaded

> `readonly` **atlasNotLoaded**: `"IGX-1754"` = `"IGX-1754"`

A `ParticleSystem2D` has a definition but no loaded atlas, so it draws nothing.

##### duplicateExtension

> `readonly` **duplicateExtension**: `"IGX-1751"` = `"IGX-1751"`

A second `particles2D()` extension was registered on one app.

##### extensionMissing

> `readonly` **extensionMissing**: `"IGX-1755"` = `"IGX-1755"`

A `ParticleSystem2D` was attached to an app that never registered `particles2D()`.

##### invalidArgument

> `readonly` **invalidArgument**: `"IGX-1753"` = `"IGX-1753"`

`emit` or `simulate` was given a value that is not a finite number in range.

##### noDefinition

> `readonly` **noDefinition**: `"IGX-1752"` = `"IGX-1752"`

A `ParticleSystem2D` method that needs a definition ran without one.

##### unknownSortingLayer

> `readonly` **unknownSortingLayer**: `"IGX-1756"` = `"IGX-1756"`

A `ParticleSystem2D` names a sorting layer the project does not declare; `"Default"` was used.

#### Example

```ts
throw particles2DError(Particles2DErrorCode.noDefinition, "torch has no definition.", {
  context: { entity: "torch", method: "play" },
});
```

***

### VERSION

> `const` **VERSION**: `"0.2.1"` = `"0.2.1"`

The `@ignifx/particles-2d` version this build was cut from.

## Functions

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component this package declares.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The records, keyed by namespaced type id.

#### Example

```ts
const schemas = describeSchemas();
schemas["ignifx/ParticleSystem2D"].fields["sortingLayer"].default; // "Default"
```

***

### particles2DError()

> **particles2DError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`Particles2DErrorCode`](#particles2derrorcode-1)

The code from the `Particles2DErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`Particles2DErrorOptions`](#particles2derroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to reject with.

#### Example

```ts
throw particles2DError(Particles2DErrorCode.invalidArgument, "emit needs a count, not -1.", {
  context: { method: "emit", expected: "a finite non-negative count", value: -1 },
});
```

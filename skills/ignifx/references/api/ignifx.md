# ignifx

`ignifx` public barrel: the umbrella entry point that re-exports `@ignifx/core` and, as each
phase lands, the standard extensions (`docs/architecture/00-overview.md` §2). Every symbol is
re-exported by name — no `export *` (coding standards §4).

Only the core surface exists today. The input, physics, physics-2d, audio, 2d, 3d, and ui
re-exports and the one-call `createGame()` arrive with the phases of
`docs/plan/engineering-plan.md` that populate those packages.

## Classes

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

- [`Script`](#abstract-script)
- [`Transform`](#transform-3)

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

> **get** **entity**(): [`Entity`](#entity-1)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-1)

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

[`SignalOwner`](#signalowner).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Implementation of

[`SignalOwner`](#signalowner).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-3)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-3)

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

> **get** **world**(): [`World`](#world-6)

The world the entity belongs to.

###### Returns

[`World`](#world-6)

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

The group, whose indices are resolved once with [DiagnosticsGroup.index](#index).

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

> **get** **children**(): readonly [`Entity`](#entity-1)[]

The children, in creation order. The array is live; treat it as read-only.

###### Returns

readonly [`Entity`](#entity-1)[]

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

> **get** **onActiveChanged**(): [`Signal`](#signal)\<`boolean`\>

Emitted with the new value when the entity's **own** active flag changes. An ancestor's change
does not emit it; read `activeInHierarchy` for the effective state.

###### Returns

[`Signal`](#signal)\<`boolean`\>

The signal, created on first access.

##### onChildAdded

###### Get Signature

> **get** **onChildAdded**(): [`Signal`](#signal)\<[`Entity`](#entity-1)\>

Emitted after a child is added, whether by creation or by reparenting.

###### Returns

[`Signal`](#signal)\<[`Entity`](#entity-1)\>

The signal, created on first access.

##### onChildRemoved

###### Get Signature

> **get** **onChildRemoved**(): [`Signal`](#signal)\<[`Entity`](#entity-1)\>

Emitted after a child is removed.

###### Returns

[`Signal`](#signal)\<[`Entity`](#entity-1)\>

The signal, created on first access.

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal)\<[`Entity`](#entity-1)\>

Emitted in the destroy flush, after the entity's components have run `onDestroy`. `Signal`'s
`{ owner }` option uses it to detach handlers automatically.

###### Returns

[`Signal`](#signal)\<[`Entity`](#entity-1)\>

The signal, created on first access.

##### onParentChanged

###### Get Signature

> **get** **onParentChanged**(): [`Signal`](#signal)\<[`Entity`](#entity-1) \| `null`\>

Emitted with the new parent after this entity is reparented.

###### Returns

[`Signal`](#signal)\<[`Entity`](#entity-1) \| `null`\>

The signal, created on first access.

##### parent

###### Get Signature

> **get** **parent**(): [`Entity`](#entity-1) \| `null`

The parent entity, or `null` when the entity is a root of its scene.

###### Returns

[`Entity`](#entity-1) \| `null`

The parent, or `null`.

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

> **get** **transform**(): [`Transform`](#transform-3)

The entity's transform. Every entity has one; it can be neither removed nor disabled.

###### Returns

[`Transform`](#transform-3)

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

> **get** **world**(): [`World`](#world-6)

The world that owns the entity.

###### Returns

[`World`](#world-6)

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

> **find**(`path`): [`Entity`](#entity-1) \| `null`

Resolves a path relative to this entity — `"Body/Arm.L"`, `"../Sibling"`, `"/Root/Child"`.

###### Parameters

###### path

`string`

The path. A leading `/` resolves from the roots of this entity's scene instance;
`..` is the parent and `.` is this entity, as whole segments only, so a name may contain dots.

###### Returns

[`Entity`](#entity-1) \| `null`

The entity, or `null` when the path resolves to nothing.

###### Remarks

Deliberately fragile, and allowed only in tests, examples, and tools: the
`ignifx/no-entity-find-in-src` rule flags it anywhere else. Use `entityRef`/`componentRef`
fields or `requireComponent` to link objects (`docs/architecture/02-scene-graph.md` §4).

##### findChild()

> **findChild**(`predicate`, `deep?`): [`Entity`](#entity-1) \| `null`

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

[`Entity`](#entity-1) \| `null`

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

[`Entity`](#entity-1)

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

> **root**(): [`Entity`](#entity-1)

The topmost ancestor.

###### Returns

[`Entity`](#entity-1)

The root of this entity's branch, which is this entity when it has no parent.

##### setParent()

> **setParent**(`parent`, `options?`): `void`

Moves the entity under a new parent, or to the root of its scene.

###### Parameters

###### parent

[`Entity`](#entity-1) \| `null`

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

Phase 1 ships the implicit `"default"` instance only. `asset` is therefore always `null` and
`isLoaded` always `true`; scene loading, additive loads, and unloading arrive in Phase 2
(`docs/plan/engineering-plan.md`).

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

> **get** **asset**(): `null`

The asset this instance was loaded from.

###### Returns

`null`

Always `null` in Phase 1: the implicit default scene has no asset, and scene loading
has not landed yet.

##### isLoaded

###### Get Signature

> **get** **isLoaded**(): `boolean`

Whether every entity of the instance has been constructed.

###### Returns

`boolean`

Always `true` in Phase 1.

##### onUnloading

###### Get Signature

> **get** **onUnloading**(): [`Signal`](#signal)

Emitted just before the instance is unloaded, while its entities are still valid.

###### Returns

[`Signal`](#signal)

The signal.

##### roots

###### Get Signature

> **get** **roots**(): readonly [`Entity`](#entity-1)[]

The instance's root entities — the ones with no parent — in creation order.

###### Returns

readonly [`Entity`](#entity-1)[]

The live root list. Its identity is stable for the instance's lifetime.

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

#### Constructors

##### Constructor

> **new Script**(): [`Script`](#abstract-script)

Creates a component. The engine constructs components; game code never calls `new`.

###### Returns

[`Script`](#abstract-script)

###### Inherited from

[`Component`](#abstract-component).[`constructor`](#constructor-1)

#### Accessors

##### app

###### Get Signature

> **get** **app**(): [`App`](#app)

The app that owns the world.

###### Returns

[`App`](#app)

The app.

###### Inherited from

[`Component`](#abstract-component).[`app`](#app-1)

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

[`Component`](#abstract-component).[`enabled`](#enabled)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-1)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-1)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity)

##### handle

###### Get Signature

> **get** **handle**(): [`ComponentHandle`](#componenthandle-1)

The dense runtime handle; invalid after destruction.

###### Returns

[`ComponentHandle`](#componenthandle-1)

The handle.

###### Inherited from

[`Component`](#abstract-component).[`handle`](#handle)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy)

##### onDestroyed

###### Get Signature

> **get** **onDestroyed**(): [`Signal`](#signal)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed)

##### transform

###### Get Signature

> **get** **transform**(): [`Transform`](#transform-3)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-3)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid)

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-6)

The world the entity belongs to.

###### Returns

[`World`](#world-6)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-1)

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

[`Component`](#abstract-component).[`define`](#define)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Component`](#abstract-component).[`destroy`](#destroy)

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

[`Component`](#abstract-component).[`getComponent`](#getcomponent)

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

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent)

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

The handle [Script.startCoroutine](#startcoroutine) returned.

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

> **new Signal**\<`T`\>(`options?`): [`Signal`](#signal)\<`T`\>

Creates a signal.

###### Parameters

###### options?

[`SignalOptions`](#signaloptions)\<`T`\>

The deferred-delivery scheduler and the handler-error reporter. Both are
supplied by the app for engine signals; a signal a script owns usually needs neither.

###### Returns

[`Signal`](#signal)\<`T`\>

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

> **new Transform**(): [`Transform`](#transform-3)

Creates an unbound transform. The entity constructor binds it to a Lite node immediately.

###### Returns

[`Transform`](#transform-3)

###### Overrides

[`Component`](#abstract-component).[`constructor`](#constructor-1)

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

[`Component`](#abstract-component).[`app`](#app-1)

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

[`Component`](#abstract-component).[`enabled`](#enabled)

##### entity

###### Get Signature

> **get** **entity**(): [`Entity`](#entity-1)

The entity this component is attached to.

###### Returns

[`Entity`](#entity-1)

The owning entity.

###### Inherited from

[`Component`](#abstract-component).[`entity`](#entity)

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

[`Component`](#abstract-component).[`handle`](#handle)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

Whether the owner has already been destroyed.

###### Inherited from

[`Component`](#abstract-component).[`isDestroyed`](#isdestroyed)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Component`](#abstract-component).[`isEnabledInHierarchy`](#isenabledinhierarchy)

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

> **get** **onDestroyed**(): [`Signal`](#signal)\<[`Component`](#abstract-component)\>

Emitted once when the component is destroyed, in the destroy flush. Connecting with
`{ owner: this }` elsewhere uses it to detach handlers automatically
(`docs/architecture/02-scene-graph.md` §8).

###### Returns

[`Signal`](#signal)\<[`Component`](#abstract-component)\>

The signal. It is created on first access, so a component nobody listens to allocates
nothing.

Emitted once when the owner is destroyed; the signal uses it to detach the handler.

###### Remarks

Typed as [SignalLike](#signallike) rather than [Signal](#signal) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

###### Inherited from

[`Component`](#abstract-component).[`onDestroyed`](#ondestroyed)

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

> **get** **transform**(): [`Transform`](#transform-3)

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

[`Transform`](#transform-3)

The entity's transform.

###### Inherited from

[`Component`](#abstract-component).[`transform`](#transform)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Component`](#abstract-component).[`uid`](#uid)

##### up

###### Get Signature

> **get** **up**(): [`Vec3`](#vec3-4)

The world unit vector pointing along the entity's local +Y.

###### Returns

[`Vec3`](#vec3-4)

A freshly allocated vector. Use `Transform.upToRef` in hot code.

##### world

###### Get Signature

> **get** **world**(): [`World`](#world-6)

The world the entity belongs to.

###### Returns

[`World`](#world-6)

The world.

###### Inherited from

[`Component`](#abstract-component).[`world`](#world-1)

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

[`Component`](#abstract-component).[`define`](#define)

##### destroy()

> **destroy**(): `void`

A transform cannot be destroyed on its own.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-0205`. Destroy the entity instead.

###### Overrides

[`Component`](#abstract-component).[`destroy`](#destroy)

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

[`Component`](#abstract-component).[`getComponent`](#getcomponent)

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

[`Component`](#abstract-component).[`requireComponent`](#requirecomponent)

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
[Vec3.right](#right-1) is `(1, 0, 0)`.

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

`true` once [World.dispose](#dispose-3) has run.

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

> **get** **lite**(): `object`

Babylon Lite objects the world owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

###### Returns

`object`

The render scene, and the physics simulation scene once `@ignifx/physics` creates one.

###### scene

> `readonly` **scene**: `SceneContext`

###### simulationScene

> `readonly` **simulationScene**: `null`

##### onEntityCreated

###### Get Signature

> **get** **onEntityCreated**(): [`Signal`](#signal)\<[`Entity`](#entity-1)\>

Emitted for every entity the world creates.

###### Returns

[`Signal`](#signal)\<[`Entity`](#entity-1)\>

The signal.

##### onEntityDestroyed

###### Get Signature

> **get** **onEntityDestroyed**(): [`Signal`](#signal)\<[`Entity`](#entity-1)\>

Emitted for every entity the destroy flush releases.

###### Returns

[`Signal`](#signal)\<[`Entity`](#entity-1)\>

The signal.

##### onSceneLoaded

###### Get Signature

> **get** **onSceneLoaded**(): [`Signal`](#signal)\<[`SceneInstance`](#sceneinstance)\>

Emitted when a scene instance finishes loading. Never fires before Phase 2.

###### Returns

[`Signal`](#signal)\<[`SceneInstance`](#sceneinstance)\>

The signal.

##### onSceneUnloaded

###### Get Signature

> **get** **onSceneUnloaded**(): [`Signal`](#signal)\<[`SceneInstance`](#sceneinstance)\>

Emitted when a scene instance is unloaded. Never fires before Phase 2.

###### Returns

[`Signal`](#signal)\<[`SceneInstance`](#sceneinstance)\>

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

> **get** **world**(): [`World`](#world-6)

The world itself; `WorldHost` names it so entities can reach it.

###### Returns

[`World`](#world-6)

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

> **createEntity**(`name?`, `options?`): [`Entity`](#entity-1)

Creates an entity with a transform and a Lite node.

###### Parameters

###### name?

`string`

The display name; defaults to `"Entity"`.

###### options?

[`CreateEntityOptions`](#createentityoptions)

The parent, the owning scene, and an initial world position and rotation.

###### Returns

[`Entity`](#entity-1)

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

> **findAllByName**(`name`): [`Entity`](#entity-1)[]

Every entity with a name, depth-first from the roots of every scene.

###### Parameters

###### name

`string`

The name to match exactly.

###### Returns

[`Entity`](#entity-1)[]

A freshly allocated array; empty when nothing matches.

##### findByName()

> **findByName**(`name`): [`Entity`](#entity-1) \| `null`

The first entity with a name, depth-first from the roots of every scene.

###### Parameters

###### name

`string`

The name to match exactly.

###### Returns

[`Entity`](#entity-1) \| `null`

The first match, or `null`.

###### Remarks

Linear in the number of entities, and names are not unique: this is a prototyping and tooling
convenience, not a lookup the engine itself uses
(`docs/architecture/02-scene-graph.md` §4).

##### findByTag()

> **findByTag**(`tag`): readonly [`Entity`](#entity-1)[]

Every entity carrying a tag.

###### Parameters

###### tag

`string`

The tag.

###### Returns

readonly [`Entity`](#entity-1)[]

The live list of tagged entities. A tag nothing carries yields a shared frozen empty
array.

###### Remarks

Indexed, not searched: the world maintains one array per tag as `tags.add`/`tags.delete` run
and as entities are destroyed, so this is O(1) to obtain and allocates nothing. The array is
**live** and its identity is stable for the tag's lifetime in this world, so it can be cached
in `awake`; treat it as read-only.

##### getEntity()

> **getEntity**(`uid`): [`Entity`](#entity-1) \| `null`

Looks an entity up by its stable identifier.

###### Parameters

###### uid

`string`

The ULID.

###### Returns

[`Entity`](#entity-1) \| `null`

The entity, or `null` when nothing in this world carries that uid.

##### getEntityByHandle()

> **getEntityByHandle**(`handle`): [`Entity`](#entity-1) \| `null`

Resolves a dense runtime handle.

###### Parameters

###### handle

[`EntityHandle`](#entityhandle-1)

The handle.

###### Returns

[`Entity`](#entity-1) \| `null`

The entity, or `null` when the handle is stale — a handle kept across a destroy never
resolves to whatever entity recycled the slot.

## Interfaces

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

##### coroutines

> `readonly` **coroutines**: [`CoroutineHost`](#coroutinehost)

The coroutine scheduler.

##### diagnostics

> `readonly` **diagnostics**: [`Diagnostics`](#diagnostics-1)

Per-frame counters and profiling scopes.

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

> `readonly` **onError**: [`Signal`](#signal)\<[`ErrorReport`](#errorreport)\>

Every failure the engine caught at a boundary rather than rethrowing.

##### platform

> `readonly` **platform**: [`PlatformInfo`](#platforminfo)

Where the app is running (`docs/architecture/14-platform-electron.md` §1). Phase 1 answers only
`kind`; the rest of §1's surface arrives with `@ignifx/electron`.

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

> `readonly` **world**: [`World`](#world-6)

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

### AssetRefValue

The value an `asset()` field holds. In Phase 1 a field stores the *address*, not the loaded
handle: the assets service that turns an address into `AssetHandle<A>` arrives in Phase 2
(`docs/architecture/05-assets-and-loading.md` §3).

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

### BoolFieldSpec

Kind-specific data for `bool`.

#### Properties

##### kind

> `readonly` **kind**: `"bool"`

The boolean kind.

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

[`ComponentStatics`](#componentstatics).[`allowMultiple`](#allowmultiple-1)

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

[`ComponentStatics`](#componentstatics).[`schema`](#schema-1)

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
derived from the class name, so minification and renames cannot change a file's meaning.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`typeId`](#typeid-1)

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

[`ComponentType`](#componenttype-1).[`allowMultiple`](#allowmultiple-2)

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

[`ComponentType`](#componenttype-1).[`schema`](#schema-2)

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
derived from the class name, so minification and renames cannot change a file's meaning.

###### Inherited from

[`ComponentType`](#componenttype-1).[`typeId`](#typeid-2)

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

### CreateEntityOptions

Options accepted by [World.createEntity](#createentity).

#### Properties

##### parent?

> `readonly` `optional` **parent?**: [`Entity`](#entity-1)

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

The index from [DiagnosticsGroup.index](#index).

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

The index from [DiagnosticsGroup.index](#index).

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

The index to pass to [DiagnosticsGroup.get](#get-1), `set`, and `add`.

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

The index from [DiagnosticsGroup.index](#index).

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

> `readonly` **entity**: [`Entity`](#entity-1) \| `null`

The entity involved, or `null` when the failure is not entity-scoped.

##### error

> `readonly` **error**: `unknown`

Whatever was thrown. Usually an `Error`, often an `IgnifxError`.

##### phase

> `readonly` **phase**: [`Phase`](#phase-2) \| `null`

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

##### onDispose()

> **onDispose**(`callback`): `void`

Registers a callback that runs when the app is disposed.

###### Parameters

###### callback

() => `void`

The teardown to run.

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

[`Schema`](#schema-4)

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

### IgnifxErrorOptions

Options accepted by [IgnifxError](#ignifxerror). Extends the standard `ErrorOptions`, so `cause` keeps
the original failure when an error is wrapped.

#### Extends

- `ErrorOptions`

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

### ProfileScope

A timing scope opened by [Diagnostics.profile](#profile). Ending it twice is a no-op.

#### Remarks

Scopes are pooled per nesting depth, so opening one allocates nothing after the first frame, and
outside development builds `profile` returns a shared scope that does nothing at all.

#### Properties

##### durationMs

> `readonly` **durationMs**: `number`

How long the scope was open, in milliseconds of the diagnostics clock. Valid between
[ProfileScope.end](#end) and the next [Diagnostics.profile](#profile) call at the same nesting
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

### RecordFieldSpec

Kind-specific data for `record`.

#### Properties

##### fields

> `readonly` **fields**: [`Schema`](#schema-4)

The sub-fields, in declaration order.

##### kind

> `readonly` **kind**: `"record"`

The record kind.

***

### ReferenceDecoder

How the loader turns a uid read from a file back into a live entity or component.

#### Methods

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

> `readonly` **phase**: [`Phase`](#phase-2)

Which phase the system runs in.

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

[`ComponentStatics`](#componentstatics).[`allowMultiple`](#allowmultiple-1)

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

[`ComponentStatics`](#componentstatics).[`schema`](#schema-1)

##### typeId?

> `readonly` `optional` **typeId?**: `string`

The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
derived from the class name, so minification and renames cannot change a file's meaning.

###### Inherited from

[`ComponentStatics`](#componentstatics).[`typeId`](#typeid-1)

##### updateWhenPaused?

> `readonly` `optional` **updateWhenPaused?**: `boolean`

When `true`, the script still receives `update`/`lateUpdate` while `app.pause()` is in effect.
Defaults to `false`.

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

Options accepted by `Entity.setParent`.

#### Properties

##### worldPositionStays?

> `readonly` `optional` **worldPositionStays?**: `boolean`

`true` (the default) preserves the entity's world transform by rewriting its local values;
`false` keeps the local values, so the entity moves with the new parent
(`docs/architecture/02-scene-graph.md` §5.1).

***

### SignalLike

The read-only half of a [Signal](#signal): what a public API exposes when callers may subscribe but
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

Options for the [Signal](#signal) constructor, where `T` is the payload the signal emits.

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

[`Signal`](#signal)\<`T`\>

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

Typed as [SignalLike](#signallike) rather than [Signal](#signal) so that an owner may expose a precisely
typed signal — `Entity.onDestroyed` is a `Signal<Entity>` per
`docs/architecture/02-scene-graph.md` §4. `Signal` carries private state, which makes it
invariant in `T`; the read-only interface is not, and `connect` is all this contract needs.

***

### SortingLayersSettings

The `sortingLayers` project settings section, consumed by the 2D toolkit.

#### Properties

##### sortingLayers

> `readonly` **sortingLayers**: readonly `string`[]

The project's sorting-layer names, back to front.

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

[`World`](#world-6)

The new world.

###### Returns

`void`

##### onWorldDisposed()?

> `optional` **onWorldDisposed**(`world`): `void`

Called once when the world the system belongs to is being disposed.

###### Parameters

###### world

[`World`](#world-6)

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

> `readonly` **phase**: [`Phase`](#phase-2)

The phase currently running.

##### time

> `readonly` **time**: [`Time`](#time-3)

The app clock.

##### world

> `readonly` **world**: [`World`](#world-6)

The world the system operates on.

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

### WaitInstruction

A wait a coroutine yielded, built by `waitSeconds`, `waitSecondsRealtime`, `waitFixedUpdate`,
`waitUntil`, or `waitWhile`.

#### Properties

##### kind

> `readonly` **kind**: `"seconds"` \| `"secondsRealtime"` \| `"fixedUpdate"` \| `"until"` \| `"while"`

Which kind of wait this is; the scheduler switches on it.

##### predicate?

> `readonly` `optional` **predicate?**: () => `boolean`

The condition, for the two predicate kinds.

###### Returns

`boolean`

##### seconds?

> `readonly` `optional` **seconds?**: `number`

How long to wait, for the two timed kinds.

## Type Aliases

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

`S` *extends* [`Schema`](#schema-4)

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

### Disconnect

> **Disconnect** = () => `void`

Detaches a handler from a [Signal](#signal). Calling it more than once is a no-op.

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

`S` *extends* [`Schema`](#schema-4)

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

### LiteEngine

> **LiteEngine** = `EngineContext`

The Babylon Lite engine handle an ignifx app owns, re-exported under an ignifx name so that
feature code can name the type without importing `@babylonjs/lite`
(`CONSTITUTION.md` §3.4, coding standards §4).

#### Remarks

Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches, and it
is excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteScene

> **LiteScene** = `SceneContext`

The Babylon Lite scene a world renders into (or simulates on), re-exported under an ignifx name
for the same reason as [LiteEngine](#liteengine).

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

### PartialFieldsOf

> **PartialFieldsOf**\<`S`\> = `{ [K in keyof FieldsOf<S>]?: FieldsOf<S>[K] }`

The field object of a schema with every property optional, and an explicit `undefined` allowed.
`exactOptionalPropertyTypes` normally separates "absent" from "present and `undefined`"; both
mean "take the schema default" here, so both are accepted (`applyInit`, `encodeProps`).

#### Type Parameters

##### S

`S` *extends* [`Schema`](#schema-4)

The schema to project.

***

### Phase

> **Phase** = *typeof* [`Phase`](#phase-1)\[keyof *typeof* [`Phase`](#phase-1)\]

The union of the frame phases.

***

### PhaseIndex

> **PhaseIndex** = `0` \| `1` \| `2` \| `3` \| `4` \| `5`

A slot in [FrameSample.cpuMs](#cpums). The kernel's `Phase` ordinals index this array.

***

### PlatformKind

> **PlatformKind** = `"browser"` \| `"node"`

Where an app is running.

#### Remarks

`"electron"` is deliberately absent until the Electron extension can detect it reliably: an
Electron renderer is a browser as far as the kernel is concerned, and guessing from the user
agent would be worse than saying `"browser"`.

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

### ScriptDefinition

> **ScriptDefinition**\<`S`\> = () => [`Script`](#abstract-script) & [`FieldsOf`](#fieldsof)\<`S`\> & `object`

The abstract base class [Script.define](#define-1) returns: a `Script` that also carries every field
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

`S` *extends* [`Schema`](#schema-4)

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

### SignalHandler

> **SignalHandler**\<`T`\> = (`value`) => `void`

A listener attached to a [Signal](#signal).

#### Type Parameters

##### T

`T`

#### Parameters

##### value

`T`

#### Returns

`void`

## Variables

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

> `readonly` **cryptoUnavailable**: `"IGX-1401"`

The host exposes no Web Crypto implementation.

##### deferredSignalWithoutScheduler

> `readonly` **deferredSignalWithoutScheduler**: `"IGX-0103"`

A signal handler asked for deferred delivery on a signal that has no scheduler.

##### destroyImmediateInCallback

> `readonly` **destroyImmediateInCallback**: `"IGX-0102"`

`destroyImmediate()` was called from inside a lifecycle callback.

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

##### mutationAfterDestroy

> `readonly` **mutationAfterDestroy**: `"IGX-0101"`

An entity, component, or app was used after it had been destroyed or disposed.

##### nonFiniteNumber

> `readonly` **nonFiniteNumber**: `"IGX-0601"`

A serialized number was `NaN` or infinite.

##### parentingCycle

> `readonly` **parentingCycle**: `"IGX-0306"`

Reparenting an entity under its own descendant would make the scene tree cyclic.

##### requiredComponentMissing

> `readonly` **requiredComponentMissing**: `"IGX-0201"`

A component declared through `requires` is missing from the entity.

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

##### serviceNotRegistered

> `readonly` **serviceNotRegistered**: `"IGX-0405"`

`ctx.require()` asked for a service that no earlier extension registered.

##### signalHandlerThrew

> `readonly` **signalHandlerThrew**: `"IGX-0104"`

A signal handler threw and no handler-error reporter was installed.

##### stepOutsideHeadless

> `readonly` **stepOutsideHeadless**: `"IGX-0105"`

`app.step()` was called while Babylon Lite's render loop was driving the frames.

##### tooManyLayers

> `readonly` **tooManyLayers**: `"IGX-0305"`

The project settings declare more layer names than the 32 available slots.

##### transformIsNotRemovable

> `readonly` **transformIsNotRemovable**: `"IGX-0205"`

`Transform` was removed or disabled; every entity must keep exactly one enabled transform.

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

##### webGpuUnavailable

> `readonly` **webGpuUnavailable**: `"IGX-0701"`

WebGPU is not available in the current environment.

#### Example

```ts
throw new IgnifxError(CoreErrorCode.mutationAfterDestroy, "The entity has been destroyed.", {
  context: { entity: entity.uid },
});
```

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

### DEFAULT\_LAYER

> `const` **DEFAULT\_LAYER**: `0` = `0`

The slot every entity starts on, and the fallback for an unknown name in a file.

***

### DEFAULT\_MEMORY\_SINK\_LIMIT

> `const` **DEFAULT\_MEMORY\_SINK\_LIMIT**: `200` = `200`

How many records [createMemorySink](#creatememorysink) keeps when no limit is given.

***

### DEG\_TO\_RAD

> `const` **DEG\_TO\_RAD**: `number`

Multiplier that converts degrees to radians.

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

### FRAME\_HISTORY\_LENGTH

> `const` **FRAME\_HISTORY\_LENGTH**: `300` = `300`

How many frames of history [Diagnostics](#diagnostics-1) keeps by default — five seconds at 60 fps, which is
what the devtools graphs plot (`docs/architecture/15-devtools-and-diagnostics.md` §3).

***

### INVALID\_HANDLE

> `const` **INVALID\_HANDLE**: `0` = `0`

The handle value that never resolves. Allocated handles always carry a generation of at least
one, so zero is unreachable and doubles as "no handle".

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

### MAX\_LAYERS

> `const` **MAX\_LAYERS**: `32` = `32`

How many layer slots exist. One bit each, in a 32-bit mask.

***

### MAX\_ULID\_TIME\_MS

> `const` **MAX\_ULID\_TIME\_MS**: `number`

The largest timestamp a ULID can encode, in milliseconds since the Unix epoch. Readings beyond it
are clamped rather than producing a malformed identifier.

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

> `const` **PHASES**: readonly [`Phase`](#phase-2)[]

Every phase in frame order, for loops that walk them all.

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

### RESERVED\_LAYER\_NAMES

> `const` **RESERVED\_LAYER\_NAMES**: readonly `string`[]

The names of the eight engine-reserved slots, in slot order. They always occupy slots 0–7,
whether or not the project lists them (`docs/architecture/02-scene-graph.md` §7).

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

### THIRD\_PARTY\_ERROR\_PREFIX

> `const` **THIRD\_PARTY\_ERROR\_PREFIX**: `"9"` = `"9"`

The first digit of the range reserved for extensions published outside the `@ignifx` scope
(`IGX-9000` through `IGX-9999`). First-party subsystems never allocate here.

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

### asset()

> **asset**\<`A`\>(`type`, `options?`): [`FieldDefinition`](#fielddefinition)\<[`AssetRefValue`](#assetrefvalue)\<`A`\> \| `null`\>

Declares a reference to an addressable asset. In Phase 1 the field holds the *address*; the
loaded handle arrives with the assets service in Phase 2
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

[`FieldDefinition`](#fielddefinition)\<[`AssetRefValue`](#assetrefvalue)\<`A`\> \| `null`\>

The field definition.

#### Example

```ts
clip: asset(AudioClip); // AssetRefValue<AudioClip> | null
```

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

IgnifxError with code `IGX-1401` when the host exposes no Web Crypto implementation.

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

### createPerformanceClock()

> **createPerformanceClock**(): [`Clock`](#clock)

Creates the default clock: `performance.now()` where the host has it, `Date.now()` otherwise.

#### Returns

[`Clock`](#clock)

A clock reading the host's monotonic timer.

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

[`Schema`](#schema-4)

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

### toJsonSchema()

> **toJsonSchema**(`schema`): [`JsonObject`](#jsonobject)

Generates the JSON Schema (draft 2020-12) for a component's `props` object. The harness and the
Vite plugin assemble these into `ignifx.schemas.json`, which drives build-time validation and
editor autocompletion (`docs/architecture/06-serialization-and-scene-format.md` §8).

#### Parameters

##### schema

[`Schema`](#schema-4)

The schema to convert.

#### Returns

[`JsonObject`](#jsonobject)

The object fragment describing every declared prop.

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

### validateProps()

> **validateProps**(`schema`, `props`, `path?`): readonly [`SchemaIssue`](#schemaissue)[]

Checks a bag of property values against a schema. Names the schema does not declare are reported
as `IGX-0607`; names the caller omits are legal, because omitted props take schema defaults
(`docs/architecture/06-serialization-and-scene-format.md` §2).

#### Parameters

##### schema

[`Schema`](#schema-4)

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

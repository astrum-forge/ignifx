# @ignifx/input

`@ignifx/input` public barrel: devices, action maps, bindings, composites and processors, control
schemes, the `.input.json` asset, pointer lock, the cursor, rebinding, and `PlayerInput`
(`docs/architecture/08-input.md`). Explicit named re-exports only — no `export *`
(coding standards §4).

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

- `Vec2Like`

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

###### Implementation of

`Vec2Like.x`

##### y

###### Get Signature

> **get** **y**(): `number`

The y component, read from the action's live value.

###### Returns

`number`

The current y.

###### Implementation of

`Vec2Like.y`

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

[`InputDevice`](#inputdevice).[`constructor`](#constructor-9)

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

[`InputDevice`](#inputdevice).[`kind`](#kind-3)

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

> **enabled**: `boolean` = `true`

Whether this action resolves at all. An action in a disabled map reads as released too.

##### map

> `readonly` **map**: [`ActionMap`](#actionmap)

The map the action belongs to.

##### name

> `readonly` **name**: `string`

The action name game code asks for.

##### onCanceled

> `readonly` **onCanceled**: `Signal`\<[`InputActionEvent`](#inputactionevent)\>

Emitted the frame the action returns to rest.

##### onPerformed

> `readonly` **onPerformed**: `Signal`\<[`InputActionEvent`](#inputactionevent)\>

Emitted when the action is pressed and whenever its value changes while actuated.

##### onStarted

> `readonly` **onStarted**: `Signal`\<[`InputActionEvent`](#inputactionevent)\>

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

> **get** **value**(): `number` \| `boolean` \| `Vec2Like`

The action's value in the shape its `type` implies.

###### Returns

`number` \| `boolean` \| `Vec2Like`

A boolean for `button`, a number for `axis`, a live `Vec2Like` for `vector2`.

##### vector

###### Get Signature

> **get** **vector**(): `Vec2Like`

The action's vector value, for a `vector2` action. The object is a live view: it always reads
the action's current value and is never reallocated.

###### Returns

`Vec2Like`

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

> `static` **assetType**: `string` = `INPUT_ACTIONS_ASSET_TYPE`

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

Whether [InputActionSet.dispose](#dispose) has run.

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

`boolean` = `true`

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

> **get** **actionsHandle**(): `AssetHandle`\<[`InputActionsAsset`](#inputactionsasset)\> \| `null`

The handle of the `.input.json` document the `input.actions` setting named, or `null` when the
project named none.

###### Remarks

The extension starts the load in `onStart` and installs the maps at delivery, which is the
`PreUpdate` of the first stepped frame. Awaiting the handle inside `onStart` would deadlock: a
headless app has not been stepped yet and a canvas app has not started its loop
(`05-assets-and-loading.md` §4). Game code that must wait awaits this handle's `promise`.

###### Returns

`AssetHandle`\<[`InputActionsAsset`](#inputactionsasset)\> \| `null`

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

> **get** **onControlSchemeChanged**(): `SignalLike`\<`string`\>

Emitted with the new scheme name whenever the active control scheme changes.

###### Returns

`SignalLike`\<`string`\>

The signal.

##### onDeviceConnected

###### Get Signature

> **get** **onDeviceConnected**(): `SignalLike`\<[`InputDevice`](#inputdevice)\>

Emitted when a gamepad appears in a slot.

###### Returns

`SignalLike`\<[`InputDevice`](#inputdevice)\>

The signal.

##### onDeviceDisconnected

###### Get Signature

> **get** **onDeviceDisconnected**(): `SignalLike`\<[`InputDevice`](#inputdevice)\>

Emitted when a gamepad leaves a slot.

###### Returns

`SignalLike`\<[`InputDevice`](#inputdevice)\>

The signal.

##### uiHasFocus

###### Get Signature

> **get** **uiHasFocus**(): `boolean`

Whether a DOM text field has focus (`docs/architecture/08-input.md` §5). While it is `true`,
keyboard actions read as released and keyboard events are still published on
[InputService.events](#events); pointer actions keep working.

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

##### uiHasPointer

###### Get Signature

> **get** **uiHasPointer**(): `boolean`

Whether a pointer is pressed on the UI overlay (`docs/architecture/08-input.md` §5). While it is
`true`, pointing-device actions (`<Pointer>`, `<Mouse>`, `<Touch>`) read as released and their
events are still published on [InputService.events](#events); keyboard and gamepad actions keep
working. Pointer moves and releases are read from the window, so without this flag a drag that
began on a UI slider would also drive `<Pointer>/delta`.

###### Returns

`boolean`

`true` while the UI owns the pointer. `@ignifx/ui` assigns it.

###### Set Signature

> **set** **uiHasPointer**(`value`): `void`

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

[`InputActionsDefinition`](#inputactionsdefinition) \| [`InputActionsAsset`](#inputactionsasset) \| `AssetHandle`\<[`InputActionsAsset`](#inputactionsasset)\>

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

[`InputActionsDefinition`](#inputactionsdefinition) \| [`InputActionsAsset`](#inputactionsasset) \| `AssetHandle`\<[`InputActionsAsset`](#inputactionsasset)\>

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

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new PlayerInput**(): [`PlayerInput`](#playerinput)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`PlayerInput`](#playerinput)

###### Overrides

`Component.constructor`

#### Properties

##### actions

> **actions**: `AssetHandle`\<[`InputActionsAsset`](#inputactionsasset)\> \| `null`

The `ignifx.inputactions` document this player's private maps are built from.

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One player owns one entity.

##### deviceSlot

> **deviceSlot**: `number`

Which gamepad slot the player's `<Gamepad>/…` bindings are pinned to.

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### scheme

> **scheme**: `string`

The control scheme to keep; `""` keeps every binding whatever its tag.

##### typeId

> `static` **typeId**: `string` = `"ignifx/PlayerInput"`

The namespaced registration id.

#### Accessors

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Component.app`

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

Builds the private maps as soon as the component's fields are assigned.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Stops the private maps resolving.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

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

> **get** **onChange**(): `SignalLike`\<`boolean`\>

Emitted whenever the lock is taken or released, with the new state.

###### Returns

`SignalLike`\<`boolean`\>

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

[`InputDevice`](#inputdevice).[`constructor`](#constructor-9)

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

[`InputDevice`](#inputdevice).[`kind`](#kind-3)

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

[`ControlKind`](#controlkind-1) = `ControlKind.button`

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

##### uiHasPointer

> `readonly` **uiHasPointer**: `boolean`

`true` while a pointer is pressed on the UI overlay; pointing-device controls then read as
released, so a drag that started on a slider does not also turn the camera.

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

> `readonly` **app**: `App`

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

## Type Aliases

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

### DeviceKind

> **DeviceKind** = *typeof* [`DeviceKind`](#devicekind)\[keyof *typeof* [`DeviceKind`](#devicekind)\]

The union of the device families.

***

### GamepadReader

> **GamepadReader** = () => readonly ([`GamepadLike`](#gamepadlike) \| `null`)[]

How one frame's pads are read. Injecting it is what makes the mapping testable in Node.

#### Returns

readonly ([`GamepadLike`](#gamepadlike) \| `null`)[]

***

### InputActionSignal

> **InputActionSignal** = `SignalLike`\<[`InputActionEvent`](#inputactionevent)\>

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

### ProcessorKind

> **ProcessorKind** = *typeof* [`ProcessorKind`](#processorkind-1)\[keyof *typeof* [`ProcessorKind`](#processorkind-1)\]

The union of the processor names.

***

### SimulatedValue

> **SimulatedValue** = `number` \| `boolean` \| `Vec2Like`

What a value passed to [InputService.simulate](#simulate) may be.

## Variables

### ANY\_KEY\_CONTROL

> `const` **ANY\_KEY\_CONTROL**: `"anyKey"` = `"anyKey"`

The control that is actuated while any other key is held
(`docs/architecture/08-input.md` §3, `<Keyboard>/anyKey`).

***

### CompositeKind

> `const` **CompositeKind**: `object`

The composites a binding may declare.

#### Type Declaration

##### axis1D

> `readonly` **axis1D**: `"1DAxis"` = `"1DAxis"`

Two buttons read as a signed `axis`: `negative`, `positive`.

##### buttonWithModifier

> `readonly` **buttonWithModifier**: `"ButtonWithModifier"` = `"ButtonWithModifier"`

A button that only counts while a modifier is held: `modifier`, `button`.

##### vector2D

> `readonly` **vector2D**: `"2DVector"` = `"2DVector"`

Four buttons read as a `vector2`: `up`, `down`, `left`, `right`.

***

### ControlKind

> `const` **ControlKind**: `object`

What one control produces: a pressed/released button, a signed scalar, or a two-component
vector.

#### Type Declaration

##### axis

> `readonly` **axis**: `"axis"` = `"axis"`

A signed scalar, normally in `[-1, 1]`. Triggers report `[0, 1]`.

##### button

> `readonly` **button**: `"button"` = `"button"`

A digital or analog button; the resting value is `0` and the actuated value is `1`.

##### vector2

> `readonly` **vector2**: `"vector2"` = `"vector2"`

A two-component vector, such as a stick or a pointer position.

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

> `readonly` **gamepad**: `"Gamepad"` = `"Gamepad"`

A game controller in the W3C standard mapping.

##### keyboard

> `readonly` **keyboard**: `"Keyboard"` = `"Keyboard"`

Physical keys, addressed by `KeyboardEvent.code`.

##### mouse

> `readonly` **mouse**: `"Mouse"` = `"Mouse"`

The mouse: three buttons, position, delta, and the wheel.

##### pointer

> `readonly` **pointer**: `"Pointer"` = `"Pointer"`

The unified primary pointer: mouse, pen, or the first touch.

##### touch

> `readonly` **touch**: `"Touch"` = `"Touch"`

Up to ten simultaneous touches.

##### virtual

> `readonly` **virtual**: `"Virtual"` = `"Virtual"`

A synthetic device fed by on-screen controls.

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

> `const` **input**: (`options?`) => `Extension`

The `@ignifx/input` extension factory.

#### Parameters

##### options?

[`InputOptions`](#inputoptions)

Overrides for the `input` settings section, and the gamepad reader.

#### Returns

`Extension`

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

> `readonly` **duplicateName**: `"IGX-0810"` = `"IGX-0810"`

Two actions in one map, or two maps in one asset, declared the same name.

##### invalidActionsFile

> `readonly` **invalidActionsFile**: `"IGX-0805"` = `"IGX-0805"`

An `.input.json` file is not an `ignifx.inputactions` document this build can read.

##### invalidBindingPath

> `readonly` **invalidBindingPath**: `"IGX-0803"` = `"IGX-0803"`

A binding path is malformed, or names a device or control that does not exist.

##### invalidOverrides

> `readonly` **invalidOverrides**: `"IGX-0808"` = `"IGX-0808"`

A saved override document is not an `ignifx.inputoverrides` document this build can read.

##### pointerLockUnavailable

> `readonly` **pointerLockUnavailable**: `"IGX-0809"` = `"IGX-0809"`

Pointer lock was requested on an app that has no DOM canvas to lock.

##### rebindInProgress

> `readonly` **rebindInProgress**: `"IGX-0807"` = `"IGX-0807"`

A second interactive rebind was started while one was still listening.

##### unknownAction

> `readonly` **unknownAction**: `"IGX-0801"` = `"IGX-0801"`

`app.input.actions.get(name)` found no such action in any enabled map.

##### unknownActionMap

> `readonly` **unknownActionMap**: `"IGX-0804"` = `"IGX-0804"`

`app.input.actions.map(name)` found no such action map.

##### unknownComposite

> `readonly` **unknownComposite**: `"IGX-0806"` = `"IGX-0806"`

A binding declared a composite that is not `2DVector`, `1DAxis`, or `ButtonWithModifier`.

##### unknownProcessor

> `readonly` **unknownProcessor**: `"IGX-0802"` = `"IGX-0802"`

A binding named a processor that is not one of the five built-in ones.

#### Example

```ts
throw inputError(InputErrorCode.unknownAction, "No enabled action map declares jump.", {
  context: { action: "jump" },
});
```

***

### ProcessorKind

> `const` **ProcessorKind**: `object`

The processors a binding may declare.

#### Type Declaration

##### clamp

> `readonly` **clamp**: `"clamp"` = `"clamp"`

Clamps every component into a range.

##### deadzone

> `readonly` **deadzone**: `"deadzone"` = `"deadzone"`

Drops actuation below `min` and rescales `[min, max]` onto `[0, 1]`. Radial for vectors.

##### invert

> `readonly` **invert**: `"invert"` = `"invert"`

Negates every component.

##### normalize

> `readonly` **normalize**: `"normalize"` = `"normalize"`

Scales a vector to unit length; clamps a scalar into `[-1, 1]`.

##### scale

> `readonly` **scale**: `"scale"` = `"scale"`

Multiplies the components by a per-axis factor.

***

### TOUCH\_SLOTS

> `const` **TOUCH\_SLOTS**: `10` = `10`

How many simultaneous touches `Touch` tracks; `<Touch>/touch0` … `<Touch>/touch9`.

***

### VERSION

> `const` **VERSION**: `"0.0.0"` = `"0.0.0"`

The `@ignifx/input` version this build was cut from.

## Functions

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

### createInputActionsLoader()

> **createInputActionsLoader**(): `AssetLoader`\<[`InputActionsAsset`](#inputactionsasset)\>

Builds the loader for `.input.json` addresses.

#### Returns

`AssetLoader`\<[`InputActionsAsset`](#inputactionsasset)\>

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

### createPointerDevice()

> **createPointerDevice**(): [`InputDevice`](#inputdevice)

Builds the unified pointer device: whichever of mouse, pen, or first touch acted last.

#### Returns

[`InputDevice`](#inputdevice)

The device behind `<Pointer>/…` paths.

***

### createTouchDevice()

> **createTouchDevice**(): [`InputDevice`](#inputdevice)

Builds the touch device.

#### Returns

[`InputDevice`](#inputdevice)

The device behind `<Touch>/…` paths.

***

### defaultInputSettings()

> **defaultInputSettings**(): [`InputSettings`](#inputsettings)

The values used for everything a project omits.

#### Returns

[`InputSettings`](#inputsettings)

The default `input` section.

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

### describeInputActionsFormat()

> **describeInputActionsFormat**(): `SchemaDescription`

Describes the `ignifx.inputactions` file format for the documentation harness.

#### Returns

`SchemaDescription`

The description of the top-level file fields.

***

### describeInputSchemas()

> **describeInputSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component and file format this package declares, for the documentation harness.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The records, keyed by namespaced type id.

#### Example

```ts
describeInputSchemas()["ignifx/PlayerInput"].fields["deviceSlot"].default; // 0
```

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The name `pnpm docs:schemas` discovers this package's schemas under.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The same records [describeInputSchemas](#describeinputschemas) returns.

***

### gamepadControlNames()

> **gamepadControlNames**(): readonly `string`[]

The gamepad control names, in index order.

#### Returns

readonly `string`[]

Every control a `<Gamepad>/…` path may end in.

***

### inputActionsJsonSchema()

> **inputActionsJsonSchema**(): `JsonObject`

The JSON Schema the Vite plugin validates `.input.json` files against
(`docs/architecture/06-serialization-and-scene-format.md` §6, §8).

#### Returns

`JsonObject`

The schema document.

#### Example

```ts
await writeFile("inputactions.schema.json", JSON.stringify(inputActionsJsonSchema(), null, 2));
```

***

### inputError()

> **inputError**(`code`, `message`, `options?`): `IgnifxError`

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

`IgnifxError`

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

> **inputSettingsSchema**(): `Schema`

The schema the `input` section is validated against.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

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

### mouseControlNames()

> **mouseControlNames**(): readonly `string`[]

The mouse control names, in index order.

#### Returns

readonly `string`[]

`leftButton`, `rightButton`, `middleButton`, `position`, `delta`, `scroll`.

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

### touchControlNames()

> **touchControlNames**(): readonly `string`[]

The touch control names, in index order.

#### Returns

readonly `string`[]

`primaryTouch/…`, `touch0/…` through `touch9/…`, and `touchCount`.

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

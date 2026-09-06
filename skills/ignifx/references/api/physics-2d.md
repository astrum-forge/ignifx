# @ignifx/physics-2d

`@ignifx/physics-2d` public barrel: 2D physics on Rapier — `Rigidbody2D`, the 2D colliders,
triggers, `CharacterController2D`, one-way platforms, queries, the layer matrix, and
interpolation (`docs/architecture/11-2d-toolkit.md` §8, ADR-0006).

Explicit named re-exports only, no `export *` (coding standards §4).

## Classes

### BoxCollider2D

An axis-aligned box collider, sized in local metres.

#### Example

```ts
const floor = world.createEntity("Floor");
floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
```

#### Extends

- [`Collider2D`](#abstract-collider2d)

#### Constructors

##### Constructor

> **new BoxCollider2D**(): [`BoxCollider2D`](#boxcollider2d)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`BoxCollider2D`](#boxcollider2d)

###### Overrides

[`Collider2D`](#abstract-collider2d).[`constructor`](#constructor-4)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity make one compound body.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`allowMultiple`](#allowmultiple-4)

##### frictionCombine

> **frictionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's friction combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`frictionCombine`](#frictioncombine-3)

##### inlineMaterial

> **inlineMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues) \| `null`

An inline surface, used when [Collider2D.material](#material-3) is `null`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`inlineMaterial`](#inlinematerial-3)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isTrigger`](#istrigger-3)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`layerOverride`](#layeroverride-3)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider2D.inlineMaterial](#inlinematerial-3).

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`material`](#material-3)

##### offset

> **offset**: `Vec2Like`

The shape's offset from the entity origin, in local metres.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`offset`](#offset-4)

##### oneWay

> **oneWay**: `boolean`

Whether this is a one-way platform: a `CharacterController2D` with
`onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
unaffected — one-way support is a character-controller feature in the MVP.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`oneWay`](#oneway-3)

##### restitutionCombine

> **restitutionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's restitution combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`restitutionCombine`](#restitutioncombine-3)

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### size

> **size**: `Vec2Like`

##### typeId

> `static` **typeId**: `string` = `"ignifx/BoxCollider2D"`

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

[`Collider2D`](#abstract-collider2d).[`app`](#app-4)

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

[`Collider2D`](#abstract-collider2d).[`enabled`](#enabled-4)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`entity`](#entity-4)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`handle`](#handle-4)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isDestroyed`](#isdestroyed-4)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isEnabledInHierarchy`](#isenabledinhierarchy-4)

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

[`Collider2D`](#abstract-collider2d).[`onDestroyed`](#ondestroyed-4)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`transform`](#transform-4)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`uid`](#uid-4)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`world`](#world-4)

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

[`Collider2D`](#abstract-collider2d).[`define`](#define-4)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`destroy`](#destroy-4)

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

[`Collider2D`](#abstract-collider2d).[`getComponent`](#getcomponent-4)

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onAttach`](#onattach-4)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onDetach`](#ondetach-4)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, an offset, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2 };
box.rebuild();
```

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`rebuild`](#rebuild-4)

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

[`Collider2D`](#abstract-collider2d).[`requireComponent`](#requirecomponent-4)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`Physics2DMaterialValues`](#physics2dmaterialvalues)

Resolves the surface this collider presents to Rapier.

###### Parameters

###### fallback

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The world's `physics2d.defaultMaterial`.

###### Returns

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`resolveMaterial`](#resolvematerial-3)

***

### CapsuleCollider2D

A capsule collider: a rectangle with semicircular caps, standing along X or Y.

#### Remarks

`height` is the **total** tip-to-tip height, so a capsule shorter than `2 * radius` degenerates to
a circle of that radius rather than inverting. Rapier's capsule always stands along Y, so an
`x` capsule is expressed by swapping the axes of the half-extents — which means an `x` capsule
and a rotated `y` capsule are the same shape.

#### Extends

- [`Collider2D`](#abstract-collider2d)

#### Constructors

##### Constructor

> **new CapsuleCollider2D**(): [`CapsuleCollider2D`](#capsulecollider2d)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`CapsuleCollider2D`](#capsulecollider2d)

###### Overrides

[`Collider2D`](#abstract-collider2d).[`constructor`](#constructor-4)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity make one compound body.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`allowMultiple`](#allowmultiple-4)

##### direction

> **direction**: `"x"` \| `"y"`

##### frictionCombine

> **frictionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's friction combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`frictionCombine`](#frictioncombine-3)

##### height

> **height**: `number`

##### inlineMaterial

> **inlineMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues) \| `null`

An inline surface, used when [Collider2D.material](#material-3) is `null`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`inlineMaterial`](#inlinematerial-3)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isTrigger`](#istrigger-3)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`layerOverride`](#layeroverride-3)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider2D.inlineMaterial](#inlinematerial-3).

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`material`](#material-3)

##### offset

> **offset**: `Vec2Like`

The shape's offset from the entity origin, in local metres.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`offset`](#offset-4)

##### oneWay

> **oneWay**: `boolean`

Whether this is a one-way platform: a `CharacterController2D` with
`onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
unaffected — one-way support is a character-controller feature in the MVP.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`oneWay`](#oneway-3)

##### radius

> **radius**: `number`

##### restitutionCombine

> **restitutionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's restitution combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`restitutionCombine`](#restitutioncombine-3)

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/CapsuleCollider2D"`

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

[`Collider2D`](#abstract-collider2d).[`app`](#app-4)

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

[`Collider2D`](#abstract-collider2d).[`enabled`](#enabled-4)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`entity`](#entity-4)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`handle`](#handle-4)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isDestroyed`](#isdestroyed-4)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isEnabledInHierarchy`](#isenabledinhierarchy-4)

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

[`Collider2D`](#abstract-collider2d).[`onDestroyed`](#ondestroyed-4)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`transform`](#transform-4)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`uid`](#uid-4)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`world`](#world-4)

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

[`Collider2D`](#abstract-collider2d).[`define`](#define-4)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`destroy`](#destroy-4)

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

[`Collider2D`](#abstract-collider2d).[`getComponent`](#getcomponent-4)

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onAttach`](#onattach-4)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onDetach`](#ondetach-4)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, an offset, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2 };
box.rebuild();
```

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`rebuild`](#rebuild-4)

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

[`Collider2D`](#abstract-collider2d).[`requireComponent`](#requirecomponent-4)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`Physics2DMaterialValues`](#physics2dmaterialvalues)

Resolves the surface this collider presents to Rapier.

###### Parameters

###### fallback

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The world's `physics2d.defaultMaterial`.

###### Returns

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`resolveMaterial`](#resolvematerial-3)

***

### CharacterController2D

A kinematic character that walks, slides, climbs slopes, and steps up.

#### Example

```ts
class Walk extends Script implements ScriptCallbacks {
  static typeId = "mygame/Walk";
  fixedUpdate(dt: number): void {
    const controller = this.entity.requireComponent(CharacterController2D);
    controller.move({ x: 4 * dt, y: -9.81 * dt });
  }
}
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new CharacterController2D**(): [`CharacterController2D`](#charactercontroller2d)

Applies the schema defaults.

###### Returns

[`CharacterController2D`](#charactercontroller2d)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One controller per entity.

##### height

> **height**: `number`

##### interpolation

> **interpolation**: `"none"` \| `"interpolate"`

##### offset

> **offset**: `Vec2Like`

##### onOneWayPlatforms

> **onOneWayPlatforms**: `boolean`

##### pushBodies

> **pushBodies**: `boolean`

##### radius

> **radius**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### shape

> **shape**: `"box"` \| `"capsule"`

##### skinWidth

> **skinWidth**: `number`

##### slopeLimit

> **slopeLimit**: `number`

##### snapToGround

> **snapToGround**: `number`

##### stepOffset

> **stepOffset**: `number`

##### typeId

> `static` **typeId**: `string` = `"ignifx/CharacterController2D"`

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

##### groundNormal

###### Get Signature

> **get** **groundNormal**(): `Vec2`

The most upward-facing normal of the obstacles the last move touched.

###### Returns

`Vec2`

A live view; copy it if you keep it.

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

##### isGrounded

###### Get Signature

> **get** **isGrounded**(): `boolean`

Whether the character ended the last step on walkable ground.

###### Returns

`boolean`

Rapier's `computedGrounded` from the last move.

##### onCollided

###### Get Signature

> **get** **onCollided**(): `Signal`\<[`CharacterCollision2D`](#charactercollision2d)\>

Emitted once per obstacle the character hit during a step.

###### Returns

`Signal`\<[`CharacterCollision2D`](#charactercollision2d)\>

The signal, created on first access.

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

##### velocity

###### Get Signature

> **get** **velocity**(): `Vec2`

How fast the character actually moved over the last fixed step, after sliding and blocking.

###### Returns

`Vec2`

A freshly allocated vector in metres per second.

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

##### move()

> **move**(`displacement`): `void`

Requests a displacement for this fixed step. Displacements accumulate until the step runs.

###### Parameters

###### displacement

`Vec2Like`

The world-space displacement to attempt, in metres.

###### Returns

`void`

##### onAttach()

> **onAttach**(): `void`

Creates the Rapier controller at the start of the next fixed step.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Releases the Rapier controller and its collider.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### rebuild()

> **rebuild**(): `void`

Rebuilds the capsule or box at the start of the next fixed step.

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

##### teleport()

> **teleport**(`position`): `void`

Teleports the character, clearing any pending motion and the interpolation history.

###### Parameters

###### position

`Vec2Like`

The new world position of the entity, in metres.

###### Returns

`void`

***

### CircleCollider2D

A circle collider. Non-uniform scale is not representable as a circle, so the larger scale axis
wins — the same rule Unity applies.

#### Extends

- [`Collider2D`](#abstract-collider2d)

#### Constructors

##### Constructor

> **new CircleCollider2D**(): [`CircleCollider2D`](#circlecollider2d)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`CircleCollider2D`](#circlecollider2d)

###### Overrides

[`Collider2D`](#abstract-collider2d).[`constructor`](#constructor-4)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity make one compound body.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`allowMultiple`](#allowmultiple-4)

##### frictionCombine

> **frictionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's friction combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`frictionCombine`](#frictioncombine-3)

##### inlineMaterial

> **inlineMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues) \| `null`

An inline surface, used when [Collider2D.material](#material-3) is `null`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`inlineMaterial`](#inlinematerial-3)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isTrigger`](#istrigger-3)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`layerOverride`](#layeroverride-3)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider2D.inlineMaterial](#inlinematerial-3).

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`material`](#material-3)

##### offset

> **offset**: `Vec2Like`

The shape's offset from the entity origin, in local metres.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`offset`](#offset-4)

##### oneWay

> **oneWay**: `boolean`

Whether this is a one-way platform: a `CharacterController2D` with
`onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
unaffected — one-way support is a character-controller feature in the MVP.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`oneWay`](#oneway-3)

##### radius

> **radius**: `number`

##### restitutionCombine

> **restitutionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's restitution combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`restitutionCombine`](#restitutioncombine-3)

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/CircleCollider2D"`

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

[`Collider2D`](#abstract-collider2d).[`app`](#app-4)

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

[`Collider2D`](#abstract-collider2d).[`enabled`](#enabled-4)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`entity`](#entity-4)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`handle`](#handle-4)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isDestroyed`](#isdestroyed-4)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isEnabledInHierarchy`](#isenabledinhierarchy-4)

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

[`Collider2D`](#abstract-collider2d).[`onDestroyed`](#ondestroyed-4)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`transform`](#transform-4)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`uid`](#uid-4)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`world`](#world-4)

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

[`Collider2D`](#abstract-collider2d).[`define`](#define-4)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`destroy`](#destroy-4)

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

[`Collider2D`](#abstract-collider2d).[`getComponent`](#getcomponent-4)

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onAttach`](#onattach-4)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onDetach`](#ondetach-4)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, an offset, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2 };
box.rebuild();
```

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`rebuild`](#rebuild-4)

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

[`Collider2D`](#abstract-collider2d).[`requireComponent`](#requirecomponent-4)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`Physics2DMaterialValues`](#physics2dmaterialvalues)

Resolves the surface this collider presents to Rapier.

###### Parameters

###### fallback

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The world's `physics2d.defaultMaterial`.

###### Returns

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`resolveMaterial`](#resolvematerial-3)

***

### `abstract` Collider2D

The base class of every 2D collider.

#### Extends

- `Component`

#### Extended by

- [`BoxCollider2D`](#boxcollider2d)
- [`CapsuleCollider2D`](#capsulecollider2d)
- [`CircleCollider2D`](#circlecollider2d)
- [`EdgeCollider2D`](#edgecollider2d)
- [`PolygonCollider2D`](#polygoncollider2d)
- [`TilemapCollider2D`](#tilemapcollider2d)

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new Collider2D**(): [`Collider2D`](#abstract-collider2d)

Applies the shared defaults. A concrete collider calls `super()` and then applies its own.

###### Returns

[`Collider2D`](#abstract-collider2d)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity make one compound body.

##### frictionCombine

> **frictionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's friction combines with the one it touches.

##### inlineMaterial

> **inlineMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues) \| `null`

An inline surface, used when [Collider2D.material](#material-3) is `null`.

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider2D.inlineMaterial](#inlinematerial-3).

##### offset

> **offset**: `Vec2Like`

The shape's offset from the entity origin, in local metres.

##### oneWay

> **oneWay**: `boolean`

Whether this is a one-way platform: a `CharacterController2D` with
`onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
unaffected — one-way support is a character-controller feature in the MVP.

##### restitutionCombine

> **restitutionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's restitution combines with the one it touches.

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

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, an offset, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2 };
box.rebuild();
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

`Component.requireComponent`

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`Physics2DMaterialValues`](#physics2dmaterialvalues)

Resolves the surface this collider presents to Rapier.

###### Parameters

###### fallback

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The world's `physics2d.defaultMaterial`.

###### Returns

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The asset's values, the inline values, or the fallback.

***

### EdgeCollider2D

An open chain of line segments — a platformer's ground contour.

#### Extends

- [`Collider2D`](#abstract-collider2d)

#### Constructors

##### Constructor

> **new EdgeCollider2D**(): [`EdgeCollider2D`](#edgecollider2d)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`EdgeCollider2D`](#edgecollider2d)

###### Overrides

[`Collider2D`](#abstract-collider2d).[`constructor`](#constructor-4)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity make one compound body.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`allowMultiple`](#allowmultiple-4)

##### frictionCombine

> **frictionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's friction combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`frictionCombine`](#frictioncombine-3)

##### inlineMaterial

> **inlineMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues) \| `null`

An inline surface, used when [Collider2D.material](#material-3) is `null`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`inlineMaterial`](#inlinematerial-3)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isTrigger`](#istrigger-3)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`layerOverride`](#layeroverride-3)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider2D.inlineMaterial](#inlinematerial-3).

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`material`](#material-3)

##### offset

> **offset**: `Vec2Like`

The shape's offset from the entity origin, in local metres.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`offset`](#offset-4)

##### oneWay

> **oneWay**: `boolean`

Whether this is a one-way platform: a `CharacterController2D` with
`onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
unaffected — one-way support is a character-controller feature in the MVP.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`oneWay`](#oneway-3)

##### points

> **points**: `Vec2Like`[]

##### restitutionCombine

> **restitutionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's restitution combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`restitutionCombine`](#restitutioncombine-3)

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/EdgeCollider2D"`

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

[`Collider2D`](#abstract-collider2d).[`app`](#app-4)

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

[`Collider2D`](#abstract-collider2d).[`enabled`](#enabled-4)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`entity`](#entity-4)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`handle`](#handle-4)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isDestroyed`](#isdestroyed-4)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isEnabledInHierarchy`](#isenabledinhierarchy-4)

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

[`Collider2D`](#abstract-collider2d).[`onDestroyed`](#ondestroyed-4)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`transform`](#transform-4)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`uid`](#uid-4)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`world`](#world-4)

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

[`Collider2D`](#abstract-collider2d).[`define`](#define-4)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`destroy`](#destroy-4)

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

[`Collider2D`](#abstract-collider2d).[`getComponent`](#getcomponent-4)

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onAttach`](#onattach-4)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onDetach`](#ondetach-4)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, an offset, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2 };
box.rebuild();
```

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`rebuild`](#rebuild-4)

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

[`Collider2D`](#abstract-collider2d).[`requireComponent`](#requirecomponent-4)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`Physics2DMaterialValues`](#physics2dmaterialvalues)

Resolves the surface this collider presents to Rapier.

###### Parameters

###### fallback

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The world's `physics2d.defaultMaterial`.

###### Returns

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`resolveMaterial`](#resolvematerial-3)

***

### Physics2DService

The service behind `app.physics2d`.

#### Example

```ts
const hit = app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20);
if (hit !== null) {
  app.log.info("ray hit {name} at {y}", hit.entity.name, hit.point.y);
}
```

#### Accessors

##### gravity

###### Get Signature

> **get** **gravity**(): `Vec2`

World gravity in metres per second squared.

###### Returns

`Vec2`

A live view; writing to it does nothing, assign the property instead.

###### Set Signature

> **set** **gravity**(`value`): `void`

Replaces world gravity, which every body feels from the next fixed step.

###### Parameters

###### value

`Vec2Like`

The new acceleration vector.

###### Returns

`void`

##### rapier

###### Get Signature

> **get** **rapier**(): [`Physics2DRapierHandles`](#physics2drapierhandles)

The Rapier handles.

###### Returns

[`Physics2DRapierHandles`](#physics2drapierhandles)

The world.

#### Methods

##### overlapBox()

> **overlapBox**(`centre`, `size`, `rotation?`, `options?`): readonly `Entity`[]

Lists the entities a box overlaps.

###### Parameters

###### centre

`Vec2Like`

The box's world position.

###### size

`Vec2Like`

Its full width and height in metres.

###### rotation?

`number` = `0`

Its rotation in degrees counter-clockwise; defaults to `0`.

###### options?

[`QueryOptions2D`](#queryoptions2d)

Layer mask and trigger behaviour.

###### Returns

readonly `Entity`[]

The overlapping entities. The array is reused between calls.

###### Throws

IgnifxError with code `IGX-1153` when no fixed step has run yet.

##### overlapCircle()

> **overlapCircle**(`centre`, `radius`, `options?`): readonly `Entity`[]

Lists the entities a circle overlaps.

###### Parameters

###### centre

`Vec2Like`

The circle's world position.

###### radius

`number`

Its radius in metres.

###### options?

[`QueryOptions2D`](#queryoptions2d)

Layer mask and trigger behaviour.

###### Returns

readonly `Entity`[]

The overlapping entities, in Rapier's order. The array is reused between calls.

###### Throws

IgnifxError with code `IGX-1153` when no fixed step has run yet.

##### raycast()

> **raycast**(`origin`, `direction`, `maxDistance?`, `options?`): [`RaycastHit2D`](#raycasthit2d) \| `null`

Casts a ray and returns the first entity it hits.

###### Parameters

###### origin

`Vec2Like`

The world-space origin, in metres.

###### direction

`Vec2Like`

The direction; it is normalised for you.

###### maxDistance?

`number` = `DEFAULT_RAY_DISTANCE`

How far to travel; defaults to 10 km.

###### options?

[`QueryOptions2D`](#queryoptions2d)

Layer mask and trigger behaviour.

###### Returns

[`RaycastHit2D`](#raycasthit2d) \| `null`

The hit, or `null` when the ray clears everything.

###### Throws

IgnifxError with code `IGX-1153` when no fixed step has run yet.

##### raycastAll()

> **raycastAll**(`origin`, `direction`, `maxDistance?`, `options?`): readonly [`RaycastHit2D`](#raycasthit2d)[]

Casts a ray and returns every entity along it, nearest first.

###### Parameters

###### origin

`Vec2Like`

The world-space origin.

###### direction

`Vec2Like`

The direction; it is normalised for you.

###### maxDistance?

`number` = `DEFAULT_RAY_DISTANCE`

How far to travel; defaults to 10 km.

###### options?

[`QueryOptions2D`](#queryoptions2d)

Layer mask and trigger behaviour.

###### Returns

readonly [`RaycastHit2D`](#raycasthit2d)[]

The hits, in increasing distance. The array is reused between calls.

###### Throws

IgnifxError with code `IGX-1153` when no fixed step has run yet.

##### shapeCast()

> **shapeCast**(`centre`, `radius`, `direction`, `maxDistance`, `options?`): [`ShapeCastHit2D`](#shapecasthit2d) \| `null`

Sweeps a circle and returns the first contact.

###### Parameters

###### centre

`Vec2Like`

Where the sweep starts.

###### radius

`number`

The circle's radius in metres.

###### direction

`Vec2Like`

The sweep direction; it is normalised for you.

###### maxDistance

`number`

How far to sweep.

###### options?

[`QueryOptions2D`](#queryoptions2d)

Layer mask and trigger behaviour.

###### Returns

[`ShapeCastHit2D`](#shapecasthit2d) \| `null`

The hit, or `null`.

###### Throws

IgnifxError with code `IGX-1153` when no fixed step has run yet.

***

### PhysicsMaterial2D

A loaded 2D surface.

#### Example

```ts
const ice = await app.assets.load<PhysicsMaterial2D>("materials/ice.physicsmaterial.json");
floor.addComponent(BoxCollider2D, { size: { x: 10, y: 1 }, material: ice });
```

#### Implements

- [`Physics2DMaterialValues`](#physics2dmaterialvalues)

#### Constructors

##### Constructor

> **new PhysicsMaterial2D**(`name`, `values`): [`PhysicsMaterial2D`](#physicsmaterial2d)

Wraps parsed values.

###### Parameters

###### name

`string`

A human-readable name.

###### values

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

Friction and restitution.

###### Returns

[`PhysicsMaterial2D`](#physicsmaterial2d)

#### Properties

##### assetType

> `static` **assetType**: `string` = `PHYSICS_MATERIAL_2D_ASSET_TYPE`

The asset type token, so `asset(PhysicsMaterial2D)` fields resolve.

##### friction

> `readonly` **friction**: `number`

The friction coefficient.

###### Implementation of

[`Physics2DMaterialValues`](#physics2dmaterialvalues).[`friction`](#friction)

##### name

> `readonly` **name**: `string`

A human-readable name, used in diagnostics.

##### restitution

> `readonly` **restitution**: `number`

How much of the approach speed is returned, `0` to `1`.

###### Implementation of

[`Physics2DMaterialValues`](#physics2dmaterialvalues).[`restitution`](#restitution)

#### Methods

##### fromValues()

> `static` **fromValues**(`name`, `values`): [`PhysicsMaterial2D`](#physicsmaterial2d)

Builds a material in code, filling in the fields the caller omitted.

###### Parameters

###### name

`string`

A human-readable name.

###### values

`Partial`\<[`Physics2DMaterialValues`](#physics2dmaterialvalues)\>

Any subset of the two coefficients.

###### Returns

[`PhysicsMaterial2D`](#physicsmaterial2d)

The material.

###### Example

```ts
const bouncy = PhysicsMaterial2D.fromValues("bouncy", { restitution: 0.9 });
```

***

### PolygonCollider2D

A convex polygon collider, wound in either direction, in local metres.

#### Remarks

Rapier builds the **convex hull** of the points, so a concave outline is silently rounded out.
Model a concave shape as several `PolygonCollider2D`s on one entity, or as an
[EdgeCollider2D](#edgecollider2d) when it is an open contour.

#### Extends

- [`Collider2D`](#abstract-collider2d)

#### Constructors

##### Constructor

> **new PolygonCollider2D**(): [`PolygonCollider2D`](#polygoncollider2d)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`PolygonCollider2D`](#polygoncollider2d)

###### Overrides

[`Collider2D`](#abstract-collider2d).[`constructor`](#constructor-4)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity make one compound body.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`allowMultiple`](#allowmultiple-4)

##### frictionCombine

> **frictionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's friction combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`frictionCombine`](#frictioncombine-3)

##### inlineMaterial

> **inlineMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues) \| `null`

An inline surface, used when [Collider2D.material](#material-3) is `null`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`inlineMaterial`](#inlinematerial-3)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isTrigger`](#istrigger-3)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`layerOverride`](#layeroverride-3)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider2D.inlineMaterial](#inlinematerial-3).

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`material`](#material-3)

##### offset

> **offset**: `Vec2Like`

The shape's offset from the entity origin, in local metres.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`offset`](#offset-4)

##### oneWay

> **oneWay**: `boolean`

Whether this is a one-way platform: a `CharacterController2D` with
`onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
unaffected — one-way support is a character-controller feature in the MVP.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`oneWay`](#oneway-3)

##### points

> **points**: `Vec2Like`[]

##### restitutionCombine

> **restitutionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's restitution combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`restitutionCombine`](#restitutioncombine-3)

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/PolygonCollider2D"`

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

[`Collider2D`](#abstract-collider2d).[`app`](#app-4)

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

[`Collider2D`](#abstract-collider2d).[`enabled`](#enabled-4)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`entity`](#entity-4)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`handle`](#handle-4)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isDestroyed`](#isdestroyed-4)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isEnabledInHierarchy`](#isenabledinhierarchy-4)

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

[`Collider2D`](#abstract-collider2d).[`onDestroyed`](#ondestroyed-4)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`transform`](#transform-4)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`uid`](#uid-4)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`world`](#world-4)

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

[`Collider2D`](#abstract-collider2d).[`define`](#define-4)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`destroy`](#destroy-4)

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

[`Collider2D`](#abstract-collider2d).[`getComponent`](#getcomponent-4)

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onAttach`](#onattach-4)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onDetach`](#ondetach-4)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, an offset, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2 };
box.rebuild();
```

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`rebuild`](#rebuild-4)

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

[`Collider2D`](#abstract-collider2d).[`requireComponent`](#requirecomponent-4)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`Physics2DMaterialValues`](#physics2dmaterialvalues)

Resolves the surface this collider presents to Rapier.

###### Parameters

###### fallback

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The world's `physics2d.defaultMaterial`.

###### Returns

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`resolveMaterial`](#resolvematerial-3)

***

### Rigidbody2D

Makes an entity's 2D colliders a Rapier body.

#### Example

```ts
const crate = world.createEntity("Crate");
crate.transform.position2D = new Vec2(0, 5);
crate.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
crate.addComponent(Rigidbody2D, { mass: 2 });
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new Rigidbody2D**(): [`Rigidbody2D`](#rigidbody2d)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`Rigidbody2D`](#rigidbody2d)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One body per entity.

##### angularDamping

> **angularDamping**: `number`

##### bodyType

> **bodyType**: `"dynamic"` \| `"kinematic"` \| `"static"`

##### collisionEvents

> **collisionEvents**: `"auto"` \| `"on"` \| `"off"`

##### freezeRotation

> **freezeRotation**: `boolean`

##### gravityScale

> **gravityScale**: `number`

##### interpolation

> **interpolation**: `"none"` \| `"interpolate"`

##### linearDamping

> **linearDamping**: `number`

##### mass

> **mass**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### typeId

> `static` **typeId**: `string` = `"ignifx/Rigidbody2D"`

The namespaced registration id.

#### Accessors

##### angularVelocity

###### Get Signature

> **get** **angularVelocity**(): `number`

The body's angular velocity.

###### Returns

`number`

Degrees per second, counter-clockwise — the same unit as `Transform.rotation2D`.

###### Set Signature

> **set** **angularVelocity**(`value`): `void`

Replaces the body's angular velocity.

###### Parameters

###### value

`number`

Degrees per second, counter-clockwise.

###### Returns

`void`

##### app

###### Get Signature

> **get** **app**(): `App`

The app that owns the world.

###### Returns

`App`

The app.

###### Inherited from

`Component.app`

##### computedMass

###### Get Signature

> **get** **computedMass**(): `number`

The mass Rapier computed for the body, in kilograms.

###### Returns

`number`

The mass, or `0` before the body exists.

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

##### linearVelocity

###### Get Signature

> **get** **linearVelocity**(): `Vec2`

The body's linear velocity in metres per second.

###### Returns

`Vec2`

A freshly allocated vector; use [Rigidbody2D.linearVelocityToRef](#linearvelocitytoref) in hot code.

###### Set Signature

> **set** **linearVelocity**(`value`): `void`

Replaces the body's linear velocity.

###### Parameters

###### value

`Vec2Like`

Metres per second, world space.

###### Returns

`void`

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

##### rapier

###### Get Signature

> **get** **rapier**(): [`Rigidbody2DRapierHandles`](#rigidbody2drapierhandles)

The Rapier handles this component owns.

###### Returns

[`Rigidbody2DRapierHandles`](#rigidbody2drapierhandles)

The body, or `null` before the first fixed step built it.

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

##### addForce()

> **addForce**(`force`, `point?`): `void`

Applies a force for one fixed step. Call it from `fixedUpdate`.

###### Parameters

###### force

`Vec2Like`

Newtons, world space.

###### point?

`Vec2Like`

Where to apply it; defaults to the centre of mass.

###### Returns

`void`

###### Example

```ts
fixedUpdate(): void {
  this.body.addForce({ x: 0, y: 20 });
}
```

##### addImpulse()

> **addImpulse**(`impulse`, `point?`): `void`

Applies an instantaneous impulse.

###### Parameters

###### impulse

`Vec2Like`

Newton-seconds, world space.

###### point?

`Vec2Like`

Where to apply it; defaults to the centre of mass.

###### Returns

`void`

##### addTorque()

> **addTorque**(`torque`): `void`

Applies a torque for one fixed step.

###### Parameters

###### torque

`number`

Newton-metres, positive counter-clockwise.

###### Returns

`void`

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

##### linearVelocityToRef()

> **linearVelocityToRef**(`out`): `MutableVec2`

Reads the linear velocity without allocating.

###### Parameters

###### out

`MutableVec2`

The vector to write.

###### Returns

`MutableVec2`

`out`.

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which turns it back into an implicit static body.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### rebuild()

> **rebuild**(): `void`

Rebuilds the body at the start of the next fixed step. Call it after changing `bodyType`,
`mass`, `freezeRotation`, damping, or the entity's scale.

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

##### teleport()

> **teleport**(`position`, `rotation?`): `void`

Moves the body without integrating a velocity, and resets the interpolation history so the
display pose does not slide across the gap.

###### Parameters

###### position

`Vec2Like`

The new world position, in metres.

###### rotation?

`number`

The new rotation in degrees counter-clockwise; defaults to the current one.

###### Returns

`void`

***

### TilemapCollider2D

The collision surface of a tilemap, as one static body's worth of Rapier shapes.

#### Example

```ts
const map = world.createEntity("Map");
const collider = map.addComponent(TilemapCollider2D);
collider.collisionData = tilemap.collisionData;
```

#### Extends

- [`Collider2D`](#abstract-collider2d)

#### Constructors

##### Constructor

> **new TilemapCollider2D**(): [`TilemapCollider2D`](#tilemapcollider2d)

Applies the shared defaults.

###### Returns

[`TilemapCollider2D`](#tilemapcollider2d)

###### Overrides

[`Collider2D`](#abstract-collider2d).[`constructor`](#constructor-4)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity make one compound body.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`allowMultiple`](#allowmultiple-4)

##### frictionCombine

> **frictionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's friction combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`frictionCombine`](#frictioncombine-3)

##### inlineMaterial

> **inlineMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues) \| `null`

An inline surface, used when [Collider2D.material](#material-3) is `null`.

###### Inherited from

[`PolygonCollider2D`](#polygoncollider2d).[`inlineMaterial`](#inlinematerial-5)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isTrigger`](#istrigger-3)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`layerOverride`](#layeroverride-3)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider2D.inlineMaterial](#inlinematerial-3).

###### Inherited from

[`PolygonCollider2D`](#polygoncollider2d).[`material`](#material-5)

##### offset

> **offset**: `Vec2Like`

The shape's offset from the entity origin, in local metres.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`offset`](#offset-4)

##### oneWay

> **oneWay**: `boolean`

Whether this is a one-way platform: a `CharacterController2D` with
`onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
unaffected — one-way support is a character-controller feature in the MVP.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`oneWay`](#oneway-3)

##### restitutionCombine

> **restitutionCombine**: `"min"` \| `"max"` \| `"average"` \| `"multiply"`

How this surface's restitution combines with the one it touches.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`restitutionCombine`](#restitutioncombine-3)

##### schema

> `static` **schema**: `Schema`

The serialized field declarations; the geometry itself comes from the tilemap asset.

##### typeId

> `static` **typeId**: `string` = `"ignifx/TilemapCollider2D"`

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

[`Collider2D`](#abstract-collider2d).[`app`](#app-4)

##### collisionData

###### Get Signature

> **get** **collisionData**(): `TilemapCollisionData` \| `null`

The merged chunk geometry this collider builds shapes from.

###### Returns

`TilemapCollisionData` \| `null`

The data, or `null` when none has been supplied.

###### Set Signature

> **set** **collisionData**(`value`): `void`

Replaces the tilemap geometry and schedules a rebuild.

###### Parameters

###### value

`TilemapCollisionData` \| `null`

The merged chunk geometry, or `null` to drop the shapes.

###### Returns

`void`

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

[`Collider2D`](#abstract-collider2d).[`enabled`](#enabled-4)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`entity`](#entity-4)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`handle`](#handle-4)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isDestroyed`](#isdestroyed-4)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`isEnabledInHierarchy`](#isenabledinhierarchy-4)

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

[`Collider2D`](#abstract-collider2d).[`onDestroyed`](#ondestroyed-4)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`transform`](#transform-4)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`uid`](#uid-4)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`world`](#world-4)

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

[`Collider2D`](#abstract-collider2d).[`define`](#define-4)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`destroy`](#destroy-4)

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

[`Collider2D`](#abstract-collider2d).[`getComponent`](#getcomponent-4)

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onAttach`](#onattach-4)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`onDetach`](#ondetach-4)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, an offset, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2 };
box.rebuild();
```

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`rebuild`](#rebuild-4)

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

[`Collider2D`](#abstract-collider2d).[`requireComponent`](#requirecomponent-4)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`Physics2DMaterialValues`](#physics2dmaterialvalues)

Resolves the surface this collider presents to Rapier.

###### Parameters

###### fallback

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The world's `physics2d.defaultMaterial`.

###### Returns

[`Physics2DMaterialValues`](#physics2dmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider2D`](#abstract-collider2d).[`resolveMaterial`](#resolvematerial-3)

## Interfaces

### CharacterCollision2D

What `CharacterController2D.onCollided` reports: one obstacle the character hit this step.

#### Properties

##### normal

> `readonly` **normal**: `Vec2Like`

The world-space outward normal on the obstacle.

##### other

> `readonly` **other**: `Entity` \| `null`

The entity that was hit, or `null` when it is not an ignifx body.

##### otherCollider

> `readonly` **otherCollider**: [`Collider2D`](#abstract-collider2d) \| `null`

The collider that was hit, or `null`.

##### point

> `readonly` **point**: `Vec2Like`

The world-space contact point.

***

### Collision2D

What a script's `onCollisionEnter`/`onCollisionStay`/`onCollisionExit` is handed in a 2D world.

#### Properties

##### contacts

> `readonly` **contacts**: readonly [`ContactPoint2D`](#contactpoint2d)[]

The contacts of this event. Pooled; valid only during the callback.

##### other

> `readonly` **other**: `Entity` \| `null`

The entity that was hit, or `null` when its body is already gone.

##### otherCollider

> `readonly` **otherCollider**: [`Collider2D`](#abstract-collider2d) \| `null`

The exact collider on the other entity.

##### relativeVelocity

> `readonly` **relativeVelocity**: `Vec2Like`

The relative velocity of the two bodies at the contact, in metres per second.

##### self

> `readonly` **self**: `Entity`

The entity whose script is being called.

##### selfCollider

> `readonly` **selfCollider**: [`Collider2D`](#abstract-collider2d) \| `null`

The collider on this entity that took part.

***

### ContactPoint2D

One contact point of a 2D collision. Pooled with its owning [Collision2D](#collision2d).

#### Properties

##### impulse

> `readonly` **impulse**: `number`

The magnitude of the impulse Rapier's solver applied; `0` for a contact that just ended.

##### normal

> `readonly` **normal**: `Vec2Like`

The world-space contact normal, pointing away from the other collider.

##### point

> `readonly` **point**: `Vec2Like`

The world-space contact point, in metres.

***

### Physics2DErrorOptions

Options accepted by [physics2DError](#physics2derror).

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

### Physics2DMaterialValues

A surface, either as the `physics2d.defaultMaterial` setting or inline on a collider.

#### Properties

##### friction

> `readonly` **friction**: `number`

The friction coefficient.

##### restitution

> `readonly` **restitution**: `number`

How much of the approach speed is returned, `0` to `1`.

***

### Physics2DOptions

What `physics2d()` accepts.

#### Properties

##### initialize?

> `readonly` `optional` **initialize?**: () => `Promise`\<`void`\>

Replaces the step that instantiates Rapier's WebAssembly module. The default awaits
`RAPIER.init()`, which decodes the base64 payload the `-compat` build inlines; a host that has
already preloaded the module, or a test that wants to observe the failure path, supplies its
own.

###### Returns

`Promise`\<`void`\>

***

### Physics2DRapierHandles

The Rapier objects the 2D physics extension owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### world

> `readonly` **world**: `World`

Rapier's `World`.

***

### Physics2DSettings

The resolved `physics2d` settings section.

#### Example

```ts
// ignifx.config.ts
export default {
  layers: { layers: ["Default", "Player", "Enemy"] },
  physics2d: {
    gravity: { x: 0, y: -9.81 },
    collisionMatrix: { Player: ["Default", "Enemy"], Enemy: ["Default"] },
  },
};
```

#### Properties

##### collisionMatrix

> `readonly` **collisionMatrix**: `Readonly`\<`Record`\<`string`, readonly `string`[]\>\>

Which layers each layer collides with. A layer the map does not mention collides with
everything, which is what makes the default project need no matrix at all.

##### defaultMaterial

> `readonly` **defaultMaterial**: [`Physics2DMaterialValues`](#physics2dmaterialvalues)

The surface a collider with no material of its own uses.

##### gravity

> `readonly` **gravity**: `Vec2Like`

World gravity in metres per second squared; +Y is up (`11-2d-toolkit.md` §3).

##### interpolation

> `readonly` **interpolation**: `boolean`

Whether dynamic bodies and character controllers interpolate between fixed steps.

##### velocityIterations

> `readonly` **velocityIterations**: `number`

How many iterations Rapier's constraint solver runs; `0` leaves Rapier's own default (4).

***

### QueryOptions2D

Options every 2D query accepts.

#### Properties

##### hitTriggers?

> `readonly` `optional` **hitTriggers?**: `boolean`

Whether trigger volumes count as hits. Defaults to `false`.

##### layerMask?

> `readonly` `optional` **layerMask?**: `LayerMask`

Which layers the query may hit. Defaults to everything.

***

### RaycastHit2D

What a 2D ray or shape query hit.

#### Remarks

The object is freshly allocated per hit, so it is safe to keep. `raycastAll` returns a **reused**
array of freshly allocated hits.

#### Properties

##### collider

> `readonly` **collider**: [`Collider2D`](#abstract-collider2d) \| `null`

The collider that was hit.

##### distance

> `readonly` **distance**: `number`

The distance from the ray origin, in metres.

##### entity

> `readonly` **entity**: `Entity`

The entity that was hit.

##### normal

> `readonly` **normal**: `Vec2Like`

The world-space surface normal.

##### point

> `readonly` **point**: `Vec2Like`

The world-space contact point, in metres.

***

### Rigidbody2DRapierHandles

The Rapier objects a `Rigidbody2D` owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### body

> `readonly` **body**: `RigidBody` \| `null`

The Rapier body, or `null` before the first fixed step has built it.

***

### ShapeCastHit2D

What a 2D shape sweep hit.

#### Properties

##### collider

> `readonly` **collider**: [`Collider2D`](#abstract-collider2d) \| `null`

The collider it hit.

##### distance

> `readonly` **distance**: `number`

The distance travelled before contact, in metres.

##### entity

> `readonly` **entity**: `Entity`

The entity the swept shape hit.

##### fraction

> `readonly` **fraction**: `number`

How far along the sweep the contact occurs, in `[0, 1]`.

##### normal

> `readonly` **normal**: `Vec2Like`

The world-space contact normal.

##### point

> `readonly` **point**: `Vec2Like`

The world-space contact point on the hit collider.

***

### TriggerEvent2D

What a script's `onTriggerEnter`/`onTriggerExit` is handed in a 2D world.

#### Example

```ts
class Coin extends Script implements ScriptCallbacks {
  static typeId = "mygame/Coin";
  onTriggerEnter(trigger: TriggerEvent2D): void {
    if (trigger.other?.tags.has("player") === true) {
      this.entity.destroy();
    }
  }
}
```

#### Properties

##### other

> `readonly` **other**: `Entity` \| `null`

The entity that entered or left, or `null` when its body is already gone.

##### otherCollider

> `readonly` **otherCollider**: [`Collider2D`](#abstract-collider2d) \| `null`

The exact collider on the other entity — Rapier reports shape identity, unlike Havok.

##### self

> `readonly` **self**: `Entity`

The entity whose script is being called.

##### selfCollider

> `readonly` **selfCollider**: [`Collider2D`](#abstract-collider2d) \| `null`

The collider on this entity that took part.

## Type Aliases

### BodyType2D

> **BodyType2D** = *typeof* [`BODY_TYPES_2D`](#body_types_2d)\[`number`\]

The union of [BODY\_TYPES\_2D](#body_types_2d).

***

### Capsule2DDirection

> **Capsule2DDirection** = *typeof* [`CAPSULE_2D_DIRECTIONS`](#capsule_2d_directions)\[`number`\]

The union of [CAPSULE\_2D\_DIRECTIONS](#capsule_2d_directions).

***

### CharacterShape2D

> **CharacterShape2D** = *typeof* [`CHARACTER_SHAPES_2D`](#character_shapes_2d)\[`number`\]

The union of [CHARACTER\_SHAPES\_2D](#character_shapes_2d).

***

### CollisionEventMode2D

> **CollisionEventMode2D** = *typeof* [`COLLISION_EVENT_MODES_2D`](#collision_event_modes_2d)\[`number`\]

The union of [COLLISION\_EVENT\_MODES\_2D](#collision_event_modes_2d).

***

### CombineRule

> **CombineRule** = *typeof* [`COMBINE_RULES`](#combine_rules)\[`number`\]

The union of [COMBINE\_RULES](#combine_rules).

***

### InterpolationMode2D

> **InterpolationMode2D** = *typeof* [`INTERPOLATION_MODES_2D`](#interpolation_modes_2d)\[`number`\]

The union of [INTERPOLATION\_MODES\_2D](#interpolation_modes_2d).

***

### Physics2DErrorCode

> **Physics2DErrorCode** = *typeof* [`Physics2DErrorCode`](#physics2derrorcode)\[keyof *typeof* [`Physics2DErrorCode`](#physics2derrorcode)\]

The union of the codes the `Physics2DErrorCode` table declares.

## Variables

### BODY\_TYPES\_2D

> `const` **BODY\_TYPES\_2D**: readonly \[`"dynamic"`, `"kinematic"`, `"static"`\]

How a 2D body moves.

***

### CAPSULE\_2D\_DIRECTIONS

> `const` **CAPSULE\_2D\_DIRECTIONS**: readonly \[`"x"`, `"y"`\]

The axis a 2D capsule stands along.

***

### CHARACTER\_SHAPES\_2D

> `const` **CHARACTER\_SHAPES\_2D**: readonly \[`"capsule"`, `"box"`\]

The collision shape a 2D character controller uses.

***

### COLLISION\_EVENT\_MODES\_2D

> `const` **COLLISION\_EVENT\_MODES\_2D**: readonly \[`"auto"`, `"on"`, `"off"`\]

Whether collision callbacks are delivered for this body.

***

### COMBINE\_RULES

> `const` **COMBINE\_RULES**: readonly \[`"average"`, `"min"`, `"multiply"`, `"max"`\]

How two surfaces' coefficients are combined when they touch, mirroring Rapier's
`CoefficientCombineRule`.

***

### INTERPOLATION\_MODES\_2D

> `const` **INTERPOLATION\_MODES\_2D**: readonly \[`"none"`, `"interpolate"`\]

Whether a body's display pose is interpolated between fixed steps.

***

### PHYSICS\_2D\_DIAGNOSTICS\_COUNTERS

> `const` **PHYSICS\_2D\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters `09-physics.md` §9 and `11-2d-toolkit.md` §8 name for 2D.

***

### PHYSICS\_2D\_DIAGNOSTICS\_GROUP

> `const` **PHYSICS\_2D\_DIAGNOSTICS\_GROUP**: `"physics2d"` = `"physics2d"`

The diagnostics group name.

***

### PHYSICS\_2D\_ERROR\_MESSAGES

> `const` **PHYSICS\_2D\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.

***

### PHYSICS\_2D\_SETTINGS\_SECTION

> `const` **PHYSICS\_2D\_SETTINGS\_SECTION**: `"physics2d"` = `"physics2d"`

The section name as it appears in `ignifx.config.ts`.

***

### PHYSICS\_MATERIAL\_2D\_ASSET\_TYPE

> `const` **PHYSICS\_MATERIAL\_2D\_ASSET\_TYPE**: `"physicsmaterial"` = `"physicsmaterial"`

The asset type name `.physicsmaterial.json` addresses resolve to.

***

### PHYSICS\_MATERIAL\_2D\_FILE\_EXTENSION

> `const` **PHYSICS\_MATERIAL\_2D\_FILE\_EXTENSION**: `".physicsmaterial.json"` = `".physicsmaterial.json"`

The address suffix that selects the loader.

***

### PHYSICS\_MATERIAL\_2D\_FILE\_FORMAT

> `const` **PHYSICS\_MATERIAL\_2D\_FILE\_FORMAT**: `"ignifx.physicsmaterial"` = `"ignifx.physicsmaterial"`

The `format` string every physics-material document declares.

***

### PHYSICS\_MATERIAL\_2D\_FORMAT\_VERSION

> `const` **PHYSICS\_MATERIAL\_2D\_FORMAT\_VERSION**: `1` = `1`

The file format version; `1` before ignifx 1.0.

***

### physics2d

> `const` **physics2d**: (`options?`) => `Extension`

Builds the 2D physics extension.

#### Parameters

##### options?

[`Physics2DOptions`](#physics2doptions)

Optionally, an already-instantiated Rapier module.

#### Returns

`Extension`

The extension descriptor.

#### Example

```ts
const app = await createApp({ headless: true, extensions: [physics2d()] });
```

***

### Physics2DErrorCode

> `const` **Physics2DErrorCode**: `object`

Every diagnostic code `@ignifx/physics-2d` can throw or report.

#### Type Declaration

##### bodyOnChildEntity

> `readonly` **bodyOnChildEntity**: `"IGX-1157"` = `"IGX-1157"`

A 2D body was built for an entity that has a parent, whose pose is not world space.

##### bothPhysicsExtensions

> `readonly` **bothPhysicsExtensions**: `"IGX-1101"` = `"IGX-1101"`

Both `physics()` and `physics2d()` are registered on one world (`11-2d-toolkit.md` §8).

##### colliderGeometryInvalid

> `readonly` **colliderGeometryInvalid**: `"IGX-1156"` = `"IGX-1156"`

A collider's geometry is degenerate: too few points, or a hull Rapier refused to build.

##### invalidMaterialFile

> `readonly` **invalidMaterialFile**: `"IGX-1154"` = `"IGX-1154"`

A `.physicsmaterial.json` file is not an `ignifx.physicsmaterial` document this build reads.

##### layerOutOfRange

> `readonly` **layerOutOfRange**: `"IGX-1152"` = `"IGX-1152"`

A collider's layer index is outside the sixteen Rapier's interaction groups can express.

##### movedStaticBody

> `readonly` **movedStaticBody**: `"IGX-1151"` = `"IGX-1151"`

An entity with 2D colliders but no `Rigidbody2D` moved after its static body was placed.

##### queryBeforeStep

> `readonly` **queryBeforeStep**: `"IGX-1153"` = `"IGX-1153"`

A query ran before the first completed fixed step, so Rapier has no broadphase yet.

##### rapierUnavailable

> `readonly` **rapierUnavailable**: `"IGX-1150"` = `"IGX-1150"`

The Rapier WebAssembly module could not be instantiated.

##### unknownLayer

> `readonly` **unknownLayer**: `"IGX-1155"` = `"IGX-1155"`

The `physics2d.collisionMatrix` setting names a layer the project does not declare.

#### Example

```ts
throw physics2DError(Physics2DErrorCode.queryBeforeStep, "raycast() ran before the first step.", {
  context: { query: "raycast" },
});
```

## Functions

### collider2DFields()

> **collider2DFields**(): `Schema`

The fields every 2D collider declares.

#### Returns

`Schema`

The shared field declarations, ready to spread into a collider's own schema.

***

### createPhysicsMaterial2DLoader()

> **createPhysicsMaterial2DLoader**(): `AssetLoader`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\>

Builds the loader for `.physicsmaterial.json` files.

#### Returns

`AssetLoader`\<[`PhysicsMaterial2D`](#physicsmaterial2d)\>

The loader, ready for `ctx.registerAssetLoader`.

***

### defaultPhysics2DSettings()

> **defaultPhysics2DSettings**(): [`Physics2DSettings`](#physics2dsettings)

The values used when a project omits the `physics2d` section.

#### Returns

[`Physics2DSettings`](#physics2dsettings)

A fresh defaults object.

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component this package declares.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The records, keyed by namespaced type id.

#### Example

```ts
const schemas = describeSchemas();
schemas["ignifx/Rigidbody2D"].fields["mass"].default; // 1
```

***

### parsePhysicsMaterial2D()

> **parsePhysicsMaterial2D**(`address`, `document`): [`PhysicsMaterial2D`](#physicsmaterial2d)

Parses one `ignifx.physicsmaterial` document into a 2D surface.

#### Parameters

##### address

`string`

The address it came from, for the diagnostic.

##### document

`JsonValue`

The parsed JSON.

#### Returns

[`PhysicsMaterial2D`](#physicsmaterial2d)

The material.

#### Throws

IgnifxError with code `IGX-1154` when the document is not one this build can read.

***

### physics2DError()

> **physics2DError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`Physics2DErrorCode`](#physics2derrorcode-1)

The code from the `Physics2DErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`Physics2DErrorOptions`](#physics2derroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to reject with.

#### Example

```ts
throw physics2DError(Physics2DErrorCode.unknownLayer, "physics2d.collisionMatrix names Enemy.", {
  context: { layer: "Enemy" },
});
```

***

### physics2DSettingsSchema()

> **physics2DSettingsSchema**(): `Schema`

Builds the schema the `physics2d` section is validated against.

#### Returns

`Schema`

The schema.

#### Remarks

It is a function, not a module-level constant: every field kind is a function call, and module
scope holds declarations and immutable constants only (`CONSTITUTION.md` §3.5).

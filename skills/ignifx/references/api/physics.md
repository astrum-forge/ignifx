# @ignifx/physics

`@ignifx/physics` public barrel: 3D physics on Havok through Babylon Lite — rigidbodies,
colliders, triggers, the character controller, queries, the layer matrix, and interpolation
(`docs/architecture/09-physics.md`).

Explicit named re-exports only, no `export *` (coding standards §4).

## Classes

### BoxCollider

A box collider, sized in local units (`09-physics.md` §2.2).

#### Example

```ts
const floor = world.createEntity("Floor");
floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });
```

#### Extends

- [`Collider`](#abstract-collider)

#### Constructors

##### Constructor

> **new BoxCollider**(): [`BoxCollider`](#boxcollider)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`BoxCollider`](#boxcollider)

###### Overrides

[`Collider`](#abstract-collider).[`constructor`](#constructor-3)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity form one compound body (`09-physics.md` §2.2).

###### Inherited from

[`Collider`](#abstract-collider).[`allowMultiple`](#allowmultiple-3)

##### center

> **center**: `Vec3Like`

The shape's offset from the entity origin, in local units.

###### Inherited from

[`Collider`](#abstract-collider).[`center`](#center-3)

##### inlineMaterial

> **inlineMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues) \| `null`

An inline surface, used when [Collider.material](#material-2) is `null`.

###### Inherited from

[`Collider`](#abstract-collider).[`inlineMaterial`](#inlinematerial-2)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider`](#abstract-collider).[`isTrigger`](#istrigger-2)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider`](#abstract-collider).[`layerOverride`](#layeroverride-2)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial`](#physicsmaterial)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider.inlineMaterial](#inlinematerial-2).

###### Inherited from

[`Collider`](#abstract-collider).[`material`](#material-2)

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### size

> **size**: `Vec3Like`

##### typeId

> `static` **typeId**: `string` = `"ignifx/BoxCollider"`

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

[`Collider`](#abstract-collider).[`app`](#app-3)

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

[`Collider`](#abstract-collider).[`enabled`](#enabled-3)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider`](#abstract-collider).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider`](#abstract-collider).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider`](#abstract-collider).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider`](#abstract-collider).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

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

[`Collider`](#abstract-collider).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider`](#abstract-collider).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider`](#abstract-collider).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider`](#abstract-collider).[`world`](#world-3)

#### Methods

##### createShape()

> **createShape**(`world`, `scale`): `PhysicsShape`

Builds this collider's Havok shape.

###### Parameters

###### world

`PhysicsWorld`

The Havok world the shape belongs to.

###### scale

`Vec3Like`

The entity's lossy scale, applied to the authored dimensions.

###### Returns

`PhysicsShape`

The shape handle.

###### Overrides

`Collider.createShape`

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

[`Collider`](#abstract-collider).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`destroy`](#destroy-3)

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

[`Collider`](#abstract-collider).[`getComponent`](#getcomponent-3)

##### halfExtentsToRef()

> **halfExtentsToRef**(`scale`, `out`): `void`

Writes half the size of this collider's local bounding box, scale applied.

###### Parameters

###### scale

`Vec3Like`

The entity's lossy scale.

###### out

`MutableVec3`

The vector to write.

###### Returns

`void`

###### Overrides

`Collider.halfExtentsToRef`

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onAttach`](#onattach-3)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onDetach`](#ondetach-3)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, a `center`, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2, z: 2 };
box.rebuild();
```

###### Inherited from

[`Collider`](#abstract-collider).[`rebuild`](#rebuild-3)

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

[`Collider`](#abstract-collider).[`requireComponent`](#requirecomponent-3)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`PhysicsMaterialValues`](#physicsmaterialvalues)

Resolves the surface this collider presents to Havok.

###### Parameters

###### fallback

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The world's `physics.defaultMaterial`.

###### Returns

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider`](#abstract-collider).[`resolveMaterial`](#resolvematerial-2)

***

### CapsuleCollider

A capsule collider: a cylinder with hemispherical caps, standing along one axis.

#### Remarks

`height` is the **total** tip-to-tip height, so a capsule shorter than `2 * radius` degenerates to
a sphere of that radius rather than inverting.

#### Extends

- [`Collider`](#abstract-collider)

#### Constructors

##### Constructor

> **new CapsuleCollider**(): [`CapsuleCollider`](#capsulecollider)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`CapsuleCollider`](#capsulecollider)

###### Overrides

[`Collider`](#abstract-collider).[`constructor`](#constructor-3)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity form one compound body (`09-physics.md` §2.2).

###### Inherited from

[`Collider`](#abstract-collider).[`allowMultiple`](#allowmultiple-3)

##### center

> **center**: `Vec3Like`

The shape's offset from the entity origin, in local units.

###### Inherited from

[`Collider`](#abstract-collider).[`center`](#center-3)

##### direction

> **direction**: `"x"` \| `"y"` \| `"z"`

##### height

> **height**: `number`

##### inlineMaterial

> **inlineMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues) \| `null`

An inline surface, used when [Collider.material](#material-2) is `null`.

###### Inherited from

[`Collider`](#abstract-collider).[`inlineMaterial`](#inlinematerial-2)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider`](#abstract-collider).[`isTrigger`](#istrigger-2)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider`](#abstract-collider).[`layerOverride`](#layeroverride-2)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial`](#physicsmaterial)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider.inlineMaterial](#inlinematerial-2).

###### Inherited from

[`Collider`](#abstract-collider).[`material`](#material-2)

##### radius

> **radius**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/CapsuleCollider"`

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

[`Collider`](#abstract-collider).[`app`](#app-3)

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

[`Collider`](#abstract-collider).[`enabled`](#enabled-3)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider`](#abstract-collider).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider`](#abstract-collider).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider`](#abstract-collider).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider`](#abstract-collider).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

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

[`Collider`](#abstract-collider).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider`](#abstract-collider).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider`](#abstract-collider).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider`](#abstract-collider).[`world`](#world-3)

#### Methods

##### createShape()

> **createShape**(`world`, `scale`): `PhysicsShape`

Builds this collider's Havok shape.

###### Parameters

###### world

`PhysicsWorld`

The Havok world the shape belongs to.

###### scale

`Vec3Like`

The entity's lossy scale, applied to the authored dimensions.

###### Returns

`PhysicsShape`

The shape handle.

###### Overrides

`Collider.createShape`

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

[`Collider`](#abstract-collider).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`destroy`](#destroy-3)

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

[`Collider`](#abstract-collider).[`getComponent`](#getcomponent-3)

##### halfExtentsToRef()

> **halfExtentsToRef**(`scale`, `out`): `void`

Writes half the size of this collider's local bounding box, scale applied.

###### Parameters

###### scale

`Vec3Like`

The entity's lossy scale.

###### out

`MutableVec3`

The vector to write.

###### Returns

`void`

###### Overrides

`Collider.halfExtentsToRef`

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onAttach`](#onattach-3)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onDetach`](#ondetach-3)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, a `center`, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2, z: 2 };
box.rebuild();
```

###### Inherited from

[`Collider`](#abstract-collider).[`rebuild`](#rebuild-3)

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

[`Collider`](#abstract-collider).[`requireComponent`](#requirecomponent-3)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`PhysicsMaterialValues`](#physicsmaterialvalues)

Resolves the surface this collider presents to Havok.

###### Parameters

###### fallback

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The world's `physics.defaultMaterial`.

###### Returns

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider`](#abstract-collider).[`resolveMaterial`](#resolvematerial-2)

***

### CharacterController

A kinematic capsule that walks, slides, and pushes (`09-physics.md` §2.3).

#### Example

```ts
class Walk extends Script implements ScriptCallbacks {
  static typeId = "mygame/Walk";
  fixedUpdate(dt: number): void {
    const controller = this.entity.requireComponent(CharacterController);
    controller.move({ x: 2 * dt, y: 0, z: 0 });
  }
}
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new CharacterController**(): [`CharacterController`](#charactercontroller)

Applies the schema defaults.

###### Returns

[`CharacterController`](#charactercontroller)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One controller per entity.

##### center

> **center**: `Vec3Like`

##### height

> **height**: `number`

##### interpolation

> **interpolation**: `"none"` \| `"interpolate"`

##### pushStrength

> **pushStrength**: `number`

##### radius

> **radius**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### skinWidth

> **skinWidth**: `number`

##### slopeLimit

> **slopeLimit**: `number`

##### typeId

> `static` **typeId**: `string` = `"ignifx/CharacterController"`

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

> **get** **groundNormal**(): `Vec3`

The averaged normal of the supporting surface.

###### Returns

`Vec3`

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

Whether the character is standing on a walkable surface.

###### Returns

`boolean`

`true` when the last step's probe reported `supported`.

##### onCollided

###### Get Signature

> **get** **onCollided**(): `Signal`\<[`CharacterCollision`](#charactercollision)\>

Emitted once per dynamic body the character pushed during a step.

###### Returns

`Signal`\<[`CharacterCollision`](#charactercollision)\>

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

##### supportState

###### Get Signature

> **get** **supportState**(): `"unsupported"` \| `"sliding"` \| `"supported"`

How the character was supported at the end of the last step.

###### Returns

`"unsupported"` \| `"sliding"` \| `"supported"`

`"unsupported"`, `"sliding"`, or `"supported"`.

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

> **get** **velocity**(): `Vec3`

The controller's current velocity.

###### Returns

`Vec3`

A freshly allocated vector.

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

`Vec3Like`

The world-space displacement to attempt.

###### Returns

`void`

##### onAttach()

> **onAttach**(): `void`

Creates the Lite controller at the start of the next fixed step.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Releases the Lite controller.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### rebuild()

> **rebuild**(): `void`

Rebuilds the capsule at the start of the next fixed step.

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

##### setHeight()

> **setHeight**(`height`, `preserveFeet?`): `void`

Changes the capsule height without losing the controller's state — the crouch primitive.

###### Parameters

###### height

`number`

The new total height, tip to tip.

###### preserveFeet?

`boolean` = `true`

Whether the foot position stays fixed; defaults to `true`.

###### Returns

`void`

##### setVelocity()

> **setVelocity**(`velocity`): `void`

Sets the controller's velocity, which is what `integrate` advances.

###### Parameters

###### velocity

`Vec3Like`

Metres per second, world space.

###### Returns

`void`

##### teleport()

> **teleport**(`position`): `void`

Teleports the character, clearing any swept motion and the interpolation history.

###### Parameters

###### position

`Vec3Like`

The new world position of the entity.

###### Returns

`void`

***

### `abstract` Collider

The base class of every collider. It is never registered on its own; `entity.getComponents` and
`world.components` accept it because the concrete colliders extend it.

#### Extends

- `Component`

#### Extended by

- [`BoxCollider`](#boxcollider)
- [`CapsuleCollider`](#capsulecollider)
- [`CylinderCollider`](#cylindercollider)
- [`HeightfieldCollider`](#heightfieldcollider)
- [`MeshCollider`](#meshcollider)
- [`SphereCollider`](#spherecollider)

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new Collider**(): [`Collider`](#abstract-collider)

Applies the shared defaults. A concrete collider calls `super()` and then applies its own.

###### Returns

[`Collider`](#abstract-collider)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity form one compound body (`09-physics.md` §2.2).

##### center

> **center**: `Vec3Like`

The shape's offset from the entity origin, in local units.

##### inlineMaterial

> **inlineMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues) \| `null`

An inline surface, used when [Collider.material](#material-2) is `null`.

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial`](#physicsmaterial)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider.inlineMaterial](#inlinematerial-2).

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
changing a size, a `center`, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2, z: 2 };
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

> **resolveMaterial**(`fallback`): [`PhysicsMaterialValues`](#physicsmaterialvalues)

Resolves the surface this collider presents to Havok.

###### Parameters

###### fallback

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The world's `physics.defaultMaterial`.

###### Returns

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The asset's values, the inline values, or the fallback.

***

### CylinderCollider

A cylinder collider standing along Y.

#### Extends

- [`Collider`](#abstract-collider)

#### Constructors

##### Constructor

> **new CylinderCollider**(): [`CylinderCollider`](#cylindercollider)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`CylinderCollider`](#cylindercollider)

###### Overrides

[`Collider`](#abstract-collider).[`constructor`](#constructor-3)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity form one compound body (`09-physics.md` §2.2).

###### Inherited from

[`Collider`](#abstract-collider).[`allowMultiple`](#allowmultiple-3)

##### center

> **center**: `Vec3Like`

The shape's offset from the entity origin, in local units.

###### Inherited from

[`Collider`](#abstract-collider).[`center`](#center-3)

##### height

> **height**: `number`

##### inlineMaterial

> **inlineMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues) \| `null`

An inline surface, used when [Collider.material](#material-2) is `null`.

###### Inherited from

[`Collider`](#abstract-collider).[`inlineMaterial`](#inlinematerial-2)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider`](#abstract-collider).[`isTrigger`](#istrigger-2)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider`](#abstract-collider).[`layerOverride`](#layeroverride-2)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial`](#physicsmaterial)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider.inlineMaterial](#inlinematerial-2).

###### Inherited from

[`Collider`](#abstract-collider).[`material`](#material-2)

##### radius

> **radius**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/CylinderCollider"`

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

[`Collider`](#abstract-collider).[`app`](#app-3)

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

[`Collider`](#abstract-collider).[`enabled`](#enabled-3)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider`](#abstract-collider).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider`](#abstract-collider).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider`](#abstract-collider).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider`](#abstract-collider).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

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

[`Collider`](#abstract-collider).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider`](#abstract-collider).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider`](#abstract-collider).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider`](#abstract-collider).[`world`](#world-3)

#### Methods

##### createShape()

> **createShape**(`world`, `scale`): `PhysicsShape`

Builds this collider's Havok shape.

###### Parameters

###### world

`PhysicsWorld`

The Havok world the shape belongs to.

###### scale

`Vec3Like`

The entity's lossy scale, applied to the authored dimensions.

###### Returns

`PhysicsShape`

The shape handle.

###### Overrides

`Collider.createShape`

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

[`Collider`](#abstract-collider).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`destroy`](#destroy-3)

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

[`Collider`](#abstract-collider).[`getComponent`](#getcomponent-3)

##### halfExtentsToRef()

> **halfExtentsToRef**(`scale`, `out`): `void`

Writes half the size of this collider's local bounding box, scale applied.

###### Parameters

###### scale

`Vec3Like`

The entity's lossy scale.

###### out

`MutableVec3`

The vector to write.

###### Returns

`void`

###### Overrides

`Collider.halfExtentsToRef`

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onAttach`](#onattach-3)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onDetach`](#ondetach-3)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, a `center`, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2, z: 2 };
box.rebuild();
```

###### Inherited from

[`Collider`](#abstract-collider).[`rebuild`](#rebuild-3)

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

[`Collider`](#abstract-collider).[`requireComponent`](#requirecomponent-3)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`PhysicsMaterialValues`](#physicsmaterialvalues)

Resolves the surface this collider presents to Havok.

###### Parameters

###### fallback

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The world's `physics.defaultMaterial`.

###### Returns

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider`](#abstract-collider).[`resolveMaterial`](#resolvematerial-2)

***

### HeightfieldCollider

A heightfield collider: a regular grid of height samples in the XZ plane, which is what a terrain
uses (`index.d.ts` 2601, 6266).

#### Remarks

Only Lite's **explicit** heightfield path is used, because the `groundMesh` path reads
`mesh._cpuPositions` and `worldMatrix` and therefore needs a GPU. `heights` is row-major with
`samplesX * samplesZ` entries.

#### Extends

- [`Collider`](#abstract-collider)

#### Constructors

##### Constructor

> **new HeightfieldCollider**(): [`HeightfieldCollider`](#heightfieldcollider)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`HeightfieldCollider`](#heightfieldcollider)

###### Overrides

[`Collider`](#abstract-collider).[`constructor`](#constructor-3)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity form one compound body (`09-physics.md` §2.2).

###### Inherited from

[`Collider`](#abstract-collider).[`allowMultiple`](#allowmultiple-3)

##### center

> **center**: `Vec3Like`

The shape's offset from the entity origin, in local units.

###### Inherited from

[`Collider`](#abstract-collider).[`center`](#center-3)

##### heights

> **heights**: `number`[]

##### inlineMaterial

> **inlineMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues) \| `null`

An inline surface, used when [Collider.material](#material-2) is `null`.

###### Inherited from

[`Collider`](#abstract-collider).[`inlineMaterial`](#inlinematerial-2)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider`](#abstract-collider).[`isTrigger`](#istrigger-2)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider`](#abstract-collider).[`layerOverride`](#layeroverride-2)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial`](#physicsmaterial)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider.inlineMaterial](#inlinematerial-2).

###### Inherited from

[`Collider`](#abstract-collider).[`material`](#material-2)

##### samplesX

> **samplesX**: `number`

##### samplesZ

> **samplesZ**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### size

> **size**: `Vec3Like`

##### typeId

> `static` **typeId**: `string` = `"ignifx/HeightfieldCollider"`

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

[`Collider`](#abstract-collider).[`app`](#app-3)

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

[`Collider`](#abstract-collider).[`enabled`](#enabled-3)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider`](#abstract-collider).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider`](#abstract-collider).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider`](#abstract-collider).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider`](#abstract-collider).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

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

[`Collider`](#abstract-collider).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider`](#abstract-collider).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider`](#abstract-collider).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider`](#abstract-collider).[`world`](#world-3)

#### Methods

##### createShape()

> **createShape**(`world`, `scale`): `PhysicsShape`

Builds this collider's Havok shape.

###### Parameters

###### world

`PhysicsWorld`

The Havok world the shape belongs to.

###### scale

`Vec3Like`

The entity's lossy scale, applied to the authored dimensions.

###### Returns

`PhysicsShape`

The shape handle.

###### Overrides

`Collider.createShape`

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

[`Collider`](#abstract-collider).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`destroy`](#destroy-3)

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

[`Collider`](#abstract-collider).[`getComponent`](#getcomponent-3)

##### halfExtentsToRef()

> **halfExtentsToRef**(`scale`, `out`): `void`

Writes half the size of this collider's local bounding box, scale applied.

###### Parameters

###### scale

`Vec3Like`

The entity's lossy scale.

###### out

`MutableVec3`

The vector to write.

###### Returns

`void`

###### Overrides

`Collider.halfExtentsToRef`

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onAttach`](#onattach-3)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onDetach`](#ondetach-3)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, a `center`, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2, z: 2 };
box.rebuild();
```

###### Inherited from

[`Collider`](#abstract-collider).[`rebuild`](#rebuild-3)

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

[`Collider`](#abstract-collider).[`requireComponent`](#requirecomponent-3)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`PhysicsMaterialValues`](#physicsmaterialvalues)

Resolves the surface this collider presents to Havok.

###### Parameters

###### fallback

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The world's `physics.defaultMaterial`.

###### Returns

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider`](#abstract-collider).[`resolveMaterial`](#resolvematerial-2)

***

### MeshCollider

A collider built from real geometry: either an explicit `MeshAsset` or, when `mesh` is
`null`, whatever the entity's `MeshRenderer`/`Model` put under its node.

#### Remarks

**Headless is not supported.** `@babylonjs/lite@1.27.0` documents mesh and convex-hull colliders
as unavailable on the null engine (`index.d.ts` 2781), and a headless `MeshAsset` uploads no
geometry at all (`MeshAsset.lite.mesh` is `null`), so building one reports `IGX-0906` instead of
producing an empty shape. Use a primitive collider in headless tests.

#### Extends

- [`Collider`](#abstract-collider)

#### Constructors

##### Constructor

> **new MeshCollider**(): [`MeshCollider`](#meshcollider)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`MeshCollider`](#meshcollider)

###### Overrides

[`Collider`](#abstract-collider).[`constructor`](#constructor-3)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity form one compound body (`09-physics.md` §2.2).

###### Inherited from

[`Collider`](#abstract-collider).[`allowMultiple`](#allowmultiple-3)

##### center

> **center**: `Vec3Like`

The shape's offset from the entity origin, in local units.

###### Inherited from

[`Collider`](#abstract-collider).[`center`](#center-3)

##### convex

> **convex**: `boolean`

##### includeChildren

> **includeChildren**: `boolean`

##### inlineMaterial

> **inlineMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues) \| `null`

An inline surface, used when [Collider.material](#material-2) is `null`.

###### Inherited from

[`Collider`](#abstract-collider).[`inlineMaterial`](#inlinematerial-2)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider`](#abstract-collider).[`isTrigger`](#istrigger-2)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider`](#abstract-collider).[`layerOverride`](#layeroverride-2)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial`](#physicsmaterial)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider.inlineMaterial](#inlinematerial-2).

###### Inherited from

[`Collider`](#abstract-collider).[`material`](#material-2)

##### mesh

> **mesh**: `AssetHandle`\<`MeshAsset`\> \| `null`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/MeshCollider"`

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

[`Collider`](#abstract-collider).[`app`](#app-3)

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

[`Collider`](#abstract-collider).[`enabled`](#enabled-3)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider`](#abstract-collider).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider`](#abstract-collider).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider`](#abstract-collider).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider`](#abstract-collider).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

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

[`Collider`](#abstract-collider).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider`](#abstract-collider).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider`](#abstract-collider).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider`](#abstract-collider).[`world`](#world-3)

#### Methods

##### createShape()

> **createShape**(`world`, `_scale`, `node`): `PhysicsShape`

Builds this collider's Havok shape from real geometry.

###### Parameters

###### world

`PhysicsWorld`

The Havok world the shape belongs to.

###### \_scale

`Vec3Like`

Unused: a mesh shape carries the geometry's own world scale.

###### node

`SceneNode`

The entity's node, whose meshes supply the vertices when `mesh` is `null`.

###### Returns

`PhysicsShape`

The shape handle.

###### Overrides

`Collider.createShape`

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

[`Collider`](#abstract-collider).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`destroy`](#destroy-3)

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

[`Collider`](#abstract-collider).[`getComponent`](#getcomponent-3)

##### halfExtentsToRef()

> **halfExtentsToRef**(`_scale`, `out`): `void`

Writes half the size of this collider's local bounding box — zero, because measuring a triangle
soup means reading its vertices, which is GPU territory.

###### Parameters

###### \_scale

`Vec3Like`

Unused.

###### out

`MutableVec3`

The vector to write.

###### Returns

`void`

###### Overrides

`Collider.halfExtentsToRef`

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onAttach`](#onattach-3)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onDetach`](#ondetach-3)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, a `center`, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2, z: 2 };
box.rebuild();
```

###### Inherited from

[`Collider`](#abstract-collider).[`rebuild`](#rebuild-3)

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

[`Collider`](#abstract-collider).[`requireComponent`](#requirecomponent-3)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`PhysicsMaterialValues`](#physicsmaterialvalues)

Resolves the surface this collider presents to Havok.

###### Parameters

###### fallback

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The world's `physics.defaultMaterial`.

###### Returns

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider`](#abstract-collider).[`resolveMaterial`](#resolvematerial-2)

***

### PhysicsMaterial

A loaded surface material. The values are the ones Havok's `setPhysicsShapeMaterial` takes
(`index.d.ts` 10853).

#### Example

```ts
const ice = await app.assets.load<PhysicsMaterial>("materials/ice.physicsmaterial.json");
floor.addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 }, material: ice });
```

#### Implements

- [`PhysicsMaterialValues`](#physicsmaterialvalues)

#### Constructors

##### Constructor

> **new PhysicsMaterial**(`name`, `values`): [`PhysicsMaterial`](#physicsmaterial)

Wraps parsed values. The loader constructs these; game code uses
[PhysicsMaterial.fromValues](#fromvalues) when it wants one in code.

###### Parameters

###### name

`string`

A human-readable name.

###### values

[`PhysicsMaterialValues`](#physicsmaterialvalues)

Friction, static friction, and restitution.

###### Returns

[`PhysicsMaterial`](#physicsmaterial)

#### Properties

##### assetType

> `static` **assetType**: `string` = `PHYSICS_MATERIAL_ASSET_TYPE`

The asset type token, so `asset(PhysicsMaterial)` fields resolve.

##### friction

> `readonly` **friction**: `number`

The dynamic friction coefficient.

###### Implementation of

[`PhysicsMaterialValues`](#physicsmaterialvalues).[`friction`](#friction-1)

##### name

> `readonly` **name**: `string`

A human-readable name, used in diagnostics.

##### restitution

> `readonly` **restitution**: `number`

How much of the approach speed is returned, `0` to `1`.

###### Implementation of

[`PhysicsMaterialValues`](#physicsmaterialvalues).[`restitution`](#restitution-1)

##### staticFriction

> `readonly` **staticFriction**: `number`

The static friction coefficient.

###### Implementation of

[`PhysicsMaterialValues`](#physicsmaterialvalues).[`staticFriction`](#staticfriction-1)

#### Methods

##### fromValues()

> `static` **fromValues**(`name`, `values`): [`PhysicsMaterial`](#physicsmaterial)

Builds a material in code, filling in the fields the caller omitted.

###### Parameters

###### name

`string`

A human-readable name.

###### values

`Partial`\<[`PhysicsMaterialValues`](#physicsmaterialvalues)\>

Any subset of the three coefficients.

###### Returns

[`PhysicsMaterial`](#physicsmaterial)

The material.

###### Example

```ts
const bouncy = PhysicsMaterial.fromValues("bouncy", { restitution: 0.9 });
```

***

### PhysicsService

The service behind `app.physics`.

#### Example

```ts
const hit = app.physics.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
if (hit !== null) {
  app.log.info(`ray hit ${hit.entity.name} at ${String(hit.point.y)}`);
}
```

#### Accessors

##### debugViewer

###### Get Signature

> **get** **debugViewer**(): [`PhysicsDebugViewer`](#physicsdebugviewer)

The wireframe overlay.

###### Returns

[`PhysicsDebugViewer`](#physicsdebugviewer)

The viewer toggle.

##### gravity

###### Get Signature

> **get** **gravity**(): `Vec3`

World gravity in metres per second squared.

###### Returns

`Vec3`

A live view; writing to it does nothing, assign the property instead.

###### Set Signature

> **set** **gravity**(`value`): `void`

Replaces world gravity, which every body feels from the next fixed step.

###### Parameters

###### value

`Vec3Like`

The new acceleration vector, in metres per second squared.

###### Returns

`void`

##### hasStepped

###### Get Signature

> **get** **hasStepped**(): `boolean`

Whether at least one fixed step has completed, which is when Havok has built its broadphase and
queries become legal (`09-physics.md` §5). A script that queries from `lateUpdate` or `update`
checks this on the first frame, where the fixed loop may not have run yet, instead of catching
`IGX-0902`.

###### Returns

`boolean`

`true` once the first step has run.

##### lite

###### Get Signature

> **get** **lite**(): [`PhysicsLiteHandles`](#physicslitehandles)

The Babylon Lite handles.

###### Returns

[`PhysicsLiteHandles`](#physicslitehandles)

The Havok world and the simulation scene.

#### Methods

##### dispose()

> **dispose**(): `void`

Releases the viewer, if one is up. Called from the extension's `dispose`.

###### Returns

`void`

##### distanceToNearest()

> **distanceToNearest**(`shape`, `position`, `maxDistance`, `options?`): `number`

How far the nearest body is from a positioned shape, which is the one thing Lite's
`shapeProximity` answers exactly.

###### Parameters

###### shape

[`QueryShape`](#queryshape)

The query shape.

###### position

`Vec3Like`

Its world position.

###### maxDistance

`number`

How far to search.

###### options?

[`QueryOptions`](#queryoptions)

Trigger behaviour.

###### Returns

`number`

The distance, or `Number.POSITIVE_INFINITY` when nothing is in range.

###### Throws

IgnifxError with code `IGX-0902` in development when no fixed step has run yet.

##### isDebugViewerEnabled()

> **isDebugViewerEnabled**(): `boolean`

Whether the viewer is currently drawing.

###### Returns

`boolean`

`true` when a viewer exists.

##### overlap()

> **overlap**(`shape`, `position`, `rotation?`, `options?`): readonly `Entity`[]

Lists the entities a positioned shape overlaps (`09-physics.md` §5).

###### Parameters

###### shape

[`QueryShape`](#queryshape)

The query shape.

###### position

`Vec3Like`

Its world position.

###### rotation?

`Quat`

Its world rotation; accepted for forward compatibility and currently unused,
because the bounds test is axis-aligned.

###### options?

[`QueryOptions`](#queryoptions)

Layer mask and trigger behaviour.

###### Returns

readonly `Entity`[]

The overlapping entities, in body creation order. The array is reused between calls.

###### Remarks

Lite's `shapeProximity` reports one hit and no identity (`index.d.ts` 11540,
`lib/physics/havok-queries.js:7`), so this is answered from the extension's own bounds index:
every registered body whose world bounding box intersects the query shape's. It is conservative
— a body whose box overlaps but whose shape does not is listed.

###### Throws

IgnifxError with code `IGX-0902` in development when no fixed step has run yet.

##### raycast()

> **raycast**(`origin`, `direction`, `maxDistance?`, `options?`): [`RaycastHit`](#raycasthit) \| `null`

Casts a ray and returns the first entity it hits (`09-physics.md` §5).

###### Parameters

###### origin

`Vec3Like`

The world-space origin.

###### direction

`Vec3Like`

The direction; it is normalised for you.

###### maxDistance?

`number` = `DEFAULT_RAY_DISTANCE`

How far to travel; defaults to 10 km.

###### options?

[`QueryOptions`](#queryoptions)

Layer mask and trigger behaviour.

###### Returns

[`RaycastHit`](#raycasthit) \| `null`

The hit, or `null` when the ray clears everything.

###### Throws

IgnifxError with code `IGX-0902` in development when no fixed step has run yet.

##### setDebugViewerEnabled()

> **setDebugViewerEnabled**(`enabled`): `void`

Shows or hides Lite's wireframe bodies.

###### Parameters

###### enabled

`boolean`

Whether the viewer draws.

###### Returns

`void`

##### shapeCast()

> **shapeCast**(`shape`, `from`, `to`, `options?`): [`ShapeCastHit`](#shapecasthit) \| `null`

Sweeps a shape and returns the first contact (`09-physics.md` §5).

###### Parameters

###### shape

[`QueryShape`](#queryshape)

The shape to sweep.

###### from

`Vec3Like`

The start position.

###### to

`Vec3Like`

The end position.

###### options?

[`ShapeCastOptions`](#shapecastoptions)

Layer mask, trigger behaviour, and the one entity to sweep through.

###### Returns

[`ShapeCastHit`](#shapecasthit) \| `null`

The hit, or `null`.

###### Remarks

Lite's `shapeCast` reports no body (`index.d.ts` 11497), so `entity` is resolved against the
extension's body-bounds index and is bounds-accurate rather than shape-accurate.

The sweep itself cannot be filtered by layer — Lite's `ShapeCastQuery` carries no collision
masks — so a body outside `layerMask` still stops the sweep; it is merely reported with
`entity: null`. What the sweep *can* do is pass through one body, `options.ignore`, which is
how a camera boom leaves its target's capsule and a step probe leaves the character's own feet
without reporting them at fraction zero (2026-09-08).

###### Throws

IgnifxError with code `IGX-0902` in development when no fixed step has run yet.

***

### Rigidbody

Makes an entity's colliders a Havok body (`09-physics.md` §2.1).

#### Example

```ts
const crate = world.createEntity("Crate");
crate.transform.position = { x: 0, y: 5, z: 0 };
crate.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
crate.addComponent(Rigidbody, { mass: 2 });
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new Rigidbody**(): [`Rigidbody`](#rigidbody)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`Rigidbody`](#rigidbody)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One body per entity.

##### bodyType

> **bodyType**: `"static"` \| `"kinematic"` \| `"dynamic"`

##### collisionEvents

> **collisionEvents**: `"auto"` \| `"on"` \| `"off"`

##### freezeRotation

> **freezeRotation**: [`FreezeRotation`](#freezerotation)

##### interpolation

> **interpolation**: `"none"` \| `"interpolate"`

##### kinematicSync

> **kinematicSync**: `"teleport"` \| `"velocity"`

##### mass

> **mass**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations (ADR-0004).

##### startAsleep

> **startAsleep**: `boolean`

##### typeId

> `static` **typeId**: `string` = `"ignifx/Rigidbody"`

The namespaced registration id.

#### Accessors

##### angularVelocity

###### Get Signature

> **get** **angularVelocity**(): `Vec3`

The body's angular velocity in radians per second.

###### Returns

`Vec3`

A freshly allocated vector; use [Rigidbody.angularVelocityToRef](#angularvelocitytoref) in hot code.

###### Set Signature

> **set** **angularVelocity**(`value`): `void`

Replaces the body's angular velocity.

###### Parameters

###### value

`Vec3Like`

Radians per second, world space.

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

> **get** **linearVelocity**(): `Vec3`

The body's linear velocity in metres per second.

###### Returns

`Vec3`

A freshly allocated vector; use [Rigidbody.linearVelocityToRef](#linearvelocitytoref) in hot code.

###### Set Signature

> **set** **linearVelocity**(`value`): `void`

Replaces the body's linear velocity.

###### Parameters

###### value

`Vec3Like`

Metres per second, world space.

###### Returns

`void`

##### lite

###### Get Signature

> **get** **lite**(): [`RigidbodyLiteHandles`](#rigidbodylitehandles)

The Babylon Lite handles this component owns.

###### Returns

[`RigidbodyLiteHandles`](#rigidbodylitehandles)

The Havok body, or `null` before the first fixed step built it.

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

##### addForce()

> **addForce**(`force`, `point?`): `void`

Applies a force for one fixed step. Call it from `fixedUpdate`.

###### Parameters

###### force

`Vec3Like`

Newtons, world space.

###### point?

`Vec3Like`

Where to apply it; defaults to the entity's world position.

###### Returns

`void`

###### Example

```ts
fixedUpdate(): void {
  this.body.addForce({ x: 0, y: 20, z: 0 });
}
```

##### addImpulse()

> **addImpulse**(`impulse`, `point?`): `void`

Applies an instantaneous impulse.

###### Parameters

###### impulse

`Vec3Like`

Newton-seconds, world space.

###### point?

`Vec3Like`

Where to apply it; defaults to the entity's world position.

###### Returns

`void`

##### angularVelocityToRef()

> **angularVelocityToRef**(`out`): `MutableVec3`

Reads the angular velocity without allocating.

###### Parameters

###### out

`MutableVec3`

The vector to write.

###### Returns

`MutableVec3`

`out`.

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

> **linearVelocityToRef**(`out`): `MutableVec3`

Reads the linear velocity without allocating.

###### Parameters

###### out

`MutableVec3`

The vector to write.

###### Returns

`MutableVec3`

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
`mass`, `freezeRotation`, or the entity's scale.

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

`Vec3Like`

The new world position.

###### rotation?

`QuatLike`

The new world rotation; defaults to the current one.

###### Returns

`void`

***

### SphereCollider

A sphere collider. Non-uniform scale is not representable as a sphere, so the largest scale axis
wins — the same rule Unity applies.

#### Extends

- [`Collider`](#abstract-collider)

#### Constructors

##### Constructor

> **new SphereCollider**(): [`SphereCollider`](#spherecollider)

Applies this collider's defaults on top of the shared ones.

###### Returns

[`SphereCollider`](#spherecollider)

###### Overrides

[`Collider`](#abstract-collider).[`constructor`](#constructor-3)

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `true`

Several colliders on one entity form one compound body (`09-physics.md` §2.2).

###### Inherited from

[`Collider`](#abstract-collider).[`allowMultiple`](#allowmultiple-3)

##### center

> **center**: `Vec3Like`

The shape's offset from the entity origin, in local units.

###### Inherited from

[`Collider`](#abstract-collider).[`center`](#center-3)

##### inlineMaterial

> **inlineMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues) \| `null`

An inline surface, used when [Collider.material](#material-2) is `null`.

###### Inherited from

[`Collider`](#abstract-collider).[`inlineMaterial`](#inlinematerial-2)

##### isTrigger

> **isTrigger**: `boolean`

When `true` the shape reports overlaps and resolves no contacts.

###### Inherited from

[`Collider`](#abstract-collider).[`isTrigger`](#istrigger-2)

##### layerOverride

> **layerOverride**: `string`

The name of the layer this collider filters as, or `""` to use `entity.layer`.

###### Inherited from

[`Collider`](#abstract-collider).[`layerOverride`](#layeroverride-2)

##### material

> **material**: `AssetHandle`\<[`PhysicsMaterial`](#physicsmaterial)\> \| `null`

A `.physicsmaterial.json` reference; wins over [Collider.inlineMaterial](#inlinematerial-2).

###### Inherited from

[`Collider`](#abstract-collider).[`material`](#material-2)

##### radius

> **radius**: `number`

##### schema

> `static` **schema**: `Schema`

The serialized field declarations.

##### typeId

> `static` **typeId**: `string` = `"ignifx/SphereCollider"`

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

[`Collider`](#abstract-collider).[`app`](#app-3)

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

[`Collider`](#abstract-collider).[`enabled`](#enabled-3)

##### entity

###### Get Signature

> **get** **entity**(): `Entity`

The entity this component is attached to.

###### Returns

`Entity`

The owning entity.

###### Inherited from

[`Collider`](#abstract-collider).[`entity`](#entity-3)

##### handle

###### Get Signature

> **get** **handle**(): `ComponentHandle`

The dense runtime handle; invalid after destruction.

###### Returns

`ComponentHandle`

The handle.

###### Inherited from

[`Collider`](#abstract-collider).[`handle`](#handle-3)

##### isDestroyed

###### Get Signature

> **get** **isDestroyed**(): `boolean`

`true` from the moment `destroy()` is called, long before the destroy flush runs.

###### Returns

`boolean`

`true` once the component has been queued for destruction.

###### Inherited from

[`Collider`](#abstract-collider).[`isDestroyed`](#isdestroyed-3)

##### isEnabledInHierarchy

###### Get Signature

> **get** **isEnabledInHierarchy**(): `boolean`

`true` when the component's own flag is set **and** its entity is active in the hierarchy.

###### Returns

`boolean`

`true` when the component is effectively enabled.

###### Inherited from

[`Collider`](#abstract-collider).[`isEnabledInHierarchy`](#isenabledinhierarchy-3)

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

[`Collider`](#abstract-collider).[`onDestroyed`](#ondestroyed-3)

##### transform

###### Get Signature

> **get** **transform**(): `Transform`

The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.

###### Returns

`Transform`

The entity's transform.

###### Inherited from

[`Collider`](#abstract-collider).[`transform`](#transform-3)

##### uid

###### Get Signature

> **get** **uid**(): `string`

The stable ULID; the key files use to reference this component.

###### Returns

`string`

The identifier.

###### Inherited from

[`Collider`](#abstract-collider).[`uid`](#uid-3)

##### world

###### Get Signature

> **get** **world**(): `World`

The world the entity belongs to.

###### Returns

`World`

The world.

###### Inherited from

[`Collider`](#abstract-collider).[`world`](#world-3)

#### Methods

##### createShape()

> **createShape**(`world`, `scale`): `PhysicsShape`

Builds this collider's Havok shape.

###### Parameters

###### world

`PhysicsWorld`

The Havok world the shape belongs to.

###### scale

`Vec3Like`

The entity's lossy scale, applied to the authored dimensions.

###### Returns

`PhysicsShape`

The shape handle.

###### Overrides

`Collider.createShape`

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

[`Collider`](#abstract-collider).[`define`](#define-3)

##### destroy()

> **destroy**(): `void`

Queues this component for destruction. It stays usable until the destroy flush of the current
frame, but reports `isDestroyed === true` immediately
(`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`destroy`](#destroy-3)

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

[`Collider`](#abstract-collider).[`getComponent`](#getcomponent-3)

##### halfExtentsToRef()

> **halfExtentsToRef**(`scale`, `out`): `void`

Writes half the size of this collider's local bounding box, scale applied.

###### Parameters

###### scale

`Vec3Like`

The entity's lossy scale.

###### out

`MutableVec3`

The vector to write.

###### Returns

`void`

###### Overrides

`Collider.halfExtentsToRef`

##### onAttach()

> **onAttach**(): `void`

Marks the entity's body for a rebuild at the start of the next fixed step.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onAttach`](#onattach-3)

##### onDetach()

> **onDetach**(): `void`

Marks the entity's body for a rebuild, which removes this collider from it.

###### Returns

`void`

###### Inherited from

[`Collider`](#abstract-collider).[`onDetach`](#ondetach-3)

##### rebuild()

> **rebuild**(): `void`

Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
changing a size, a `center`, `isTrigger`, or the entity's scale.

###### Returns

`void`

###### Example

```ts
box.size = { x: 2, y: 2, z: 2 };
box.rebuild();
```

###### Inherited from

[`Collider`](#abstract-collider).[`rebuild`](#rebuild-3)

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

[`Collider`](#abstract-collider).[`requireComponent`](#requirecomponent-3)

##### resolveMaterial()

> **resolveMaterial**(`fallback`): [`PhysicsMaterialValues`](#physicsmaterialvalues)

Resolves the surface this collider presents to Havok.

###### Parameters

###### fallback

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The world's `physics.defaultMaterial`.

###### Returns

[`PhysicsMaterialValues`](#physicsmaterialvalues)

The asset's values, the inline values, or the fallback.

###### Inherited from

[`Collider`](#abstract-collider).[`resolveMaterial`](#resolvematerial-2)

## Interfaces

### CharacterCollision

What `CharacterController.onCollided` reports: one dynamic body the character pushed this step.

#### Properties

##### impulse

> `readonly` **impulse**: `Vec3Like`

The world-space impulse the character applied.

##### other

> `readonly` **other**: `Entity` \| `null`

The entity that was pushed, or `null` when it is not an ignifx body.

##### point

> `readonly` **point**: `Vec3Like`

Where the impulse was applied.

***

### Collision

What a script's `onCollisionEnter`/`onCollisionStay`/`onCollisionExit` is handed.

#### Remarks

`other` is `null` under the default `collisionIdentities: "upstream"` mode, because
`@babylonjs/lite@1.27.0` reports collisions without body identities (§4, ADR-0013). Register
`physics({ collisionIdentities: "internal" })` to opt into the waived drain that recovers them.

#### Properties

##### contacts

> `readonly` **contacts**: readonly [`ContactPoint`](#contactpoint)[]

The contacts of this event. Pooled; valid only during the callback.

##### other

> `readonly` **other**: `Entity` \| `null`

The entity that was hit, or `null` when the identity is unavailable.

##### otherCollider

> `readonly` **otherCollider**: [`Collider`](#abstract-collider) \| `null`

The other entity's first collider, or `null`.

##### relativeVelocity

> `readonly` **relativeVelocity**: `Vec3Like` \| `null`

The relative velocity at the contact, or `null` when a body identity is unavailable.

##### self

> `readonly` **self**: `Entity`

The entity whose script is being called.

***

### ContactPoint

One contact point of a collision. Pooled with its owning [Collision](#collision).

#### Properties

##### impulse

> `readonly` **impulse**: `number`

The magnitude of the impulse Havok applied to resolve it; `0` for a contact that just ended.

##### normal

> `readonly` **normal**: `Vec3Like`

The world-space contact normal.

##### point

> `readonly` **point**: `Vec3Like`

The world-space contact point.

***

### FreezeRotation

Whether each rotation axis is frozen.

#### Properties

##### x

> `readonly` **x**: `boolean`

Freeze rotation about X.

##### y

> `readonly` **y**: `boolean`

Freeze rotation about Y.

##### z

> `readonly` **z**: `boolean`

Freeze rotation about Z.

***

### PhysicsDebugViewer

The wireframe overlay `@ignifx/devtools` toggles (`09-physics.md` §9).

#### Properties

##### enabled

> **enabled**: `boolean`

Whether Lite's physics viewer is drawing the bodies into the **render** scene. It needs a GPU
device, so switching it on in a headless app is a no-op that logs a warning.

***

### PhysicsErrorOptions

Options accepted by [physicsError](#physicserror): the same subset of `IgnifxErrorOptions` this package
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

### PhysicsLiteHandles

The Babylon Lite objects the physics extension owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### simulationScene

> `readonly` **simulationScene**: `SceneContext`

The null-engine scene the world is stepped on; also `world.lite.simulationScene`.

##### world

> `readonly` **world**: `PhysicsWorld`

Lite's Havok world handle.

***

### PhysicsMaterialValues

A surface material, either as the `physics.defaultMaterial` setting or inline on a collider
(`09-physics.md` §2.2, §2.4).

#### Properties

##### friction

> `readonly` **friction**: `number`

The dynamic friction coefficient.

##### restitution

> `readonly` **restitution**: `number`

How much of the approach speed is returned, `0` to `1`.

##### staticFriction

> `readonly` **staticFriction**: `number`

The static friction coefficient.

***

### PhysicsOptions

What `physics()` accepts.

#### Properties

##### collisionIdentities?

> `readonly` `optional` **collisionIdentities?**: `"upstream"` \| `"internal"`

How collision callbacks learn which bodies took part (ADR-0013). `"upstream"` is the default and
delivers contacts with `other === null`, because `@babylonjs/lite@1.27.0` reports no identities;
`"internal"` opts into the waived adapter-internal drain that recovers them.

##### havok?

> `readonly` `optional` **havok?**: `unknown`

An already-instantiated Havok module, which skips loading entirely.

##### wasmBinary?

> `readonly` `optional` **wasmBinary?**: `ArrayBuffer`

The `HavokPhysics.wasm` bytes, for a host that reads them itself.

***

### PhysicsSettings

The resolved `physics` settings section.

#### Example

```ts
// ignifx.config.ts
export default {
  layers: { layers: ["Default", "Player", "Enemy"] },
  physics: {
    gravity: { x: 0, y: -9.81, z: 0 },
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

> `readonly` **defaultMaterial**: [`PhysicsMaterialValues`](#physicsmaterialvalues)

The material a collider with no material of its own uses.

##### gravity

> `readonly` **gravity**: `Vec3Like`

World gravity in metres per second squared.

##### havokWasm

> `readonly` **havokWasm**: `string`

`"auto"` to resolve `HavokPhysics.wasm` through the asset manifest, or an explicit URL.

##### interpolation

> `readonly` **interpolation**: `boolean`

Whether dynamic bodies and character controllers interpolate between fixed steps.

##### velocityLimits

> `readonly` **velocityLimits**: [`VelocityLimitSettings`](#velocitylimitsettings)

The world speed clamps.

***

### QueryOptions

Options every query accepts.

#### Extended by

- [`ShapeCastOptions`](#shapecastoptions)

#### Properties

##### hitTriggers?

> `readonly` `optional` **hitTriggers?**: `boolean`

Whether trigger volumes count as hits. Defaults to `false`.

##### layerMask?

> `readonly` `optional` **layerMask?**: `LayerMask`

Which layers the query may hit. Defaults to everything.

***

### RaycastHit

What a ray hit.

#### Remarks

The object is freshly allocated per hit, so it is safe to keep. Queries are not a per-frame path
for most games; a game that raycasts every frame should hoist the result and reuse the vectors it
copies out of it.

#### Properties

##### collider

> `readonly` **collider**: [`Collider`](#abstract-collider) \| `null`

The collider on that entity, or `null` when the entity has none registered any more.

##### distance

> `readonly` **distance**: `number`

The distance from the ray origin, in metres.

##### entity

> `readonly` **entity**: `Entity`

The entity that was hit.

##### normal

> `readonly` **normal**: `Vec3Like`

The world-space surface normal.

##### point

> `readonly` **point**: `Vec3Like`

The world-space contact point.

##### triangleIndex

> `readonly` **triangleIndex**: `number`

The triangle index on a `MeshCollider`, or `-1` for a primitive.

***

### RigidbodyLiteHandles

The Babylon Lite objects a `Rigidbody` owns. Unstable escape hatch
(`docs/architecture/00-overview.md` §3).

#### Properties

##### body

> `readonly` **body**: `PhysicsBody` \| `null`

The Havok body, or `null` before the first fixed step has built it.

***

### ShapeCastHit

What a shape sweep hit.

#### Properties

##### collider

> `readonly` **collider**: [`Collider`](#abstract-collider) \| `null`

The collider on that entity, or `null`.

##### distance

> `readonly` **distance**: `number`

The distance travelled before contact, in metres.

##### entity

> `readonly` **entity**: `Entity` \| `null`

The entity the swept shape hit, or `null` when the bounds index cannot identify it.

##### fraction

> `readonly` **fraction**: `number`

How far along the sweep the contact occurs, in `[0, 1]`.

##### normal

> `readonly` **normal**: `Vec3Like`

The world-space contact normal on the hit body.

##### point

> `readonly` **point**: `Vec3Like`

The world-space contact point on the hit body.

***

### ShapeCastOptions

Options a shape sweep accepts, on top of [QueryOptions](#queryoptions).

#### Remarks

`ignore` exists because a sweep that starts at or inside a body — a camera boom leaving its
target's capsule, a step probe leaving the character's own feet — reports that body at fraction
zero and nothing else. Lite's sweep can exclude exactly one body, and cannot filter by layer at
all (`ShapeCastQuery` has `ignoreBody` and no collision masks, unlike `physicsRaycast`), so
`layerMask` decides which hit is *attributed* an entity while `ignore` is the one body the
geometry itself passes through. Added 2026-09-08.

#### Extends

- [`QueryOptions`](#queryoptions)

#### Properties

##### hitTriggers?

> `readonly` `optional` **hitTriggers?**: `boolean`

Whether trigger volumes count as hits. Defaults to `false`.

###### Inherited from

[`QueryOptions`](#queryoptions).[`hitTriggers`](#hittriggers)

##### ignore?

> `readonly` `optional` **ignore?**: `Entity` \| `null`

An entity whose body the sweep passes through — usually the caller's own. A `Rigidbody`, a
collider-only static, and a `CharacterController` capsule are all accepted; an entity with no
body is ignored.

##### layerMask?

> `readonly` `optional` **layerMask?**: `LayerMask`

Which layers the query may hit. Defaults to everything.

###### Inherited from

[`QueryOptions`](#queryoptions).[`layerMask`](#layermask)

***

### TriggerEvent

What a script's `onTriggerEnter`/`onTriggerExit` is handed.

#### Example

```ts
class Pickup extends Script implements ScriptCallbacks {
  static typeId = "mygame/Pickup";
  onTriggerEnter(trigger: TriggerEvent): void {
    if (trigger.other?.tags.has("player") === true) {
      this.entity.destroy();
    }
  }
}
```

#### Properties

##### other

> `readonly` **other**: `Entity` \| `null`

The entity that entered or left, or `null` when Havok no longer tracks its body.

##### otherCollider

> `readonly` **otherCollider**: [`Collider`](#abstract-collider) \| `null`

The other entity's first collider, or `null`. Lite reports no shape identity (§4).

##### self

> `readonly` **self**: `Entity`

The entity whose script is being called.

***

### VelocityLimitSettings

The world-wide speed clamps Havok applies (`setPhysicsVelocityLimits`, `index.d.ts` 10880). A
value of `0` means "leave Havok's own default alone".

#### Properties

##### angular

> `readonly` **angular**: `number`

Maximum angular speed in radians per second, or `0` for Havok's default.

##### linear

> `readonly` **linear**: `number`

Maximum linear speed in metres per second, or `0` for Havok's default.

## Type Aliases

### BodyType

> **BodyType** = *typeof* [`BODY_TYPES`](#body_types)\[`number`\]

The union of [BODY\_TYPES](#body_types).

***

### CapsuleDirection

> **CapsuleDirection** = *typeof* [`CAPSULE_DIRECTIONS`](#capsule_directions)\[`number`\]

The union of [CAPSULE\_DIRECTIONS](#capsule_directions).

***

### CollisionEventMode

> **CollisionEventMode** = *typeof* [`COLLISION_EVENT_MODES`](#collision_event_modes)\[`number`\]

The union of [COLLISION\_EVENT\_MODES](#collision_event_modes).

***

### CollisionIdentityMode

> **CollisionIdentityMode** = *typeof* [`COLLISION_IDENTITY_MODES`](#collision_identity_modes)\[`number`\]

The union of [COLLISION\_IDENTITY\_MODES](#collision_identity_modes).

***

### InterpolationMode

> **InterpolationMode** = *typeof* [`INTERPOLATION_MODES`](#interpolation_modes)\[`number`\]

The union of [INTERPOLATION\_MODES](#interpolation_modes).

***

### KinematicSyncMode

> **KinematicSyncMode** = *typeof* [`KINEMATIC_SYNC_MODES`](#kinematic_sync_modes)\[`number`\]

The union of [KINEMATIC\_SYNC\_MODES](#kinematic_sync_modes).

***

### PhysicsErrorCode

> **PhysicsErrorCode** = *typeof* [`PhysicsErrorCode`](#physicserrorcode)\[keyof *typeof* [`PhysicsErrorCode`](#physicserrorcode)\]

The union of the codes the `PhysicsErrorCode` table declares.

***

### QueryShape

> **QueryShape** = \{ `kind`: `"sphere"`; `radius`: `number`; \} \| \{ `kind`: `"box"`; `size`: `Vec3Like`; \} \| \{ `height`: `number`; `kind`: `"capsule"`; `radius`: `number`; \}

A shape to sweep or to test for overlaps. It is a description, not a component: the service builds
the Havok shape for the call and releases it afterwards.

***

### SupportStateName

> **SupportStateName** = *typeof* [`SUPPORT_STATES`](#support_states)\[`number`\]

The union of [SUPPORT\_STATES](#support_states).

## Variables

### BODY\_TYPES

> `const` **BODY\_TYPES**: readonly \[`"dynamic"`, `"kinematic"`, `"static"`\]

How a body moves.

***

### CAPSULE\_DIRECTIONS

> `const` **CAPSULE\_DIRECTIONS**: readonly \[`"x"`, `"y"`, `"z"`\]

The axis a capsule stands along.

***

### COLLISION\_EVENT\_MODES

> `const` **COLLISION\_EVENT\_MODES**: readonly \[`"auto"`, `"on"`, `"off"`\]

Whether collision callbacks are delivered for this body.

***

### COLLISION\_IDENTITY\_MODES

> `const` **COLLISION\_IDENTITY\_MODES**: readonly \[`"upstream"`, `"internal"`\]

How collision events learn which bodies took part (`09-physics.md` §4, ADR-0013).

***

### HAVOK\_WASM\_AUTO

> `const` **HAVOK\_WASM\_AUTO**: `"auto"` = `"auto"`

The value [PhysicsSettings.havokWasm](#havokwasm) carries when the address comes from the manifest.

***

### INTERPOLATION\_MODES

> `const` **INTERPOLATION\_MODES**: readonly \[`"none"`, `"interpolate"`\]

Whether a body's display pose is interpolated between fixed steps.

***

### KINEMATIC\_SYNC\_MODES

> `const` **KINEMATIC\_SYNC\_MODES**: readonly \[`"teleport"`, `"velocity"`\]

How a moved kinematic node reaches Havok.

***

### physics

> `const` **physics**: (`options?`) => `Extension`

Builds the physics extension.

#### Parameters

##### options?

[`PhysicsOptions`](#physicsoptions)

The collision-identity mode and, optionally, where Havok comes from.

#### Returns

`Extension`

The extension descriptor.

#### Example

```ts
const app = await createApp({ headless: true, extensions: [physics()] });
```

***

### PHYSICS\_DIAGNOSTICS\_COUNTERS

> `const` **PHYSICS\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters `09-physics.md` §9 and the plan's diagnostics deliverable name.

***

### PHYSICS\_DIAGNOSTICS\_GROUP

> `const` **PHYSICS\_DIAGNOSTICS\_GROUP**: `"physics"` = `"physics"`

The diagnostics group name.

***

### PHYSICS\_ERROR\_MESSAGES

> `const` **PHYSICS\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### PHYSICS\_MATERIAL\_ASSET\_TYPE

> `const` **PHYSICS\_MATERIAL\_ASSET\_TYPE**: `"physicsmaterial"` = `"physicsmaterial"`

The asset type name `.physicsmaterial.json` addresses resolve to.

***

### PHYSICS\_MATERIAL\_FILE\_EXTENSION

> `const` **PHYSICS\_MATERIAL\_FILE\_EXTENSION**: `".physicsmaterial.json"` = `".physicsmaterial.json"`

The address suffix that selects the loader.

***

### PHYSICS\_MATERIAL\_FILE\_FORMAT

> `const` **PHYSICS\_MATERIAL\_FILE\_FORMAT**: `"ignifx.physicsmaterial"` = `"ignifx.physicsmaterial"`

The `format` string every physics-material document declares.

***

### PHYSICS\_MATERIAL\_FORMAT\_VERSION

> `const` **PHYSICS\_MATERIAL\_FORMAT\_VERSION**: `1` = `1`

The file format version; `1` before ignifx 1.0.

***

### PHYSICS\_SETTINGS\_SECTION

> `const` **PHYSICS\_SETTINGS\_SECTION**: `"physics"` = `"physics"`

The section name as it appears in `ignifx.config.ts`.

***

### PhysicsErrorCode

> `const` **PhysicsErrorCode**: `object`

Every diagnostic code `@ignifx/physics` can throw or report, keyed by an intention-revealing name
so call sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### bodyOnChildEntity

> `readonly` **bodyOnChildEntity**: `"IGX-0907"` = `"IGX-0907"`

A physics body was built for an entity that has a parent, whose node pose is not world space.

##### colliderGeometryUnavailable

> `readonly` **colliderGeometryUnavailable**: `"IGX-0906"` = `"IGX-0906"`

A `MeshCollider` has no geometry to build a shape from.

##### havokUnavailable

> `readonly` **havokUnavailable**: `"IGX-0903"` = `"IGX-0903"`

The Havok WebAssembly module could not be loaded.

##### internalDrainUnavailable

> `readonly` **internalDrainUnavailable**: `"IGX-0908"` = `"IGX-0908"`

The ADR-0013 collision drain refused to bind because Babylon Lite's internals moved.

##### invalidMaterialFile

> `readonly` **invalidMaterialFile**: `"IGX-0904"` = `"IGX-0904"`

A `.physicsmaterial.json` file is not an `ignifx.physicsmaterial` document this build reads.

##### movedStaticBody

> `readonly` **movedStaticBody**: `"IGX-0901"` = `"IGX-0901"`

An entity with colliders but no `Rigidbody` moved after its implicit static body was placed.

##### queryBeforeStep

> `readonly` **queryBeforeStep**: `"IGX-0902"` = `"IGX-0902"`

A query ran before the first completed fixed step, so Havok has no broadphase yet.

##### unknownLayer

> `readonly` **unknownLayer**: `"IGX-0905"` = `"IGX-0905"`

The `physics.collisionMatrix` setting names a layer the project does not declare.

#### Example

```ts
throw physicsError(PhysicsErrorCode.queryBeforeStep, "raycast() ran before the first step.", {
  context: { query: "raycast" },
});
```

***

### SUPPORT\_STATES

> `const` **SUPPORT\_STATES**: readonly \[`"unsupported"`, `"sliding"`, `"supported"`\]

How the character is supported by whatever is under it.

## Functions

### colliderFields()

> **colliderFields**(): `Schema`

The fields every collider declares. It is a function because a field kind is a function call and
module scope holds declarations only (`CONSTITUTION.md` §3.5).

#### Returns

`Schema`

The shared field declarations, ready to spread into a collider's own schema.

***

### createPhysicsMaterialLoader()

> **createPhysicsMaterialLoader**(): `AssetLoader`\<[`PhysicsMaterial`](#physicsmaterial)\>

Builds the loader for `.physicsmaterial.json` files.

#### Returns

`AssetLoader`\<[`PhysicsMaterial`](#physicsmaterial)\>

The loader, ready for `ctx.registerAssetLoader`.

***

### defaultPhysicsSettings()

> **defaultPhysicsSettings**(): [`PhysicsSettings`](#physicssettings)

The values used when a project omits the `physics` section.

#### Returns

[`PhysicsSettings`](#physicssettings)

A fresh defaults object.

***

### describePhysicsMaterialFileFormat()

> **describePhysicsMaterialFileFormat**(): `SchemaDescription`

Describes the `ignifx.physicsmaterial` file format for the documentation harness
(`docs/architecture/16-docs-harness-and-skill.md` §3).

#### Returns

`SchemaDescription`

The description of the top-level file fields.

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component and file format this package declares.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The records, keyed by namespaced type id.

#### Example

```ts
const schemas = describeSchemas();
schemas["ignifx/Rigidbody"].fields["mass"].default; // 1
```

***

### parsePhysicsMaterial()

> **parsePhysicsMaterial**(`address`, `document`): [`PhysicsMaterial`](#physicsmaterial)

Parses one `ignifx.physicsmaterial` document.

#### Parameters

##### address

`string`

The address it came from, for the diagnostic.

##### document

`JsonValue`

The parsed JSON.

#### Returns

[`PhysicsMaterial`](#physicsmaterial)

The material.

#### Throws

IgnifxError with code `IGX-0904` when the document is not one this build can read.

***

### physicsError()

> **physicsError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`PhysicsErrorCode`](#physicserrorcode-1)

The code from the `PhysicsErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`PhysicsErrorOptions`](#physicserroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to reject with.

#### Example

```ts
throw physicsError(PhysicsErrorCode.unknownLayer, "physics.collisionMatrix names Enemy.", {
  context: { layer: "Enemy" },
});
```

***

### physicsSettingsSchema()

> **physicsSettingsSchema**(): `Schema`

Builds the schema the `physics` section is validated against.

#### Returns

`Schema`

The schema.

#### Remarks

It is a function, not a module-level constant: every field kind is a function call, and module
scope holds declarations and immutable constants only (`CONSTITUTION.md` §3.5).

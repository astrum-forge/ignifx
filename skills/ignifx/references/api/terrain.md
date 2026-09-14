# @ignifx/terrain

`@ignifx/terrain` public barrel: heightmap and procedural terrains with chunked geomipmapped LOD,
a splat surface shader on PBR, gameplay queries, sculpting, and seeded foliage
(`docs/plan/2026-09-terrain-particles-shaders.md` §5, `docs/adr/0023-terrain-chunked-geomipmapping.md`).

Explicit named re-exports only — no `export *` (coding standards §4). Everything the adapter owns
(`src/lite/**`) stays internal apart from the type aliases the `.lite` escape hatches name.

## Classes

### Frustum

Six planes extracted from a view-projection matrix.

#### Example

```ts
const frustum = new Frustum();
frustum.setFromViewProjection(viewProjection.elements);
frustum.intersectsBox(-1, 0, -1, 1, 2, 1);
```

#### Constructors

##### Constructor

> **new Frustum**(): [`Frustum`](#frustum)

###### Returns

[`Frustum`](#frustum)

#### Properties

##### planes

> `readonly` **planes**: `Float32Array`

The planes, four floats each, normalised: left, right, bottom, top, near, far.

#### Accessors

##### isValid

###### Get Signature

> **get** **isValid**(): `boolean`

Whether the last matrix given produced a usable frustum. A headless camera with no surface, or
a matrix with a non-finite element, does not; then nothing is culled.

###### Returns

`boolean`

`true` when [Frustum.intersectsBox](#intersectsbox) can answer.

#### Methods

##### intersectsBox()

> **intersectsBox**(`minX`, `minY`, `minZ`, `maxX`, `maxY`, `maxZ`): `boolean`

Whether an axis-aligned box is at least partly inside the frustum.

###### Parameters

###### minX

`number`

The box's smallest X.

###### minY

`number`

The box's smallest Y.

###### minZ

`number`

The box's smallest Z.

###### maxX

`number`

The box's largest X.

###### maxY

`number`

The box's largest Y.

###### maxZ

`number`

The box's largest Z.

###### Returns

`boolean`

`false` only when the box is wholly outside one plane.

###### Remarks

Conservative: a box that straddles a corner may be reported inside when it is not, which costs
a draw, never a missing chunk. An invalid frustum reports everything inside.

##### setFromViewProjection()

> **setFromViewProjection**(`m`): `boolean`

Extracts the planes from a column-major view-projection matrix.

###### Parameters

###### m

`ArrayLike`\<`number`\>

Sixteen column-major elements, `m[column * 4 + row]`.

###### Returns

`boolean`

Whether the frustum is valid.

***

### HeightField

A regular grid of heights and the queries over it.

#### Example

```ts
const field = HeightField.fromNormalised(65, { width: 64, depth: 64, height: 10 }, values);
field.heightAt(3.5, -2); // metres, bilinear
```

#### Constructors

##### Constructor

> **new HeightField**(`resolution`, `size`, `heights?`): [`HeightField`](#heightfield)

Wraps a height array.

###### Parameters

###### resolution

`number`

Samples per side.

###### size

[`TerrainSize`](#terrainsize-1)

The extent, in metres.

###### heights?

`Float32Array`\<`ArrayBufferLike`\>

`resolution * resolution` heights in metres, or omitted for a flat field.

###### Returns

[`HeightField`](#heightfield)

###### Throws

IgnifxError with code `IGX-1608` when `heights` has the wrong length.

#### Properties

##### depth

> `readonly` **depth**: `number`

The extent along Z, in metres.

##### height

> `readonly` **height**: `number`

The height a full-scale sample reaches, in metres.

##### heights

> `readonly` **heights**: `Float32Array`

The heights, in metres, row-major: `heights[iz * resolution + ix]`. Mutating it directly is
allowed for bulk generation; go through [HeightField.setHeights](#setheights) when something has to be
told, because a `Terrain` rebuilds only the chunks that method names.

##### resolution

> `readonly` **resolution**: `number`

Samples per side.

##### spacingX

> `readonly` **spacingX**: `number`

Metres between neighbouring samples along X.

##### spacingZ

> `readonly` **spacingZ**: `number`

Metres between neighbouring samples along Z.

##### width

> `readonly` **width**: `number`

The extent along X, in metres.

#### Methods

##### assertRegion()

> **assertRegion**(`x`, `z`, `width`, `depth`): `void`

Refuses a rectangle that does not lie inside the field.

###### Parameters

###### x

`number`

The first column.

###### z

`number`

The first row.

###### width

`number`

How many columns.

###### depth

`number`

How many rows.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-1610`.

##### fromNormalised()

> `static` **fromNormalised**(`resolution`, `size`, `values`): [`HeightField`](#heightfield)

Builds a field from normalised values, `0..1` mapped onto `0..size.height`.

###### Parameters

###### resolution

`number`

Samples per side.

###### size

[`TerrainSize`](#terrainsize-1)

The extent, in metres.

###### values

`Float32Array`

`resolution * resolution` values, row-major.

###### Returns

[`HeightField`](#heightfield)

The field.

###### Throws

IgnifxError with code `IGX-1608` when the value count does not match.

##### fromSamples16()

> `static` **fromSamples16**(`resolution`, `size`, `samples`): [`HeightField`](#heightfield)

Builds a field from 16-bit samples, `0..65535` mapped onto `0..size.height`.

###### Parameters

###### resolution

`number`

Samples per side.

###### size

[`TerrainSize`](#terrainsize-1)

The extent, in metres.

###### samples

`Uint16Array`

`resolution * resolution` samples, row-major.

###### Returns

[`HeightField`](#heightfield)

The field.

###### Throws

IgnifxError with code `IGX-1608` when the sample count does not match.

##### heightAt()

> **heightAt**(`x`, `z`): `number`

The height under a local point, bilinearly interpolated; points outside the field read the
nearest edge.

###### Parameters

###### x

`number`

Metres along X.

###### z

`number`

Metres along Z.

###### Returns

`number`

The height in metres.

##### localToSampleX()

> **localToSampleX**(`x`): `number`

The fractional sample column of a local X.

###### Parameters

###### x

`number`

Metres along X.

###### Returns

`number`

The column, unclamped.

##### localToSampleZ()

> **localToSampleZ**(`z`): `number`

The fractional sample row of a local Z.

###### Parameters

###### z

`number`

Metres along Z.

###### Returns

`number`

The row, unclamped.

##### minMax()

> **minMax**(`x`, `z`, `width`, `depth`, `out`): `Float32Array`

The lowest and highest sample inside a rectangle.

###### Parameters

###### x

`number`

The first column.

###### z

`number`

The first row.

###### width

`number`

How many columns.

###### depth

`number`

How many rows.

###### out

`Float32Array`

Receives `[min, max]`.

###### Returns

`Float32Array`

`out`, for chaining.

##### normalAt()

> **normalAt**(`x`, `z`, `out`): `MutableVec3`

The unit surface normal under a local point, from central differences one sample apart.

###### Parameters

###### x

`number`

Metres along X.

###### z

`number`

Metres along Z.

###### out

`MutableVec3`

Receives the normal.

###### Returns

`MutableVec3`

`out`, for chaining.

##### raycast()

> **raycast**(`ray`, `out`): `boolean`

Marches a ray across the field and reports where it first crosses the surface.

###### Parameters

###### ray

`Ray`

The ray, in local metres.

###### out

[`TerrainHit`](#terrainhit)

Receives the hit.

###### Returns

`boolean`

`true` when the ray hit the surface within `ray.length`.

###### Remarks

The ray is clipped to the field's bounding box first, then stepped at half a sample spacing;
once a step finds the ray below the surface the crossing is bisected. The ray and the hit are in
the field's local frame.

##### sample()

> **sample**(`ix`, `iz`): `number`

One sample, with the indices clamped to the grid.

###### Parameters

###### ix

`number`

The column.

###### iz

`number`

The row.

###### Returns

`number`

The height in metres.

##### sampleNormal()

> **sampleNormal**(`ix`, `iz`, `out`): `MutableVec3`

The unit surface normal at a sample, from central differences of its neighbours. What the chunk
builder reads at every LOD, so coarse and fine meshes shade the same.

###### Parameters

###### ix

`number`

The column.

###### iz

`number`

The row.

###### out

`MutableVec3`

Receives the normal.

###### Returns

`MutableVec3`

`out`, for chaining.

##### sampleToLocalX()

> **sampleToLocalX**(`ix`): `number`

The local X of a sample column.

###### Parameters

###### ix

`number`

The column.

###### Returns

`number`

Metres along X.

##### sampleToLocalZ()

> **sampleToLocalZ**(`iz`): `number`

The local Z of a sample row.

###### Parameters

###### iz

`number`

The row.

###### Returns

`number`

Metres along Z.

##### setHeights()

> **setHeights**(`x`, `z`, `width`, `depth`, `heights`): `void`

Overwrites a rectangle of samples.

###### Parameters

###### x

`number`

The first column.

###### z

`number`

The first row.

###### width

`number`

How many columns.

###### depth

`number`

How many rows.

###### heights

`Float32Array`

`width * depth` heights in metres, row-major.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-1610` when the rectangle falls outside the field or `heights`
is too short.

##### slopeAt()

> **slopeAt**(`x`, `z`): `number`

The slope under a local point, in degrees from horizontal.

###### Parameters

###### x

`number`

Metres along X.

###### z

`number`

Metres along Z.

###### Returns

`number`

The slope, `0` flat, `90` vertical.

***

### Terrain

A chunked, geomipmapped terrain.

#### Example

```ts
const ground = app.world.createEntity("Terrain");
const terrain = ground.addComponent(Terrain, { definition: island });
terrain.heightAt(0, 0);
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new Terrain**(): [`Terrain`](#terrain-1)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`Terrain`](#terrain-1)

###### Overrides

`Component.constructor`

#### Properties

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One terrain per entity.

##### definition

> **definition**: `AssetHandle`\<[`TerrainAsset`](#terrainasset-1)\> \| `null`

The terrain document this component draws.

##### frustumCulling

> **frustumCulling**: `boolean`

Whether chunks outside the camera's frustum are hidden.

##### lodBias

> **lodBias**: `number`

Multiplies every LOD threshold; above `1` keeps fine meshes further from the camera.

##### receiveShadows

> **receiveShadows**: `boolean`

Whether shadow maps darken the terrain. Chunks never **cast**; see the skill's gotchas.

##### schema

> `static` **schema**: `Schema`

The declarative fields (ADR-0004).

##### typeId

> `static` **typeId**: `string` = `"ignifx/Terrain"`

The registration id the serializer writes into scene files.

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

##### asset

###### Get Signature

> **get** **asset**(): [`TerrainAsset`](#terrainasset-1) \| `null`

The loaded asset.

###### Returns

[`TerrainAsset`](#terrainasset-1) \| `null`

The asset, or `null` until it is delivered.

##### chunkCount

###### Get Signature

> **get** **chunkCount**(): `number`

How many chunks the terrain is cut into.

###### Returns

`number`

The chunk count; `0` before the asset is delivered.

##### drawCalls

###### Get Signature

> **get** **drawCalls**(): `number`

How many draw calls the terrain costs: one per visible chunk, because every chunk is one mesh
with one material. `engine.drawCallCount` counts hidden bindings and is not this number.

###### Returns

`number`

The count.

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

##### heights

###### Get Signature

> **get** **heights**(): `Float32Array`

The heights in metres, row-major, in the terrain's local frame. Write through
[Terrain.setHeights](#setheights-1); a direct write rebuilds nothing.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

###### Returns

`Float32Array`

The live array.

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

##### isLoaded

###### Get Signature

> **get** **isLoaded**(): `boolean`

Whether the asset has been delivered and the terrain is ready to answer queries.

###### Returns

`boolean`

`true` once the document has loaded.

##### material

###### Get Signature

> **get** **material**(): `AssetHandle`\<`MaterialAsset`\> \| `null`

The material the chunks draw with: one PBR material carrying the `terrainSplat` surface shader.

###### Returns

`AssetHandle`\<`MaterialAsset`\> \| `null`

The material, or `null` headless and before the asset loads.

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

##### onHeightsChanged

###### Get Signature

> **get** **onHeightsChanged**(): `Signal`\<[`TerrainRegion`](#terrainregion)\>

Fires after [Terrain.setHeights](#setheights-1) with the sample rectangle that changed, so a collider
and a scatter can follow.

###### Returns

`Signal`\<[`TerrainRegion`](#terrainregion)\>

The signal.

##### resolution

###### Get Signature

> **get** **resolution**(): `number`

Samples per side.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

###### Returns

`number`

The resolution.

##### size

###### Get Signature

> **get** **size**(): [`TerrainSize`](#terrainsize-1)

The extent in metres the document declares, before the entity's scale.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

###### Returns

[`TerrainSize`](#terrainsize-1)

The size.

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

##### visibleChunks

###### Get Signature

> **get** **visibleChunks**(): `number`

How many chunks the last LOD pass left visible.

###### Returns

`number`

The count.

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

##### bounds()

> **bounds**(`out`): `Float32Array`

The terrain's world-space bounding box, skirts excluded.

###### Parameters

###### out

`Float32Array`

Receives `[minX, minY, minZ, maxX, maxY, maxZ]`.

###### Returns

`Float32Array`

`out`, for chaining.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

##### colliderInit()

> **colliderInit**(`region?`): [`TerrainColliderInit`](#terraincolliderinit-1)

The initialisation a `HeightfieldCollider` takes, by data.

###### Parameters

###### region?

[`TerrainRegion`](#terrainregion)

The sample rectangle to cover. Defaults to the whole field.

###### Returns

[`TerrainColliderInit`](#terraincolliderinit-1)

The init object.

###### Remarks

Values are in the terrain's **local** frame; the collider applies the entity's scale itself
(`packages/physics/src/components/colliders.ts`). A `HeightfieldCollider` always centres its
shape on its own entity and ignores `Collider.center`, so a `region` collider belongs on a
child entity placed at [Terrain.regionCenter](#regioncenter).

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered, or `IGX-1610` when the
region falls outside the field or is smaller than two samples on a side.

###### Example

```ts
const collider = ground.addComponent(HeightfieldCollider, terrain.colliderInit());
terrain.onHeightsChanged.connect(() => {
  Object.assign(collider, terrain.colliderInit());
  collider.rebuild();
}, { owner: this });
```

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

##### heightAt()

> **heightAt**(`x`, `z`): `number`

The height of the surface under a world-space point, bilinearly interpolated. Points outside
the terrain read the nearest edge.

###### Parameters

###### x

`number`

The world X, in metres.

###### z

`number`

The world Z, in metres.

###### Returns

`number`

The world Y of the surface, in metres.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

##### lodOf()

> **lodOf**(`chunkX`, `chunkZ`): `number`

The level of detail a chunk is showing.

###### Parameters

###### chunkX

`number`

The chunk column.

###### chunkZ

`number`

The chunk row.

###### Returns

`number`

The level, or `0` before the asset is delivered.

##### normalAt()

> **normalAt**(`x`, `z`, `out`): `MutableVec3`

The unit surface normal under a world-space point.

###### Parameters

###### x

`number`

The world X, in metres.

###### z

`number`

The world Z, in metres.

###### out

`MutableVec3`

Receives the normal.

###### Returns

`MutableVec3`

`out`, for chaining.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

##### onAttach()

> **onAttach**(): `void`

Builds nothing: the asset may still be loading, so the LOD system does the work.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Destroys the chunk meshes and releases the material.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### raycast()

> **raycast**(`ray`, `out`): `boolean`

Marches a world-space ray across the terrain and reports where it first meets the surface.

###### Parameters

###### ray

`Ray`

The ray, in world metres.

###### out

[`TerrainHit`](#terrainhit)

Receives the hit, in world space.

###### Returns

`boolean`

`true` when the ray hit inside `ray.length`.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

##### regionCenter()

> **regionCenter**(`region`, `out`): `MutableVec3`

Where a region's centre sits in the terrain's local frame.

###### Parameters

###### region

[`TerrainRegion`](#terrainregion)

The sample rectangle.

###### out

`MutableVec3`

Receives the centre; `y` is always `0`.

###### Returns

`MutableVec3`

`out`, for chaining.

###### Remarks

A `HeightfieldCollider` centres its shape on its own entity, so a collider built from
[Terrain.colliderInit](#colliderinit) with a `region` goes on a child entity whose `localPosition` is
this point. The whole field's centre is the origin, which is why a full-field collider needs no
child entity at all.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered, or `IGX-1610` when the
region falls outside the field.

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

##### sampleToWorld()

> **sampleToWorld**(`ix`, `iz`, `out`): `MutableVec3`

The world-space position of a sample.

###### Parameters

###### ix

`number`

The sample column.

###### iz

`number`

The sample row.

###### out

`MutableVec3`

Receives the position.

###### Returns

`MutableVec3`

`out`, for chaining.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

##### setHeights()

> **setHeights**(`x`, `z`, `width`, `depth`, `heights`): `void`

Overwrites a rectangle of heights and rebuilds the chunks it touches.

###### Parameters

###### x

`number`

The first sample column.

###### z

`number`

The first sample row.

###### width

`number`

How many columns.

###### depth

`number`

How many rows.

###### heights

`Float32Array`

`width * depth` heights in metres, row-major, in the terrain's local frame.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered, or `IGX-1610` when the
rectangle falls outside the field or `heights` is too short.

##### setSplat()

> **setSplat**(`layer`, `x`, `z`, `width`, `depth`, `weights`): `void`

Overwrites one layer's splat weights over a rectangle of control-map texels and re-uploads it.

###### Parameters

###### layer

`number`

The layer's control-channel index.

###### x

`number`

The first texel column.

###### z

`number`

The first texel row.

###### width

`number`

How many columns.

###### depth

`number`

How many rows.

###### weights

`Uint8Array`

`width * depth` weights, `0` to `255`, row-major.

###### Returns

`void`

###### Remarks

The shader normalises the weights of a texel, so a weight is relative to the other layers there
rather than an absolute coverage. The control map has `resolution - 1` texels per side unless a
painted map declared another size.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered, `IGX-1610` when the
rectangle falls outside the control map, or `IGX-1611` for an unknown layer index.

##### slopeAt()

> **slopeAt**(`x`, `z`): `number`

The slope under a world-space point, in degrees from horizontal.

###### Parameters

###### x

`number`

The world X, in metres.

###### z

`number`

The world Z, in metres.

###### Returns

`number`

`0` flat, `90` vertical.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

##### worldToSample()

> **worldToSample**(`x`, `z`, `out`): `Float32Array`

The fractional sample coordinate of a world-space point.

###### Parameters

###### x

`number`

The world X, in metres.

###### z

`number`

The world Z, in metres.

###### out

`Float32Array`

Receives `[column, row]`, unclamped.

###### Returns

`Float32Array`

`out`, for chaining.

###### Throws

IgnifxError with code `IGX-1609` before the asset is delivered.

***

### TerrainAsset

A loaded `.terrain.json`, or a terrain built in code.

#### Example

```ts
const handle = await app.assets.loadAsync<TerrainAsset>("terrain/island.terrain.json");
handle.value.field.heightAt(0, 0);
```

#### Properties

##### address

> `readonly` **address**: `string`

The address the asset was loaded or registered under.

##### assetType

> `static` **assetType**: `string` = `TERRAIN_ASSET_TYPE`

The asset type this class registers under.

##### control

> `readonly` **control**: [`ControlMaps`](#controlmaps)

The splat weights on the CPU; what a `TerrainScatter` reads.

##### controlTextures

> `readonly` **controlTextures**: readonly `AssetHandle`\<`TextureAsset`\>[]

One RGBA texture per control map, in control-map order.

##### definition

> `readonly` **definition**: [`TerrainDefinition`](#terraindefinition-1)

The resolved document, every default filled in.

##### field

> `readonly` **field**: [`HeightField`](#heightfield)

The heights, in metres, in the terrain's local frame.

##### layers

> `readonly` **layers**: [`TerrainLayerTextures`](#terrainlayertextures)

The albedo and normal texture arrays, or `null` handles for a textureless terrain.

##### shader

> `readonly` **shader**: `AssetHandle`\<`ShaderAsset`\>

The generated `terrainSplat` surface shader, shared by every terrain of the same shape.

##### splat

> `readonly` **splat**: [`TerrainSplatShaderSpec`](#terrainsplatshaderspec)

The layer shape the shader was generated for.

#### Accessors

##### isDisposed

###### Get Signature

> **get** **isDisposed**(): `boolean`

Whether [TerrainAsset.dispose](#dispose) has run.

###### Returns

`boolean`

`true` once the asset has released its handles.

#### Methods

##### dispose()

> **dispose**(): `void`

Releases the textures and the shader. The asset service calls this when the asset unloads.

###### Returns

`void`

##### layerIndex()

> **layerIndex**(`name`): `number`

The control-channel index of a named layer.

###### Parameters

###### name

`string`

The layer's name.

###### Returns

`number`

The index, or `-1` when the terrain declares no such layer.

***

### TerrainLodSystem

Selects every terrain's chunk levels of detail and hides what the camera cannot see.

#### Implements

- `System`

#### Constructors

##### Constructor

> **new TerrainLodSystem**(): [`TerrainLodSystem`](#terrainlodsystem)

###### Returns

[`TerrainLodSystem`](#terrainlodsystem)

#### Properties

##### name

> `readonly` **name**: `"ignifx/terrain-lod"` = `"ignifx/terrain-lod"`

The name diagnostics and error reports use.

###### Implementation of

`System.name`

#### Methods

##### update()

> **update**(`ctx`): `void`

Builds, sculpt-syncs, and level-of-detail-selects every terrain in the world.

###### Parameters

###### ctx

`SystemContext`

The world, clock, phase, and delta.

###### Returns

`void`

###### Implementation of

`System.update`

***

### TerrainScatter

Seeded foliage on a terrain.

#### Remarks

`maxInstances` sizes the `InstancedMeshRenderer`'s instance buffer, which Babylon Lite fixes
before the scene is registered, so set it before `app.start()`.

#### Example

```ts
const grass = ground.addComponent(TerrainScatter, {
  mesh: card,
  material: foliage,
  density: 2,
  layers: ["grass"],
  maxInstances: 20_000,
});
```

#### Extends

- `Component`

#### Implements

- `ComponentHooks`

#### Constructors

##### Constructor

> **new TerrainScatter**(): [`TerrainScatter`](#terrainscatter)

Applies the schema defaults, exactly as `Component.define` would.

###### Returns

[`TerrainScatter`](#terrainscatter)

###### Overrides

`Component.constructor`

#### Properties

##### alignToNormal

> **alignToNormal**: `boolean`

Whether each instance stands along the surface normal rather than straight up.

##### allowMultiple

> `static` **allowMultiple**: `boolean` = `false`

One scatter per entity; a second kind of foliage goes on a child.

##### density

> **density**: `number`

Instances per square metre of terrain.

##### height

> **height**: `Vec2Like`

The height band, in metres.

##### layers

> **layers**: `string`[]

Splat layer names to place on; empty places everywhere.

##### layerThreshold

> **layerThreshold**: `number`

The splat weight a named layer must reach before a candidate stands.

##### lodDistance

> **lodDistance**: `number`

Metres past which the LOD mesh takes over.

##### lodMesh

> **lodMesh**: `AssetHandle`\<`MeshAsset`\> \| `null`

A cheaper mesh drawn past [TerrainScatter.lodDistance](#loddistance-1), or `null`.

##### material

> **material**: `AssetHandle`\<`MaterialAsset`\> \| `null`

The material, normally built by `foliageMaterialDefinition`.

##### maxInstances

> **maxInstances**: `number`

The cap on instances, which also sizes the GPU instance buffer.

##### mesh

> **mesh**: `AssetHandle`\<`MeshAsset`\> \| `null`

The mesh every instance draws.

##### randomYaw

> **randomYaw**: `boolean`

Whether each instance is turned by a random angle about Y.

##### requires

> `static` **requires**: readonly \[*typeof* `InstancedMeshRenderer`\]

The renderer the instances are drawn through; added automatically.

##### scale

> **scale**: `Vec2Like`

The random uniform scale range.

##### schema

> `static` **schema**: `Schema`

The declarative fields (ADR-0004).

##### seed

> **seed**: `number`

The placement seed.

##### slope

> **slope**: `Vec2Like`

The slope band, in degrees from horizontal.

##### typeId

> `static` **typeId**: `string` = `"ignifx/TerrainScatter"`

The registration id the serializer writes into scene files.

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

##### count

###### Get Signature

> **get** **count**(): `number`

How many instances are placed.

###### Returns

`number`

The count.

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

Sizes the instance buffer before the scene is registered.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onAttach`

##### onDetach()

> **onDetach**(): `void`

Empties the renderer, so a disabled scatter draws nothing.

###### Returns

`void`

###### Implementation of

`ComponentHooks.onDetach`

##### regenerate()

> **regenerate**(): `void`

Places the instances again, which is what a changed rule needs.

###### Returns

`void`

###### Throws

IgnifxError with code `IGX-1612` when no `Terrain` is on this entity or an ancestor, or
`IGX-1611` when [TerrainScatter.layers](#layers-4) names a layer the terrain does not declare.

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

## Interfaces

### ChunkGeometry

The vertex arrays of one chunk at one level of detail.

#### Properties

##### indices

> `readonly` **indices**: `Uint32Array`

Three indices per triangle.

##### normals

> `readonly` **normals**: `Float32Array`

Three floats per vertex.

##### positions

> `readonly` **positions**: `Float32Array`

Three floats per vertex, in the terrain's local frame.

##### uvs

> `readonly` **uvs**: `Float32Array`

Two floats per vertex: the terrain-wide `0..1` coordinate.

***

### ControlMaps

The control maps of a terrain, on the CPU.

#### Properties

##### maps

> `readonly` **maps**: readonly `Uint8Array`\<`ArrayBufferLike`\>[]

One RGBA8 image per four layers, `size * size * 4` bytes each.

##### size

> `readonly` **size**: `number`

Texels per side: `resolution - 1`.

***

### DecodedPng

A decoded PNG: samples in scanline order, one row after another, `channels` per pixel.

#### Properties

##### bitDepth

> `readonly` **bitDepth**: `8` \| `16`

Bits per sample. Indexed images decode to 8.

##### channels

> `readonly` **channels**: `1` \| `2` \| `3` \| `4`

Samples per pixel: 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA.

##### data

> `readonly` **data**: `Uint8Array`\<`ArrayBufferLike`\> \| `Uint16Array`\<`ArrayBufferLike`\>

`width * height * channels` samples; a `Uint16Array` for 16-bit images.

##### height

> `readonly` **height**: `number`

Height in pixels.

##### width

> `readonly` **width**: `number`

Width in pixels.

***

### FoliageMaterialInput

What [foliageMaterialDefinition](#foliagematerialdefinition) accepts.

#### Properties

##### albedo

> `readonly` **albedo**: `AssetHandle`\<`TextureAsset`\>

The albedo texture, with the alpha the cutoff tests.

##### alphaCutoff?

> `readonly` `optional` **alphaCutoff?**: `number`

The alpha below which a fragment is discarded. Defaults to `0.5`.

##### doubleSided?

> `readonly` `optional` **doubleSided?**: `boolean`

Whether both faces draw. Defaults to `true`, and is the only option: the shader declares
`cull none` and lights two-sided, because a grass card seen from behind is still grass.

##### instanced?

> `readonly` `optional` **instanced?**: `boolean`

Whether the material draws an `InstancedMeshRenderer`. Defaults to `true`, which is what a
`TerrainScatter` needs; a plain `MeshRenderer` needs `false`, because the instanced vertex
stage reads `world0..world3` and a mesh without thin instances has none.

##### name?

> `readonly` `optional` **name?**: `string`

A human-readable name. Defaults to `foliage`.

##### tint?

> `readonly` `optional` **tint?**: `ColorLike`

An sRGB tint multiplied with the albedo. Defaults to white.

##### wind?

> `readonly` `optional` **wind?**: \{ `frequency?`: `number`; `height?`: `number`; `strength?`: `number`; \} \| `null`

The wind. Omit it for `strength: 0.25, frequency: 1.2, height: 1`; `null` switches it off.

###### Union Members

###### Type Literal

\{ `frequency?`: `number`; `height?`: `number`; `strength?`: `number`; \}

###### frequency?

> `readonly` `optional` **frequency?**: `number`

Sway cycles per second.

###### height?

> `readonly` `optional` **height?**: `number`

The height above the mesh origin at which the lean reaches `strength`.

###### strength?

> `readonly` `optional` **strength?**: `number`

Metres of lean at `height`.

***

`null`

***

### FoliageShaderOptions

What [foliageShaderSource](#foliageshadersource) bakes into the file.

#### Properties

##### instanced?

> `readonly` `optional` **instanced?**: `boolean`

Whether the material draws thin instances — an `InstancedMeshRenderer` — and so composes
`world0..world3`. Defaults to `true`. A material for a plain `MeshRenderer` needs `false`.

***

### RgbaImage

An 8-bit RGBA image.

#### Properties

##### data

> `readonly` **data**: `Uint8Array`

`width * height * 4` bytes, row-major, top row first, straight alpha.

##### height

> `readonly` **height**: `number`

Height in pixels.

##### width

> `readonly` **width**: `number`

Width in pixels.

***

### ScatterPlacements

The per-instance arrays [generateScatter](#generatescatter) fills, in the terrain's local frame.

#### Properties

##### normals

> `readonly` **normals**: `Float32Array`

Three floats per instance: the surface normal there.

##### positions

> `readonly` **positions**: `Float32Array`

Three floats per instance.

##### scale

> `readonly` **scale**: `Float32Array`

One uniform scale per instance.

##### yaw

> `readonly` **yaw**: `Float32Array`

One angle per instance, in radians about Y.

***

### ScatterRules

What decides where a `TerrainScatter` puts its instances.

#### Properties

##### density

> `readonly` **density**: `number`

Instances per square metre of terrain.

##### heightMax

> `readonly` **heightMax**: `number`

The highest height that accepts a candidate, in metres.

##### heightMin

> `readonly` **heightMin**: `number`

The lowest height that accepts a candidate, in metres.

##### layers

> `readonly` **layers**: readonly `number`[]

Control-channel indices a candidate may stand on; empty places everywhere.

##### layerThreshold

> `readonly` **layerThreshold**: `number`

The splat weight a named layer must reach, `0` to `1`.

##### maxInstances

> `readonly` **maxInstances**: `number`

The most instances to place, whatever the density asks for.

##### randomYaw

> `readonly` **randomYaw**: `boolean`

Whether each instance is turned by a random angle about Y.

##### scaleMax

> `readonly` **scaleMax**: `number`

The largest random scale.

##### scaleMin

> `readonly` **scaleMin**: `number`

The smallest random scale.

##### seed

> `readonly` **seed**: `number`

The seed; the same seed always places the same instances.

##### slopeMax

> `readonly` **slopeMax**: `number`

The steepest slope that accepts a candidate, in degrees.

##### slopeMin

> `readonly` **slopeMin**: `number`

The shallowest slope that accepts a candidate, in degrees.

***

### TerrainAssetOptions

What [terrainAssetFromDefinition](#terrainassetfromdefinition) accepts.

#### Properties

##### address?

> `readonly` `optional` **address?**: `string`

The address to register under. Defaults to a generated `memory:` address.

##### heights?

> `readonly` `optional` **heights?**: `Float32Array`\<`ArrayBufferLike`\>

Heights in metres, row-major, `resolution * resolution` of them. Omit them to generate the
definition's noise.

***

### TerrainChunksDefinition

How the field is cut into chunks and how their levels of detail are chosen.

#### Properties

##### lodDistance

> `readonly` **lodDistance**: `number`

The camera distance, in metres, at which level 1 takes over; each level doubles it.

##### lodLevels

> `readonly` **lodLevels**: `number`

How many LOD meshes each chunk carries; level `n` skips `2^n` samples.

##### size

> `readonly` **size**: `number`

Quads per chunk side. `resolution - 1` must be a multiple of it.

##### skirtDepth

> `readonly` **skirtDepth**: `number`

How far, in metres, every LOD mesh's edges hang down to hide cracks between levels.

***

### TerrainColliderInit

What a `HeightfieldCollider` needs, by data: `@ignifx/terrain` never imports `@ignifx/physics`
(plan §5.4), so this is the shape rather than the type.

#### Properties

##### heights

> `readonly` **heights**: `number`[]

`samplesX * samplesZ` heights in metres, in the terrain's local frame. Rows run from the
largest Z to the smallest, which is the order Babylon Lite's heightfield reads.

##### samplesX

> `readonly` **samplesX**: `number`

Samples along X, at least 2.

##### samplesZ

> `readonly` **samplesZ**: `number`

Samples along Z, at least 2.

##### size

> `readonly` **size**: `Vec3Like`

The covered extent in metres; `y` is the terrain's full height range.

***

### TerrainDefinition

A fully resolved terrain: every field present, every address resolved, every rule checked.

#### Properties

##### chunks

> `readonly` **chunks**: [`TerrainChunksDefinition`](#terrainchunksdefinition)

How the field is chunked.

##### chunksPerSide

> `readonly` **chunksPerSide**: `number`

Chunks per side, derived: `(resolution - 1) / chunks.size`.

##### format

> `readonly` **format**: `"ignifx.terrain"`

Always [TERRAIN\_FORMAT](#terrain_format).

##### formatVersion

> `readonly` **formatVersion**: `1`

Always [TERRAIN\_FORMAT\_VERSION](#terrain_format_version).

##### heightmap

> `readonly` **heightmap**: [`TerrainHeightmapDefinition`](#terrainheightmapdefinition) \| `null`

The heightmap, or `null` when the heights come from noise.

##### layers

> `readonly` **layers**: readonly [`TerrainLayerDefinition`](#terrainlayerdefinition)[]

The layers, 1 to 8, in control-channel order.

##### material

> `readonly` **material**: [`TerrainMaterialDefinition`](#terrainmaterialdefinition)

The shared PBR factors.

##### name

> `readonly` **name**: `string`

A human-readable name; the document's basename when the file names none.

##### noise

> `readonly` **noise**: [`TerrainNoiseDefinition`](#terrainnoisedefinition) \| `null`

The noise, or `null` when the heights come from a heightmap.

##### resolution

> `readonly` **resolution**: `number`

Samples per side, `2^n + 1`.

##### size

> `readonly` **size**: [`TerrainSize`](#terrainsize-1)

The extent, in metres.

##### splat

> `readonly` **splat**: [`TerrainSplatDefinition`](#terrainsplatdefinition) \| `null`

The painted control maps, or `null` when the weights come from rules.

##### splatRules

> `readonly` **splatRules**: readonly [`TerrainSplatRule`](#terrainsplatrule)[]

The splat rules; empty when the weights come from painted maps.

***

### TerrainDefinitionInput

What `defineTerrain` accepts: the document with every defaulted field optional.

#### Properties

##### chunks?

> `readonly` `optional` **chunks?**: `Partial`\<[`TerrainChunksDefinition`](#terrainchunksdefinition)\>

How the field is chunked. Defaults to `64` quads, `4` levels, `96` metres, `2` metres of skirt.

##### format?

> `readonly` `optional` **format?**: `string`

Must be [TERRAIN\_FORMAT](#terrain_format) when present.

##### formatVersion?

> `readonly` `optional` **formatVersion?**: `number`

Must be [TERRAIN\_FORMAT\_VERSION](#terrain_format_version) when present.

##### heightmap?

> `readonly` `optional` **heightmap?**: `Partial`\<[`TerrainHeightmapDefinition`](#terrainheightmapdefinition)\> \| `null`

The heightmap; omit it for noise.

##### layers?

> `readonly` `optional` **layers?**: readonly [`TerrainLayerInput`](#terrainlayerinput)[]

The layers. Defaults to one flat grey layer named `ground`.

##### material?

> `readonly` `optional` **material?**: `Partial`\<[`TerrainMaterialDefinition`](#terrainmaterialdefinition)\>

The shared PBR factors. Defaults to roughness `0.9`, metallic `0`.

##### name?

> `readonly` `optional` **name?**: `string`

A human-readable name.

##### noise?

> `readonly` `optional` **noise?**: `Partial`\<[`TerrainNoiseDefinition`](#terrainnoisedefinition)\> \| `null`

The noise; used when there is no heightmap.

##### resolution?

> `readonly` `optional` **resolution?**: `number`

Samples per side. Defaults to `513`.

##### size?

> `readonly` `optional` **size?**: `Partial`\<[`TerrainSize`](#terrainsize-1)\>

The extent, in metres. Defaults to `512 x 512 x 80`.

##### splat?

> `readonly` `optional` **splat?**: \{ `control?`: readonly `string`[]; \} \| `null`

The painted control maps.

##### splatRules?

> `readonly` `optional` **splatRules?**: readonly [`TerrainSplatRuleInput`](#terrainsplatruleinput)[]

The splat rules.

***

### TerrainErrorOptions

Options accepted by [terrainError](#terrainerror): the same subset of `IgnifxErrorOptions` this package
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

### TerrainHeightmapDefinition

Where a terrain's heights come from when they come from a file.

#### Properties

##### source

> `readonly` **source**: `string`

The heightmap's address: a `.r16` (canonical) or a PNG, resolved relative to the document.

***

### TerrainHit

What [HeightField.raycast](#raycast) writes: the hit point, the surface normal there, and how far
along the ray it was. Build one with [createTerrainHit](#createterrainhit) and reuse it.

#### Properties

##### distance

> **distance**: `number`

The distance from the ray's origin to the hit, in metres.

##### normal

> `readonly` **normal**: `MutableVec3`

The unit surface normal at the hit.

##### point

> `readonly` **point**: `MutableVec3`

The hit point, in the frame the ray was stated in.

***

### TerrainLayerDefinition

One textured layer of the splat.

#### Properties

##### albedo

> `readonly` **albedo**: `string`

The albedo texture's address, resolved relative to the document; empty for a flat colour.

##### color

> `readonly` **color**: `ColorLike`

An sRGB tint multiplied with the albedo; the whole colour when there is no albedo texture.

##### name

> `readonly` **name**: `string`

The layer's name; what a splat rule and a `TerrainScatter` refer to.

##### normal

> `readonly` **normal**: `string` \| `null`

The tangent-space normal map's address, or `null` for none.

##### tiling

> `readonly` **tiling**: `number`

How many metres one repeat of the textures spans.

##### triplanar

> `readonly` **triplanar**: `boolean`

Whether the layer projects along all three axes, which hides stretching on cliffs.

***

### TerrainLayerImages

The decoded layer images of one terrain, all the same size.

#### Properties

##### albedo

> `readonly` **albedo**: readonly `Uint8Array`\<`ArrayBufferLike`\>[]

One RGBA8 image per layer, in layer order.

##### height

> `readonly` **height**: `number`

Every layer's height, in texels.

##### normals

> `readonly` **normals**: readonly (`Uint8Array`\<`ArrayBufferLike`\> \| `null`)[]

One RGBA8 normal map per layer, or `null` for a layer without one.

##### width

> `readonly` **width**: `number`

Every layer's width, in texels.

***

### TerrainLayerInput

What [TerrainLayerDefinition](#terrainlayerdefinition) accepts: every defaulted field optional.

#### Properties

##### albedo?

> `readonly` `optional` **albedo?**: `string`

The albedo texture's address.

##### color?

> `readonly` `optional` **color?**: `ColorLike` \| readonly `number`[]

An sRGB tint, as `{ r, g, b, a }` or `[r, g, b]`. Defaults to white.

##### name

> `readonly` **name**: `string`

The layer's name. Required.

##### normal?

> `readonly` `optional` **normal?**: `string` \| `null`

The normal map's address.

##### tiling?

> `readonly` `optional` **tiling?**: `number`

Metres per texture repeat. Defaults to `8`.

##### triplanar?

> `readonly` `optional` **triplanar?**: `boolean`

Whether the layer is projected triplanar. Defaults to `false`.

***

### TerrainLayerTextures

The texture assets a terrain material samples its layers through.

#### Properties

##### albedo

> `readonly` **albedo**: `AssetHandle`\<`TextureAsset`\> \| `null`

The albedo array, one slice per layer; `null` for a terrain with no layer images.

##### hasNormal

> `readonly` **hasNormal**: readonly `boolean`[]

Which layers carry a normal map, in layer order.

##### normals

> `readonly` **normals**: `AssetHandle`\<`TextureAsset`\> \| `null`

The normal array, or `null` when no layer carries a normal map.

***

### TerrainMaterialDefinition

The PBR factors the whole terrain shares. Per-layer roughness is not possible: Babylon Lite's PBR
template declares `roughness` as a `let`, so a material plugin cannot drive it.

#### Properties

##### metallic

> `readonly` **metallic**: `number`

Metallic factor, 0 to 1.

##### roughness

> `readonly` **roughness**: `number`

Roughness factor, 0 to 1.

***

### TerrainNoiseDefinition

The seeded fractal noise a terrain without a heightmap is built from.

#### Properties

##### frequency

> `readonly` **frequency**: `number`

The first octave's frequency, in cycles per metre.

##### lacunarity

> `readonly` **lacunarity**: `number`

How much the frequency grows per octave.

##### octaves

> `readonly` **octaves**: `number`

How many octaves are summed.

##### persistence

> `readonly` **persistence**: `number`

How much the amplitude shrinks per octave.

##### ridged

> `readonly` **ridged**: `boolean`

Ridged multifractal (sharp crests) rather than plain fBm.

##### seed

> `readonly` **seed**: `number`

The seed; the same seed always produces the same field.

##### terraces

> `readonly` **terraces**: `number`

How many flat steps the height is quantised into; `0` leaves it smooth.

***

### TerrainRegion

A rectangle of samples: the region a sculpt edits, a collider covers, or a chunk rebuild touches.

#### Properties

##### depth

> `readonly` **depth**: `number`

How many rows.

##### width

> `readonly` **width**: `number`

How many columns.

##### x

> `readonly` **x**: `number`

The first sample column.

##### z

> `readonly` **z**: `number`

The first sample row.

***

### TerrainSize

The terrain's extent, in metres. `height` is the full range the heightmap's `0..65535` maps onto.

#### Properties

##### depth

> `readonly` **depth**: `number`

Extent along Z.

##### height

> `readonly` **height**: `number`

The height a full-scale sample reaches; the field spans `0..height`.

##### width

> `readonly` **width**: `number`

Extent along X.

***

### TerrainSplatDefinition

A painted control map set: one RGBA image per four layers, one channel per layer.

#### Properties

##### control

> `readonly` **control**: readonly `string`[]

The control map addresses, resolved relative to the document; the second covers layers 5–8.

***

### TerrainSplatLayerSpec

One layer's compile-time shape.

#### Properties

##### color

> `readonly` **color**: `ColorLike`

The layer's sRGB tint.

##### hasNormal

> `readonly` **hasNormal**: `boolean`

Whether the layer's slice of the normal array holds a normal map.

##### tiling

> `readonly` **tiling**: `number`

Metres per texture repeat.

##### triplanar

> `readonly` **triplanar**: `boolean`

Whether the layer projects along all three axes.

***

### TerrainSplatRule

One rule of a generated splat: where a layer appears, by height and slope band.

#### Properties

##### height

> `readonly` **height**: readonly \[`number`, `number`\] \| `null`

The height band, in metres, or `null` for every height.

##### layer

> `readonly` **layer**: `string`

The layer the rule paints.

##### slope

> `readonly` **slope**: readonly \[`number`, `number`\] \| `null`

The slope band, in degrees from horizontal, or `null` for every slope.

***

### TerrainSplatRuleInput

What a splat rule accepts.

#### Properties

##### height?

> `readonly` `optional` **height?**: readonly `number`[]

The height band, in metres.

##### layer

> `readonly` **layer**: `string`

The layer the rule paints. Required.

##### slope?

> `readonly` `optional` **slope?**: readonly `number`[]

The slope band, in degrees.

***

### TerrainSplatShaderSpec

What decides the generated file's shape.

#### Properties

##### layers

> `readonly` **layers**: readonly [`TerrainSplatLayerSpec`](#terrainsplatlayerspec)[]

The layers, in control-channel order, 1 to 8.

##### normals

> `readonly` **normals**: `boolean`

Whether a normal texture array is bound.

##### textured

> `readonly` **textured**: `boolean`

Whether an albedo texture array is bound; without one the layers blend their tints alone.

## Type Aliases

### LiteChunkMesh

> **LiteChunkMesh** = `Mesh`

The Babylon Lite mesh a terrain chunk is, under an ignifx name.

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### LiteChunkNode

> **LiteChunkNode** = `SceneNode`

The Babylon Lite node a terrain's chunks are parented under, under an ignifx name.

#### Remarks

Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.

***

### TerrainErrorCode

> **TerrainErrorCode** = *typeof* [`TerrainErrorCode`](#terrainerrorcode)\[keyof *typeof* [`TerrainErrorCode`](#terrainerrorcode)\]

The union of the codes the `TerrainErrorCode` table declares.

## Variables

### FOLIAGE\_SHADER\_NAME

> `const` **FOLIAGE\_SHADER\_NAME**: `"foliage"` = `"foliage"`

The name of the generated foliage shader; the material and the diagnostics carry it.

***

### HEIGHTMAP\_ASSET\_TYPE

> `const` **HEIGHTMAP\_ASSET\_TYPE**: `"heightmap"` = `"heightmap"`

The asset type a raw heightmap is registered under; the Vite plugin maps `.r16` to it.

***

### HEIGHTMAP\_FILE\_EXTENSIONS

> `const` **HEIGHTMAP\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the heightmap loader.

***

### LAYERS\_PER\_CONTROL\_MAP

> `const` **LAYERS\_PER\_CONTROL\_MAP**: `4` = `4`

How many layers one RGBA map carries.

***

### LOD\_HYSTERESIS

> `const` **LOD\_HYSTERESIS**: `0.1` = `0.1`

How far past a threshold, as a fraction, a chunk waits before switching level.

***

### MAX\_TERRAIN\_LAYERS

> `const` **MAX\_TERRAIN\_LAYERS**: `8` = `8`

The most layers one terrain may declare: two RGBA control maps, four channels each.

***

### R16\_FILE\_EXTENSION

> `const` **R16\_FILE\_EXTENSION**: `".r16"` = `".r16"`

The address suffix of the canonical raw heightmap: little-endian `uint16`, row-major,
`resolution * resolution` samples, `0..65535` mapped onto `0..size.height`.

***

### terrain

> `const` **terrain**: () => `Extension`

The `@ignifx/terrain` extension factory.

#### Returns

`Extension`

The extension descriptor to pass to `createApp`.

#### Example

```ts
const app = await createApp({ canvas, extensions: [terrain()] });
```

***

### TERRAIN\_ASSET\_TYPE

> `const` **TERRAIN\_ASSET\_TYPE**: `"terrain"` = `"terrain"`

The asset type terrains are registered under.

***

### TERRAIN\_DIAGNOSTICS\_COUNTERS

> `const` **TERRAIN\_DIAGNOSTICS\_COUNTERS**: readonly `string`[]

The counters the terrain group publishes, in index order.

***

### TERRAIN\_DIAGNOSTICS\_GROUP

> `const` **TERRAIN\_DIAGNOSTICS\_GROUP**: `"terrain"` = `"terrain"`

The diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).

***

### TERRAIN\_ERROR\_MESSAGES

> `const` **TERRAIN\_ERROR\_MESSAGES**: `Readonly`\<`Record`\<`string`, `string`\>\>

The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
Context keys appear in braces, matching the core table's convention.

***

### TERRAIN\_FILE\_EXTENSIONS

> `const` **TERRAIN\_FILE\_EXTENSIONS**: readonly `string`[]

The address suffixes that select the terrain loader.

***

### TERRAIN\_FORMAT

> `const` **TERRAIN\_FORMAT**: `"ignifx.terrain"` = `"ignifx.terrain"`

The `format` header every `.terrain.json` carries.

***

### TERRAIN\_FORMAT\_VERSION

> `const` **TERRAIN\_FORMAT\_VERSION**: `1` = `1`

The only `formatVersion` this build reads.

***

### TERRAIN\_LOD\_ORDER

> `const` **TERRAIN\_LOD\_ORDER**: `10` = `10`

The `PreRender` order the terrain LOD system runs at.

#### Remarks

`10` puts it **after** core's render sync at `0`, because `Camera.getViewMatrix` reads the
Babylon Lite camera and that is what the sync writes; running earlier would cull against last
frame's view. Chunk meshes are not components, so nothing downstream needs them decided sooner.

***

### TERRAIN\_SPLAT\_NAME

> `const` **TERRAIN\_SPLAT\_NAME**: `"terrainSplat"` = `"terrainSplat"`

The name the terrain's splat shader answers to on its material.

***

### TerrainErrorCode

> `const` **TerrainErrorCode**: `object`

Every diagnostic code `@ignifx/terrain` can throw or log, keyed by an intention-revealing name so
call sites read as prose and the compiler catches typos (coding standards §5.2).

#### Type Declaration

##### eightBitHeightmap

> `readonly` **eightBitHeightmap**: `"IGX-1603"` = `"IGX-1603"`

An 8-bit heightmap was loaded; it terraces. Logged once, never thrown.

##### heightmapSizeMismatch

> `readonly` **heightmapSizeMismatch**: `"IGX-1608"` = `"IGX-1608"`

A heightmap or a control map decoded to a sample count that does not match the declaration.

##### invalidResolution

> `readonly` **invalidResolution**: `"IGX-1602"` = `"IGX-1602"`

`resolution` is not `2^n + 1`, or does not equal `chunks.size * chunksPerSide + 1`.

##### invalidTerrainFile

> `readonly` **invalidTerrainFile**: `"IGX-1601"` = `"IGX-1601"`

A `.terrain.json` document, or a `defineTerrain` input, is not one this build can read.

##### layerSizeMismatch

> `readonly` **layerSizeMismatch**: `"IGX-1607"` = `"IGX-1607"`

The layer textures of a terrain are not all the same size; a texture array needs equal layers.

##### regionOutOfRange

> `readonly` **regionOutOfRange**: `"IGX-1610"` = `"IGX-1610"`

A region handed to `setHeights`, `setSplat`, or `colliderInit` falls outside the field.

##### rotationUnsupported

> `readonly` **rotationUnsupported**: `"IGX-1604"` = `"IGX-1604"`

The terrain entity is rotated about Y, which the world-space queries do not honour. Logged once.

##### scatterNeedsTerrain

> `readonly` **scatterNeedsTerrain**: `"IGX-1612"` = `"IGX-1612"`

A `TerrainScatter` found no `Terrain` on its entity or any ancestor.

##### terrainNotLoaded

> `readonly` **terrainNotLoaded**: `"IGX-1609"` = `"IGX-1609"`

A query ran on a `Terrain` whose asset has not been delivered yet.

##### tooManyLayers

> `readonly` **tooManyLayers**: `"IGX-1605"` = `"IGX-1605"`

A terrain declares no layer, or more than [MAX\_TERRAIN\_LAYERS](#max_terrain_layers) of them.

##### unknownLayer

> `readonly` **unknownLayer**: `"IGX-1611"` = `"IGX-1611"`

A splat rule or a scatter names a layer the terrain does not declare.

##### unsupportedImage

> `readonly` **unsupportedImage**: `"IGX-1606"` = `"IGX-1606"`

An image uses a PNG feature the built-in decoder does not read, or is not a PNG at all.

#### Example

```ts
throw terrainError(TerrainErrorCode.invalidTerrainFile, "island.terrain.json names no layers.", {
  context: { file: "island.terrain.json" },
});
```

***

### VERSION

> `const` **VERSION**: `"0.2.1"` = `"0.2.1"`

The `@ignifx/terrain` version this build was cut from.

## Functions

### buildChunkGeometry()

> **buildChunkGeometry**(`field`, `chunkX`, `chunkZ`, `lod`, `chunkSize`, `skirtDepth`): [`ChunkGeometry`](#chunkgeometry)

Builds one chunk's mesh at one level of detail.

#### Parameters

##### field

[`HeightField`](#heightfield)

The height field, in the terrain's local frame.

##### chunkX

`number`

The chunk column.

##### chunkZ

`number`

The chunk row.

##### lod

`number`

The level of detail.

##### chunkSize

`number`

Quads per chunk side.

##### skirtDepth

`number`

How far the skirts hang down, in metres.

#### Returns

[`ChunkGeometry`](#chunkgeometry)

Fresh arrays.

#### Example

```ts
const lod0 = buildChunkGeometry(field, 0, 0, 0, 64, 2);
lod0.positions.length / 3; // 65 * 65 + 4 * 65
```

***

### chunkBounds()

> **chunkBounds**(`field`, `chunkX`, `chunkZ`, `chunkSize`, `skirtDepth`, `out`): `Float32Array`

A chunk's axis-aligned bounds in the terrain's local frame, skirts included.

#### Parameters

##### field

[`HeightField`](#heightfield)

The height field.

##### chunkX

`number`

The chunk column.

##### chunkZ

`number`

The chunk row.

##### chunkSize

`number`

Quads per chunk side.

##### skirtDepth

`number`

How far the skirts hang down.

##### out

`Float32Array`

Receives `[minX, minY, minZ, maxX, maxY, maxZ]`.

#### Returns

`Float32Array`

`out`, for chaining.

***

### chunkGridSide()

> **chunkGridSide**(`chunkSize`, `lod`): `number`

Vertices per side of a chunk's mesh at a level of detail.

#### Parameters

##### chunkSize

`number`

Quads per chunk side.

##### lod

`number`

The level; level `n` skips `2^n` samples.

#### Returns

`number`

The vertex count per side.

***

### chunkIndexCount()

> **chunkIndexCount**(`chunkSize`, `lod`): `number`

How many indices a chunk's mesh has at a level of detail, skirts included.

#### Parameters

##### chunkSize

`number`

Quads per chunk side.

##### lod

`number`

The level.

#### Returns

`number`

The index count, three per triangle.

***

### chunkVertexCount()

> **chunkVertexCount**(`chunkSize`, `lod`): `number`

How many vertices a chunk's mesh has at a level of detail, skirts included.

#### Parameters

##### chunkSize

`number`

Quads per chunk side.

##### lod

`number`

The level.

#### Returns

`number`

The vertex count.

***

### controlMapCount()

> **controlMapCount**(`layerCount`): `number`

How many control maps a layer count needs.

#### Parameters

##### layerCount

`number`

The terrain's layer count.

#### Returns

`number`

One per four layers.

***

### createFoliageMaterial()

> **createFoliageMaterial**(`app`, `input`): `Promise`\<`AssetHandle`\<`MaterialAsset`\>\>

Loads the foliage shader and builds the material in one call.

#### Parameters

##### app

`App`

The app.

##### input

[`FoliageMaterialInput`](#foliagematerialinput)

The albedo, the wind, the cutoff, and the tint.

#### Returns

`Promise`\<`AssetHandle`\<`MaterialAsset`\>\>

The material handle, with one holder — the caller.

#### Remarks

The shader goes through the ordinary `.wgsl` loader — from a `data:` address, with the type given
because the address has no suffix — which is also what loads Babylon Lite's custom-WGSL adapter
the first time. Before `app.start()` the load settles at once; afterwards it settles in the next
frame's `PreUpdate`, so call this from setup code rather than a lifecycle callback.

#### Example

```ts
const grass = await createFoliageMaterial(app, { albedo: grassCard, wind: { strength: 0.3 } });
scatter.material = grass;
```

***

### createHeightmapLoader()

> **createHeightmapLoader**(): `AssetLoader`\<`ArrayBuffer`\>

The loader for raw heightmaps: it fetches the bytes and decodes nothing, because only the
`.terrain.json` that names the file knows its resolution.

#### Returns

`AssetLoader`\<`ArrayBuffer`\>

The loader, for `ExtensionContext.registerAssetLoader`.

***

### createLayerTextures()

> **createLayerTextures**(`app`, `name`, `images`): [`TerrainLayerTextures`](#terrainlayertextures)

Builds the albedo and normal texture arrays of a terrain and publishes them as texture assets.

#### Parameters

##### app

`App`

The app whose engine uploads and whose asset service publishes.

##### name

`string`

The terrain's address, which prefixes the texture addresses.

##### images

[`TerrainLayerImages`](#terrainlayerimages) \| `null`

The packed layer images, or `null` for a textureless terrain.

#### Returns

[`TerrainLayerTextures`](#terrainlayertextures)

The texture handles.

#### Remarks

Headless both handles wrap `null` GPU textures and nothing is uploaded; the assets still report
their size. Each handle has one holder — the `TerrainAsset`, which releases it when it unloads.

***

### createScatterPlacements()

> **createScatterPlacements**(`capacity`): [`ScatterPlacements`](#scatterplacements)

Allocates placement arrays for a capacity.

#### Parameters

##### capacity

`number`

The most instances they will hold.

#### Returns

[`ScatterPlacements`](#scatterplacements)

Fresh arrays. **Allocates** — build them once per capacity, not per frame.

***

### createTerrainHit()

> **createTerrainHit**(): [`TerrainHit`](#terrainhit)

Creates a reusable [TerrainHit](#terrainhit).

#### Returns

[`TerrainHit`](#terrainhit)

A fresh hit record. **Allocates** — make one per call site, not per frame.

***

### createTerrainLoader()

> **createTerrainLoader**(): `AssetLoader`\<[`TerrainAsset`](#terrainasset-1)\>

The loader for `.terrain.json` documents.

#### Returns

`AssetLoader`\<[`TerrainAsset`](#terrainasset-1)\>

The loader, for `ExtensionContext.registerAssetLoader`.

#### Example

```ts
const island = await app.assets.loadAsync<TerrainAsset>("terrain/island.terrain.json");
```

***

### decodePng()

> **decodePng**(`bytes`, `file?`): `Promise`\<[`DecodedPng`](#decodedpng)\>

Decodes a PNG.

#### Parameters

##### bytes

`Uint8Array`

The file's bytes.

##### file?

`string` = `"<memory>"`

The file's address, for messages.

#### Returns

`Promise`\<[`DecodedPng`](#decodedpng)\>

The decoded image.

#### Throws

IgnifxError with code `IGX-1606` when the bytes are not a PNG this decoder reads.

#### Example

```ts
const png = await decodePng(new Uint8Array(await ctx.fetchBytes()), ctx.address);
png.bitDepth; // 16 for a heightmap that will not terrace
```

***

### decodeR16()

> **decodeR16**(`buffer`, `resolution`, `file?`): `Uint16Array`

Decodes a `.r16` buffer into samples.

#### Parameters

##### buffer

`ArrayBuffer`

The file's bytes.

##### resolution

`number`

The samples per side the terrain declares, checked against the byte count.

##### file?

`string` = `"<memory>"`

The file's address, for the message.

#### Returns

`Uint16Array`

`resolution * resolution` samples, row-major.

#### Throws

IgnifxError with code `IGX-1608` when the byte count does not match.

#### Example

```ts
const samples = decodeR16(await ctx.fetchBytes(), 513, "terrain/island.r16");
```

***

### decodeRgbaImage()

> **decodeRgbaImage**(`bytes`, `file?`): `Promise`\<[`RgbaImage`](#rgbaimage)\>

Decodes an image file to RGBA8.

#### Parameters

##### bytes

`ArrayBuffer`

The file's bytes.

##### file?

`string` = `"<memory>"`

The file's address, for messages.

#### Returns

`Promise`\<[`RgbaImage`](#rgbaimage)\>

The decoded image.

#### Throws

IgnifxError with code `IGX-1606` when neither the built-in PNG decoder nor the browser can
read the bytes.

***

### defineTerrain()

> **defineTerrain**(`input`, `address?`): [`TerrainDefinition`](#terraindefinition-1)

Validates a terrain document and fills in its defaults.

#### Parameters

##### input

[`TerrainDefinitionInput`](#terraindefinitioninput)

The document, with every defaulted field optional.

##### address?

`string` = `"<inline>"`

The document's address, for messages and for resolving the addresses it names.
Defaults to `<inline>`, which resolves references against the asset root.

#### Returns

[`TerrainDefinition`](#terraindefinition-1)

The resolved definition.

#### Throws

IgnifxError with code `IGX-1601` for a malformed document, `IGX-1602` for a resolution
that does not fit `2^n + 1` or the chunking, `IGX-1605` for a layer count outside 1–8, or
`IGX-1611` for a rule naming an unknown layer.

#### Example

```ts
const island = defineTerrain({
  size: { width: 256, depth: 256, height: 40 },
  resolution: 257,
  noise: { seed: 7, octaves: 5 },
  chunks: { size: 64, lodLevels: 3 },
  layers: [{ name: "grass" }, { name: "rock", triplanar: true }],
  splatRules: [{ layer: "grass" }, { layer: "rock", slope: [35, 90] }],
});
```

***

### describeSchemas()

> **describeSchemas**(): `Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

Describes every component this package registers, plus the file format.

#### Returns

`Readonly`\<`Record`\<`string`, `SchemaDescription`\>\>

The record `pnpm docs:schemas` renders, keyed by schema id.

***

### describeTerrainFormat()

> **describeTerrainFormat**(): `SchemaDescription`

Describes the `ignifx.terrain` file format.

#### Returns

`SchemaDescription`

The record `pnpm docs:schemas` renders.

***

### distanceToBox()

> **distanceToBox**(`x`, `y`, `z`, `bounds`, `offset?`): `number`

The distance from a point to the nearest point of an axis-aligned box; zero inside it.

#### Parameters

##### x

`number`

The point's X.

##### y

`number`

The point's Y.

##### z

`number`

The point's Z.

##### bounds

`ArrayLike`\<`number`\>

`[minX, minY, minZ, maxX, maxY, maxZ]`, read from `offset`.

##### offset?

`number` = `0`

Where the six values start.

#### Returns

`number`

The distance, in the box's units.

***

### encodeR16()

> **encodeR16**(`samples`): `ArrayBuffer`

Encodes samples as a `.r16` buffer.

#### Parameters

##### samples

`Uint16Array`

The samples, row-major.

#### Returns

`ArrayBuffer`

The bytes, little-endian.

***

### foliageMaterialDefinition()

> **foliageMaterialDefinition**(`input`): `ShaderMaterialDefinition`

Builds a foliage material declaration: the foliage shader plus the wind, cutoff, and tint values.

#### Parameters

##### input

[`FoliageMaterialInput`](#foliagematerialinput)

The albedo, the wind, the cutoff, and the tint.

#### Returns

`ShaderMaterialDefinition`

A `"shader"` material declaration.

#### Remarks

Pure data, like every other `*Definition` helper; the shader it names has to be **loaded**
before `createMaterialAsset` accepts the declaration, which is what
[createFoliageMaterial](#createfoliagematerial) does in one call. The wind's `strength`, `frequency`, and `height`
become the `windStrength`, `windFrequency`, and `windHeight` uniforms, so a game can change them
on the material at runtime with `setUniform`.

#### Example

```ts
const definition = foliageMaterialDefinition({ albedo: grassCard, wind: { strength: 0.3 } });
```

***

### foliageShaderAddress()

> **foliageShaderAddress**(`instanced?`): `string`

The address the foliage shader for a variant is loaded from: a `data:` URL of its source.

#### Parameters

##### instanced?

`boolean` = `true`

Which variant.

#### Returns

`string`

The address.

***

### foliageShaderSource()

> **foliageShaderSource**(`options?`): `string`

Generates the foliage `.wgsl`.

#### Parameters

##### options?

[`FoliageShaderOptions`](#foliageshaderoptions) = `{}`

Whether the shader is instanced.

#### Returns

`string`

The `.wgsl` source.

#### Remarks

The declared uniforms are what [foliageMaterialDefinition](#foliagematerialdefinition) sets and what
`material.value.setUniform` can change at runtime: `windStrength` (metres of lean at
`windHeight`), `windFrequency` (cycles per second), `windHeight` (metres), `tint` (sRGB), and
`cutoff` (the alpha below which a fragment is discarded). The one sampler is `albedo`.

#### Example

```ts
const source = foliageShaderSource({ instanced: false });
```

***

### generateControlMaps()

> **generateControlMaps**(`field`, `layers`, `rules`): [`ControlMaps`](#controlmaps)

Generates control maps from splat rules.

#### Parameters

##### field

[`HeightField`](#heightfield)

The height field the rules read heights and slopes from.

##### layers

readonly [`TerrainLayerDefinition`](#terrainlayerdefinition)[]

The terrain's layers, in channel order.

##### rules

readonly [`TerrainSplatRule`](#terrainsplatrule)[]

The rules; each names a declared layer.

#### Returns

[`ControlMaps`](#controlmaps)

The maps, `resolution - 1` texels per side.

#### Example

```ts
const maps = generateControlMaps(field, layers, [
  { layer: "grass", height: null, slope: null },
  { layer: "rock", height: null, slope: [35, 90] },
]);
```

***

### generateNoiseField()

> **generateNoiseField**(`resolution`, `widthMetres`, `depthMetres`, `noise`, `out?`): `Float32Array`

Fills a normalised height field from noise.

#### Parameters

##### resolution

`number`

Samples per side.

##### widthMetres

`number`

The field's extent along X, in metres, so `frequency` is in cycles per metre.

##### depthMetres

`number`

The field's extent along Z, in metres.

##### noise

[`TerrainNoiseDefinition`](#terrainnoisedefinition)

The noise parameters.

##### out?

`Float32Array`\<`ArrayBufferLike`\>

`resolution * resolution` floats to fill, or omitted for a fresh array.

#### Returns

`Float32Array`

The field, normalised to `0..1`.

#### Example

```ts
const values = generateNoiseField(129, 128, 128, { seed: 7, octaves: 5, frequency: 0.02, lacunarity: 2, persistence: 0.5, ridged: false, terraces: 0 });
```

***

### generateScatter()

> **generateScatter**(`field`, `control`, `rules`, `out`): `number`

Places instances on a terrain and reports how many passed every rule.

#### Parameters

##### field

[`HeightField`](#heightfield)

The height field, read in its local frame.

##### control

[`ControlMaps`](#controlmaps)

The splat weights, for the layer rule.

##### rules

[`ScatterRules`](#scatterrules)

What accepts a candidate and how it is turned and scaled.

##### out

[`ScatterPlacements`](#scatterplacements)

Receives the placements; its length caps the result.

#### Returns

`number`

How many instances were written.

#### Example

```ts
const placements = createScatterPlacements(scatterCapacity(field, 0.5, 50_000));
const count = generateScatter(field, control, rules, placements);
```

***

### hashFloats()

> **hashFloats**(`values`): `number`

A stable 32-bit hash of a float array, for determinism tests and replays.

#### Parameters

##### values

`Float32Array`

The array.

#### Returns

`number`

An unsigned 32-bit hash.

#### Remarks

Hashes the IEEE bit pattern of every element, so two arrays hash alike exactly when they are
bit-identical.

***

### isPng()

> **isPng**(`bytes`): `boolean`

Whether a byte buffer starts with the PNG signature.

#### Parameters

##### bytes

`Uint8Array`

The file's bytes.

#### Returns

`boolean`

`true` for a PNG.

***

### loadGeneratedShader()

> **loadGeneratedShader**(`app`, `source`): `Promise`\<`AssetHandle`\<`ShaderAsset`\>\>

Loads generated WGSL as a `ShaderAsset`.

#### Parameters

##### app

`App`

The app whose asset service loads it.

##### source

`string`

The `.wgsl` or `.surface.wgsl` text.

#### Returns

`Promise`\<`AssetHandle`\<`ShaderAsset`\>\>

The handle, with one holder — the caller.

#### Remarks

The type has to be given: a `data:` address has no `.wgsl` suffix to infer it from. Before
`app.start()` the load settles as soon as it finishes; afterwards it settles in the next frame's
`PreUpdate`, so call this from setup code rather than a lifecycle callback.

#### Throws

IgnifxError with code `IGX-0719` when the source's pragmas cannot be read.

#### Example

```ts
const shader = await loadGeneratedShader(app, terrainSplatShaderSource(spec));
```

***

### lodThreshold()

> **lodThreshold**(`level`, `lodDistance`, `lodBias`): `number`

The camera distance at which a level takes over.

#### Parameters

##### level

`number`

The level, at least 1.

##### lodDistance

`number`

The terrain's `chunks.lodDistance`, in metres.

##### lodBias

`number`

The `Terrain.lodBias` multiplier.

#### Returns

`number`

The threshold, in metres.

***

### packLayerImages()

> **packLayerImages**(`albedo`, `normals`, `file`): [`TerrainLayerImages`](#terrainlayerimages) \| `null`

Checks that every decoded layer image shares one size and packs them into layer order.

#### Parameters

##### albedo

readonly ([`RgbaImage`](#rgbaimage) \| `null`)[]

One albedo image per layer; `null` entries become opaque white.

##### normals

readonly ([`RgbaImage`](#rgbaimage) \| `null`)[]

One normal map per layer, or `null` for a layer without one.

##### file

`string`

The terrain's address, for messages.

#### Returns

[`TerrainLayerImages`](#terrainlayerimages) \| `null`

The packed images, or `null` when no layer supplied an image at all.

#### Throws

IgnifxError with code `IGX-1607` when two images differ in size.

***

### pngToRgba8()

> **pngToRgba8**(`png`): `Uint8Array`

Converts a decoded PNG into tightly packed RGBA8, the layout `TextureAsset.fromPixels` takes.

#### Parameters

##### png

[`DecodedPng`](#decodedpng)

The decoded image.

#### Returns

`Uint8Array`

`width * height * 4` bytes, row-major, top row first, straight alpha.

***

### pngToSamples16()

> **pngToSamples16**(`png`): `Uint16Array`

Converts a decoded PNG into 16-bit height samples: greyscale as is, colour by luminance, 8-bit
scaled by 257 so full white stays full height.

#### Parameters

##### png

[`DecodedPng`](#decodedpng)

The decoded image.

#### Returns

`Uint16Array`

`width * height` samples, row-major.

***

### resolveTerrainAddress()

> **resolveTerrainAddress**(`base`, `reference`): `string`

Resolves a document-relative reference against the document's own address.

#### Parameters

##### base

`string`

The address of the document holding the reference.

##### reference

`string`

What the document wrote.

#### Returns

`string`

The resolved address.

#### Remarks

A reference that is absolute — a recognised URL scheme, or one starting with `/` — is returned
untouched. `.` and `..` segments are collapsed, and a base with no `/` is a file in the root.

#### Example

```ts
resolveTerrainAddress("levels/island.terrain.json", "island.r16"); // "levels/island.r16"
resolveTerrainAddress("levels/island.terrain.json", "../shared/grass.png"); // "shared/grass.png"
```

***

### sampleControlWeight()

> **sampleControlWeight**(`control`, `layer`, `u`, `v`): `number`

The weight of a layer at a point, bilinearly filtered from its control map, in `0..1`.

#### Parameters

##### control

[`ControlMaps`](#controlmaps)

The control maps.

##### layer

`number`

The layer index.

##### u

`number`

The terrain-wide coordinate along X, `0..1`.

##### v

`number`

The terrain-wide coordinate along Z, `0..1`.

#### Returns

`number`

The weight.

***

### scatterCapacity()

> **scatterCapacity**(`field`, `density`, `maxInstances`): `number`

How many instances a density asks for over a field, before any rule rejects one.

#### Parameters

##### field

[`HeightField`](#heightfield)

The height field, which fixes the area.

##### density

`number`

Instances per square metre.

##### maxInstances

`number`

The cap.

#### Returns

`number`

The candidate count.

***

### selectLod()

> **selectLod**(`distance`, `lodDistance`, `lodBias`, `levels`, `current`): `number`

Picks a chunk's level for a camera distance, with hysteresis around the level it shows now.

#### Parameters

##### distance

`number`

The camera's distance from the chunk, in metres.

##### lodDistance

`number`

The terrain's `chunks.lodDistance`.

##### lodBias

`number`

The `Terrain.lodBias` multiplier.

##### levels

`number`

How many levels the chunk has.

##### current

`number`

The level currently showing.

#### Returns

`number`

The level to show.

#### Example

```ts
selectLod(150, 96, 1, 4, 0); // 1: past 96 m, level 1 takes over
selectLod(100, 96, 1, 4, 1); // 1: 100 m is inside the 10 % band, so level 1 stays
```

***

### shaderSourceAddress()

> **shaderSourceAddress**(`source`): `string`

A `data:` address that fetches to a WGSL source, so the ordinary shader loader can load it.

#### Parameters

##### source

`string`

The `.wgsl` text.

#### Returns

`string`

The address.

***

### solidControlMaps()

> **solidControlMaps**(`size`, `layerCount`): [`ControlMaps`](#controlmaps)

Control maps that paint the first layer everywhere: the fallback for a terrain with neither
painted maps nor rules.

#### Parameters

##### size

`number`

Texels per side.

##### layerCount

`number`

The terrain's layer count.

#### Returns

[`ControlMaps`](#controlmaps)

The maps.

***

### terrainAssetFromDefinition()

> **terrainAssetFromDefinition**(`app`, `input`, `options?`): `Promise`\<`AssetHandle`\<[`TerrainAsset`](#terrainasset-1)\>\>

Builds a terrain asset from a definition written in code, without loading a file.

#### Parameters

##### app

`App`

The app whose asset service publishes the result.

##### input

[`TerrainDefinitionInput`](#terraindefinitioninput)

The document, with every defaulted field optional.

##### options?

[`TerrainAssetOptions`](#terrainassetoptions)

The address and an explicit height array.

#### Returns

`Promise`\<`AssetHandle`\<[`TerrainAsset`](#terrainasset-1)\>\>

The handle, with one holder — the caller.

#### Remarks

The terrain blends its layer **tints**: a texture array is assembled from decoded images, which
only the `.terrain.json` loader has. Give the definition `noise`, or pass `heights`, for the
shape; a definition that names a `heightmap` file is refused, because nothing here can fetch it.

#### Throws

IgnifxError with code `IGX-1601` when the definition names a heightmap file, `IGX-1602`
for a resolution that does not fit the chunking, or `IGX-1608` when `heights` is the wrong length.

#### Example

```ts
const island = await terrainAssetFromDefinition(app, {
  size: { width: 256, depth: 256, height: 30 },
  resolution: 257,
  noise: { seed: 7, octaves: 5 },
  layers: [{ name: "grass" }, { name: "rock", triplanar: true }],
  splatRules: [{ layer: "grass" }, { layer: "rock", slope: [35, 90] }],
});
```

***

### terrainError()

> **terrainError**(`code`, `message`, `options?`): `IgnifxError`

Builds an `IgnifxError` carrying one of this package's codes.

#### Parameters

##### code

[`TerrainErrorCode`](#terrainerrorcode-1)

The code from the `TerrainErrorCode` table.

##### message

`string`

The actionable development sentence.

##### options?

[`TerrainErrorOptions`](#terrainerroroptions)

Context identifiers, a remedy hint, and the wrapped cause.

#### Returns

`IgnifxError`

The error to throw or to reject with.

#### Example

```ts
throw terrainError(TerrainErrorCode.unknownLayer, "island.terrain.json names no layer moss.", {
  context: { file: "island.terrain.json", layer: "moss" },
});
```

***

### terrainFileSchema()

> **terrainFileSchema**(): `Schema`

The `ignifx.terrain` document schema.

#### Returns

`Schema`

The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).

***

### terrainSplatShaderSource()

> **terrainSplatShaderSource**(`spec`): `string`

Generates the `terrainSplat` surface shader for a terrain's shape.

#### Parameters

##### spec

[`TerrainSplatShaderSpec`](#terrainsplatshaderspec)

The layers and which arrays are bound.

#### Returns

`string`

The `.surface.wgsl` source.

#### Example

```ts
const source = terrainSplatShaderSource({
  layers: [
    { triplanar: false, hasNormal: false, color: { r: 0.3, g: 0.6, b: 0.2, a: 1 }, tiling: 8 },
    { triplanar: true, hasNormal: false, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, tiling: 6 },
  ],
  textured: false,
  normals: false,
});
```

***

### writeChunkIndices()

> **writeChunkIndices**(`chunkSize`, `lod`, `indices`): `void`

Writes a chunk's index buffer at a level of detail. It depends on nothing but the sizes, so every
chunk of a terrain shares one pattern per level.

#### Parameters

##### chunkSize

`number`

Quads per chunk side.

##### lod

`number`

The level of detail.

##### indices

`Uint32Array`

Receives [chunkIndexCount](#chunkindexcount) indices.

#### Returns

`void`

***

### writeChunkVertices()

> **writeChunkVertices**(`field`, `chunkX`, `chunkZ`, `lod`, `chunkSize`, `skirtDepth`, `positions`, `normals`, `uvs?`): `void`

Writes a chunk's positions and normals — and, when given, its UVs — into existing arrays. This
is what a sculpt calls: the index buffer never changes, so only these are re-uploaded.

#### Parameters

##### field

[`HeightField`](#heightfield)

The height field.

##### chunkX

`number`

The chunk column.

##### chunkZ

`number`

The chunk row.

##### lod

`number`

The level of detail.

##### chunkSize

`number`

Quads per chunk side.

##### skirtDepth

`number`

How far the skirts hang down, in metres.

##### positions

`Float32Array`

Receives three floats per vertex.

##### normals

`Float32Array`

Receives three floats per vertex.

##### uvs?

`Float32Array`\<`ArrayBufferLike`\>

Receives two floats per vertex, or omitted to leave UVs alone.

#### Returns

`void`

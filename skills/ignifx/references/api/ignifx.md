# ignifx

`ignifx` public barrel: the umbrella entry point that re-exports `@ignifx/core` and, as each
phase lands, the standard extensions (`docs/architecture/00-overview.md` §2). Every symbol is
re-exported by name — no `export *` (coding standards §4).

Only the core surface exists today. The input, physics, physics-2d, audio, 2d, 3d, and ui
re-exports and the one-call `createGame()` arrive with the phases of
`docs/plan/engineering-plan.md` that populate those packages.

## Classes

### IgnifxError

The error type every ignifx API throws for misuse (`CONSTITUTION.md` §3.9). It always carries a
stable `IGX-####` code so production builds can compact the message without losing meaning.

#### Example

```ts
try {
  await createRenderEngine(canvas);
} catch (error) {
  if (error instanceof IgnifxError && error.code === "IGX-0001") {
    showWebGpuUnsupportedPage();
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

[`ErrorCode`](#errorcode-1)

The stable `IGX-####` code for the failure.

###### message

`string`

An actionable description of what went wrong and how to fix it.

###### options?

`ErrorOptions`

Standard `Error` options; use `cause` to keep the original failure.

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

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

The stable diagnostic code for this failure.

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

## Interfaces

### HeadlessRuntime

A GPU-free engine and scene pair used by unit tests, servers, and tools
(`CONSTITUTION.md` §3.8). Step it with [stepHeadless](#stepheadless) and release it with
[disposeHeadlessRuntime](#disposeheadlessruntime).

#### Properties

##### isDisposed

> `readonly` **isDisposed**: `boolean`

Whether [disposeHeadlessRuntime](#disposeheadlessruntime) has already run.

##### lite

> `readonly` **lite**: [`LiteHeadlessHandles`](#liteheadlesshandles)

The unstable Babylon Lite escape hatch.

***

### LiteHeadlessHandles

Babylon Lite objects behind a headless runtime.

#### Remarks

Unstable. Lite ships breaking changes in minor releases, so nothing reachable through this
property is covered by the stability guarantees of `CONSTITUTION.md` Article IV.

#### Properties

##### engine

> `readonly` **engine**: `EngineContext`

The Lite null engine backing the runtime.

##### scene

> `readonly` **scene**: `SceneContext`

The Lite scene context advanced by [stepHeadless](#stepheadless).

***

### LiteRenderHandles

Babylon Lite objects behind a rendering runtime.

#### Remarks

Unstable, for the same reason as `LiteHeadlessHandles`: Lite ships breaking changes in minor
releases and this escape hatch carries no stability guarantee.

#### Properties

##### engine

> `readonly` **engine**: `EngineContext`

The Lite WebGPU engine bound to the canvas. Lite's engine is also its primary surface.

***

### RenderRuntime

A WebGPU engine bound to a canvas. Release it with [disposeRenderEngine](#disposerenderengine).

#### Properties

##### isDisposed

> `readonly` **isDisposed**: `boolean`

Whether [disposeRenderEngine](#disposerenderengine) has already run.

##### lite

> `readonly` **lite**: [`LiteRenderHandles`](#literenderhandles)

The unstable Babylon Lite escape hatch.

## Type Aliases

### ErrorCode

> **ErrorCode** = *typeof* [`ErrorCode`](#errorcode)\[keyof *typeof* [`ErrorCode`](#errorcode)\]

The union of the error codes this package can throw.

***

### RenderSurface

> **RenderSurface** = `HTMLCanvasElement` \| `OffscreenCanvas`

A canvas ignifx can render into: a DOM canvas on the main thread, or an `OffscreenCanvas`
transferred to a worker. Declared here so public signatures do not depend on a Babylon Lite type.

## Variables

### ErrorCode

> `const` **ErrorCode**: `object`

Error codes owned by this module. Phase 1 replaces this with the full registry described in
`docs/architecture/15-devtools-and-diagnostics.md` §1; only the WebGPU capability code exists today.

#### Type Declaration

##### invalidRuntime

> `readonly` **invalidRuntime**: `"IGX-0002"`

A runtime handle was used after it had been disposed, or was not created by ignifx.

##### webGpuUnavailable

> `readonly` **webGpuUnavailable**: `"IGX-0001"`

WebGPU is not available in the current environment.

## Functions

### createHeadlessRuntime()

> **createHeadlessRuntime**(): [`HeadlessRuntime`](#headlessruntime)

Creates a headless runtime: a Babylon Lite null engine plus a scene with no default render task.
Two runtimes can exist in the same process without interfering (`CONSTITUTION.md` §3.6).

#### Returns

[`HeadlessRuntime`](#headlessruntime)

A runtime ready to be stepped.

#### Example

```ts
const runtime = createHeadlessRuntime();
stepHeadless(runtime, 1 / 60);
disposeHeadlessRuntime(runtime);
```

***

### createRenderEngine()

> **createRenderEngine**(`canvas`): `Promise`\<[`RenderRuntime`](#renderruntime)\>

Creates a WebGPU engine bound to `canvas`. The capability probe runs first so that an unsupported
browser produces an ignifx error with code `IGX-0001` instead of an opaque Babylon Lite failure.

#### Parameters

##### canvas

[`RenderSurface`](#rendersurface)

The canvas or offscreen canvas to render into.

#### Returns

`Promise`\<[`RenderRuntime`](#renderruntime)\>

A runtime owning the engine.

#### Throws

IgnifxError with code `IGX-0001` when WebGPU is unavailable.

#### Example

```ts
const runtime = await createRenderEngine(document.querySelector("canvas"));
disposeRenderEngine(runtime);
```

***

### disposeHeadlessRuntime()

> **disposeHeadlessRuntime**(`runtime`): `void`

Releases the scene owned by a headless runtime. Calling it twice is a no-op.

#### Parameters

##### runtime

[`HeadlessRuntime`](#headlessruntime)

A runtime from [createHeadlessRuntime](#createheadlessruntime).

#### Returns

`void`

#### Throws

IgnifxError with code `IGX-0002` when the object was not created by ignifx.

***

### disposeRenderEngine()

> **disposeRenderEngine**(`runtime`): `void`

Releases the engine owned by a rendering runtime. Calling it twice is a no-op.

#### Parameters

##### runtime

[`RenderRuntime`](#renderruntime)

A runtime from [createRenderEngine](#createrenderengine).

#### Returns

`void`

#### Throws

IgnifxError with code `IGX-0002` when the object was not created by ignifx.

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

### stepHeadless()

> **stepHeadless**(`runtime`, `deltaSeconds`): `void`

Advances a headless runtime by one deterministic simulation step.

#### Parameters

##### runtime

[`HeadlessRuntime`](#headlessruntime)

A runtime from [createHeadlessRuntime](#createheadlessruntime).

##### deltaSeconds

`number`

The step length in seconds; the adapter converts it to Lite's milliseconds.

#### Returns

`void`

#### Throws

IgnifxError with code `IGX-0002` when the runtime is disposed or was not created by ignifx.

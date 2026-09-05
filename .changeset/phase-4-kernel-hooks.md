---
"@ignifx/core": minor
---

Kernel hooks for physics extensions

`ExtensionContext` gains three `@beta` members for extension authors, so that `@ignifx/physics` can be written without reaching into core's internals (`docs/architecture/04-extensions.md` §1, §3, `09-physics.md` §1, §2.1, §4):

- `dispatchScriptCallback(entity, kind, argument)` delivers one physics callback — `PhysicsCallbackName` is `"onCollisionEnter" | "onCollisionStay" | "onCollisionExit" | "onTriggerEnter" | "onTriggerExit"` — to every effectively-enabled `Script` on an entity that implements it, in component order, through the same guarded call site the frame loop uses. Systems still never call script callbacks themselves (`03-scripting-and-components.md` §6). A handler that throws is reported to `app.onError` with `source: "lifecycle"` and the running phase, and the remaining scripts still receive the callback; a destroyed or inactive entity receives nothing; nothing is allocated per call. Calling it outside the fixed loop throws `IGX-0409` in development and delivers anyway in production.
- `entityImplements(entity, kind)` answers whether any script on an entity implements a physics callback, ignoring `enabled` so that `Rigidbody.collisionEvents` auto-detection only changes when a component is added or removed. The general form is public on the registry as `ComponentRegistry.implementsCallback(type, kind)`, reading the bit mask the registry computes once per class.
- `setSimulationScene(scene)` publishes the scene an extension simulates in as `world.lite.simulationScene`, and `null` clears it. Handing a world a second, different simulation scene throws `IGX-0410`.

`Entity` gains `onComponentAdded` and `onComponentRemoved` (`@public`), the missing piece an extension needs to learn that an entity's component set changed: `onComponentAdded` emits synchronously at the end of `addComponent`, after the component's `onAttach`; `onComponentRemoved` emits in the destroy flush once the component has left `entity.components`. Both are created lazily on first access and are owner-safe, so an entity that nothing observes pays nothing.

`World.lite` now returns a stable `WorldLiteHandles` object updated in place instead of a fresh literal per read, so the escape hatch allocates nothing per frame, and its `simulationScene` is typed `LiteScene | null`. `ScriptCallbackKind` and `PhysicsCallbackName` are exported from the package entry point.

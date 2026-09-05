# Gotchas

Traps in the Phase 1 kernel (engine `0.0.0`), each with its replacement and, where one exists, the
error code you will see. The ten most common are repeated in `../SKILL.md`.

## App and platform

1. **Do not assume WebGPU exists.** There is no WebGL fallback. Call `isWebGpuAvailable()` and show
   a fallback page; `createApp({ canvas })` rejects with `IGX-0701` when no adapter is available.
2. **Do not call `app.step(dt)` on a rendering app.** Babylon Lite's loop already drives frames, so
   it throws `IGX-0105`. `step` is for `createApp({ headless: true })` only.
3. **Do not touch an app after `app.dispose()`.** Every member throws `IGX-0106`. Create a new app.
4. **Do not read `app.world` or `app.lite` before `createApp` resolves.** They throw `IGX-0107`.
   `createApp` is `async` because the engine and the extensions' `register` hooks are.
5. **Do not set `time.fixedDeltaTime` or `time.maximumDeltaTime` to zero or a negative number.** It
   throws `IGX-0108`. Change `fixedDeltaTime` between frames, not inside one.
6. **Do not pass a settings section no extension registered.** It throws `IGX-0407` in development;
   a value that fails its schema throws `IGX-0408`. Register the section from an extension first.
7. **Do not rely on `app.lite.engine`, `app.lite.scene`, `world.lite`, or `transform.lite`.** They
   are unstable escape hatches, excluded from the stability guarantees, and Babylon Lite ships
   breaking changes between minors. Ask for a first-class API instead.

## Lifecycle and time

8. **Do not integrate with `app.time.deltaTime` inside `fixedUpdate`.** It runs 0…N times per frame.
   Use the `dt` argument, which is always `time.fixedDeltaTime`.
9. **Do not write `async awake()`, `async update()`, or any `async` lifecycle callback.** A promise
   continuation resumes after the entire frame, outside every phase. Use a coroutine
   (`startCoroutine`, `yield waitSeconds(…)`) — `yield promise` even resumes on the first `Update`
   after the promise settles.
10. **Do not add `override` to a lifecycle callback or to a static.** Neither the callbacks nor the
    statics (`typeId`, `schema`, `requires`, `allowMultiple`, `executionOrder`, `updateWhenPaused`)
    are members of `Component`/`Script`: the callbacks live on `ScriptCallbacks`/`ComponentHooks`
    and the statics are matched structurally through `ComponentStatics`/`ScriptStatics`. Write
    `static typeId = "mygame/Mover"`. `override` is only needed when a class extends one of your
    _own_ concrete classes that already declares the static.
11. **Do not expect `awake` on a component added with `enabled: false`.** `awake` waits until the
    component is first effectively enabled. `onEnable` follows in flush A, `onDisable` fires
    synchronously at the transition, and `start` runs once ever, in flush B.
12. **Do not depend on `start` order between unrelated scripts.** Only `static executionOrder` and
    creation order are guaranteed. Coordinate with a `Signal`.
13. **Do not expect `lateUpdate` after destroying a script during `update`.** Destruction is queued
    to the destroy flush, which runs after `lateUpdate`, but the script stops receiving callbacks at
    once and `isDestroyed` is already `true`.
14. **Do not mutate an entity or component after `destroy()`.** It throws `IGX-0101`. Check
    `isDestroyed` first.
15. **Do not call `destroyImmediate()` inside a lifecycle callback.** It throws `IGX-0102`; it
    exists for tools and tests. Use `destroy()`.
16. **Do not expect the fixed loop while paused.** `app.pause()` stops fixed steps entirely and
    skips `update`/`lateUpdate` unless a class sets `static updateWhenPaused = true`. Every
    other phase keeps running, which is what lets a pause screen render.

## Scene graph

17. **Do not remove a Lite mesh from the scene to hide something.** Lite disposes a mesh removed
    from its last scene, permanently. Set `entity.active = false` to hide, and use `destroy()` only
    when the object is really finished with.
18. **Do not use `entity.find("Body/Arm.L")` in game code.** Paths break the moment anyone renames
    or reparents a node. Declare an `entityRef`/`componentRef` field, or `requireComponent`; `find`
    is allowed in tests, examples, and tools only.
19. **Do not keep a plain class field pointing at an entity or component.** Only `entityRef` and
    `componentRef` fields are tracked and nulled in the destroy flush. A plain field becomes a
    dangling reference; check `isDestroyed` before using one.
20. **Do not depend on the order of `world.findByTag(tag)` or `world.components(Type)`.** Both are
    live arrays maintained by swap-remove: membership is stable, order is not. Sort if you need one.
21. **Do not call a world-space getter in a hot loop.** `transform.position`, `.rotation`,
    `.eulerAngles`, `.lossyScale`, `.forward`, `.right`, and `.up` allocate a fresh object each time.
    Use `positionToRef(out)` and friends, or mutate `localPosition`/`localRotation`/`localScale` in
    place — they are live views over the Lite node.
22. **Do not remove or disable a `Transform`.** Every entity has exactly one for its whole life
    (`IGX-0205`).
23. **Do not parent an entity into its own subtree.** It throws `IGX-0306`. `setParent` defaults to
    `worldPositionStays: true`; pass `false` to keep local values instead.
24. **Do not assume radians.** Every public angle is in degrees (`rotate`, `eulerAngles`,
    `rotation2D`, `Quat.fromEulerDegrees`); a radian API always carries a `Rad` suffix
    (`Quat.fromEulerRadians`, `Quat.toEulerRadiansToRef`).

## Components, schemas, signals

25. **Do not expect a plain class field to be saved.** Only fields declared in
    `Component.define({...})` / `Script.define({...})` are serialized, inspected, and documented.
26. **Do not let the class name be the `typeId`.** Minifiers rename classes. Write an explicit,
    namespaced `static typeId = "mygame/Mover"`; a duplicate throws `IGX-0203` and a
    missing one throws `IGX-0204` at serialization time.
27. **Do not name a schema field after a `Component` member.** `enabled`, `update`, `entity`, and
    the rest throw `IGX-0607` when the class is defined.
28. **Do not forget `app.registerComponents([...])`.** A class the registry does not know cannot be
    resolved from a file, and `requires` validation (`IGX-0201`) and the single-instance rule
    (`IGX-0202`) run off the same metadata.
29. **Do not call `signal.connect(handler)` from a script without an owner.** Pass `{ owner: this }`
    so the connection dies with the script; the custom lint rule flags the bare form.
30. **Do not use `{ deferred: true }` on a `Signal` you constructed yourself.** Deferred delivery
    needs the app's end-of-frame queue behind it, and a standalone signal throws `IGX-0103`.
31. **Do not use `NaN` or `Infinity` in a serialized field.** Encoding rejects them with
    `IGX-0601`; numbers are canonicalized to six decimal places so files round-trip byte-identically.

## Not here yet

32. **Do not write scene or prefab JSON yet.** The scene format, assets, `MeshRenderer`, cameras,
    and lights arrive in Phase 2. Nothing renders in Phase 1: entities, transforms, scripts, and the
    frame loop are the whole surface.

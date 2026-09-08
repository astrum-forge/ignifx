# Gotchas

Traps in the engine as it stands (rendering and assets included), each with its replacement
and, where one exists, the error code you will see. The eighteen most common are repeated in
`../SKILL.md`.

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
8. **Do not write `{placeholder}` tokens in a log message.** `app.log.info(message, ...data)` does
   no interpolation: the console sink prints `message` verbatim and appends `data` as extra console
   arguments, so `app.log.info("crate at y={y}", y)` literally prints `crate at y={y} 3.2`. Pass a
   label and the values — `app.log.info("crate at y:", y)` — or interpolate yourself with a template
   literal.

## Lifecycle and time

9. **Do not integrate with `app.time.deltaTime` inside `fixedUpdate`.** It runs 0…N times per frame.
   Use the `dt` argument, which is always `time.fixedDeltaTime`.
10. **Do not write `async awake()`, `async update()`, or any `async` lifecycle callback.** A promise
    continuation resumes after the entire frame, outside every phase. Use a coroutine
    (`startCoroutine`, `yield waitSeconds(…)`) — `yield promise` even resumes on the first `Update`
    after the promise settles.
11. **Do not add `override` to a lifecycle callback or to a static.** Neither the callbacks nor the
    statics (`typeId`, `schema`, `requires`, `allowMultiple`, `executionOrder`, `updateWhenPaused`)
    are members of `Component`/`Script`: the callbacks live on `ScriptCallbacks`/`ComponentHooks`
    and the statics are matched structurally through `ComponentStatics`/`ScriptStatics`. Write
    `static typeId = "mygame/Mover"`. `override` is only needed when a class extends one of your
    _own_ concrete classes that already declares the static.
12. **Do not expect `awake` on a component added with `enabled: false`.** `awake` waits until the
    component is first effectively enabled. `onEnable` follows in flush A, `onDisable` fires
    synchronously at the transition, and `start` runs once ever, in flush B.
13. **Do not depend on `start` order between unrelated scripts.** Only `static executionOrder` and
    creation order are guaranteed. Coordinate with a `Signal`.
14. **Do not expect `lateUpdate` after destroying a script during `update`.** Destruction is queued
    to the destroy flush, which runs after `lateUpdate`, but the script stops receiving callbacks at
    once and `isDestroyed` is already `true`.
15. **Do not mutate an entity or component after `destroy()`.** It throws `IGX-0101`. Check
    `isDestroyed` first.
16. **Do not call `destroyImmediate()` inside a lifecycle callback.** It throws `IGX-0102`; it
    exists for tools and tests. Use `destroy()`.
17. **Do not expect the fixed loop while paused.** `app.pause()` stops fixed steps entirely and
    skips `update`/`lateUpdate` unless a class sets `static updateWhenPaused = true`. Every
    other phase keeps running, which is what lets a pause screen render.
18. **Do not expect `app.step(dt)` to advance `dt` seconds.** The delta is clamped by
    `time.maximumDeltaTime`, which is `0.1` by default, so `app.step(0.4)` advances one tenth of a
    second and `time.droppedSeconds` reports the rest. A headless test that wants 0.4 s of game time
    pumps 24 frames of `1 / 60`; raise `app.time.maximumDeltaTime` only if a long single step is
    really what you mean.

## Scene graph

19. **Do not remove a Lite mesh from the scene to hide something.** Lite disposes a mesh removed
    from its last scene, permanently. Set `entity.active = false` to hide, and use `destroy()` only
    when the object is really finished with.
20. **Do not use `entity.find("Body/Arm.L")` in game code.** Paths break the moment anyone renames
    or reparents a node. Declare an `entityRef`/`componentRef` field, or `requireComponent`; `find`
    is allowed in tests, examples, and tools only.
21. **Do not keep a plain class field pointing at an entity or component.** Only `entityRef` and
    `componentRef` fields are tracked and nulled in the destroy flush. A plain field becomes a
    dangling reference; check `isDestroyed` before using one.
22. **Do not depend on the order of `world.findByTag(tag)` or `world.components(Type)`.** Both are
    live arrays maintained by swap-remove: membership is stable, order is not. Sort if you need one.
23. **Do not call a world-space getter in a hot loop.** `transform.position`, `.rotation`,
    `.eulerAngles`, `.lossyScale`, `.forward`, `.right`, and `.up` allocate a fresh object each time.
    Use `positionToRef(out)` and friends, or mutate `localPosition`/`localRotation`/`localScale` in
    place — they are live views over the Lite node.
24. **Do not remove or disable a `Transform`.** Every entity has exactly one for its whole life
    (`IGX-0205`).
25. **Do not parent an entity into its own subtree.** It throws `IGX-0306`. `setParent` defaults to
    `worldPositionStays: true`; pass `false` to keep local values instead.
26. **Do not assume radians.** Every public angle is in degrees (`rotate`, `eulerAngles`,
    `rotation2D`, `Quat.fromEulerDegrees`); a radian API always carries a `Rad` suffix
    (`Quat.fromEulerRad`, `Quat.toEulerRadToRef`).

## Components, schemas, signals

27. **Do not expect a plain class field to be saved.** Only fields declared in
    `Component.define({...})` / `Script.define({...})` are serialized, inspected, and documented.
28. **Do not let the class name be the `typeId`.** Minifiers rename classes. Write an explicit,
    namespaced `static typeId = "mygame/Mover"`; a duplicate throws `IGX-0203` and a
    missing one throws `IGX-0204` at serialization time.
29. **Do not name a schema field after a `Component` member.** `enabled`, `update`, `entity`, and
    the rest throw `IGX-0607` when the class is defined.
30. **Do not forget `app.registerComponents([...])`.** A class the registry does not know cannot be
    resolved from a file, and `requires` validation (`IGX-0201`) and the single-instance rule
    (`IGX-0202`) run off the same metadata.
31. **Do not call `signal.connect(handler)` from a script without an owner.** Pass `{ owner: this }`
    so the connection dies with the script; the custom lint rule flags the bare form.
32. **Do not use `{ deferred: true }` on a `Signal` you constructed yourself.** Deferred delivery
    needs the app's end-of-frame queue behind it, and a standalone signal throws `IGX-0103`.
33. **Do not use `NaN` or `Infinity` in a serialized field.** Encoding rejects them with
    `IGX-0601`; numbers are canonicalized to six decimal places so files round-trip byte-identically.

## Rendering

34. **Do not turn a rendering feature on after `app.start()`.** Babylon Lite applies `shadows`,
    `postProcessing`, `skeletons`, `boneControl`, `stencil`, `lightmaps`, `materialPlugins`,
    `asyncPipelines`, and `deviceLostRecovery` only before the scene is registered, and every one of
    them is `false` by default. Declare them in `settings.rendering.features`, or from an extension
    with `ctx.requireRenderingFeature(name)`; afterwards it throws `IGX-0704`. A light with
    `shadows.enabled = true` and no `shadows` feature simply gets no shadow pass.
35. **Do not expect a mesh spawned at runtime to be visible on the next frame.** A material family
    that did not exist when the scene was registered takes Lite's runtime build path: spike S2.2
    measured **3 extra frames** before the mesh appeared, against 0–2 when the family had been warmed
    and 0 when a mesh of that family was already drawn. `app.start()` warms the `boot` preload group;
    call `app.renderer.warmUp(materials)` for anything you load later (ADR-0014).
36. **Do not put two `Environment` components in one world**, and do not expect its `skybox` record
    to change the background. The one enabled last wins and the world logs `IGX-0705` once; there is
    one image-based lighting setup per world. Babylon Lite builds the background inside
    `loadEnvironment`, from the `.environment.json`'s `skyboxEnabled`/`skybox`/`skyboxSize`, and
    hands back no handle on it — so _setting_ `Environment.skybox` to something the installed
    environment did not deliver logs `IGX-0711` once and changes nothing, while leaving the record
    alone is silent whatever the declaration says. An
    environment loaded _after_ `app.start()` gets no background at all, because only `registerScene`
    drains the builders that would make one. Assigning a different **loaded** handle to
    `environment` does switch the _lighting_ (diffuse next frame, specular the frame after, when the
    material groups are rebuilt), and both assets keep their GPU resources while retained, so
    switching back and forth is free. Assigning `null` means "stop steering", not "go dark": Lite
    has no inverse of `loadEnvironment`, so the last environment keeps lighting the scene and
    `installed` keeps naming it. A world that switches environments wants `skyboxEnabled: false` and
    an `Environment.clearColor`.
37. **Do not ask a point or hemispheric light for shadows.** Lite has no cube-shadow generator, so
    `shadows.enabled` on either throws `IGX-0703`. Cast from a directional or spot light.
38. **Do not forget an enabled `Camera`.** A world without one renders nothing and logs `IGX-0706`
    once — once per renderer, on the first frame it reconciles, not once per `app.step`. The enabled
    camera with the highest `priority` wins; ties break on creation order. A headless app has the
    same render sync, so a camera-less test prints the warning too; it is harmless there. Add a
    `Camera` entity, or pass `createApp({ headless: true, logLevel: "error" })` (or `"silent"`) to
    keep test output clean.
39. **Do not expect `MeshRenderer.materials[1]` to draw.** This Lite version has one material per
    mesh: index 0 is used, later entries are accepted and ignored, and an empty array draws with the
    default material. The array shape is kept so files survive submesh support landing.
40. **Do not `await app.renderer.captureScreenshot()` without a running render loop.** A frame has
    to be presented, so a headless app — or a stopped one — rejects with `IGX-0707`.
41. **Do not write a colour as a hex string in settings or a file.** `"#101014"` is only ever a
    schema _default_. A settings value is a colour object (`{ r, g, b, a }`, sRGB 0–1) and a file
    value is `[r, g, b, a]`; anything else is `IGX-0408` or `IGX-0605`.
42. **Do not attach a `PostProcessStack` without `features.postProcessing`.** It is declared at app
    start like the other features, because it picks the scene's whole render path: a post-process
    effect has to sample what the scene drew, a WebGPU canvas texture cannot be sampled, and so the
    scene is rendered into an offscreen target instead. Without the feature the stack logs
    `IGX-0710` once and does nothing. Two more rules for a stack you do enable: `imageProcessing` is
    always applied last whatever its `order`, and an effect once recorded is switched off rather
    than removed — `stack.enabled = false` bypasses the chain and brings the plain scene back.
43. **Do not point a `Light` by writing to the Lite light.** The entity's transform is the light: a
    directional or spot light shines along the entity's forward (`+Z`) axis, a point or spot light
    sits at its position, and a hemispheric light's sky direction is the entity's up (`+Y`) axis.
    Use `entity.transform.lookAt(target)`. The Lite light is deliberately unparented and ignifx
    rewrites its pose from the entity every frame the entity moves, so anything you write onto
    `light.lite.light.direction` is overwritten.
44. **Do not assume device loss is recoverable.** Even with `features.deviceLostRecovery` on, Lite
    cannot rebuild PCF/CSM shadow generators or glTF `EXT_lights_image_based` environments, so a
    scene using either reaches `app.events.onDeviceRecoveryFailed`. Offer a page reload.

## Assets

45. **Do not call `load` without a matching `release`.** Handles are shared and reference-counted:
    two loads of one address answer with the same handle. `using handle = app.assets.load(…)` or an
    explicit `release()` — and a zero-reference asset is only unloaded after `assets.gcDelay`
    seconds (default 5).
46. **Do not read `handle.value` while the state is not `"loaded"`.** It throws `IGX-0501`. Await
    `handle.promise`, `yield handle.promise` in a coroutine, or check `handle.state` first.
47. **Do not expect a load to land mid-frame.** Completed loads are delivered by one system in
    `PreUpdate`, so a state flip you asked for during `update` is observable on the **next** frame,
    at one consistent point. That is deliberate: "is this ready?" has one answer per frame.
48. **Do not release the handle an `asset()` field holds.** The field never owned the reference —
    the scene instance that loaded the asset releases it on unload. Release only what your own code
    loaded or built.
49. **Do not expect an in-code asset to survive a save.** `MeshAsset.box(app)`,
    `createMaterialAsset(app, …)`, and anything from `Assets.register` live at a `memory:` address
    that names no file, so serializing a component holding one writes `null` and reports `IGX-0602`.
    Write a `.material.json` or ship a `.glb` when it has to round-trip.
50. **Do not look for a mesh file format.** There is none: geometry is a primitive built in code or
    part of a `ModelAsset`. A `"mesh"` address fails with `IGX-0504`.
51. **Do not load a scene before registering the components it names.** An unknown `typeId` is
    `IGX-0307` and the entity is built without that component. Call `app.registerComponents([...])`
    first — `virtual:ignifx/scripts` from `@ignifx/vite-plugin` generates the list for you.
52. **Do not hand-write a `memory:` address, and do not assume an address is a URL.** Addresses are
    resolved through the manifest; `app.assets.resolveUrl(address)` is what a loader fetches.

## Callbacks the extensions deliver

53. **Do not type a physics callback's parameter as `unknown` and cast it.** Core declares
    `onCollisionEnter?(collision: unknown)` and `onTriggerEnter?(trigger: unknown)` on
    `ScriptCallbacks` because it does not depend on the physics packages, but TypeScript's method
    parameters are bivariant: writing `onTriggerEnter(trigger: TriggerEvent): void` (or
    `TriggerEvent2D`) on your script satisfies the interface directly. The cast is not only
    unnecessary, it trips `typescript/no-unsafe-type-assertion` under the engine's lint settings. The payloads arrive only when
    `physics()` or `physics2d()` is registered; without either, nothing calls them and
    `world.lite.simulationScene` is `null`.

## Diagnostics and builds

54. **Do not call `app.diagnostics.registerGroup` from a script.** A second registration of a name
    throws `IGX-1503`, and a script's `awake` runs once per instance and again after a scene reload.
    Use `app.diagnostics.groupOrRegister(name, counterNames)`, which registers on the first call and
    hands back the same group afterwards. The counter names of a later call are ignored — counters
    are indexed, so a group cannot grow under a subsystem already holding indices into it — and
    asking that group for a counter it never declared throws `IGX-1504`.
55. **Do not assume a production build turns development mode off.** `createApp`'s `mode` defaults
    to `"development"` and nothing overrides it — not the Vite plugin, not `vite build`. So a shipped
    game still formats full error messages, writes `performance.mark`/`measure` entries, and fills
    `FrameSample.cpuMs`. That is often what you want while a game is young; when it is not, pass the
    mode yourself: `createApp({ mode: import.meta.env.PROD ? "production" : "development" })`. Read
    `app.diagnostics.isDevelopment` before trusting `cpuMs`, which is all zeros in production mode.

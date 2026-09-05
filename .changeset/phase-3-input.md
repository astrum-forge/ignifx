---
"@ignifx/input": minor
"ignifx": minor
---

Phase 3: player input

`@ignifx/input` ships, and the `ignifx` umbrella re-exports all of it. Registering `input()` gives a game `app.input` — a typed property paired with a `declare module "@ignifx/core"` augmentation — plus the `inputactions` asset type, the `PlayerInput` component, the `input` project settings section, an `input` diagnostics group, and the `PreUpdate` system (order `-950`, before core's asset delivery at `-900`) that resolves a frame's input before any script callback runs.

**Devices.** `Keyboard` (physical `KeyboardEvent.code` names, so WASD survives AZERTY, plus `anyKey`), `Mouse`, the unified `Pointer`, `Touch` with a primary slot and ten numbered ones, four `Gamepad` slots in the W3C standard mapping (sticks flipped so up is positive, `dpad` synthesised as a `vector2`, a remap table for common non-standard pads, and `rumble(intensity, seconds)` through `vibrationActuator`), and a `Virtual` device whose controls are created on demand for on-screen sticks and buttons. Every control resolves once to an integer index into a `Float32Array`, so no frame does a string lookup. DOM events are queued with a monotonic sequence number and applied once, in `PreUpdate`; `blur` and `visibilitychange` queue a release of everything so a key held while the page loses focus does not stick.

**Actions.** `InputAction` (`button`/`axis`/`vector2`, `isPressed`, `wasPressedThisFrame`, `wasReleasedThisFrame`, an allocation-free live `vector` view, and `onStarted`/`onPerformed`/`onCanceled` signals reported through `app.onError`), `ActionMap` as the context switch, and `app.input.actions.get(name)` searching the enabled maps (`IGX-0801`). Edge flags are computed once per frame and hold for the whole frame, every fixed step included. Actions whose controls changed resolve first, in the arrival order of the events that changed them.

**Bindings.** The path grammar `<Device>/control`, sub-controls (`<Gamepad>/dpad/up`), and a zero-based device slot written `<Gamepad>{1}/leftStick`; the `2DVector`, `1DAxis`, and `ButtonWithModifier` composites; and the `deadzone`, `invert`, `scale`, `clamp`, and `normalize` processors, parsed from strings once at load time into precompiled chains. Control schemes switch on the last device used and drive `currentScheme`/`onControlSchemeChanged`; a scheme tag does not filter resolution unless `input.strictSchemes` is set.

**Assets and persistence.** The `.input.json` format `ignifx.inputactions` version 1, its loader, `defineInputActions({ … })` for the same document in code, `inputActionsJsonSchema()` and `describeInputActionsFormat()` for the build-time validator and the docs harness, and `app.input.loadActions(...)` which merges by map name. `performInteractiveRebind(action, options)` resolves with the highest-magnitude actuation of a frame and writes `binding.overridePath`; `saveOverrides()`/`loadOverrides(json)` persist overrides as an `ignifx.inputoverrides` document.

**The rest.** Pointer lock (`request()`/`exit()`/`locked`/`onChange`, with `<Mouse>/delta` still reporting while locked), `cursor.visible`, `uiHasFocus` suppression of keyboard actions, the pooled per-frame `app.input.events` stream, `PlayerInput` for per-player device slots, and `simulate({ "<Keyboard>/w": 1 })` plus `simulateEvent(...)` so headless tests drive the identical pipeline.

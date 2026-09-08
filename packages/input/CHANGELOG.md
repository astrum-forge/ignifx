# @ignifx/input

## 0.2.1

### Patch Changes

- 21a4ba7: Pointer deltas are CSS pixels, the canvas wheel no longer scrolls the page, `InputAction.activeDevice`, and pointer lock asks for raw mouse motion
  
  Four fixes to the things a look control is built out of, all found while chasing "the camera on the
  third-person example does not behave correctly" and "scroll interferes with page scrolling".
  
  **The wheel is taken non-passively.** The canvas `wheel` listener was registered `{ passive: true }`,
  which forbids `preventDefault`, so a wheel over a running game zoomed the camera _and_ scrolled the
  page underneath it — obvious on ignifx.com, where the examples live in an `<iframe>` and the wheel
  took the article with it. The listener is now non-passive and prevents the default on every event it
  queues. The wheel is still read from the canvas alone, so a wheel over the page's own chrome is
  untouched, and the queued entry is unchanged.
  
  **Pointer deltas are CSS pixels; positions stay backing-store pixels.** `<Mouse>/delta`,
  `<Pointer>/delta`, `<Touch>/…/delta` and `event.deltaX`/`deltaY` were multiplied by
  `canvas.width / rect.width`, the same scale positions need. A delta is hand motion, not a place on
  the render target: the scale doubled every look sensitivity on a device-pixel-ratio-2 display and
  moved it again whenever a settings screen changed `renderer.resolutionScale`. Deltas are now the
  browser's raw `movementX`/`movementY`, and for the pointer types that leave those at zero (touch,
  some pens) the DOM adapter derives the motion from that pointer's own successive `clientX`/`clientY`
  — in CSS pixels, never from the queued position. `DeviceWriter` derives nothing at all now, so
  `simulateEvent` reports exactly the delta a test states. Positions are unchanged, so
  `renderer.pickAsync(pointer.position)` and `Camera.screenToRay` are still exact at every ratio.
  A game author sees one number to tune: a mouse look sensitivity in degrees per CSS pixel, around
  0.08–0.15, the same on every display.
  
  **`InputAction.activeDevice`** names the device family behind the binding whose magnitude won the
  frame, and `null` when the action is at rest or disabled — stable for the frame like every other
  reading. One `Look` action bound to both a mouse and a stick carries two different quantities, and
  this is what lets a rig tell them apart: `@ignifx/3d` uses it to ignore mouse look until the pointer
  is locked and to read a stick as a rate. A composite reports the device of its first part, which is
  the only sensible answer for a `2DVector` whose four parts are one device.
  
  **`PointerLock.request()` asks for `unadjustedMovement: true`** before it asks plainly, falling back
  when the browser rejects the option by throwing or by rejecting the returned promise. That is raw
  mouse motion with the desktop's pointer-acceleration curve removed, which is what a first-person look
  wants — with acceleration on, a fast flick turns further than a slow one over the same desk distance,
  which is most of what players describe as a jumpy look. Settle semantics are unchanged: `true` on
  `pointerlockchange`, `false` on `pointerlockerror`, `IGX-0809` on a headless app.
  
  Public API change: `InputAction.activeDevice: DeviceKind | null` is new. No signature changed, but
  the **meaning** of `<Mouse>/delta`, `<Pointer>/delta` and `<Touch>/…/delta` did: they are CSS pixels
  now, so a project that tuned its sensitivity on a retina display re-tunes it once (`invert` and
  `scale(...)` processors still apply as before).
- Updated dependencies [388b0f6]
  - @ignifx/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0

## 0.1.0

### Minor Changes

- d349254: `app.input.uiHasPointer`
  
  A settable flag, symmetric with `uiHasFocus`: while a pointer is pressed on the UI overlay, pointing-device actions read as released (their events are still published), so a drag that began on a UI slider no longer also turns the camera. `@ignifx/ui` assigns it.
  
  Pointer positions and deltas (`<Pointer>/position`, `<Pointer>/delta`, `<Mouse>/…`, `<Touch>/…`, and `app.input.events`) are reported in the canvas's backing-store pixels instead of CSS pixels, the space `Camera.worldToScreen`, `Camera.screenToRay`, and `renderer.pickAsync` already used, so `pickAsync(pointer.position)` is exact at every device pixel ratio.
- 4cfb15f: Phase 3: player input
  
  `@ignifx/input` ships, and the `ignifx` umbrella re-exports all of it. Registering `input()` gives a game `app.input` — a typed property paired with a `declare module "@ignifx/core"` augmentation — plus the `inputactions` asset type, the `PlayerInput` component, the `input` project settings section, an `input` diagnostics group, and the `PreUpdate` system (order `-950`, before core's asset delivery at `-900`) that resolves a frame's input before any script callback runs.
  
  **Devices.** `Keyboard` (physical `KeyboardEvent.code` names, so WASD survives AZERTY, plus `anyKey`), `Mouse`, the unified `Pointer`, `Touch` with a primary slot and ten numbered ones, four `Gamepad` slots in the W3C standard mapping (sticks flipped so up is positive, `dpad` synthesised as a `vector2`, a remap table for common non-standard pads, and `rumble(intensity, seconds)` through `vibrationActuator`), and a `Virtual` device whose controls are created on demand for on-screen sticks and buttons. Every control resolves once to an integer index into a `Float32Array`, so no frame does a string lookup. DOM events are queued with a monotonic sequence number and applied once, in `PreUpdate`; `blur` and `visibilitychange` queue a release of everything so a key held while the page loses focus does not stick.
  
  **Actions.** `InputAction` (`button`/`axis`/`vector2`, `isPressed`, `wasPressedThisFrame`, `wasReleasedThisFrame`, an allocation-free live `vector` view, and `onStarted`/`onPerformed`/`onCanceled` signals reported through `app.onError`), `ActionMap` as the context switch, and `app.input.actions.get(name)` searching the enabled maps (`IGX-0801`). Edge flags are computed once per frame and hold for the whole frame, every fixed step included. Actions whose controls changed resolve first, in the arrival order of the events that changed them.
  
  **Bindings.** The path grammar `<Device>/control`, sub-controls (`<Gamepad>/dpad/up`), and a zero-based device slot written `<Gamepad>{1}/leftStick`; the `2DVector`, `1DAxis`, and `ButtonWithModifier` composites; and the `deadzone`, `invert`, `scale`, `clamp`, and `normalize` processors, parsed from strings once at load time into precompiled chains. Control schemes switch on the last device used and drive `currentScheme`/`onControlSchemeChanged`; a scheme tag does not filter resolution unless `input.strictSchemes` is set.
  
  **Assets and persistence.** The `.input.json` format `ignifx.inputactions` version 1, its loader, `defineInputActions({ … })` for the same document in code, `inputActionsJsonSchema()` and `describeInputActionsFormat()` for the build-time validator and the docs harness, and `app.input.loadActions(...)` which merges by map name. `performInteractiveRebind(action, options)` resolves with the highest-magnitude actuation of a frame and writes `binding.overridePath`; `saveOverrides()`/`loadOverrides(json)` persist overrides as an `ignifx.inputoverrides` document.
  
  **The rest.** Pointer lock (`request()`/`exit()`/`locked`/`onChange`, with `<Mouse>/delta` still reporting while locked), `cursor.visible`, `uiHasFocus` suppression of keyboard actions, the pooled per-frame `app.input.events` stream, `PlayerInput` for per-player device slots, and `simulate({ "<Keyboard>/w": 1 })` plus `simulateEvent(...)` so headless tests drive the identical pipeline.

### Patch Changes

- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [7ca9efe]
- Updated dependencies [9ab633d]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [1d18250]
  - @ignifx/core@0.1.0

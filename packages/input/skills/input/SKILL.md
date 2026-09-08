---
name: input
description: Wires player input into an ignifx game with @ignifx/input: action maps, bindings, composites and processors, control schemes, keyboard, mouse, pointer, gamepad and touch devices, pointer lock, cursor handling, .input.json action assets, and runtime rebinding. Use when adding or editing input actions, bindings, devices, or a rebinding screen in an ignifx project, or when the user mentions @ignifx/input, PlayerInput, action maps, or input.json.
license: Apache-2.0
metadata:
  ignifx-version: "0.2.1"
---

# @ignifx/input

## What this is / when to use

`@ignifx/input` is the ignifx extension that turns browser input into **actions**. Game code asks
for `"move"` and `"jump"`, never for a key code. Devices are bound in a `.input.json` asset or in
code, action state is resolved once per frame so every read inside one frame agrees, and the same
pipeline runs headless so tests drive the game with `app.input.simulate({ … })`.

Use it for movement, camera look, UI navigation, local multiplayer device pairing, pointer lock, and
rebinding screens. Raw device state stays available for tools and prototypes.

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Browsers and Electron. No Babylon Lite dependency: input is DOM-only, so it works identically
  under the null engine (`createApp({ headless: true })`).
- Register it like any extension; nothing happens at import time.

```ts
import { createApp, input } from "ignifx";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [input({ actions: "input/default.input.json" })] });
  await app.start();
}
```

`input({ actions })` **does not await the document.** The extension starts the load in `onStart` and
delivery happens in the `PreUpdate` of the first stepped frame, so an `actions.get(name)` made before
that frame throws `IGX-0801`. Either load the document yourself before `start()`, or await the handle
the extension kept — reading actions from `update` is always safe, because a frame has been stepped
by then.

```ts
import { createApp, type InputActionsAsset } from "ignifx";
import { input } from "@ignifx/input";

declare const canvas: HTMLCanvasElement;

// Before `start()` a completed load settles as soon as it finishes, so this needs no frame.
const app = await createApp({ canvas, extensions: [input()] });
app.input.loadActions(await app.assets.loadAsync<InputActionsAsset>("input/default.input.json"));
await app.start();

// Or keep `input({ actions: … })` and wait for the handle it kept.
await app.input.actionsHandle?.promise;
```

`ignifx.config.ts` carries the same settings under `input`:

| Setting               | Default | Meaning                                                              |
| --------------------- | ------- | -------------------------------------------------------------------- |
| `actions`             | `""`    | Address of the `.input.json` loaded at startup                       |
| `pressPoint`          | `0.5`   | Magnitude at which an analog value counts as pressed                 |
| `gamepadPolling`      | `true`  | Whether pads are polled each frame                                   |
| `pointerLock.allowed` | `true`  | Whether `pointerLock.request()` may ask the browser                  |
| `defaultScheme`       | `""`    | Scheme the app starts in; empty picks the document's first           |
| `strictSchemes`       | `false` | Whether a binding's `scheme` tag filters resolution, not just glyphs |

## Mental model

```
app.input (InputService)
 ├─ devices     Keyboard · Mouse · Pointer · Touch · Gamepad[0..3] · Virtual
 │                each a fixed control table over a Float32Array
 ├─ actions     ActionMap[] → InputAction[] → Binding[] (+ composites, processors)
 ├─ controlSchemes   auto-selected by the last device that produced input
 ├─ pointerLock · cursor · uiHasFocus
 └─ events      the frame's ordered raw event list (pooled, reused)
```

- Browser events are **queued** as they arrive and applied once, in `PreUpdate` at order `-950`,
  before core delivers assets at `-900`. Reads are therefore identical in `fixedUpdate`, `update`,
  and `lateUpdate` of one frame — including `wasPressedThisFrame` across every fixed step.
- Actions whose controls changed resolve first, in the arrival order of the events that changed
  them; everything else follows in map and declaration order. Nothing is undefined.
- Maps are how a game switches context: enable `"UI"`, disable `"Player"`. `actions.get` searches
  the enabled maps only, so a disabled map's actions are not "released" — they are invisible, and
  `get` throws `IGX-0801`.
- `PlayerInput` is the optional per-player component; single-player games use `app.input` directly.

## First app

```ts run
import { createApp, defineInputActions, input, Script } from "ignifx";

const actions = defineInputActions({
  controlSchemes: [
    { name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] },
    { name: "Gamepad", devices: ["Gamepad"] },
  ],
  maps: [
    {
      name: "Player",
      actions: [
        {
          name: "move",
          type: "vector2",
          bindings: [
            {
              composite: "2DVector",
              up: "<Keyboard>/w",
              down: "<Keyboard>/s",
              left: "<Keyboard>/a",
              right: "<Keyboard>/d",
            },
            { path: "<Gamepad>/leftStick", processors: ["deadzone(0.15)"] },
          ],
        },
        { name: "jump", bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }] },
      ],
    },
  ],
});

class Mover extends Script {
  static typeId = "mygame/Mover";

  update(dt: number): void {
    const move = this.app.input.actions.get("move");
    this.transform.translate({ x: move.vector.x * dt, y: 0, z: move.vector.y * dt });
    if (this.app.input.actions.get("jump").wasPressedThisFrame) {
      this.app.log.info("jump");
    }
  }
}

const app = await createApp({ headless: true, extensions: [input()] });
app.input.loadActions(actions);
app.registerComponents([Mover]);
app.world.createEntity("Player").addComponent(Mover);

app.input.simulate({ "<Keyboard>/w": 1, "<Keyboard>/space": 1 });
app.step(1 / 60);
app.input.actions.get("jump").wasPressedThisFrame; // true, for the whole frame
```

## Core APIs

### `app.input`

| Member                                                         | What it does                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions.get(name)`                                            | Action from the **enabled** maps; `IGX-0801` when unknown _or in a disabled map_                                                                                                                                                             |
| `actions.find(name)` / `actions.map(name)`                     | Tolerant lookup / one map by name (`IGX-0804`)                                                                                                                                                                                               |
| `loadActions(assetOrDefinition)`                               | Installs a document's maps, merging by map name                                                                                                                                                                                              |
| `devices` / `gamepads`                                         | The device table; `gamepads[i].rumble(intensity, seconds)`. For gameplay, bind a `vector2` action to `<Pointer>/position` and read `action.vector`; `devices.resolve(path)` / `control(name)` / `valueAt(offset)` are the raw path for tools |
| `events`                                                       | The frame's raw events, in arrival order (records are recycled)                                                                                                                                                                              |
| `currentScheme` / `onControlSchemeChanged`                     | The active control scheme                                                                                                                                                                                                                    |
| `onDeviceConnected` / `onDeviceDisconnected`                   | Gamepad slots filling and emptying                                                                                                                                                                                                           |
| `uiHasFocus`                                                   | While `true`, keyboard actions read as released                                                                                                                                                                                              |
| `pressPoint` / `strictSchemes`                                 | Runtime knobs, defaulted from the settings section                                                                                                                                                                                           |
| `pointerLock.request()/exit()/locked/onChange`                 | Pointer lock; `<Mouse>/delta` keeps reporting while locked. `request()` asks for `unadjustedMovement` (raw, un-accelerated motion) and falls back to the plain request where the browser refuses the option                                  |
| `cursor.visible`                                               | `cursor: none` on the canvas                                                                                                                                                                                                                 |
| `simulate(values)` / `simulateEvent(event)`                    | Headless and test input, through the same pipeline                                                                                                                                                                                           |
| `releaseAll()`                                                 | Queues what `blur` queues, so nothing stays stuck                                                                                                                                                                                            |
| `performInteractiveRebind(action, options?)`                   | Listens for the next control and writes an override                                                                                                                                                                                          |
| `saveOverrides()` / `loadOverrides(json)` / `clearOverrides()` | Override persistence                                                                                                                                                                                                                         |
| `createActionSet(source, options?)`                            | A private copy of the maps pinned to one gamepad slot                                                                                                                                                                                        |

### `InputAction`

| Member                                                     | Notes                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`, `map`, `type`, `enabled`, `bindings`               | `type` is `button`, `axis`, or `vector2`                                                                                                                                                                     |
| `isPressed`, `wasPressedThisFrame`, `wasReleasedThisFrame` | Edge flags hold for the whole frame                                                                                                                                                                          |
| `axis`, `vector`, `magnitude`, `value`                     | `vector` is a **live** view; never reallocated                                                                                                                                                               |
| `activeDevice`                                             | The `DeviceKind` of the binding that won this frame (`"Mouse"`, `"Gamepad"`, …), `null` at rest or disabled; a composite reports its first part's device. Read it to treat one action differently per device |
| `onStarted`, `onPerformed`, `onCanceled`                   | `Signal<InputActionEvent>`; the event is reused                                                                                                                                                              |

### `PlayerInput` (component, `ignifx/PlayerInput`)

| Field        | Kind                       | Default | Meaning                                            |
| ------------ | -------------------------- | ------- | -------------------------------------------------- |
| `actions`    | `asset(InputActionsAsset)` | `null`  | The document the private maps are built from       |
| `deviceSlot` | `i32`                      | `0`     | The gamepad slot `<Gamepad>/…` paths are pinned to |
| `scheme`     | `str`                      | `""`    | Keep only bindings tagged with this scheme         |

The resolved lookup is `playerInput.input` (an `InputActionsView`, or `null` until the document is
loaded), because the serialized field already owns the name `actions`.

### Diagnostics

`app.diagnostics.group("input")`: `eventsThisFrame`, `gamepadsConnected`, `activeScheme` (index into
the declared schemes, `-1` for none), `pointerLocked`.

### Error codes

`IGX-0801` unknown action · `IGX-0802` unknown processor · `IGX-0803` bad binding path ·
`IGX-0804` unknown map · `IGX-0805` bad `.input.json` · `IGX-0806` unknown composite ·
`IGX-0807` a rebind is already listening · `IGX-0808` unusable saved overrides ·
`IGX-0809` pointer lock without a canvas · `IGX-0810` a duplicate name.

## Recipes

- **Switch context**: `app.input.actions.map("Player").enabled = false;` then enable `"UI"`.
- **Rebind a key**: `await app.input.performInteractiveRebind(action, { bindingIndex: 0, cancelPath: "<Keyboard>/escape", timeoutSeconds: 5 })`, then persist `app.input.saveOverrides()`.
- **First-person look**: bind `<Mouse>/delta`, call `app.input.pointerLock.request()` from a click
  handler, and scale in the game rather than in the binding: deltas are CSS pixels, so a sensitivity
  of **0.08–0.15 degrees per pixel** feels right on every display and at every render scale.
  `@ignifx/3d`'s `FirstPersonController` and `ThirdPersonCamera` do this for you, including the
  "ignore the mouse until the lock is held" rule. Bind a stick to the same action and read
  `action.activeDevice` to multiply it by a rate (degrees per second) times `dt` instead — and to
  fix the sign: a pointer's `y` grows **downward** and a stick's grows **upward**, so a rig that
  wants one pitch axis negates the pointer's.
- **Local multiplayer**: give each player entity a `PlayerInput` with its own `deviceSlot`.
- **On-screen stick**: write `<Virtual>/joystick` from a UI widget with
  `app.input.devices.virtual.setVector("joystick", x, y)` and bind the path like any other.

## File formats

`.input.json`, format `ignifx.inputactions`, version 1 — maps, actions, binding paths, composites,
processors, control schemes. Prose and tables:
[`inputactions.md`](../../../../skills/ignifx/references/formats/inputactions.md); generated field
table: [`ignifx.inputactions.md`](../../../../skills/ignifx/references/formats/ignifx.inputactions.md).
Overrides are a separate `ignifx.inputoverrides` document produced by `saveOverrides()`.

## Gotchas

- **Keyboard controls are physical positions**, taken from `KeyboardEvent.code`: `<Keyboard>/w` is
  the key where W sits on a US layout, so WASD still works on AZERTY. There is no `<Keyboard>/W`.
- **Read input once per frame and trust it.** Values are captured at frame start; polling harder
  inside `fixedUpdate` changes nothing, and `wasPressedThisFrame` is `true` in _every_ fixed step of
  the frame it resolved in.
- **Disabling a map hides its actions; it does not neutralise them.** `app.input.actions.get(name)`
  searches enabled maps only and throws `IGX-0801` the moment the declaring map is disabled. Reach a
  hidden action through `actions.map(name).get(name)` or `actions.find(name)`, where it reads as
  released. What does read as released through `get` is an action whose own `enabled` is `false`, so
  set `action.enabled = false` when a live handle has to keep working.
- **`uiHasFocus` suppresses keyboard actions only.** Pointer actions keep working and the raw
  keyboard events are still published on `app.input.events`, which is what text entry reads.
- **Pointer lock needs a user gesture.** Call `request()` from a click handler; the promise resolves
  `false` when the browser refuses, and rejects with `IGX-0809` on a headless app.
- **A gamepad does not exist until a button is pressed.** Browsers hide pads from
  `navigator.getGamepads()` until then, so `gamepads[0].isConnected` starts `false`.
- **Gamepad sticks report `+1` for up**, unlike the raw API, so `leftStick` agrees with a `2DVector`
  composite.
- **`app.input.events` records are pooled.** They are valid for the frame and recycled after it;
  copy anything that has to outlive the frame.
- **`vector` is a live view.** Two reads of `action.vector` return the same object, so store its
  components, not the object, if you need a snapshot.
- **Scheme tags do not filter by default.** A `Gamepad`-tagged binding still resolves while
  `KeyboardMouse` is active; set `input: { strictSchemes: true }` if that is not what you want.
- **Binding overrides are addressed by index.** Reordering an action's bindings invalidates saved
  overrides, loudly (`IGX-0808`).
- **Positions are backing-store pixels, deltas are CSS pixels.** `<Pointer>/position`, `<Mouse>/position`, `<Touch>/…/position` and `event.x`/`event.y` are in the canvas's `width`/`height` space, so `app.renderer.pickAsync(pointer.position)` and `camera.screenToRay` are exact at every device pixel ratio; divide by `devicePixelRatio` for DOM work. `<Mouse>/delta`, `<Pointer>/delta`, `<Touch>/…/delta` and `event.deltaX`/`event.deltaY` are **CSS** pixels of hand motion, so a look sensitivity does not double on a retina display and does not move when a settings screen changes `renderer.resolutionScale`. Do not derive one from the other.
- **A wheel over the canvas does not scroll the page.** The canvas `wheel` listener is non-passive and calls `preventDefault()`, which is what keeps an embedded game (an `<iframe>` on a page) from scrolling its host while the player zooms. A wheel anywhere else on the page is untouched.
- **Two UI flags mask devices**: `app.input.uiHasFocus` (a text field owns the keyboard) and `app.input.uiHasPointer` (a pointer is pressed on the UI overlay) make keyboard or pointing-device actions read as released for the frame; events are still published. `@ignifx/ui` writes both; a game with its own DOM UI sets them itself.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `skills/ignifx/references/api/input.md` for the
generated API · `docs/architecture/08-input.md` for design rationale.

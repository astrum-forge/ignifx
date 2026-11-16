# 08 · Input

**Status:** Design standard; describes the engine as built (pre-1.0) · **Package:** `@ignifx/input` · **Inspiration:** Unity Input System (actions, bindings, control schemes), Godot InputMap (`is_action_just_pressed`, `get_vector`)

**Source map** (paths under `packages/input/src/`)

- `service/input-service.ts`, `service/input-system.ts`: `app.input`, frame resolution in `PreUpdate`, diagnostics (§1, §9).
- `service/device-writer.ts`, `devices/device.ts`: the one write path into device state; the sub-frame tap hold lives in `InputDevice.write` (§1, §5).
- `actions/`, `bindings/`: actions, maps, schemes; binding paths, composites, processors (§2, §3).
- `devices/keyboard.ts`, `pointing.ts`, `gamepad.ts`, `virtual.ts`: control names per device and the non-standard pad remap table (§3, §4).
- `dom/`: the DOM adapter: event queue, pointer, keyboard, gamepad and focus sources, pointer lock, cursor (§4, §5).
- `asset/`: the `.input.json` format, its loader and `defineInputActions` (§3).
- `rebinding/`: overrides and interactive rebind (§6).
- `components/player-input.ts`: `PlayerInput` (§7).
- `packages/ui/src/widgets/virtual-joystick.ts`, `virtual-button.ts` (outside this package): the on-screen controls that write `<Virtual>` (§8).

Invariants:

- Events are queued and resolved once per frame in `PreUpdate`, in arrival order; every read in a frame, fixed steps included, returns the same value (§1).
- A tap shorter than a frame still produces a press and a release (§1).
- Keyboard paths are physical key codes, never layout characters (§3).
- Pointer positions are backing-store pixels; pointer deltas are CSS pixels (§5).
- The canvas wheel listener is non-passive and prevents the default (§4).
- Keyboard actions read as released while a text field has focus, pointing actions while the UI holds the pointer (§5).

---

## 1. Model

```
InputService (app.input)
 ├─ devices: Keyboard, Mouse, Pointer (unified mouse/pen/touch), Touch, Gamepad[0..3]
 ├─ actions: ActionMap[] → InputAction[] → Binding[] (+ processors)
 ├─ controlSchemes: KeyboardMouse | Gamepad | Touch (auto-selected by last used device)
 ├─ pointerLock, cursor
 └─ raw event stream (for UI and text entry)
```

- **Frame-consistent state.** Browser events are queued as they arrive and resolved once, in the `PreUpdate` phase. During a frame every read returns the same values; edge flags (`wasPressedThisFrame`) are valid for the whole frame including all fixed steps. A scalar control that leaves rest and returns to it between two frames is held for one frame, so a sub-frame tap resolves as a press in the next frame and a release in the one after (`InputDevice.write`). Events are resolved in arrival order, so action callbacks are delivered deterministically (Unity documents its order as undefined; ignifx does not).
- **Actions over raw keys.** Game code binds to actions (`"move"`, `"jump"`); devices are bound in a `.input.json` asset or in code. Raw device state remains available for tools and prototypes.

## 2. Actions

```ts
interface InputAction {
  readonly name: string;
  readonly map: ActionMap;
  readonly type: "button" | "axis" | "vector2";
  enabled: boolean;
  readonly value: boolean | number | Vec2; // typed accessors below avoid unions
  readonly isPressed: boolean; // button: held; axis/vector2: magnitude > pressPoint
  readonly wasPressedThisFrame: boolean;
  readonly wasReleasedThisFrame: boolean;
  readonly axis: number; // for "axis"
  readonly vector: Vec2; // for "vector2" (readonly live view)
  readonly onStarted: Signal<InputActionEvent>; // first actuation
  readonly onPerformed: Signal<InputActionEvent>; // value changed / button pressed
  readonly onCanceled: Signal<InputActionEvent>; // returned to rest
  readonly bindings: readonly Binding[];
  readonly activeDevice: DeviceKind | null; // which device produced this frame's value
}
interface ActionMap {
  readonly name: string;
  enabled: boolean;
  readonly actions: ReadonlyMap<string, InputAction>;
  get(name): InputAction;
}
app.input.actions.get("move"); // searches enabled maps; throws IGX-0801 when unknown
app.input.actions.map("UI").enabled = true;
```

- Maps group actions by context (`"Player"`, `"UI"`, `"Vehicle"`); enabling/disabling a map is how games switch contexts. Actions inside disabled maps read as released.
- `pressPoint` (default 0.5) turns analog values into button state.
- **`activeDevice`** names the device family behind the binding whose magnitude won the frame, and `null` when the action is at rest or disabled. It is stable for the frame like every other reading. A composite answers with the device of its **first** part — the four parts of a `2DVector` are one device in any binding that makes sense, and a mixed one has no single answer. It exists because one action legitimately means different things per device: a `Look` bound to both `<Mouse>/delta` and `<Gamepad>/rightStick` carries a displacement from one and a rate from the other, and a mouse look must be ignored until the pointer is locked while a stick look must not be (`12-3d-toolkit.md` §1.2).

## 3. Bindings

Binding paths follow the Unity Input System shape: `"<Device>/control"`.

- **Keyboard** (physical `KeyboardEvent.code`): `<Keyboard>/w`, `<Keyboard>/space`, `<Keyboard>/shiftLeft`, `<Keyboard>/anyKey`.
- **Mouse:** `<Mouse>/leftButton`, `<Mouse>/rightButton`, `<Mouse>/middleButton`, `<Mouse>/position`, `<Mouse>/delta`, `<Mouse>/scroll`.
- **Pointer** (mouse, pen and primary touch): `<Pointer>/press`, `<Pointer>/position`, `<Pointer>/delta`.
- **Touch:** `<Touch>/primaryTouch/press`, `<Touch>/touch0/position` (through `touch9`), `<Touch>/touchCount`.
- **Gamepad** (standard mapping): `<Gamepad>/leftStick`, `<Gamepad>/rightStick`, `<Gamepad>/buttonSouth`, `<Gamepad>/leftTrigger`, `<Gamepad>/dpad/up`, `<Gamepad>/start`.
- **Virtual** (on-screen controls, §8): `<Virtual>/joystick`, `<Virtual>/buttonA`.

Composites: `2DVector` (up/down/left/right → `vector2`), `1DAxis` (negative/positive → `axis`), `ButtonWithModifier` (modifier + button). Processors: `deadzone(min, max)` (radial for sticks), `invert`, `scale(x[, y])`, `clamp`, `normalize`. There are no interactions (hold, tap, multi-tap); a game times them from `isPressed` and the edge flags.

```json
{
  "format": "ignifx.inputactions",
  "formatVersion": 1,
  "controlSchemes": [
    { "name": "KeyboardMouse", "devices": ["Keyboard", "Mouse"] },
    { "name": "Gamepad", "devices": ["Gamepad"] },
    { "name": "Touch", "devices": ["Touch"] }
  ],
  "maps": [
    {
      "name": "Player",
      "actions": [
        {
          "name": "move",
          "type": "vector2",
          "bindings": [
            {
              "composite": "2DVector",
              "up": "<Keyboard>/w",
              "down": "<Keyboard>/s",
              "left": "<Keyboard>/a",
              "right": "<Keyboard>/d",
              "scheme": "KeyboardMouse"
            },
            { "path": "<Gamepad>/leftStick", "processors": ["deadzone(0.15)"], "scheme": "Gamepad" }
          ]
        },
        {
          "name": "jump",
          "type": "button",
          "bindings": [{ "path": "<Keyboard>/space" }, { "path": "<Gamepad>/buttonSouth" }]
        },
        {
          "name": "look",
          "type": "vector2",
          "bindings": [
            { "path": "<Mouse>/delta", "processors": ["scale(0.1)"] },
            { "path": "<Gamepad>/rightStick", "processors": ["deadzone(0.2)", "scale(3)"] }
          ]
        }
      ]
    },
    {
      "name": "UI",
      "actions": [
        {
          "name": "submit",
          "type": "button",
          "bindings": [{ "path": "<Keyboard>/enter" }, { "path": "<Gamepad>/buttonSouth" }]
        }
      ]
    }
  ]
}
```

- The same asset can be defined in code with `defineInputActions({...})` (typed, same shape), and the Vite plugin validates `.input.json` against the schema.
- Keyboard bindings use physical key codes so WASD works on AZERTY layouts. The engine provides no layout-aware display names for keys; a rebinding screen that wants them queries the browser itself.

## 4. Devices

- **Keyboard/Mouse/Pointer/Touch** subscribe to DOM events on the canvas (pointer, wheel, touch) and on `window` (keyboard, blur). `blur`/`visibilitychange` release all controls to avoid stuck keys.

  The canvas `wheel` listener is registered **non-passive** (`{ passive: false }`) and calls `preventDefault()` on every wheel event it queues. With a passive listener the page behind the canvas would scroll, or the browser zoom, while the game reads the same wheel as a camera zoom; it matters most when the canvas lives in an `<iframe>` inside a scrolling page. The wheel is read from the canvas and nowhere else, so a wheel over the page's own chrome is untouched.

- **Gamepads** are polled through the Gamepad API each frame; `standard` mapping is assumed, with a small remap table for common non-standard pads. Haptics via `gamepad.vibrationActuator.playEffect` when present (`app.input.gamepads[0].rumble(intensity, seconds)`).
- **Pointer lock** (`app.input.pointerLock.request()`/`exit()`, `locked`, `onChange`) for first-person controls; `<Mouse>/delta` keeps reporting during lock. **Cursor** visibility: `app.input.cursor.visible`.

  `request()` asks for `canvas.requestPointerLock({ unadjustedMovement: true })` first and falls back to the plain call when the browser rejects the option (by throwing, or by rejecting the returned promise). Unadjusted movement is raw mouse motion with the desktop's pointer-acceleration curve removed, which is what a first-person look wants: with acceleration on, a fast flick turns further than a slow one over the same desk distance, and that is most of what players describe as a "jumpy" look. The promise resolves `true` on `pointerlockchange`, `false` on `pointerlockerror`, and rejects with `IGX-0809` on a headless app.

- **Control schemes** switch on the last device that produced input; `app.input.currentScheme` and `onControlSchemeChanged` let UI show the right glyphs.
- **Device events:** `onDeviceConnected`/`onDeviceDisconnected` (gamepads).

## 5. UI and focus

- While a DOM text field has focus (`@ignifx/ui` sets `app.input.uiHasFocus`), keyboard actions read as released and keyboard events are not consumed; pointer actions still work unless the UI marks the event handled.
- While a pointer is pressed on the UI overlay (`@ignifx/ui` sets `app.input.uiHasPointer`), pointing-device actions (`<Pointer>`, `<Mouse>`, `<Touch>`) read as released and their events are still published; keyboard and gamepad actions keep working. Pointer moves and releases are read from the window, which is what would otherwise let a drag that began on a UI slider also drive `<Pointer>/delta`.
- `app.input.events` exposes the raw, ordered event stream of the frame (`{ type: "keydown", code, key, repeat }`, pointer events, wheel) for text entry, menus, and tools.

**Pointer pixel spaces.** A pointer event carries two measurements and they are in two different units:

- **Positions** (`<Pointer>/position`, `<Mouse>/position`, `<Touch>/…/position`, `event.x`/`event.y`) are in **backing-store pixels**, the canvas's `width`/`height`. They name a place on the render target, which is the space `Camera.worldToScreen`, `renderer.pickAsync` and `Camera.screenToRay` share.
- **Deltas** (`<Pointer>/delta`, `<Mouse>/delta`, `<Touch>/…/delta`, `event.deltaX`/`event.deltaY`) are in **CSS pixels**, the raw `movementX`/`movementY`. They measure hand motion, not a place. Scaled by `width / rect.width`, a look's sensitivity would double at a device pixel ratio of 2 and change again every time a settings screen moved `renderer.resolutionScale`; a look sensitivity must depend on neither.

Wheel deltas are the browser's own and are untouched. The deltas are the DOM adapter's to produce: it uses `movementX`/`movementY` where the browser reports them and, for the pointer types that leave them at zero (touch, some pens), derives the motion from that pointer's own successive `clientX`/`clientY` — never from the queued position, which is in the other space. `DeviceWriter` derives nothing; a `simulateEvent` in a test states the delta it means.

The consequence for gameplay code: a mouse look sensitivity is in degrees per **CSS pixel** and is stable across displays and render scales; 0.08 to 0.15 is a sensible range (`@ignifx/3d`'s rigs default to 0.15 and 0.2).

## 6. Rebinding and persistence

- `binding.overridePath` replaces a binding at runtime; `app.input.performInteractiveRebind(action, { bindingIndex, excludePaths, cancelPath })` resolves with the chosen control (highest-magnitude actuation, Unity semantics).
- `app.input.saveOverrides()` / `loadOverrides(json)` serialize overrides; templates store them through `app.storage`.

## 7. `PlayerInput` component (optional)

For local multiplayer and per-player device assignment: `PlayerInput` binds an entity to an action asset and a device slot, creates a private copy of the maps, and exposes them as `playerInput.input`, an `InputActionsView` like `app.input.actions`. Single-player games use `app.input` directly. Pairing devices to players is the game's own UI.

## 8. Platform notes

- Electron: identical DOM APIs; pointer lock and gamepads work without extra flags.
- Mobile browsers: touch and virtual controls. `@ignifx/ui` provides the `VirtualJoystick` and `VirtualButton` widgets (plain classes, not components), which write a synthetic device (`<Virtual>/joystick`, `<Virtual>/buttonA`) that bindings name like any other.
- Headless: devices are stubs; tests inject state with `app.input.simulate({ "<Keyboard>/w": 1 })`, which resolves through the same pipeline.

## 9. Diagnostics

The `input` diagnostics group publishes `eventsThisFrame`, `gamepadsConnected`, `activeScheme` and `pointerLocked`; `@ignifx/devtools` renders a live action panel.

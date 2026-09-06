# 08 · Input

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/input` · **Inspiration:** Unity Input System (actions, bindings, control schemes), Godot InputMap (`is_action_just_pressed`, `get_vector`)

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

- **Frame-consistent state.** Browser events are queued as they arrive and resolved once, in the `PreUpdate` phase. During a frame every read returns the same values; edge flags (`wasPressedThisFrame`) are valid for the whole frame including all fixed steps. Events are resolved in arrival order, so action callbacks are delivered deterministically (Unity documents its order as undefined; ignifx does not).
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

## 3. Bindings

Binding paths follow the Unity Input System shape: `"<Device>/control"`.

| Device                                   | Example paths                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard (physical `KeyboardEvent.code`) | `<Keyboard>/w`, `<Keyboard>/space`, `<Keyboard>/shiftLeft`, `<Keyboard>/anyKey`                                                         |
| Mouse                                    | `<Mouse>/leftButton`, `<Mouse>/rightButton`, `<Mouse>/middleButton`, `<Mouse>/position`, `<Mouse>/delta`, `<Mouse>/scroll`              |
| Pointer (mouse+pen+touch primary)        | `<Pointer>/press`, `<Pointer>/position`, `<Pointer>/delta`                                                                              |
| Touch                                    | `<Touch>/primaryTouch/press`, `<Touch>/touch0/position`, `<Touch>/touchCount`                                                           |
| Gamepad (standard mapping)               | `<Gamepad>/leftStick`, `<Gamepad>/rightStick`, `<Gamepad>/buttonSouth`, `<Gamepad>/leftTrigger`, `<Gamepad>/dpad/up`, `<Gamepad>/start` |

Composites: `2DVector` (up/down/left/right → `vector2`), `1DAxis` (negative/positive → `axis`), `ButtonWithModifier` (modifier + button). Processors: `deadzone(min, max)` (radial for sticks), `invert`, `scale(x[, y])`, `clamp`, `normalize`. Interactions (`hold`, `tap`, `multiTap`) are Phase 3 stretch goals.

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
- Keyboard bindings use physical key codes so WASD works on AZERTY layouts; display names for UI come from `navigator.keyboard.getLayoutMap()` when available, with a fallback table.

## 4. Devices

- **Keyboard/Mouse/Pointer/Touch** subscribe to DOM events on the canvas (pointer, wheel, touch) and on `window` (keyboard, blur). `blur`/`visibilitychange` release all controls to avoid stuck keys.
- **Gamepads** are polled through the Gamepad API each frame; `standard` mapping is assumed, with a small remap table for common non-standard pads. Haptics via `gamepad.vibrationActuator.playEffect` when present (`app.input.gamepads[0].rumble(intensity, seconds)`).
- **Pointer lock** (`app.input.pointerLock.request()`/`exit()`, `locked`, `onChange`) for first-person controls; `<Mouse>/delta` keeps reporting during lock. **Cursor** visibility: `app.input.cursor.visible`.
- **Control schemes** switch on the last device that produced input; `app.input.currentScheme` and `onControlSchemeChanged` let UI show the right glyphs.
- **Device events:** `onDeviceConnected`/`onDeviceDisconnected` (gamepads).

## 5. UI and focus

- While a DOM text field has focus (`@ignifx/ui` sets `app.input.uiHasFocus`), keyboard actions read as released and keyboard events are not consumed; pointer actions still work unless the UI marks the event handled.
- While a pointer is pressed on the UI overlay (`@ignifx/ui` sets `app.input.uiHasPointer`), pointing-device actions (`<Pointer>`, `<Mouse>`, `<Touch>`) read as released and their events are still published; keyboard and gamepad actions keep working. Pointer moves and releases are read from the window, which is what would otherwise let a drag that began on a UI slider also drive `<Pointer>/delta`. (Added 2026-09-06.)
- `app.input.events` exposes the raw, ordered event stream of the frame (`{ type: "keydown", code, key, repeat }`, pointer events in backing-store pixels — the canvas's `width`/`height`, the space `Camera.worldToScreen` and `renderer.pickAsync` use; amended 2026-09-06, previously CSS pixels, which missed picks by the device pixel ratio — wheel) for text entry, menus, and tools.

## 6. Rebinding and persistence

- `binding.overridePath` replaces a binding at runtime; `app.input.performInteractiveRebind(action, { bindingIndex, excludePaths, cancelPath })` resolves with the chosen control (highest-magnitude actuation, Unity semantics).
- `app.input.saveOverrides()` / `loadOverrides(json)` serialize overrides; templates store them through `app.storage`.

## 7. `PlayerInput` component (optional)

For local multiplayer and per-player device assignment: `PlayerInput` binds an entity to an action asset and a device slot, creates a private copy of the maps, and exposes `player.input.actions`. Single-player games use `app.input` directly. Multiplayer device pairing UI is a post-MVP recipe.

## 8. Platform notes

- Electron: identical DOM APIs; pointer lock and gamepads work without extra flags.
- Mobile browsers: touch and virtual controls; `@ignifx/2d` and `@ignifx/ui` provide `VirtualJoystick`/`VirtualButton` components that feed `<Touch>`-scheme bindings through a synthetic device (`<Virtual>/joystick`, `<Virtual>/buttonA`).
- Headless: devices are stubs; tests inject state with `app.input.simulate({ "<Keyboard>/w": 1 })`, which resolves through the same pipeline.

## 9. Diagnostics

`app.diagnostics.input`: events per frame, connected gamepads, active scheme, pointer-lock state; `@ignifx/devtools` renders a live action panel.

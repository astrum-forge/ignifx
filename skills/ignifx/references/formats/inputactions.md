# Input action files (`.input.json`)

Hand-written companion to the generated field table in
[`ignifx.inputactions.md`](ignifx.inputactions.md). One format, `ignifx.inputactions`, version 1,
owned by `@ignifx/input`. Rationale in `docs/architecture/08-input.md`.

Loaded with `app.assets.load<InputActionsAsset>(address)` and installed with
`app.input.loadActions(asset)`, or pointed at once in `ignifx.config.ts` as
`input: { actions: "input/default.input.json" }`. The same document can be written in code with
`defineInputActions({ … })`, which produces an object equal to what the loader parses. Validated at
build time by `@ignifx/vite-plugin` against the schema `inputActionsJsonSchema()` generates.

## Shape

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
      "enabled": true,
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
        }
      ]
    },
    {
      "name": "UI",
      "enabled": false,
      "actions": [{ "name": "submit", "type": "button", "bindings": [{ "path": "<Keyboard>/enter" }] }]
    }
  ]
}
```

## Maps and actions

| Field             | Required | Meaning                                                                      |
| ----------------- | -------- | ---------------------------------------------------------------------------- |
| `maps[].name`     | yes      | The context name a game enables and disables (`"Player"`, `"UI"`)            |
| `maps[].enabled`  | no       | Whether the map starts enabled. Defaults to `true`                           |
| `actions[].name`  | yes      | The name `app.input.actions.get(name)` searches enabled maps for             |
| `actions[].type`  | no       | `"button"` (default), `"axis"`, or `"vector2"`                               |
| `actions[].bindings` | yes   | What feeds the action; the highest-magnitude binding wins each frame         |

Action names are unique inside one map (`IGX-0810`); two maps may declare the same name, and
`app.input.actions.get` then answers with the first **enabled** map that has it.

## Binding paths

```
<Device>/control
<Device>/group/control        <Gamepad>/dpad/up, <Touch>/touch0/position
<Device>{index}/control       <Gamepad>{1}/leftStick — a zero-based device slot
```

| Device       | Controls                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Keyboard>` | Physical `KeyboardEvent.code` in camelCase, `Key`/`Digit` dropped: `w`, `1`, `space`, `enter`, `shiftLeft`, `arrowUp`, `numpad0`, plus `anyKey`         |
| `<Mouse>`    | `leftButton`, `rightButton`, `middleButton`, `position`, `delta`, `scroll`                                                                              |
| `<Pointer>`  | `press`, `position`, `delta` — mouse, pen, or the primary touch, whichever acted last                                                                  |
| `<Touch>`    | `primaryTouch/press`, `primaryTouch/position`, `primaryTouch/delta`, `touch0…touch9/press|position|delta`, `touchCount`                                 |
| `<Gamepad>`  | `leftStick`, `rightStick`, `dpad`, `dpad/up|down|left|right`, `buttonSouth|East|West|North`, `leftShoulder`, `rightShoulder`, `leftTrigger`, `rightTrigger`, `start`, `select`, `leftStickPress`, `rightStickPress` |
| `<Virtual>`  | Any name; the control is created the first time a binding or an on-screen widget names it                                                               |

Only `<Gamepad>` has more than one device, and its slots are `0` to `3`. `<Gamepad>` and
`<Gamepad>{0}` name the same pad — the one `app.input.gamepads[0]` reports and the one a
`PlayerInput` with `deviceSlot: 0` is paired with. A malformed path, an unknown device, an unknown
control, or a slot that does not exist is `IGX-0803`.

Gamepad sticks report `+1` for **up**, unlike the raw Gamepad API, and `dpad` is synthesised as a
`vector2` from the four d-pad buttons so a stick and a d-pad can feed one `vector2` action.

## Composites

| `composite`          | Parts                        | Produces  |
| -------------------- | ---------------------------- | --------- |
| `2DVector`           | `up`, `down`, `left`, `right` | `vector2` |
| `1DAxis`             | `negative`, `positive`        | `axis`    |
| `ButtonWithModifier` | `modifier`, `button`          | `button`  |

An unknown composite is `IGX-0806`.

## Processors

Written as strings and parsed once, at load time. An unknown name or a non-numeric argument is
`IGX-0802`.

| Processor           | Default arguments | Effect                                                                  |
| ------------------- | ----------------- | ----------------------------------------------------------------------- |
| `deadzone(min,max)` | `0.125, 1`        | Radial for `vector2`, axial for scalars; rescales `[min, max]` to `[0,1]` |
| `invert`            | —                 | Negates every component                                                 |
| `scale(x,y)`        | `1, x`            | Multiplies per axis; one argument scales both                           |
| `clamp(min,max)`    | `-1, 1`           | Clamps every component                                                  |
| `normalize`         | —                 | Unit length for a `vector2`; clamps a scalar into `[-1, 1]`             |

## Control schemes

A scheme names the device families it pairs with. The active scheme switches to whichever scheme
lists the device that produced input last, so UI can show the right glyphs
(`app.input.currentScheme`, `app.input.onControlSchemeChanged`). A binding tagged with a scheme
**still resolves** while another scheme is active, which is Unity's behaviour; set
`input: { strictSchemes: true }` to make the tag a filter.

## Overrides

Runtime rebinding writes `binding.overridePath`, and `app.input.saveOverrides()` produces a separate
small document, format `ignifx.inputoverrides`, version 1:

```json
{
  "format": "ignifx.inputoverrides",
  "formatVersion": 1,
  "overrides": [{ "map": "Player", "action": "jump", "bindingIndex": 0, "path": "<Keyboard>/enter" }]
}
```

Bindings are named by index, so re-ordering an action's bindings in the `.input.json` makes saved
overrides fail loudly (`IGX-0808`) instead of quietly rebinding the wrong control.

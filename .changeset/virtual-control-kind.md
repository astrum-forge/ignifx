---
"@ignifx/input": patch
---

Fix an on-screen joystick having no effect when the action map is loaded before the joystick is created: a `<Virtual>/joystick` bound by a `vector2` action was created as a button, so `VirtualJoystick`'s writes never reached the action and a `ThirdPersonController` reading it stood still. A `<Virtual>` control an action names first now takes that action's type.

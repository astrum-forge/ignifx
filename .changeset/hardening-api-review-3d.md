---
"@ignifx/3d": minor
---

API review: one options type for `play`, not two

**Breaking.** `PlayStateOptions` is removed. It was a field-for-field copy of `AnimatorPlayOptions`
— `Animator.play` forwards its options object into `AnimatorStateMachine.play` unchanged — so the
two methods now take one type, `AnimatorPlayOptions`, declared alongside the state machine.

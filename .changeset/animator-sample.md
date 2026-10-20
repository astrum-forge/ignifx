---
"@ignifx/3d": minor
"ignifx": minor
---

Add `Animator.sample(state, normalizedTime, options?)`, which poses a model at one point of one animation state at once, without playing it; an editor uses it to preview poses in edit mode.
In a playing app the sampled pose lasts until the animator next advances, and the state machine itself does not change.

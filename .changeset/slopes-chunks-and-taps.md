---
"@ignifx/physics": patch
"@ignifx/2d": patch
"@ignifx/input": patch
"ignifx": patch
---

Fix `CharacterController.isGrounded` reading false on any slope steeper than about 5°, a `HeightfieldCollider` included: a character now stands, and can jump, on every slope up to its `slopeLimit`.

Fix tilemap chunk culling drawing only the first chunk column once the camera scrolled, when a `ParallaxLayer` band sorted first; `app.twoD.visibleWorldBounds` had the same fault.

Fix a press and release that both land between two frames being lost: a quick click or a phone tap now resolves as a one-frame press, and its release in the frame after.

---
"@ignifx/physics": patch
---

Fix `app.physics.raycast` returning `null` when the ray hits a `CharacterController`: rays, `shapeCast` and `overlap` now report the character's entity, with `collider: null`, and a ray whose `layerMask` excludes the character passes through its capsule.

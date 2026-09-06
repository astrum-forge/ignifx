---
"@ignifx/physics-2d": minor
---

API review: the capsule-direction names take the package's trailing-`2D` convention

**Breaking.** `Capsule2DDirection` is renamed to `CapsuleDirection2D` and `CAPSULE_2D_DIRECTIONS` to
`CAPSULE_DIRECTIONS_2D`. Every other component-level 2D name in the package puts `2D` last
(`BodyType2D`/`BODY_TYPES_2D`, `InterpolationMode2D`/`INTERPOLATION_MODES_2D`,
`CollisionEventMode2D`/`COLLISION_EVENT_MODES_2D`); these two inserted it mid-name. The values are
unchanged.
